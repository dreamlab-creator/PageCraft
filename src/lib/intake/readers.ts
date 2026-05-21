/**
 * Source-material file readers for the Master Intake wizard.
 *
 * The intake wizard accepts a heterogeneous pile of writer-supplied
 * artifacts (a finished screenplay, a show bible, a pitch deck, a few
 * pages of notes) and turns each one into a normalized text representation
 * the AI can read.
 *
 * Plain text formats are read directly. PDF and DOCX are read with their
 * standard browser libraries, lazy-imported so the dashboard bundle stays
 * small for users who never invoke intake. Image-only PDFs (scanned
 * scripts) yield no text — we surface that as a warning, not a hard
 * failure, so the writer can decide whether to paste the content in or
 * proceed with whatever else they uploaded.
 *
 * Every file we read goes through `IntakeMaterial.text` as a single
 * normalized string. Page-count estimates are reported when available so
 * the wizard can show meaningful progress ("Reading screenplay.pdf —
 * page 47 of 105").
 */

import type { ReferenceFormat } from '@/types/reference'

export interface IntakeMaterial {
  /** Display filename. */
  filename: string
  /** MIME-ish detector for downstream UI / persistence. */
  format: ReferenceFormat
  /** Normalized plaintext extracted from the source. */
  text: string
  /** Best-effort byte size of the original file. */
  size: number
  /** Best-effort page count, when the source supports the notion. */
  pageCount?: number
  /** Warning surfaced to the user, e.g. "scanned PDF — no extractable text". */
  warning?: string
}

/**
 * Classify a file's format from its name / extension. Defensive — we
 * accept anything the user gives us; downstream code copes with empty
 * text by surfacing a warning.
 */
export function classifyFormat(filename: string): ReferenceFormat {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx')) return 'docx'
  if (lower.endsWith('.fountain') || lower.endsWith('.spmd')) return 'fountain'
  if (lower.endsWith('.fdx')) return 'fdx'
  if (lower.endsWith('.json') || lower.endsWith('.pagecraft')) return 'json'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md'
  if (lower.endsWith('.txt')) return 'txt'
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp')) return 'image'
  return 'other'
}

/** Read a single File (from <input type="file">) and normalize it. */
export async function readMaterial(file: File): Promise<IntakeMaterial> {
  const format = classifyFormat(file.name)
  const baseMeta = { filename: file.name, format, size: file.size }
  try {
    if (format === 'pdf') return { ...baseMeta, ...(await readPdf(file)) }
    if (format === 'docx') return { ...baseMeta, ...(await readDocx(file)) }
    if (format === 'image') {
      return { ...baseMeta, text: '', warning: 'Image files are stored as references but no text was extracted.' }
    }
    const text = await file.text()
    return { ...baseMeta, text }
  } catch (e) {
    return {
      ...baseMeta,
      text: '',
      warning: `Could not read "${file.name}": ${(e as Error).message ?? 'unknown error'}`,
    }
  }
}

/** Read every File the user dropped on / selected through the picker. */
export async function readMaterials(files: File[]): Promise<IntakeMaterial[]> {
  const out: IntakeMaterial[] = []
  for (const f of files) {
    out.push(await readMaterial(f))
  }
  return out
}

/* ============================================================================
 * Format-specific readers — lazy imports keep the initial bundle lean.
 * ========================================================================= */

/**
 * Lazy PDF reader. pdfjs-dist v5 ships ESM modules and a separate worker
 * blob that has to be wired up before `getDocument` is called. We import
 * both the main library and the worker URL on demand so the dashboard
 * bundle stays small.
 *
 * Notes on what was going wrong before:
 *   - pdfjs expects a `Uint8Array` (or a URL), NOT a raw `ArrayBuffer`.
 *     Passing the ArrayBuffer directly causes the worker to choke on a
 *     stream interop call with the Safari-style error
 *     `undefined is not a function (near '...value of readableStream...')`.
 *   - The worker URL MUST be set before any `getDocument` call. We set it
 *     right after import and before the first call.
 *   - In environments where the worker can't load (CSP, sandbox iframe,
 *     odd browser quirks), pdfjs falls back to a "fake worker" path that
 *     also fails on the same stream-iteration code path. We catch that
 *     class of error and retry with the worker explicitly disabled —
 *     slower (everything runs on the main thread) but reliable.
 */
