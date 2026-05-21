/**
 * Pacing diagnostic. Compares actual scene-length distribution and tension
 * variance against the format's calibrated pacing profile.
 */

import type { Project } from '@/types'
import type { DiagnosticFinding } from './types'

export function checkPacing(project: Project): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = []
  if (project.format.verticalSandbox) return out

  const cards = project.sceneCards
  if (cards.length < 4) return out

  // Average tension delta. If most scenes have zero tension change, the script
  // is flat.
  const flatScenes = cards.filter(c => Math.abs(c.tensionEnd - c.tensionStart) < 1).length
  const flatRatio = flatScenes / cards.length
  if (flatRatio > 0.4) {
    out.push({
      id: 'pacing_flat',
      category: 'pacing',
      severity: 'warning',
      title: 'Pacing looks flat',
      detail: `${Math.round(flatRatio * 100)}% of scenes have near-zero tension change.`,
      suggestion: 'Each scene should turn the temperature. Pick three scenes and inject a real reversal.',
    })
  }

  // Average scene length deviation from format expectation.
  const avg = cards.reduce((n, c) => n + c.estimatedPages, 0) / cards.length
  const target = project.format.pacing.avgScenePages
  if (avg > target * 1.6) {
    out.push({
      id: 'pacing_long_scenes',
      category: 'pacing',
      severity: 'warning',
      title: 'Scenes are running long',
      detail: `Average scene length ${avg.toFixed(1)}pp vs. target ${target.toFixed(1)}pp for this format.`,
      suggestion: 'Cut into scenes later, leave them earlier. Replace dialogue with an object or gesture where possible.',
    })
  }

  return out
}
