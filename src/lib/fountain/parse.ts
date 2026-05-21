/**
 * Fountain 1.1 parser. Implements the full Fountain spec at fountain.io.
 *
 * Returns a ScreenplayDocument suitable for direct use in PageCraft.
 */

import type { ScreenplayElement, ScreenplayDocument, ElementId, SceneIntro } from '@/types'
import { newId } from '@/types'
import { detectElementType, looksLikeCharacterCue, parseSceneHeading } from '@/lib/screenplay/auto-detect'

const SCENE_PREFIX = /^(INT\.?|EXT\.?|EST\.?|INT\.?\/EXT\.?|INT\/EXT|I\/E\.?)\b/i
const FORCED_SCENE = /^\.[A-Za-z0-9]/
const FORCED_ACTION = /^!/
const FORCED_CHARACTER = /^@/
const FORCED_TRANSITION = /^>/
const FORCED_LYRIC = /^~/
const PAGE_BREAK = /^={3,}\s*$/
const CENTERED = /^>.*<\s*$/
const TRANSITION_END = /TO:\s*$/
const SCENE_NUMBER = /\s+#([A-Za-z0-9.\-]+)#\s*$/
const SECTION = /^#+\s+/
const SYNOPSIS = /^=\s+/
const BONEYARD_START = '/*'
const BONEYARD_END = '*/'
const NOTE_INLINE = /\[\[([\s\S]*?)\]\]/g
const DUAL_DIALOGUE = /\s*\^\s*$/

interface ParseState {
  lines: string[]
  i: number
  elements: ScreenplayElement[]
  title: ScreenplayDocument['titlePage']
  inBoneyard: boolean
}

