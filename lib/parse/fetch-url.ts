import { ApiError } from '@/lib/errors';
import { stripHtml } from './text';

/**
 * Fetch a job posting URL and return its readable text. Shared by the JD
 * import route and the JD-first parse endpoint so both fail the same way.
 *
 * Many job boards (notably LinkedIn) block server-side fetches with a
 * login wall or a JS challenge; the 502 message names the likely cause and
 * points the user at pasting the JD text instead. Nothing is silently
 * accepted: an empty or unreadable page is an error, not an empty JD.
 */
export async function fetchUrlText(url: string): Promise<string> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ApiError(400, 'That job URL is not a valid URL.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError(400, 'Job URL must start with http:// or https://.');
  }
  const isLinkedIn = /(^|\.)linkedin\.com$/i.test(parsed.hostname);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (res.status === 401 || res.status === 403 || res.status === 999) {
      throw new ApiError(502, `Job URL returned HTTP ${res.status} — the site requires sign-in or blocks automated access${isLinkedIn ? ' (LinkedIn blocks server fetches)' : ''}. Paste the job description text instead.`);
    }
    if (!res.ok) throw new ApiError(502, `Job URL returned HTTP ${res.status}. Paste the job description text instead.`);
    const text = stripHtml(await res.text());
    if (!text || text.length < 50) {
      throw new ApiError(502, 'The job page returned no readable text — it is probably JavaScript-rendered or blocked. Paste the job description text instead.');
    }
    return text;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error).name === 'AbortError') {
      throw new ApiError(502, 'The job URL timed out — the page may be JavaScript-rendered or slow. Paste the job description text instead.');
    }
    throw new ApiError(502, `Job URL could not be fetched (network error${isLinkedIn ? ' — LinkedIn blocks server fetches' : ''}). Paste the job description text instead.`);
  } finally { clearTimeout(t); }
}
