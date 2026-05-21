/**
 * AI Provider Abstraction.
 *
 * Pluggable provider interface. The MVP ships with stubs for OpenAI-compatible
 * and Anthropic-compatible endpoints. Real implementations call the user-
 * configured provider with the user's API key (stored in app settings).
 *
 * Every AI response runs through the Thinking Layer (pre-mortem, plan,
 * draft, self-critique) before reaching the user. All output is post-
 * processed by the humanization pipeline (em-dash stripping, AI-tell scrubbing).
 */

import { deepStripEmDashes } from '@/lib/humanization'

export type ProviderId = 'openai' | 'anthropic' | 'local' | 'none'

export interface AICompletionInput {
  systemPrompt: string
  userPrompt: string
  // Optional: structured context (project metadata, scene plan, etc.).
  context?: unknown
  // Provider-agnostic settings.
  temperature?: number
  maxTokens?: number
}

export interface AICompletionOutput {
  text: string
  provider: ProviderId
  // The plan the AI internally generated (if the Thinking Layer was used).
  plan?: string
  // The self-critique (if generated).
  critique?: string
}

export interface AIProvider {
  id: ProviderId
  label: string
  available: boolean
  // Run a completion. Concrete provider implementations will be filled in by
  // their respective adapter files. Until then, this returns a placeholder.
  complete(input: AICompletionInput): Promise<AICompletionOutput>
}

/** Provider-not-configured fallback. Always returns an explanatory string. */
export const NULL_PROVIDER: AIProvider = {
  id: 'none',
  label: 'No provider configured',
  available: false,
  async complete(): Promise<AICompletionOutput> {
    return {
      text: 'AI provider not configured. Open Settings to add your API key.',
      provider: 'none',
    }
  },
}

/** Adapter factory. Returns the configured provider or NULL_PROVIDER. */
export function getProvider(_id: ProviderId): AIProvider {
  // Real adapters (openai-adapter.ts, anthropic-adapter.ts) are post-MVP.
  // The scaffolding is in place; concrete network calls plug in here.
  return NULL_PROVIDER
}

/**
 * Run an AI request with the Thinking Layer: pre-mortem, plan, draft,
 * self-critique. Each step is its own provider call. The final draft is
 * humanization-sanitized before return.
 */
export async function thinkAndDraft(
  provider: AIProvider,
  input: AICompletionInput,
): Promise<AICompletionOutput> {
  // Pre-mortem: enumerate failure modes.
  const preMortem = await provider.complete({
    systemPrompt: input.systemPrompt + '\n\n' + PRE_MORTEM_INSTRUCTIONS,
    userPrompt: input.userPrompt,
    temperature: 0.4,
  })

  // Plan: produce a structured plan.
  const plan = await provider.complete({
    systemPrompt: input.systemPrompt + '\n\n' + PLAN_INSTRUCTIONS,
    userPrompt: input.userPrompt + '\n\nPre-mortem (silent guidance):\n' + preMortem.text,
    temperature: 0.5,
  })

  // Draft from the plan.
  const draft = await provider.complete({
    systemPrompt: input.systemPrompt + '\n\n' + DRAFT_INSTRUCTIONS,
    userPrompt: input.userPrompt + '\n\nPlan:\n' + plan.text,
    temperature: input.temperature ?? 0.7,
    maxTokens: input.maxTokens,
  })

  // Self-critique.
  const critique = await provider.complete({
    systemPrompt: input.systemPrompt + '\n\n' + CRITIQUE_INSTRUCTIONS,
    userPrompt: 'Critique this draft as a skeptical reader. Identify weaknesses; do not flatter:\n\n' + draft.text,
    temperature: 0.3,
  })

  // Revision pass.
  const final = await provider.complete({
    systemPrompt: input.systemPrompt + '\n\n' + REVISION_INSTRUCTIONS,
    userPrompt: 'Revise the draft to address the critique. Keep what works.\n\nDraft:\n' + draft.text + '\n\nCritique:\n' + critique.text,
    temperature: input.temperature ?? 0.6,
    maxTokens: input.maxTokens,
  })

  return deepStripEmDashes({
    text: final.text,
    provider: provider.id,
    plan: plan.text,
    critique: critique.text,
  })
}

const PRE_MORTEM_INSTRUCTIONS = `Before producing the requested output, list the three most likely ways it will be bad. Be specific. Examples of common failure modes:
- generic dialogue with no distinct voice
- missing scene turn (opening and closing values are the same)
- on-the-nose theme statement in dialogue
- unmotivated character behavior
- voice drift between characters
- pacing flatline (no rising tension)
- weak hook (no question raised, no surprise, no escalation)
Return only the enumerated list. Be terse.`

const PLAN_INSTRUCTIONS = `Plan the scene/beat/draft in this structure:
1. Opening value (one phrase: e.g., "trust")
2. Pressure mechanism (what creates the conflict)
3. Tactic shifts (how characters change approach)
4. Closing value (the flip)
5. Audience knowledge delta (what they learn)
6. Setup planted or payoff triggered (if any)
Return only the structured plan. No prose.`

const DRAFT_INSTRUCTIONS = `Write the draft from the plan. Hard rules:
- Action lines: only what can be seen and heard. No interiority. No "feels", "thinks", "knows".
- Action paragraphs: 1-4 lines max. Sentence fragments are fine.
- Dialogue: distinct voices per character. No two characters should sound the same.
- No em dashes ever. Use "--" in dialogue for interruption, or rewrite.
- No "However", "Moreover", "Therefore", "Furthermore", "Consequently", "Subsequently".
- No AI tells. No corporate hedging. No "It is worth noting".
- Characters: first appearance ALL CAPS with a brief visual; normal case thereafter.
Return only the screenplay text. No commentary.`

const CRITIQUE_INSTRUCTIONS = `You are a skeptical professional reader. Identify weaknesses in the draft. For each:
- name the problem in one sentence
- name the craft principle it violates
- give a one-line fix
Be terse. Do not flatter.`

const REVISION_INSTRUCTIONS = `Revise the draft to address every critique. Keep what works. Apply all hard rules from the draft instructions. Return only the revised screenplay text.`