export function parseFountain(input: string): ScreenplayDocument {
  // Normalize line endings.
  const normalized = input.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')

  const state: ParseState = {
    lines,
    i: 0,
    elements: [],
    title: {},
    inBoneyard: false,
  }

  parseTitlePage(state)

  while (state.i < state.lines.length) {
    const rawLine = state.lines[state.i]
    const line = rawLine

    // Boneyard handling.
    if (state.inBoneyard) {
      const endIdx = line.indexOf(BONEYARD_END)
      if (endIdx !== -1) state.inBoneyard = false
      state.i++
      continue
    }
    const startIdx = line.indexOf(BONEYARD_START)
    if (startIdx !== -1 && line.indexOf(BONEYARD_END) === -1) {
      state.inBoneyard = true
      state.i++
      continue
    }

    // Page break.
    if (PAGE_BREAK.test(line)) {
      pushElement(state, 'page_break', '')
      state.i++
      continue
    }

    // Section markers — most are outline-only and we skip them, BUT a few
    // recognizable structural labels (Act / Episode breaks) get promoted
    // to proper screenplay elements so they print bold + underlined +
    // centered the way Final Draft does.
    if (SECTION.test(line)) {
      const body = line.replace(/^#+\s+/, '').trim()
      const upper = body.toUpperCase()
      if (/^(EPISODE\b)/i.test(upper)) {
        pushElement(state, 'episode_label', upper)
        state.i++
        continue
      }
      if (/^(ACT\b|END OF ACT\b)/i.test(upper)) {
        pushElement(state, 'act_label', upper)
        state.i++
        continue
      }
      // Other sections (outline markers like `# Setup`, `# Midpoint`) are
      // discarded as they're not part of the printed screenplay.
      state.i++
      continue
    }
    if (SYNOPSIS.test(line)) {
      state.i++
      continue
    }

    // Empty line.
    if (line.trim() === '') {
      state.i++
      continue
    }

    // Centered text.
    if (CENTERED.test(line.trim())) {
      const text = line.trim().slice(1, -1).trim()
      pushElement(state, 'centered_text', text)
      state.i++
      continue
    }

    // Forced scene heading.
    if (FORCED_SCENE.test(line)) {
      const text = line.replace(/^\./, '').trim()
      pushSceneHeading(state, text)
      state.i++
      continue
    }

    // Forced action.
    if (FORCED_ACTION.test(line)) {
      const text = line.replace(/^!/, '')
      pushElement(state, 'action', text)
      state.i++
      continue
    }

    // Forced character.
    if (FORCED_CHARACTER.test(line)) {
      const text = line.replace(/^@/, '').trim()
      pushCharacterAndDialogue(state, text)
      continue
    }

    // Forced transition.
    if (FORCED_TRANSITION.test(line) && !CENTERED.test(line.trim())) {
      const text = line.replace(/^>/, '').trim()
      pushElement(state, 'transition', text)
      state.i++
      continue
    }

    // Forced lyric.
    if (FORCED_LYRIC.test(line)) {
      const text = line.replace(/^~/, '')
      pushElement(state, 'lyric', text)
      state.i++
      continue
    }

    // Scene heading by prefix.
    if (SCENE_PREFIX.test(line)) {
      pushSceneHeading(state, line.trim())
      state.i++
      continue
    }

    // Transition (UPPERCASE line ending in TO:).
    if (line.trim().toUpperCase() === line.trim() && TRANSITION_END.test(line.trim()) && line.trim().length >= 6) {
      pushElement(state, 'transition', line.trim())
      state.i++
      continue
    }

    // Character cue (uppercase, short, next line is non-blank → dialogue).
    if (looksLikeCharacterCue(line.trim()) && state.i + 1 < state.lines.length && state.lines[state.i + 1].trim() !== '') {
      pushCharacterAndDialogue(state, line.trim())
      continue
    }

    // Default: action.
    pushElement(state, 'action', line)
    state.i++
  }

  return { elements: state.elements, titlePage: state.title }
}

function parseTitlePage(state: ParseState) {
  // Title page is at the start, format key: value. Ends with a blank line.
  const firstLine = state.lines[state.i] ?? ''
  if (!/^[A-Za-z][A-Za-z0-9 _]*:/.test(firstLine)) return

  while (state.i < state.lines.length) {
    const line = state.lines[state.i]
    if (line.trim() === '') {
      state.i++
      return
    }
    const m = line.match(/^([A-Za-z][A-Za-z0-9 _]*):\s*(.*)$/)
    if (!m) return
    const key = m[1].toLowerCase().replace(/\s+/g, '_')
    let value = m[2].trim()
    state.i++
    // Multi-line values: indented continuations.
    while (state.i < state.lines.length && /^[\t ]+/.test(state.lines[state.i])) {
      value += '\n' + state.lines[state.i].trim()
      state.i++
    }
    applyTitleField(state, key, value)
  }
}

function applyTitleField(state: ParseState, key: string, value: string) {
  const tp = state.title
  const clean = value.replace(/^_+\*\*|\*\*_+$|^_+|_+$|^\*+|\*+$/g, '').trim()
  switch (key) {
    case 'title': tp.title = clean; break
    case 'credit': tp.credit = clean; break
    case 'author':
    case 'authors': tp.author = clean; break
    case 'source': tp.source = clean; break
    case 'draft_date': tp.draftDate = clean; break
    case 'contact': tp.contact = clean; break
    case 'notes': tp.notes = clean; break
    case 'cover':
    case 'cover_page': tp.coverPage = clean; break
  }
}

function pushSceneHeading(state: ParseState, raw: string) {
  let text = raw
  let sceneNumber: string | undefined
  const numMatch = text.match(SCENE_NUMBER)
  if (numMatch) {
    sceneNumber = numMatch[1]
    text = text.replace(SCENE_NUMBER, '').trim()
  }
  const parsed = parseSceneHeading(text)
  pushElement(state, 'scene_heading', text, {
    sceneNumber,
    sceneIntro: parsed?.intro as SceneIntro | undefined,
    sceneLocation: parsed?.location,
    sceneTime: parsed?.time,
  })
}

/**
 * Push character + dialogue (+ optional parentheticals) as a block.
 * Advances state.i past the entire dialogue block.
 */
function pushCharacterAndDialogue(state: ParseState, rawCue: string) {
  let cue = rawCue
  let dual = false
  if (DUAL_DIALOGUE.test(cue)) {
    dual = true
    cue = cue.replace(DUAL_DIALOGUE, '').trim()
  }
  const charEl = pushElement(state, 'character', cue, { dualWith: dual ? null : undefined })
  state.i++
  // Consume parentheticals and dialogue until a blank line.
  while (state.i < state.lines.length) {
    const ln = state.lines[state.i]
    if (ln.trim() === '') break
    if (/^\s*\(.+\)\s*$/.test(ln)) {
      pushElement(state, 'parenthetical', ln.trim())
    } else {
      pushElement(state, 'dialogue', ln)
    }
    state.i++
  }
  if (dual) {
    // Mark the previous character element as the partner.
    charEl.dualWith = null // resolved on the second pass when paired
  }
}

function pushElement(
  state: ParseState,
  type: ScreenplayElement['type'],
  text: string,
  extras?: Partial<ScreenplayElement>,
): ScreenplayElement {
  // Strip inline notes [[...]] (Fountain notes are non-printing; we move them to noteIds later).
  const cleanedText = text.replace(NOTE_INLINE, '').trimEnd()
  const el: ScreenplayElement = {
    id: newId<ElementId>(),
    type,
    text: cleanedText,
    ...(extras ?? {}),
  }
  state.elements.push(el)
  return el
}
