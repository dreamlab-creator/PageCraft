/**
 * Auto-Detect — figures out a paragraph's element type from its text content
 * in cases where the writer is typing freely. Used both during live typing
 * (to upgrade a paragraph type) and during imports (to classify plain text).
 *
 * Mirrors Final Draft 13's SmartType behavior of recognizing INT./EXT. as
 * scene-heading triggers, transitions ending in TO:, etc.
 */

import type { ScreenplayElementType, SceneIntro } from '@/types'

/** Scene heading prefixes (case-insensitive). */
const SCENE_PREFIXES = /^(INT\.?|EXT\.?|EST\.?|INT\.?\/EXT\.?|INT\/EXT|I\/E\.?)\s+/i

/**
 * Transitions: end in "TO:" (CUT TO:, DISSOLVE TO:, MATCH CUT TO:, etc.)
 * OR explicitly known ones like FADE OUT, FADE IN:, SMASH CUT TO:, etc.
 */
const TRANSITION_PATTERNS = [
  /TO:\s*$/,
  /^FADE OUT\.?\s*$/i,
  /^FADE IN:?\s*$/i,
  /^FADE TO BLACK\.?\s*$/i,
  /^SMASH CUT(?: TO:?)?\s*$/i,
  /^MATCH CUT(?: TO:?)?\s*$/i,
  /^JUMP CUT(?: TO:?)?\s*$/i,
  /^DISSOLVE(?: TO:?)?\s*$/i,
  /^CUT TO BLACK\.?\s*$/i,
  /^IRIS (IN|OUT)\.?\s*$/i,
  /^WIPE TO:\s*$/i,
]

/** Known camera shots in screenwriting. */
const SHOT_PATTERNS = [
  /^(ANGLE ON|CLOSE ON|CLOSEUP|CLOSE UP|EXTREME CLOSE-?UP|WIDE SHOT|TWO[\s-]?SHOT|POV|OTS|OVER[\s-]?THE[\s-]?SHOULDER|TRACKING SHOT|HIGH ANGLE|LOW ANGLE|AERIAL|INSERT|BACK TO SCENE|REVEAL|MONTAGE|SERIES OF SHOTS|INTERCUT)/i,
]

/** Multi-cam-specific patterns. */
const ACT_LABEL_PATTERN = /^(ACT (ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|\d+)|END OF ACT|END OF SHOW|TEASER|COLD OPEN|TAG)\b/i
const EPISODE_LABEL_PATTERN = /^EPISODE\s+\d+/i

/** Centered text (Fountain >text<). */
const CENTERED_PATTERN = /^>.*<\s*$/

/**
 * Detect the most likely element type for a given line of text.
 *
 * @param text the line of text the user typed
 * @param contextPrev the element type of the previous paragraph (or null)
 * @returns the inferred type, or 'action' as the safe fallback
 */
export function detectElementType(
  text: string,
  contextPrev?: ScreenplayElementType,
): ScreenplayElementType {
  const t = text.trim()
  if (!t) return contextPrev === 'character' ? 'dialogue' : 'action'

  // Scene heading prefix.
  if (SCENE_PREFIXES.test(t)) return 'scene_heading'

  // Episode label (Vertical).
  if (EPISODE_LABEL_PATTERN.test(t)) return 'episode_label'

  // Act label.
  if (ACT_LABEL_PATTERN.test(t)) return 'act_label'

  // Transitions.
  if (TRANSITION_PATTERNS.some(rx => rx.test(t))) return 'transition'

  // Centered.
  if (CENTERED_PATTERN.test(t)) return 'centered_text'

  // Shot.
  if (SHOT_PATTERNS.some(rx => rx.test(t))) return 'shot'

  // Parenthetical (when wrapped in parens, after a character or dialogue).
  if (/^\(.+\)$/.test(t) && (contextPrev === 'character' || contextPrev === 'dialogue')) {
    return 'parenthetical'
  }

  // Character cue: short uppercase line, only after non-character, non-parenthetical, non-dialogue.
  // Character cues are short (typically <= 4 words), entirely uppercase (with optional extension),
  // and followed by dialogue. This detector errs on the side of action; the writer can override.
  if (looksLikeCharacterCue(t) && contextPrev !== 'character' && contextPrev !== 'parenthetical') {
    return 'character'
  }

  // Default fallback.
  return 'action'
}

/**
 * Heuristic: is a line likely a character cue?
 * Character cues are all caps, short, and optionally end with a parenthetical
 * like (V.O.) or (CONT'D).
 */
export function looksLikeCharacterCue(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  // Strip extension like (V.O.), (O.S.), (CONT'D)
  const stripped = t.replace(/\s*\([^)]*\)\s*$/, '').trim()
  if (!stripped) return false
  // All uppercase except spaces and basic punctuation. Allow apostrophes.
  if (!/^[A-Z0-9 .'\-#&!?,]+$/.test(stripped)) return false
  // Reasonable length: most character cues are 1-4 words.
  const wordCount = stripped.split(/\s+/).length
  return wordCount >= 1 && wordCount <= 6 && stripped.length <= 40
}

/**
 * Parse the components of a scene heading. Returns null if not a valid heading.
 */
export function parseSceneHeading(text: string):
  | { intro: SceneIntro; location: string; time: string }
  | null
{
  const m = text.trim().match(/^(INT\.?|EXT\.?|EST\.?|INT\.?\/EXT\.?|INT\/EXT|I\/E\.?)\s+(.+?)(?:\s+[-–—]\s+(.+))?$/i)
  if (!m) return null
  const introRaw = m[1].toUpperCase().replace(/[^A-Z./]/g, '')
  const intro = introRaw.endsWith('.') ? introRaw as SceneIntro : (`${introRaw}.` as SceneIntro)
  const location = (m[2] ?? '').trim()
  const time = (m[3] ?? '').trim()
  return { intro, location, time }
}

/**
 * Common time-of-day values for SmartType.
 */
export const STANDARD_TIMES_OF_DAY = [
  'DAY',
  'NIGHT',
  'MORNING',
  'AFTERNOON',
  'EVENING',
  'LATER',
  'CONTINUOUS',
  'DAWN',
  'DUSK',
  'SUNRISE',
  'SUNSET',
  'MAGIC HOUR',
  'PRE-DAWN',
  'NOON',
  'MIDNIGHT',
  'MOMENTS LATER',
] as const

/** Standard scene intros for SmartType. */
export const STANDARD_SCENE_INTROS: SceneIntro[] = ['INT.', 'EXT.', 'EST.', 'INT./EXT.', 'I/E.']

/** Standard transitions for SmartType. */
export const STANDARD_TRANSITIONS = [
  'CUT TO:',
  'SMASH CUT TO:',
  'MATCH CUT TO:',
  'JUMP CUT TO:',
  'DISSOLVE TO:',
  'FADE TO:',
  'FADE IN:',
  'FADE OUT.',
  'FADE TO BLACK.',
  'IRIS IN:',
  'IRIS OUT.',
  'INTERCUT:',
  'INTERCUT WITH:',
  'WIPE TO:',
  'BACK TO:',
  'TIME CUT TO:',
] as const

/** Standard character extensions for SmartType. */
export const STANDARD_CHARACTER_EXTENSIONS = [
  'V.O.',
  'O.S.',
  'O.C.',
  "CONT'D",
  'PRELAP',
  'FILTERED',
  'INTO PHONE',
  'OVER RADIO',
  'SUBTITLED',
  'THROUGH DOOR',
] as const
