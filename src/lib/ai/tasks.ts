/**
 * AI Task Library.
 *
 * One file, all task definitions. Each task knows:
 *   - which model tier it should use
 *   - what task-specific instructions to inject
 *   - how to parse the model's response back into structured data
 *
 * Adding a new task is one new entry here. The UI just calls `runTask(task, project, args)`.
 */

import type { Project, Character, Beat, SceneCard, ScreenplayElement, Subplot, SeriesEpisode, SeasonArc } from '@/types'
import { newId, blankCharacterState, blankVoiceFingerprint } from '@/types'
import type { CharacterId, BeatId, SceneCardId } from '@/types'
import { completeWithSystem, AnthropicError } from './anthropic'
import { composeSystemPrompt } from './context'
import { resolveModel, type AITask, type ModelConfig, type ModelTier } from './models'
import { lint, applyFixes, stripEmDashes } from '@/lib/humanization'

/* ============================================================================
 * Task interfaces
 * ========================================================================= */

export interface TaskInput {
  project: Project
  apiKey: string
  modelOverrides?: Partial<Record<ModelTier, ModelConfig>>
  signal?: AbortSignal
  /** Free-text user nudge applied to this run only ("make it darker", etc.). */
  userNudge?: string
}

export interface TaskResult<T = string> {
  ok: true
  value: T
  /** Raw model text, before parsing. */
  raw: string
  modelId: string
}

export interface TaskFailure {
  ok: false
  error: string
  status?: number
  /**
   * True when the API truncated mid-response (the request was too big for
   * the model's per-call output ceiling). The chunked orchestrator uses
   * this to automatically retry with a smaller batch.
   */
  truncated?: boolean
}

export type TaskOutcome<T> = TaskResult<T> | TaskFailure

/* ============================================================================
 * Generic JSON-tolerant text fetch
 * ========================================================================= */

/**
 * Per-task timeout budget (in ms). The default 120s in callAnthropic is
 * fine for small one-shot fields, but heavy tasks (cast bibles, beats,
 * scene cards, season outlines, drafted pages) can legitimately take
 * 3–5 minutes when the model is producing thousands of output tokens or
 * is under load. Use generous values here — surfacing a spurious
 * timeout error to the writer is worse than waiting longer for a real
 * response. Cancel is always available on every UI surface.
 */
const TASK_TIMEOUT_MS: Partial<Record<AITask, number>> = {
  // Heavy generators (large outputs)
  character_full_bible: 360_000, // 6 min — cast bundles can be 20K+ tokens
  beat_generate_full:   360_000, // 6 min
  beat_fill_fields:     180_000,
  scene_card_generate:  360_000,
  scene_card_fill:      180_000,
  draft_scene:          240_000,
  draft_action:         180_000,
  draft_dialogue:       180_000,
  punch_up_dialogue:    120_000,
  rewrite_paragraph:    120_000,
  long_synopsis:        240_000,
  // Series-level
  season_plan:          360_000,
  series_engine:        180_000,
  // Diagnostics / extraction
  diagnose_section:     180_000,
  extract_facts:        180_000,
  extract_characters:   180_000,
  // Vertical
  vertical_episode:     240_000,
  vertical_loop:        240_000,
  vertical_trope_stack: 180_000,
  // Modify
  modify_setting:       180_000,
  modify_genre:         180_000,
  modify_tone:          180_000,
  modify_format:        180_000,
  // Small / single-field generators get the default 120s
}

function timeoutForTask(task: AITask): number {
  return TASK_TIMEOUT_MS[task] ?? 120_000
}

async function runText(
  task: AITask,
  input: TaskInput,
  instructions: string,
  maxTokens?: number,
): Promise<TaskOutcome<string>> {
  const model = resolveModel(task, input.modelOverrides)
  const system = composeSystemPrompt(input.project, instructions + (input.userNudge ? `\n\nUSER NUDGE: ${input.userNudge}` : ''))
  try {
    const res = await completeWithSystem({
      apiKey: input.apiKey,
      model: model.id,
      systemPrompt: system,
      userPrompt: 'Produce the output now.',
      maxTokens: maxTokens ?? model.maxOutputTokens,
      temperature: model.defaultTemperature,
      signal: input.signal,
      timeoutMs: timeoutForTask(task),
    })
    // Defensive: Anthropic should return a string here, but coerce just in case.
    const rawText = typeof res.text === 'string' ? res.text : String(res.text ?? '')
    // Strip leading/trailing markdown code fences if the model wrapped its answer.
    const unfenced = stripCodeFences(rawText)
    // Strip "**Field Label:**" / "Field Label:" prefixes the model sometimes
    // emits at the top of a field generation. Despite the prompt saying
    // "Output: the X only", some models lead with a markdown header.
    const unheadered = stripLeadingFieldHeader(unfenced)
    // Final humanization sweep (defense in depth).
    const cleanText = applyFixes(unheadered, lint(unheadered, { mode: 'strict', element: 'beat' }))
    return { ok: true, value: cleanText.trim(), raw: rawText, modelId: res.model }
  } catch (e) {
    if (e instanceof AnthropicError) return { ok: false, error: e.message, status: e.status }
    return { ok: false, error: (e as Error).message }
  }
}

/** Strip leading/trailing markdown code fences if the model wrapped its answer. */
function stripCodeFences(s: string): string {
  const trimmed = s.trim()
  const m = trimmed.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/)
  if (m) return m[1]
  return s
}

/**
 * Strip a leading "**Field Label:**" or "Field Label:" line the model
 * sometimes emits at the top of a single-field generation, despite the
 * prompt saying "Output: the X only". Examples we want to remove:
 *
 *   **Series Long Synopsis:**
 *   Series Long Synopsis:
 *   ## Logline
 *   **Episode Logline:**\n\n
 *
 * We're conservative: only the FIRST line is stripped, only if it looks
 * like a header (bold-wrapped, ends in `:`, or is a markdown heading),
 * and only when there's substantive content below it.
 */
function stripLeadingFieldHeader(s: string): string {
  const trimmed = s.trimStart()
  // Try a few common header shapes, in order:
  const patterns: RegExp[] = [
    /^\*\*[^\n*]{1,80}:\*\*\s*\n+/,    // **Field Label:**
    /^\*\*[^\n*]{1,80}\*\*\s*\n+/,     // **Field Label**
    /^#{1,6}\s+[^\n]{1,80}\s*\n+/,     // ## Field Label
    /^[A-Z][A-Za-z][A-Za-z0-9 \-/&,'.()]{1,80}:\s*\n+/, // Field Label:
  ]
  for (const re of patterns) {
    const m = trimmed.match(re)
    if (m) {
      const rest = trimmed.slice(m[0].length)
      // Only strip when there's still real content below — don't accidentally
      // delete a single-line answer that happens to start with a capitalized word.
      if (rest.trim().length >= 8) return rest
    }
  }
  return s
}

/**
 * Extract a JSON value from a model response.
 *
 * Order of attempts (each one is "best effort"; we keep the first one that
 * parses cleanly):
 *
 *   1. Parse the raw response as-is.
 *   2. Strip leading/trailing prose and code fences, parse again.
 *   3. Walk the text to find the outer `{...}` or `[...]` block (respecting
 *      strings and escapes), parse that.
 *   4. Apply lenient repairs (trailing-comma stripping, smart quotes →
 *      regular quotes), parse the repaired version.
 *   5. If the response was truncated (open string / open brackets), try to
 *      close the open structures and parse the repaired version. This
 *      typically gives us the response minus the last partial item — much
 *      better than no response at all.
 *
 * Returns null only when none of the above produce a parseable value.
 */
export function extractJSON<T>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') return null

  const candidates: string[] = []

  // 1. Raw.
  candidates.push(raw)

  // 2. Strip code fences (``` or ```json) anywhere.
  const stripped = raw
    .replace(/^[\s\S]*?```(?:json)?\s*\n?/i, '')
    .replace(/```[\s\S]*$/i, '')
    .trim()
  if (stripped && stripped !== raw) candidates.push(stripped)

  // 3. Outer { ... } or [ ... ] block, respecting strings.
  const outer = findOuterJSONBlock(raw)
  if (outer) candidates.push(outer)

  // Try each candidate as-is, then with light repairs, then with full repair.
  for (const c of candidates) {
    const parsed = tryParseWithRepairs<T>(c)
    if (parsed != null) return parsed
  }
  return null
}

/**
 * Find the first balanced JSON object/array in `s`, returning the substring
 * from the opening `{` or `[` to its matching close. Walks strings (with
 * escape handling) so curly braces inside strings don't confuse it.
 */
function findOuterJSONBlock(s: string): string | null {
  const startIdx = s.search(/[{[]/)
  if (startIdx < 0) return null
  const opener = s[startIdx]
  const closer = opener === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escape = false
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === opener) depth++
    else if (ch === closer) {
      depth--
      if (depth === 0) return s.slice(startIdx, i + 1)
    }
  }
  // No matching close — return what we have so the truncation repair can try.
  return s.slice(startIdx)
}

/**
 * Try a few progressively-more-aggressive repairs on a JSON candidate.
 */
function tryParseWithRepairs<T>(s: string): T | null {
  // Direct.
  try { return JSON.parse(s) as T } catch {}

  // Smart quotes and trailing commas.
  const lenient = s
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,(\s*[}\]])/g, '$1')
  try { return JSON.parse(lenient) as T } catch {}

  // Truncation repair: walk the candidate and rebuild a balanced version.
  const repaired = repairTruncatedJSON(lenient)
  if (repaired && repaired !== lenient) {
    try { return JSON.parse(repaired) as T } catch {}
  }
  return null
}

/**
 * Close any unclosed strings and brackets at the end of a JSON candidate.
 * Best-effort; will drop the trailing partial item if needed.
 */
