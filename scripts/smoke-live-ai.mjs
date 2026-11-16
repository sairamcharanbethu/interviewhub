// Live AI smoke check for InterviewHub — no dependencies, Node 20+ only.
//
// Usage:
//   node scripts/smoke-live-ai.mjs            -> always SKIPs (exit 0)
//   node scripts/smoke-live-ai.mjs --live     -> runs live checks IF a
//     provider is configured (OPENROUTER_API_KEY or OLLAMA_BASE_URL set).
//     Without credentials it SKIPs (exit 0) — mocked tests cover behaviour.
//
// With --live it makes one tiny chat call per configured provider and prints
// latency, model and token counts. API keys are NEVER printed. A failed live
// call exits 1.
const live = process.argv.includes('--live');
const openRouterKey = process.env.OPENROUTER_API_KEY || '';
const ollamaBase = (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '');
const openRouterModel = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4.1-flash';
const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.1';

const PROMPT = [{ role: 'user', content: 'Reply with the single word: ok' }];

async function timed(label, fn) {
  const started = Date.now();
  const result = await fn();
  return { label, ms: Date.now() - started, ...result };
}

async function openRouterCheck() {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openRouterKey}`,
      'HTTP-Referer': 'https://interviewhub.local',
      'X-Title': 'InterviewHub smoke',
    },
    body: JSON.stringify({ model: openRouterModel, messages: PROMPT }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
  const data = await res.json();
  return {
    model: openRouterModel,
    text: (data.choices?.[0]?.message?.content ?? '').trim().slice(0, 80),
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
  };
}

async function ollamaCheck() {
  const res = await fetch(`${ollamaBase}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ollamaModel, messages: PROMPT, stream: false }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const data = await res.json();
  return {
    model: ollamaModel,
    text: (data.message?.content ?? '').trim().slice(0, 80),
    tokensIn: data.prompt_eval_count ?? 0,
    tokensOut: data.eval_count ?? 0,
  };
}

async function main() {
  if (!live || (!openRouterKey && !ollamaBase)) {
    console.log('SKIPPED: no live credentials configured (mocked tests cover behaviour)');
    return 0;
  }
  const checks = [];
  if (openRouterKey) checks.push({ name: 'openrouter', fn: openRouterCheck });
  if (ollamaBase) checks.push({ name: 'ollama', fn: ollamaCheck });
  let failed = false;
  for (const { name, fn } of checks) {
    try {
      const r = await timed(name, fn);
      console.log(
        `${r.label}: OK model=${r.model} latency=${r.ms}ms tokens_in=${r.tokensIn} tokens_out=${r.tokensOut} reply=${JSON.stringify(r.text)}`,
      );
    } catch (e) {
      // Never print credentials or request bodies — only the failure.
      console.error(`${name} live check FAILED: ${e instanceof Error ? e.message : String(e)}`);
      failed = true;
    }
  }
  return failed ? 1 : 0;
}

process.exitCode = await main();
