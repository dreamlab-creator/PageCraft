/**
 * Character detection — figures out which character names appear in a
 * screenplay, where they appear, and whether each was first introduced as a
 * proper ALL-CAPS intro in an action line.
 *
 * Used by:
 *   - The cast reconciler (live: keep the bible in sync with the page)
 *   - The character-intro diagnostic
 *
 * Important: this only LOOKS. It never mutates the store. The reconciler in
 * `cast-reconcile.ts` is what decides what to do about the findings.
 */

import type { ScreenplayElement } from '@/types'

/**
 * The set of "stop names" we'll never adopt as characters even if a writer
 * accidentally types them in all caps. These are screenplay slang that show
 * up in cues or intros but aren't real characters.
 */
const STOP_NAMES = new Set<string>([
  'INT', 'EXT', 'EST', 'I/E',
  'V.O.', 'O.S.', 'O.C.', "CONT'D",
  'CUT', 'SMASH CUT', 'DISSOLVE', 'JUMP CUT', 'MATCH CUT',
  'FADE', 'FADE IN', 'FADE OUT', 'FADE TO BLACK',
  'BACK TO SCENE', 'INTERCUT', 'INSERT', 'TIME CUT',
  'POV', 'CLOSE ON', 'ANGLE ON', 'WIDE SHOT', 'TWO SHOT', 'OTS',
  'TITLE', 'TITLE CARD', 'SUPER', 'CHYRON',
  'END', 'THE END', 'BEGIN', 'CONTINUED',
  'TEASER', 'ACT ONE', 'ACT TWO', 'ACT THREE', 'ACT FOUR', 'ACT FIVE',
  'EPISODE', 'COLD OPEN', 'TAG',
  'MONTAGE', 'SERIES OF SHOTS',
  // multi-cam stage directions that can look character-like
  'SFX', 'CAST', 'NOTE',
  // generic placeholders
  'TBD', 'TK', 'NEW CHARACTER',
])

/**
 * Trim a character cue name of any trailing extension like (V.O.) or (CONT'D)
 * and return the bare uppercase name. Returns empty string if input is junk.
 */
export function cleanCueName(raw: string): string {
  const noExt = raw.replace(/\s*\([^)]*\)\s*$/g, '').trim()
  // Strip a trailing ^ used for dual dialogue.
  const noDual = noExt.replace(/\s*\^\s*$/, '').trim()
  return noDual
}

/**
 * A single observation of a name appearing in the script.
 */
export interface NameObservation {
  /** The canonicalized (uppercase) name. */
  name: string
  /** Source of the observation. */
  source: 'cue' | 'action_intro'
  /** Element id where the observation was made. */
  elementId: string
  /** Order of appearance (0-based across the whole document). */
  order: number
  /** Best-effort page hint, when pagination has been computed. */
  page?: number
}

/**
 * Detect every appearance of a character-like name across the screenplay.
 *
 * Sources:
 *   - Every `character` element's text (with extension stripped) is treated
 *     as a definitive name.
 *   - Inside `action` lines, runs of ALL CAPS letters that look like a
 *     proper name (1–4 words, no obvious stop-words) are treated as
 *     "first introduction" candidates.
 *
 * The first-introduction heuristic is intentionally a bit conservative: it
 * only matches when the run is at least 3 letters long, doesn't contain
 * common ALL-CAPS noise (sound cues like "BANG!", emphasis like "NO."), and
 * isn't a known stop name.
 */
export function detectNames(
  elements: ScreenplayElement[],
  pageOf?: Map<string, number>,
): NameObservation[] {
  const obs: NameObservation[] = []
  let order = 0

  for (const el of elements) {
    const page = pageOf?.get(el.id)
    if (el.type === 'character') {
      const cleaned = cleanCueName(el.text)
      if (!cleaned) continue
      const upper = cleaned.toUpperCase()
      if (STOP_NAMES.has(upper)) continue
      obs.push({ name: upper, source: 'cue', elementId: el.id, order: order++, page })
      continue
    }

    if (el.type === 'action') {
      // Walk the text for ALL CAPS runs.
      // Pattern: 3+ uppercase letters (with optional internal dots, hyphens,
      // apostrophes, or spaces between caps), bounded by word boundaries.
      // Examples we want to match: "MAYA RIVERS", "DR. STRANGE", "MARY-ANNE",
      //   "MR. OWEN", "MAYA".
      const re = /\b([A-Z][A-Z'.-]*(?:\s+[A-Z][A-Z'.-]*){0,3})\b/g
      let m: RegExpExecArray | null
      while ((m = re.exec(el.text)) != null) {
        const candidate = m[1].trim()
        if (!looksLikeProperName(candidate)) continue
        obs.push({
          name: candidate,
          source: 'action_intro',
          elementId: el.id,
          order: order++,
          page,
        })
      }
    }
  }

  return obs
}

/**
 * Heuristic gate for ALL-CAPS runs in action lines.
 *
 * We want "MAYA RIVERS" and "TOMÁS" but NOT "BANG!", "NO.", "TV", "FBI",
 * "OK" (interjection), or trade-marks.
 */
function looksLikeProperName(s: string): boolean {
  const trimmed = s.trim()
  if (!trimmed) return false

  // Reject anything in the stop list (case-insensitive on the canonical form).
  if (STOP_NAMES.has(trimmed.toUpperCase())) return false

  // Must contain at least one letter run >= 3 chars (so "FBI"/"TV" don't slip in).
  // Acronyms (no vowels at all) are rejected by the vowel test below.
  const letters = trimmed.replace(/[^A-Z]/g, '')
  if (letters.length < 3) return false

  // Must have a vowel; rejects acronyms like "FBI", "NSA", "KGB", "BBQ".
  if (!/[AEIOU]/.test(letters)) return false

  // Reject single-letter ending punctuation runs like "NO." or "OK." — those
  // are interjections.
  if (/^[A-Z]{2,3}\.?$/.test(trimmed) && trimmed.length <= 4) {
    // Only allow short tokens if they look like a proper name (vowel above
    // already passed), but reject pure interjections like "NO", "OK", "OH".
    const INTERJECTIONS = new Set(['NO', 'OK', 'OH', 'AH', 'EH', 'UH', 'HEY', 'YES', 'YEAH', 'NAH', 'HUH'])
    if (INTERJECTIONS.has(trimmed.replace(/\.$/, ''))) return false
  }

  // Reject if it ends in an exclamation or question — that's onomatopoeia.
  if (/[!?]$/.test(trimmed)) return false

  return true
}

/**
 * Normalize a name so two surface variants of the same character match.
 *
 *   "Maya Rivers"  → "MAYA RIVERS"
 *   "MAYA Rivers"  → "MAYA RIVERS"
 *   "  maya  "     → "MAYA"
 *
 * Whitespace is collapsed; trailing/leading punctuation is removed.
 */
export function canonicalName(s: string): string {
  return s
    .replace(/[^\p{L}\p{N}\s.'-]/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

/**
 * Quick lookup: collect the unique canonical names used as cues anywhere in
 * the screenplay. (Cues are the most reliable signal.)
 */
export function cueNameSet(elements: ScreenplayElement[]): Set<string> {
  const out = new Set<string>()
  for (const el of elements) {
    if (el.type !== 'character') continue
    const cleaned = cleanCueName(el.text)
    if (!cleaned) continue
    const c = canonicalName(cleaned)
    if (!c) continue
    if (STOP_NAMES.has(c)) continue
    out.add(c)
  }
  return out
}
