/**
 * Model Registry.
 *
 * PageCraft uses different Anthropic models for different jobs. A "creative"
 * tier for prose and dialogue (Opus), a "balanced" tier for structured/
 * analytical work like outlines and diagnostics (Sonnet), and a "fast" tier
 * for one-line completions and quick fills (Haiku).
 *
 * Model IDs are configurable from Settings. Defaults below use the current
 * top-of-line releases as of 2026. When Anthropic ships newer models, the
 * user can update these three IDs in Settings without touching code.
 */

export type ModelTier = 'creative' | 'balanced' | 'fast'

export interface ModelConfig {
  /** Anthropic API model id (e.g., "claude-opus-4-1-20250805"). */
  id: string
  /** Display name. */
  label: string
  /** Max tokens for output (per call). */
  maxOutputTokens: number
  /** Temperature default. */
  defaultTemperature: number
}

export const DEFAULT_MODELS: Record<ModelTier, ModelConfig> = {
  creative: {
    id: 'claude-opus-4-1-20250805',
    label: 'Claude Opus 4.1',
    // Opus 4.x supports up to 32K output tokens. We headroom so prose-heavy
    // creative tasks (synopses, scene drafts, character bibles) don't get
    // truncated mid-paragraph.
    maxOutputTokens: 8192,
    defaultTemperature: 0.8,
  },
  balanced: {
    id: 'claude-sonnet-4-5-20250929',
    label: 'Claude Sonnet 4.5',
    // Sonnet 4.5 supports up to 64K output tokens. Beat sheets and outlines
    // can easily run 8–12K tokens for a feature script. 16K is the safe
    // default; callers may pass higher per-task overrides.
    maxOutputTokens: 16384,
    defaultTemperature: 0.6,
  },
  fast: {
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    maxOutputTokens: 2048,
    defaultTemperature: 0.5,
  },
}

/** Task-to-tier routing. */
export type AITask =
  // Overview / planning prose (creative)
  | 'logline' | 'short_summary' | 'long_synopsis' | 'central_question'
  | 'story_engine' | 'theme_question' | 'world_rules' | 'hard_constraints'
  | 'stakes' | 'tone'
  // Characters (creative)
  | 'character_full_bible' | 'character_field' | 'character_voice'
  // Beats / structure (balanced)
  | 'beat_generate_full' | 'beat_fill_fields' | 'beat_substance_check'
  | 'scene_card_generate' | 'scene_card_fill'
  // Writing (creative)
  | 'draft_scene' | 'draft_action' | 'draft_dialogue'
  | 'punch_up_dialogue' | 'rewrite_paragraph'
  // Vertical (creative — on-the-nose register)
  | 'vertical_episode' | 'vertical_loop' | 'vertical_trope_stack'
  // Diagnostics / extraction (balanced)
  | 'diagnose_section' | 'extract_facts' | 'extract_characters'
  // Modify (creative for content, balanced for structure)
  | 'modify_setting' | 'modify_genre' | 'modify_tone' | 'modify_format'
  // Series-level (balanced)
  | 'season_plan' | 'series_engine'

export const TASK_TIER: Record<AITask, ModelTier> = {
  logline: 'creative',
  short_summary: 'creative',
  long_synopsis: 'creative',
  central_question: 'creative',
  story_engine: 'creative',
  theme_question: 'creative',
  world_rules: 'balanced',
  hard_constraints: 'balanced',
  stakes: 'creative',
  tone: 'balanced',

  character_full_bible: 'creative',
  character_field: 'creative',
  character_voice: 'creative',

  beat_generate_full: 'balanced',
  beat_fill_fields: 'balanced',
  beat_substance_check: 'balanced',
  scene_card_generate: 'balanced',
  scene_card_fill: 'balanced',

  draft_scene: 'creative',
  draft_action: 'creative',
  draft_dialogue: 'creative',
  punch_up_dialogue: 'creative',
  rewrite_paragraph: 'creative',

  vertical_episode: 'creative',
  vertical_loop: 'creative',
  vertical_trope_stack: 'balanced',

  diagnose_section: 'balanced',
  extract_facts: 'balanced',
  extract_characters: 'balanced',

  modify_setting: 'creative',
  modify_genre: 'creative',
  modify_tone: 'creative',
  modify_format: 'balanced',

  season_plan: 'balanced',
  series_engine: 'balanced',
}

/** Resolve the model for a given task, applying user overrides. */
export function resolveModel(
  task: AITask,
  overrides?: Partial<Record<ModelTier, ModelConfig>>,
): ModelConfig {
  const tier = TASK_TIER[task]
  if (overrides && overrides[tier]) return overrides[tier]!
  return DEFAULT_MODELS[tier]
}
