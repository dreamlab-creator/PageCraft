/**
 * Master Intake AI tasks.
 *
 * The intake wizard collects (a) writer-supplied source material and (b)
 * a free-text brief stating what the writer wants done with it. These
 * tasks turn that pile into a fully-populated project scaffold.
 *
 * The pipeline is deliberately broken into many small focused calls so
 * (1) the wizard can show real progress at each step, (2) any single
 * failure rolls back at most one step, and (3) the model's context
 * window is never blown by re-sending the raw script over and over.
 *
 *   1. classifyIntakeIntent       — what does the writer want?
 *   2. detectFormatFromMaterials  — which preset fits?
 *   3. ingestSourceChunk          — per-chunk extraction → SourceDigest
 *      (multiple calls, merged into mergeDigests below)
 *   4. synthesizeLogline          — short
 *   5. synthesizeShortSummary     — short
 *   6. synthesizeLongSynopsis     — medium
 *   7. synthesizeThemesAndStakes  — medium
 *   8. synthesizeEngineAndWorld   — medium
 *   9. synthesizeFoundationalGuidance + open questions — short
 *  10. synthesizeCastBatch        — chunked, 2 characters at a time
 *
 * Every call uses the intake-specific runIntakeJSON pipeline (defined
 * below). That pipeline ships a LEAN system prompt — intake is input
 * extraction, not output generation, so the project's full constitutional
 * craft rules (em-dash policy, prose discipline, reference samples) are
 * deliberately omitted to keep request sizes small and latencies short.
 */

import type { Character, FormatKind, FormatConfig } from '@/types'
import { PRESETS, PRESET_LIST } from '@/lib/formats'
import {
  aiCharacterToCharacter,
  type AICharacter,
  type TaskInput,
  type TaskOutcome,
} from './tasks'
import { resolveModel, type AITask } from './models'
import { completeWithSystem, AnthropicError } from './anthropic'
import { extractJSON } from './tasks'
import {
  composeIntakeExcerpt,
  truncateForPrompt,
  type IntakeMaterial,
  type SourceChunk,
} from '@/lib/intake/readers'

/* ============================================================================
 * Intake-specific runJSON
 *
 * The standard `runJSON` from tasks.ts wraps every call in the project's
 * full constitutional system prompt — ~12K input tokens of PROSE_DISCIPLINE,
 * HARD_RULES, INDUSTRY_REFERENCE_SAMPLES, etc. Those are tuned for OUTPUT
 * generation (drafting prose, writing pages); intake calls are INPUT
 * extraction (digesting a script, classifying intent). The constitution
 * adds no value here and risks the request stalling or timing out.
 *
 * This helper sends a LEAN system prompt — just a sentence or two
 * naming the role — and the task-specific instructions in the user
 * prompt. Cuts request size by ~10x on a typical intake call.
 *
 * It also surfaces concrete diagnostic logs (`call started`, `call
 * completed in Xms`, `call failed: …`) so a hung or slow call is
 * traceable in the browser console.
 */
const LEAN_SYSTEM_PROMPT = `You are an analyst working on a screenwriter's project intake. Your job is to read writer-supplied source material and produce structured JSON answers. Be specific, concrete, and grounded in what's on the page — never invent. When asked for JSON, return ONLY valid JSON, no markdown fences, no prose preamble. When a field has no content to extract, return an empty string or empty array; do not produce filler text.`

