export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { get, run, transaction } from '@/lib/db';
import { handleError, notFound } from '@/lib/errors';
import { deleteStoredFile } from '@/lib/files';
import { serializeResume } from '@/lib/serialize';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const row = get<Record<string, unknown>>(`SELECT * FROM resumes WHERE id = ?`, params.id);
    if (!row) throw notFound('Resume not found');
    return NextResponse.json({ resume: serializeResume(row) });
  } catch (e) { return handleError(e); }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const row = get<Record<string, unknown>>(`SELECT * FROM resumes WHERE id = ?`, params.id);
    if (!row) throw notFound('Resume not found');
    const storedPath = row.stored_path as string;
    transaction(() => {
      run(`DELETE FROM document_chunks_fts WHERE rowid IN (SELECT rowid FROM document_chunks WHERE resume_id = ?)`, params.id);
      run(`DELETE FROM document_chunks WHERE resume_id = ?`, params.id);
      run(`DELETE FROM resumes WHERE id = ?`, params.id);
    });
    deleteStoredFile(storedPath);
    return NextResponse.json({ deleted: true });
  } catch (e) { return handleError(e); }
}
