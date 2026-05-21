/**
 * Em-dash interceptor. The em-dash character (U+2014) is never emitted by
 * PageCraft in any AI output, any UI text, or any screenplay element.
 *
 * Conversions:
 *   In dialogue / parentheticals → `--` (Final Draft interruption convention)
 *   In action / prose / general / centered → `,` (or `.` if at end of clause)
 *   In titles / metadata → `:`
 *   En-dash (U+2013) → `-`
 */

import { EM_DASH, EN_DASH } from './rules'

export type EmDashContext =
  | 'dialogue'
  | 'parenthetical'
  | 'action'
  | 'scene_heading'
  | 'transition'
  | 'shot'
  | 'centered'
  | 'general'
  | 'title'
  | 'note'
  | 'ui'
  | 'ai_output'

/**
 * Convert em-dashes in a string according to context. Returns the cleaned
 * string. Idempotent. Safe to run on any text, anywhere.
 */
export function stripEmDashes(text: string, ctx: EmDashContext): string {
  if (!text) return text
  // Always normalize en-dash to hyphen.
  let out = text.replace(new RegExp(EN_DASH, 'g'), '-')

  if (ctx === 'dialogue' || ctx === 'parenthetical') {
    // Interruption convention: `--`.
    out = out.replace(new RegExp(EM_DASH, 'g'), '--')
  } else if (ctx === 'title') {
    out = out.replace(new RegExp(EM_DASH, 'g'), ':')
  } else {
    // Prose / UI: smart replacement.
    out = smartProseReplace(out)
  }

  return out
}

/**
 * Smart prose replacement: an em-dash that ends a clause becomes ".", an
 * em-dash inside a clause becomes ",". We also collapse double-em-dashes.
 */
function smartProseReplace(s: string): string {
  // Replace em-dashes at the very end of a sentence/line with a period.
  let out = s.replace(new RegExp(`${EM_DASH}+(?=\\s*$|\\s*[\\n\\r])`, 'gm'), '.')
  // Replace em-dashes followed by whitespace and a capital letter with a period + space.
  out = out.replace(new RegExp(`${EM_DASH}+\\s+(?=[A-Z])`, 'g'), '. ')
  // Everything else: comma.
  out = out.replace(new RegExp(`${EM_DASH}+`, 'g'), ',')
  // Tidy up doubled spaces.
  out = out.replace(/\s{2,}/g, ' ')
  return out
}

/**
 * Convenience: detect any em-dash in a string.
 */
export function hasEmDash(text: string): boolean {
  return text.indexOf(EM_DASH) !== -1
}

/**
 * Strip em-dashes from any structured value recursively. Used when sanitizing
 * AI output objects.
 */
export function deepStripEmDashes<T>(value: T, ctx: EmDashContext = 'ai_output'): T {
  if (value == null) return value
  if (typeof value === 'string') return stripEmDashes(value, ctx) as unknown as T
  if (Array.isArray(value)) return (value.map(v => deepStripEmDashes(v, ctx)) as unknown) as T
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepStripEmDashes(v, ctx)
    }
    return out as unknown as T
  }
  return value
}
