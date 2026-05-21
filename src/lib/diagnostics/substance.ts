/**
 * Substance Check.
 *
 * Flags thin outlines: not enough beats per act, missing story purpose, no
 * conflict or no change, missing setups/payoffs, weak protagonist activity.
 *
 * This is the "stop generating filler" rule the user emphasized.
 */

import type { Project, Beat } from '@/types'
import type { DiagnosticFinding } from './types'

export function checkSubstance(project: Project): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = []
  const thresholds = project.format.substanceThresholds
  const beats = project.beats

  // Per-beat: every beat needs purpose, objective, obstacle, and change.
  for (const b of beats) {
    const missing: string[] = []
    if (!b.storyPurpose.trim()) missing.push('story purpose')
    if (!b.characterObjective.trim()) missing.push('character objective')
    if (!b.obstacle.trim()) missing.push('obstacle')
    if (!b.changeMechanism.trim() && !(b.valueAtStart && b.valueAtEnd && b.valueAtStart !== b.valueAtEnd)) {
      missing.push('change')
    }
    if (missing.length >= 2) {
      out.push({
        id: `substance_thin_${b.id}`,
        category: 'substance',
        severity: 'warning',
        title: `Beat "${b.title}" is thin`,
        detail: `Missing: ${missing.join(', ')}. A beat that doesn't have these is at risk of being filler.`,
        anchor: { kind: 'beat', id: b.id },
        suggestion: 'Add what changes here and why this beat must exist. If you can\'t justify it, cut it.',
      })
    }
  }

  // Per-act: enough beats?
  if (thresholds.minBeatsPerAct > 0 && beats.length > 0) {
    const acts = groupByAct(beats)
    for (const [act, list] of acts) {
      if (list.length < thresholds.minBeatsPerAct) {
        out.push({
          id: `substance_act_${act}_under`,
          category: 'substance',
          severity: 'warning',
          title: `Act ${act} has only ${list.length} ${list.length === 1 ? 'beat' : 'beats'}`,
          detail: `This format expects at least ${thresholds.minBeatsPerAct} beats per act.`,
          suggestion: 'Add beats with real story movement: conflict, reversal, reveal, decision, consequence.',
        })
      }
    }
  }

  // Setups/payoffs ledger.
  for (const sp of project.setupsPayoffs) {
    if (!sp.paid && sp.planted && sp.weight !== 'minor') {
      out.push({
        id: `unfired_${sp.id}`,
        category: 'setup_payoff',
        severity: 'warning',
        title: `Unfired setup: "${sp.description}"`,
        detail: 'This setup is planted but no payoff is recorded.',
        suggestion: 'Plan its payoff or remove the setup.',
      })
    }
    if (sp.paid && !sp.planted) {
      out.push({
        id: `orphan_payoff_${sp.id}`,
        category: 'setup_payoff',
        severity: 'warning',
        title: `Orphan payoff: "${sp.description}"`,
        detail: 'A payoff exists with no planted setup. The audience won\'t feel it.',
        suggestion: 'Add a setup earlier in the script.',
      })
    }
  }

  return out
}

function groupByAct(beats: Beat[]): Map<number, Beat[]> {
  const out = new Map<number, Beat[]>()
  for (const b of beats) {
    const act = b.actNumber ?? 0
    if (!out.has(act)) out.set(act, [])
    out.get(act)!.push(b)
  }
  return out
}
