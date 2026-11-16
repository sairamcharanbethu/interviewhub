import { run, newId } from '../db';

// USD per 1M tokens [input, output]. llama3.1 local = 0.
export const COST_TABLE: Record<string, [number, number]> = {
  'deepseek/deepseek-v4.1-flash': [0.10, 0.40],
  'gpt-4o-mini': [0.15, 0.60],
  'llama3.1': [0, 0],
};

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const [pin, pout] = COST_TABLE[model] ?? [0, 0];
  return (tokensIn * pin + tokensOut * pout) / 1_000_000;
}

export function recordUsage(provider: string, model: string, task: string, tokensIn: number, tokensOut: number): void {
  const cost = estimateCost(model, tokensIn, tokensOut);
  run(
    `INSERT INTO ai_usage (id, provider, model, task, tokens_in, tokens_out, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    newId('usage_'), provider, model, task, tokensIn, tokensOut, cost,
  );
}
