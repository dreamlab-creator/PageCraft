/**
 * Format Interpreter.
 *
 * Takes a natural-language description of a screenplay format and composes a
 * FormatConfig from a library of DNA fragments. The user types something like:
 *
 *   "A 2D animated comedy with two-minute episodes and two acts per episode"
 *
 * ...and the Interpreter assembles a working FormatConfig (with sensible
 * defaults for everything the user didn't specify), surfaces a minimal set of
 * clarifying ambiguities, and returns the composed result for the user to
 * confirm or tweak.
 *
 * Design principles:
 *   - never block the user. Fall back to safe defaults if ambiguous.
 *   - only ask clarifying questions when the answer would meaningfully change
 *     the output (e.g., kids vs adult tone calibrates AI prompts).
 *   - the result is always editable in the Wizard preview.
 */

import type {
  FormatConfig,
  ActStructure,
  GenreLane,
  AudienceTier,
  FormatKind,
} from '@/types'
import { STANDARD_PAGE, MULTI_CAM_PAGE, VERTICAL_PAGE } from './page-geometry'
import { PRESETS } from './presets'

export interface FormatInterpretation {
  config: FormatConfig
  parsed: ParsedFormatSpec
  /** Things the user might want to clarify, but the AI has made a reasonable assumption. */
  ambiguities: Ambiguity[]
  /** Closest preset(s) the inferred format derives from. */
  derivedFrom: FormatKind[]
  /** A human-readable summary the wizard can render in the preview card. */
  summary: string
}

export interface Ambiguity {
  id: string
  question: string
  defaultAssumption: string
  options?: string[]
}

export interface ParsedFormatSpec {
  medium: 'live_action' | 'animation' | 'mixed' | 'unknown'
  genres: GenreLane[]
  tone: string[]
  formatClass:
    | 'feature'
    | 'tv_series'
    | 'tv_special'
    | 'short'
    | 'vertical'
    | 'anthology'
    | 'mini_series'
    | 'unknown'
  runtime?: { minutes: number; scope: 'per_episode' | 'total' }
  acts?: number
  coldOpen: boolean
  teaser: boolean
  tag: boolean
  episodesPerSeason?: number
  audience: AudienceTier
  conventions: {
    multiCam: boolean
    singleCam: boolean
    musical: boolean
    silent: boolean
    documentary: boolean
    mockumentary: boolean
    anthology: boolean
    actless: boolean
  }
  raw: string
}

/* ============================================================================
 * Parser: natural-language → structured spec
 * ========================================================================= */

const GENRE_KEYWORDS: Record<string, GenreLane> = {
  drama: 'drama',
  dramatic: 'drama',
  comedy: 'comedy',
  comedic: 'comedy',
  comic: 'comedy',
  sitcom: 'comedy',
  funny: 'comedy',
  thriller: 'thriller',
  suspense: 'thriller',
  horror: 'horror',
  scary: 'horror',
  mystery: 'mystery',
  whodunit: 'mystery',
  romance: 'romance',
  romantic: 'romance',
  'rom-com': 'romance',
  romcom: 'romance',
  sci: 'sci_fi',
  'sci-fi': 'sci_fi',
  scifi: 'sci_fi',
  science: 'sci_fi',
  fantasy: 'fantasy',
  action: 'action',
  crime: 'crime',
  noir: 'crime',
  period: 'period',
  historical: 'period',
  family: 'family',
  kids: 'family',
  musical: 'musical',
  biopic: 'biopic',
  biographical: 'biopic',
  documentary: 'documentary_drama',
  docudrama: 'documentary_drama',
}

const TONE_KEYWORDS = [
  'grounded',
  'absurdist',
  'surreal',
  'noir',
  'campy',
  'prestige',
  'gritty',
  'melodramatic',
  'lyrical',
  'kinetic',
  'minimalist',
  'maximalist',
  'satirical',
  'whimsical',
  'dark',
  'lighthearted',
  'cerebral',
  'visceral',
  'emotional',
  'philosophical',
  'pulpy',
  'literary',
  'tongue-in-cheek',
  'mockumentary',
]

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, ninety: 90, hundred: 100,
}

function parseNumber(token: string): number | null {
  const t = token.toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (/^\d+$/.test(t)) return parseInt(t, 10)
  if (NUMBER_WORDS[t] != null) return NUMBER_WORDS[t]
  return null
}