export async function runIntakeJSON<T>(
  task: AITask,
  input: TaskInput,
  userInstructions: string,
  maxTokens: number,
  /** Hard timeout for this call in ms. Default 180s (longer than the global 120s for safety). */
  timeoutMs = 180_000,
): Promise<TaskOutcome<T>> {
  const model = resolveModel(task, input.modelOverrides)
  const started = Date.now()
  const label = `intake/${task}`
  // eslint-disable-next-line no-console
  console.log(`[PageCraft] ${label} → starting (model: ${model.id}, maxTokens: ${maxTokens}, timeout: ${timeoutMs}ms)`)
  try {
    const res = await completeWithSystem({
      apiKey: input.apiKey,
      model: model.id,
      systemPrompt: LEAN_SYSTEM_PROMPT,
      userPrompt: userInstructions + '\n\nReturn ONLY valid JSON. No prose. No markdown fences.',
      maxTokens,
      temperature: model.defaultTemperature,
      signal: input.signal,
      timeoutMs,
    })
    const parsed = extractJSON<T>(res.text)
    const elapsed = Date.now() - started
    if (!parsed) {
      const truncated = res.stopReason === 'max_tokens'
      // eslint-disable-next-line no-console
      console.warn(`[PageCraft] ${label} → JSON parse failed in ${elapsed}ms (stopReason: ${res.stopReason}, rawLen: ${res.text.length})`)
      return {
        ok: false,
        error: truncated
          ? `The response was cut off before completing (hit max output tokens at ${maxTokens}).`
          : `The model returned text that wasn't recognizable JSON.`,
        truncated,
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[PageCraft] ${label} → completed in ${elapsed}ms`)
    return { ok: true, value: parsed, raw: res.text, modelId: res.model }
  } catch (e) {
    const elapsed = Date.now() - started
    if (e instanceof AnthropicError) {
      // eslint-disable-next-line no-console
      console.warn(`[PageCraft] ${label} → failed in ${elapsed}ms: ${e.type} (${e.status}): ${e.message}`)
      const truncated = e.status === 400 && /max_tokens|too long|context length/i.test(e.message)
      return { ok: false, error: e.message, status: e.status, truncated }
    }
    // eslint-disable-next-line no-console
    console.warn(`[PageCraft] ${label} → failed in ${elapsed}ms:`, e)
    return { ok: false, error: (e as Error).message }
  }
}

/* ============================================================================
 * Shape of the wizard's results
 * ========================================================================= */

export type IntakeIntent =
  | 'transform'
  | 'continue'
  | 'adapt'
  | 'inspire'
  | 'unknown'

export interface ClassifiedIntent {
  intent: IntakeIntent
  summary: string
  directives: string[]
  confidence: 'low' | 'medium' | 'high'
}

export interface FormatRecommendation {
  presetKind: FormatKind
  label: string
  confidence: 'low' | 'medium' | 'high'
  reasoning: string
  alternatives: Array<{ presetKind: FormatKind; label: string; rationale: string }>
}

/**
 * Compact, structured summary of what's in the source material — one
 * digest per chunk, merged into a single project-level digest before
 * synthesis runs. Subsequent tasks read THIS, not the raw text. ~10x
 * smaller payload per call.
 */
export interface SourceDigest {
  /** Free-form one-paragraph description of what the source IS. */
  oneLineRecap: string
  /** Characters seen, deduplicated by name. */
  characters: Array<{
    name: string
    impliedRole?: string
    ageGuess?: string
    description?: string
    voiceNotes?: string
    sampleLines?: string[]
  }>
  /** Locations / settings the source visits. */
  locations: string[]
  /** Structural beats the source plays through, in order. */
  beats: Array<{ pageHint?: string; summary: string }>
  /** Themes the source seems to be about. */
  themes: string[]
  /** Tonal qualities — adjectives describing register and feel. */
  tone: string[]
  /** World rules / canon facts that govern this fiction. */
  worldRules: string[]
  /** Dialogue / prose style notes — voice cadence, vocabulary, density. */
  styleNotes: string
  /** Anything else worth flagging for the synthesis stage. */
  notes: string
}

export interface IntakeOverview {
  title: string
  logline: string
  shortSummary: string
  longSynopsis: string
  themes: string[]
  themeQuestion: string
  centralDramaticQuestion: string
  storyEngine: string
  worldRules: string[]
  externalStakes: string
  internalStakes: string
  foundationalGuidance: string
  openQuestions: string[]
}

/* ============================================================================
 * Small utilities
 * ========================================================================= */

function intentInstructionBlock(intent: IntakeIntent): string {
  switch (intent) {
    case 'transform':
      return `TRANSFORM intent — same story shape (beats, structure, character roles, arc) but a different WORLD. Every reference, character name, location, prop must shift to the new world. Structure is the constant; surface is the variable.`
    case 'continue':
      return `CONTINUE intent — the source is canon. Thread directly into the established world, characters, and themes. Do not relitigate what's settled.`
    case 'adapt':
      return `ADAPT intent — the source is a finished work in another medium. Adapt its spine into the target screenplay format. Compress / drop / externalize as serves the screenplay; the source is not a contract.`
    case 'inspire':
      return `INSPIRE intent — the source is foundation, not source material. Build a fresh original work that USES the materials as backdrop, not as plot.`
    default:
      return `Read the source carefully; decide what kind of project this should be.`
  }
}

function directiveBlock(intent: ClassifiedIntent): string {
  return intent.directives.length
    ? `\n\nWRITER DIRECTIVES (absolute):\n${intent.directives.map(d => `  • ${d}`).join('\n')}`
    : ''
}

/** Render a merged digest as a compact prompt block. */
function renderDigest(d: SourceDigest, maxChars = 8000): string {
  const parts: string[] = []
  parts.push(`SOURCE DIGEST (PageCraft's read of the uploaded material):`)
  if (d.oneLineRecap) parts.push(`Recap: ${d.oneLineRecap}`)
  if (d.tone.length) parts.push(`Tone: ${d.tone.join(', ')}`)
  if (d.styleNotes) parts.push(`Style notes: ${d.styleNotes}`)
  if (d.themes.length) parts.push(`Themes the source touches: ${d.themes.join(' · ')}`)
  if (d.locations.length) parts.push(`Locations: ${d.locations.slice(0, 24).join(' · ')}`)
  if (d.worldRules.length) {
    parts.push('World rules / canon facts:')
    for (const r of d.worldRules.slice(0, 12)) parts.push(`  - ${r}`)
  }
  if (d.characters.length) {
    parts.push(`Characters identified (${d.characters.length}):`)
    for (const c of d.characters.slice(0, 24)) {
      const role = c.impliedRole ? ` (${c.impliedRole})` : ''
      const age = c.ageGuess ? `, ${c.ageGuess}` : ''
      const desc = c.description ? ` — ${c.description}` : ''
      const voice = c.voiceNotes ? ` Voice: ${c.voiceNotes}` : ''
      const samples = (c.sampleLines && c.sampleLines.length)
        ? ` Sample lines: ${c.sampleLines.slice(0, 2).map(s => `"${s}"`).join(' / ')}`
        : ''
      parts.push(`  - ${c.name}${role}${age}${desc}${voice}${samples}`)
    }
  }
  if (d.beats.length) {
    parts.push(`Structural beats observed (${d.beats.length}, in order):`)
    for (const b of d.beats.slice(0, 28)) parts.push(`  - ${b.pageHint ? `[${b.pageHint}] ` : ''}${b.summary}`)
  }
  if (d.notes) parts.push(`Notes: ${d.notes}`)
  return truncateForPrompt(parts.join('\n'), maxChars)
}

/* ============================================================================
 * 1. Classify the writer's intent
 * ========================================================================= */

export async function classifyIntakeIntent(
  input: TaskInput,
  args: { brief: string; materials: IntakeMaterial[] },
): Promise<TaskOutcome<ClassifiedIntent>> {
  const excerpt = composeIntakeExcerpt(args.materials, { perFileChars: 3000, totalChars: 16000 })
  const fileList = args.materials.length
    ? args.materials.map(m => `  - ${m.filename} [${m.format}${m.pageCount ? `, ${m.pageCount}p` : ''}, ${m.text.length} chars]`).join('\n')
    : '  (none)'

  const prompt = `Classify what the writer wants done with the uploaded source material.

WRITER'S BRIEF:
${args.brief.trim() || '(no brief)'}

FILES:
${fileList}

SAMPLED OPENING:
${excerpt || '(none)'}

Pick ONE intent:
- "transform" — same shape, different world (rewrite, gender-swap, era-swap, world-swap).
- "continue"  — existing show / project; scaffold the next material (season, episode, draft).
- "adapt"     — finished work in another medium → screenplay.
- "inspire"   — research / notes / mood; build NEW project on top.

Produce:
- summary: ONE sentence restating the writer's intent in your own words. Specific.
- directives: 3–8 concrete directives (e.g., "Target 90 pages", "Replace space-station setting with redwood forest", "Limit to 5 characters").
- confidence: low / medium / high.

Return JSON: { "intent":"...", "summary":"...", "directives":["..."], "confidence":"..." }`

  const res = await runIntakeJSON<ClassifiedIntent>('extract_facts', input, prompt, 1500)
  if (!res.ok) return res
  const v = res.value as Partial<ClassifiedIntent>
  return {
    ...res,
    value: {
      intent: (v.intent as IntakeIntent) ?? 'unknown',
      summary: v.summary ?? '',
      directives: Array.isArray(v.directives) ? v.directives.filter(Boolean) : [],
      confidence: (v.confidence as ClassifiedIntent['confidence']) ?? 'medium',
    },
  }
}

/* ============================================================================
 * 2. Detect the appropriate format
 * ========================================================================= */

export async function detectFormatFromMaterials(
  input: TaskInput,
  args: { materials: IntakeMaterial[]; intent: ClassifiedIntent; brief: string },
): Promise<TaskOutcome<FormatRecommendation>> {
  const excerpt = composeIntakeExcerpt(args.materials, { perFileChars: 4000, totalChars: 16000 })
  const presetOptions = PRESET_LIST.map(p =>
    `  - kind="${p.kind}" → ${p.label} (${p.structure.targetPagesMin}–${p.structure.targetPagesMax} pages, ${p.medium}, ${p.audience}, ${p.genres.join('/')})`,
  ).join('\n')

  const prompt = `Pick the screenplay preset that best fits the source material and the writer's intent.

BRIEF: ${args.brief.trim() || '(none)'}
INTENT: ${args.intent.intent} — ${args.intent.summary}${directiveBlock(args.intent)}

SAMPLED CONTENT:
${excerpt || '(none)'}

PRESETS:
${presetOptions}

Decide based on page count of the longest source, scene length, dialogue density, tone, and any explicit format directive in the writer's brief.

Return JSON: { "presetKind":"...", "label":"...", "confidence":"...", "reasoning":"...", "alternatives":[{"presetKind":"...","label":"...","rationale":"..."}] }`

  const res = await runIntakeJSON<FormatRecommendation>('extract_facts', input, prompt, 1500)
  if (!res.ok) return res
  const v = res.value as Partial<FormatRecommendation>
  const presetKind = (v.presetKind && PRESETS[v.presetKind] ? v.presetKind : 'feature_drama') as FormatKind
  return {
    ...res,
    value: {
      presetKind,
      label: v.label ?? PRESETS[presetKind].label,
      confidence: (v.confidence as FormatRecommendation['confidence']) ?? 'medium',
      reasoning: v.reasoning ?? '',
      alternatives: Array.isArray(v.alternatives)
        ? v.alternatives
            .filter(a => a && a.presetKind && PRESETS[a.presetKind])
            .map(a => ({
              presetKind: a.presetKind as FormatKind,
              label: a.label ?? PRESETS[a.presetKind!].label,
              rationale: a.rationale ?? '',
            }))
        : [],
    },
  }
}

/* ============================================================================
 * 3. Ingest one source chunk → SourceDigest
 *
 * Called once per ~15K-char chunk. Each call is small and fast so the
 * wizard can tick a real progress bar between them. The wizard merges
 * the resulting per-chunk digests into a single project digest before
 * the synthesis steps run.
 * ========================================================================= */

export async function ingestSourceChunk(
  input: TaskInput,
  args: { chunk: SourceChunk; intent: ClassifiedIntent },
): Promise<TaskOutcome<SourceDigest>> {
  const prompt = `Read this excerpt from the writer's source material and extract a structured digest. This is PASS 1 of intake — the project doesn't exist yet, you're just inventorying what the source contains.

INTENT CONTEXT: ${args.intent.intent} — ${args.intent.summary}

SOURCE: ${args.chunk.filename} [${args.chunk.format}], chunk ${args.chunk.index + 1} of ${args.chunk.total}${args.chunk.pageHint ? ` (${args.chunk.pageHint})` : ''}.

EXCERPT:
${args.chunk.text}

Extract what you can from THIS CHUNK ONLY. Do not invent. Do not project beyond what's on the page. If a field has nothing to extract from this chunk, leave it empty.

Return JSON with these fields:
- oneLineRecap: one sentence describing what happens in this chunk.
- characters: array of every NAMED character that appears. For each: { name, impliedRole, ageGuess, description, voiceNotes, sampleLines: up to 3 representative lines they speak in this chunk }.
- locations: array of slug-line-style settings ("INT. APARTMENT - NIGHT", "EXT. ALLEY - DAY") or location names.
- beats: array of 3–8 structural beats covered in this chunk, in story order. Each beat: { pageHint, summary } where summary is 1–2 sentences naming what changes.
- themes: array of theme tags the source seems to be about (one to three words each).
- tone: array of adjectives describing the register / feel.
- worldRules: array of canon facts that govern the fiction (physical, social, magical, technological).
- styleNotes: 1–2 sentences on dialogue cadence, vocabulary register, action-line density.
- notes: anything else worth flagging (continuity questions, unanswered hooks, structural surprises).

Return JSON exactly: { "oneLineRecap":"...", "characters":[...], "locations":[...], "beats":[...], "themes":[...], "tone":[...], "worldRules":[...], "styleNotes":"...", "notes":"..." }`

  const res = await runIntakeJSON<SourceDigest>('extract_facts', input, prompt, 4000)
  if (!res.ok) return res
  const v = (res.value ?? {}) as Partial<SourceDigest>
  return {
    ...res,
    value: {
      oneLineRecap: v.oneLineRecap ?? '',
      characters: Array.isArray(v.characters) ? v.characters.filter(c => c && c.name) : [],
      locations: Array.isArray(v.locations) ? v.locations.filter(Boolean) : [],
      beats: Array.isArray(v.beats) ? v.beats.filter(b => b && b.summary) : [],
      themes: Array.isArray(v.themes) ? v.themes.filter(Boolean) : [],
      tone: Array.isArray(v.tone) ? v.tone.filter(Boolean) : [],
      worldRules: Array.isArray(v.worldRules) ? v.worldRules.filter(Boolean) : [],
      styleNotes: v.styleNotes ?? '',
      notes: v.notes ?? '',
    },
  }
}

/** Merge per-chunk digests into a single project-level digest. */
export function mergeDigests(digests: SourceDigest[]): SourceDigest {
  if (digests.length === 0) {
    return {
      oneLineRecap: '',
      characters: [],
      locations: [],
      beats: [],
      themes: [],
      tone: [],
      worldRules: [],
      styleNotes: '',
      notes: '',
    }
  }

  const charsByName = new Map<string, SourceDigest['characters'][number]>()
  for (const d of digests) {
    for (const c of d.characters) {
      const key = c.name.toUpperCase()
      if (!charsByName.has(key)) {
        charsByName.set(key, { ...c, sampleLines: [...(c.sampleLines ?? [])] })
      } else {
        const existing = charsByName.get(key)!
        existing.impliedRole = existing.impliedRole || c.impliedRole
        existing.ageGuess = existing.ageGuess || c.ageGuess
        existing.description = existing.description || c.description
        existing.voiceNotes = existing.voiceNotes || c.voiceNotes
        const lines = [...(existing.sampleLines ?? []), ...(c.sampleLines ?? [])]
        existing.sampleLines = Array.from(new Set(lines)).slice(0, 6)
      }
    }
  }

  const dedupe = (arr: string[]): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const s of arr) {
      const k = s.trim().toLowerCase()
      if (!k || seen.has(k)) continue
      seen.add(k)
      out.push(s.trim())
    }
    return out
  }

  return {
    oneLineRecap: digests[0].oneLineRecap || digests.map(d => d.oneLineRecap).filter(Boolean).join(' ').slice(0, 400),
    characters: Array.from(charsByName.values()),
    locations: dedupe(digests.flatMap(d => d.locations)),
    beats: digests.flatMap(d => d.beats),
    themes: dedupe(digests.flatMap(d => d.themes)),
    tone: dedupe(digests.flatMap(d => d.tone)),
    worldRules: dedupe(digests.flatMap(d => d.worldRules)),
    styleNotes: digests.map(d => d.styleNotes).filter(Boolean).join(' / ').slice(0, 800),
    notes: digests.map(d => d.notes).filter(Boolean).join(' / ').slice(0, 1200),
  }
}