function repairTruncatedJSON(s: string): string {
  const stack: Array<'{' | '['> = []
  let inString = false
  let escape = false
  let lastSafeIdx = 0

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') {
      inString = !inString
      if (!inString && stack.length === 0) lastSafeIdx = i + 1
      continue
    }
    if (inString) continue
    if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') {
      stack.pop()
      // A clean close at depth 0 is a great snip point.
      if (stack.length === 0) lastSafeIdx = i + 1
    } else if (ch === ',' && stack.length > 0) {
      // Remember last clean field boundary inside the current structure.
      lastSafeIdx = i
    }
  }

  if (!inString && stack.length === 0) return s

  // Snip at the last clean boundary, then close everything left open.
  let head = s.slice(0, lastSafeIdx).replace(/[,\s]+$/, '')
  if (inString) head += '"'
  // Close any remaining open structures in reverse order.
  // We have to re-scan the head to find the *actual* still-open stack.
  const openStack: Array<'{' | '['> = []
  let inStr = false
  let esc = false
  for (let i = 0; i < head.length; i++) {
    const ch = head[i]
    if (esc) { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{' || ch === '[') openStack.push(ch)
    else if (ch === '}' || ch === ']') openStack.pop()
  }
  while (openStack.length > 0) {
    const open = openStack.pop()
    head += open === '{' ? '}' : ']'
  }
  return head
}

/* ============================================================================
 * Page-target-aware scaling
 *
 * For projects with tight page targets (a 2-page animated short, a
 * 1-page sketch, a 5-page vertical run) the AI must think intuitively:
 * a 2-page show isn't built with 24 beats and a 700-word synopsis. It's
 * built with 3 beats and a 50-word recap.
 *
 * These helpers map a single number (effective page count) to the right
 * size for every downstream artifact: long synopsis, short summary,
 * beats, scenes. Every task that produces a sized output consults the
 * right helper instead of the format preset's static numbers — so the
 * writer's foundational-guidance page target genuinely overrides the
 * preset.
 * ========================================================================= */

/**
 * Map a script page count to a long-synopsis word-count band. Roughly
 * 3–5 words of synopsis per script page, with a floor at 30 words.
 */
export function scaledSynopsisRange(pages: number): { min: number; max: number } {
  if (pages <= 2)   return { min: 25, max: 60 }
  if (pages <= 5)   return { min: 50, max: 110 }
  if (pages <= 10)  return { min: 80, max: 160 }
  if (pages <= 35)  return { min: 150, max: 300 }
  if (pages <= 60)  return { min: 250, max: 420 }
  if (pages <= 100) return { min: 350, max: 550 }
  return { min: 500, max: 750 }
}

/**
 * Map a script page count to a short-summary word-count band. The short
 * summary is meant to be "the version you'd tell at a party" — a single
 * tight paragraph that fits the project's altitude. A 2-page project's
 * short summary is one or two sentences; a feature's is 4–6 sentences.
 */
export function scaledShortSummaryRange(pages: number): { min: number; max: number; sentences: string } {
  if (pages <= 2)   return { min: 12, max: 30,  sentences: '1 sentence (2 if needed)' }
  if (pages <= 5)   return { min: 25, max: 60,  sentences: '1–2 sentences' }
  if (pages <= 10)  return { min: 40, max: 80,  sentences: '2–3 sentences' }
  if (pages <= 35)  return { min: 60, max: 110, sentences: '3–4 sentences' }
  if (pages <= 60)  return { min: 70, max: 130, sentences: '3–5 sentences' }
  return { min: 80, max: 140, sentences: '4–6 sentences' }
}

/**
 * Map a script page count to a beat count band. The shape comes from
 * how real outlines scale:
 *   - 1–2 pages: 2–4 beats (setup, turn, finish — sometimes 4)
 *   - 5 pages: 4–6 beats
 *   - 10 pages: 5–9 beats
 *   - 22-page TV episode: 12–22 beats
 *   - 35 pages: 18–28 beats
 *   - 60-page TV pilot: 24–36 beats
 *   - 90-page feature: 30–45 beats
 *   - 120+: 40–55 beats
 *
 * This is the curve. Anything outside it is either pad (too many beats
 * for the page count) or under-outlined (too few for the page count).
 */
export function scaledBeatRange(pages: number): { min: number; ideal: number; max: number } {
  if (pages <= 2)   return { min: 2,  ideal: 3,  max: 4 }
  if (pages <= 5)   return { min: 3,  ideal: 5,  max: 7 }
  if (pages <= 10)  return { min: 5,  ideal: 7,  max: 10 }
  if (pages <= 22)  return { min: 12, ideal: 16, max: 22 }
  if (pages <= 35)  return { min: 18, ideal: 24, max: 30 }
  if (pages <= 60)  return { min: 24, ideal: 30, max: 38 }
  if (pages <= 100) return { min: 30, ideal: 38, max: 48 }
  return { min: 38, ideal: 45, max: 55 }
}

/**
 * Map a script page count to a scene-card count band. Scenes scale a bit
 * faster than beats — typically 1.3–1.5 scenes per beat in industry
 * outlines.
 */
export function scaledSceneRange(pages: number): { min: number; ideal: number; max: number } {
  const b = scaledBeatRange(pages)
  return { min: Math.round(b.min * 1.2), ideal: Math.round(b.ideal * 1.4), max: Math.round(b.max * 1.5) }
}

/**
 * Number-word table for `parsePageOverride`. Covers the common cases a
 * writer might type: "three pages", "two-page episodes", "twenty pages".
 */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,    two: 2,    three: 3,  four: 4,    five: 5,
  six: 6,    seven: 7,  eight: 8,  nine: 9,    ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100,
}
const NUMBER_WORD_KEYS = Object.keys(NUMBER_WORDS).join('|')

/**
 * Detect explicit page targets in the writer's Foundational Guidance.
 * Catches a wide range of phrasings — digits and words, with or without
 * common qualifiers (max, maximum, no more than, keep under, capped at,
 * no longer than, target, up to, around, ~).
 *
 * Examples that resolve to 3:
 *   - "3 pages" / "3-page episodes" / "3 page max" / "maximum 3 pages"
 *   - "three pages" / "three-page episodes" / "max of three pages"
 *   - "maximum of three pages" / "no more than three pages"
 *   - "keep episodes under three pages" / "cap each episode at 3 pages"
 *   - "~3 page" / "around 3 pages"
 *
 * Examples that resolve to 5 (minute heuristic):
 *   - "5-minute short" / "five minute episodes" — 1 page/min industry rate
 *
 * Returns the smallest number found (tighter wins; writers who say
 * "max 3 pages" mean it as a cap, not a floor).
 */
export function parsePageOverride(guidance: string | undefined): number | null {
  if (!guidance) return null
  const text = guidance.toLowerCase()
  const found: number[] = []

  // Helper: turn either a digit string OR a word like "three" into a number.
  const num = (tok: string): number | null => {
    if (/^\d+$/.test(tok)) {
      const n = parseInt(tok, 10)
      return Number.isFinite(n) ? n : null
    }
    return NUMBER_WORDS[tok] ?? null
  }
  const push = (n: number | null, ceiling: number) => {
    if (n != null && n >= 1 && n <= ceiling) found.push(n)
  }

  // Token group that matches a number (digit or word, optionally preceded
  // by approximation markers like "~", "about", "around").
  const N = `(?:~|about\\s+|around\\s+|approximately\\s+|approx\\.?\\s+)?(\\d{1,3}|${NUMBER_WORD_KEYS})`

  // (number) (page|pages|pg|pgs) — base pattern, also catches "3-page"
  for (const m of text.matchAll(new RegExp(`\\b${N}\\s*[-\\s]?\\s*(?:page|pages|pg|pgs)\\b`, 'g'))) {
    push(num(m[1]), 400)
  }
  // (number) (page|pages) (target|max|min|cap|limit|count)
  for (const m of text.matchAll(new RegExp(`\\b${N}\\s*[-\\s]?\\s*(?:page|pages|pg)\\s+(?:target|max|maximum|min|minimum|limit|cap|count)\\b`, 'g'))) {
    push(num(m[1]), 400)
  }
  // (max|maximum|cap|no more than|no longer than|under|keep under|up to|at most)
  //   (of) (number) (page|pages)
  for (const m of text.matchAll(new RegExp(`\\b(?:max(?:imum)?|cap(?:ped at)?|no more than|no longer than|under|keep under|up to|at most|around|about)(?:\\s+of)?\\s+${N}\\s*[-\\s]?\\s*(?:page|pages|pg)\\b`, 'g'))) {
    push(num(m[1]), 400)
  }
  // (number) (minute|min|mins) (...) — 1 page per minute industry heuristic.
  for (const m of text.matchAll(new RegExp(`\\b${N}\\s*[-\\s]?\\s*(?:minute|minutes|min|mins)\\b`, 'g'))) {
    push(num(m[1]), 240)
  }

  if (found.length === 0) return null
  // Tighter is more binding — the writer who says "max 3 pages" means it.
  return Math.min(...found)
}

/**
 * Compute the effective beat-count target for a Project given its
 * page target and format preset. UI surfaces (BeatBoard, etc.) call
 * this so "Take It From Here" stops trying to write 24 beats for a
 * 2-page sketch. Mirrors what `generateBeatStructure` computes
 * internally.
 *
 * VERTICAL projects use EPISODE counts (one Beat row = one episode).
 * The right source of truth, in order of preference:
 *   1. The writer's `verticalPlan.totalEpisodes` (their declared target).
 *   2. The format preset's `structure.episodesPerSeason`.
 *   3. A sensible default of 50.
 * The legacy `substanceTargets.beats` for vertical was set on a
 * "total internal beats = episodes × 4" basis (e.g., 200 for a
 * 50-episode season) and is therefore NOT a valid source for the
 * UI's beat (= episode) row count.
 *
 * The Rise → Spike → Drop → Cliff 4-beat internal structure lives
 * INSIDE each episode's drafting prompt; it does not contribute to
 * the Beat Board's row count.
 */
export function effectiveBeatTargets(project: Project): { min: number; ideal: number; max: number } {
  const fmt = project.format
  // Vertical: each Beat row = one Episode. Use the writer's declared
  // episode count (or the format preset's episodesPerSeason as a
  // fallback). Industry vertical seasons run 30–70 episodes.
  if (fmt.verticalSandbox) {
    const writerEpisodes = project.verticalPlan?.totalEpisodes
    const formatEpisodes = (fmt.structure as { episodesPerSeason?: number }).episodesPerSeason
    const ideal = writerEpisodes || formatEpisodes || 50
    return {
      min: Math.max(20, Math.round(ideal * 0.6)),
      ideal,
      max: Math.max(70, Math.round(ideal * 1.4)),
    }
  }
  const guidance = project.planning.foundationalGuidance ?? ''
  const override = parsePageOverride(guidance)
  let pages: number
  if (override) {
    pages = override
  } else if (project.planning.seriesPlan) {
    const seriesPlan = project.planning.seriesPlan
    const pagesPerEpisode = (fmt.structure as { pagesPerEpisode?: number }).pagesPerEpisode
    if (pagesPerEpisode) pages = pagesPerEpisode
    else if (seriesPlan.targetEpisodeCount > 0) {
      const mid = Math.round((fmt.structure.targetPagesMin + fmt.structure.targetPagesMax) / 2)
      pages = Math.max(1, Math.round(mid / seriesPlan.targetEpisodeCount))
    } else pages = 22
  } else {
    pages = Math.round((fmt.structure.targetPagesMin + fmt.structure.targetPagesMax) / 2)
  }
  const scaled = scaledBeatRange(pages)
  const legacy = fmt.substanceTargets.beats
  return {
    min: Math.min(scaled.min, legacy.min),
    ideal: scaled.ideal,
    max: Math.min(scaled.max, legacy.max),
  }
}

/**
 * Best-effort estimate of how many script pages have already been
 * drafted in `project.screenplay.elements`. We don't run the full
 * pagination engine here (that's a heavy operation); instead we use a
 * conservative rule of thumb: ~55 visible lines = 1 page. Action and
 * dialogue contribute differently. The result is approximate but
 * sufficient for "have I overshot the writer's page target?" decisions.
 */
export function estimatePagesWritten(project: Project): number {
  // Lines per element roughly map as:
  //   - scene_heading / act_label / episode_label: 1 line + 1 blank below
  //   - action: 1 line per ~55 characters
  //   - character cue: 1 line
  //   - dialogue: 1 line per ~35 characters
  //   - parenthetical: 1 line
  //   - transition: 1 line + blank
  // 55 visible lines = 1 standard page.
  let lines = 0
  for (const el of project.screenplay.elements ?? []) {
    const text = (el.text ?? '').trim()
    if (!text) { lines += 1; continue }
    switch (el.type) {
      case 'scene_heading':
      case 'act_label':
      case 'episode_label':
      case 'transition':
        lines += 2
        break
      case 'character':
        lines += 1
        break
      case 'dialogue':
        lines += Math.max(1, Math.ceil(text.length / 35))
        break
      case 'parenthetical':
        lines += 1
        break
      case 'action':
      default:
        lines += Math.max(1, Math.ceil(text.length / 55))
        break
    }
  }
  return lines / 55
}

/**
 * Whether a project is comedy in any form — by format kind OR by an
 * explicitly-tagged genre. The detection is broad on purpose: a 2D
 * animation project tagged "workplace comedy" needs the comedy
 * constitution even though its format kind is `animation_2d`.
 */
export function isComedyProject(project: Project): boolean {
  const k = project.format.kind
  if (k === 'feature_comedy' || k === 'tv_30min_comedy_single_cam' || k === 'tv_30min_comedy_multi_cam') return true
  const genres = (project.format.genres ?? []).map(g => g.toLowerCase())
  return genres.some(g => g.includes('comedy') || g.includes('sitcom') || g === 'humor' || g === 'comedic')
}

/** Whether a project is animation (cartoon series / animated feature). */
export function isAnimationProject(project: Project): boolean {
  const k = project.format.kind
  if (k === 'animation_2d') return true
  return project.format.medium === 'animation'
}

/**
 * Compute the SYNOPSIS-ALTITUDE page target.
 *
 * Logline / short summary / long synopsis describe a WHOLE PROJECT —
 * an entire feature, an entire show, an entire vertical season. They
 * do not describe a single 2-page episode. The synopsis word target
 * must scale to the whole arc, not to the draft unit.
 *
 *   - Feature:           project total pages (e.g., 90 for a feature).
 *   - Episodic series:   per-active-episode pages (the Overview tab is
 *                        episode-scoped for series projects; the Show
 *                        Bible has its own series-level generator).
 *   - Vertical:          SEASON total = episodes × 2 pages. A 50-episode
 *                        season is ~100 pages of script overall, which
 *                        deserves a 350–550 word synopsis — NOT the
 *                        30–60-word micro-summary that per-episode
 *                        scaling would produce.
 *
 * For verticals specifically, this uses (writer's totalEpisodes ||
 * format's episodesPerSeason || 50) × 2 to get total season pages.
 */
export function effectiveSynopsisPages(input: TaskInput): number {
  const project = input.project
  const fmt = project.format
  // Vertical: synopsis describes the WHOLE SEASON, not one episode.
  if (fmt.verticalSandbox) {
    const writerEpisodes = project.verticalPlan?.totalEpisodes
    const formatEpisodes = (fmt.structure as { episodesPerSeason?: number }).episodesPerSeason
    const pagesPerEpisode = (fmt.structure as { pagesPerEpisode?: number }).pagesPerEpisode || 2
    const episodes = writerEpisodes || formatEpisodes || 50
    return Math.max(20, episodes * pagesPerEpisode)
  }
  // Episodic series with an active episode: synopsis is per-episode
  // (the Overview tab edits the active episode; Show Bible has its own).
  const seriesPlan = project.planning.seriesPlan
  if (seriesPlan && !fmt.verticalSandbox) {
    return effectivePageTarget(input)
  }
  // Standalone feature: project total pages.
  return effectivePageTarget(input)
}

/**
 * Compute the effective page target for a single DRAFT UNIT. For a
 * standalone feature this is the project's overall page target. For an
 * episodic project (TV / animation series) this is the per-episode page
 * count. For a vertical, this is the per-episode page count (default 2).
 * In every case, an explicit page override in the writer's Foundational
 * Guidance wins.
 *
 * Used by drafting / beat / scene-card generation — the unit being
 * physically written. Synopsis-level scaling uses
 * `effectiveSynopsisPages` instead.
 */
export function effectivePageTarget(input: TaskInput): number {
  const project = input.project
  const fmt = project.format
  const guidance = project.planning.foundationalGuidance ?? ''
  const override = parsePageOverride(guidance)
  if (override) return override

  const seriesPlan = project.planning.seriesPlan
  const isEpisodic = !!seriesPlan && !fmt.verticalSandbox
  const totalPagesMid = Math.round((fmt.structure.targetPagesMin + fmt.structure.targetPagesMax) / 2)

  if (isEpisodic) {
    // Per-episode pages from the format config, falling back to a
    // proportional split of the season's total page budget.
    const pagesPerEpisode = (fmt.structure as { pagesPerEpisode?: number }).pagesPerEpisode
    if (pagesPerEpisode) return pagesPerEpisode
    const target = seriesPlan?.targetEpisodeCount ?? 0
    if (target > 0) return Math.max(1, Math.round(totalPagesMid / target))
    return 22 // sensible default for a TV episode
  }

  // Vertical sandbox: page target is per-episode (~2 pages).
  if (fmt.verticalSandbox) {
    const pe = (fmt.structure as { pagesPerEpisode?: number }).pagesPerEpisode
    return pe || 2
  }

  return totalPagesMid
}

/**
 * Exported so adjacent task modules (e.g., intake-tasks.ts) can share the
 * same JSON pipeline — same retry handling, same humanization sweep, same
 * truncation reporting for the chunked-takeover orchestrator.
 */
export async function runJSON<T>(
  task: AITask,
  input: TaskInput,
  instructions: string,
  maxTokens?: number,
): Promise<TaskOutcome<T>> {
  const model = resolveModel(task, input.modelOverrides)
  const system = composeSystemPrompt(input.project, instructions + (input.userNudge ? `\n\nUSER NUDGE: ${input.userNudge}` : '') + `\n\nReturn ONLY valid JSON. No prose. No markdown fences.`)
  try {
    const res = await completeWithSystem({
      apiKey: input.apiKey,
      model: model.id,
      systemPrompt: system,
      userPrompt: 'Produce the JSON output now.',
      maxTokens: maxTokens ?? model.maxOutputTokens,
      temperature: model.defaultTemperature,
      signal: input.signal,
      timeoutMs: timeoutForTask(task),
    })
    const parsed = extractJSON<T>(res.text)
    if (!parsed) {
      // Give the user actionable detail. Truncation is the common cause.
      const truncated = res.stopReason === 'max_tokens'
      const hint = truncated
        ? `The response was cut off before completing (hit max output tokens). The output cap is ${maxTokens ?? model.maxOutputTokens}. Retrying with a smaller batch.`
        : `The model returned text that wasn't recognizable JSON. Try again, or simplify the request.`
      // Log the raw response for debugging.
      console.warn('[PageCraft AI] JSON parse failed.', {
        task,
        stopReason: res.stopReason,
        rawLength: res.text.length,
        rawPreview: res.text.slice(0, 600),
      })
      return { ok: false, error: hint, truncated }
    }
    return { ok: true, value: parsed, raw: res.text, modelId: res.model }
  } catch (e) {
    if (e instanceof AnthropicError) {
      // Anthropic returns 400 when max_tokens > model's per-request ceiling
      // or when the input + output budget overflows. Both are "too big"
      // signals — treat them as truncation so the orchestrator chunks.
      const truncated = e.status === 400 && /max_tokens|too long|context length/i.test(e.message)
      return { ok: false, error: e.message, status: e.status, truncated }
    }
    return { ok: false, error: (e as Error).message }
  }
}

/* ============================================================================
 * Single-field text tasks
 * ========================================================================= */

export const generateLogline = (input: TaskInput) =>
  runText('logline', input, `Generate a strong one-sentence logline. Required structure: protagonist (with a hint of who) + active goal + central obstacle + concrete stakes. No vague phrases ("on a journey"). No genre-tagging ("In this thriller..."). Output: the logline only. No quotes around it.`, 400)

export const generateShortSummary = (input: TaskInput) => {
  // Scale to the SYNOPSIS altitude — the whole project for verticals
  // and features; the active episode for episodic series. A vertical
  // SEASON (50 × 2 = 100 pages) gets a real 4–6-sentence short summary;
  // a single vertical EPISODE wouldn't.
  const pages = effectiveSynopsisPages(input)
  const range = scaledShortSummaryRange(pages)
  const isVerticalSeason = !!input.project.format.verticalSandbox
  const scopeNote = isVerticalSeason
    ? `\n\nVERTICAL SEASON SCOPE: this is the SHORT SUMMARY for the WHOLE SEASON (${input.project.verticalPlan?.totalEpisodes ?? 50} episodes across ~${pages} total pages of script). Pitch the season-long arc — the central romance / revenge engine, the principal cast dynamic, the multi-cycle escalation. Do NOT summarize one episode. The summary you produce will read as the elevator pitch a producer hears for the entire show.`
    : ''
  return runText(
    'short_summary',
    input,
    `Generate a short summary for a ${pages}-page project. Target length: ${range.sentences}, ${range.min}–${range.max} words. The "fun version" of the pitch — concrete, sensory, a hook. Use the logline and characters as anchors.

DO NOT pad to hit a length you've outgrown. A 2-page project's short summary is one sentence; a 30-page sitcom is 2–3; a feature is 4–6. Match the page target.${scopeNote}

Output: the summary only. No markdown header. No "Short Summary:" prefix. No quote marks.`,
    Math.max(400, Math.round(range.max * 4)),
  )
}

export const generateLongSynopsis = (input: TaskInput) => {
  const fmt = input.project.format
  const seriesPlan = input.project.planning.seriesPlan
  const activeEp = seriesPlan?.activeEpisodeId
    ? seriesPlan.episodes.find(e => e.id === seriesPlan.activeEpisodeId)
    : null
  const isEpisodicProject = !!seriesPlan && !fmt.verticalSandbox

  // Use the SYNOPSIS-ALTITUDE page count, not the draft-unit page count.
  // For verticals this is the whole SEASON (episodes × 2 pages), not
  // one episode. The synopsis describes the season's arc — multiple
  // cycles, the central romance/revenge engine, the trope ladder, the
  // paywall placement, the season-ending unanswered question.
  const effectivePages = effectiveSynopsisPages(input)
  const scaled = scaledSynopsisRange(effectivePages)
  const legacy = fmt.substanceTargets.longSynopsisWords
  // Allow the format preset to widen the band — vertical specifically
  // requests 600–1500 words on the season synopsis.
  const targets = {
    min: Math.max(scaled.min, legacy.min),
    max: Math.max(scaled.max, legacy.max),
    ideal: Math.round((Math.max(scaled.min, legacy.min) + Math.max(scaled.max, legacy.max)) / 2),
  }

  const reveals = fmt.substanceTargets.majorReveals
  const subplotLetters = fmt.substanceTargets.subplotLabels.map(s => s.letter).join('/')
  const isFeature = fmt.kind === 'feature_drama' || fmt.kind === 'feature_comedy' || fmt.kind === 'feature_horror'
  const isHorror = fmt.kind === 'feature_horror'
  const isVertical = fmt.verticalSandbox
  const verticalPlan = input.project.verticalPlan

  // Per-episode scope block — when the project is episodic, the synopsis
  // MUST be the active episode's, not the show's.
  const episodeScopeBlock = isEpisodicProject && activeEp
    ? `\n\nEPISODIC PROJECT — this is a TV / animation series. The synopsis you produce is for ONE EPISODE: Episode ${activeEp.number}${activeEp.title ? ` — "${activeEp.title}"` : ''}.
- DO NOT synopsize the whole series. The Show Bible block already has the series-level synopsis; you are writing what happens THIS WEEK.
- Per-episode page target: ~${effectivePages} pages. Your synopsis is sized to that, not to a feature.
- If a directive in the writer's Foundational Guidance specifies a tighter page count (e.g. "2-page episodes"), honor that number.
- All beats below are episode beats, not season beats. Episode arcs resolve (or cliffhang) within this episode.`
    : ''

  // Foundational-guidance + small-page brevity reminder. Honors writer
  // directives like "Target 2 pages" without padding.
  const brevityBlock = effectivePages <= 10
    ? `\n\nSMALL-PAGE BREVITY — this project is only ${effectivePages} pages. DO NOT pad. A 2-page synopsis is a single short paragraph; a 5-page synopsis is one slightly fuller paragraph; an 8-page short fits in two short paragraphs. The 'required content' list below collapses to whatever fits a story of this size. Skip subplot rotation entirely for projects under 15 pages — there is no room.`
    : ''

  // VERTICAL projects: the synopsis is for the WHOLE SEASON — not one
  // episode, not one cycle. A vertical season runs 30–70 episodes at
  // 2 pages each (60–140 total pages of script) and the synopsis must
  // describe that whole arc the way a producer reads a show pitch.
  const verticalBlock = isVertical && verticalPlan
    ? `\n\nVERTICAL SYNOPSIS RULES — this is a Vertical Drama.

SCOPE: SEASON-LEVEL, NOT EPISODE-LEVEL.
- You are writing the synopsis for the WHOLE SEASON — ${verticalPlan.totalEpisodes} episodes across ${verticalPlan.totalEpisodes * 2}-ish total pages of script.
- DO NOT write the synopsis for one 2-page episode. Verticals share terminology with TV (episodes / season), but the project-level synopsis describes the ENTIRE ARC across all episodes — the same way a Netflix series pitch covers the whole season.
- Word target ${targets.min}–${targets.max} words is appropriate for a SEASON pitch. Honor it.

The Vertical Plan section is canonical input. Pull from EVERY field the user has filled in:
${verticalPlan.tropeStack.selected.length ? `- Trope stack (REQUIRED to weave through the synopsis): ${verticalPlan.tropeStack.selected.join(', ')}` : '- (No tropes selected yet — invent specific tropes that match the logline and name them explicitly.)'}
${verticalPlan.tropeStack.notes ? `- Trope notes: ${verticalPlan.tropeStack.notes}` : ''}
- Plot type: ${verticalPlan.plotType.replace(/_/g, ' ')} — the synopsis must read as this kind of show.
- Total episodes: ${verticalPlan.totalEpisodes}.
- Paywall after episode: ${verticalPlan.paywallAfterEpisode}. The first ${verticalPlan.paywallAfterEpisode} episodes ARE the free funnel — name the specific hook each one ends on and the CPI-worthy moment that earns the swipe-to-pay.
- Use the on-the-nose vertical voice (declarative, melodramatic, explicit). Theme can be stated. Hooks every 60–90 seconds.
- Walk the season arc by episode block:
    • Free funnel (Episodes 1–${verticalPlan.paywallAfterEpisode}) — the hook that earns the swipe-to-pay.
    • Early paid (Episodes ${verticalPlan.paywallAfterEpisode + 1}–${Math.round(verticalPlan.totalEpisodes * 0.35)}) — escalating complications.
    • Mid-season pivot (around Episode ${Math.round(verticalPlan.totalEpisodes * 0.5)}) — the reveal that recontextualizes the whole arc.
    • Final cycle (Episodes ${Math.round(verticalPlan.totalEpisodes * 0.75)}–${verticalPlan.totalEpisodes}) — escalating stakes toward the season climax.
    • Season finale (Episode ${verticalPlan.totalEpisodes}) — the answer (or strategic non-answer) to the season-arc question, plus the season-ending cliff that sets up Season 2.
- Name AT LEAST 4 specific cliffhangers across the season.
- Each tagged trope must be ACTIVATED somewhere in the synopsis with a specific scene moment — not just listed.
`
    : ''
  const horrorBlock = isHorror
    ? `\n\nHORROR-SPECIFIC SYNOPSIS RULES:
- Establish the rules of the threat early and in concrete terms (what it can do, what it can't, what summons or repels it).
- Name the threat — give it visual / behavioral iconography the reader can picture.
- Specify the protagonist's isolation (geographic, social, psychological).
- Walk through the escalation: at least 3 distinct encounter beats of increasing transgression.
- Include the midpoint reveal that recontextualizes the threat — "we now realize the real horror is X".
- Show the cost: someone dies, someone is changed, the rules of safety break.
- The climax must answer: did the protagonist survive whole, broken, or transformed? Be specific.
- No vague "horror ensues" or "the killing begins". Write the actual encounters and their consequences.
`
    : ''

  // For tight page targets the "REQUIRED CONTENT" 12-step checklist is
  // structurally impossible — a 2-page script doesn't have a midpoint
  // reversal AND an all-is-lost AND a thematic D-story. Strip the long
  // checklist out for projects under 15 pages; replace it with a
  // size-appropriate spine.
  const requiredContent = effectivePages <= 15
    ? `\nREQUIRED CONTENT (SCALED TO ${effectivePages} PAGES — no checklist beyond this; do not invent acts the page count cannot hold):
- ${effectivePages <= 2
    ? 'Setup (1 sentence). Turn (1 sentence). Finish (1 sentence). That is the whole synopsis.'
    : effectivePages <= 5
    ? 'Setup. Complication. Turn. Resolution. One sentence each at most.'
    : effectivePages <= 10
    ? 'Setup of the situation. Two clear escalations or complications. Turn. Resolution. Plain present tense; one to two sentences per beat.'
    : 'Setup. Inciting incident. Midpoint flip. Climax choice. Resolution. Each beat one or two sentences.'}
- Skip subplot rotation entirely — a piece this short cannot service multiple parallel threads.
- Skip the "twists / reveals" minimum — short pieces earn ZERO or ONE small reveal at most.
- Do not invent characters or arcs the page count cannot dramatize.`
    : `
CRITICAL SUBSTANCE RULES — the most common failure mode is thinness. Avoid all of these:
- No vague summary lines ("they go on a journey of self-discovery").
- No skipping subplots. Every subplot below must be developed inside this synopsis.
- No skipping reveals. Every major twist / reveal / midpoint flip / climax move must be on the page.
- No filler transitions ("over time", "things escalate", "tensions rise") — write the SPECIFIC scenes.
- No theme essay paragraphs. Theme is dramatized through choices, not stated.

REQUIRED CONTENT — this synopsis must cover, in order:
1. Setup of the protagonist's world, the lie they live by, and the specific stakes if it falls apart.
2. The inciting incident — concrete, dated, specific.
3. The first-act break: the choice that launches the journey.
4. The A-story plot beats through midpoint (with the catalyst events named).
5. The B-story (relational / emotional spine) introduced and developed in parallel — at least 3 distinct B-story moments. Specify when A and B intersect.
6. The C-story (secondary character or antagonist arc) — at least 2 distinct C-story moments.
${isFeature ? '7. The D-story / thematic runner (3–6 callback moments across the script).\n' : ''}
${isFeature ? '8. ' : '7. '}The MIDPOINT reversal — what flips, what the protagonist now believes, what they now want.
${isFeature ? '9. ' : '8. '}The "bad guys close in" stretch — specific complications, named.
${isFeature ? '10. ' : '9. '}The All-Is-Lost / low point — what dies (literally or figuratively).
${isFeature ? '11. ' : '10. '}The third-act break — the new strategy.
${isFeature ? '12. ' : '11. '}The climax: ONE specific final choice that proves the arc. Name the action.
${isFeature ? '13. ' : '12. '}The resolution + final image: the change in the protagonist's world.

TWISTS / REVEALS to surface (aim for ${reveals.ideal}, minimum ${reveals.min}):
- Each must be a CONCRETE reveal the audience experiences, with a setup and a payoff scene.
- At least one reveal must reframe a prior scene's meaning ("…we now realize that earlier moment was actually X").
- At least one reveal must come from a B-story or C-story character (not the protagonist).

SUBPLOT INTERLEAVING:
- ${subplotLetters} subplots must EACH get at least one paragraph (or paragraph-group) of development.
- Show explicit intersections: "Just as the protagonist wins X (A-story), her sister returns (B-story)."
- Subplots must converge in the climax — the final choice must pay off A, B, and at least one of the others.`

  return runText(
    'long_synopsis',
    input,
    `Generate a long synopsis in plain present-tense prose. Length: ${targets.min}–${targets.max} words, aim for ~${targets.ideal}. SCALE TO THE PAGE TARGET below — do not pad, do not truncate.${episodeScopeBlock}${brevityBlock}${verticalBlock}${horrorBlock}
${requiredContent}

NAMING / SPECIFICITY:
- Use character names (existing ones from the project where available). Never write "the protagonist" / "the antagonist" / "the love interest" after first introduction.
- Use specific locations, objects, lines of dialogue (paraphrased), professions, dates.
- Replace abstract emotion with the specific behavior that proves it.

OUTPUT FORMAT:
- 6–12 paragraphs.
- Plain present tense.
- No headers, no bullet points, no scene numbers.
- No em-dashes.
- No quotation marks around the synopsis itself.

If existing planning fields (logline, short summary, characters, themes) are filled, build on them as canonical truth. Where they are empty, propose specific dramatic choices — do not write "the writer will decide" or any equivalent placeholder.`,
    Math.max(4000, targets.max * 6),
  )
}

export const generateCentralQuestion = (input: TaskInput) =>
  runText('central_question', input, `Generate the script's central dramatic question — one sentence in the form of an unresolved yes/no question that the climax will answer. Use the project's own characters when you can (or generic role nouns like "the protagonist" when the question is being written before the cast exists). NEVER substitute names from the prompt's example pool.`, 200)

export const generateStoryEngine = (input: TaskInput) =>
  runText('story_engine', input, `Generate the story engine — one paragraph describing the recurring pattern that makes this series go week after week (for TV) or scene after scene (for feature). Be concrete about what kinds of episode situations the engine produces.`, 400)

export const generateThemeQuestion = (input: TaskInput) =>
  runText('theme_question', input, `Generate the theme as a question or paradox the script asks. NOT a statement, NOT a moral. Examples: "Is freedom worth the people who love you?" / "What do you owe a family that abandoned you?"`, 200)

export const generateExternalStakes = (input: TaskInput) =>
  runText('stakes', input, `Generate the external stakes — concretely, what happens in the world if the protagonist fails? One short paragraph. Specific. No vague "everything will be lost".`, 300)

export const generateInternalStakes = (input: TaskInput) =>
  runText('stakes', input, `Generate the internal stakes — what happens to who the protagonist is if they fail? One short paragraph. Specific to who they are. No vague "they will be devastated".`, 300)

export const generateAStory = (input: TaskInput) =>
  runText('story_engine', input, `Generate the A-story — one short paragraph: the main external arc.`, 250)

export const generateBStory = (input: TaskInput) =>
  runText('story_engine', input, `Generate the B-story — one short paragraph: the parallel relational/emotional arc that intersects the A-story.`, 250)

export const generateCStory = (input: TaskInput) =>
  runText('story_engine', input, `Generate the C-story (if applicable) — a smaller subplot or runner. One short paragraph or "(none needed)".`, 200)

/* ============================================================================
 * Series-scoped Show Bible generators
 *
 * The plain `generate*` tasks above read the OVERVIEW block from
 * PROJECT CONTEXT, which is the ACTIVE EPISODE on an episodic project.
 * The Show Bible needs SERIES-LEVEL outputs — about the whole show, not
 * any one episode. Each task below explicitly overrides scope and tells
 * the model to ignore the active-episode block and produce a series-
 * scoped result.
 *
 * Output: writers consume these into seriesPlan.seriesLogline /
 * seriesShortSummary / seriesLongSynopsis / engine / seasonArcQuestion.
 * ========================================================================= */

const SERIES_SCOPE_PREAMBLE = `SCOPE — SERIES-LEVEL ONLY.
This is an episodic project. PROJECT CONTEXT contains an OVERVIEW block scoped to the active episode AND a SHOW BIBLE block scoped to the whole series. For THIS task you are producing SERIES-LEVEL content for the show as a whole. Use the SHOW BIBLE block as the primary source. Use the active episode's OVERVIEW only as one data point among the larger series shape — never as the spine of what you're writing here. If you find yourself writing about "this episode" or "this week", stop and rewrite at the series level (the recurring pattern, the multi-season arc, the world, the ensemble).

OUTPUT DISCIPLINE — your response is being pasted DIRECTLY into a text field in the UI. Do NOT prefix your output with:
- A markdown header (\`# Series Logline\`, \`## Series Logline\`)
- A bold label (\`**Series Logline:**\`, \`**Logline:**\`)
- A field label of any kind (\`Series Logline:\`, \`Logline:\`)
- Quote marks wrapping the whole answer
Begin your response with the first word of the actual content. Anything that looks like a header or a field label will be displayed verbatim to the writer and is a failure of the task.`

export const generateSeriesLogline = (input: TaskInput) =>
  runText(
    'logline',
    input,
    `${SERIES_SCOPE_PREAMBLE}

Generate the SERIES logline — a single sentence pitching the WHOLE SHOW (not any episode):
- Names the protagonist (or core ensemble dynamic) + their recurring driver + the world they're up against + the multi-season stakes.
- Captures what the show IS — the recurring pattern audiences will tune in for week after week, season after season.
- 40 words max. No "in this series…" framing. No genre-tagging. No quote marks around it.

Output: the series logline only.`,
    400,
  )

export const generateSeriesShortSummary = (input: TaskInput) =>
  runText(
    'short_summary',
    input,
    `${SERIES_SCOPE_PREAMBLE}

Generate the SERIES short summary — one paragraph, 3–5 sentences:
- Pitches the show: hook, ensemble, world, recurring tension.
- Concrete and sensory — what does the show LOOK and FEEL like week to week.
- Names the engine — what generates an episode every week.
- Does NOT walk a single episode's plot.

Output: the series short summary only.`,
    600,
  )

export const generateSeriesLongSynopsis = (input: TaskInput) => {
  // Series long synopses are sized to "what a producer reads about a
  // show" — 500–900 words feels right regardless of per-episode length.
  // A 22-page hour and a 30-minute single-cam both warrant a similar
  // bible-length series pitch.
  return runText(
    'long_synopsis',
    input,
    `${SERIES_SCOPE_PREAMBLE}

Generate the SERIES long synopsis — multi-paragraph pitch describing the WHOLE SHOW:
- Open on the world, the protagonist's status quo, the recurring engine.
- The principal cast and the dynamics that define them.
- The first-season arc shape: where it starts, the midpoint pivot, the season's emotional spine, the finale's open question.
- A taste of the show's tone — how a typical episode opens and lands.
- Future-season runway: what arcs and unanswered questions extend past Season 1.
- 500–900 words. Structured paragraphs. Plain present tense. No genre-tagging preamble. No "in this series…" framing.

Do NOT walk a single episode's plot — write at the series altitude.

Output: the series long synopsis only.`,
    4000,
  )
}

export const generateSeriesEngine = (input: TaskInput) =>
  runText(
    'story_engine',
    input,
    `${SERIES_SCOPE_PREAMBLE}

Generate the show's ENGINE — one paragraph describing the recurring mechanism that produces a new episode every week:
- What dramatic situation arrives weekly?
- What's the recurring tension between procedural-of-the-week and the season-arc serialized spine?
- How does the engine SUSTAIN over multiple seasons without becoming repetitive?

Examples (don't copy; for shape only):
- "Each week a different client walks into Sarah's bar — but every case threads back to the cartel her father once ran with."
- "A morgue tech who can hear the dead solves one case per episode; the season arc is the case she will not let anyone hear."

Output: one short paragraph.`,
    400,
  )

export const generateSeasonArcQuestion = (input: TaskInput) =>
  runText(
    'central_question',
    input,
    `${SERIES_SCOPE_PREAMBLE}

Generate the SEASON ARC QUESTION — one sentence in the form of an unresolved yes/no question that the season's final episode will answer. Yes/no form is ideal but not required.

Examples (don't copy; for shape only):
- "Will Sarah bring her father to trial before the cartel buries the witness?"
- "Can the morgue tech finally let her sister rest?"

Output: one sentence, no quote marks.`,
    200,
  )

/* ============================================================================
 * Subplots (Theme · Stakes panel ↔ Beat Board)
 * ========================================================================= */

export type SubplotFieldKey = 'label' | 'description' | 'dramaticQuestion'

const SUBPLOT_FIELD_GUIDANCE: Record<SubplotFieldKey, { definition: string; constraint: string; tokens: number }> = {
  label: {
    definition: 'a short, evocative name for THIS subplot — how the writer\'s room would refer to it',
    constraint: '3–7 words. Specific and concrete (use THIS project\'s cast — e.g. "[Lead] & her sister", "The bank job", "[Antagonist]\'s addiction"). NOT generic ("the romance", "the B-plot").',
    tokens: 60,
  },
  description: {
    definition: 'a 2–4 sentence arc summary for THIS subplot — what changes from start to finish for the characters in this thread',
    constraint: '2–4 sentences. Plain present tense. Use named characters from the project (not "the protagonist"). State the SPECIFIC change in their relationship, position, or knowledge across the script. No theme essays.',
    tokens: 250,
  },
  dramaticQuestion: {
    definition: 'the central yes/no question THIS subplot poses, answered by the climax',
    constraint: 'One sentence in the form of a yes/no question. Use THIS project\'s named characters. NEVER substitute names from the prompt\'s example pool.',
    tokens: 100,
  },
}

/**
 * Generate one field for a specific subplot, using the rest of the
 * project as context (logline, synopsis, characters, theme, the OTHER
 * subplots so this one stays distinct).
 */
export async function suggestSubplotField(
  input: TaskInput,
  args: { subplot: Subplot; field: SubplotFieldKey; maxTokens?: number },
): Promise<TaskOutcome<string>> {
  const { subplot, field } = args
  const guidance = SUBPLOT_FIELD_GUIDANCE[field]
  if (!guidance) return { ok: false, error: `No template for subplot field "${field}".` }

  const others = (input.project.planning.subplots ?? []).filter(s => s.id !== subplot.id)
  const otherBlock = others.length === 0
    ? ''
    : `\n\nOTHER SUBPLOTS in this project (do not echo or rephrase these — this subplot must stand apart):\n${others.map(s => `  ${s.letter}-story "${s.label}"${s.description ? ` — ${s.description}` : ''}`).join('\n')}`

  const establishedBlock = `
THIS SUBPLOT — established fields (only ground truth; do not contradict):
- Letter: ${subplot.letter}
- Label: ${subplot.label || '(blank)'}
${field !== 'description' ? `- Description: ${subplot.description || '(blank)'}` : ''}
${field !== 'dramaticQuestion' ? `- Dramatic question: ${subplot.dramaticQuestion || '(blank)'}` : ''}
${field !== 'label' ? `- Label: ${subplot.label || '(blank)'}` : ''}
`.trim()

  const existingValue = (subplot as any)[field] as string | undefined
  const opening = existingValue
    ? `Refine the ${field} for subplot ${subplot.letter} ("${subplot.label || 'unnamed'}"). The current value is: "${existingValue}". Sharpen or replace.`
    : `Write the ${field} for subplot ${subplot.letter} ("${subplot.label || 'unnamed'}").`

  const instructions = `${opening}

DEFINITION: ${guidance.definition}.
CONSTRAINT: ${guidance.constraint}

${establishedBlock}${otherBlock}

HARD OUTPUT RULES:
- Output ONLY the value for "${field}" — no quotes, no preamble, no headers.
- Use specific character names from the project where available; never write "the protagonist" or "the love interest" generically.
- Do not write theme essays or abstract statements.`

  return runText('story_engine', input, instructions, args.maxTokens ?? guidance.tokens)
}

/**
 * Fill the empty fields on a single subplot in one shot.
 */
export async function fillSubplotFields(
  input: TaskInput,
  args: { subplot: Subplot },
): Promise<TaskOutcome<Partial<Subplot>>> {
  const { subplot } = args
  const missing: SubplotFieldKey[] = []
  if (!subplot.label || subplot.label === `${subplot.letter}-story`) missing.push('label')
  if (!subplot.description) missing.push('description')
  if (!subplot.dramaticQuestion) missing.push('dramaticQuestion')
  if (missing.length === 0) return { ok: false, error: 'This subplot is already filled.' }

  const others = (input.project.planning.subplots ?? []).filter(s => s.id !== subplot.id)
  const otherBlock = others.length === 0
    ? ''
    : `\n\nOTHER SUBPLOTS (must remain distinct from these):\n${others.map(s => `  ${s.letter}-story "${s.label}" — ${s.description || '(no description)'}`).join('\n')}`

  return runJSON<Partial<Subplot>>(
    'story_engine',
    input,
    `Fill ONLY the empty fields of this subplot. Fields to produce: ${missing.join(', ')}.

THIS SUBPLOT:
- Letter: ${subplot.letter}
- Existing label: ${subplot.label || '(empty)'}
- Existing description: ${subplot.description || '(empty)'}
- Existing dramatic question: ${subplot.dramaticQuestion || '(empty)'}
${otherBlock}

Field constraints:
- label: 3–7 specific words, never generic (use THIS project's cast — e.g. "[Lead] & her sister", not "the relationship").
- description: 2–4 sentences, present tense, named characters, specific change start→end.
- dramaticQuestion: one yes/no question answered by the climax.

Use named characters from the project (not "the protagonist"). Do not contradict the project's logline, synopsis, or other subplots.

Return JSON with ONLY the missing fields, using these exact names: ${missing.join(', ')}.`,
    1200,
  )
}

/* ============================================================================
 * List tasks
 * ========================================================================= */

export const generateWorldRules = (input: TaskInput) =>
  runJSON<{ rules: string[] }>('world_rules', input, `Generate 4–8 concrete world rules: things that define how this world works (physical, social, magical, technological, moral). Each rule is one short sentence. Avoid the obvious; surface the rules that will pressure decisions later.

Return JSON: { "rules": ["...","..."] }`, 600)

export const generateHardConstraints = (input: TaskInput) =>
  runJSON<{ constraints: string[] }>('hard_constraints', input, `Generate 3–6 hard constraints — author-locked facts the AI must always respect. Things like: "Inciting incident lands on page 12", "Protagonist is named X", "Antagonist is never killed". Each one is one sentence.

Return JSON: { "constraints": ["...","..."] }`, 500)

export const generateThemeTags = (input: TaskInput) =>
  runJSON<{ themes: string[] }>('theme_question', input, `Generate 3–6 short theme tags (1–3 words each) that describe what the story is *really* about. Examples: "grief and forgiveness", "the cost of ambition", "loyalty vs truth".

Return JSON: { "themes": ["...","..."] }`, 300)

/* ============================================================================
 * Character generation
 * ========================================================================= */

export interface AICharacter {
  name?: string
  age?: string
  role?: Character['role']
  /**
   * The brief, on-page introduction phrase (4–12 words, visual + behavioral).
   * This is the line that lands when the character first walks into a scene.
   */
  shortDescription?: string
  /**
   * The full character bible — multi-paragraph, rich, deeply detailed.
   * This is the planning-side ground truth: childhood, formative trauma,
   * education, work history, relationships, beliefs, mannerisms, present-day
   * texture. The screenwriter never reproduces this on the page, but knowing
   * it underwrites every choice the character makes.
   */
  biography?: string
  externalGoal?: string
  internalNeed?: string
  wound?: string
  fear?: string
  flaw?: string
  secret?: string
  publicCost?: string
  privateCost?: string
  arcStart?: string
  arcEnd?: string
  arcTurn?: string
  voiceNotes?: string
  verbalTics?: string[]
}

/**
 * Convert an (optional, defensive) AICharacter payload into a full Character.
 * Tolerates missing fields and weird casings from the model.
 */
export function aiCharacterToCharacter(
  ai: AICharacter | null | undefined,
  opts?: { provenance?: Character['provenance']; needsReview?: boolean },
): Character {
  const safe = (ai ?? {}) as AICharacter
  const rawName = typeof safe.name === 'string' ? safe.name : ''
  const role = ((): Character['role'] => {
    const r = (safe.role ?? '').toString().toLowerCase()
    const allowed: Character['role'][] = [
      'protagonist', 'antagonist', 'love_interest', 'ally', 'foil',
      'mentor', 'tempter', 'ghost', 'supporting', 'minor', 'ensemble',
    ]
    return (allowed as string[]).includes(r) ? (r as Character['role']) : 'supporting'
  })()
  return {
    id: newId<CharacterId>(),
    name: rawName.trim().toUpperCase() || 'NEW CHARACTER',
    age: safe.age ?? '',
    shortDescription: safe.shortDescription ?? '',
    biography: safe.biography ?? '',
    role,
    externalGoal: safe.externalGoal ?? '',
    internalNeed: safe.internalNeed ?? '',
    wound: safe.wound ?? '',
    fear: safe.fear ?? '',
    flaw: safe.flaw ?? '',
    secret: safe.secret ?? '',
    publicCost: safe.publicCost ?? '',
    privateCost: safe.privateCost ?? '',
    arcStart: safe.arcStart ?? '',
    arcEnd: safe.arcEnd ?? '',
    arcTurn: safe.arcTurn ?? '',
    relationships: [],
    voice: {
      ...blankVoiceFingerprint(),
      notes: safe.voiceNotes ?? '',
      verbalTics: Array.isArray(safe.verbalTics) ? safe.verbalTics : [],
    },
    state: blankCharacterState(),
    introduced: false,
    lockedFields: [],
    provenance: opts?.provenance ?? 'ai_bible',
    needsReview: opts?.needsReview ?? false,
  }
}

export async function generateCharacterBible(
  input: TaskInput,
  seed?: { name?: string; role?: Character['role']; hint?: string },
): Promise<TaskOutcome<Character>> {
  const seedBlock = seed
    ? `Seed: ${[
        seed.name ? `name "${seed.name}"` : '',
        seed.role ? `role "${seed.role}"` : '',
        seed.hint ? `hint: ${seed.hint}` : '',
      ].filter(Boolean).join(', ')}`
    : ''

  const res = await runJSON<AICharacter>(
    'character_full_bible',
    input,
    `Generate a complete character bible. ${seedBlock}

This is the PLANNING bible — the writer's deep ground truth on who this person is. The script never reproduces most of it, but every choice the writer makes is informed by it. Produce DEPTH. The only field that is intentionally brief is \`shortDescription\` (the on-page introduction line). Every other field should read like a working screenwriter's bible: specific, concrete, multi-sentence where appropriate, with real psychological and circumstantial detail.

Fields:

- name: ALL CAPS for first appearance.

- age: a useful descriptor — e.g., "34", "late 20s", "early 60s".

- role: one of: protagonist, antagonist, love_interest, ally, foil, mentor, tempter, ghost, supporting, minor, ensemble.

- shortDescription (THE ONLY BRIEF FIELD — for the script page, not the bible):
  4–12 words. Purely visual + behavioral. What they LOOK LIKE and HOW THEY CARRY THEMSELVES. NEVER backstory, family history, profession context, motivation, goals, themes, or "X who recently Y" framing.
  GOOD: "sharp-eyed and sleep-deprived" / "packed muscle, granite face" / "wears Whites, looks like he hasn't slept".
  BAD: "broke architecture student three weeks from graduation, daughter of a worker who died...".

- biography (FULL bible profile — DEEP, RICH, multi-paragraph):
  4–8 dense paragraphs (400–900 words). Treat this like a working screenwriter writes for themselves before drafting. Cover, with specific facts:
    * Where and how they grew up — city, household, what the air smelled like, who else lived there. Class, money, language at home.
    * The defining childhood event(s) that bent the protagonist's worldview. Be specific (a fire, a death, a betrayal, a promise extracted under duress, an embarrassing public moment that wired their identity).
    * Education and the path that brought them to today's profession. Real institutions or specific equivalents. Mentor or anti-mentor figures by name.
    * Romantic and family relationships across time — who came before the story's present, what ended each, what they took from each.
    * Work history. The specific job they're in now. The job they almost took. The thing they were good at that they had to give up.
    * Health, habits, vices. What they eat. What they avoid. The drink, the cigarette, the run, the late-night thing. Sleep patterns.
    * Money. Bills they're behind on. Money they've hidden. What they spend irrationally on.
    * Their public reputation vs. their private self. Who knows what version.
    * Beliefs — political, religious, superstitious, magical thinking. What rituals they do.
    * A signature object or wardrobe choice with specific origin.
    * One thing they'd never tell anyone.
    * The line they think is true that the story is going to break.
  Do NOT bullet-list. Write it as prose, as if dossier-writing. Use named places, named people, specific times. Never write "X may have grown up..." — commit to a fact and own it.

- externalGoal: 2–3 sentences. The scene-playable thing they're pursuing in the story's now. Verb-led, concrete, with a specific finish line ("get her daughter back from CPS by the custody hearing on the 18th").

- internalNeed: 2–3 sentences. The internal change required to grow. State the lie they live by AND the truth they must accept.

- wound: 3–5 sentences. A specific past event AND the false belief they took from it. Use real details — the locker room, the funeral, the night their mother left. NEVER abstract trauma labels.

- fear: 2–3 sentences. What they would do almost anything to avoid, and the specific moment they last felt it.

- flaw: 2–3 sentences. The recurring maladaptive behavior under pressure. Not a label ("arrogant") — a pattern ("under pressure he picks the fight he can win to avoid the fight he can't").

- secret: 2–4 sentences. A concrete fact they're hiding, who they're hiding it from, and the specific consequence when it lands.

- publicCost: one full paragraph. Concrete external losses (job, custody, freedom, exposure, reputation) — name the things, not generalities.

- privateCost: one full paragraph. The identity and relationship losses. What they can't survive in themselves.

- arcStart: one full paragraph. The default, the comfortable lie, the daily life that's about to collapse. Specific habits and choices that prove it.

- arcEnd: one full paragraph. The transformation made permanent. Distinct from arcStart. Includes a specific behavior that demonstrates the new self.

- arcTurn: 2–3 sentences. The ONE final choice or behavior that PROVES the change. An action, not a feeling. The moment that could only happen now.

- voiceNotes: 3–5 sentences. Cadence, register, humor, restraint, the verbal habits that mark them as them. Specific words they would use; words they wouldn't. Their default tactic in conflict.

- verbalTics: array of 0–4 short phrases or sign-offs they actually say.

The character must fit the project's tone, themes, and existing cast (no duplicates or contradictions). Hard rules from the system prompt apply.

Return JSON only.`,
    6000,
  )
  if (!res.ok) return res

  const character = aiCharacterToCharacter(res.value, { provenance: 'ai_bible' })
  return { ok: true, value: character, raw: res.raw, modelId: res.modelId }
}

/* ============================================================================
 * Build the full cast from planning data
 * ========================================================================= */

interface AICastBundle {
  /** Major roles: protagonist, antagonist, principal allies. */
  leads?: AICharacter[]
  /** Secondary: foils, mentors, love interest, recurring side characters. */
  supporting?: AICharacter[]
  /** Tertiary: minor named characters with one function (witness, fixer, etc.). */
  tertiary?: AICharacter[]
}

/**
 * Read the project's Overview (logline, summaries, synopsis, themes, story
 * engine, world rules, hard constraints, stakes, A/B/C stories) and build a
 * complete cast in one pass.
 *
 * Produces:
 *   - 1 protagonist (or co-leads when the logline implies more)
 *   - 1–2 antagonists / principal opposing forces
 *   - 2–5 supporting characters (mentor, foil, love interest, ally)
 *   - 0–4 tertiary characters whose function the synopsis already implies
 *
 * Leads + supporting get full bibles. Tertiary characters get short stubs
 * (name, role, age, shortDescription, externalGoal). The writer (or "Fill
 * empty fields") can deepen them later.
 *
 * Honors existing characters in the bible: anyone already there is left
 * alone. The model is told not to duplicate.
 */
export async function buildCastFromPlanning(
  input: TaskInput,
): Promise<TaskOutcome<{ characters: Character[] }>> {
  const project = input.project
  const planning = project.planning
  const existing = project.characters.map(c => c.name).filter(Boolean)

  // Collect the "signal" the cast generator can draw from. We pull from
  // every populated overview field across THREE places, because where
  // the story data lives depends on the project type:
  //
  //   1. Project-level planning (logline / shortSummary / longSynopsis /
  //      etc.). Filled in by standalone-feature projects via OverviewPanel.
  //   2. Series-level Show Bible (seriesPlan.seriesLogline /
  //      seriesShortSummary / seriesLongSynopsis / engine / season arc).
  //      Filled in by episodic projects via SeriesPanel.
  //   3. Active-episode overview (seriesPlan.episodes[active].logline /
  //      summary / longSynopsis / centralDramaticQuestion / themes).
  //      Filled in by episodic projects via the new EpisodeOverview UI.
  //
  // Without this, episodic projects fail the guard below — their
  // project.planning.* fields are empty (the wizard wrote to the series
  // / episode fields instead), and the writer sees "Overview is too
  // thin to build a cast from" despite having filled in everything that
  // matters.
  const sp = planning.seriesPlan
  const activeEp = sp?.activeEpisodeId
    ? sp.episodes.find(e => e.id === sp.activeEpisodeId)
    : null

  const overviewSignal = [
    // Project-level
    planning.logline,
    planning.shortSummary,
    planning.longSynopsis,
    planning.centralDramaticQuestion,
    planning.storyEngine,
    planning.themeQuestion,
    planning.externalStakes,
    planning.internalStakes,
    planning.aStory,
    planning.bStory,
    planning.cStory,
    // Series-level (Show Bible)
    sp?.seriesLogline,
    sp?.seriesShortSummary,
    sp?.seriesLongSynopsis,
    sp?.premise,
    sp?.engine,
    sp?.seasonArcQuestion,
    // Active-episode level
    activeEp?.logline,
    activeEp?.summary,
    activeEp?.longSynopsis,
    activeEp?.centralDramaticQuestion,
    activeEp?.themeQuestion,
    activeEp?.hook,
  ].filter(Boolean).join(' ').trim()

  if (overviewSignal.length < 40) {
    const isEpisodic = !!sp && !project.format.verticalSandbox
    const hint = isEpisodic
      ? 'Fill in either the Show Bible (series logline + short summary) or the active Episode Overview (episode logline + short summary), then try again.'
      : 'Fill in at least the logline and a short summary, then try again.'
    return {
      ok: false,
      error: `Overview is too thin to build a cast from. ${hint}`,
    }
  }

  const existingBlock = existing.length
    ? `\n\nExisting cast (do NOT recreate; you may reference them by name):\n${existing.map(n => `- ${n}`).join('\n')}`
    : ''

  const res = await runJSON<AICastBundle>(
    'character_full_bible',
    input,
    `Build the project's cast from the Overview/Planning data above.

CHARACTER NAMES MUST BE INVENTED FRESH FOR THIS PROJECT. Do NOT use any name that appears anywhere in this system prompt's reference-script excerpts, BAD/GOOD examples, or sample cards — those names belong to other writers' works and were included for voice / structure illustration only.

How to name a character: read the project's logline, short summary, long synopsis, theme question, story engine, world rules, A/B/C stories, and the region/era/ethnicity/class/profession implied by all of those. INVENT names that feel inevitable for THIS specific story's world. Working screenwriters do not generic-cast leads; they choose names that read as belonging to the world.

If you find yourself reaching for a "default" lead name out of habit, stop — that's pattern-matching from your training, not invention. Choose a different name that genuinely belongs to this project's world.

Step 1: Read the logline, summaries, synopsis, theme question, story engine, stakes, and A/B/C stories. Extract every character explicitly named or strongly implied by a function (e.g., "her estranged mother", "the FBI agent who won't quit", "the boyfriend who lied").

Step 2: Build the cast in three tiers. CRITICAL: this is a PLANNING bible. Leads and supporting must come back DEEPLY DETAILED — multi-paragraph biographies, multi-sentence wounds/flaws/secrets, full publicCost / privateCost / arcStart / arcEnd paragraphs, real voiceNotes. The only field that is intentionally brief is \`shortDescription\` (the on-page intro line, 4–12 words). Every other field must read like a working screenwriter's profile, not a stub.

LEADS (1–3 characters, FULL deep bibles):
- The protagonist (always, unless the logline truly suggests an ensemble).
- The principal antagonist or opposing force, if there's a clear human one.
- Any co-lead that the logline names as equally central.
- Each lead's BIOGRAPHY: 4–8 dense paragraphs (400–900 words). Cover childhood and the formative event(s) that bent their worldview; education; mentor/anti-mentor figures; prior romantic and family relationships and how each ended; work history including the job they almost took; health/habits/vices/sleep patterns; money — bills behind on, hidden money, irrational spending; public reputation vs private self; beliefs and rituals; a signature object or wardrobe choice with origin; one thing they'd never tell anyone; the lie they live by that the story will break. Commit to specific facts — named places, named people, specific times. Do not bullet-list; write prose.

SUPPORTING (2–5 characters, FULL deep bibles):
- The figures whose pressure the protagonist actually feels week-to-week: mentor, foil, love interest, ally, family.
- Each one must have a distinct function vs the leads. No two voices should overlap.
- Each supporting BIOGRAPHY: 2–4 paragraphs (250–600 words). Same depth principles as leads — be specific, name things — but tighter.

TERTIARY (0–4 characters, lean stubs):
- Named minor roles already implied by the synopsis (the boss, the doctor, the brother who shows up in act three).
- Stubs only: name, age, role, shortDescription, externalGoal. Biography and other fields can stay empty.

Hard rules:
- Use names already in the Overview text when present. Otherwise invent names that fit tone and culture.
- Do NOT duplicate or rename anyone in the existing cast list.
- Each character must have a distinct want/need/wound. No two protagonists. No two antagonists that share the same function.
- The leads' wounds must connect to the theme question.
- Roles must come from this list: protagonist, antagonist, love_interest, ally, foil, mentor, tempter, ghost, supporting, minor, ensemble.

shortDescription discipline (industry standard — this is the ONLY brief field):
- 4–12 words. PURELY visual + behavioral — what they LOOK LIKE and HOW THEY CARRY THEMSELVES.
- One or two short comma-separated observations.
- NEVER backstory, family ("daughter of..."), profession context ("broke architecture student..."), motivation ("desperate to..."), or themes.
- GOOD: "sharp-eyed and sleep-deprived" / "pleated khakis, nervous mustache" / "packed muscle, granite face".
- BAD (do not produce): anything that reads as a parenthetical biography.
- All BACKSTORY belongs in the biography field, NOT here.

Other field depth (NOT brief — produce real, working-screenwriter detail):
- wound: 3–5 sentences with a specific past event and the false belief taken from it. Real details — the locker room, the funeral, the night their mother left.
- fear: 2–3 sentences with the specific moment they last felt it.
- flaw: 2–3 sentences describing the recurring maladaptive PATTERN under pressure, not a one-word label.
- secret: 2–4 sentences naming the fact, who it's hidden from, and what happens when it lands.
- publicCost, privateCost: each one full paragraph with concrete, named consequences.
- arcStart, arcEnd: each one full paragraph. arcStart shows the comfortable lie / daily life that's about to collapse; arcEnd shows the transformation made permanent with a specific demonstrating behavior.
- arcTurn: 2–3 sentences naming the ONE specific final action that proves the change.

Voice differentiation:
- Each lead's voiceNotes must specify cadence, register, humor mode, and emotional restraint across 3–5 sentences. Include specific words they would and would not use; their default tactic in conflict. The combination must be unmistakably different from the others.

${existingBlock}

Return JSON:
{
  "leads":      [ { ...full AICharacter fields with DEEP biography... } ],
  "supporting": [ { ...full AICharacter fields with biography... } ],
  "tertiary":   [ { name, age, role, shortDescription, externalGoal } ]
}`,
    // Each lead's biography alone can run 900 words; the bundle as a whole
    // can easily approach 20K tokens. Give it room — the chunker handles
    // truncation if a particular run still overshoots.
    24000,
  )

  if (!res.ok) return res

  const bundle = res.value ?? {}
  const existingUpper = new Set(existing.map(n => n.trim().toUpperCase()))

  // Coerce each tier with the right provenance + reviewability.
  const leads = (Array.isArray(bundle.leads) ? bundle.leads : [])
    .map(c => aiCharacterToCharacter(c, { provenance: 'ai_bible', needsReview: false }))
  const supporting = (Array.isArray(bundle.supporting) ? bundle.supporting : [])
    .map(c => aiCharacterToCharacter(c, { provenance: 'ai_bible', needsReview: false }))
  const tertiary = (Array.isArray(bundle.tertiary) ? bundle.tertiary : [])
    .map(c => aiCharacterToCharacter(c, { provenance: 'ai_bible', needsReview: true }))

  // Drop any duplicates against the existing cast.
  const all = [...leads, ...supporting, ...tertiary].filter(
    c => !existingUpper.has(c.name.trim().toUpperCase()),
  )

  if (all.length === 0) {
    return {
      ok: false,
      error: 'The model returned a cast bundle with no usable characters. Try again with a more detailed Overview.',
    }
  }

  return { ok: true, value: { characters: all }, raw: res.raw, modelId: res.modelId }
}

/** Fill missing fields on an existing character. */
export async function fillCharacterFields(
  input: TaskInput,
  character: Character,
): Promise<TaskOutcome<Partial<Character>>> {
  const missing: string[] = []
  if (!character.shortDescription) missing.push('shortDescription')
  if (!character.biography) missing.push('biography')
  if (!character.externalGoal) missing.push('externalGoal')
  if (!character.internalNeed) missing.push('internalNeed')
  if (!character.wound) missing.push('wound')
  if (!character.fear) missing.push('fear')
  if (!character.flaw) missing.push('flaw')
  if (!character.secret) missing.push('secret')
  if (!character.publicCost) missing.push('publicCost')
  if (!character.privateCost) missing.push('privateCost')
  if (!character.arcStart) missing.push('arcStart')
  if (!character.arcEnd) missing.push('arcEnd')
  if (!character.arcTurn) missing.push('arcTurn')
  if (missing.length === 0) {
    return { ok: false, error: 'All character fields are already filled.' }
  }

  return runJSON<Partial<Character>>(
    'character_field',
    input,
    `For the character "${character.name}" (${character.age || 'age?'}, ${character.role}), fill in the missing fields: ${missing.join(', ')}.

Use the character's existing data as ground truth — never contradict it. Use the project's themes, stakes, and other characters to make this character pressure the protagonist's core question.

DEPTH REQUIREMENTS (this is the planning bible — produce real working-screenwriter detail, NOT one-line stubs):
- shortDescription: 4–12 words. Visual + behavioral ONLY. The on-page intro line. BAD if it contains backstory or goals.
- biography: 3–8 dense paragraphs (300–900 words). Childhood, formative event(s) with specific named places/people, education, mentor figures, prior relationships and how each ended, work history, vices, money, beliefs, a signature object, one thing they'd never tell anyone, the lie they live by that the story will break. Commit to specific facts. Do not hedge with "may have" or "possibly".
- wound: 3–5 sentences with a SPECIFIC past event and the false belief taken from it.
- fear: 2–3 sentences naming the specific moment they last felt it.
- flaw: 2–3 sentences describing the recurring maladaptive PATTERN under pressure.
- secret: 2–4 sentences naming the fact, who it's hidden from, the specific consequence when it lands.
- publicCost / privateCost: each one full paragraph of concrete named consequences.
- arcStart / arcEnd: each one full paragraph — comfortable lie collapsing → transformation made permanent.
- arcTurn: 2–3 sentences naming the specific final action that proves the change.
- externalGoal / internalNeed: 2–3 sentences each, concrete and observable.

Return JSON with only the missing fields. Field names match exactly: ${missing.join(', ')}.`,
    8000,
  )
}

/* ============================================================================
 * Beat / outline generation
 * ========================================================================= */

interface AIBeat {
  title: string
  body: string
  actNumber?: number
  pageRangeStart?: number
  pageRangeEnd?: number
  storyPurpose: string
  characterObjective: string
  obstacle: string
  valueAtStart: string
  valueAtEnd: string
  changeMechanism: string
  newInformation: string
  emotionalCharge: string
  actOut?: string
  /**
   * Letter of the subplot this beat primarily belongs to ("A", "B", "C", "D").
   * Required when the project has named subplots — the AI must rotate.
   */
  subplotLetter?: string
  /** Optional secondary subplots this beat also touches (intersection beats). */
  secondarySubplotLetters?: string[]
}

export const generateBeatStructure = (input: TaskInput) => {
  const project = input.project
  const subplots = project.format.substanceTargets.subplotLabels
  const subplotLetters = subplots.map(s => s.letter)
  const isVerticalProject = !!project.format.verticalSandbox
  // Page target — writer's foundational guidance wins, per-episode count
  // next, project total last. This is the number the beat density must
  // scale to. For Vertical it's 2 (one episode), but each Beat row IS
  // an episode, so the beat-count band is separate (see below).
  const targetPages = effectivePageTarget(input)
  const totalActs = project.format.structure.targetActs || 3
  // Beat count band.
  //
  // VERTICAL projects are EXEMPT from page scaling — in vertical mode a
  // "beat" IS an episode (the 2-page audience-facing unit), and the
  // format preset already specifies 30–70 episodes per season. Scaling
  // that down to the 2-page band (2–4) would collapse the whole season
  // into 3 episodes.
  //
  // For everything else, derive the band from the effective page target
  // so a 2-page animated short doesn't try to outline in 24 beats.
  const legacy = project.format.substanceTargets.beats
  const targets = isVerticalProject
    ? { ...legacy }
    : (() => {
        const scaledBeats = scaledBeatRange(targetPages)
        return {
          min: Math.min(scaledBeats.min, legacy.min),
          ideal: scaledBeats.ideal,
          max: Math.min(scaledBeats.max, legacy.max),
        }
      })()

  const existing = [...project.beats].sort((a, b) => {
    const pa = a.pageRangeStart ?? a.actNumber ?? 0
    const pb = b.pageRangeStart ?? b.actNumber ?? 0
    return pa - pb
  })

  // Count what's been delivered so far per subplot.
  const subplotByLetter = new Map<string, typeof project.planning.subplots[number]>()
  for (const sp of project.planning.subplots ?? []) {
    subplotByLetter.set(sp.letter, sp)
  }
  const existingByLetter: Record<string, number> = {}
  for (const b of existing) {
    const firstSubplotId = b.subplotIds?.[0]
    const sub = firstSubplotId
      ? (project.planning.subplots ?? []).find(s => s.id === firstSubplotId)
      : null
    const letter = sub?.letter ?? '?'
    existingByLetter[letter] = (existingByLetter[letter] ?? 0) + 1
  }

  const existingBlock = existing.length === 0
    ? ''
    : `\n\nEXISTING BEATS — DO NOT REGENERATE OR MODIFY. You are continuing from beat ${existing.length + 1}.\n${
        existing.map((b, i) => `  ${i + 1}. ${b.actNumber ? `[Act ${b.actNumber}] ` : ''}${b.pageRangeStart ? `(p.${b.pageRangeStart}–${b.pageRangeEnd ?? b.pageRangeStart}) ` : ''}${b.title || '(untitled)'}${b.valueAtStart && b.valueAtEnd ? ` — ${b.valueAtStart} → ${b.valueAtEnd}` : ''}`).join('\n')
      }`

  // Subplots block.
  const subplotBlock = subplots.length === 0
    ? ''
    : `\n\nSUBPLOTS — every beat MUST be tagged with a primary subplot letter, and you MUST rotate between subplots so no single thread dominates more than ~50% of beats. Beats are most effective when they ALSO touch a secondary subplot (use the "secondarySubplotLetters" field).\n${
        subplots.map(s => {
          const named = subplotByLetter.get(s.letter)
          const label = named?.label || `${s.letter}-story`
          const desc = named?.description || s.conventionalRole
          const count = existingByLetter[s.letter] ?? 0
          return `  ${s.letter}-story ("${label}"): ${desc}${count > 0 ? ` — ${count} beat${count === 1 ? '' : 's'} so far` : ''}`
        }).join('\n')
      }\n\nROTATION DISCIPLINE: walk through the beats in story order and rotate the primary subplot letter (A, B, A, C, A, B, D, A, …). It is rare for the same letter to appear in 3 consecutive beats — when it does, the third should EXIT that subplot.`

  // Page math.
  const newBeatTargetCount = Math.max(0, targets.ideal - existing.length)
  const newBeatRange = `${Math.max(0, targets.min - existing.length)}–${Math.max(0, targets.max - existing.length)}`

  // Tight-page-target framing. When the project is tiny (≤ 10 pages), a
  // 24-beat outline is absurd — it's a sketch / vignette / micro-piece
  // and the AI must think INTUITIVELY about how a piece of this size
  // actually plays. Explicit instructions, not just smaller numbers.
  //
  // VERTICAL projects bypass this framing entirely: their "beats" are
  // EPISODES, not 1-page structural milestones, so the season-level
  // beat count is 30–70 even though each episode is 2 pages. Vertical
  // gets its own dedicated framing block below.
  const tightFraming = isVerticalProject
    ? ''
    : targetPages <= 10
      ? `\n\nINTUITIVE PAGE-COUNT REASONING — THIS IS A ${targetPages}-PAGE PROJECT.
- That's a sketch / vignette / micro-piece, NOT a feature or a TV episode. Treat it that way.
- A ${targetPages}-page show plays in ~${Math.max(1, Math.round(targetPages))} minute${targetPages === 1 ? '' : 's'} of screen time. It doesn't have room for a 24-beat outline.
- ${targetPages <= 2 ? 'TWO PAGES means: setup, turn, finish. THREE beats. Sometimes FOUR. Anything more is padding the page count cannot hold.' : targetPages <= 5 ? 'FIVE PAGES means: setup, complication, turn, resolution. FOUR to SIX beats.' : 'UNDER TEN PAGES means: setup, escalation(s), turn, resolution. FIVE to NINE beats.'}
- Cut subplot rotation entirely. A piece this short cannot service multiple subplots in parallel.
- Compress acts. A 2-page show is essentially one act; do not force a 3-act structure that doesn't fit.
- The writer's foundational guidance says ${targetPages} pages. Obey it. If you find yourself producing more beats than the band above, you have failed the scope — start over with fewer.`
      : ''

  // Vertical-specific beat-generation framing. Each Beat row IS an
  // episode. Each episode is a 2-page micro-unit with the FIXED
  // 4-internal-beat shape: Rise → Spike → Drop → Cliff. These rules
  // are NON-NEGOTIABLE; the writer has explicitly built in this
  // sandbox precisely so they aren't optional.
  const verticalFraming = isVerticalProject
    ? `\n\nVERTICAL BEAT GENERATION — NON-NEGOTIABLE RULES.
THIS IS A VERTICAL DRAMA. Every "beat" you generate IS AN EPISODE — a 2-page audience-facing micro-unit, NOT a one-page structural milestone inside a longer script.

EVERY EPISODE you produce must contain the FIXED 4-INTERNAL-BEAT SHAPE in this exact order:
  1. RISE  — the situation ramps up. Tension or anticipation builds.
  2. SPIKE — the dopamine climax. A slap, a kiss, a reveal, a betrayal, a fight, an arrest. The moment the audience came for.
  3. DROP  — the fallout. The consequence / emotional downturn / new pressure that comes from the Spike.
  4. CLIFF — THE HOOK. Unresolved cliffhanger that FORCES the next swipe. End on this. NEVER let an episode resolve cleanly. The Cliff is the most important beat — it is what earns the next view.

THESE 4 BEATS LIVE INSIDE EACH EPISODE — they are structural, not separate Beat rows on the board. ONE Beat row = ONE Episode = 2 pages = Rise + Spike + Drop + Cliff.

WRITE EACH EPISODE LIKE:
- title: a punchy episode title (NOT a generic "Episode 7").
- body / storyPurpose: name what Rise / Spike / Drop / Cliff each do in THIS episode. Name the Spike (the dopamine moment). Name the Cliff (the hook line / image / reveal that forces the next swipe).
- valueAtStart → valueAtEnd: the value flip across the episode.
- changeMechanism: the Spike moment, said concretely.
- actOut: the Cliff. The literal hook the episode ends on. Required for every episode.
- subplotLetter: rotate across episodes if subplots are defined.

PAGE BUDGET PER EPISODE: 2 pages. Exact. The internal 4 beats fit inside that. Each episode draft is ~30 seconds of screen time.

PACING: hook density. Every 60–90 seconds of screen needs a moment. Vertical voice is on-the-nose, declarative, melodramatic — never literary or reflective.

DO NOT mistake a vertical episode for a feature beat. A feature beat = 2 pages of build-up to one moment. A vertical episode = 2 pages of Rise → Spike → Drop → Cliff every time. Skip ANY of the four and the episode fails.

REFERENCE: the VERTICAL_REFERENCE_SAMPLES at the top of this system prompt ("Borgeous", "Secret Prince") are gospel for register, hook density, and the on-the-nose voice. If your episode does not read like it could appear in those samples, rewrite.

The format preset specifies ${targets.ideal} episodes per season (range ${targets.min}–${targets.max}). Generate ${existing.length === 0 ? `that many ${targets.ideal} episodes now` : `the remaining episodes`} — each one a full Rise / Spike / Drop / Cliff.`
    : ''

  const directive = existing.length === 0
    ? isVerticalProject
      ? `Generate the complete EPISODE list for this Vertical Drama season. ${targets.ideal} episodes (range ${targets.min}–${targets.max}). Each episode follows the Rise → Spike → Drop → Cliff structure described below.${verticalFraming}`
      : `Generate the complete beat structure for this ${project.format.label}. This is a ${targetPages}-page script. The right density is ${targets.ideal} beats (range ${targets.min}–${targets.max}). You MUST hit at least ${targets.min} beats. ${targets.ideal} is the target.${tightFraming}`
    : isVerticalProject
      ? `Continue the EPISODE list. ${existing.length} episodes already exist (see below). Produce the remaining episodes — approximately ${newBeatTargetCount} more, in the range ${newBeatRange} — each a full Rise → Spike → Drop → Cliff that escalates the season-arc question.${verticalFraming}`
      : `Continue the beat structure. ${existing.length} beats already exist (see below). Produce the remaining beats — approximately ${newBeatTargetCount} more, in the range ${newBeatRange} — that take this outline to the end of the story (climax + resolution / final act-out).${tightFraming}`

  // Format-specific structural markers.
  const formatMarkers = (() => {
    if (project.format.kind === 'feature_horror') {
      return `\n\nHORROR FEATURE STRUCTURAL MARKERS — every horror outline MUST include explicit beats at these positions:
- Cold Open / Pre-Title Scare (~pages 1–3): a self-contained hook scene that establishes the threat's iconography, OR a misdirect that pays off later. Never just a "normal day".
- Opening Image: the world before the threat lands.
- Setup of the Protagonist's Isolation: what cuts them off — geographic, social, psychological. Show this explicitly across 2–3 beats. Horror's protagonist must be ISOLATABLE.
- The Rules of the World / Threat: state the supernatural / spatial / behavioral rules in dialogue or in action. These rules are Chekhov's guns — every one stated must be violated or paid off later.
- Inciting Incident (~page 12–15): the first irreversible contact with the threat. Not just a noise — a violation.
- Debate / Denial (2–3 beats): characters rationalize, refuse to act, blame mundane explanations.
- Break Into Act 2 (~page 25): the moment denial collapses and they commit to confronting / fleeing / investigating.
- Escalation Sequence (Act 2A — 5–8 beats): multiple discrete encounters/scares/kills, each one violating one of the established rules in a way that's more transgressive than the last. Show variety of attack vectors.
- Midpoint Reveal (~page 55): a piece of information that recontextualizes the threat — "it's not what we thought", "we caused this", "we can't kill it the normal way". This MUST change the strategy.
- Bad Guys Close In (Act 2B — 5–8 beats): the threat finds them where they thought they were safe; allies die; the protagonist's tools fail.
- All Is Lost (~page 75): the false dawn fails or the loved one dies or the rule the protagonist trusted breaks.
- Dark Night of the Soul: the protagonist alone with the cost. The threat sometimes pauses here — the silence is the scariest beat in the script.
- Break Into Act 3 (~page 85): a final, costly insight — what the threat actually wants, or what the protagonist will sacrifice.
- Final Confrontation Sequence (4–8 beats): pursuit / siege / ritual / standoff. Includes a false defeat ("I killed it") followed by one last violation.
- Final Image: matched to or violating the opening image. Does the threat survive? Did the protagonist survive whole? Horror endings reward ambiguity OR an unambiguous cost.

HORROR-SPECIFIC SUBSTANCE RULES (these are non-negotiable for this genre):
- Every "rule of the world" you state MUST be violated, paid off, or revealed false. Unfired rules are filler.
- A kill / scare / encounter beat is not enough on its own — it must (a) advance information, (b) change someone's belief, or (c) close off an escape route. If it does none of those, cut it.
- No randomly placed jump scares. Each scare beat earns its position via setup-payoff with a prior rule or piece of iconography.
- The threat must have CONSISTENT internal logic. Document it in the "rules" subplot if you have one.
- Character deaths (when used) must each cost the protagonist something specific. A "redshirt" kill is filler unless it teaches the protagonist a rule, removes a resource, or violates an audience expectation.`
    }
    if (project.format.kind === 'feature_drama' || project.format.kind === 'feature_comedy') {
      return `\n\nFEATURE STRUCTURAL MARKERS — the outline MUST include explicit beats at these positions (use them in beat titles):
- Opening Image (beat 1)
- Theme Stated (early Act 1)
- Setup (3 separate beats showing protagonist at home, work, and at play)
- Catalyst / Inciting Incident (~page 12)
- Debate (2–3 beats of resistance)
- Break Into Act 2 (~page 25)
- B-Story Introduction (just after the Break)
- Promise of the Premise (Act 2A — the fun pages, multiple beats)
- Midpoint (~page 55) — false victory or false defeat
- Bad Guys Close In (Act 2B — escalating pressure, multiple beats)
- All Is Lost (~page 75) — something dies
- Dark Night of the Soul (rock bottom)
- Break Into Act 3 (~page 85)
- Finale (climax sequence — typically 4–6 beats: gathering, executing the plan, false defeat, real victory)
- Final Image (mirrors opening image)`
    }
    if (project.format.kind === 'tv_1hr_drama') {
      return `\n\nHOUR-DRAMA STRUCTURAL MARKERS — the outline MUST include:
- Teaser (cold-open mini-hook, 1–2 beats)
- Act 1 Out (cliffhanger / hard reversal)
- Act 2 Out (cliffhanger / hard reversal)
- Act 3 Out (cliffhanger / hard reversal)
- Act 4 Out (cliffhanger / hard reversal)
- Act 5 (resolution, button, runner closure)
Each ACT OUT must be a beat where valueAtEnd flips hard and the audience is forced to come back.`
    }
    if (project.format.kind === 'tv_30min_comedy_single_cam' || project.format.kind === 'tv_30min_comedy_multi_cam') {
      return `\n\nHALF-HOUR STRUCTURAL MARKERS:
- Cold Open (1–2 beat hook)
- A-story 1st act spine
- A-story 2nd act spine
- A-story Resolution + emotional button
- B-story interleaved across the episode
- Tag (button gag at the end)`
    }
    if (project.format.verticalSandbox) {
      return `\n\nVERTICAL STRUCTURAL MARKERS — this is a NON-NEGOTIABLE structural law:
- The narrative hierarchy is SEASON → CYCLES → EPISODES → BEATS.
- A SEASON contains 6–9 CYCLES (also called "loops"). Each cycle is a self-contained cause/effect problem that escalates and resolves across its episodes.
- Each CYCLE contains exactly 5 EPISODES.
- Each EPISODE contains exactly 4 BEATS, ALWAYS in this fixed order:
    1. RISE   — build tension or anticipation. Something is coming.
    2. SPIKE  — the dopamine climax (kiss, slap, reveal, fight, twist).
    3. DROP   — the consequence / emotional downturn after the spike.
    4. CLIFF  — the unresolved cliffhanger that forces the next episode. THIS BEAT IS THE MOST IMPORTANT — no episode is allowed to resolve cleanly. Cliff is mandatory.
- Title every beat with this convention so the structure is legible at a glance:
    "Cycle 2 · Ep 3 · Rise — [Lead] buys the dress"
    "Cycle 2 · Ep 3 · Spike — She catches him at the bar"
    "Cycle 2 · Ep 3 · Drop — She drives home in tears"
    "Cycle 2 · Ep 3 · Cliff — A text from the rival: 'I told her everything.'"
- Beats must group strictly in fours per episode. Never produce 3 or 5 beats for an episode. Never let an episode end on Spike or Drop — the LAST beat of every episode is always Cliff.
- Each CYCLE's 5 episodes (20 beats total) form one contained loop: a problem rises across the early episodes, peaks mid-cycle, and resolves enough by the end of the 5th episode that the NEXT cycle can take over — while the larger season-arc question continues unresolved.`
    }
    return ''
  })()

  return runJSON<{ beats: AIBeat[] }>(
    'beat_generate_full',
    input,
    `${directive}

ABSOLUTE SUBSTANCE RULES — the most common AI failure is thinness. Avoid all of these:
- NEVER write a beat whose only function is "tension rises" or "they talk" — that is filler. Every beat must turn a value.
- NEVER skip subplots. Beats must rotate between A, B, C (and D if listed).
- NEVER stop short of the target count. ${existing.length === 0 ? `Below ${targets.min} beats is an automatic failure.` : `Continue until you reach the target.`}
- NEVER cluster all the action in Act 1. Distribute beats proportionally across all ${totalActs} acts.
- NEVER pad. If a beat doesn't have a CONCRETE objective, obstacle, value flip, and new information, don't write it.

REQUIRED PER BEAT:
- title (3–7 words, specific: "Mia confronts her father at the wake" not "The confrontation")
- body (1–3 sentences: what we SEE happen)
- actNumber (1, 2, 3, ...) — must be within 1..${totalActs}
- pageRangeStart, pageRangeEnd (must fit within 1..${targetPages})
- storyPurpose (one sentence — why does this beat earn its place?)
- characterObjective (named character + concrete scene goal)
- obstacle (a force, not a feeling)
- valueAtStart, valueAtEnd (must DIFFER — e.g., "control" → "exposure", "hope" → "dread")
- changeMechanism (the specific action / reveal that flips the value)
- newInformation (what the audience now knows that they didn't before)
- emotionalCharge (specific feel: "suspended dread", not "tense")
- actOut (cliffhanger image, optional for features, REQUIRED for TV act breaks)
- subplotLetter (A, B, C, or D — required when subplots are defined; this is the PRIMARY thread this beat serves)
- secondarySubplotLetters (optional — list other subplots this beat also advances; great for intersection beats)
${formatMarkers}
${subplotBlock}
${existingBlock}

OUTPUT:
- Return JSON ONLY. No prose, no markdown fences.
- Each beat must have ALL of the required fields filled. "" is not acceptable for any field.
- Use existing characters in the project by name. Do not invent new ones for these beats — if you need a new named role, mention them in body but don't add to the cast (the writer will handle that).
- Do NOT contradict any existing beat's facts.

Return JSON: { "beats": [ ${existing.length === 0 ? `${targets.ideal} beats` : `the remaining ~${newBeatTargetCount} beats`} ] }`,
    Math.max(20000, targets.ideal * 700),
  )
}

/* ============================================================================
 * Granular beat assistance — per-field, per-beat, per-batch
 * ========================================================================= */

/** Beat fields the user can ask the AI to generate individually. */
export type BeatFieldKey =
  | 'title'
  | 'body'
  | 'storyPurpose'
  | 'characterObjective'
  | 'obstacle'
  | 'valueAtStart'
  | 'valueAtEnd'
  | 'changeMechanism'
  | 'newInformation'
  | 'emotionalCharge'
  | 'actOut'

const BEAT_FIELD_GUIDANCE: Record<BeatFieldKey, { definition: string; constraint: string; defaultTokens: number }> = {
  title: {
    definition: 'a short label for THIS beat — the kind of header a writer would write on an index card',
    constraint: '3–7 words. Specific, not generic ("Mia confronts Ellis", not "The confrontation"). No subtitle.',
    defaultTokens: 60,
  },
  body: {
    definition: 'a 1–3 sentence description of what HAPPENS in THIS beat',
    constraint: '1–3 sentences, plain present tense. What we see. Who does what. What changes. No interiority, no theme statements.',
    defaultTokens: 250,
  },
  storyPurpose: {
    definition: 'why THIS beat exists in the overall structure',
    constraint: 'One short sentence. The structural job (introduce the wound, raise the stakes, force the choice). Not a plot summary.',
    defaultTokens: 120,
  },
  characterObjective: {
    definition: 'what the POV character actively wants in THIS beat',
    constraint: 'One sentence. A verb-led, observable goal for this beat specifically (not the overall story want).',
    defaultTokens: 80,
  },
  obstacle: {
    definition: 'what blocks the POV character from getting it in THIS beat',
    constraint: 'One sentence. A concrete force (another character, a situation, an internal limit). Specific to this beat.',
    defaultTokens: 80,
  },
  valueAtStart: {
    definition: 'the McKee opening dramatic value when THIS beat begins',
    constraint: '1–3 words ("trust", "safety+", "hope−"). Must be the opposite of valueAtEnd. Concrete and emotional, not abstract.',
    defaultTokens: 40,
  },
  valueAtEnd: {
    definition: 'the McKee closing dramatic value when THIS beat ends',
    constraint: '1–3 words. Must DIFFER from valueAtStart — the whole point of a beat is that a value flips.',
    defaultTokens: 40,
  },
  changeMechanism: {
    definition: 'how the value flips in THIS beat — the engine of the turn',
    constraint: 'One sentence. A specific action, reveal, decision, or behavior. The thing that makes start-value become end-value.',
    defaultTokens: 150,
  },
  newInformation: {
    definition: 'what the AUDIENCE learns in THIS beat that they didn\'t know before',
    constraint: 'One sentence. The information must be earned by the scene work, not announced. Specific.',
    defaultTokens: 150,
  },
  emotionalCharge: {
    definition: 'what we want the audience to FEEL during/at the end of THIS beat',
    constraint: 'One sentence. A specific emotional register (suspended dread, bittersweet relief), not a label ("sad").',
    defaultTokens: 100,
  },
  actOut: {
    definition: 'the act-out / cliffhanger / commercial-break image at the END of THIS beat (TV / Vertical only)',
    constraint: 'One short sentence. A concrete, image-able moment that forces the audience to want the next page/act.',
    defaultTokens: 120,
  },
}

/**
 * Pull this field's current value as a string regardless of underlying type.
 */
function getBeatFieldValue(b: Beat, field: BeatFieldKey): string {
  const v = b[field as keyof Beat]
  return typeof v === 'string' ? v : ''
}

/**
 * Format the neighboring beats (a few before, a few after) for prompt context.
 * Ordered by act/page when available, otherwise by their position in the array.
 */
function buildBeatNeighborsBlock(project: Project, current: Beat, radius = 2): string {
  if (project.beats.length === 0) return ''
  const sorted = [...project.beats].sort((a, b) => {
    const pa = a.pageRangeStart ?? a.actNumber ?? 0
    const pb = b.pageRangeStart ?? b.actNumber ?? 0
    return pa - pb
  })
  const idx = sorted.findIndex(b => b.id === current.id)
  if (idx < 0) return ''
  const start = Math.max(0, idx - radius)
  const end = Math.min(sorted.length, idx + radius + 1)
  const window = sorted.slice(start, end)
  const lines: string[] = []
  for (const b of window) {
    const tag = b.id === current.id ? '→ THIS BEAT' : `· beat`
    const head = `${tag} ${b.actNumber ? `[Act ${b.actNumber}]` : ''} ${b.pageRangeStart ? `(p.${b.pageRangeStart}–${b.pageRangeEnd ?? b.pageRangeStart})` : ''}: ${b.title || '(untitled)'}`
    lines.push(head.trim())
    if (b.id !== current.id && b.body) lines.push(`    body: ${b.body.slice(0, 200)}`)
    if (b.id !== current.id && b.valueAtStart && b.valueAtEnd) lines.push(`    turn: ${b.valueAtStart} → ${b.valueAtEnd}`)
  }
  return lines.join('\n')
}

/**
 * Generate ONE field for ONE beat, with awareness of:
 *   - everything already filled in on THIS beat
 *   - the surrounding beats (so the new value fits the flow)
 *   - the act / page placement
 *
 * Honors `beat.locked` — if a beat is locked, no field-level generation is allowed.
 */
export async function suggestBeatField(
  input: TaskInput,
  args: {
    beat: Beat
    field: BeatFieldKey
    /** Display label used in the prompt and drawer. */
    label: string
    maxTokens?: number
  },
): Promise<TaskOutcome<string>> {
  const { beat, field, label } = args
  if (beat.locked) {
    return { ok: false, error: 'This beat is locked. Unlock it before AI fill.' }
  }
  const guidance = BEAT_FIELD_GUIDANCE[field]
  if (!guidance) {
    return { ok: false, error: `No AI template for beat field "${field}".` }
  }

  const existing = getBeatFieldValue(beat, field)
  const opening = existing
    ? `Refine the "${label}" for the beat titled "${beat.title || '(untitled)'}". The current value is: "${existing}". Sharpen or replace.`
    : `Write the "${label}" for the beat titled "${beat.title || '(untitled)'}".`

  // Established fields on THIS beat (the only ground truth, excluding the one we're writing).
  const established: string[] = []
  const push = (lbl: string, v?: string) => { if (v && v.trim()) established.push(`- ${lbl}: ${v.trim()}`) }
  if (beat.actNumber) established.push(`- Act: ${beat.actNumber}`)
  if (beat.pageRangeStart) established.push(`- Page range: ${beat.pageRangeStart}${beat.pageRangeEnd ? `–${beat.pageRangeEnd}` : ''}`)
  if (field !== 'title') push('Title', beat.title)
  if (field !== 'body') push('Body', beat.body)
  if (field !== 'storyPurpose') push('Story purpose', beat.storyPurpose)
  if (field !== 'characterObjective') push('Character objective', beat.characterObjective)
  if (field !== 'obstacle') push('Obstacle', beat.obstacle)
  if (field !== 'valueAtStart') push('Opening value', beat.valueAtStart)
  if (field !== 'valueAtEnd') push('Closing value', beat.valueAtEnd)
  if (field !== 'changeMechanism') push('Change mechanism', beat.changeMechanism)
  if (field !== 'newInformation') push('New information', beat.newInformation)
  if (field !== 'emotionalCharge') push('Emotional charge', beat.emotionalCharge)
  if (field !== 'actOut') push('Act-out / cliff', beat.actOut)
  const establishedBlock = established.length === 0 ? '(no other fields filled yet)' : established.join('\n')

  const neighbors = buildBeatNeighborsBlock(input.project, beat, 2)

  const instructions = `${opening}

DEFINITION: ${guidance.definition}.
CONSTRAINT: ${guidance.constraint}

THIS BEAT — established fields (only ground truth; do not contradict):
${establishedBlock}

${neighbors ? `Surrounding beats (so your value fits the flow; do NOT duplicate their content):
${neighbors}
` : ''}
HARD OUTPUT RULES:
- Write ONLY the value for "${label}" — no quotes, no preamble, no headers, no labels.
- Stay strictly inside the CONSTRAINT length.
- Do not invent characters not already in the project.
- Do not echo phrasing from a neighboring beat's same field.
- No theme statements. No production notes.`

  return runText('beat_fill_fields', input, instructions, args.maxTokens ?? guidance.defaultTokens)
}

/**
 * Fill in only the EMPTY fields of an existing beat. Honors what's there;
 * never overrides filled fields. Surrounding beats are used as context.
 */
export async function fillBeatFields(
  input: TaskInput,
  args: { beat: Beat },
): Promise<TaskOutcome<Partial<Beat>>> {
  const { beat } = args
  if (beat.locked) return { ok: false, error: 'This beat is locked. Unlock it before AI fill.' }

  const missing: BeatFieldKey[] = []
  const consider = (k: BeatFieldKey) => {
    if (!getBeatFieldValue(beat, k)) missing.push(k)
  }
  consider('title'); consider('body'); consider('storyPurpose')
  consider('characterObjective'); consider('obstacle')
  consider('valueAtStart'); consider('valueAtEnd'); consider('changeMechanism')
  consider('newInformation'); consider('emotionalCharge')

  if (missing.length === 0) {
    return { ok: false, error: 'All beat fields are already filled.' }
  }

  // Established context.
  const established: string[] = []
  const push = (lbl: string, v?: string) => { if (v && v.trim()) established.push(`- ${lbl}: ${v.trim()}`) }
  if (beat.title) push('Title', beat.title)
  if (beat.body) push('Body', beat.body)
  if (beat.storyPurpose) push('Story purpose', beat.storyPurpose)
  if (beat.characterObjective) push('Character objective', beat.characterObjective)
  if (beat.obstacle) push('Obstacle', beat.obstacle)
  if (beat.valueAtStart) push('Opening value', beat.valueAtStart)
  if (beat.valueAtEnd) push('Closing value', beat.valueAtEnd)
  if (beat.changeMechanism) push('Change mechanism', beat.changeMechanism)
  if (beat.newInformation) push('New information', beat.newInformation)
  if (beat.emotionalCharge) push('Emotional charge', beat.emotionalCharge)
  if (beat.actNumber) established.push(`- Act: ${beat.actNumber}`)
  if (beat.pageRangeStart) established.push(`- Page range: ${beat.pageRangeStart}${beat.pageRangeEnd ? `–${beat.pageRangeEnd}` : ''}`)
  const establishedBlock = established.length === 0 ? '(nothing established yet)' : established.join('\n')

  const neighbors = buildBeatNeighborsBlock(input.project, beat, 2)

  return runJSON<Partial<Beat>>(
    'beat_fill_fields',
    input,
    `Fill ONLY the empty fields of this beat. The fields below are the only ones you may produce: ${missing.join(', ')}.

THIS BEAT — established fields (do not contradict, do not override):
${establishedBlock}

${neighbors ? `Surrounding beats (fit the flow):
${neighbors}
` : ''}

Rules:
- Output JSON with ONLY the missing fields, using these exact field names: ${missing.join(', ')}.
- Each field follows its craft constraint (a flaw is a pattern, not a label; a value pair must flip; a body is 1–3 sentences).
- Do not invent characters not in the project.
- Do not duplicate any neighboring beat.

Return JSON: { ${missing.map(m => `"${m}": "..."`).join(', ')} }`,
    2000,
  )
}

/**
 * Generate a small batch of NEW beats. Two modes:
 *
 *   - `afterBeatId`: append `count` beats after the given beat (or at the
 *     end of the outline if not specified).
 *   - `betweenBeatIds`: produce beats that bridge a gap between two
 *     existing beats. Useful for filling out an act.
 *
 * The AI is told exactly which beats already exist, what their values are,
 * and what flow it's contributing to. It will NOT regenerate or modify
 * existing beats — it only proposes new ones in the requested slot.
 */
export async function suggestNextBeats(
  input: TaskInput,
  args: {
    /** How many new beats to produce. */
    count: number
    /** Insertion point. If omitted, appends to end. */
    afterBeatId?: BeatId
    /** Bridge mode: produce beats that connect these two existing beats. */
    betweenBeatIds?: { fromId: BeatId; toId: BeatId }
    /** Optional plain-English nudge ("escalate to physical conflict", etc.). */
    hint?: string
  },
): Promise<TaskOutcome<{ beats: AIBeat[] }>> {
  const project = input.project
  const beats = [...project.beats].sort((a, b) => {
    const pa = a.pageRangeStart ?? a.actNumber ?? 0
    const pb = b.pageRangeStart ?? b.actNumber ?? 0
    return pa - pb
  })

  const renderBeat = (b: Beat) =>
    `* ${b.actNumber ? `[Act ${b.actNumber}] ` : ''}${b.pageRangeStart ? `(p.${b.pageRangeStart}–${b.pageRangeEnd ?? b.pageRangeStart}) ` : ''}${b.title || '(untitled)'}\n    ${b.body || '(no body)'}\n    turn: ${b.valueAtStart || '?'} → ${b.valueAtEnd || '?'}`

  let modeBlock = ''
  if (args.betweenBeatIds) {
    const from = beats.find(b => b.id === args.betweenBeatIds!.fromId)
    const to = beats.find(b => b.id === args.betweenBeatIds!.toId)
    if (!from || !to) return { ok: false, error: 'Bridge anchors not found.' }
    modeBlock = `Mode: BRIDGE. Produce ${args.count} new beat${args.count === 1 ? '' : 's'} that bridge the gap between these two anchors. Maintain causality.

FROM anchor (do NOT modify, do NOT duplicate):
${renderBeat(from)}

TO anchor (do NOT modify, do NOT duplicate):
${renderBeat(to)}`
  } else {
    const anchor = args.afterBeatId ? beats.find(b => b.id === args.afterBeatId) : beats[beats.length - 1]
    const allBefore = args.afterBeatId
      ? beats.slice(0, beats.findIndex(b => b.id === args.afterBeatId) + 1)
      : beats
    modeBlock = anchor
      ? `Mode: APPEND. Produce ${args.count} new beat${args.count === 1 ? '' : 's'} that come AFTER the last beat below. They must escalate causally.

Existing beats (do NOT regenerate or modify; you are extending the flow):
${allBefore.map(renderBeat).join('\n\n') || '(none yet)'}`
      : `Mode: SEED. No beats exist yet. Produce ${args.count} opening beat${args.count === 1 ? '' : 's'} grounded in the project's logline, theme, and stakes.`
  }

  const hint = args.hint ? `\n\nUser hint for these specific beats: ${args.hint}` : ''

  const subplots = input.project.format.substanceTargets.subplotLabels
  const subplotByLetter = new Map<string, typeof input.project.planning.subplots[number]>()
  for (const sp of input.project.planning.subplots ?? []) {
    subplotByLetter.set(sp.letter, sp)
  }
  const subplotBlock = subplots.length === 0
    ? ''
    : `\n\nSUBPLOTS (each new beat MUST be tagged with its primary subplot letter; rotate between them — back-to-back beats should rarely be the same subplot):\n${
        subplots.map(s => {
          const named = subplotByLetter.get(s.letter)
          return `  ${s.letter}-story ("${named?.label || s.letter + '-story'}"): ${named?.description || s.conventionalRole}`
        }).join('\n')
      }`

  return runJSON<{ beats: AIBeat[] }>(
    'beat_generate_full',
    input,
    `${modeBlock}${hint}${subplotBlock}

For each new beat, produce the full AIBeat shape:
- title (3–7 words)
- body (1–3 sentences)
- actNumber, pageRangeStart, pageRangeEnd
- storyPurpose
- characterObjective, obstacle
- valueAtStart, valueAtEnd (must differ)
- changeMechanism, newInformation, emotionalCharge
- actOut (optional, for TV/Vertical)
- subplotLetter (required when subplots are defined; the PRIMARY thread)
- secondarySubplotLetters (optional, when the beat intersects multiple threads)

Rules:
- Use only characters that already exist in this project.
- Each new beat must turn a value and earn its place.
- Rotate subplots — do not put 3 consecutive same-letter beats.
- Do not write more than ${args.count} beats. Do not repeat existing beats.

Return JSON: { "beats": [ ... ${args.count} beat${args.count === 1 ? '' : 's'} ... ] }`,
    Math.max(2000, args.count * 700),
  )
}

/* ============================================================================
 * Section "Run with it" — fills all empty fields of a section
 * ========================================================================= */

export interface OverviewFill {
  logline?: string
  shortSummary?: string
  longSynopsis?: string
  centralDramaticQuestion?: string
  storyEngine?: string
  worldRules?: string[]
  hardConstraints?: string[]
}

export const fillOverviewSection = (input: TaskInput) =>
  runJSON<OverviewFill>(
    'long_synopsis',
    input,
    `The user wants you to fill the entire Overview section. ONLY produce fields that are currently empty in the project. Do not override anything the user has already entered.

Use everything the user has entered as canonical truth — do not contradict, only build on. If the user has entered a logline, the summary/synopsis must flow from it. If themes/characters/beats exist, anchor to them.

Fields you may produce:
- logline (one sentence)
- shortSummary (3–5 sentences)
- longSynopsis (350–600 words)
- centralDramaticQuestion (one yes/no question for features)
- storyEngine (one paragraph for TV/series)
- worldRules (4–8 short rules)
- hardConstraints (3–6 immutable facts)

Return JSON with only the fields that were empty.`,
    3500,
  )

export interface ThemesFill {
  themeQuestion?: string
  themes?: string[]
  externalStakes?: string
  internalStakes?: string
  aStory?: string
  bStory?: string
  cStory?: string
  seriesArcQuestion?: string
}

export const fillThemesSection = (input: TaskInput) =>
  runJSON<ThemesFill>(
    'theme_question',
    input,
    `The user wants you to fill the entire Theme · Stakes section. ONLY produce fields currently empty. Use existing fields as ground truth.

Fields:
- themeQuestion (one paradox/question; NOT a statement)
- themes (3–6 short tags)
- externalStakes (one paragraph)
- internalStakes (one paragraph)
- aStory / bStory / cStory (one paragraph each)
- seriesArcQuestion (for TV)

Return JSON with only the fields that were empty.`,
    2500,
  )

/* ============================================================================
 * Scene Cards — planning layer (NOT the screenplay draft itself)
 * ========================================================================= */

/**
 * Scene-card fields the user can ask the AI to generate individually.
 * These are the structural craft fields, not the prose draft.
 */
export type SceneCardFieldKey =
  | 'title'
  | 'slugLine'
  | 'summary'
  | 'openingValue'
  | 'closingValue'
  | 'turn'
  | 'whoWantsWhat'
  | 'obstacle'
  | 'tactic'
  | 'audienceKnowledgeDelta'

const SCENE_FIELD_GUIDANCE: Record<SceneCardFieldKey, { definition: string; constraint: string; defaultTokens: number }> = {
  title: {
    definition: 'a short label for THIS scene — how a writer would refer to it in the room',
    constraint:
      '3–7 words. ALWAYS a specific active line describing what HAPPENS in the scene. ' +
      'Format: "[Character name] [does specific action]". ' +
      'GOOD shape: "[Character] [does specific action]" using THIS project\'s cast. ' +
      'BANNED (these are ALWAYS wrong, never produce them): "New scene", "Untitled scene", "Scene 1", "The Reveal", "The Confrontation", "The Argument", "Morning", "Aftermath", "Conversation", "A Decision". ' +
      'If you cannot describe the scene specifically, that means the scene\'s purpose is unclear — write the action anyway.',
    defaultTokens: 80,
  },
  slugLine: {
    definition: 'the scene heading: INT./EXT., location, time of day, properly formatted in ALL CAPS',
    constraint: 'Exactly one line. Format: "INT./EXT. LOCATION - TIME". Use locations the project already knows when possible.',
    defaultTokens: 60,
  },
  summary: {
    definition: 'a 2–4 sentence description of what HAPPENS in THIS scene',
    constraint: '2–4 sentences, plain present tense. What we see. Who does what. What changes by the end. No interiority, no theme statements.',
    defaultTokens: 350,
  },
  openingValue: {
    definition: 'the McKee opening dramatic value when THIS scene begins',
    constraint: '1–3 words ("safety+", "trust−"). Must be the opposite of closingValue. Concrete and emotional.',
    defaultTokens: 40,
  },
  closingValue: {
    definition: 'the McKee closing dramatic value when THIS scene ends',
    constraint: '1–3 words. Must DIFFER from openingValue. If the values match, the scene has no turn.',
    defaultTokens: 40,
  },
  turn: {
    definition: 'how the value flips in THIS scene — the engine of the turn',
    constraint: 'One sentence. A specific action, reveal, decision, behavior, or arrival. The thing that makes opening become closing.',
    defaultTokens: 150,
  },
  whoWantsWhat: {
    definition: 'who the POV character is in THIS scene and what they want',
    constraint: 'One sentence: "[CHARACTER] wants [concrete scene-goal]". A goal that can be observed, not abstract.',
    defaultTokens: 100,
  },
  obstacle: {
    definition: 'what blocks the POV character from getting it in THIS scene',
    constraint: 'One sentence. A concrete force (another character, a situation, an internal limit). Scene-specific.',
    defaultTokens: 100,
  },
  tactic: {
    definition: 'the primary tactic the POV character uses to overcome the obstacle in THIS scene',
    constraint: 'One short phrase. A real-life behavior (lies, charms, threatens, withdraws, bargains, mocks). Should match their voice fingerprint.',
    defaultTokens: 80,
  },
  audienceKnowledgeDelta: {
    definition: 'what the AUDIENCE learns or feels by the end of THIS scene that they didn\'t at the start',
    constraint: 'One sentence. A specific change in audience knowledge or alignment, not a vague "they\'re more invested".',
    defaultTokens: 150,
  },
}

/** Read this card's field as a string regardless of underlying type. */
function getSceneCardFieldValue(c: SceneCard, field: SceneCardFieldKey): string {
  const v = c[field as keyof SceneCard]
  return typeof v === 'string' ? v : ''
}

/**
 * Render the neighboring scene cards (a few before, a few after the
 * current one in `order`) for prompt context.
 */
function buildSceneNeighborsBlock(project: Project, current: SceneCard, radius = 2): string {
  if (project.sceneCards.length === 0) return ''
  const sorted = [...project.sceneCards].sort((a, b) => a.order - b.order)
  const idx = sorted.findIndex(c => c.id === current.id)
  if (idx < 0) return ''
  const start = Math.max(0, idx - radius)
  const end = Math.min(sorted.length, idx + radius + 1)
  const window = sorted.slice(start, end)
  const lines: string[] = []
  for (const c of window) {
    const tag = c.id === current.id ? '→ THIS SCENE' : '· scene'
    lines.push(`${tag} #${c.order + 1} ${c.slugLine ? `[${c.slugLine}]` : ''}: ${c.title || '(untitled)'}`)
    if (c.id !== current.id && c.summary) lines.push(`    summary: ${c.summary.slice(0, 180)}`)
    if (c.id !== current.id && c.openingValue && c.closingValue) {
      lines.push(`    turn: ${c.openingValue} → ${c.closingValue}`)
    }
  }
  return lines.join('\n')
}

/** Find which beat (if any) covers a given scene card by page range. */
function beatForCard(project: Project, card: SceneCard): Beat | null {
  if (card.beatId) {
    const direct = project.beats.find(b => b.id === card.beatId)
    if (direct) return direct
  }
  return null
}

/** Render one beat in compact form for AI prompts. */
function renderBeatBrief(b: Beat): string {
  const lines: string[] = [
    `${b.actNumber ? `[Act ${b.actNumber}] ` : ''}${b.pageRangeStart ? `(p.${b.pageRangeStart}–${b.pageRangeEnd ?? b.pageRangeStart}) ` : ''}${b.title || '(untitled)'}`,
  ]
  if (b.body) lines.push(`  body: ${b.body}`)
  if (b.storyPurpose) lines.push(`  purpose: ${b.storyPurpose}`)
  if (b.characterObjective) lines.push(`  wants:   ${b.characterObjective}`)
  if (b.obstacle) lines.push(`  blocks:  ${b.obstacle}`)
  if (b.valueAtStart && b.valueAtEnd) lines.push(`  turn:    ${b.valueAtStart} → ${b.valueAtEnd}`)
  if (b.newInformation) lines.push(`  reveals: ${b.newInformation}`)
  if (b.actOut) lines.push(`  act-out: ${b.actOut}`)
  return lines.join('\n')
}

/** The lean AI payload for a scene card. */
interface AISceneCard {
  title?: string
  slugLine?: string
  summary?: string
  openingValue?: string
  closingValue?: string
  turn?: string
  whoWantsWhat?: string
  obstacle?: string
  tactic?: string
  audienceKnowledgeDelta?: string
  estimatedPages?: number
  tensionStart?: number
  tensionEnd?: number
  /** Which beat (by zero-based index in the sorted beat list) this scene serves. */
  beatIndex?: number
}

/** Coerce an AISceneCard payload into a stored SceneCard. */
function aiSceneCardToCard(
  ai: AISceneCard | null | undefined,
  args: { order: number; beatId?: BeatId },
): SceneCard {
  const safe = (ai ?? {}) as AISceneCard
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  // Title fallback: if the AI failed to supply one, generate a working
  // placeholder from the summary's first clause rather than the dreaded
  // "New scene". The summary is usually present even when the title is
  // missing, and "Maya confronts him at the diner" reads infinitely
  // better than "New scene" anywhere it shows up in the UI.
  const titleFromAi = (safe.title ?? '').trim()
  const titleFromSummary = (() => {
    const sum = (safe.summary ?? '').trim()
    if (!sum) return ''
    const firstClause = sum.split(/[.!?;]/)[0].trim()
    if (!firstClause) return ''
    // Clamp to ~7 words so it reads like a title, not a sentence.
    const words = firstClause.split(/\s+/).filter(Boolean)
    return words.slice(0, 7).join(' ')
  })()
  const titleFromWhoWants = (() => {
    const wants = (safe.whoWantsWhat ?? '').trim()
    if (!wants) return ''
    const firstClause = wants.split(/[.;,]/)[0].trim()
    const words = firstClause.split(/\s+/).filter(Boolean)
    return words.slice(0, 7).join(' ')
  })()
  const title = titleFromAi || titleFromSummary || titleFromWhoWants || 'Untitled scene'
  return {
    id: newId<SceneCardId>(),
    beatId: args.beatId,
    title,
    slugLine: (safe.slugLine ?? '').toUpperCase().trim(),
    summary: safe.summary ?? '',
    openingValue: safe.openingValue ?? '',
    closingValue: safe.closingValue ?? '',
    turn: safe.turn ?? '',
    whoWantsWhat: safe.whoWantsWhat ?? '',
    obstacle: safe.obstacle ?? '',
    tactic: safe.tactic ?? '',
    setupIds: [],
    payoffIds: [],
    audienceKnowledgeDelta: safe.audienceKnowledgeDelta ?? '',
    // Clamp the model's estimatedPages into the legal band. Lower bound
    // 0.4 lets Vertical episode-cards (target ~0.5 pages each, 4 per
    // 2-page episode) fit; upper bound 3.0 enforces the prestige
    // scene-length law. Defaults to 2.0 when missing or absurd.
    estimatedPages: Math.max(0.4, Math.min(3.0, num(safe.estimatedPages, 2.0))),
    tensionStart: Math.max(0, Math.min(10, num(safe.tensionStart, 3))),
    tensionEnd: Math.max(0, Math.min(10, num(safe.tensionEnd, 6))),
    order: args.order,
  }
}

/**
 * Generate ONE field for ONE scene card with awareness of:
 *   - everything already filled in on THIS card
 *   - the beat this scene serves (if linked)
 *   - the neighboring scenes in order
 *
 * Honors `card.locked`.
 */
export async function suggestSceneCardField(
  input: TaskInput,
  args: {
    card: SceneCard
    field: SceneCardFieldKey
    label: string
    maxTokens?: number
  },
): Promise<TaskOutcome<string>> {
  const { card, field, label } = args
  if (card.locked) return { ok: false, error: 'This scene card is locked. Unlock it before AI fill.' }
  const guidance = SCENE_FIELD_GUIDANCE[field]
  if (!guidance) return { ok: false, error: `No AI template for scene field "${field}".` }

  const existing = getSceneCardFieldValue(card, field)
  const opening = existing
    ? `Refine the "${label}" for the scene titled "${card.title || '(untitled)'}". The current value is: "${existing}". Sharpen or replace.`
    : `Write the "${label}" for the scene titled "${card.title || '(untitled)'}".`

  const established: string[] = []
  const push = (lbl: string, v?: string) => { if (v && v.trim()) established.push(`- ${lbl}: ${v.trim()}`) }
  if (field !== 'title') push('Title', card.title)
  if (field !== 'slugLine') push('Slug line', card.slugLine)
  if (field !== 'summary') push('Summary', card.summary)
  if (field !== 'openingValue') push('Opening value', card.openingValue)
  if (field !== 'closingValue') push('Closing value', card.closingValue)
  if (field !== 'turn') push('Turn mechanism', card.turn)
  if (field !== 'whoWantsWhat') push('Who wants what', card.whoWantsWhat)
  if (field !== 'obstacle') push('Obstacle', card.obstacle)
  if (field !== 'tactic') push('Tactic', card.tactic)
  if (field !== 'audienceKnowledgeDelta') push('Audience learns', card.audienceKnowledgeDelta)
  const establishedBlock = established.length === 0 ? '(no other fields filled yet)' : established.join('\n')

  const beat = beatForCard(input.project, card)
  const beatBlock = beat ? `\n\nThe beat THIS scene serves (the source of structural truth — your value here must fit THIS beat's purpose and turn):\n${renderBeatBrief(beat)}` : ''
  const neighbors = buildSceneNeighborsBlock(input.project, card, 2)

  const instructions = `${opening}

DEFINITION: ${guidance.definition}.
CONSTRAINT: ${guidance.constraint}

THIS SCENE — established fields (only ground truth; do not contradict):
${establishedBlock}
${beatBlock}

${neighbors ? `Surrounding scenes (so your value fits the flow; do NOT repeat them):
${neighbors}
` : ''}
HARD OUTPUT RULES:
- Write ONLY the value for "${label}" — no quotes, no preamble, no headers, no labels.
- Stay strictly inside the CONSTRAINT length.
- Do not invent characters not already in the project.
- Do not echo phrasing from a neighboring scene's same field.
- No theme statements. No production notes.`

  return runText('scene_card_fill', input, instructions, args.maxTokens ?? guidance.defaultTokens)
}

/**
 * Fill the empty fields of an existing scene card. Honors filled fields;
 * uses the linked beat and neighbors as context.
 */
export async function fillSceneCardFields(
  input: TaskInput,
  args: { card: SceneCard },
): Promise<TaskOutcome<Partial<SceneCard>>> {
  const { card } = args
  if (card.locked) return { ok: false, error: 'This scene card is locked. Unlock it before AI fill.' }

  const missing: SceneCardFieldKey[] = []
  const consider = (k: SceneCardFieldKey) => {
    if (!getSceneCardFieldValue(card, k)) missing.push(k)
  }
  consider('title'); consider('slugLine'); consider('summary')
  consider('openingValue'); consider('closingValue'); consider('turn')
  consider('whoWantsWhat'); consider('obstacle'); consider('tactic')
  consider('audienceKnowledgeDelta')
  if (missing.length === 0) return { ok: false, error: 'All scene-card fields are already filled.' }

  const established: string[] = []
  const push = (lbl: string, v?: string) => { if (v && v.trim()) established.push(`- ${lbl}: ${v.trim()}`) }
  push('Title', card.title); push('Slug line', card.slugLine); push('Summary', card.summary)
  push('Opening value', card.openingValue); push('Closing value', card.closingValue)
  push('Turn', card.turn); push('Who wants what', card.whoWantsWhat)
  push('Obstacle', card.obstacle); push('Tactic', card.tactic)
  push('Audience learns', card.audienceKnowledgeDelta)
  const establishedBlock = established.length === 0 ? '(nothing established yet)' : established.join('\n')

  const beat = beatForCard(input.project, card)
  const beatBlock = beat ? `\n\nThe beat this scene serves (structural source of truth):\n${renderBeatBrief(beat)}` : ''
  const neighbors = buildSceneNeighborsBlock(input.project, card, 2)

  return runJSON<Partial<SceneCard>>(
    'scene_card_fill',
    input,
    `Fill ONLY the empty fields of this scene card. The fields below are the only ones you may produce: ${missing.join(', ')}.

THIS SCENE — established fields (do not contradict, do not override):
${establishedBlock}
${beatBlock}

${neighbors ? `Surrounding scenes (fit the flow):\n${neighbors}\n` : ''}

Rules:
- Output JSON with ONLY the missing fields, using these exact field names: ${missing.join(', ')}.
- Each field follows McKee scene discipline (value flips, single objective, concrete tactic).
- Do not invent characters not in the project.
- Do not duplicate any neighboring scene.

Return JSON: { ${missing.map(m => `"${m}": "..."`).join(', ')} }`,
    2000,
  )
}

/**
 * Generate a complete set of scene cards from the project's beat structure.
 *
 * The number of scenes per beat is NOT fixed at 1:1 — the model decides
 * based on each beat's page range and substance. A small connective beat
 * might be one scene; a larger turning-point beat might require three.
 *
 * Replaces nothing — appends to the existing scene-card list, preserving
 * everything the writer has already authored.
 */
export async function generateSceneCardsFromBeats(
  input: TaskInput,
  args?: {
    /**
     * Limit generation to this subset of beat ids. When omitted, every
     * unserved beat in the project is targeted. The chunked orchestrator
     * passes a single batch of beat ids per call.
     */
    beatIds?: string[]
  },
): Promise<TaskOutcome<{ cards: SceneCard[] }>> {
  const project = input.project
  const beats = [...project.beats].sort((a, b) => {
    const pa = a.pageRangeStart ?? a.actNumber ?? 0
    const pb = b.pageRangeStart ?? b.actNumber ?? 0
    return pa - pb
  })

  if (beats.length === 0) {
    return { ok: false, error: 'Build a beat sheet first. Scene cards are generated from beats.' }
  }

  // Detect which beats already have scene cards linked. The user might have
  // hand-authored cards for some beats and want the AI to fill in the rest;
  // "Take It From Here" should not duplicate work.
  const beatsWithCards = new Set(
    project.sceneCards
      .map(c => c.beatId)
      .filter((id): id is BeatId => !!id),
  )
  // If the caller asks for a specific subset of beats, treat the rest as
  // "served" so the model is told not to touch them.
  const targetBeatIds = args?.beatIds && args.beatIds.length > 0 ? new Set(args.beatIds) : null
  if (targetBeatIds) {
    for (const b of beats) {
      if (!targetBeatIds.has(b.id)) beatsWithCards.add(b.id as BeatId)
    }
  }
  const unservedBeats = beats.filter(b => !beatsWithCards.has(b.id))
  const isContinuation = unservedBeats.length > 0 && unservedBeats.length < beats.length

  // Format-derived scene targets — used to set an explicit total scene count
  // expectation so the model doesn't quietly fall into 1:1 with beats.
  const sceneTargets = project.format.substanceTargets.scenes
  const totalPages = Math.round(
    (project.format.structure.targetPagesMin + project.format.structure.targetPagesMax) / 2,
  )

  // Compact beat list (renumbered) so the model can refer to beats by index.
  // We always show ALL beats so the model can reference relative position,
  // but we explicitly mark which beats already have scenes.
  const beatList = beats
    .map((b, i) => {
      const served = beatsWithCards.has(b.id)
      return `BEAT ${i}${served ? ' [ALREADY HAS SCENES — DO NOT REGENERATE]' : ''}:\n${renderBeatBrief(b)}`
    })
    .join('\n\n')

  const continuationNote = isContinuation
    ? `\n\nIMPORTANT: ${unservedBeats.length} of ${beats.length} beats still need scene cards. Produce scenes ONLY for the beats not marked "ALREADY HAS SCENES". Do not invent scenes for beats the writer has already served.`
    : ''

  // ──────────────────────────────────────────────────────────────────────
  // Craft laws this prompt enforces:
  //   (A) BREVITY — every beat gets ~2.25 pages of script (band 2.0–2.5).
  //       That's a per-BEAT budget, not a per-SCENE budget. More scenes
  //       in one beat = each scene is shorter, NOT more total pages.
  //   (B) Beats are NOT 1:1 with scenes. Use judgment per beat — some
  //       beats really are one scene; sequence beats are 3–5; most sit
  //       in the 1–3 band. The model must analyze EACH beat individually
  //       rather than apply a multiplier.
  //
  // We compute the per-beat page budget from total pages / beat count
  // (clamped to a 1.5–2.75 sanity band) so the writer's foundational
  // page target (e.g., 85 pages) genuinely flows through to the cards.
  // For 40 beats × 2.25 = 90 pages — the modern feature target.
  // Vertical projects override this with the 2-pages-per-episode rule.
  // ──────────────────────────────────────────────────────────────────────
  const isVertical = !!project.format.verticalSandbox
  const rawPagesPerBeat = totalPages / Math.max(1, beats.length)
  const PAGES_PER_BEAT_TARGET = isVertical
    ? 2.0
    : Math.max(1.5, Math.min(2.75, rawPagesPerBeat || 2.25))
  // Project-level scene-count expectation derived from per-beat budget,
  // assuming an average of ~1.4 scenes/beat (some 1, some 2, some 3+).
  const PAGES_PER_SCENE_TARGET = PAGES_PER_BEAT_TARGET / 1.4
  const targetTotalScenes = Math.max(sceneTargets.min, Math.round(beats.length * 1.4))
  const avgScenesPerBeat = targetTotalScenes / Math.max(1, beats.length)

  // Locations the project has ALREADY established (from existing scene
  // cards and any scene-heading elements on the screenplay). Reusing
  // these is encouraged; inventing brand-new locations for every scene
  // is an AI tell that also blows out production cost.
  const existingLocations = new Set<string>()
  for (const c of project.sceneCards) {
    const slug = (c.slugLine ?? '').trim()
    if (slug) existingLocations.add(slug.toUpperCase())
  }
  for (const el of project.screenplay.elements) {
    if (el.type === 'scene_heading' && el.text.trim()) {
      existingLocations.add(el.text.trim().toUpperCase())
    }
  }
  const locationBlock = existingLocations.size === 0
    ? ''
    : `\n\nLOCATIONS ALREADY ESTABLISHED IN THIS PROJECT (re-use these when the action returns to them — do NOT invent fresh slug lines for places you've already shown):\n${
        Array.from(existingLocations).slice(0, 32).map(l => `  - ${l}`).join('\n')
      }`

  const verticalLocationNote = isVertical
    ? `\n\nVERTICAL LOCATION DISCIPLINE — this is a Vertical project. Favor MINIMAL locations:
- Lean hard on a small handful of recurring locations (the protagonist's apartment, the love interest's office, the cafe where they meet). Vertical reads fast and shoots cheap; repetition builds the world.
- Most new scenes should land in a location the project has already established (see list above if present, otherwise the first scenes you generate become the recurring set).
- Reserve NEW locations for genuine reveals (the secret penthouse, the rival's hideout, the climactic confrontation site). Don't invent locations for atmosphere.`
    : ''

  const antiOneToOneBlock = isVertical
    ? `\n
VERTICAL EPISODE-CARD DISCIPLINE — read this carefully.

In Vertical projects, the "Episodes" data table (the one this prompt calls "BEATS") stores one row PER EPISODE. Each EPISODE is the audience-facing unit they swipe through.

WHAT AN EPISODE IS:
- Each episode is ~2 pages of script.
- Each episode contains EXACTLY 4 internal story beats in this fixed order:
    1. RISE  — the ramp-up that builds tension or anticipation.
    2. SPIKE — the dopamine climax of the episode (a slap, a kiss, a reveal, a fight, a betrayal).
    3. DROP  — the consequence / emotional downturn after the spike.
    4. CLIFF — the unresolved cliffhanger that forces the next episode. THE MOST IMPORTANT BEAT.
- These 4 internal beats are STRUCTURAL — they happen INSIDE the episode, not as separate scene cards. A single scene can contain multiple internal beats. Multiple scenes can serve one beat.
- The Cliff beat is always last, and it never resolves cleanly. Always a hook.

SCENE CARDS PER EPISODE — variable, decided by location and dramatic need:
- An episode that ALL takes place in ONE location (a fight in the kitchen, a confrontation in the office, a phone call from the car) is 1 scene card.
- An episode that JUMPS between locations (Rise in the apartment, Spike at the gala, Drop in the car ride home, Cliff at the doorstep) is 2–4 scene cards.
- Most Vertical episodes lean toward 1–2 scene cards because the format favors minimal locations.
- estimatedPages per card depends on how many of the 4 internal beats live in that scene; range 0.4–2.0, the SUM of all cards for one episode should be ~2.0.

WHEN YOU PRODUCE THE CARDS FOR EACH UNSERVED EPISODE (= each unserved BEAT row):
- READ the episode's body / story purpose / change mechanism / cliffhanger fields.
- Decide how many distinct LOCATIONS the episode actually needs. That's how many scene cards you produce for it.
- The summary field of each card must explicitly state which of the 4 internal beats (Rise / Spike / Drop / Cliff) it covers — and if a card covers multiple, list all of them.
- Title the card around its action: \`Title: <character> <does specific action>\` (no episode prefix on the title — the episode label is structural, not a card naming convention).
- If an episode is 1 scene total, that one card MUST contain all four internal beats in its summary (Rise → Spike → Drop → Cliff inside the same location).

LOCATION DISCIPLINE — favor minimal locations in Vertical. Re-use slug lines the project has already shown. Vertical reads fast and shoots cheap; recurring locations build the world. NEW locations are reserved for genuine reveals.${verticalLocationNote ? '\n\n' + verticalLocationNote.trim() : ''}`
    : `\n
SCENE-CRAFT DISCIPLINE — the three laws and the judgment that goes with them.

LAW 1 — BREVITY (the iron law).
- TOTAL page count is ${totalPages} pages. This is FIXED.
- PAGES PER BEAT: ~${PAGES_PER_BEAT_TARGET.toFixed(2)} pages (band 2.0–2.5). For ${beats.length} beats × ${PAGES_PER_BEAT_TARGET.toFixed(2)} pages = ${(beats.length * PAGES_PER_BEAT_TARGET).toFixed(0)} pages total. Hit this number.
- That is the BEAT's budget, not the SCENE's. More scenes in one beat → each scene is shorter. NEVER more total pages.
- Cut dialogue that doesn't move plot or reveal character. Open scenes late, leave them early. No throat-clearing, no off-ramps. A modern reader will close a long script by page 5.

LAW 2 — SCENE LENGTH (derived from LAW 1).
- Each scene's estimatedPages = (its beat's budget ≈ ${PAGES_PER_BEAT_TARGET.toFixed(2)}) ÷ (scenes in that beat).
  - 1 scene in a beat → ~${PAGES_PER_BEAT_TARGET.toFixed(2)} pages.
  - 2 scenes in a beat → ~${(PAGES_PER_BEAT_TARGET / 2).toFixed(2)} pages each.
  - 3 scenes in a beat → ~${(PAGES_PER_BEAT_TARGET / 3).toFixed(2)} pages each.
  - 4 scenes in a beat → ~${(PAGES_PER_BEAT_TARGET / 4).toFixed(2)} pages each.
- Hard band: estimatedPages in 0.4–3.0. Outside that, you either fragmented or padded.
- Sum check: for ANY single beat, the sum of all its scenes' estimatedPages must be 2.0–2.5. Total project sum must approach ${totalPages}.

LAW 3 — BEATS ARE NOT 1:1 WITH SCENES. Use judgment per beat.
A BEAT is a structural milestone. A SCENE is one piece of physical screen real estate where ONE value flips.
READ EACH BEAT'S "body", "storyPurpose", "characterObjective", "obstacle", and "changeMechanism" and decide what it actually needs to play out on the page:
- 1 SCENE for beats that are a single-moment turn: a phone call that delivers bad news, a confrontation that lands and ends, a quick decision a character makes alone. Many beats are genuinely one scene.
- 2–3 SCENES when there's setup + action + aftermath: a betrayal planned in one room, executed in another, reckoned with in a third.
- 3–4 SCENES for SEQUENCE beats — heists, chases, montages, multi-location confrontations, sustained set pieces.
- The HEAVIEST beats (catalyst, midpoint, all-is-lost, climax) often warrant 3+ scenes, but not always.
The wrong move is a uniform multiplier — 1 scene per beat OR 2 scenes per beat applied across the whole sheet. Across the project, per-beat counts MUST vary, BUT each beat's total page budget stays in the 2.0–2.5 band regardless of count.

CALIBRATION FOR THIS PROJECT:
- ${beats.length} beats currently exist.
- ${totalPages}-page ${project.format.label}.
- Per-beat budget: ~${PAGES_PER_BEAT_TARGET.toFixed(2)} pages (band 2.0–2.5).
- Expected total scene count: ~${targetTotalScenes} scenes (avg ~${avgScenesPerBeat.toFixed(1)} scenes/beat, with real variance).

CROSS-CHECK BEFORE YOU OUTPUT:
1. Look at the BEAT bodies. Does each beat's scene count reflect ITS content — single-moment beats get 1, set-piece beats get 3–4?
2. Variance check: do per-beat scene counts vary across the sheet? If every beat got the same number you applied a multiplier; rewrite.
3. Length check PER BEAT: sum of estimatedPages for every scene linked to one beat = 2.0–2.5. If a beat has 3 scenes you must NOT give each 2 pages — each is ~0.75.
4. Length check PROJECT: sum of ALL estimatedPages ≈ ${totalPages}, never more than ${Math.round(totalPages * 1.05)}.
5. Location check: when a beat's action returns to a place you've already used, use the EXISTING slug line. Don't invent new locations unless the story demands it.${verticalLocationNote}`

  // What characters exist (used for whoWantsWhat / tactic targeting).
  const cast = project.characters
    .map(c => `* ${c.name} (${c.role.replace('_', ' ')})${c.externalGoal ? ` — wants: ${c.externalGoal}` : ''}`)
    .join('\n') || '(no characters yet)'

  const existingScenes = project.sceneCards.length
    ? `\n\nExisting scene cards (do NOT regenerate; you are appending after them):\n${project.sceneCards
        .slice().sort((a, b) => a.order - b.order)
        .map((c, i) => `  #${i + 1}: ${c.title || '(untitled)'} ${c.slugLine ? `[${c.slugLine}]` : ''}`)
        .join('\n')}`
    : ''

  const res = await runJSON<{ cards: AISceneCard[] }>(
    'scene_card_generate',
    input,
    `Generate the project's scene cards FROM the beats below.
${antiOneToOneBlock}
${continuationNote}

BEATS (numbered; reference these via beatIndex on each card):
${beatList}

CAST:
${cast}
${locationBlock}${existingScenes}

CRITICAL: every scene card MUST have ALL of these fields filled with REAL content. Returning a card with empty fields, generic stubs, or partial data is an immediate failure of the task. If you cannot fill a field, the scene shouldn't exist — cut it.

REQUIRED FIELDS (all of these, every card):
- title: 3–7 words, specific and active. Format: "[Character] [does specific action]" using THIS project's cast (NOT names from the prompt's example pool). The shape is "<character name> <verb> <object>" — e.g. "Lead destroys the file", "Antagonist finds the body". BANNED (NEVER produce): "New scene", "Untitled scene", "Scene 1", "The Reveal", "The Confrontation", "Morning", "Aftermath".
- slugLine: "INT./EXT. LOCATION - TIME", ALL CAPS.
- summary: 2–4 full sentences in present tense, describing what we SEE. Must include named characters and specific actions. Not a one-line summary, not a label — actual scene description.
- openingValue: 1–2 words describing the emotional value at scene start (e.g., "trust", "safety+", "hope−").
- closingValue: 1–2 words describing the value at scene end. MUST differ from openingValue.
- turn: one full sentence describing the specific mechanism that flips the value (the action / reveal / decision that does it).
- whoWantsWhat: one sentence — named character + their specific concrete goal in this scene.
- obstacle: one full sentence naming what concretely blocks them.
- tactic: one short phrase naming the behavior they use (e.g., "lies", "charms", "withdraws", "bargains").
- audienceKnowledgeDelta: one full sentence — what the audience now knows or feels that they didn't before this scene.
- estimatedPages: decimal 0.4–3.0. Compute per LAW 2: (beat budget ≈ ${PAGES_PER_BEAT_TARGET.toFixed(2)}) ÷ (number of scenes you put in that beat). A solo scene in a beat lands near ${PAGES_PER_BEAT_TARGET.toFixed(2)}; a beat with 3 scenes gives each scene ~${(PAGES_PER_BEAT_TARGET / 3).toFixed(2)}.
- tensionStart: integer 0–10.
- tensionEnd: integer 0–10.
- beatIndex: zero-based, points back into BEATS above.