function detectRuntime(s: string): ParsedFormatSpec['runtime'] {
  // Patterns: "X-minute", "X minute", "X min", "X-min", "30-second", "90 second"
  const rxMin = /(\d+|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|ninety)\b)[\s-]?(minute|min|m\b)/i
  const rxSec = /(\d+|\b(?:thirty|sixty|ninety)\b)[\s-]?(second|sec|s\b)/i
  const minM = s.match(rxMin)
  if (minM) {
    const n = parseNumber(minM[1])
    if (n != null) {
      const perEpisode = /per episode|each episode|episode|short/i.test(s)
      return { minutes: n, scope: perEpisode ? 'per_episode' : 'total' }
    }
  }
  const secM = s.match(rxSec)
  if (secM) {
    const n = parseNumber(secM[1])
    if (n != null) {
      const minutes = n / 60
      return { minutes, scope: 'per_episode' }
    }
  }
  return undefined
}

function detectActs(s: string): number | undefined {
  // Patterns: "X acts", "X-act", "X act"
  const m = s.match(
    /(\d+|\b(?:one|two|three|four|five|six|seven|eight)\b)[\s-]?(act|acts|-act)/i,
  )
  if (m) {
    const n = parseNumber(m[1])
    return n ?? undefined
  }
  if (/actless/i.test(s)) return 0
  return undefined
}

function detectEpisodeCount(s: string): number | undefined {
  // "X episodes", "X-episode"
  const m = s.match(/(\d+)[\s-]?(episodes?|ep\b|episode)/i)
  if (m) {
    const n = parseInt(m[1], 10)
    return isNaN(n) ? undefined : n
  }
  return undefined
}

function detectFormatClass(s: string): ParsedFormatSpec['formatClass'] {
  const l = s.toLowerCase()
  if (/vertical|microdrama|micro-drama|reelshort|dramabox/.test(l)) return 'vertical'
  if (/feature|movie|film/.test(l)) return 'feature'
  if (/mini[\s-]?series|limited series/.test(l)) return 'mini_series'
  if (/anthology/.test(l)) return 'anthology'
  if (/short film|short\b/.test(l)) return 'short'
  if (/special|tv special|christmas special|holiday special/.test(l)) return 'tv_special'
  if (/pilot|series|tv|television|sitcom|episode/.test(l)) return 'tv_series'
  return 'unknown'
}

function detectMedium(s: string): ParsedFormatSpec['medium'] {
  const l = s.toLowerCase()
  if (/\b(animation|animated|2d|3d|cgi|anime|stop[\s-]?motion|cartoon)\b/.test(l)) return 'animation'
  if (/\blive[\s-]?action\b/.test(l)) return 'live_action'
  if (/\bmixed[\s-]?media\b/.test(l)) return 'mixed'
  return 'unknown'
}

function detectAudience(s: string): AudienceTier {
  const l = s.toLowerCase()
  if (/\b(kids|children|preschool|nursery)\b/.test(l)) return 'kids'
  if (/\bfamily\b/.test(l)) return 'family'
  if (/\b(ya|young adult|teen|teenage)\b/.test(l)) return 'teen'
  if (/\bmature|nsfw|tv-?ma|rated r\b/.test(l)) return 'mature'
  if (/\badult\b/.test(l)) return 'adult'
  return 'unspecified'
}

function detectConventions(s: string): ParsedFormatSpec['conventions'] {
  const l = s.toLowerCase()
  return {
    multiCam: /multi[\s-]?cam|multicamera|live audience|three[\s-]?camera/.test(l),
    singleCam: /single[\s-]?cam|single[\s-]?camera/.test(l),
    musical: /musical/.test(l),
    silent: /silent/.test(l),
    documentary: /documentary|doc\b/.test(l),
    mockumentary: /mockumentary|mock[\s-]?doc/.test(l),
    anthology: /anthology/.test(l),
    actless: /actless|no acts/.test(l),
  }
}

function detectGenres(s: string): GenreLane[] {
  const l = s.toLowerCase()
  const found = new Set<GenreLane>()
  for (const [k, v] of Object.entries(GENRE_KEYWORDS)) {
    if (new RegExp(`\\b${k}\\b`, 'i').test(l)) found.add(v)
  }
  return Array.from(found)
}