/* ============================================================================
 * 4–6. Small synthesis tasks driven from the merged digest.
 *
 * Each call is focused, fast, and fits comfortably inside any model's
 * context window. The wizard runs them sequentially; the progress bar
 * ticks forward as each one returns.
 * ========================================================================= */

interface SynthesisContext {
  digest: SourceDigest
  intent: ClassifiedIntent
  brief: string
  format: FormatConfig
}

function baseSynthesisBlock(ctx: SynthesisContext): string {
  return `${intentInstructionBlock(ctx.intent.intent)}

WRITER'S BRIEF: ${ctx.brief.trim() || '(none)'}${directiveBlock(ctx.intent)}

TARGET FORMAT: ${ctx.format.label} (${ctx.format.structure.targetPagesMin}–${ctx.format.structure.targetPagesMax} pages, ${ctx.format.genres.join('/')})

${renderDigest(ctx.digest)}`
}

export async function synthesizeTitleAndLogline(
  input: TaskInput,
  ctx: SynthesisContext,
): Promise<TaskOutcome<{ title: string; logline: string }>> {
  const prompt = `${baseSynthesisBlock(ctx)}

Produce a project title and a logline.

- title: For TRANSFORM intent, the NEW-world title from the brief. For CONTINUE, the existing show + season designation. For ADAPT, a working adaptation title. For INSPIRE, an original title that fits the new project.
- logline: ONE sentence, 40 words max, present tense. Names the protagonist + the opportunity / threat + what's at stake. Modeled on industry conventions.

Return JSON: { "title":"...", "logline":"..." }`

  return runIntakeJSON<{ title: string; logline: string }>('logline', input, prompt, 600)
}

