// Firecrawl company dossier: public company research only.
// Queries contain ONLY the public company name (+ role domain words), NEVER
// resume text or PII. Results are cached 7 days in company_dossiers; a hit
// within the window reuses the cache with no Firecrawl call. Key comes from
// env FIRECRAWL_API_KEY (the InterviewHub environment); when absent, or on
// any failure, the dossier stage is skipped gracefully and the Skill gets
// company-research instructions instead — the job never blocks on this.
import { get, run, now } from './db';

export interface CompanyDossier {
  company: string;
  overview: string;
  productsServices: string[];
  techLandscape: string[];
  recentDevelopments: string[];
  sources: Array<{ title: string; url: string }>;
  researchedAt: string;
  fromCache: boolean;
  available: boolean;
  error?: string;
}

export function normalizeCompany(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function toIso(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

async function firecrawlSearch(query: string, apiKey: string): Promise<Array<{ title: string; url: string; markdown?: string; description?: string }>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, limit: 5 }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Firecrawl search returned HTTP ${res.status}`);
    const data = (await res.json()) as { data?: Array<{ title?: string; url?: string; markdown?: string; description?: string }> };
    return (data.data || []).map((d) => ({ title: d.title || '', url: d.url || '', markdown: d.markdown, description: d.description }));
  } finally { clearTimeout(t); }
}

export async function getCompanyDossier(company: string, roleDomain = ''): Promise<CompanyDossier> {
  const normalized = normalizeCompany(company);
  const researchedAt = now();
  if (!normalized || normalized === 'unknown') {
    return { company, overview: '', productsServices: [], techLandscape: [], recentDevelopments: [], sources: [], researchedAt, fromCache: false, available: false, error: 'No company name to research' };
  }
  const cached = get<{ payload: string; expires_at: string }>(`SELECT payload, expires_at FROM company_dossiers WHERE company_normalized = ?`, normalized);
  if (cached && cached.expires_at > researchedAt) {
    try {
      const payload = JSON.parse(cached.payload) as Omit<CompanyDossier, 'fromCache' | 'available'>;
      return { ...payload, fromCache: true, available: true };
    } catch { /* corrupt cache: fall through and re-research */ }
  }
  const apiKey = process.env.FIRECRAWL_API_KEY || '';
  if (!apiKey) {
    return { company, overview: '', productsServices: [], techLandscape: [], recentDevelopments: [], sources: [], researchedAt, fromCache: false, available: false, error: 'Firecrawl API key not configured (FIRECRAWL_API_KEY) — company research instructions added to the Skill instead' };
  }
  try {
    // Public queries only: company name + domain words. No resume/PII.
    const q1 = await firecrawlSearch(`${company} company overview products services`, apiKey);
    const q2 = roleDomain
      ? await firecrawlSearch(`${company} ${roleDomain} technology stack engineering`, apiKey)
      : await firecrawlSearch(`${company} technology stack engineering news`, apiKey);
    const all = [...q1, ...q2];
    const sources = all.filter((r) => r.url).slice(0, 8).map((r) => ({ title: r.title || r.url, url: r.url }));
    const text = all.map((r) => `${r.title}\n${r.description || ''}\n${(r.markdown || '').slice(0, 2000)}`).join('\n---\n');
    const dossier: CompanyDossier = {
      company,
      overview: text.slice(0, 2000) || 'No overview found.',
      productsServices: sources.map((s) => s.title).filter(Boolean).slice(0, 5),
      techLandscape: [],
      recentDevelopments: [],
      sources,
      researchedAt,
      fromCache: false,
      available: true,
    };
    const expires = toIso(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    run(
      `INSERT INTO company_dossiers (company_normalized, payload, researched_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(company_normalized) DO UPDATE SET payload = excluded.payload, researched_at = excluded.researched_at, expires_at = excluded.expires_at`,
      normalized, JSON.stringify({ ...dossier, fromCache: false, available: true }), researchedAt, expires,
    );
    return dossier;
  } catch (e) {
    return { company, overview: '', productsServices: [], techLandscape: [], recentDevelopments: [], sources: [], researchedAt, fromCache: false, available: false, error: e instanceof Error ? e.message : 'Firecrawl request failed' };
  }
}

/** Research instructions embedded in the Skill when no dossier is available. */
export function companyResearchInstructions(company: string, title: string): string {
  return [
    `## Company research (do this in Natively before the interview)`,
    `- Research ${company || 'the company'} (${title || 'the role'}) from official sources: the company website, its careers/about pages, and recent press releases.`,
    `- Find: what the company does, its main products/services, its technology stack, and any recent news (funding, launches, hiring).`,
    `- Record the source URL and date for every fact. Do not present unverified claims as facts.`,
  ].join('\n');
}