function detectTone(s: string): string[] {
  const l = s.toLowerCase()
  return TONE_KEYWORDS.filter(t => new RegExp(`\\b${t}\\b`, 'i').test(l))
}

function detectColdOpenTeaserTag(s: string) {
  const l = s.toLowerCase()
  return {
    coldOpen: /cold[\s-]?open/.test(l),
    teaser: /teaser/.test(l),
    tag: /\btag\b|tag scene/.test(l),
  }
}

export function parseFormatSpec(input: string): ParsedFormatSpec {
  const raw = input.trim()
  const cot = detectColdOpenTeaserTag(raw)
  return {
    medium: detectMedium(raw),
    genres: detectGenres(raw),
    tone: detectTone(raw),
    formatClass: detectFormatClass(raw),
    runtime: detectRuntime(raw),
    acts: detectActs(raw),
    coldOpen: cot.coldOpen,
    teaser: cot.teaser,
    tag: cot.tag,
    episodesPerSeason: detectEpisodeCount(raw),
    audience: detectAudience(raw),
    conventions: detectConventions(raw),
    raw,
  }
}

/* ============================================================================
 * Composer: structured spec → FormatConfig (with smart defaults)
 * ========================================================================= */

function composeActStructure(p: ParsedFormatSpec): ActStructure {
  if (p.formatClass === 'vertical') return 'episode_cycles'
  if (p.conventions.actless || p.acts === 0) return 'actless'
  if (p.teaser && p.acts && p.acts >= 4) return 'teaser_plus_4_act'
  if (p.coldOpen && p.acts === 3 && p.tag) return 'cold_open_plus_3_act_plus_tag'
  if (p.conventions.anthology) return 'anthology_frame'
  switch (p.acts) {
    case 2: return '2_act'
    case 3: return '3_act'
    case 4: return '4_act'
    case 5: return '5_act'
  }
  if (p.formatClass === 'feature') return '3_act'
  if (p.formatClass === 'tv_series' && p.runtime && p.runtime.minutes >= 50) return 'teaser_plus_4_act'
  if (p.formatClass === 'tv_series' && p.runtime && p.runtime.minutes <= 30) return 'cold_open_plus_3_act_plus_tag'
  return '3_act'
}

function composePagesTargetFromRuntime(p: ParsedFormatSpec): { min: number; max: number } {
  if (!p.runtime) {
    // Defaults by format class.
    switch (p.formatClass) {
      case 'feature': return { min: 90, max: 120 }
      case 'tv_series': return { min: 30, max: 65 }
      case 'short': return { min: 5, max: 20 }
      case 'mini_series': return { min: 45, max: 65 }
      case 'tv_special': return { min: 50, max: 70 }
      case 'anthology': return { min: 30, max: 60 }
      case 'vertical': return { min: 60, max: 100 }
      default: return { min: 30, max: 120 }
    }
  }
  // 1 page ≈ 1 minute (industry rough). Multi-cam: 2 pages per minute.
  const ppm = p.conventions.multiCam ? 2 : 1
  const minutes = p.runtime.minutes
  // Small variance around the target.
  const center = Math.round(minutes * ppm)
  const variance = Math.max(2, Math.round(center * 0.1))
  return { min: Math.max(1, center - variance), max: center + variance }
}

function composeMedium(p: ParsedFormatSpec): FormatConfig['medium'] {
  if (p.medium === 'animation') return 'animation'
  if (p.medium === 'mixed') return 'mixed'
  return 'live_action'
}

function composePagePresetByConventions(p: ParsedFormatSpec): FormatConfig['page'] {
  if (p.formatClass === 'vertical') return VERTICAL_PAGE
  if (p.conventions.multiCam) return MULTI_CAM_PAGE
  return STANDARD_PAGE
}

function composeAudience(p: ParsedFormatSpec): AudienceTier {
  if (p.audience !== 'unspecified') return p.audience
  if (p.medium === 'animation') return 'family'
  if (p.formatClass === 'vertical') return 'adult'
  return 'adult'
}

function composeHumanization(p: ParsedFormatSpec): FormatConfig['humanization'] {
  return p.formatClass === 'vertical' ? 'vertical_relaxed_dialogue' : 'strict'
}

