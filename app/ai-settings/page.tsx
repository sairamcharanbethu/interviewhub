'use client';
import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';
import { useApp } from '@/components/context';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Select, Spinner } from '@/components/ui';
import type { AiRoute, AiSettings, AiUsageRow } from '@/lib/types';
import { errMsg, fmtDateTime } from '@/lib/types';

// Canonical task keys from lib/ai/routing.ts (AiTask). Routing is stored as
// { provider, model } per task; an empty model means "that provider's
// configured default model" (the OpenRouter/Ollama model fields above).
const TASKS = [
  { key: 'match', label: 'Matching' },
  { key: 'questions', label: 'Interview questions' },
  { key: 'answers', label: 'Answer drafting' },
  { key: 'skillgen', label: 'Skill generation (Natively)' },
  { key: 'star', label: 'STAR drafts' },
  { key: 'general', label: 'General' },
];
const PROVIDERS = ['ollama', 'openrouter'];

type RouteMap = Record<string, { provider: string; model: string }>;

function toRouteMap(raw: Record<string, AiRoute | string> | null | undefined, fallbackProvider: string): RouteMap {
  const out: RouteMap = {};
  for (const t of TASKS) {
    const v = raw?.[t.key];
    if (typeof v === 'string') out[t.key] = { provider: v, model: '' };
    else if (v && typeof v === 'object') out[t.key] = { provider: v.provider || fallbackProvider, model: v.model || '' };
    else out[t.key] = { provider: fallbackProvider, model: '' };
  }
  return out;
}

