// Tiny fetch wrapper: parses JSON, surfaces the API's {error} / {details} bodies.
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(init?.headers || {}) } });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON (e.g. markdown download) */ }
  if (!res.ok) {
    const d = data as { error?: string; details?: Array<{ path: string; message: string }> } | null;
    const detail = d?.details?.map((x) => `${x.path}: ${x.message}`).join('; ');
    throw new Error(d?.error ? (detail ? `${d.error} — ${detail}` : d.error) : `Request failed (${res.status})`);
  }
  return data as T;
}
export const apiGet = <T,>(url: string) => api<T>(url);
export const apiPost = <T,>(url: string, body?: unknown) =>
  api<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const apiPatch = <T,>(url: string, body: unknown) =>
  api<T>(url, { method: 'PATCH', body: JSON.stringify(body) });
export const apiDelete = <T,>(url: string) => api<T>(url, { method: 'DELETE' });
