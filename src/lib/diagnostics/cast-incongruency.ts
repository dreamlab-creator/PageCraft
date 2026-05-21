/**
 * Cast Incongruency Diagnostic — surfaces script-vs-bible mismatches in
 * the standard diagnostic report alongside other checks.
 *
 * The Writing-mode banner shows these inline; this puts them into the
 * Diagnostics panel and Pre-Flight modal too.
 */

import type { Project } from '@/types'
import type { DiagnosticFinding } from './types'
import { reconcileCast } from '@/lib/screenplay'

export function checkCastIncongruencies(project: Project): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = []
  const report = reconcileCast(project)

  // 1. Characters in the bible that need user review (auto-adopted stubs).
  for (const ch of project.characters) {
    if (!ch.needsReview) continue
    out.push({
      id: `cast_needs_review_${ch.id}`,
      category: 'cast_incongruency',
      severity: 'suggestion',
      title: `"${ch.name}" was auto-adopted into the bible`,
      detail: `Provenance: ${ch.provenance ?? 'auto_script'}. Flesh out the bible entry, or click "Mark reviewed" to dismiss.`,
      anchor: { kind: 'character', id: ch.id },
      suggestion: 'Open Planning → Characters → click this character.',
    })
  }

  // 2. Names that appear in action lines in ALL CAPS but were never cued.
  for (const s of report.scriptOnly) {
    if (s.cueCount > 0) continue // auto-adopted; handled above
    if (!s.introducedInAction) continue
    out.push({
      id: `cast_uncued_${s.name}`,
      category: 'cast_incongruency',
      severity: 'suggestion',
      title: `"${s.displayName}" mentioned in action but never cued`,
      detail: 'They appear in ALL CAPS in an action line but never speak. If they belong in the cast, add them to the bible.',
      anchor: { kind: 'element', id: s.firstObservation.elementId, page: s.firstObservation.page },
      suggestion: 'Use the Cast banner to add them to the bible, or remove the ALL CAPS treatment if they aren\'t a named character.',
    })
  }

  // 3. Bible characters never used on the page.
  for (const b of report.bibleOnly) {
    out.push({
      id: `cast_orphan_${b.characterId}`,
      category: 'cast_incongruency',
      severity: 'info',
      title: `"${b.name}" exists in the bible but isn't on the page yet`,
      detail: 'They\'re planned but unused. Either bring them in, or remove from the bible.',
      anchor: { kind: 'character', id: b.characterId },
    })
  }

  // 4. Possible name conflicts.
  for (const c of report.caseConflicts) {
    out.push({
      id: `cast_conflict_${c.canonical}`,
      category: 'cast_incongruency',
      severity: 'warning',
      title: `Possible duplicate: ${c.surfaceForms.join(', ')}`,
      detail: 'These look like surface variants of the same character. Decide a canonical form and use it consistently in cues.',
      suggestion: `Standardize as "${c.canonical}" (or the writer's preferred form) across cues.`,
    })
  }

  return out
}
