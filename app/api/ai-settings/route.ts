export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run } from '@/lib/db';
import { aiSettingsSchema } from '@/lib/validation';
import { normalizeRoutingInput } from '@/lib/ai/routing';
import { handleError, parseJsonBody, ApiError } from '@/lib/errors';
import { maskKey } from '@/lib/security';
import { getAiSettings, getSecretStorageInfo } from '@/lib/ai/providers';
import { getProviderPriority, setProviderPriority, getProviderStatuses, type ProviderId } from '@/lib/ai/registry';
import { encryptSecret, keychainAvailable, keychainDelete, keychainSet } from '@/lib/secrets';

async function publicSettings(row: Record<string, unknown>) {
  // Mask against the *effective* key (decrypted DB value / Keychain / env),
  // never the raw stored column — the response carries only has_key + last4.
  const effectiveKey = getAiSettings().openrouter_key;
  const { has_key, last4 } = maskKey(effectiveKey);
  const storageInfo = getSecretStorageInfo();
  // Normalise routing to the canonical {provider, model} form on read, so
  // legacy string-form rows (stored before the reconciliation) round-trip.
  let routing: Record<string, { provider: string; model: string }> | null = null;
  if (row.routing) {
    try { routing = normalizeRoutingInput(JSON.parse(row.routing as string)); } catch { routing = null; }
  }
  return {
    id: 1,
    openrouter_model: row.openrouter_model,
    ollama_base_url: row.ollama_base_url,
    ollama_model: row.ollama_model,
    default_provider: row.default_provider,
    routing,
    fallback_model: row.fallback_model,
    redact_pii: row.redact_pii === 1,
    has_openrouter_key: has_key,
    openrouter_key_last4: last4,
    provider_priority: getProviderPriority(),
    providers: await getProviderStatuses(),
    // Which store the encryption key / OpenRouter key currently lives in
    // ('env' = INTERVIEWHUB_SECRET, 'keychain' = macOS Keychain,
    // 'file' = data/.secret-key). Shown on the Settings page.
    secret_storage: storageInfo.storage,
    secret_storage_has_key: storageInfo.has_key,
  };
}

export async function GET() {
  try {
    const row = get<Record<string, unknown>>(`SELECT * FROM ai_settings WHERE id = 1`)!;
    return NextResponse.json({ ai_settings: await publicSettings(row) });
  } catch (e) { return handleError(e); }
}

export async function POST(req: Request) {
  try {
    const body = await parseJsonBody(req, aiSettingsSchema);
    const cur = get<Record<string, unknown>>(`SELECT * FROM ai_settings WHERE id = 1`)!;
    // OpenRouter key handling:
    // - non-empty string: store encrypted (AES-256-GCM, lib/secrets.ts), or
    //   in the macOS Keychain when INTERVIEWHUB_USE_KEYCHAIN=1 and the
    //   Keychain is available (default is the file-encrypted DB store; the
    //   Keychain keeps the key out of the DB/backup entirely, but only works
    //   on the Mac running the server). DB column is NULL in Keychain mode.
    // - '' (explicitly sent): delete the stored key (DB + Keychain).
    // - undefined: keep the current stored value.
    let key: string | null;
    if (body.openrouter_key !== undefined && body.openrouter_key !== null && body.openrouter_key !== '') {
      const useKeychain = process.env.INTERVIEWHUB_USE_KEYCHAIN === '1' && keychainAvailable();
      if (useKeychain) {
        if (!keychainSet(body.openrouter_key)) {
          throw new ApiError(500, 'Could not store the key in the macOS Keychain');
        }
        key = null;
      } else {
        // A DB-stored key supersedes any stale Keychain entry.
        keychainDelete();
        try {
          key = encryptSecret(body.openrouter_key);
        } catch (e) {
          throw new ApiError(400, e instanceof Error ? e.message : 'Could not encrypt the API key');
        }
      }
    } else if (body.openrouter_key === '' || body.openrouter_key === null) {
      // '' (or explicit null, as before) deletes the stored key (DB + Keychain).
      keychainDelete();
      key = null;
    } else {
      key = cur.openrouter_key as string | null;
    }
    if (body.provider_priority !== undefined && Array.isArray(body.provider_priority)) {
      try { setProviderPriority(body.provider_priority as ProviderId[]); } catch { /* invalid priority ignored */ }
    }
    run(
      `UPDATE ai_settings SET openrouter_key = ?, openrouter_model = ?, ollama_base_url = ?, ollama_model = ?, default_provider = ?, routing = ?, fallback_model = ?, redact_pii = ? WHERE id = 1`,
      key,
      body.openrouter_model ?? cur.openrouter_model,
      body.ollama_base_url ?? cur.ollama_base_url,
      body.ollama_model ?? cur.ollama_model,
      body.default_provider ?? cur.default_provider,
      // Store the canonical {provider, model} form; legacy string values
      // ("ollama"/"openrouter") are accepted by the schema and normalised here.
      body.routing !== undefined ? JSON.stringify(normalizeRoutingInput(body.routing ?? null)) : cur.routing,
      body.fallback_model !== undefined ? (body.fallback_model ?? null) : cur.fallback_model,
      body.redact_pii !== undefined && body.redact_pii !== null ? (body.redact_pii ? 1 : 0) : (cur.redact_pii ?? 0),
    );
    const row = get<Record<string, unknown>>(`SELECT * FROM ai_settings WHERE id = 1`)!;
    return NextResponse.json({ ai_settings: await publicSettings(row) });
  } catch (e) { return handleError(e); }
}