export async function synthesizeShortSummary(
  input: TaskInput,
  ctx: SynthesisContext & { title: string; logline: string },
): Promise<TaskOutcome<{ shortSummary: string }>> {
  const prompt = `${baseSynthesisBlock(ctx)}

You've already produced:
- Title: ${ctx.title}
- Logline: ${ctx.logline}

Now produce a short summary. One paragraph, 60–100 words, present tense, walking the arc from opening through climax. For TRANSFORM intent, every reference is to the NEW world.

Return JSON: { "shortSummary":"..." }`

  return runIntakeJSON<{ shortSummary: string }>('short_summary', input, prompt, 1000)
}

export async function synthesizeLongSynopsis(
  input: TaskInput,
  ctx: SynthesisContext & { title: string; logline: string; shortSummary: string },
): Promise<TaskOutcome<{ longSynopsis: string }>> {
  // Scale the synopsis word target to the project's actual page target.
  // The legacy "350–500 words" was sensible for features but absurd for a
  // 2-page vertical episode or a 5-page short film. Roughly 4 words per
  // script page lands at industry-standard coverage density:
  //
  //   Pages       Synopsis target
  //   1–2         30–70 words   (one short paragraph)
  //   3–10        60–150 words  (one paragraph)
  //   11–35       120–280 words (sitcom / half-hour / short)
  //   36–60       220–400 words (TV hour / short feature)
  //   61–100      320–520 words (feature)
  //   101+        450–700 words (epic feature / pilot+)
  //
  // The AI is explicitly told NOT to pad. A 2-page project gets a one-
  // paragraph synopsis — never a 400-word essay.
  const pages = ctx.format.structure.targetPagesMax || ctx.format.structure.targetPagesMin || 90
  const synopsisRange = synopsisWordRangeForPages(pages)

  const prompt = `${baseSynthesisBlock(ctx)}

You've already produced:
- Title: ${ctx.title}
- Logline: ${ctx.logline}
- Short summary: ${ctx.shortSummary}

PAGE TARGET FOR THIS PROJECT: ~${pages} pages.

Now produce a long synopsis SCALED TO THE PAGE TARGET ABOVE. Word target: ${synopsisRange.min}–${synopsisRange.max} words.
- DO NOT pad to hit a fixed length. If the project is a 2-page short, your synopsis is a single short paragraph. If the project is a 90-page feature, your synopsis walks the major beats in 400-ish words.
- The synopsis must read like a synopsis a producer would skim for a script of THIS length — not a feature-length synopsis hammered onto a short story.
- Structured paragraphs walking the major beats from open to climax to resolution, at whatever density fits the page count.
- For TRANSFORM intent, every reference is to the NEW world.

Return JSON: { "longSynopsis":"..." }`

  // Output token cap roughly scales with the synopsis word target.
  const tokenCap = Math.max(800, Math.min(4000, Math.round(synopsisRange.max * 4)))
  return runIntakeJSON<{ longSynopsis: string }>('long_synopsis', input, prompt, tokenCap)
}

