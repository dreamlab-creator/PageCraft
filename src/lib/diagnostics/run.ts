/**
 * Diagnostic orchestrator. Runs all enabled checks against a project and
 * returns a consolidated report.
 */

import type { Project } from '@/types'
import type { DiagnosticFinding, DiagnosticReport, DiagnosticSeverity, DiagnosticCategory } from './types'
import { checkSceneTurns } from './scene-turn'
import { checkSubstance } from './substance'
import { checkPacing } from './pacing'
import { checkCharacterIntros } from './character-intro'
import { checkCastIncongruencies } from './cast-incongruency'
import { lint } from '@/lib/humanization'

export function runDiagnostics(project: Project): DiagnosticReport {
  const findings: DiagnosticFinding[] = []

  // Humanization: lint every action and dialogue element.
  for (const el of project.screenplay.elements) {
    const ctxEl = el.type === 'dialogue' || el.type === 'parenthetical'
      ? 'dialogue'
      : el.type === 'scene_heading'
        ? 'scene_heading'
        : 'action'
    const issues = lint(el.text, {
      mode: project.format.verticalSandbox && el.type === 'dialogue' ? 'vertical_relaxed_dialogue' : 'strict',
      element: (el.type === 'action' || el.type === 'dialogue' || el.type === 'parenthetical' || el.type === 'scene_heading' || el.type === 'transition' || el.type === 'shot' || el.type === 'general') ? el.type : 'action',
    })
    for (const issue of issues) {
      findings.push({
        id: `humanization_${el.id}_${issue.start}_${issue.category}`,
        category: 'humanization',
        severity: issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'suggestion',
        title: `${issue.category.replace(/_/g, ' ')}: "${issue.matched}"`,
        detail: issue.message,
        anchor: { kind: 'element', id: el.id },
        suggestion: issue.fix ?? undefined,
      })
    }
  }

  findings.push(...checkSceneTurns(project))
  findings.push(...checkSubstance(project))
  findings.push(...checkPacing(project))
  findings.push(...checkCharacterIntros(project))
  findings.push(...checkCastIncongruencies(project))

  // Tally totals.
  const totalsBySeverity: Record<DiagnosticSeverity, number> = { error: 0, warning: 0, suggestion: 0, info: 0 }
  const totalsByCategory: Partial<Record<DiagnosticCategory, number>> = {}
  for (const f of findings) {
    totalsBySeverity[f.severity]++
    totalsByCategory[f.category] = (totalsByCategory[f.category] ?? 0) + 1
  }

  return {
    generatedAt: Date.now(),
    totalsBySeverity,
    totalsByCategory: totalsByCategory as Record<DiagnosticCategory, number>,
    findings,
  }
}