function composePacing(p: ParsedFormatSpec): FormatConfig['pacing'] {
  if (p.formatClass === 'vertical') {
    return { profile: 'vertical', avgScenePages: 1.0, tensionPeakIntervalPages: 1 }
  }
  // Very-fast: short-runtime animation/comedy
  if (p.medium === 'animation' && p.runtime && p.runtime.minutes <= 5) {
    return {
      profile: 'very_fast',
      avgScenePages: 0.5,
      tensionPeakIntervalPages: 1,
      gagIntervalSeconds: 20,
    }
  }
  if (p.genres.includes('comedy')) {
    return { profile: 'fast', avgScenePages: 1.5, tensionPeakIntervalPages: 8, gagIntervalSeconds: 45 }
  }
  if (p.genres.includes('thriller') || p.genres.includes('horror') || p.genres.includes('action')) {
    return { profile: 'brisk', avgScenePages: 1.8, tensionPeakIntervalPages: 8 }
  }
  return { profile: 'measured', avgScenePages: 2.5, tensionPeakIntervalPages: 15 }
}

function composeGenres(p: ParsedFormatSpec): GenreLane[] {
  if (p.genres.length > 0) return p.genres
  if (p.formatClass === 'vertical') return ['romance', 'drama']
  return ['drama']
}

function composeStructure(
  p: ParsedFormatSpec,
  pages: { min: number; max: number },
): FormatConfig['structure'] {
  const actStructure = composeActStructure(p)
  if (p.formatClass === 'vertical') {
    const totalEp = p.episodesPerSeason ?? 50
    return {
      actStructure,
      targetActs: 0,
      coldOpen: false,
      teaser: false,
      tag: false,
      targetPagesMin: pages.min,
      targetPagesMax: pages.max,
      episodesPerSeason: totalEp,
      cyclesPerSeason: Math.max(6, Math.min(9, Math.round(totalEp / 6))),
      episodesPerCycle: 6,
      beatsPerEpisode: 4,
      targetEpisodeRuntimeSeconds: 75,
      expectActOuts: false,
    }
  }
  const actCount = p.acts ?? (
    actStructure === '5_act' ? 5 :
    actStructure === '4_act' ? 4 :
    actStructure === 'teaser_plus_4_act' ? 5 :
    actStructure === '2_act' ? 2 :
    actStructure === 'cold_open_plus_3_act_plus_tag' ? 3 :
    actStructure === 'actless' ? 0 : 3
  )
  return {
    actStructure,
    targetActs: actCount,
    coldOpen: p.coldOpen || actStructure === 'cold_open_plus_3_act_plus_tag',
    teaser: p.teaser || actStructure === 'teaser_plus_4_act',
    tag: p.tag || actStructure === 'cold_open_plus_3_act_plus_tag',
    targetPagesMin: pages.min,
    targetPagesMax: pages.max,
    episodesPerSeason: p.formatClass === 'tv_series' ? (p.episodesPerSeason ?? 10) : undefined,
    expectActOuts: actStructure === 'teaser_plus_4_act' || actCount >= 4,
  }
}

function composeConventions(p: ParsedFormatSpec): FormatConfig['conventions'] {
  return {
    multiCam: p.conventions.multiCam,
    underlineSceneHeadings: p.conventions.multiCam,
    castListAfterSlug: p.conventions.multiCam,
    underlineCharacterFirstIntro: p.conventions.multiCam,
    sfxBolded: p.conventions.multiCam,
    sceneNumbersAsLetters: p.conventions.multiCam,
    portraitFrame: p.formatClass === 'vertical',
    requireCliffhangerPerEpisode: p.formatClass === 'vertical',
    requireRiseSpikeDropCliff: p.formatClass === 'vertical',
    revisionColorsEnabled: true,
  }
}

function composeSubstanceThresholds(
  p: ParsedFormatSpec,
): FormatConfig['substanceThresholds'] {
  if (p.formatClass === 'vertical') {
    return {
      minBeatsPerAct: 4,
      minScenePerAct: 4,
      maxFillerPercent: 0,
      minTurnsPerScene: 1,
      minActiveProtagonistChoicesPerAct: 1,
    }
  }
  if (p.runtime && p.runtime.minutes <= 5) {
    return {
      minBeatsPerAct: 2,
      minScenePerAct: 2,
      maxFillerPercent: 2,
      minTurnsPerScene: 1,
      minActiveProtagonistChoicesPerAct: 1,
    }
  }
  return {
    minBeatsPerAct: 4,
    minScenePerAct: 5,
    maxFillerPercent: 5,
    minTurnsPerScene: 1,
    minActiveProtagonistChoicesPerAct: 2,
  }
}

