/**
 * Scene Turn Check (McKee discipline).
 *
 * A scene must turn — its value-charged condition must flip from positive to
 * negative (or vice versa). If a scene's opening value equals its closing
 * value, it's a "nonevent" and should likely be cut or merged.
 *
 * This check operates on the user's SceneCards. Empty-valued scenes get
 * flagged as missing the architecture entirely.
 */

import type { Project } from '@/types'
import type { DiagnosticFinding } from './types'

export function checkSceneTurns(project: Project): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = []
  if (project.format.verticalSandbox) return out // vertical uses its own check

  for (const card of project.sceneCards) {
    const open = card.openingValue.trim().toLowerCase()
    const close = card.closingValue.trim().toLowerCase()
    if (!open || !close) {
      out.push({
        id: `scene_turn_missing_${card.id}`,
        category: 'scene_turn',
        severity: 'warning',
        title: `Scene "${card.title}" is missing its turn`,
        detail: 'Define an opening value and a closing value. If they\'re the same, the scene is probably a nonevent.',
        anchor: { kind: 'scene', id: card.id },
        suggestion: 'Fill in opening value, closing value, and the turn mechanism that flips them.',
      })
      continue
    }
    if (open === close) {
      out.push({
        id: `scene_turn_flat_${card.id}`,
        category: 'scene_turn',
        severity: 'error',
        title: `Scene "${card.title}" does not turn`,
        detail: 'Opening and closing values are identical. The scene is a nonevent.',
        anchor: { kind: 'scene', id: card.id },
        suggestion: 'Either rewrite to create a value flip, or cut/merge into another scene.',
      })
    }
    if (!card.turn) {
      out.push({
        id: `scene_turn_no_mechanism_${card.id}`,
        category: 'scene_turn',
        severity: 'suggestion',
        title: `Scene "${card.title}" has no documented turn mechanism`,
        detail: 'You have an opening value and a closing value, but no explanation of how the flip happens.',
        anchor: { kind: 'scene', id: card.id },
      })
    }
  }
  return out
}
