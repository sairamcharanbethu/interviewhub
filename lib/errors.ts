import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function handleError(err: unknown): NextResponse {
  if (err instanceof ApiError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof ZodError) return NextResponse.json({ error: 'Validation failed', details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })) }, { status: 400 });
  console.error(err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export function notFound(what = 'Not found'): ApiError { return new ApiError(404, what); }
export function badRequest(msg: string): ApiError { return new ApiError(400, msg); }

export async function parseJsonBody<T>(req: Request, schema: { parse: (v: unknown) => T }): Promise<T> {
  let body: unknown;
  try { body = await req.json(); } catch { throw badRequest('Invalid JSON body'); }
  return schema.parse(body);
}