EXAMPLE OF A CORRECTLY POPULATED CARD — the names below are PLACEHOLDERS ("<LEAD>", "<RIVAL>") because this prompt MUST NOT inject real character names into your output. Substitute THIS project's actual cast when you write. This example assumes its beat is a single-moment turn (one scene serves the whole beat, so estimatedPages ≈ the per-beat budget):
{
  "title": "<LEAD> destroys the file",
  "slugLine": "INT. <LEAD>'S APARTMENT - NIGHT",
  "summary": "<LEAD> pulls up the photo on her phone, hands shaking. She holds it for a long moment, weighing it. Then she deletes it. The screen goes black and her reflection stares back.",
  "openingValue": "fear",
  "closingValue": "resolve",
  "turn": "<LEAD> chooses self-preservation over honesty by deleting the photo.",
  "whoWantsWhat": "<LEAD> wants to bury the affair before <RIVAL> sees the photo.",
  "obstacle": "Her hand keeps drifting back to the photo before she deletes it.",
  "tactic": "forces herself to act fast",
  "audienceKnowledgeDelta": "We learn <LEAD> will choose the lie over the truth.",
  "estimatedPages": ${PAGES_PER_BEAT_TARGET.toFixed(2)},
  "tensionStart": 6,
  "tensionEnd": 7,
  "beatIndex": 3
}

