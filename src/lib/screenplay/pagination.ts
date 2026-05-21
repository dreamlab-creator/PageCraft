/**
 * Pagination engine. Approximates real screenplay page counting based on the
 * standard Courier Prime 12pt geometry. Used by the editor's live status bar
 * and the page-view rendering.
 *
 * This is approximation, not pixel-perfect rendering. A full layout engine
 * is post-MVP. For day-one we estimate:
 *
 *   - lines per page based on top/bottom margin and 12pt leading (≈ 55-58 lines)
 *   - chars per line per element based on the standard indents
 *
 * Industry-standard values are baked in for Courier 12pt (10 cpi, 6 lpi).
 */

import type { ScreenplayDocument, ScreenplayElement, FormatConfig } from '@/types'

interface Geometry {
  linesPerPage: number
  charsPerLine: {
    action: number
    dialogue: number
    parenthetical: number
    character: number
    transition: number
    scene_heading: number
    shot: number
    centered_text: number
    default: number
  }
  /** Multi-cam: dialogue uses double-spacing (so 1 line of dialogue = 2 visual lines). */
  dialogueLineMultiplier: number
}

function deriveGeometry(format: FormatConfig): Geometry {
  const ind = format.page.elementIndents
  // 10 chars per inch, page width 8.5". Available width per element is:
  //    width - (indentLeft + indentRight)
  const cpi = 10
  const pageWidth = format.page.width
  const cpl = (left: number, right: number) =>
    Math.max(10, Math.floor((pageWidth - left - right) * cpi))

  // Lines per page: page height - margins. 6 lpi. Final Draft averages ≈ 55.
  const usable = format.page.height - format.page.marginTop - format.page.marginBottom
  const linesPerPage = Math.floor(usable * 6)

  return {
    linesPerPage,
    charsPerLine: {
      action: cpl(ind.action.left, ind.action.right),
      dialogue: cpl(ind.dialogue.left, ind.dialogue.right),
      parenthetical: cpl(ind.parenthetical.left, ind.parenthetical.right),
      character: cpl(ind.character.left, ind.character.right),
      transition: cpl(ind.transition.left, ind.transition.right),
      scene_heading: cpl(ind.action.left, ind.action.right),
      shot: cpl(ind.action.left, ind.action.right),
      centered_text: cpl(ind.action.left, ind.action.right),
      default: cpl(ind.action.left, ind.action.right),
    },
    dialogueLineMultiplier: format.page.dialogueLineSpacing,
  }
}

/** Returns the number of typeset lines this element will consume. */
export function elementLineCount(el: ScreenplayElement, format: FormatConfig): number {
  const geo = deriveGeometry(format)
  // Empty paragraphs still take a baseline.
  if (!el.text || el.text.trim() === '') {
    if (el.type === 'page_break') return geo.linesPerPage
    return 1
  }
  const cpl = geo.charsPerLine[el.type as keyof typeof geo.charsPerLine] ?? geo.charsPerLine.default
  const lines = el.text.split('\n').reduce((acc, line) => {
    return acc + Math.max(1, Math.ceil(line.length / cpl))
  }, 0)
  // Padding between elements (Final Draft adds a blank line before scene
  // headings, transitions, characters, etc.).
  let padding = 0
  if (
    el.type === 'scene_heading' ||
    el.type === 'transition' ||
    el.type === 'character' ||
    el.type === 'shot' ||
    el.type === 'act_label' ||
    el.type === 'episode_label'
  ) {
    padding = 1
  }
  // Multi-cam: dialogue is double-spaced.
  if (el.type === 'dialogue' && format.conventions.multiCam) {
    return lines * geo.dialogueLineMultiplier + padding
  }
  return lines + padding
}

/** Compute pagination: returns an array of page numbers, one per element. */
export function paginate(doc: ScreenplayDocument, format: FormatConfig): {
  pageOfElement: Map<string, number>
  totalPages: number
} {
  const geo = deriveGeometry(format)
  const pageOfElement = new Map<string, number>()
  let page = 1
  let cursor = 0
  for (const el of doc.elements) {
    const used = elementLineCount(el, format)
    if (el.type === 'page_break') {
      page++
      cursor = 0
      pageOfElement.set(el.id, page)
      continue
    }
    if (cursor + used > geo.linesPerPage) {
      page++
      cursor = 0
    }
    pageOfElement.set(el.id, page)
    cursor += used
  }
  return { pageOfElement, totalPages: page }
}

/** Approximate runtime in seconds based on page count and format. */
export function approximateRuntime(totalPages: number, format: FormatConfig): number {
  return totalPages * format.page.secondsPerPage
}
