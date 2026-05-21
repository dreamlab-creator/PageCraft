/**
 * Humanization Linter.
 *
 * Runs against any text (AI output, action lines, voiceover, app messaging,
 * dialogue) and returns a list of issues. Each issue has a severity, a
 * category, a span, and an optional one-click fix.
 *
 * Mode determines what's flagged:
 *   - 'strict': all rules apply (default for non-vertical screenplay prose)
 *   - 'vertical_relaxed_dialogue': in dialogue, on-the-nose / theme-in-dialogue /
 *      formal-connector rules are exempted because that's the craft target.
 *   - 'ui': for app-facing copy (no screenplay-specific rules like camera-direction)
 */

import {
  BANNED_PHRASES,
  BANNED_CONNECTORS,
  REPEATED_STARTERS,
  INTERIORITY_PATTERNS,
  CAMERA_DIRECTION_FLAGS,
  OVERWRITING_VERBS,
  EM_DASH,
  EN_DASH,
} from './rules'

export type LintMode = 'strict' | 'vertical_relaxed_dialogue' | 'ui'

export type LintCategory =
  | 'em_dash'
  | 'en_dash'
  | 'ai_tell'
  | 'formal_connector'
  | 'repetitive_starter'
  | 'interiority_leak'
  | 'camera_direction'
  | 'overwriting'
  | 'wall_of_text'
  | 'passive_voice'
  | 'dialogue_on_the_nose'
  | 'character_intro_caps'
  | 'parenthetical_overuse'

export type LintSeverity = 'error' | 'warning' | 'suggestion'

export interface LintIssue {
  category: LintCategory
  severity: LintSeverity
  start: number
  end: number
  matched: string
  message: string
  fix?: string
}

export interface LintContext {
  mode: LintMode
  /** What element this text is. Affects which rules apply. */
  element: 'action' | 'dialogue' | 'parenthetical' | 'scene_heading' | 'transition' | 'shot' | 'general' | 'voiceover' | 'ui' | 'logline' | 'beat' | 'summary'
  /** If known, the character speaking (for dialogue context). */
  speaker?: { name: string; voiceProfile?: 'formal' | 'standard' | 'street' }
}

/** Find all case-insensitive matches of needles in haystack. */
function findAll(haystack: string, needle: string): Array<{ start: number; end: number; matched: string }> {
  const out: Array<{ start: number; end: number; matched: string }> = []
  const re = new RegExp(escapeForRegex(needle).replace(/\s+/g, '\\s+'), 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(haystack))) {
    out.push({ start: m.index, end: m.index + m[0].length, matched: m[0] })
    if (m.index === re.lastIndex) re.lastIndex++ // safety
  }
  return out
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Run the linter. Returns an empty array for clean text.
 */