Hard rules:
- Use only characters that already exist in the project (named above).
- Every scene must turn a value: openingValue ≠ closingValue.
- Each scene's purpose must traceably serve its beat's purpose.
- Do not invent new beats.
- Output scenes in story order.
- EVERY field above must contain real content. Empty strings, "(unknown)", "TBD", or generic stubs are failures.

FINAL CHECK BEFORE RETURNING:
- Did you READ each beat's body / story purpose / mechanism, and choose a scene count that fits THAT beat — not a uniform multiplier?
- BREVITY check: every beat's total scene-page sum sits between 2.0 and 2.5 pages. If a beat has 3 scenes the cards should average ~${(PAGES_PER_BEAT_TARGET / 3).toFixed(2)} pages, NOT ~2.0 each.
- Project total: sum of every card's estimatedPages must come in at or under ${totalPages}. If you're over, tighten until you're under.
- Locations: when a scene takes place somewhere already established, use the EXISTING slug line; don't invent new ones unnecessarily.${isVertical ? ' Vertical: prefer recurring locations.' : ''}

Return JSON: { "cards": [ { ... all required fields ... } ] }`,
    Math.max(16000, targetTotalScenes * 500),
  )

  if (!res.ok) return res

  const startOrder = project.sceneCards.length
  const arr = Array.isArray(res.value?.cards) ? res.value.cards : []
  const cards: SceneCard[] = arr.map((ai, i) => {
    const beatIdx = typeof ai.beatIndex === 'number' && ai.beatIndex >= 0 && ai.beatIndex < beats.length
      ? ai.beatIndex
      : 0
    const linkedBeat = beats[beatIdx]
    return aiSceneCardToCard(ai, { order: startOrder + i, beatId: linkedBeat?.id })
  })

  if (cards.length === 0) {
    return { ok: false, error: 'The model returned no usable scene cards. Try again.' }
  }
  return { ok: true, value: { cards }, raw: res.raw, modelId: res.modelId }
}

/**
 * Expand a SINGLE beat into a small batch of scene cards (1–N). Useful when
 * the writer wants to drill into one beat at a time without regenerating
 * the whole outline.
 */
export async function expandBeatToScenes(
  input: TaskInput,
  args: { beatId: BeatId; count?: number },
): Promise<TaskOutcome<{ cards: SceneCard[] }>> {
  const beat = input.project.beats.find(b => b.id === args.beatId)
  if (!beat) return { ok: false, error: 'Beat not found.' }
  // If the writer passed an explicit count, honor it. Otherwise let the
  // AI decide based on the beat's content — some beats really are 1
  // scene; sequence beats are 3–5; most sit in between.
  const requested = args.count ?? 0
  const count = Math.max(1, Math.min(8, requested))
  const isVertical = !!input.project.format.verticalSandbox
  // Per-beat page budget: ~2.25 pages on non-Vertical, ~2.0 on Vertical.
  // The same brevity discipline as generateSceneCardsFromBeats — the budget
  // is per BEAT, not per scene. More scenes in a beat = shorter scenes.
  const PAGES_PER_BEAT_TARGET = isVertical ? 2.0 : 2.25
  const beatStart = beat.pageRangeStart ?? 0
  const beatEnd = beat.pageRangeEnd ?? beatStart
  const beatPagesFromRange = Math.max(1, beatEnd - beatStart + 1)
  const beatPages = Math.max(PAGES_PER_BEAT_TARGET - 0.25, Math.min(PAGES_PER_BEAT_TARGET + 0.25, beatPagesFromRange))
  const countHint = requested > 0
    ? `Produce exactly ${count} scene card${count === 1 ? '' : 's'} that serve this beat. The beat budget is ~${PAGES_PER_BEAT_TARGET.toFixed(2)} pages — divide that by ${count} for each card's estimatedPages (≈ ${(PAGES_PER_BEAT_TARGET / count).toFixed(2)} per card).`
    : `READ this beat's body, story purpose, character objective, obstacle, and change mechanism — then decide how many scenes it actually needs:
- 1 scene if the beat is a single-moment turn (a phone call that delivers bad news; a confrontation that lands and ends; a single decision). That one scene gets the full ~${PAGES_PER_BEAT_TARGET.toFixed(2)}-page beat budget.
- 2–3 scenes if there's setup + action + aftermath. Each scene gets ~${(PAGES_PER_BEAT_TARGET / 2.5).toFixed(2)} pages.
- 3–4 scenes if the beat is a SEQUENCE (a heist, a chase, a montage, a multi-location confrontation). Each scene gets ~${(PAGES_PER_BEAT_TARGET / 3.5).toFixed(2)} pages.
The TOTAL page budget for this beat is ~${PAGES_PER_BEAT_TARGET.toFixed(2)} pages regardless of scene count. More scenes = shorter scenes.`

  const cast = input.project.characters
    .map(c => `* ${c.name} (${c.role.replace('_', ' ')})${c.externalGoal ? ` — wants: ${c.externalGoal}` : ''}`)
    .join('\n') || '(no characters yet)'

  // Show neighbors so the new cards thread into the existing scene list.
  const sortedCards = [...input.project.sceneCards].sort((a, b) => a.order - b.order)
  const lastCard = sortedCards[sortedCards.length - 1]
  const neighborBlock = sortedCards.length
    ? `\n\nExisting scene cards (do NOT modify or duplicate; new scenes append at the end):\n${sortedCards.slice(-5).map((c, i) => `  ...#${sortedCards.length - 5 + i + 1}: ${c.title} [${c.slugLine || '?'}] — ${c.openingValue || '?'} → ${c.closingValue || '?'}`).join('\n')}${lastCard ? `\nLast scene's closing value: "${lastCard.closingValue || '?'}"` : ''}`
    : ''

  // Existing slug lines so the AI re-uses locations instead of inventing
  // a new one for every scene.
  const existingLocations = new Set<string>()
  for (const c of input.project.sceneCards) {
    const slug = (c.slugLine ?? '').trim()
    if (slug) existingLocations.add(slug.toUpperCase())
  }
  for (const el of input.project.screenplay.elements) {
    if (el.type === 'scene_heading' && el.text.trim()) {
      existingLocations.add(el.text.trim().toUpperCase())
    }
  }
  const locationBlock = existingLocations.size === 0
    ? ''
    : `\n\nLOCATIONS ALREADY ESTABLISHED — re-use these slug lines when the action returns to them. Don't invent new ones unless this beat genuinely takes the story somewhere new:\n${
        Array.from(existingLocations).slice(0, 32).map(l => `  - ${l}`).join('\n')
      }`

  const res = await runJSON<{ cards: AISceneCard[] }>(
    'scene_card_generate',
    input,
    `${countHint}

THE BEAT to expand:
${renderBeatBrief(beat)}

CAST:
${cast}
${neighborBlock}${locationBlock}

THREE CRAFT LAWS:
  LAW 1 — BREVITY. The TOTAL page budget for this beat is ~${PAGES_PER_BEAT_TARGET.toFixed(2)} pages (band 2.0–2.5). That's the BEAT's budget, not per scene. Sum of estimatedPages across all your output cards MUST land 2.0–2.5.
  LAW 2 — SCENE LENGTH is derived. Each scene's estimatedPages = ${PAGES_PER_BEAT_TARGET.toFixed(2)} ÷ (your chosen scene count). 1 scene → ~${PAGES_PER_BEAT_TARGET.toFixed(2)}. 2 scenes → ~${(PAGES_PER_BEAT_TARGET / 2).toFixed(2)} each. 3 scenes → ~${(PAGES_PER_BEAT_TARGET / 3).toFixed(2)} each. 4 scenes → ~${(PAGES_PER_BEAT_TARGET / 4).toFixed(2)} each.
  LAW 3 — beats are not 1:1 with scenes. Use JUDGMENT based on this beat's actual content. Some beats really are one scene. Some beats are a sequence. Read the beat carefully and decide.

For each scene card produce the full AISceneCard shape, with EVERY field filled:
- title (3–7 words, ALWAYS specific and active in the shape "<character name> <verb> <object>", using THIS project's actual cast. NEVER "New scene", "The Reveal", or any generic stub.)
- slugLine: "INT./EXT. LOCATION - TIME", ALL CAPS.
- summary: 2–4 full sentences, present tense, what we SEE.
- openingValue: 1–2 word emotional/dramatic value at scene start.
- closingValue: 1–2 words, MUST differ from openingValue.
- turn: one full sentence — the specific mechanism that flips the value.
- whoWantsWhat: one sentence with a named character and their concrete scene goal.
- obstacle: one full sentence naming the block.
- tactic: short phrase naming the behavior (e.g., "lies", "charms").
- audienceKnowledgeDelta: one full sentence on what the audience learns.
- estimatedPages: decimal 0.4–3.0. Compute per LAW 2.
- tensionStart, tensionEnd: integers 0–10.
- Set beatIndex to 0 (these all serve THE BEAT above).
EMPTY STRINGS, "TBD", or generic stubs in any field = failure.

Hard rules:
- Use only characters in CAST.
- openingValue ≠ closingValue (McKee scene turn discipline).
- Scene count must reflect THIS beat's content — single-turn beats get 1, set-piece beats get 3–4.
- Cumulative estimatedPages across these cards MUST be 2.0–2.5 pages (NOT 2.0 per card — 2.0–2.5 TOTAL).
- When the action returns to a place this project has already shown, RE-USE the existing slug line. Don't invent fresh locations unless the story demands it.${input.project.format.verticalSandbox ? '\n- VERTICAL project: favor minimal locations. Lean on a small recurring set; new locations are reserved for genuine reveals.' : ''}
- New scenes must causally follow the last existing scene's closing value (above).

Return JSON: { "cards": [ ...AISceneCard fields... ] }`,
    Math.max(4000, (count || 4) * 1200),
  )
  if (!res.ok) return res

  const startOrder = input.project.sceneCards.length
  const arr = Array.isArray(res.value?.cards) ? res.value.cards : []
  const cards = arr.map((ai, i) => aiSceneCardToCard(ai, { order: startOrder + i, beatId: beat.id }))
  if (cards.length === 0) {
    return { ok: false, error: 'No scenes were produced for that beat. Try again.' }
  }
  return { ok: true, value: { cards }, raw: res.raw, modelId: res.modelId }
}

