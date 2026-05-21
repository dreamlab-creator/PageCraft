export type DiagnosticSeverity = 'error' | 'warning' | 'suggestion' | 'info'

export type DiagnosticCategory =
  | 'format_lint'
  | 'humanization'
  | 'scene_turn'
  | 'substance'
  | 'voice_drift'
  | 'continuity'
  | 'setup_payoff'
  | 'pacing'
  | 'character_intro'
  | 'cast_incongruency'
  | 'theme'
  | 'rise_spike_drop_cliff'
  | 'hook_density'
  | 'cliff_strength'
  | 'trope_stack'
  | 'escalation_curve'
  | 'paywall_strength'

export interface DiagnosticFinding {
  id: string
  category: DiagnosticCategory
  severity: DiagnosticSeverity
  title: string
  detail: string
  // Optional anchors so the UI can jump to the source.
  anchor?:
    | { kind: 'element'; id: string; page?: number }
    | { kind: 'scene'; id: string; index?: number }
    | { kind: 'beat'; id: string }
    | { kind: 'character'; id: string }
    | { kind: 'episode'; id: string }
  // Suggested fix (free text).
  suggestion?: string
}

export interface DiagnosticReport {
  generatedAt: number
  totalsBySeverity: Record<DiagnosticSeverity, number>
  totalsByCategory: Record<DiagnosticCategory, number>
  findings: DiagnosticFinding[]
}
