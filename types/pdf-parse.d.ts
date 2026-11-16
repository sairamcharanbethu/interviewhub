declare module 'pdf-parse' {
  const pdf: (data: Buffer, options?: Record<string, unknown>) => Promise<{ text: string; numpages: number; info: unknown }>;
  export default pdf;
}

// Direct entry to the implementation file. pdf-parse's package entry
// (index.js) runs a debug self-test at load when required without a
// CommonJS parent (`!module.parent`), which fires under vitest and reads a
// test fixture relative to the cwd. Importing lib/pdf-parse.js skips that
// side effect; it is the same function.
declare module 'pdf-parse/lib/pdf-parse.js' {
  const pdf: (data: Buffer, options?: Record<string, unknown>) => Promise<{ text: string; numpages: number; info: unknown }>;
  export default pdf;
}