/**
 * Append a small batch of new scene cards after the existing flow.
 * Optionally anchors on a specific card (inserts after it, shifting later
 * cards' order).
 */
export async function suggestNextScenes(
  input: TaskInput,
  args: {
    count: number
    afterCardId?: SceneCardId
    hint?: string
  },
): Promise<TaskOutcome<{ cards: SceneCard[] }>> {
  const project = input.project
  const sortedCards = [...project.sceneCards].sort((a, b) => a.order - b.order)
  const anchorIdx = args.afterCardId ? sortedCards.findIndex(c => c.id === args.afterCardId) : sortedCards.length - 1
  const before = anchorIdx >= 0 ? sortedCards.slice(Math.max(0, anchorIdx - 3), anchorIdx + 1) : []
  const after = anchorIdx >= 0 ? sortedCards.slice(anchorIdx + 1, anchorIdx + 1 + 3) : []

  const renderCard = (c: SceneCard, i: number) =>
    `  #${i + 1} [${c.slugLine || '?'}] ${c.title || '(untitled)'} — ${c.openingValue || '?'} → ${c.closingValue || '?'}\n    ${c.summary?.slice(0, 200) || ''}`

  const cast = project.characters.map(c => `* ${c.name}`).join('\n') || '(none)'
  const beats = [...project.beats].sort((a, b) => (a.pageRangeStart ?? 0) - (b.pageRangeStart ?? 0))
  const beatList = beats.length
    ? beats.map((b, i) => `BEAT ${i}: ${b.title} [${b.valueAtStart || '?'} → ${b.valueAtEnd || '?'}]`).join('\n')
    : '(no beats — invent grounded in logline)'

  const hint = args.hint ? `\nUser hint: ${args.hint}` : ''

  const res = await runJSON<{ cards: AISceneCard[] }>(
    'scene_card_generate',
    input,
    `Append ${args.count} new scene card${args.count === 1 ? '' : 's'} to the outline.${hint}

Existing scenes BEFORE the insertion point (do NOT modify; you continue from the last one):
${before.length ? before.map((c, i) => renderCard(c, anchorIdx - before.length + 1 + i)).join('\n') : '(none)'}

${after.length ? `Existing scenes AFTER the insertion point (you must thread INTO them; do NOT contradict):\n${after.map((c, i) => renderCard(c, anchorIdx + 1 + i)).join('\n')}` : ''}

BEATS available (refer to via beatIndex):
${beatList}

CAST:
${cast}

THREE CRAFT LAWS:
  LAW 1 — BREVITY. Per-beat page budget is ~${input.project.format.verticalSandbox ? '2.0' : '2.25'} pages (band 2.0–2.5). That budget covers ALL scenes linked to one beat. More scenes per beat = each scene is shorter.
  LAW 2 — SCENE LENGTH is derived from LAW 1: estimatedPages = (~${input.project.format.verticalSandbox ? '2.0' : '2.25'}) ÷ (scenes you put in that beat). 1 scene = full budget. 2 scenes = ~${input.project.format.verticalSandbox ? '1.0' : '1.1'} each. 3 scenes = ~${input.project.format.verticalSandbox ? '0.65' : '0.75'} each. Hard band: 0.4–3.0.
  LAW 3 — beats are not 1:1 with scenes. Use judgment per beat content.
  LOCATION REUSE — when a new scene's action happens somewhere this project has already shown, USE the existing slug line. Don't invent fresh locations for every scene.${input.project.format.verticalSandbox ? ' VERTICAL project: favor minimal locations; lean on a small recurring set.' : ''}

For each new scene produce the full AISceneCard shape with EVERY field filled — title, slugLine, summary (2–4 sentences), openingValue, closingValue (must differ), turn (one sentence), whoWantsWhat, obstacle, tactic, audienceKnowledgeDelta, estimatedPages (0.4–3.0; compute per LAW 2 above, NOT a fixed 2.0), tensionStart, tensionEnd, beatIndex. Set beatIndex to the beat number this scene serves. Each scene must turn a value (openingValue ≠ closingValue), use only existing characters from THIS project's cast (never names from the prompt's example pool), and thread causally with the surrounding scenes. The title MUST be specific and active in the shape "<character> <does action>" — NEVER generic ("New scene", "The Reveal", "Morning"). Empty fields or generic stubs are immediate failures.

Return JSON: { "cards": [ ${args.count} AISceneCard${args.count === 1 ? '' : 's'} ] }`,
    Math.max(2000, args.count * 1100),
  )
  if (!res.ok) return res

  const startOrder = (sortedCards[anchorIdx]?.order ?? -1) + 1
  const arr = Array.isArray(res.value?.cards) ? res.value.cards : []
  const cards = arr.map((ai, i) => {
    const beatIdx = typeof ai.beatIndex === 'number' && ai.beatIndex >= 0 && ai.beatIndex < beats.length
      ? ai.beatIndex
      : undefined
    return aiSceneCardToCard(ai, {
      order: startOrder + i,
      beatId: beatIdx != null ? beats[beatIdx]?.id : undefined,
    })
  })
  if (cards.length === 0) return { ok: false, error: 'No scenes returned. Try again.' }
  return { ok: true, value: { cards }, raw: res.raw, modelId: res.modelId }
}

