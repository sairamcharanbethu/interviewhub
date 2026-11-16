declare module 'pdf-parse' {
  const pdf: (data: Buffer, options?: Record<string, unknown>) => Promise<{ text: string; numpages: number; info: unknown }>;
  export default pdf;
}