/**
 * Map a script page count to a synopsis word-count range. The shape is
 * "roughly 3–5 words of synopsis per script page" with a soft floor at
 * 30 words (anything shorter is just the logline restated).
 */
export function synopsisWordRangeForPages(pages: number): { min: number; max: number } {
  if (pages <= 2)   return { min: 30, max: 70 }
  if (pages <= 10)  return { min: 60, max: 150 }
  if (pages <= 35)  return { min: 120, max: 280 }
  if (pages <= 60)  return { min: 220, max: 400 }
  if (pages <= 100) return { min: 320, max: 520 }
  return { min: 450, max: 700 }
}

export async function synthesizeThemesAndStakes(
  input: TaskInput,
  ctx: SynthesisContext & { title: string; logline: string; shortSummary: string; longSynopsis: string },
): Promise<TaskOutcome<{ themes: string[]; themeQuestion: string; externalStakes: string; internalStakes: string }>> {
  const prompt = `${baseSynthesisBlock(ctx)}

You've already produced:
- Title: ${ctx.title}
- Logline: ${ctx.logline}
- Synopsis: ${ctx.shortSummary}

Now produce theme + stakes.

- themes: 4–8 short tags (1–3 words each).
- themeQuestion: one sentence stating the central thematic question.
- externalStakes: one paragraph naming what the protagonist loses externally if they fail.
- internalStakes: one paragraph naming what they lose internally — who they'll have become.

Return JSON: { "themes":["..."], "themeQuestion":"...", "externalStakes":"...", "internalStakes":"..." }`

  return runIntakeJSON<{ themes: string[]; themeQuestion: string; externalStakes: string; internalStakes: string }>('stakes', input, prompt, 1500)
}