/* ============================================================================
 * Scene drafting (Writing Mode)
 * ========================================================================= */

/**
 * A new character introduced by the AI while drafting a scene. Lean by
 * design — the AI must declare anyone it names, but it shouldn't try to
 * write a full bible for a one-line role. The cast reconciler will adopt
 * these as stubs on accept and the writer can flesh them out (or run
 * "Generate Character Bible" on them later).
 */
export interface AISceneCharacter {
  /** ALL CAPS, as it appears in cues. */
  name: string
  /**
   * The character's function in this scene: "waitress", "ER nurse",
   * "Maya's neighbor", etc. Used as `shortDescription` for the stub.
   */
  functionInScene: string
  /** 'minor' for one-liners, 'supporting' for recurring side characters. */
  role: 'minor' | 'supporting'
  /** Optional age hint, e.g., "50s", "teen". */
  age?: string
}

export interface DraftedScene {
  /** Plain-text screenplay snippet, properly formatted (the parser will convert to elements). */
  fountain: string
  /**
   * Every character cued in `fountain` that is NOT in the project's bible.
   * The AI must declare each one. Empty array if none were introduced.
   */
  newCharacters?: AISceneCharacter[]
}

/**
 * Adopt every AI-declared scene character that isn't already in the bible.
 * Returns the newly created characters. Safe to call repeatedly: dedups
 * against the existing cast (case-insensitive).
 */
export function adoptAISceneCharacters(
  project: Project,
  declared: AISceneCharacter[],
): Character[] {
  const existing = new Set(
    project.characters.map(c => c.name.trim().toUpperCase()).filter(Boolean),
  )
  const out: Character[] = []
  for (const d of declared) {
    const upper = d.name.trim().toUpperCase()
    if (!upper) continue
    if (existing.has(upper)) continue
    existing.add(upper)
    out.push({
      id: newId<CharacterId>(),
      name: upper,
      age: d.age ?? '',
      shortDescription: d.functionInScene ?? '',
      biography: '',
      role: d.role,
      externalGoal: '',
      internalNeed: '',
      wound: '',
      fear: '',
      flaw: '',
      secret: '',
      publicCost: '',
      privateCost: '',
      arcStart: '',
      arcEnd: '',
      arcTurn: '',
      relationships: [],
      voice: blankVoiceFingerprint(),
      state: blankCharacterState(),
      introduced: false,
      lockedFields: [],
      provenance: 'ai_scene',
      needsReview: true,
    })
  }
  return out
}

/* ============================================================================
 * Generic "Suggest a single field" task
 * ========================================================================= */

/** A small free-form completion to fill one specific field. */
export async function suggestField(
  input: TaskInput,
  args: { task: AITask; fieldLabel: string; existingValue?: string; hint?: string; maxTokens?: number },
): Promise<TaskOutcome<string>> {
  const lengthHint = args.maxTokens ? Math.ceil(args.maxTokens / 4) : 80
  const instructions = `Suggest a value for the field "${args.fieldLabel}".

${args.existingValue ? `The user has a partial value: "${args.existingValue}". Improve it.` : 'The field is empty.'}
${args.hint ? `Hint: ${args.hint}` : ''}

Keep it to roughly ${lengthHint} words. Use existing project facts. Do not contradict locked sections. Output only the suggested text — no quotes, no preamble.`
  return runText(args.task, input, instructions, args.maxTokens)
}

/* ============================================================================
 * Character-specific field completion
 * ========================================================================= */

/**
 * The character-bible fields we know how to generate one at a time.
 * Includes the dotted `voice.notes` because that's stored on the nested
 * VoiceFingerprint, not on Character directly.
 */
export type CharacterFieldKey =
  | 'shortDescription'
  | 'biography'
  | 'externalGoal'
  | 'internalNeed'
  | 'wound'
  | 'fear'
  | 'flaw'
  | 'secret'
  | 'publicCost'
  | 'privateCost'
  | 'arcStart'
  | 'arcEnd'
  | 'arcTurn'
  | 'voice.notes'

/**
 * Per-field craft instructions. The model gets:
 *   - what this field IS (so it doesn't hand back a paraphrase of "wound")
 *   - the structural constraint (length, shape, what's banned)
 */
const CHARACTER_FIELD_GUIDANCE: Record<CharacterFieldKey, { definition: string; constraint: string; defaultTokens: number; aiTaskTier: AITask }> = {
  shortDescription: {
    definition: 'the BRIEF visual + behavioral phrase used the FIRST time this character appears in an action line of the script',
    constraint:
      '4–12 words. Purely visual + behavioral — what they LOOK LIKE and HOW THEY CARRY THEMSELVES. ' +
      'NEVER backstory, family, profession context, motivations, goals, or themes — that all goes in the biography field, NOT here. ' +
      'One or two short comma-separated observations. ' +
      'GOOD examples: "sharp-eyed and sleep-deprived" / "pleated khakis, nervous mustache" / "packed muscle, granite face" / "wears Whites, looks like he hasn\'t slept". ' +
      'BAD (do not produce): "broke architecture student three weeks from graduation" or "daughter of a construction worker". ' +
      'Output the phrase only — no parentheses, no name, no age, no period.',
    defaultTokens: 80,
    aiTaskTier: 'character_field',
  },
  biography: {
    definition: 'the FULL character bible — a rich, multi-paragraph profile of who THIS character is across their entire life. The script never reproduces most of this; the screenwriter uses it as ground truth for every choice.',
    constraint:
      '4–8 dense paragraphs (400–900 words). DEEP and SPECIFIC — name actual places, actual people in their life, actual moments. Cover, in flowing prose (NOT a bullet list): ' +
      '(1) where and how they grew up — city, household, class, language at home, what the air smelled like, who else lived there; ' +
      '(2) the defining childhood event(s) that bent their worldview — a fire, a death, a betrayal, a promise extracted under duress, an embarrassing public moment that wired their identity; ' +
      '(3) education and the path to today\'s profession, with real institutions or specific equivalents, plus mentor or anti-mentor figures by name; ' +
      '(4) romantic and family relationships across time — who came before the story\'s present, what ended each, what they took from each; ' +
      '(5) work history including the job they almost took and the thing they were good at that they had to give up; ' +
      '(6) health, habits, vices — what they eat, what they avoid, the drink/cigarette/run/late-night thing, sleep patterns; ' +
      '(7) money — bills they\'re behind on, money they\'ve hidden, what they spend irrationally on; ' +
      '(8) public reputation vs. private self — who knows what version; ' +
      '(9) beliefs — political, religious, superstitious, magical thinking, rituals; ' +
      '(10) a signature object or wardrobe choice with specific origin; ' +
      '(11) one thing they\'d never tell anyone; ' +
      '(12) the lie they live by that the story is going to break. ' +
      'Commit to FACTS, do not hedge with "perhaps" or "may have". Treat this like dossier-writing: own the specifics. Never re-state the shortDescription. Never lapse into theme statements about the script.',
    defaultTokens: 4000,
    aiTaskTier: 'character_field',
  },
  externalGoal: {
    definition: 'the external, scene-playable thing THIS character is actively trying to do across the story (their Want)',
    constraint: '2–3 sentences. Verb-led, concrete, with a specific finish line. Not abstract ("find herself") — specific ("get her daughter back from CPS by the custody hearing on the 18th, then convince her ex-husband she\'s changed"). Use THIS project\'s named cast — never names from the prompt\'s example pool.',
    defaultTokens: 200,
    aiTaskTier: 'character_field',
  },
  internalNeed: {
    definition: 'what THIS character must change INSIDE to grow — distinct from what they want',
    constraint: '2–3 sentences. State the lie they live by AND the truth they must accept. Not a feeling word; the new behavior or stance the wound has blocked.',
    defaultTokens: 220,
    aiTaskTier: 'character_field',
  },
  wound: {
    definition: 'the past hurt AND the false belief THIS character formed because of it — the thing the story must break',
    constraint: '3–5 sentences. A specific past event (the locker room, the funeral, the night their mother left — name details) AND the false belief they took from it. NEVER abstract trauma labels.',
    defaultTokens: 350,
    aiTaskTier: 'character_field',
  },
  fear: {
    definition: 'what THIS character would do almost anything to avoid',
    constraint: '2–3 sentences. A consequence ("being known as a fraud"), not an abstraction ("failure"). Name the specific moment they last felt it.',
    defaultTokens: 200,
    aiTaskTier: 'character_field',
  },
  flaw: {
    definition: 'the maladaptive behavior PATTERN this character repeats under pressure',
    constraint: '2–3 sentences. A pattern in conflict tactics ("under pressure he picks the fight he can win to avoid the fight he can\'t"), not a label ("arrogant"). The way the wound shows up in scene work.',
    defaultTokens: 220,
    aiTaskTier: 'character_field',
  },
  secret: {
    definition: 'a concrete fact THIS character keeps hidden that will detonate something when revealed',
    constraint: '2–4 sentences. Name the fact, name who they\'re hiding it from, name the specific consequence when it lands.',
    defaultTokens: 250,
    aiTaskTier: 'character_field',
  },
  publicCost: {
    definition: 'what THIS character loses externally / publicly if they fail at their want',
    constraint: 'One full paragraph. Concrete named consequences (job, custody, freedom, exposure, reputation) — name the things, not generalities. No vague "everything".',
    defaultTokens: 400,
    aiTaskTier: 'stakes',
  },
  privateCost: {
    definition: 'what THIS character loses internally / privately if they fail',
    constraint: 'One full paragraph. Identity, relationships, sense of self — what THIS person specifically can\'t survive losing. Distinct from publicCost.',
    defaultTokens: 400,
    aiTaskTier: 'stakes',
  },
  arcStart: {
    definition: 'THIS character\'s state of being at the START of the story — who they are before the crucible',
    constraint: 'One full paragraph. The default, the comfortable lie they live inside, the specific daily habits and choices that prove it. Sets up what must collapse.',
    defaultTokens: 450,
    aiTaskTier: 'character_field',
  },
  arcEnd: {
    definition: 'THIS character\'s state of being at the END of the story — who they are after the crucible',
    constraint: 'One full paragraph. The transformation made permanent, with a specific demonstrating behavior. Distinct from arcStart. If your arcEnd reads like arcStart, the arc didn\'t happen.',
    defaultTokens: 450,
    aiTaskTier: 'character_field',
  },
  arcTurn: {
    definition: 'the SPECIFIC final choice or behavior that PROVES THIS character has changed',
    constraint: '2–3 sentences. An ACTION, not a feeling. A moment that could only happen now, never before. The behavior that demonstrates the new self.',
    defaultTokens: 250,
    aiTaskTier: 'character_field',
  },
  'voice.notes': {
    definition: 'how THIS character sounds — cadence, register, humor mode, emotional restraint, the verbal habits that mark them as them',
    constraint: '3–5 sentences. Specific verbal habits and rhythms. Include actual words they would and would not use. Their default tactic in conflict. Must be unmistakably different from any other character\'s voice in this project.',
    defaultTokens: 500,
    aiTaskTier: 'character_voice',
  },
}

/**
 * Pull the current string value for any character field, including the
 * nested voice.notes.
 */
function getCharacterFieldValue(c: Character, field: CharacterFieldKey): string {
  if (field === 'voice.notes') return c.voice?.notes ?? ''
  const v = c[field as keyof Character]
  return typeof v === 'string' ? v : ''
}

/**
 * Build the "what's already established about this person" block. We
 * deliberately exclude the field being generated so the model isn't told
 * its own answer.
 */
function buildCharacterEstablishedBlock(c: Character, excludeField: CharacterFieldKey): string {
  const lines: string[] = []
  const push = (label: string, value?: string) => {
    if (value && value.trim()) lines.push(`- ${label}: ${value.trim()}`)
  }
  if (c.name) lines.push(`- Name: ${c.name}`)
  if (c.role) lines.push(`- Role: ${c.role.replace('_', ' ')}`)
  if (c.age) lines.push(`- Age: ${c.age}`)
  if (excludeField !== 'shortDescription') push('Short description', c.shortDescription)
  if (excludeField !== 'biography') push('Biography', c.biography)
  if (excludeField !== 'externalGoal') push('External goal (Want)', c.externalGoal)
  if (excludeField !== 'internalNeed') push('Internal need', c.internalNeed)
  if (excludeField !== 'wound') push('Wound', c.wound)
  if (excludeField !== 'fear') push('Fear', c.fear)
  if (excludeField !== 'flaw') push('Flaw', c.flaw)
  if (excludeField !== 'secret') push('Secret', c.secret)
  if (excludeField !== 'publicCost') push('Public cost', c.publicCost)
  if (excludeField !== 'privateCost') push('Private cost', c.privateCost)
  if (excludeField !== 'arcStart') push('Arc start', c.arcStart)
  if (excludeField !== 'arcEnd') push('Arc end', c.arcEnd)
  if (excludeField !== 'arcTurn') push('Arc turn', c.arcTurn)
  if (excludeField !== 'voice.notes') push('Voice notes', c.voice?.notes)
  return lines.length <= 3 ? `${lines.join('\n')}\n(Most fields are still empty — invent values that connect to what IS filled, including their role.)` : lines.join('\n')
}

/**
 * Build a digest of OTHER characters' core traits so the model can avoid
 * borrowing them. Only includes the fields that often cross-contaminate
 * (want / need / wound / flaw / fear / secret / arc turn).
 */
function buildOtherCharactersBlock(project: Project, currentId: CharacterId): string {
  const others = project.characters.filter(c => c.id !== currentId)
  if (others.length === 0) return ''
  const lines: string[] = []
  for (const c of others) {
    const bits: string[] = []
    bits.push(`* ${c.name || '(unnamed)'} (${c.role.replace('_', ' ')})`)
    if (c.externalGoal) bits.push(`    want:   ${c.externalGoal}`)
    if (c.internalNeed) bits.push(`    need:   ${c.internalNeed}`)
    if (c.wound)        bits.push(`    wound:  ${c.wound}`)
    if (c.flaw)         bits.push(`    flaw:   ${c.flaw}`)
    if (c.fear)         bits.push(`    fear:   ${c.fear}`)
    if (c.secret)       bits.push(`    secret: ${c.secret}`)
    if (c.arcTurn)      bits.push(`    turn:   ${c.arcTurn}`)
    lines.push(bits.join('\n'))
  }
  return lines.join('\n\n')
}

/**
 * Generate ONE field for ONE character with full character context and
 * explicit anti-cross-contamination guard rails.
 */
export async function suggestCharacterField(
  input: TaskInput,
  args: {
    character: Character
    field: CharacterFieldKey
    /** Display label used in the prompt and the drawer. */
    label: string
    /** Optional override for max tokens. */
    maxTokens?: number
  },
): Promise<TaskOutcome<string>> {
  const { character, field, label } = args
  const guidance = CHARACTER_FIELD_GUIDANCE[field]
  if (!guidance) {
    return { ok: false, error: `No AI template for field "${field}".` }
  }

  const established = buildCharacterEstablishedBlock(character, field)
  const others = buildOtherCharactersBlock(input.project, character.id)
  const existing = getCharacterFieldValue(character, field)
  const opening = existing
    ? `Refine the "${label}" for ${character.name}. The current value is: "${existing}". Sharpen and deepen it; keep what's working, fix what's vague.`
    : `Write the "${label}" for ${character.name}.`

  const instructions = `${opening}

DEFINITION: ${guidance.definition}.
CONSTRAINT: ${guidance.constraint}

${character.name.toUpperCase()}'S established profile (the only ground truth for this character — do not contradict):
${established}

${others ? `OTHER CHARACTERS in this project (these traits belong to OTHER people — do not echo, borrow, or paraphrase them; ${character.name} must be unmistakably distinct):
${others}
` : ''}
HARD OUTPUT RULES:
- Write ONLY the value for ${character.name}'s "${label}" — no quotes, no preamble, no "Here is", no character-name prefix, no headers.
- This is for ${character.name} alone. Do not mention any other character by name unless ${character.name} has a direct, named relationship to them already in the established profile.
- Do not summarize the plot. Do not state themes. Do not write an essay or a justification.
- Do not echo phrasing already used for another character's same field.
- Stay inside the CONSTRAINT length. If the field is one sentence, write one sentence.`

  return runText(guidance.aiTaskTier, input, instructions, args.maxTokens ?? guidance.defaultTokens)
}