/**
 * Substance targets for a custom format. Scales beat / scene counts off
 * the inferred page target using rule-of-thumb ratios:
 *   - ~1 beat per 3 pages (Kroll: 40 beats / 110 pages ≈ 0.36)
 *   - ~1 scene per 1.5 pages
 *   - 700 synopsis words per 30 script minutes (~30 pages)
 *
 * Vertical and very-short formats override to their own conventions.
 */
function composeSubstanceTargets(
  p: ParsedFormatSpec,
  pages: { min: number; max: number },
): FormatConfig['substanceTargets'] {
  if (p.formatClass === 'vertical') {
    return PRESETS.vertical.substanceTargets
  }
  const targetPages = Math.round((pages.min + pages.max) / 2)

  // Sketch / very-short format.
  if (p.runtime && p.runtime.minutes <= 5) {
    return {
      beats:           { min: 6,  ideal: 8,  max: 12 },
      scenes:          { min: 5,  ideal: 8,  max: 12 },
      subplots:        { min: 1,  ideal: 2,  max: 3 },
      majorReveals:    { min: 1,  ideal: 2,  max: 3 },
      setupsPayoffs:   { min: 1,  ideal: 2,  max: 4 },
      longSynopsisWords: { min: 150, ideal: 250, max: 400 },
      namedCharacters: { min: 2,  ideal: 3,  max: 5 },
      subplotLabels: [
        { letter: 'A', conventionalRole: 'main thread' },
        { letter: 'B', conventionalRole: 'runner or counter-thread' },
      ],
    }
  }

  // General compute. Round up; we want density, not thinness.
  const idealBeats = Math.max(12, Math.ceil(targetPages / 2.8))
  const idealScenes = Math.max(14, Math.ceil(targetPages / 1.5))
  const isFeatureLike = targetPages >= 70
  const idealSubplots = isFeatureLike ? 4 : 3
  const idealReveals = Math.max(3, Math.round(idealBeats / 6))
  const idealSetups = Math.max(5, Math.round(idealBeats / 3.5))
  const synopsisIdeal = Math.max(350, Math.round(targetPages * 9))

  return {
    beats: {
      min: Math.max(10, Math.round(idealBeats * 0.85)),
      ideal: idealBeats,
      max: Math.round(idealBeats * 1.25),
    },
    scenes: {
      min: Math.max(12, Math.round(idealScenes * 0.8)),
      ideal: idealScenes,
      max: Math.round(idealScenes * 1.25),
    },
    subplots: {
      min: Math.max(2, idealSubplots - 1),
      ideal: idealSubplots,
      max: idealSubplots + 1,
    },
    majorReveals: {
      min: Math.max(2, idealReveals - 1),
      ideal: idealReveals,
      max: idealReveals + 3,
    },
    setupsPayoffs: {
      min: Math.max(3, idealSetups - 2),
      ideal: idealSetups,
      max: idealSetups + 4,
    },
    longSynopsisWords: {
      min: Math.round(synopsisIdeal * 0.75),
      ideal: synopsisIdeal,
      max: Math.round(synopsisIdeal * 1.4),
    },
    namedCharacters: {
      min: isFeatureLike ? 5 : 4,
      ideal: isFeatureLike ? 8 : 6,
      max: isFeatureLike ? 12 : 9,
    },
    subplotLabels: isFeatureLike
      ? [
          { letter: 'A', conventionalRole: 'main external plot' },
          { letter: 'B', conventionalRole: 'relational / theme spine' },
          { letter: 'C', conventionalRole: 'antagonist or strong supporting arc' },
          { letter: 'D', conventionalRole: 'thematic runner' },
        ]
      : [
          { letter: 'A', conventionalRole: 'main plot' },
          { letter: 'B', conventionalRole: 'secondary character storyline' },
          { letter: 'C', conventionalRole: 'runner or ensemble bit' },
        ],
  }
}

