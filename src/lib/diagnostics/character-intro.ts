/**
 * Character Introduction Checker.
 *
 * On a character's first appearance in an action line, their name must be in
 * ALL CAPS. After that, they should be in normal case unless the writer has a
 * specific reason (which the lint allows by being a suggestion, not an error).
 */

import type { Project } from '@/types'
import type { DiagnosticFinding } from './types'

export function checkCharacterIntros(project: Project): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = []

  const characterNames = project.characters
    .filter(c => c.name.trim())
    .map(c => ({ name: c.name.trim(), id: c.id }))

  if (characterNames.length === 0) return out

  // Track first appearance.
  const seen = new Set<string>()
  for (const el of project.screenplay.elements) {
    if (el.type !== 'action') continue
    for (const { name, id } of characterNames) {
      const upper = name.toUpperCase()
      const lower = name.toLowerCase()
      const txt = el.text

      const idxUpper = indexOfWord(txt, upper)
      const idxLower = indexOfWord(txt.toLowerCase(), lower)

      if (!seen.has(name)) {
        // First appearance — must be ALL CAPS.
        if (idxUpper >= 0) {
          seen.add(name)
        } else if (idxLower >= 0) {
          out.push({
            id: `intro_caps_missing_${id}`,
            category: 'character_intro',
            severity: 'warning',
            title: `"${name}" introduced without ALL CAPS`,
            detail: `On first appearance in action, a character's name should be in ALL CAPS with a brief visual description.`,
            anchor: { kind: 'element', id: el.id },
            suggestion: `Convert "${name}" to "${upper}" on first reference and add 1–2 lines of visual specificity.`,
          })
          seen.add(name)
        }
      } else {
        // After first appearance, no need to ALL CAPS.
        if (idxUpper >= 0 && idxLower < 0) {
          out.push({
            id: `intro_caps_repeat_${id}_${el.id}`,
            category: 'character_intro',
            severity: 'suggestion',
            title: `"${name}" capitalized again after first introduction`,
            detail: 'After the first appearance, the character name should be normal case in action lines.',
            anchor: { kind: 'element', id: el.id },
            suggestion: `Change "${upper}" to "${name}" (title case) here.`,
          })
        }
      }
    }
  }

  return out
}

function indexOfWord(haystack: string, needle: string): number {
  const re = new RegExp(`\\b${escapeRegex(needle)}\\b`)
  const m = haystack.match(re)
  return m ? m.index ?? -1 : -1
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