/* ============================================================================
 * Writing-canvas assistance — per-line, per-scene, per-block actions
 * ========================================================================= */

/**
 * Find the closest preceding scene heading for a given element, plus the
 * range of elements that belong to that scene (heading → next heading).
 * Returns null if the element isn't inside a scene.
 */
function findScopingScene(project: Project, elementId: string): {
  heading: ScreenplayElement
  elements: ScreenplayElement[]
  startIdx: number
  endIdx: number
} | null {
  const els = project.screenplay.elements
  const idx = els.findIndex(e => e.id === elementId)
  if (idx < 0) return null
  let startIdx = idx
  while (startIdx >= 0 && els[startIdx].type !== 'scene_heading') startIdx--
  if (startIdx < 0) return null
  let endIdx = idx + 1
  while (endIdx < els.length && els[endIdx].type !== 'scene_heading') endIdx++
  return {
    heading: els[startIdx],
    startIdx,
    endIdx,
    elements: els.slice(startIdx, endIdx),
  }
}

/**
 * Render a small window of screenplay elements as Fountain-ish plain text
 * for the AI prompt. We use the existing element types directly rather
 * than the Fountain serializer because we want minimal noise in the
 * prompt.
 */
function renderElementsForPrompt(els: ScreenplayElement[]): string {
  const out: string[] = []
  for (const el of els) {
    switch (el.type) {
      case 'scene_heading':
        out.push(el.text.toUpperCase())
        break
      case 'character':
        out.push(`\n${el.text.toUpperCase()}`)
        break
      case 'parenthetical':
        out.push(`(${el.text.replace(/^\(|\)$/g, '')})`)
        break
      case 'dialogue':
        out.push(el.text)
        break
      case 'transition':
        out.push(`> ${el.text.toUpperCase()}`)
        break
      case 'shot':
        out.push(`[${el.text}]`)
        break
      case 'action':
      default:
        out.push(el.text)
    }
  }
  return out.join('\n')
}

/**
 * Detect which characters have already been introduced anywhere in the
 * screenplay so far. A character is "introduced" if their name (or any
 * first-name / last-name alias of their bible entry) has appeared:
 *   - As a character cue (definitive), or
 *   - In ALL CAPS inside an action line (the FD convention for first
 *     appearance — once it's ALL CAPS in action once, the character is
 *     considered introduced and should be in normal case thereafter).
 *
 * The returned set is keyed by the bible's canonical ALL-CAPS name, so
 * downstream code can compare against `character.name.toUpperCase()`
 * directly. A cue typed as just "MAYA" correctly marks "MAYA RIVERS" as
 * introduced.
 */
function introducedCharacterNames(project: Project): Set<string> {
  const out = new Set<string>()

  // Build a quick alias table: every alias maps back to the bible
  // character's canonical full name (in upper case).
  const aliasToCanon = new Map<string, string>()
  for (const c of project.characters) {
    const upper = c.name.trim().toUpperCase()
    if (!upper) continue
    aliasToCanon.set(upper, upper)
    const parts = upper.split(/\s+/).filter(Boolean)
    if (parts.length > 1) {
      const first = parts[0]
      const last = parts[parts.length - 1]
      if (first && !aliasToCanon.has(first)) aliasToCanon.set(first, upper)
      if (last && last !== first && !aliasToCanon.has(last)) aliasToCanon.set(last, upper)
    }
  }

  const recordCanon = (rawName: string) => {
    const upper = rawName.trim().toUpperCase()
    if (!upper) return
    const canon = aliasToCanon.get(upper)
    out.add(canon ?? upper) // unknown cues stay under their own key
  }

  for (const el of project.screenplay.elements) {
    if (el.type === 'character') {
      const name = el.text.replace(/\s*\([^)]*\)\s*$/, '').trim()
      if (name) recordCanon(name)
      continue
    }
    if (el.type === 'action' || el.type === 'general') {
      // Look for any project character name appearing in ALL CAPS.
      for (const c of project.characters) {
        const upper = c.name.trim().toUpperCase()
        if (!upper || out.has(upper)) continue
        const re = new RegExp(`\\b${upper.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`)
        if (re.test(el.text)) out.add(upper)
      }
    }
  }
  return out
}

/**
 * Build the prompt block telling the AI exactly how to introduce each
 * character the first time they appear in the new pages.
 *
 * The block:
 *   1. States the format: `NAME, age, short visual/behavioral phrase.`
 *   2. Shows GOOD vs BAD examples (taken from industry-standard scripts)
 *      so the model has something concrete to mimic.
 *   3. Lists each unintroduced character with their pre-stripped intro
 *      phrase — backstory and goals filtered OUT before they reach the
 *      AI, so the model can't accidentally regurgitate them in parens.
 */
function buildIntroductionGuide(project: Project, alreadyIntroduced: Set<string>): string {
  const needsIntro = project.characters.filter(c => !alreadyIntroduced.has(c.name.trim().toUpperCase()))
  if (needsIntro.length === 0) {
    return alreadyIntroduced.size > 0
      ? `Characters already on the page (do NOT re-introduce in ALL CAPS, do NOT re-describe): ${Array.from(alreadyIntroduced).join(', ')}`
      : ''
  }
  const lines: string[] = [
    'CHARACTER INTRODUCTIONS — match the shape used by the reference scripts uploaded to this project. Those scripts are gospel.',
    '',
    'LEGAL FORMATS (all three are used by working writers — pick whichever fits the moment):',
    '   (a) NAME (age), short description, does action.    e.g.  TEDDY GATZ (early 30s, in full apiarist\'s garb) attends to the colony.',
    '   (b) NAME, age, description.                         e.g.  CARTER, 30s, smart, pretty — and tough as a box of nails left out in the rain.',
    '   (c) <sentence describing what we see>. This is NAME.  e.g.  A woman in her 50\'s drives. She\'s prematurely aged and her eyes are wandering. This is GINNIE Garraty.',
    '',
    'AGE: number, band, or in parens with a short tag is all fine. (early 30s), (45), (Late 40\'s, Black), (50s, in chef\'s whites) are all real industry forms.',
    '',
    'LENGTH IS FLEXIBLE. There is NO mandated word count. Working scripts range from 3 words ("rugged, fit, determined.") to a full paragraph (Walter White: "He\'s forty years old. Receding hairline. A bit pasty. He\'s not a guy who makes a living working with his hands. ..."). Lead intros tend to be longer ONLY when the writer is intentionally painting that character at length; many working scripts give the lead a tight 4–10-word intro and let the actor do the rest (F1: "we meet SONNY HAYES (54): rugged, fit, determined."). Do NOT artificially pad a clean intro to hit a word count.',
    '',
    'BANNED — never produced by working writers in any of the reference scripts:',
    '  ✗ Possessive-of-abstract: "senator\'s posture", "soldier\'s discipline", "boxer\'s stance", "model\'s cheekbones", "dancer\'s poise". Write what the body actually does ("stands very straight").',
    '  ✗ Job-titled body parts: "prep school jaw", "trust-fund smile", "boardroom hands", "old-money mouth".',
    '  ✗ Invented compound nouns: "driftwood log" (a log is a log), "barn-wood eyes", "cathedral-quiet voice".',
    '  ✗ Rhymed/parallel adjective pairs: "sharp-eyed and sleep-deprived", "hard-jawed and soft-spoken", "wide-eyed and willing".',
    '  ✗ Cliché similes: "eyes as dark as night", "skin as pale as paper", "voice as cold as steel". (A distinctive comparison the writer earned — GoT: "tough as a box of nails left out in the rain" — is fine; the AI\'s typical cliché simile is not.)',
    '  ✗ Stacking 4+ description clauses and then comma-splicing an overwrought action verb. Example shape of the EXACT failure: "<NAME>, 22, tall, in a gray hoodie three days running, dark circles under tired eyes, pushes through the hedge maze onto the grass." This is the comma-fest. The reference scripts NEVER stack 4+ description clauses then comma-splice action.',
    '',
    'REAL examples FROM THE REFERENCE SCRIPTS (use this shape):',
    '  ✓ TEDDY GATZ (early 30s, in full apiarist\'s garb) attends to the colony.                                       (Bugonia)',
    '  ✓ RAYMOND GARRATY (18) sits in the passenger seat wearing an army fatigue jacket.                              (The Long Walk)',
    '  ✓ WILL (20), a young ranger dressed all in black, surveys the grim scene from the back of his gelding.         (GoT pilot)',
    '  ✓ we meet SONNY HAYES (54): rugged, fit, determined.                                                            (F1)',
    '  ✓ CHAYTON (Choctaw, 50s) the leader of the group exits the vehicle, looking up at the sky.                     (Sinners)',
    '  ✓ CARTER, 30s, smart, pretty — and tough as a box of nails left out in the rain.                               (Person of Interest)',
    '  ✓ Behind the wheel, Wendell "BUD" WHITE, 32. An LAPD cop, Bud\'s rep as the toughest man on the force has been well-earned.   (L.A. Confidential)',
    '  ✓ A tall, extremely fit kid stands nearby: This is STEBBINS. He eats a JELLY SANDWICH.                          (The Long Walk)',
    '',
    'For the characters below, use the suggested intro line OR your own equivalent in the same shape. If the suggested line is short, do NOT pad. If it\'s long, do NOT chop.',
  ]
  for (const c of needsIntro) {
    const tier = roleTier(c.role)
    const phrase = introVisualPhrase(c, 60, 0)
    const ageStr = displayAge(c.age)
    const intro = ageStr
      ? `${c.name.toUpperCase()} (${ageStr}), ${phrase}.`
      : `${c.name.toUpperCase()}, ${phrase}.`
    lines.push(`  • [${tier.toUpperCase()}] ${intro}`)
  }
  if (alreadyIntroduced.size > 0) {
    lines.push('')
    lines.push(`Already on the page (do NOT re-introduce in ALL CAPS, do NOT re-describe): ${Array.from(alreadyIntroduced).join(', ')}`)
  }
  return lines.join('\n')
}

/** Map a `CharacterRole` to one of four intro length tiers. */
type IntroTier = 'lead' | 'major' | 'supporting' | 'minor'
function roleTier(role: unknown): IntroTier {
  switch (role) {
    case 'protagonist':
      return 'lead'
    case 'antagonist':
    case 'love_interest':
    case 'ghost':
      return 'major'
    case 'minor':
      return 'minor'
    default:
      return 'supporting'
  }
}

/** Coerce age to a display string. */
function displayAge(age: unknown): string {
  if (typeof age === 'string') return age.trim()
  if (typeof age === 'number' && Number.isFinite(age)) return String(age)
  return age == null ? '' : String(age)
}

/**
 * Pull a VISUAL / BEHAVIORAL phrase suitable for a character introduction.
 * Filters the bible's `shortDescription` to remove backstory clauses, goal
 * statements, and the specific AI-tell phrases the model loves to invent
 * ("senator's posture", "prep school jaw", "driftwood log",
 * "sharp-eyed and sleep-deprived"). No word ceiling, no word floor — the
 * working-screenwriter examples in the prompt do the calibration.
 */
function introVisualPhrase(c: Character, _maxWords: number, _minWords: number): string {
  const raw = typeof c.shortDescription === 'string' ? c.shortDescription.trim() : ''
  const clauses = raw
    .split(/[,;—.]/)
    .map(s => s.trim())
    .filter(s => s && !looksLikeBackstoryClause(s) && !looksLikeAITellClause(s))

  let phrase = clauses.join(', ')

  if (!phrase) phrase = synthesizeIntro(c)

  // Strip leading articles/role labels that read as labels, not observations.
  phrase = phrase
    .replace(/^(the |a |an )/i, '')
    .replace(/^(protagonist|antagonist|lead|hero|villain)\s*[:,-]\s*/i, '')

  // Generous safety ceiling — only kicks in for clearly run-on descriptions
  // (e.g., a paragraph in the bible's shortDescription field). Below that
  // we leave the phrase alone and let the writer's voice decide length.
  phrase = clampWords(phrase, 60)

  return phrase.toLowerCase().replace(/[.!?]+$/, '')
}

/**
 * Heuristic: a clause that reads like backstory rather than a visual
 * observation. We reject clauses starting with these phrasings because
 * they're the AI's favorite way to smuggle exposition into an intro.
 */
function looksLikeBackstoryClause(clause: string): boolean {
  const lower = clause.toLowerCase().trim()
  if (!lower) return true
  if (/^(daughter|son|wife|husband|mother|father|brother|sister|child|widow|orphan) of\b/.test(lower)) return true
  if (/^(a |an |the )?(former|recent|fresh|aspiring|wannabe)\b/.test(lower)) return true
  if (/^(desperate|determined|hoping|trying|struggling|fighting) to\b/.test(lower)) return true
  if (/^who (recently|just|once|always|never)\b/.test(lower)) return true
  if (/\b(grew up|raised by|abandoned|adopted|inherited|graduated|enrolled|raised)\b/.test(lower)) return true
  if (/\b(broke|poor|wealthy|rich|orphaned|widowed)\b/.test(lower) && lower.split(/\s+/).length > 4) return true
  return false
}

/**
 * Heuristic: catch the specific AI-tell phrases the user has flagged
 * repeatedly. These never come out of a working screenwriter's keyboard:
 *
 *   - Possessive-of-abstract: "senator's posture", "boxer's stance",
 *     "model's cheekbones", "soldier's discipline", "dancer's poise".
 *   - Job-titled body parts: "prep school jaw", "trust-fund smile",
 *     "boardroom hands", "old-money mouth".
 *   - Rhymed/parallel-structured pairs: "sharp-eyed and sleep-deprived",
 *     "hard-jawed and soft-spoken", "wide-eyed and willing".
 *   - Invented terrain nouns used out of context: "driftwood log".
 */
function looksLikeAITellClause(clause: string): boolean {
  const lower = clause.toLowerCase().trim()
  if (!lower) return false

  // Possessive-of-abstract: "<word>'s posture/stance/smile/jaw/eyes/hands/..."
  if (/(^|\s)\S+'s\s+(posture|stance|gait|smile|jaw|eyes|gaze|cheekbones|hips|shoulders|brow|grin|hands|mouth|carriage|presence|discipline|poise|swagger|stride|silhouette|aura)\b/.test(lower)) return true

  // Job-titled body parts: e.g. "prep school jaw", "trust fund smile",
  // "boardroom hands", "old money mouth", "country club tan".
  if (/\b(prep[\s-]school|trust[\s-]fund|boardroom|old[\s-]money|country[\s-]club|ivy[\s-]league|wall[\s-]street|hedge[\s-]fund|silicon[\s-]valley)\s+(jaw|smile|hands|mouth|tan|grin|cheekbones|eyes|gaze|posture|hair|skin)\b/.test(lower)) return true

  // Rhymed/parallel-structured X-eyed/Y-ed pair joined by " and ".
  if (/\b\S+-(eyed|jawed|haired|skinned|boned|shouldered|chested|lipped|browed|chinned|cheeked|fingered|footed)\s+and\s+\S+-(eyed|jawed|haired|skinned|boned|shouldered|chested|lipped|browed|chinned|cheeked|fingered|footed|spoken|deprived|tempered|mannered|hearted|minded|willed|tongued)\b/.test(lower)) return true

  // Invented terrain words in furniture/anchor positions.
  if (/\bdriftwood\s+(log|chair|bench|stool|table)\b/.test(lower)) return true

  // Cathedral-quiet voice / barn-wood eyes — abstract-noun + sensory-body
  if (/\b(cathedral|chapel|monastery|library|courtroom)[\s-](quiet|hushed|still)\b/.test(lower)) return true
  if (/\b(barn|driftwood|weathered|storm|river)[\s-]wood\s+(eyes|gaze|smile|jaw)\b/.test(lower)) return true

  return false
}

/** Clamp a phrase to N words while preserving sensible word boundaries. */
function clampWords(s: string, max: number): string {
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length <= max) return s.trim()
  return words.slice(0, max).join(' ')
}

/**
 * Fallback intro when there's no usable `shortDescription`. We
 * deliberately do NOT pull from flaw / wound / goal — those are
 * backstory by nature. We point the AI at the gap instead and let the
 * model fill in plain visual details when it writes the page.
 */
function synthesizeIntro(_c: Character): string {
  return 'PLAIN visual details needed — write clothes, body, and behavior in plain English'
}

function stripTrailingPunct(s: unknown): string {
  if (typeof s !== 'string') return s == null ? '' : String(s)
  return s.trim().replace(/[.!?]+$/, '')
}

/**
 * Build the list of characters who SPEAK in the scope window, in order
 * of first appearance, so we can pass voice fingerprints in the prompt.
 */
function speakersInScope(project: Project, els: ScreenplayElement[]): Character[] {
  const ids = new Set<CharacterId>()
  const names = new Set<string>()
  for (const el of els) {
    if (el.type !== 'character') continue
    if (el.characterId) ids.add(el.characterId)
    else if (el.text) names.add(el.text.trim().toUpperCase().replace(/\s*\([^)]*\)$/, ''))
  }
  const found: Character[] = []
  for (const ch of project.characters) {
    if (ids.has(ch.id)) found.push(ch)
    else if (names.has(ch.name.trim().toUpperCase())) found.push(ch)
  }
  return found
}

/**
 * Compact voice block for the AI prompt. Only the fingerprint fields that
 * actually shape dialogue, plus the wound for sub-textual grounding.
 */
function buildVoiceBlock(chars: Character[]): string {
  if (chars.length === 0) return ''
  return chars.map(c => {
    const v = c.voice
    const fp: string[] = []
    if (v?.sentenceLength) fp.push(`length:${v.sentenceLength}`)
    if (v?.vocabulary) fp.push(`vocab:${v.vocabulary}`)
    if (v?.rhythm) fp.push(`rhythm:${v.rhythm}`)
    if (v?.humor && v.humor !== 'none') fp.push(`humor:${v.humor}`)
    if (v?.restraint) fp.push(`restraint:${v.restraint}`)
    if (v?.contractions) fp.push(`contractions:${v.contractions}`)
    const tics = v?.verbalTics?.length ? ` ; tics: ${v.verbalTics.join(', ')}` : ''
    const wound = c.wound ? ` ; wound: ${c.wound}` : ''
    const notes = v?.notes ? ` ; notes: ${v.notes.slice(0, 200)}` : ''
    return `* ${c.name} — ${fp.join(', ')}${tics}${wound}${notes}`
  }).join('\n')
}

/* ----- Vertical episode-structure helpers ------------------------------ */

/** Spelled-out English numerals for episode / act labels. */
const SPELLED_NUMBERS = [
  'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT',
  'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN',
  'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN', 'TWENTY',
] as const

/** Count how many `# EPISODE N` labels currently appear in the script. */
function countExistingEpisodeLabels(project: Project): number {
  return project.screenplay.elements.filter(e => e.type === 'episode_label').length
}

/**
 * For Vertical projects: figure out which EPISODE a scene card belongs
 * to, whether it's the OPENING card of that episode (and therefore the
 * draft needs to emit a `# EPISODE N` Fountain header), and whether
 * the (PAYWALL) marker should land after this episode closes.
 *
 * In Vertical, the underlying "Beat" data table stores ONE row per
 * episode. The card's `beatId` tells us which episode it serves. The
 * scene card's POSITION within that episode's cards determines whether
 * it's the opener (first card) or a continuation card.
 *
 * Returns an empty string for non-Vertical projects.
 */
function buildVerticalEpisodeBlockForCard(project: Project, card: SceneCard): string {
  if (!project.format.verticalSandbox) return ''

  // Sort beats by their structural order (page range start, then act number).
  const sortedBeats = [...project.beats].sort((a, b) => {
    const pa = a.pageRangeStart ?? a.actNumber ?? 0
    const pb = b.pageRangeStart ?? b.actNumber ?? 0
    return pa - pb
  })

  // Find which episode (beat row) this card belongs to.
  const myBeatIdx = card.beatId ? sortedBeats.findIndex(b => b.id === card.beatId) : -1
  if (myBeatIdx < 0) return ''
  const episodeNumber = myBeatIdx + 1

  // Find this card's position within its episode's cards. Cards that
  // share the same beatId form one episode together; the first one (by
  // `order`) opens the episode.
  const episodeCards = [...project.sceneCards]
    .filter(c => c.beatId === card.beatId)
    .sort((a, b) => a.order - b.order)
  const cardPositionInEpisode = episodeCards.findIndex(c => c.id === card.id) // 0-based
  const isFirstCardOfEpisode = cardPositionInEpisode === 0
  const totalCardsInEpisode = episodeCards.length

  // Has this episode's `# EPISODE` header already been emitted in the
  // screenplay text? If we already produced it, don't repeat.
  const alreadyOpenedEpisodes = countExistingEpisodeLabels(project)
  const opensEpisode = isFirstCardOfEpisode && episodeNumber > 1 && alreadyOpenedEpisodes < episodeNumber

  // Does the (PAYWALL) marker belong after this episode?
  const paywallAfterEp = project.verticalPlan?.paywallAfterEpisode ?? 0
  const isPaywallEpisode = paywallAfterEp > 0 && episodeNumber === paywallAfterEp
  // The paywall lands after the LAST card of the paywall episode.
  const emitPaywallAfter = isPaywallEpisode && cardPositionInEpisode === totalCardsInEpisode - 1

  // Build the episode-header instruction.
  const numberWord = episodeNumber <= SPELLED_NUMBERS.length
    ? SPELLED_NUMBERS[episodeNumber - 1]
    : String(episodeNumber)
  const headerHint = opensEpisode
    ? `\n  HEADER: this scene OPENS episode ${episodeNumber}. Your Fountain output MUST begin with:\n      # EPISODE ${numberWord}\n  Then the scene heading, then the scene's content.`
    : isFirstCardOfEpisode && episodeNumber === 1
      ? `\n  HEADER: this is the FIRST scene of episode 1 — no \`# EPISODE\` header needed (episode 1 is implicit).`
      : `\n  HEADER: this scene continues an already-open episode — DO NOT emit a \`# EPISODE\` header. Just write the scene.`

  const paywallHint = emitPaywallAfter
    ? `\n  PAYWALL: this is the LAST scene of episode ${episodeNumber}, which the writer has marked as the paywall episode. After this scene's content finishes, append a single Fountain action line:\n      (PAYWALL)\n  Nothing else after that — the next AI call will pick up from the next episode.`
    : ''

  return `

VERTICAL EPISODE POSITION:
  - This scene serves Episode ${episodeNumber}${totalCardsInEpisode > 1 ? `, scene ${cardPositionInEpisode + 1} of ${totalCardsInEpisode} in that episode` : ' (single-scene episode)'}.
  - A Vertical episode is ~2 pages of script and contains 4 internal beats: Rise → Spike → Drop → Cliff. Those beats live INSIDE the scene(s) you write — they aren't separate scene cards.
  - If this is a single-scene episode, the scene must contain ALL FOUR internal beats (Rise → Spike → Drop → Cliff).
  - The Cliff is always the last thing the audience sees in this episode — an unresolved hook that forces them to swipe to the next one.${headerHint}${paywallHint}`
}

/**
 * For Vertical projects: when "Continue from here" is triggered with a
 * page count, figure out which episode is currently open (if any) and
 * which episode the AI should open next, plus whether the (PAYWALL)
 * marker needs to land inside the drafted pages.
 *
 * Returns an empty string for non-Vertical projects.
 */
function buildVerticalEpisodeBlockForContinuation(project: Project, pages: number): string {
  if (!project.format.verticalSandbox) return ''

  const existingEpisodeLabels = countExistingEpisodeLabels(project)
  const hasAnyContent = project.screenplay.elements.some(e => e.text.trim() !== '')
  // If no episode labels exist yet but there IS content, we're inside
  // episode 1 (its header is implicit). Otherwise the current episode
  // number = (label count + 1) because writers open episodes as they go.
  const currentEpisodeNumber = hasAnyContent
    ? Math.max(1, existingEpisodeLabels + 1)
    : 1
  const nextEpisodeNumber = currentEpisodeNumber + 1
  const episodesToProduce = Math.max(1, Math.round(pages / 2))

  // Predict which episodes this draft will OPEN. If the writer asks for
  // 4 pages and we're currently inside episode 2, the draft will close
  // episode 2 and open episodes 3 and 4.
  const upcomingEpisodes: number[] = []
  for (let i = 0; i < episodesToProduce; i++) {
    upcomingEpisodes.push(nextEpisodeNumber + i)
  }
  const upcomingHeaderLines = upcomingEpisodes
    .map(n => `      # EPISODE ${n <= SPELLED_NUMBERS.length ? SPELLED_NUMBERS[n - 1] : String(n)}`)
    .join('\n')

  // Paywall hint — is the paywall episode in the range we're about to draft?
  const paywallAfterEp = project.verticalPlan?.paywallAfterEpisode ?? 0
  const willCrossPaywall = paywallAfterEp > 0
    && paywallAfterEp >= currentEpisodeNumber
    && paywallAfterEp < nextEpisodeNumber + episodesToProduce
  const paywallHint = willCrossPaywall
    ? `\n  PAYWALL: the writer has set the paywall AFTER episode ${paywallAfterEp}. When you finish episode ${paywallAfterEp}'s Cliff beat, emit a single action line:\n      (PAYWALL)\n  Then start episode ${paywallAfterEp + 1} with its \`# EPISODE\` header as usual.`
    : ''

  return `

VERTICAL EPISODE POSITION:
  - The script currently contains ${existingEpisodeLabels} \`# EPISODE\` header${existingEpisodeLabels === 1 ? '' : 's'}, so you are inside (or about to open) episode ${currentEpisodeNumber}.
  - Page math: ${pages} page${pages === 1 ? '' : 's'} ≈ ${episodesToProduce} episode${episodesToProduce === 1 ? '' : 's'} at the Vertical target of ~2 pages per episode.
  - Each episode contains exactly 4 internal beats — Rise → Spike → Drop → Cliff — that play out across the episode's scenes. An episode may be 1 scene (all 4 beats in one location) or 2–4 scenes (one or more beats per location).
  - When the current episode CLOSES (after its Cliff beat), open the NEXT episode with a Fountain header:
${upcomingHeaderLines}
  - Each episode's last beat is its Cliff — never resolve cleanly; always leave a hook.${paywallHint}`
}

/**
 * Standardized neighbor-block for a single element: the element itself
 * plus a few elements before and after, so the AI knows what flows in
 * and out of the line being rewritten.
 */
function buildElementNeighbors(project: Project, elementId: string, radius = 4): {
  before: ScreenplayElement[]
  target: ScreenplayElement | null
  after: ScreenplayElement[]
} {
  const els = project.screenplay.elements
  const idx = els.findIndex(e => e.id === elementId)
  if (idx < 0) return { before: [], target: null, after: [] }
  return {
    before: els.slice(Math.max(0, idx - radius), idx),
    target: els[idx],
    after: els.slice(idx + 1, Math.min(els.length, idx + 1 + radius)),
  }
}

/* ---- 1. Rewrite a single line / paragraph ----------------------------- */

/** What the user wants done with a single element. */
export type RewriteMode =
  | 'tighten'        // remove fat; same meaning
  | 'sharper'        // sharper specificity
  | 'visual'         // strip interiority; show what we see
  | 'punch_up'       // dialogue: more voice, more subtext, sharper joke
  | 'continue'       // continue from this line outward (only for the final line)
  | 'alt'            // alt take (preserve intent, different phrasing)

const REWRITE_MODE_GUIDANCE: Record<RewriteMode, string> = {
  tighten:
    'Tighten this paragraph. Same intent, same beats, fewer words. Cut filler verbs and unnecessary adjectives. Keep the visual specifics. Maintain complete sentences with natural rhythm — do NOT chop into three-word fragments. Do NOT add metaphor or simile.',
  sharper:
    'Make this sharper. Replace generic verbs with concrete behavior. Replace abstract emotion with specific physical action or dialogue choice. Same meaning, more specificity. Plain working verbs only. No metaphor or simile. No "like a [thing]" comparisons.',
  visual:
    'Rewrite this so it shows only what we can see and hear. Strip any interiority, feelings stated, or thoughts. Replace "feels X" with the behavior that proves X. Keep sentence rhythm natural — complete sentences, not stacked fragments. No metaphor or simile.',
  punch_up:
    'Punch up this dialogue. Keep the character\'s voice fingerprint. Sharpen the subtext, the rhythm, the implied tactic. No on-the-nose lines. Keep the same number of words or fewer.',
  continue:
    'Continue this paragraph or dialogue line forward by one or two short blocks. Match the established voice and tone exactly. No metaphor or simile in action.',
  alt:
    'Produce an alternate take that preserves the original intent but changes the phrasing. Same length, same beat, different language. Do not add poetic comparisons or "like a [thing]" similes.',
}

/**
 * Rewrite ONE screenplay element with a specified mode. Returns the new
 * text for the same element type (string in → string out). For dialogue,
 * the character's voice fingerprint is injected automatically.
 */