export async function synthesizeEngineAndWorld(
  input: TaskInput,
  ctx: SynthesisContext & { title: string; logline: string; longSynopsis: string },
): Promise<TaskOutcome<{ storyEngine: string; centralDramaticQuestion: string; worldRules: string[] }>> {
  const prompt = `${baseSynthesisBlock(ctx)}

You've already produced:
- Title: ${ctx.title}
- Logline: ${ctx.logline}

Now produce engine + world.

- storyEngine: 1–3 sentences describing the mechanism that GENERATES scenes — the recurring pressure, the structural device, the cat-and-mouse, the loop.
- centralDramaticQuestion: one sentence (Yes/No form ok): "Will <protagonist> <goal> before <deadline>?"
- worldRules: 3–8 short rules describing how this world works (physical, social, political, moral). Concrete, not abstract.

Return JSON: { "storyEngine":"...", "centralDramaticQuestion":"...", "worldRules":["..."] }`

  return runIntakeJSON<{ storyEngine: string; centralDramaticQuestion: string; worldRules: string[] }>('story_engine', input, prompt, 1500)
}

export async function synthesizeFoundationalGuidance(
  input: TaskInput,
  ctx: SynthesisContext & { title: string; logline: string; shortSummary: string },
): Promise<TaskOutcome<{ foundationalGuidance: string; openQuestions: string[] }>> {
  const prompt = `${baseSynthesisBlock(ctx)}

You've already produced:
- Title: ${ctx.title}
- Logline: ${ctx.logline}
- Short summary: ${ctx.shortSummary}

Now produce the project's foundational guidance — the constitutional block PageCraft will ship with every later AI call to keep generations anchored.

- foundationalGuidance: a multi-line block, one directive per line. Restate the writer's directives explicitly (page target, character cap, subgenre, register). Add any constraints YOU inferred (e.g., "Maintain comedic tone consistent with the source", "Setting period: 1990s small-town America"). This becomes constitutional law going forward.
- openQuestions: 2–6 specific things the writer should confirm — fields you guessed at because the source didn't say. Format each as a direct question. Never include filler ("is this what you want?").

Return JSON: { "foundationalGuidance":"...", "openQuestions":["..."] }`

  return runIntakeJSON<{ foundationalGuidance: string; openQuestions: string[] }>('hard_constraints', input, prompt, 1500)
}

