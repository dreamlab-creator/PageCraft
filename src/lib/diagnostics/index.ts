/**
 * Diagnostics engine: runs a battery of checks against a project and returns
 * structured findings. Each check is independent so the UI can show them
 * separately and the AI can use them as inputs to its self-critique.
 *
 * Checks (all enabled in non-Vertical mode; Vertical has its own subset):
 *   - format_lint    : screenplay format hygiene
 *   - humanization   : em-dashes, AI tells, formal connectors, etc.
 *   - scene_turn     : does every scene turn a value?
 *   - substance      : enough beats, enough scenes, no filler
 *   - voice_drift    : does dialogue match each character's fingerprint?
 *   - continuity     : knowledge graph contradictions
 *   - setup_payoff   : unfired guns and orphan payoffs
 *   - pacing         : scene length distribution, tension peaks
 *   - character_intro: first-appearance ALL CAPS handling
 *
 * Vertical-only:
 *   - rise_spike_drop_cliff
 *   - hook_density
 *   - cliff_strength
 *   - trope_stack_adherence
 *   - escalation_curve
 *   - paywall_strength
 */

export * from './types'
export * from './cast-incongruency'
export * from './run'
export * from './scene-turn'
export * from './substance'
export * from './pacing'
export * from './character-intro'
