/**
 * Ambient module declarations for browser-only third-party libraries
 * that don't ship TypeScript types of their own.
 *
 * Both modules below are lazy-imported from `src/lib/intake/readers.ts`
 * so PageCraft's initial dashboard bundle stays small for writers who
 * never invoke the Master Intake wizard.
 */

declare module 'mammoth/mammoth.browser' {
  export function extractRawText(input: {
    arrayBuffer: ArrayBuffer
  }): Promise<{ value: string; messages: Array<{ message: string }> }>
}

declare module 'pdfjs-dist/build/pdf.worker.mjs?url' {
  const url: string
  export default url
}
