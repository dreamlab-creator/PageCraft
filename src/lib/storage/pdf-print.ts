/**
 * Print-to-PDF helper for the screenplay.
 *
 * Renders the screenplay into a clean print-ready HTML document in a
 * hidden iframe, then triggers the browser's native print dialog. The
 * user picks "Save as PDF" from the destination dropdown — every modern
 * browser supports this without any extra dependency.
 *
 * Uses Courier Prime + industry-standard margins:
 *   - 8.5" × 11" pages
 *   - 1.5" left, 1" right
 *   - 1" top, 1" bottom
 *   - 12pt Courier
 *   - Page numbers in the top-right of every page after page 1
 *
 * Title page (optional) gets a dedicated first page with centered title +
 * "Written by" + author, plus optional contact/date footers.
 */

import type { ScreenplayDocument, ScreenplayElementType, ScreenplayElement } from '@/types'

export interface PdfTitlePage {
  title?: string
  credit?: string
  author?: string
  basedOn?: string
  draftLabel?: string
  date?: string
  contactName?: string
  contactBlock?: string  // multi-line contact info
}

const TYPE_CLASS: Record<ScreenplayElementType, string> = {
  scene_heading: 'sh',
  action: 'a',
  character: 'ch',
  dialogue: 'd',
  parenthetical: 'p',
  transition: 't',
  shot: 's',
  general: 'g',
  lyric: 'a',
  cast_list: 'a',
  sfx: 'a',
  act_label: 'al',
  episode_label: 'al',
  centered_text: 'c',
  page_break: 'pb',
  note: 'n',
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function elementHtml(el: ScreenplayElement): string {
  const cls = TYPE_CLASS[el.type] ?? 'a'
  if (el.type === 'page_break') {
    return `<div class="pb"></div>`
  }
  const text = el.type === 'parenthetical'
    ? `(${el.text.replace(/^\(|\)$/g, '')})`
    : el.type === 'centered_text'
      ? el.text.replace(/^>\s*/, '').replace(/\s*<\s*$/, '')
      : el.text
  return `<div class="${cls}">${escapeHtml(text)}</div>`
}

function titlePageHtml(t?: PdfTitlePage): string {
  if (!t) return ''
  const lines: string[] = []
  const title = t.title?.trim()
  const credit = (t.credit || 'Written by').trim()
  const author = t.author?.trim()
  const basedOn = t.basedOn?.trim()
  const draftLabel = t.draftLabel?.trim()
  const date = t.date?.trim()
  const contact = t.contactBlock?.trim() || t.contactName?.trim()

  // Centered block roughly 40% from the top, then "Written by" + name.
  return `
    <section class="title-page">
      <div class="tp-center">
        ${title ? `<div class="tp-title">${escapeHtml(title.toUpperCase())}</div>` : ''}
        ${credit ? `<div class="tp-credit">${escapeHtml(credit)}</div>` : ''}
        ${author ? `<div class="tp-author">${escapeHtml(author)}</div>` : ''}
        ${basedOn ? `<div class="tp-source">${escapeHtml(basedOn)}</div>` : ''}
      </div>
      <div class="tp-footer-row">
        <div class="tp-contact">${contact ? escapeHtml(contact).replace(/\n/g, '<br/>') : ''}</div>
        <div class="tp-date">
          ${draftLabel ? `<div>${escapeHtml(draftLabel)}</div>` : ''}
          ${date ? `<div>${escapeHtml(date)}</div>` : ''}
        </div>
      </div>
    </section>
  `
}

/**
 * Open a print-ready window for the screenplay. The user picks "Save as
 * PDF" in the print dialog to export.
 *
 * Returns true if the print dialog opened, false if the popup was blocked.
 */
export function printScreenplayPdf(opts: {
  doc: ScreenplayDocument
  titlePage?: PdfTitlePage
  documentTitle?: string
}): boolean {
  const body = `
    ${titlePageHtml(opts.titlePage)}
    <section class="script">
      ${opts.doc.elements.map(elementHtml).join('\n')}
    </section>
  `

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(opts.documentTitle || opts.titlePage?.title || 'Screenplay')}</title>
<style>
  @page {
    size: 8.5in 11in;
    margin: 1in 1in 1in 1.5in;
    @top-right { content: counter(page); font-family: 'Courier Prime', 'Courier New', Courier, monospace; font-size: 12pt; }
  }
  /* No page number on title page or first page (industry convention). */
  @page :first { @top-right { content: ''; } }
  html, body { font-family: 'Courier Prime', 'Courier New', Courier, monospace; font-size: 12pt; line-height: 1; color: #000; background: #fff; margin: 0; padding: 0; }

  /* Title page */
  .title-page { page-break-after: always; height: calc(11in - 2in); position: relative; display: flex; flex-direction: column; justify-content: space-between; }
  .tp-center { margin-top: 3in; text-align: center; }
  .tp-title { font-size: 14pt; font-weight: normal; margin-bottom: 1in; letter-spacing: 0.04em; }
  .tp-credit { margin-bottom: 0.25in; }
  .tp-author { }
  .tp-source { margin-top: 0.5in; font-style: italic; }
  .tp-footer-row { display: flex; justify-content: space-between; }
  .tp-contact { white-space: pre-line; }
  .tp-date { text-align: right; }

  /* Script body */
  .script { }
  .sh { text-transform: uppercase; margin-top: 1em; margin-bottom: 0.25em; font-weight: normal; }
  .a  { margin-top: 0.5em; margin-bottom: 0.5em; max-width: 6in; }
  .ch { margin-top: 1em; margin-bottom: 0; margin-left: 2.0in; text-transform: uppercase; }
  .d  { margin-top: 0; margin-bottom: 0.5em; margin-left: 1.0in; margin-right: 1.5in; }
  .p  { margin-top: 0; margin-bottom: 0; margin-left: 1.5in; margin-right: 2.0in; font-style: normal; }
  .t  { text-align: right; text-transform: uppercase; margin-top: 0.5em; margin-bottom: 0.5em; }
  .s  { text-transform: uppercase; margin-top: 0.5em; margin-bottom: 0.25em; }
  .g  { margin-top: 0.5em; margin-bottom: 0.5em; }
  .al { text-align: right; text-transform: uppercase; font-weight: bold; text-decoration: underline; margin: 1em 0; }
  .c  { text-align: center; margin: 0.5em 0; }
  .pb { page-break-before: always; }
  .n  { color: #555; font-style: italic; margin: 0.5em 0; }
</style>
</head>
<body>
${body}
</body>
</html>
`

  // Use a hidden iframe so the dialog inherits the main window.
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const win = frame.contentWindow
  const docu = frame.contentDocument
  if (!win || !docu) {
    document.body.removeChild(frame)
    return false
  }
  docu.open()
  docu.write(html)
  docu.close()
  // Give the iframe a moment to lay out before printing.
  const trigger = () => {
    try {
      win.focus()
      win.print()
    } finally {
      // Defer cleanup; some browsers fire print() asynchronously.
      setTimeout(() => {
        try { document.body.removeChild(frame) } catch { /* noop */ }
      }, 1500)
    }
  }
  if ((docu as any).readyState === 'complete') trigger()
  else win.addEventListener('load', trigger, { once: true })
  return true
}