let workerInitialized = false
async function initPdfWorker(): Promise<typeof import('pdfjs-dist')> {
  const pdfjs = await import('pdfjs-dist')
  if (!workerInitialized) {
    try {
      const workerModule = await import('pdfjs-dist/build/pdf.worker.mjs?url')
      pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default
    } catch (e) {
      // Worker URL import itself failed — leave workerSrc empty and let
      // the "disable worker" branch below handle it.
      // eslint-disable-next-line no-console
      console.warn('[PageCraft intake] PDF worker URL import failed:', e)
    }
    workerInitialized = true
  }
  return pdfjs
}

async function readPdf(file: File): Promise<{ text: string; pageCount?: number; warning?: string }> {
  const pdfjs = await initPdfWorker()
  // pdfjs v5 wants a Uint8Array — ArrayBuffer trips a stream interop bug.
  const data = new Uint8Array(await file.arrayBuffer())

  // First attempt: worker mode (fast). On certain stream-related failures
  // we retry in main-thread mode below.
  try {
    return await extractPdfText(pdfjs, data)
  } catch (e) {
    const msg = (e as Error)?.message ?? ''
    const looksLikeWorkerFailure =
      /readableStream/i.test(msg) ||
      /undefined is not a function/i.test(msg) ||
      /not a constructor/i.test(msg) ||
      /failed to fetch/i.test(msg) ||
      /import.*pdf\.worker/i.test(msg)

    if (!looksLikeWorkerFailure) throw e

    // eslint-disable-next-line no-console
    console.warn('[PageCraft intake] PDF worker path failed, retrying in main-thread mode:', msg)
    return extractPdfText(pdfjs, data, { disableWorker: true })
  }
}

async function extractPdfText(
  pdfjs: typeof import('pdfjs-dist'),
  data: Uint8Array,
  opts: { disableWorker?: boolean } = {},
): Promise<{ text: string; pageCount?: number; warning?: string }> {
  // `disableWorker: true` forces pdfjs to run inside the page thread —
  // slower for huge PDFs but unaffected by worker / streams interop bugs.
  const loadingTask = pdfjs.getDocument({
    data,
    ...(opts.disableWorker ? { disableWorker: true } : {}),
  } as Parameters<typeof pdfjs.getDocument>[0])
  const doc = await loadingTask.promise

  const chunks: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i)
      const tc = await page.getTextContent()
      // pdfjs returns a heterogeneous items array (text + marked-content
      // boundaries). Only the text items carry a `str` field.
      const pageText = (tc.items as Array<{ str?: string }>)
        .map(it => (typeof it.str === 'string' ? it.str : ''))
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
      if (pageText) chunks.push(pageText)
    } catch (pageErr) {
      // Don't kill the whole read because one page is corrupt — note and skip.
      // eslint-disable-next-line no-console
      console.warn(`[PageCraft intake] PDF page ${i} read failed:`, pageErr)
    }
  }
  try { await doc.destroy() } catch { /* best-effort */ }

  const text = chunks.join('\n\n').trim()
  if (!text) {
    return {
      text: '',
      pageCount: doc.numPages,
      warning: 'PDF appears to contain images / scanned pages; no text was extractable. Paste the script\'s text manually if you want the AI to read it.',
    }
  }
  return { text, pageCount: doc.numPages }
}

async function readDocx(file: File): Promise<{ text: string; warning?: string }> {
  // mammoth ships a browser entry point as plain JS — we import via the
  // path-with-suffix and cast through unknown so TS doesn't demand types.
  const mammothModule = (await import(/* @vite-ignore */ 'mammoth/mammoth.browser')) as unknown as {
    extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string; messages: Array<{ message: string }> }>
  }
  const buf = await file.arrayBuffer()
  // mammoth's `extractRawText` returns plain text without losing
  // paragraph breaks, which is what the AI wants — formatting is
  // already encoded in the surrounding context.
  const result = await mammothModule.extractRawText({ arrayBuffer: buf })
  return { text: result.value }
}

/* ============================================================================
 * Utilities the wizard / AI tasks share
 * ========================================================================= */

/** Truncate text for prompt embedding without breaking mid-word. */
export function truncateForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  // Stop at a paragraph break if one is close to the cut; otherwise at
  // the nearest sentence; otherwise mid-cut.
  const lastBlank = cut.lastIndexOf('\n\n')
  if (lastBlank > maxChars * 0.7) return cut.slice(0, lastBlank) + '\n\n[…truncated]'
  const lastPeriod = cut.lastIndexOf('. ')
  if (lastPeriod > maxChars * 0.85) return cut.slice(0, lastPeriod + 1) + ' […truncated]'
  return cut + ' […truncated]'
}