/** Model field: a dropdown when the provider's model list loaded, free text otherwise. */
function ModelField({ label, value, onChange, models, loadError, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; models: string[]; loadError: string; placeholder: string;
}) {
  return (
    <Field label={label} hint={models.length ? undefined : loadError || 'Type a model name — the provider model list could not be loaded.'}>
      {models.length ? (
        <Select value={models.includes(value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>{value ? `${value} (not in provider list)` : 'Select a model…'}</option>
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
          {value && !models.includes(value) ? <option value={value}>{value}</option> : null}
        </Select>
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </Field>
  );
}

export default function AiSettingsPage() {
  const { toast } = useApp();
  const [s, setS] = useState<AiSettings | null>(null);
  const [usage, setUsage] = useState<AiUsageRow[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [usageCount, setUsageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [openrouterModel, setOpenrouterModel] = useState('');
  const [ollamaBase, setOllamaBase] = useState('');
  const [ollamaModel, setOllamaModel] = useState('');
  const [defaultProvider, setDefaultProvider] = useState('ollama');
  const [fallbackModel, setFallbackModel] = useState('');
  const [routing, setRouting] = useState<RouteMap>({});
  const [openrouterModels, setOpenrouterModels] = useState<string[]>([]);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [openrouterModelsError, setOpenrouterModelsError] = useState('');
  const [ollamaModelsError, setOllamaModelsError] = useState('');
  const [testResult, setTestResult] = useState<{ provider: string; ok: boolean; detail: string; models?: string[] } | null>(null);
  const [testing, setTesting] = useState('');

  const loadModels = async () => {
    // Graceful failure: a provider being unreachable must not block the page.
    // The model fields stay free-text inputs in that case.
    for (const provider of ['openrouter', 'ollama'] as const) {
      try {
        const r = await apiGet<{ ok: boolean; models: string[]; detail?: string }>(`/api/ai-settings/models?provider=${provider}`);
        if (r.ok) {
          if (provider === 'openrouter') { setOpenrouterModels(r.models); setOpenrouterModelsError(''); }
          else { setOllamaModels(r.models); setOllamaModelsError(''); }
        } else {
          const msg = r.detail || `${provider} unreachable`;
          if (provider === 'openrouter') setOpenrouterModelsError(msg);
          else setOllamaModelsError(msg);
        }
      } catch (e) {
        if (provider === 'openrouter') setOpenrouterModelsError(errMsg(e));
        else setOllamaModelsError(errMsg(e));
      }
    }
  };

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [a, u] = await Promise.all([
        apiGet<{ ai_settings: AiSettings }>('/api/ai-settings'),
        apiGet<{ usage: AiUsageRow[]; total_cost_usd: number; count: number }>('/api/ai-settings/usage?limit=50'),
      ]);
      setS(a.ai_settings);
      setOpenrouterModel(a.ai_settings.openrouter_model || '');
      setOllamaBase(a.ai_settings.ollama_base_url || '');
      setOllamaModel(a.ai_settings.ollama_model || '');
      setDefaultProvider(a.ai_settings.default_provider || 'ollama');
      setFallbackModel(a.ai_settings.fallback_model || '');
      setRouting(toRouteMap(a.ai_settings.routing, a.ai_settings.default_provider || 'ollama'));
      setUsage(u.usage); setTotalCost(u.total_cost_usd); setUsageCount(u.count);
      void loadModels();
    } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        openrouter_model: openrouterModel, ollama_base_url: ollamaBase, ollama_model: ollamaModel,
        default_provider: defaultProvider, routing, fallback_model: fallbackModel || null,
      };
      if (clearKey) body.openrouter_key = '';
      else if (keyInput.trim()) body.openrouter_key = keyInput.trim();
      const r = await apiPost<{ ai_settings: AiSettings }>('/api/ai-settings', body);
      setS(r.ai_settings); setKeyInput(''); setClearKey(false);
      setRouting(toRouteMap(r.ai_settings.routing, r.ai_settings.default_provider || 'ollama'));
      toast('AI settings saved');
    } catch (e) { toast(errMsg(e), 'err'); } finally { setSaving(false); }
  };
  const test = async (provider: 'openrouter' | 'ollama') => {
    setTesting(provider); setTestResult(null);
    try {
      const r = await apiPost<{ provider: string; ok: boolean; detail: string; models?: string[] }>('/api/ai-settings/test', { provider });
      setTestResult(r);
    } catch (e) { setTestResult({ provider, ok: false, detail: errMsg(e) }); } finally { setTesting(''); }
  };

  if (loading) return <Spinner label="Loading AI settings…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;
  if (!s) return <EmptyState title="AI settings unavailable" />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">AI Settings</h1>
      <Card>
        <h2 className="font-semibold">Providers</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="OpenRouter API key" hint={s.has_openrouter_key ? `Key saved — ends …${s.openrouter_key_last4 || '????'}. Leave blank to keep it; a new value replaces it.` : 'No key saved yet.'}>
            <Input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder={s.has_openrouter_key ? '•••••••• (saved)' : 'sk-or-…'} autoComplete="off" />
          </Field>
          <ModelField label="OpenRouter model" value={openrouterModel} onChange={setOpenrouterModel} models={openrouterModels} loadError={openrouterModelsError} placeholder="deepseek/deepseek-v4.1-flash" />
          <Field label="Ollama base URL"><Input type="url" value={ollamaBase} onChange={(e) => setOllamaBase(e.target.value)} placeholder="http://localhost:11434" /></Field>
          <ModelField label="Ollama model" value={ollamaModel} onChange={setOllamaModel} models={ollamaModels} loadError={ollamaModelsError} placeholder="llama3.1" />
          <Field label="Default provider">
            <Select value={defaultProvider} onChange={(e) => setDefaultProvider(e.target.value)}>
              <option value="ollama">Ollama (local)</option>
              <option value="openrouter">OpenRouter (cloud)</option>
            </Select>
          </Field>
          <Field label="Fallback model" hint="Used when the primary model fails (optional)."><Input value={fallbackModel} onChange={(e) => setFallbackModel(e.target.value)} placeholder="e.g. llama3.1" /></Field>
        </div>
        <label className="mt-3 flex items-center gap-1.5 text-sm"><input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} /> Clear the saved OpenRouter key on save</label>
        {s.secret_storage && (
          <p className="mt-3 text-xs text-gray-500">
            Key storage: <span className="font-medium text-gray-700">{s.secret_storage === 'env' ? 'environment variable (INTERVIEWHUB_SECRET)' : s.secret_storage === 'keychain' ? 'macOS Keychain' : s.secret_storage === 'file' ? 'encrypted local file (data/.secret-key)' : 'none configured'}</span>
            {s.secret_storage_has_key ? ' — a key is stored.' : ' — no key stored.'}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
          <Button variant="secondary" onClick={() => test('ollama')} disabled={!!testing}>{testing === 'ollama' ? 'Testing…' : 'Test Ollama connection'}</Button>
          <Button variant="secondary" onClick={() => test('openrouter')} disabled={!!testing}>{testing === 'openrouter' ? 'Testing…' : 'Test OpenRouter connection'}</Button>
          <Button variant="secondary" onClick={() => void loadModels()}>Refresh model lists</Button>
        </div>
        {testResult ? (
          <p className={`mt-3 rounded p-3 text-sm ${testResult.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`} role="status">
            <strong>{testResult.provider}: {testResult.ok ? 'OK' : 'Failed'}</strong> — {testResult.detail}
            {testResult.models?.length ? <span className="block text-xs">Models: {testResult.models.join(', ')}</span> : null}
          </p>
        ) : null}
      </Card>

      <Card>
        <h2 className="font-semibold">Per-task routing</h2>
        <p className="mt-1 text-sm text-gray-500">Which provider and model handles each task. Leave the model blank to use that provider&apos;s default model above. Saved as {'{provider, model}'} per task; older provider-name-only rows are read and re-saved in the same form.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {TASKS.map((t) => {
            const r = routing[t.key] || { provider: defaultProvider, model: '' };
            const list = r.provider === 'openrouter' ? openrouterModels : ollamaModels;
            return (
              <div key={t.key} className="rounded border border-gray-200 p-3">
                <p className="text-sm font-medium">{t.label}</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Field label="Provider">
                    <Select value={r.provider} onChange={(e) => setRouting({ ...routing, [t.key]: { provider: e.target.value, model: r.model } })}>
                      {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  </Field>
                  <Field label="Model (blank = default)">
                    <Input
                      value={r.model}
                      list={`models-${t.key}`}
                      placeholder={r.provider === 'openrouter' ? openrouterModel || 'provider default' : ollamaModel || 'provider default'}
                      onChange={(e) => setRouting({ ...routing, [t.key]: { provider: r.provider, model: e.target.value } })}
                    />
                    <datalist id={`models-${t.key}`}>{list.map((m) => <option key={m} value={m} />)}</datalist>
                  </Field>
                </div>
              </div>
            );
          })}
        </div>
        <Button className="mt-3" variant="secondary" onClick={save} disabled={saving}>Save routing</Button>
      </Card>

      <Card>
        <h2 className="font-semibold">Usage</h2>
        <p className="mt-1 text-sm text-gray-600">{usageCount} calls recorded · Total cost ${totalCost.toFixed(4)} USD</p>
        {usage.length === 0 ? <p className="mt-3 text-sm text-gray-500">No AI usage recorded yet — calls are logged when a provider chat runs.</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left"><th className="py-2 pr-2">When</th><th className="py-2 pr-2">Provider</th><th className="py-2 pr-2">Model</th><th className="py-2 pr-2">Task</th><th className="py-2 pr-2">Tokens in/out</th><th className="py-2">Cost</th></tr></thead>
              <tbody>
                {usage.map((u) => (
                  <tr key={u.id} className="border-b">
                    <td className="py-2 pr-2">{fmtDateTime(u.created_at)}</td>
                    <td className="py-2 pr-2"><Badge tone="gray">{u.provider || '—'}</Badge></td>
                    <td className="py-2 pr-2">{u.model || '—'}</td>
                    <td className="py-2 pr-2">{u.task || '—'}</td>
                    <td className="py-2 pr-2">{u.tokens_in ?? 0} / {u.tokens_out ?? 0}</td>
                    <td className="py-2">${(u.cost_usd ?? 0).toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