function pickDerivedFrom(p: ParsedFormatSpec): FormatKind[] {
  if (p.formatClass === 'vertical') return ['vertical']
  if (p.medium === 'animation') return ['animation_2d']
  if (p.conventions.multiCam) return ['tv_30min_comedy_multi_cam']
  if (p.formatClass === 'tv_series' && p.runtime && p.runtime.minutes <= 30) {
    return ['tv_30min_comedy_single_cam']
  }
  if (p.formatClass === 'tv_series') return ['tv_1hr_drama']
  if (p.formatClass === 'feature') {
    return p.genres.includes('comedy') ? ['feature_comedy'] : ['feature_drama']
  }
  return ['feature_drama']
}

function detectAmbiguities(p: ParsedFormatSpec): Ambiguity[] {
  const out: Ambiguity[] = []
  if (p.audience === 'unspecified' && p.medium === 'animation') {
    out.push({
      id: 'animation_audience',
      question: 'Who is the intended audience for this animated project?',
      defaultAssumption: 'Family / family-adult crossover (the default for animation comedy)',
      options: ['Kids', 'Family', 'Teen', 'Adult', 'Mature'],
    })
  }
  if (p.formatClass === 'unknown' && !p.runtime) {
    out.push({
      id: 'format_class',
      question: 'Is this a feature film, a TV series, or something else?',
      defaultAssumption: 'Feature film (defaulted from genre + tone cues)',
      options: ['Feature', 'TV Series', 'Mini-series', 'Short', 'Vertical', 'Anthology'],
    })
  }
  if (p.genres.length === 0) {
    out.push({
      id: 'genre',
      question: 'What is the primary genre?',
      defaultAssumption: 'Drama (used as the safe default).',
      options: ['Drama', 'Comedy', 'Thriller', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Fantasy', 'Action'],
    })
  }
  return out
}

function composeSummary(c: FormatConfig, p: ParsedFormatSpec): string {
  const parts: string[] = []
  parts.push(c.label)
  if (p.runtime) {
    parts.push(`${p.runtime.minutes} ${p.runtime.minutes === 1 ? 'minute' : 'minutes'}${p.runtime.scope === 'per_episode' ? ' per episode' : ' total'}`)
  }
  if (c.structure.actStructure !== 'episode_cycles' && c.structure.actStructure !== 'actless') {
    parts.push(`${c.structure.targetActs} act${c.structure.targetActs === 1 ? '' : 's'}${c.structure.coldOpen ? ' + cold open' : ''}${c.structure.teaser ? ' + teaser' : ''}${c.structure.tag ? ' + tag' : ''}`)
  }
  if (c.structure.actStructure === 'episode_cycles') {
    parts.push(`${c.structure.episodesPerSeason} episodes in ${c.structure.cyclesPerSeason} cycles`)
  }
  parts.push(`${c.structure.targetPagesMin}-${c.structure.targetPagesMax} pages`)
  if (c.genres.length) parts.push(c.genres.join(' / '))
  parts.push(`audience: ${c.audience}`)
  return parts.join(' · ')
}

export function interpretFormat(input: string): FormatInterpretation {
  const parsed = parseFormatSpec(input)

  // If the input is an empty string, default to a Feature Drama.
  if (!input.trim()) {
    return {
      config: PRESETS.feature_drama,
      parsed,
      ambiguities: [],
      derivedFrom: ['feature_drama'],
      summary: composeSummary(PRESETS.feature_drama, parsed),
    }
  }

  // Compose.
  const pages = composePagesTargetFromRuntime(parsed)
  const config: FormatConfig = {
    kind: 'custom',
    label: input.length <= 80 ? input : 'Custom Format',
    description: input,
    medium: composeMedium(parsed),
    page: composePagePresetByConventions(parsed),
    structure: composeStructure(parsed, pages),
    conventions: composeConventions(parsed),
    genres: composeGenres(parsed),
    tone: parsed.tone,
    audience: composeAudience(parsed),
    pacing: composePacing(parsed),
    substanceThresholds: composeSubstanceThresholds(parsed),
    substanceTargets: composeSubstanceTargets(parsed, pages),
    humanization: composeHumanization(parsed),
    verticalSandbox: parsed.formatClass === 'vertical',
  }

  return {
    config,
    parsed,
    ambiguities: detectAmbiguities(parsed),
    derivedFrom: pickDerivedFrom(parsed),
    summary: composeSummary(config, parsed),
  }
}