/* ============================================================================
 * 7. Plan the cast — one quick call to decide WHO and HOW MANY before
 *    generating the bibles in batches.
 * ========================================================================= */

export interface CastSeed {
  name: string
  role: Character['role']
}

export async function planCastFromDigest(
  input: TaskInput,
  ctx: SynthesisContext & { title: string; logline: string; shortSummary: string },
): Promise<TaskOutcome<{ seeds: CastSeed[] }>> {
  const cap = ctx.format.substanceTargets?.namedCharacters?.max ?? 8
  const idealCap = ctx.format.substanceTargets?.namedCharacters?.ideal ?? 6

  const prompt = `${baseSynthesisBlock(ctx)}

You've already produced:
- Title: ${ctx.title}
- Logline: ${ctx.logline}
- Short summary: ${ctx.shortSummary}

Now plan the cast — names + roles ONLY, no bibles yet (those come next in batches).

How to choose names:
${ctx.intent.intent === 'transform'
  ? `For each character in the source digest above, build the equivalent character in the NEW world. Keep the dramatic FUNCTION (protagonist, antagonist, ally, etc.); REPLACE the surface — name, profession, era — so the character belongs to the new world. Do NOT use any name from the source.`
  : ctx.intent.intent === 'continue'
  ? `Copy the existing characters from the source AS-IS. Names, ages, roles all stay. You're populating the cast list with what's already canon.`
  : ctx.intent.intent === 'adapt'
  ? `For each meaningful character in the source, name a screenplay-ready version. You may consolidate (two minor characters into one supporting role), rename, refocus. Keep names recognizable when the source is well-known.`
  : `Generate ORIGINAL names for the project. Pull world / region / era details from the digest. Do NOT use any name from the source.`}

Cast economy: ${cap === 5
  ? `Hard cap of 5 characters per the writer's directives — produce no more than 5.`
  : `Target ${idealCap}; never exceed ${cap}. Compress / merge minor roles rather than spread thin.`}