export async function rewriteElement(
  input: TaskInput,
  args: {
    elementId: string
    mode: RewriteMode
    /** Optional plain-English nudge ("colder", "more vulgar", etc.). */
    hint?: string
  },
): Promise<TaskOutcome<string>> {
  const project = input.project
  const ctx = buildElementNeighbors(project, args.elementId, 4)
  const target = ctx.target
  if (!target) return { ok: false, error: 'Element not found.' }
  if (target.locked) return { ok: false, error: 'This line is locked. Unlock it before rewriting.' }
  if (!target.text.trim()) return { ok: false, error: 'Nothing to rewrite — the line is empty.' }

  const scene = findScopingScene(project, args.elementId)
  const speakers = scene ? speakersInScope(project, scene.elements) : []

  // For dialogue: find the speaking character (the nearest preceding character cue).
  let speaker: Character | null = null
  if (target.type === 'dialogue' || target.type === 'parenthetical') {
    const els = project.screenplay.elements
    const idx = els.findIndex(e => e.id === args.elementId)
    for (let i = idx - 1; i >= 0; i--) {
      if (els[i].type === 'character') {
        const cueName = els[i].text.replace(/\s*\([^)]*\)$/, '').trim().toUpperCase()
        speaker = project.characters.find(c => c.name.trim().toUpperCase() === cueName) ?? null
        break
      }
    }
  }

  const surrounding = [
    ...ctx.before,
    // mark the target so the AI knows which one is being edited
    { ...target, text: `⇨ ${target.text}` } as ScreenplayElement,
    ...ctx.after,
  ]

  const voiceBlock = speaker ? buildVoiceBlock([speaker]) : (target.type === 'dialogue' ? buildVoiceBlock(speakers) : '')

  const modeGuidance = REWRITE_MODE_GUIDANCE[args.mode] ?? REWRITE_MODE_GUIDANCE.tighten
  const hint = args.hint ? `\nUser hint: ${args.hint}` : ''

  const elementTypeName = target.type.replace('_', ' ')

  const instructions = `Rewrite the marked ${elementTypeName} line (⇨) below. ${modeGuidance}${hint}

Context (4 lines before, the target, 4 lines after — do NOT rewrite the others; output ONLY a replacement for ⇨):
${renderElementsForPrompt(surrounding)}

${voiceBlock ? `Speaker voice (must match exactly):\n${voiceBlock}\n` : ''}
HARD OUTPUT RULES:
- Output ONLY the replacement text for the ⇨ line. No quotes, no preamble, no labels, no extra paragraphs.
- Keep the same element type (a dialogue line stays dialogue; an action line stays action).
- No em-dashes anywhere.
- ${target.type === 'dialogue' ? 'Dialogue: no on-the-nose exposition. Keep subtext. Match the speaker\'s register.' : 'Action: write only what we can see and hear. Efficient, present tense, no interiority.'}`

  const taskTier: AITask = target.type === 'dialogue' || target.type === 'parenthetical'
    ? 'punch_up_dialogue'
    : 'rewrite_paragraph'

  return runText(taskTier, input, instructions, target.type === 'dialogue' || target.type === 'action' ? 600 : 300)
}

/* ---- 2. Draft scene pages from a scene card --------------------------- */

/**
 * Draft a scene's pages from a scene card. Returns Fountain text + any
 * newly-introduced character declarations (see `AISceneCharacter`).
 */
export const draftSceneFromCard = (input: TaskInput, args: { sceneCardId: string }) => {
  const card = input.project.sceneCards.find(s => s.id === args.sceneCardId)
  if (!card) {
    return Promise.resolve<TaskOutcome<DraftedScene>>({ ok: false, error: 'Scene card not found.' })
  }
  const existingCast = input.project.characters
    .map(c => c.name.toUpperCase())
    .filter(Boolean)
    .join(', ') || '(none)'

  const linkedBeat = card.beatId ? input.project.beats.find(b => b.id === card.beatId) : null
  const beatBlock = linkedBeat ? `\n\nThis card serves the beat:\n${renderBeatBrief(linkedBeat)}` : ''

  // Vertical-specific structural framing: each "episode" in the data
  // model is 4 beats (Rise → Spike → Drop → Cliff) and ~2 pages on the
  // page. Tell the model where in episode-structure this scene sits, so
  // it knows whether to OPEN a fresh episode (emit `# EPISODE N` first)
  // or land a Cliff (no episode emitted; the next draft will open the
  // following episode).
  const isVertical = !!input.project.format.verticalSandbox
  const verticalEpisodeBlock = isVertical
    ? buildVerticalEpisodeBlockForCard(input.project, card)
    : ''

  // Recent neighboring scenes — last few cards before this one — for continuity.
  const sorted = [...input.project.sceneCards].sort((a, b) => a.order - b.order)
  const myIdx = sorted.findIndex(c => c.id === card.id)
  const prevCards = myIdx > 0 ? sorted.slice(Math.max(0, myIdx - 2), myIdx) : []
  const prevBlock = prevCards.length
    ? `\n\nThe scenes immediately before this (for continuity):\n${prevCards.map((c, i) => `  ${i + 1}. ${c.title} [${c.slugLine || '?'}] — closed on "${c.closingValue || '?'}"`).join('\n')}`
    : ''

  // Voice fingerprints for the speaking cast (best effort: include all leads / supporting).
  const principalCast = input.project.characters
    .filter(c => ['protagonist', 'antagonist', 'love_interest', 'ally', 'foil', 'mentor', 'supporting'].includes(c.role))
  const voiceBlock = buildVoiceBlock(principalCast)

  const introduced = introducedCharacterNames(input.project)
  const introGuide = buildIntroductionGuide(input.project, introduced)

  return runJSON<DraftedScene>(
    'draft_scene',
    input,
    `Draft this scene from the scene card as Fountain text. Strict craft rules from the system prompt apply.

Scene card:
- Title: ${card.title}
- Slug line: ${card.slugLine || '(none — choose one)'}
- Summary: ${card.summary}
- Opening value: "${card.openingValue}"  → Closing value: "${card.closingValue}"
- Turn: ${card.turn}
- Who wants what: ${card.whoWantsWhat}
- Obstacle: ${card.obstacle}
- Tactic: ${card.tactic}
${beatBlock}${prevBlock}${verticalEpisodeBlock}

${isVertical ? `VERTICAL EPISODE RULES — NON-NEGOTIABLE. READ THIS BEFORE WRITING A SINGLE LINE.

1. AN EPISODE IS 2 PAGES. EXACT. Not 3, not 4. TWO PAGES per episode. If you exceed 2 pages of total Fountain output for this episode you have failed the task — cut until you fit.

2. EVERY EPISODE FOLLOWS THE 4-BEAT STRUCTURE — IN ORDER, NO EXCEPTIONS:
   - RISE  — situation ramps up. Tension or anticipation builds.
   - SPIKE — the dopamine climax. A slap, a kiss, a reveal, a fight, a betrayal, an arrest. The moment the audience opened the app for.
   - DROP  — the fallout. Consequence / emotional downturn from the Spike.
   - CLIFF — THE HOOK. The episode ENDS HERE on an unresolved cliffhanger. This is non-negotiable. NEVER let an episode resolve cleanly. The Cliff is what earns the next swipe. Without it the show fails.

3. EVERY EPISODE'S LAST FOUNTAIN ELEMENT MUST BE A HOOK. The final line / image / reveal is what makes the audience swipe to the next episode. Write to the hook; everything before exists to set it up.

4. The scene card's title and summary tell you which beat(s) of the four this draft covers — but the FOUR INTERNAL BEATS LIVE INSIDE THE 2-PAGE EPISODE. They are not separate scene cards in most cases. The default for a Vertical episode is ONE scene serving ALL FOUR internal beats inside a single recurring location.

5. VOICE: on-the-nose, declarative, melodramatic. Hooks every 60–90 seconds. Theme can be stated. Dialogue is direct — never literary, never subtle, never reflective. Match the cadence of the VERTICAL_REFERENCE_SAMPLES at the top of this system prompt ("Borgeous", "Secret Prince"). If a sentence you draft does not feel like it could appear in those samples, rewrite.

6. NO LITERARY FLUFF. No establishing prose. No interior monologue. No "the silence stretches." Vertical writes the picture and the punch — that's it. Open in media res with the conflict already in motion. Cut on the hook.

This card's estimatedPages says ${card.estimatedPages?.toFixed(2) ?? '2.00'} pages — keep it under that. The whole episode is 2 pages. NEVER overshoot.` : `The scene card's estimatedPages says ${card.estimatedPages?.toFixed(2) ?? '2.00'} pages. THAT IS THE BUDGET. Write to fit it — not under, not over. Modern features land tight (40 beats × ~2.25 pages each = 90 pages). Cut dialogue that doesn't move plot. Cut action lines that restate the slug. Open the scene LATE (after greetings, after small talk, on the moment of friction); leave EARLY (on the line that lands, before the wind-down). If your draft is heading past the budget you're padding — tighten.`}

Existing cast (use these names exactly when referring to them; do not rename):
${existingCast}

${voiceBlock ? `Voice fingerprints (match speaker voices exactly):\n${voiceBlock}\n` : ''}
${introGuide ? `${introGuide}\n` : ''}
You MAY introduce new characters if the scene requires them. For each one, list them under "newCharacters" with: name (ALL CAPS), functionInScene, role ("minor" or "supporting"), and optional age. For new minor characters who speak only a line or two, write them as ALL CAPS + age only (e.g., "BARTENDER (50s)") with no flowery description.

Format: write in Fountain. Scene headings start with INT./EXT. Character names ALL CAPS on their own line. Dialogue directly below. Action paragraphs 1–4 lines, present tense, only what we SEE. No em-dashes.${isVertical
  ? `\n\nVERTICAL EPISODE LABELS:\n- If this scene OPENS a brand-new episode (i.e., the previous scene was a Cliff beat, or this is the FIRST scene of episode 2 onwards), the Fountain output MUST begin with a section header line:  \`# EPISODE TWO\`  (or THREE / FOUR / FIVE / …). Use spelled-out numbers, ALL CAPS.\n- If this scene is the Rise / Spike / Drop within an episode that already opened, do NOT emit an episode header. Only the OPENING beat of an episode gets one.\n- See the "Vertical episode position" block above for which beat this scene serves and whether it opens a new episode.`
  : ''}

PARENTHETICAL DISCIPLINE: Use parentheticals (wrylies) almost never. NEVER for emotion labels like (sad) (nervous) (angry). NEVER for stage business like (shrugs) (looks down) (nods) (sighs) (smiles). NEVER as filler. If a behavior matters, write it as an action line above the dialogue.
(beat) DISCIPLINE: Use the (beat) wryly almost never. Most scenes contain ZERO (beat)s. Only use one when the silence itself is the most important moment in the scene.

Return JSON: { "fountain": "...", "newCharacters": [...] }`,
    // Generous token budget — the model decides length, we just give it room.
    // 8000 tokens ≈ 16 screenplay pages, more than any single scene should ever need.
    8000,
  )
}

/* ---- 3. Continue from cursor (the writer is stuck) -------------------- */

/**
 * Continue the screenplay forward from a given element. The unit is PAGES —
 * the model is told to write roughly N pages of new material starting from
 * the cursor, breaking into new scenes as the story demands. When scene
 * cards exist downstream from the cursor, the model is told to USE them as
 * structural targets (it should walk through the next cards naturally).
 *
 * Returns Fountain text the caller parses and inserts via
 * `insertElementsAfter`.
 */
export async function continueFromHere(
  input: TaskInput,
  args: {
    elementId: string
    /** Approximate number of new screenplay pages to produce. */
    pages?: number
    hint?: string
  },
): Promise<TaskOutcome<DraftedScene>> {
  const project = input.project
  const ctx = buildElementNeighbors(project, args.elementId, 8)
  if (!ctx.target) return { ok: false, error: 'Element not found.' }

  const scene = findScopingScene(project, args.elementId)
  const speakers = scene ? speakersInScope(project, scene.elements) : []
  const voiceBlock = buildVoiceBlock(speakers)
  const sceneHeading = scene?.heading.text ?? ''

  const sceneCard = scene
    ? project.sceneCards.find(c => c.startElementId === scene.heading.id)
    : null
  const cardBlock = sceneCard
    ? `\n\nScene card for the CURRENT scene:\n  Title: ${sceneCard.title}\n  Summary: ${sceneCard.summary}\n  Opening → Closing: ${sceneCard.openingValue || '?'} → ${sceneCard.closingValue || '?'}\n  Who wants what: ${sceneCard.whoWantsWhat}\n  Obstacle: ${sceneCard.obstacle}`
    : ''

  // Find scene cards AFTER the current one (the writer's roadmap). If the
  // writer requested several pages, the model should walk through these.
  const drafted = new Set<string>()
  for (const el of project.screenplay.elements) {
    if (el.type === 'scene_heading' && el.text.trim()) {
      drafted.add(el.text.trim().toUpperCase())
    }
  }
  const upcomingCards = [...project.sceneCards]
    .sort((a, b) => a.order - b.order)
    .filter(c => c.slugLine && !drafted.has(c.slugLine.trim().toUpperCase()))
    .slice(0, 6)
  const upcomingBlock = upcomingCards.length
    ? `\n\nUPCOMING SCENE CARDS (use these as structural targets — break into them as needed):\n${
        upcomingCards.map((c, i) => `  ${i + 1}. ${c.slugLine || '(no slug)'} — ${c.title}: ${c.summary?.slice(0, 200) || ''}`).join('\n')
      }`
    : ''

  // Effective per-unit page target (episode for episodic, project for
  // features). Drafting must STOP within this — the writer who set
  // "max 3 pages" via Foundational Guidance does not want 9 pages of
  // continuation. Pages already written in the screenplay are
  // subtracted from the target so we never write past it.
  const pageTarget = effectivePageTarget(input)
  const pagesWritten = estimatePagesWritten(project)
  const remainingBudget = Math.max(0.25, pageTarget - pagesWritten)
  // Honor whatever the writer asked for, but never let it overrun the
  // remaining budget. Round to one decimal so we can ask for fractional
  // pages on tight projects (e.g., 0.75 pages on a 2-page episode that
  // already has 1.25 pages drafted).
  const askedPages = Math.max(0.25, Math.min(30, args.pages ?? 2))
  const pages = Math.min(askedPages, remainingBudget)
  const hint = args.hint ? `\nUser hint: ${args.hint}` : ''
  const introduced = introducedCharacterNames(project)
  const introGuide = buildIntroductionGuide(project, introduced)
  const isVertical = !!project.format.verticalSandbox

  // If the writer already filled out the page budget, refuse rather
  // than overrun — same "caught up" pattern used by other AI surfaces.
  if (remainingBudget < 0.5) {
    return {
      ok: false,
      error: `End of page budget reached. The effective page target for this ${project.planning.seriesPlan ? 'episode' : 'project'} is ~${pageTarget} pages and roughly ${pagesWritten.toFixed(1)} are already drafted. Edit existing pages or raise the target in Foundational Guidance before continuing.`,
    }
  }

  // For Vertical projects, tell the AI exactly what episode it should
  // open NEXT (and how many episodes worth of content the page target
  // corresponds to). Each Vertical episode is ~2 pages, 4 beats.
  const verticalContinuationBlock = isVertical
    ? buildVerticalEpisodeBlockForContinuation(project, pages)
    : ''

  return runJSON<DraftedScene>(
    'draft_scene',
    input,
    `Continue writing the screenplay forward from the cursor by approximately ${pages.toFixed(1)} screenplay page${pages === 1 ? '' : 's'} of new material. (One page ≈ 4–6 short action paragraphs OR ≈ 30–40 lines of dialogue, in standard formatting.) Do NOT rewrite any of the existing lines.${hint}

HARD PAGE CAP — the effective page target for this ${project.planning.seriesPlan ? 'episode' : 'project'} is ${pageTarget} pages. Approximately ${pagesWritten.toFixed(1)} pages are ALREADY drafted in the screenplay. You have at most ${remainingBudget.toFixed(1)} pages of remaining budget. UNDER NO CIRCUMSTANCES produce more than ${remainingBudget.toFixed(1)} pages of new material. If you find yourself near the cap, button the scene and stop. Quality over quantity — short and complete beats long and bloated.

BREVITY LAW — efficiency is mandatory. Every line earns its place:
- Arrive late, leave early. Skip the small talk, skip the "well, that's interesting" wind-down.
- Cut any dialogue that doesn't advance plot, reveal character, or escalate stakes.
- Each upcoming scene card's estimatedPages is its budget — write to that number, not over.
- The PROJECT page target is fixed. If the writer asked for 90 pages of feature, your continuation must contribute to that total — never balloon past.

${sceneHeading ? `Current scene heading: ${sceneHeading}` : ''}

Recent lines (do NOT modify; you continue AFTER the last line):
${renderElementsForPrompt([...ctx.before, ctx.target])}

${cardBlock}${upcomingBlock}${verticalContinuationBlock}
${voiceBlock ? `Voice fingerprints (match speaker voices exactly):\n${voiceBlock}\n` : ''}
${introGuide ? `${introGuide}\n` : ''}
Format: Fountain. Scene headings INT./EXT., character cues ALL CAPS, action paragraphs 1–4 lines present tense, no em-dashes, no interiority.${isVertical
  ? `\n\nVERTICAL EPISODE LABELS:\n- A Vertical EPISODE is exactly 4 beats: Rise → Spike → Drop → Cliff. Each episode is ~2 pages.\n- When you OPEN a new episode (i.e., the previous content ended on a Cliff, or this is the first episode after episode 1), emit a section header line FIRST: \`# EPISODE TWO\` (or THREE / FOUR / …). Use the spelled-out number, ALL CAPS.\n- Inside an episode (Rise, Spike, Drop beats), do NOT emit episode headers.\n- The "Vertical episode position" block above tells you which episode number to open next.`
  : ''}

PARENTHETICAL DISCIPLINE: Use parentheticals (wrylies) almost never. NEVER for emotion labels (sad / nervous / angry), stage business (shrugs / looks down / nods / sighs / smiles), or filler. If a behavior matters, write it as an action line above the dialogue.
(beat) DISCIPLINE: Use (beat) almost never. Most output should have ZERO (beat)s. Only use one when the silence itself is the most important moment.

Hard rules:
- Aim for approximately ${pages} page${pages === 1 ? '' : 's'} of new material. Use the upcoming scene cards above as your roadmap; break into a new scene heading (INT./EXT.) when the current scene closes and the next card calls for a new location/time.
- Use only characters already in the project. Declare any new ones under "newCharacters".
- Stay inside the same dramatic value flow — do not skip ahead beyond the upcoming cards above.${isVertical
  ? `\n- Vertical math: ${pages} page${pages === 1 ? '' : 's'} ≈ ${Math.max(1, Math.round(pages / 2))} episode${Math.max(1, Math.round(pages / 2)) === 1 ? '' : 's'} at 2 pages per episode. Open each new episode with the \`# EPISODE N\` header.`
  : ''}

Return JSON: { "fountain": "...", "newCharacters": [...] }`,
    // 800 tokens ≈ 1.5 screenplay pages. Allow generous room per requested page.
    Math.max(2000, pages * 1600),
  )
}

/* ---- 4. Expand a scene's action beat into pages ----------------------- */

/**
 * Expand a chunk of action text into a full scene segment. Useful when
 * the writer drops one line ("She finally tells him") and wants the AI
 * to play the moment out properly.
 */
export async function expandToScene(
  input: TaskInput,
  args: {
    elementId: string
    /** Approximate target paragraphs. */
    paragraphs?: number
    hint?: string
  },
): Promise<TaskOutcome<DraftedScene>> {
  const project = input.project
  const els = project.screenplay.elements
  const idx = els.findIndex(e => e.id === args.elementId)
  if (idx < 0) return { ok: false, error: 'Element not found.' }
  const target = els[idx]
  if (target.locked) return { ok: false, error: 'This line is locked. Unlock it before expanding.' }
  if (!target.text.trim()) return { ok: false, error: 'Nothing to expand — the line is empty.' }

  const scene = findScopingScene(project, args.elementId)
  const speakers = scene ? speakersInScope(project, scene.elements) : []
  const voiceBlock = buildVoiceBlock(speakers)

  const before = els.slice(Math.max(0, idx - 4), idx)
  const after = els.slice(idx + 1, Math.min(els.length, idx + 5))

  const paras = Math.max(2, Math.min(15, args.paragraphs ?? 5))
  const hint = args.hint ? `\nUser hint: ${args.hint}` : ''
  const introduced = introducedCharacterNames(project)
  const introGuide = buildIntroductionGuide(project, introduced)

  return runJSON<DraftedScene>(
    'draft_scene',
    input,
    `Expand the marked one-line beat (⇨) into roughly ${paras} screenplay paragraphs. Replace the beat line with the played-out version.${hint}

Context (do NOT rewrite the surrounding lines; you only replace ⇨):
${renderElementsForPrompt([
  ...before,
  { ...target, text: `⇨ ${target.text}` } as ScreenplayElement,
  ...after,
])}

${voiceBlock ? `Voice fingerprints (match speaker voices exactly):\n${voiceBlock}\n` : ''}
${introGuide ? `${introGuide}\n` : ''}
Format: Fountain. Action lines 1–4 lines present tense, character cues ALL CAPS, dialogue beneath. No em-dashes. No interiority. Show, don't tell.

PARENTHETICAL DISCIPLINE: Use parentheticals (wrylies) almost never. NEVER for emotion labels (sad / nervous / angry), stage business (shrugs / looks down / nods / sighs / smiles), or filler. If a behavior matters, write it as an action line above the dialogue.
(beat) DISCIPLINE: Use (beat) almost never. Most output should have ZERO (beat)s. Only use one when the silence itself is the most important moment.

Return JSON: { "fountain": "...", "newCharacters": [...] }`,
    Math.max(600, paras * 250),
  )
}

/* ============================================================================
 * Series / Show-Bible AI tasks
 * ========================================================================= */

interface AIEpisode {
  number: number
  title: string
  logline: string
  summary: string
  hook?: string
  arcMovements?: Array<{ arcLabel: string; movement: string }>
  focusCharacters?: string[]
  status?: SeriesEpisode['status']
}

interface AISeasonArc {
  label: string
  description: string
  dramaticQuestion: string
  startEpisode?: number
  endEpisode?: number
}

/**
 * Build a complete season outline from the project's show-bible scaffolding.
 * Reads premise / engine / season-arc-question / cast / themes and produces
 * a multi-episode season with explicit arc tracking.
 *
 * Used by the Series Planning panel's "Take It From Here" button.
 */
export async function generateSeasonOutline(
  input: TaskInput,
): Promise<TaskOutcome<{ arcs: AISeasonArc[]; episodes: AIEpisode[] }>> {
  const project = input.project
  const series = project.planning.seriesPlan
  if (!series) {
    return { ok: false, error: 'This project does not have a series plan. Use a TV / animation format.' }
  }

  // Validate there's enough signal to produce a season.
  // Series-aware signal collection — accept any combination of the
  // series-level Show Bible fields plus the legacy project-planning
  // fields, so projects that only filled in the Show Bible still pass.
  const signal = [
    series.seriesLogline,
    series.seriesShortSummary,
    series.seriesLongSynopsis,
    series.premise,
    series.engine,
    series.seasonArcQuestion,
    project.planning.logline,
    project.planning.shortSummary,
    project.planning.themeQuestion,
  ].filter(Boolean).join(' ').trim()
  if (signal.length < 30) {
    return { ok: false, error: 'Fill in the Show Bible (series logline + engine + season-arc question) first.' }
  }

  const cast = project.characters.length
    ? project.characters.map(c =>
        `* ${c.name} (${c.role.replace('_', ' ')})${c.externalGoal ? ` — wants: ${c.externalGoal}` : ''}${c.wound ? ` — wound: ${c.wound}` : ''}`
      ).join('\n')
    : '(no characters yet)'

  const existingEpisodes = series.episodes.length
    ? `\n\nEXISTING EPISODES (do NOT regenerate; produce only the remaining ones):\n${series.episodes
        .slice()
        .sort((a, b) => a.number - b.number)
        .map(e => `  Ep ${e.number}: "${e.title}" — ${e.logline}`)
        .join('\n')}`
    : ''
  const existingArcs = series.seasonArcs.length
    ? `\n\nEXISTING SEASON ARCS (do NOT regenerate; you may reference them in episodes):\n${series.seasonArcs
        .map(a => `  ${a.label}: ${a.description}${a.dramaticQuestion ? ` Q: ${a.dramaticQuestion}` : ''}`)
        .join('\n')}`
    : ''

  const target = series.targetEpisodeCount
  const newEpisodeCount = Math.max(1, target - series.episodes.length)
  const startNumber = (series.episodes.length > 0
    ? Math.max(...series.episodes.map(e => e.number))
    : 0) + 1

  return runJSON<{ arcs: AISeasonArc[]; episodes: AIEpisode[] }>(
    'season_plan',
    input,
    `Build the season outline for this ${project.format.label} show.

SHOW BIBLE:
- Title: ${series.showTitle || project.title}
- Premise: ${series.premise || project.planning.logline || '(none)'}
- Engine: ${series.engine || project.planning.storyEngine || '(none)'}
- Season arc question: ${series.seasonArcQuestion || project.planning.seriesArcQuestion || '(none)'}
- Tone notes: ${series.toneNotes || project.planning.tone.join(', ') || '(none)'}
- Theme question: ${project.planning.themeQuestion || '(none)'}

CAST:
${cast}

TARGET:
- Season ${series.seasonNumber}, ${target} total episodes.
- Produce ${newEpisodeCount} new episode${newEpisodeCount === 1 ? '' : 's'}, numbered starting at ${startNumber}.
${existingArcs}${existingEpisodes}

REQUIRED PRODUCTION:

1. SEASON ARCS (3–5 total, including any existing ones — but only EMIT the new ones).
   Each arc is a multi-episode story thread (NOT the same as A/B/C episode subplots).
   - label: short specific name (use THIS project's cast — e.g. "[Lead] v Cartel", "The Senate Race")
   - description: 2–4 sentences, named characters, what changes across the season
   - dramaticQuestion: one yes/no question answered by the season finale
   - startEpisode, endEpisode: integer episode numbers this arc is active in (must fit inside the season)
   Each arc must have a CLEAR climax episode where its dramatic question is answered.

2. EPISODES (the new ${newEpisodeCount} episodes).
   For each episode:
   - number: integer starting at ${startNumber}
   - title: 2–6 words, specific (NOT "The Reveal" — "[Character] Burns The File")
   - logline: one-sentence pitch for this specific episode
   - summary: 3–5 sentences — what HAPPENS this week, with named characters and at least one specific image / scene
   - hook: the cold-open / pre-title hook idea
   - arcMovements: for EACH arc this episode advances, a one-sentence "what does this arc spend this week". Use the arc's "label".
   - focusCharacters: the cast members who get screen time (use existing CAST names)
   - status: "planned"

STRUCTURAL DISCIPLINE FOR THE SEASON:
- Premiere (Ep ${startNumber}) sets up the world AND launches the central engine of conflict.
- Mid-season (around Ep ${Math.round(target / 2)}) carries a major flip: an alliance breaks, a secret leaks, a death lands.
- Finale (Ep ${target}) answers the season-arc question, even if it answers it with a darker question for next season.
- AT LEAST 2 episodes should be "bottle" or "two-hander" style — confined location, deep relationship pressure — to break up plot momentum.
- AT LEAST one episode pivots POV away from the protagonist to a supporting character.
- Each arc must visibly advance in 3+ episodes (not just bookended).

CRITICAL: This is a show bible — not a 200-page coverage doc. Be concrete and lean. Use named characters. Avoid filler verbs.

Return JSON: { "arcs": [...AISeasonArc...], "episodes": [...AIEpisode...] }`,
    Math.max(8000, target * 700),
  )
}

/**
 * Generate ONE episode's details (title / logline / summary / hook /
 * arcMovements / focusCharacters) from the current state of the season.
 */
export async function suggestEpisode(
  input: TaskInput,
  args: {
    /** Episode number to slot this into. If absent, picks the next slot. */
    number?: number
    /** Optional plain-English nudge ("flashback episode", "two-hander", etc.). */
    hint?: string
  },
): Promise<TaskOutcome<AIEpisode>> {
  const project = input.project
  const series = project.planning.seriesPlan
  if (!series) return { ok: false, error: 'No series plan on this project.' }

  const cast = project.characters.map(c => `* ${c.name} (${c.role.replace('_', ' ')})`).join('\n') || '(no characters)'
  const arcs = series.seasonArcs.length
    ? series.seasonArcs.map(a => `  ${a.label}: ${a.description}`).join('\n')
    : '(no arcs defined yet)'
  const surrounding = series.episodes
    .slice()
    .sort((a, b) => a.number - b.number)
    .map(e => `  Ep ${e.number}: "${e.title}" — ${e.logline}`)
    .join('\n') || '(no episodes yet)'

  const number = args.number ?? (
    series.episodes.length > 0
      ? Math.max(...series.episodes.map(e => e.number)) + 1
      : 1
  )
  const hint = args.hint ? `\nUser hint: ${args.hint}` : ''

  return runJSON<AIEpisode>(
    'season_plan',
    input,
    `Generate ONE new episode for this season.${hint}

SHOW:
- Title: ${series.showTitle || project.title}
- Premise: ${series.premise || project.planning.logline}
- Engine: ${series.engine || project.planning.storyEngine || '(none)'}
- Season arc question: ${series.seasonArcQuestion || '(none)'}

CAST:
${cast}

SEASON ARCS:
${arcs}

EXISTING EPISODES (continuity — do NOT duplicate, but DO thread arcs forward):
${surrounding}

THIS EPISODE:
- number: ${number}
- Use named characters from CAST.
- "arcMovements": list each arc this episode advances and one sentence describing what it spends. Use the arc's label exactly.
- "focusCharacters": names from CAST.

CONSTRAINTS:
- title 2–6 words, specific.
- logline one sentence.
- summary 3–5 sentences, present tense, named characters, at least one specific image.
- hook one sentence — cold-open idea.
- status: "planned".

Return JSON for ONE episode in this shape: { "number": 7, "title": "...", "logline": "...", "summary": "...", "hook": "...", "arcMovements": [{ "arcLabel": "...", "movement": "..." }], "focusCharacters": ["...","..."], "status": "planned" }`,
    1500,
  )
}

/* ============================================================================
 * Convenience: a stripped-string final sanitizer (used by inline-replace UI)
 * ========================================================================= */

export function finalSanitize(s: string, context: 'action' | 'dialogue' | 'parenthetical' | 'general' = 'general'): string {
  return stripEmDashes(s, context).trim()
}