export function lint(text: string, ctx: LintContext): LintIssue[] {
  if (!text) return []
  const issues: LintIssue[] = []
  const mode = ctx.mode

  // ---- Em-dash & en-dash (universal hard rules) ---------------------------
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === EM_DASH) {
      issues.push({
        category: 'em_dash',
        severity: 'error',
        start: i,
        end: i + 1,
        matched: c,
        message: 'Em-dashes are not permitted. Use "--" in dialogue (interruption) or rewrite with a comma or period.',
        fix: ctx.element === 'dialogue' || ctx.element === 'parenthetical' ? '--' : ',',
      })
    } else if (c === EN_DASH) {
      issues.push({
        category: 'en_dash',
        severity: 'warning',
        start: i,
        end: i + 1,
        matched: c,
        message: 'En-dash is non-standard for screenplay typography. Replace with a hyphen.',
        fix: '-',
      })
    }
  }

  // ---- AI tells (banned phrases) ------------------------------------------
  // Apply everywhere — UI, prose, dialogue, even Vertical (these are AI-only,
  // not on-the-nose-dialogue).
  for (const phrase of BANNED_PHRASES) {
    for (const m of findAll(text, phrase)) {
      issues.push({
        category: 'ai_tell',
        severity: 'error',
        start: m.start,
        end: m.end,
        matched: m.matched,
        message: `"${phrase}" reads as AI-generated. Rewrite to a specific, human observation.`,
      })
    }
  }

  // ---- Formal connectors --------------------------------------------------
  if (!(mode === 'vertical_relaxed_dialogue' && ctx.element === 'dialogue') && ctx.element !== 'parenthetical') {
    for (const conn of BANNED_CONNECTORS) {
      const rx = new RegExp(`(?:^|\\W)(${conn})(?=\\W|$)`, 'gi')
      let m: RegExpExecArray | null
      while ((m = rx.exec(text))) {
        const offset = m[0].indexOf(m[1])
        issues.push({
          category: 'formal_connector',
          severity: 'warning',
          start: m.index + offset,
          end: m.index + offset + m[1].length,
          matched: m[1],
          message: `"${m[1]}" is a corporate/formal connector. Use "But", "So", "And", or drop the connector entirely.`,
        })
        if (m.index === rx.lastIndex) rx.lastIndex++
      }
    }
  }

  // ---- Repetitive starters (3-in-a-row of the same opener) ----------------
  if (ctx.element === 'action' || ctx.element === 'beat' || ctx.element === 'summary' || ctx.element === 'ui') {
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim())
    if (sentences.length >= 3) {
      for (let i = 0; i <= sentences.length - 3; i++) {
        for (const starter of REPEATED_STARTERS) {
          const sRe = new RegExp(`^${starter}\\b`, 'i')
          if (sRe.test(sentences[i]) && sRe.test(sentences[i + 1]) && sRe.test(sentences[i + 2])) {
            const segStart = sentences.slice(0, i).join(' ').length + (i > 0 ? 1 : 0)
            issues.push({
              category: 'repetitive_starter',
              severity: 'warning',
              start: segStart,
              end: Math.min(text.length, segStart + sentences[i].length + sentences[i + 1].length + sentences[i + 2].length + 2),
              matched: `${sentences[i]} ${sentences[i + 1]} ${sentences[i + 2]}`,
              message: `Three sentences in a row start with "${starter}". Vary sentence openings.`,
            })
            break
          }
        }
      }
    }
  }

  // ---- Interiority leak (action only; never in dialogue) ------------------
  if (ctx.element === 'action' || ctx.element === 'beat' || ctx.element === 'summary' || ctx.element === 'general') {
    for (const rx of INTERIORITY_PATTERNS) {
      const re = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        issues.push({
          category: 'interiority_leak',
          severity: 'warning',
          start: m.index,
          end: m.index + m[0].length,
          matched: m[0],
          message: 'Action lines should show behavior, not name internal states. Replace with what the audience can see or hear.',
        })
        if (m.index === re.lastIndex) re.lastIndex++
      }
    }
  }

  // ---- Camera direction (gentle flag) ------------------------------------
  if (ctx.element === 'action') {
    for (const rx of CAMERA_DIRECTION_FLAGS) {
      const re = new RegExp(rx.source, rx.flags.includes('g') ? rx.flags : rx.flags + 'g')
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        issues.push({
          category: 'camera_direction',
          severity: 'suggestion',
          start: m.index,
          end: m.index + m[0].length,
          matched: m[0],
          message: 'Camera directions are best left to the director unless the camera move is itself dramatic.',
        })
        if (m.index === re.lastIndex) re.lastIndex++
      }
    }
  }

  // ---- Overwriting verbs --------------------------------------------------
  if (ctx.element === 'action') {
    for (const verb of OVERWRITING_VERBS) {
      const rx = new RegExp(`\\b${verb}\\b`, 'gi')
      let m: RegExpExecArray | null
      while ((m = rx.exec(text))) {
        issues.push({
          category: 'overwriting',
          severity: 'suggestion',
          start: m.index,
          end: m.index + m[0].length,
          matched: m[0],
          message: `"${m[0]}" reads as overwritten. Prefer a plainer verb that names the action.`,
        })
        if (m.index === rx.lastIndex) rx.lastIndex++
      }
    }
  }

  // ---- Wall of text (action paragraph > 5 lines) -------------------------
  if (ctx.element === 'action') {
    // Approximate "lines" by 60-char rows.
    const lines = Math.ceil(text.length / 60)
    if (lines >= 5) {
      issues.push({
        category: 'wall_of_text',
        severity: 'warning',
        start: 0,
        end: text.length,
        matched: text.slice(0, 40) + '...',
        message: `Action paragraph is approximately ${lines} lines. Break into shorter blocks (1-4 lines) so the page breathes.`,
      })
    }
  }

  return issues
}

/**
 * Convenience: returns true if any errors were found.
 */
export function hasErrors(issues: LintIssue[]): boolean {
  return issues.some(i => i.severity === 'error')
}

/**
 * Apply all 1-click fixes to the text, returning the cleaned string. Skips
 * non-fixable issues.
 */
export function applyFixes(text: string, issues: LintIssue[]): string {
  // Sort issues by start descending so we can splice without invalidating offsets.
  const fixes = issues.filter(i => typeof i.fix === 'string').sort((a, b) => b.start - a.start)
  let out = text
  for (const i of fixes) {
    out = out.slice(0, i.start) + (i.fix ?? '') + out.slice(i.end)
  }
  return out
}