For EACH character produce ONLY these two fields:
- name: ALL CAPS first appearance (e.g., "RHETT VANCE", "MARGOT MOSS").
- role: one of "protagonist" | "antagonist" | "love_interest" | "ally" | "foil" | "mentor" | "tempter" | "ghost" | "supporting" | "minor" | "ensemble".

Order matters — list protagonist first, antagonist second, then supporting roles.

Return JSON: { "seeds": [ { "name":"...", "role":"..." }, ... ] }`

  const res = await runIntakeJSON<{ seeds: CastSeed[] }>('character_full_bible', input, prompt, 1500)
  if (!res.ok) return res
  const v = res.value as Partial<{ seeds: CastSeed[] }>
  const seeds = Array.isArray(v.seeds) ? v.seeds.filter(s => s && s.name).slice(0, 12) : []
  return { ...res, value: { seeds } }
}

/**
 * Generate full bibles for a batch of cast seeds. The wizard calls this
 * repeatedly with small batches (typically 2 characters per call) so
 * progress is visible and the model never has to draft 8 bibles in one
 * shot.
 */
export async function synthesizeCastBatch(
  input: TaskInput,
  ctx: SynthesisContext & {
    title: string
    logline: string
    shortSummary: string
    seeds: CastSeed[]
    /** Names already generated so the model doesn't recycle. */
    existingNames: string[]
  },
): Promise<TaskOutcome<{ characters: Character[] }>> {
  if (ctx.seeds.length === 0) return { ok: true, value: { characters: [] }, raw: '', modelId: 'noop' }

  const seedList = ctx.seeds.map(s => `  - ${s.name} (${s.role.replace('_', ' ')})`).join('\n')
  const existingBlock = ctx.existingNames.length
    ? `\n\nNames already used in this project (do NOT duplicate):\n${ctx.existingNames.map(n => `  - ${n}`).join('\n')}`
    : ''

  const prompt = `${baseSynthesisBlock(ctx)}

You've already produced:
- Title: ${ctx.title}
- Logline: ${ctx.logline}
- Short summary: ${ctx.shortSummary}

Now write full character bibles for THIS BATCH ONLY:
${seedList}${existingBlock}

For EACH character above produce a full bible with these fields:
- name: keep the name from the seed exactly.
- role: keep the role from the seed exactly.
- age: a string ("28", "early 30s").
- shortDescription: 4–12 words. Visual + behavioral. The on-page intro line. NO backstory, NO metaphors.
- biography: 4–8 paragraphs (400–900 words). Working screenwriter's bible — formative experience, profession, present-day texture, what they're afraid of, what they want, what they lie to themselves about. PULL details from the source digest above when the character has a counterpart in the source.
- externalGoal: one sentence — their concrete pursuit.
- internalNeed: one sentence — what they actually need.
- wound: one sentence — the unresolved trauma / regret.
- fear: one sentence — what they avoid at all costs.
- flaw: one sentence — the lie they tell themselves.
- secret: one sentence — what they hide.
- publicCost: one sentence — what they lose externally on failure.
- privateCost: one sentence — what they lose internally.
- arcStart: one sentence — emotional / behavioral state at open.
- arcEnd: one sentence — state at close.
- arcTurn: one sentence — the final choice that proves transformation.
- voiceNotes: 1–3 sentences. Concrete enough that a different writer could match the voice.
- verbalTics: array of 0–3 phrases or sign-offs.

Return JSON: { "characters": [ {...full fields...}, ... ] }`

  // Tight cap on the batch's token budget — 2 bibles fit comfortably in 3500.
  const tokenCap = Math.max(2500, ctx.seeds.length * 1800)
  const res = await runIntakeJSON<{ characters: AICharacter[] }>('character_full_bible', input, prompt, tokenCap)
  if (!res.ok) return res
  const arr = Array.isArray(res.value?.characters) ? res.value.characters : []
  const characters = arr.map(c => aiCharacterToCharacter(c, { provenance: 'ai_bible' }))
  return { ...res, value: { characters } }
}