/* ============================================================================
 * Chunking — for the multi-pass ingest pipeline.
 * ========================================================================= */

export interface SourceChunk {
  /** Source filename this chunk came from. */
  filename: string
  /** Source format. */
  format: ReferenceFormat
  /** 0-based position of this chunk inside its file. */
  index: number
  /** Total chunks for this file. */
  total: number
  /** The chunk's text. */
  text: string
  /** Best-effort page span ("p. 1–15"), for progress display only. */
  pageHint?: string
}

/**
 * Split a single material into roughly-equal chunks, each capped at
 * `maxChars`. Chunks are cut at paragraph boundaries when possible so a
 * scene doesn't get split mid-sentence; otherwise at the nearest blank
 * line, otherwise at the cap.
 *
 * The intake pipeline runs one `ingestSourceChunk` AI call per chunk —
 * keeping individual calls fast and visible in the progress bar.
 */
export function chunkMaterial(material: IntakeMaterial, maxChars: number): SourceChunk[] {
  const text = material.text.trim()
  if (!text) return []

  if (text.length <= maxChars) {
    return [{
      filename: material.filename,
      format: material.format,
      index: 0,
      total: 1,
      text,
      pageHint: material.pageCount ? `p. 1–${material.pageCount}` : undefined,
    }]
  }

  const chunks: SourceChunk[] = []
  let cursor = 0
  while (cursor < text.length) {
    const remaining = text.length - cursor
    if (remaining <= maxChars) {
      chunks.push({ filename: material.filename, format: material.format, index: chunks.length, total: 0, text: text.slice(cursor).trim() })
      break
    }
    // Look for a paragraph break in the last 20% of the window.
    const window = text.slice(cursor, cursor + maxChars)
    const minSplit = Math.floor(maxChars * 0.8)
    let splitAt = window.lastIndexOf('\n\n', maxChars)
    if (splitAt < minSplit) splitAt = window.lastIndexOf('. ', maxChars)
    if (splitAt < minSplit) splitAt = maxChars
    const piece = text.slice(cursor, cursor + splitAt).trim()
    if (piece) chunks.push({ filename: material.filename, format: material.format, index: chunks.length, total: 0, text: piece })
    cursor += splitAt
  }
  // Fix up total now that we know the count.
  const total = chunks.length
  // Estimate a page span per chunk if the source has a page count.
  if (material.pageCount && material.pageCount > 1) {
    const perChunk = material.pageCount / total
    chunks.forEach((c, i) => {
      const start = Math.max(1, Math.round(i * perChunk + 1))
      const end = Math.min(material.pageCount!, Math.round((i + 1) * perChunk))
      c.pageHint = start === end ? `p. ${start}` : `p. ${start}–${end}`
    })
  }
  chunks.forEach(c => { c.total = total })
  return chunks
}

/** Convenience: chunk every material in a batch. */
export function chunkMaterials(materials: IntakeMaterial[], maxChars: number): SourceChunk[] {
  const out: SourceChunk[] = []
  for (const m of materials) out.push(...chunkMaterial(m, maxChars))
  return out
}

/**
 * Compose a single combined excerpt block from a set of materials —
 * used by the intake AI tasks so they can read everything in one call.
 * Each material gets a labeled header so the model knows where one
 * source ends and the next begins.
 *
 * `perFileChars` caps individual files; `totalChars` caps the whole
 * block. The result is a tagged transcript suitable for direct prompt
 * embedding.
 */
export function composeIntakeExcerpt(
  materials: IntakeMaterial[],
  opts: { perFileChars?: number; totalChars?: number } = {},
): string {
  const perFile = opts.perFileChars ?? 18000
  const total = opts.totalChars ?? 60000
  const out: string[] = []
  let used = 0
  for (const m of materials) {
    if (used >= total) {
      out.push(`\n[…${materials.length - out.length} additional file(s) omitted to stay within prompt budget…]`)
      break
    }
    const remaining = total - used
    const limit = Math.min(perFile, remaining)
    const body = m.text.trim()
      ? truncateForPrompt(m.text, limit)
      : `(no extractable text${m.warning ? ' — ' + m.warning : ''})`
    const header = `>>> SOURCE FILE: ${m.filename} [${m.format}${m.pageCount ? `, ${m.pageCount} pages` : ''}]`
    out.push(`${header}\n${body}\n<<< END ${m.filename}`)
    used += body.length + header.length + 32
  }
  return out.join('\n\n')
}
