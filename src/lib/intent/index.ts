/**
 * Intent Router.
 *
 * Classifies a free-text user request as one of the canonical intent kinds
 * (generate, modify, diagnose, extract, configure, ask). For Modify intents,
 * also extracts the transform/preserve axes from natural language.
 *
 * This is the same Intent Router referenced in the design docs. It runs on
 * every command-palette input and on every chat message in the writing/planning
 * sidebars.
 */

export type IntentKind = 'generate' | 'modify' | 'diagnose' | 'extract' | 'configure' | 'ask'

export interface TransformSpec {
  axis: TransformAxis
  to: string
}

export type TransformAxis =
  | 'setting'
  | 'era'
  | 'genre'
  | 'tone'
  | 'characters'
  | 'format'
  | 'length'
  | 'pov'
  | 'voice'
  | 'rating'
  | 'cultural'
  | 'visual'
  | 'theme'
  | 'language'

export interface PreserveSpec {
  axis: PreserveAxis
}

export type PreserveAxis =
  | 'plot'
  | 'structure'
  | 'relationships'
  | 'beats'
  | 'character_functions'
  | 'theme'
  | 'arcs'
  | 'scene_order'

export interface IntentClassification {
  intent: IntentKind
  source: { kind: 'project' | 'reference' | 'selection' | 'scene' | 'beat' | 'character' }
  transform: TransformSpec[]
  preserve: PreserveSpec[]
  raw: string
}

/* ============================================================================
 * Classification
 * ========================================================================= */

const MODIFY_VERBS = [
  'set in', 'set during', 'set against', 'place in',
  'rewrite as', 'rewrite in', 'rewrite from', 'rewrite the',
  'change', 'swap', 'replace', 'shift', 'convert to', 'turn into',
  'make it', 'compress', 'expand', 'lean into', 'lean harder',
  'in the style of', 'in the voice of', 'in the cadence of',
  'from the pov of', "from the perspective of", 'from the villain',
  'translate', 'darken', 'lighten',
]

const DIAGNOSE_PHRASES = [
  'check', 'review', 'diagnose', 'analyze', 'analyse', 'find weak', 'where is the',
  'is the protagonist', 'are we paying off', 'what\'s wrong with',
]

const EXTRACT_PHRASES = [
  'pull out', 'extract', 'pull the characters', 'list the beats',
]

const ASK_PHRASES = [
  'what is', 'how does', 'how do i', 'why does', 'when should', 'should i',
]

/** Coarse classification. Falls back to 'generate' for new content requests. */
export function classifyIntent(input: string): IntentKind {
  const l = input.toLowerCase()
  if (MODIFY_VERBS.some(v => l.includes(v))) return 'modify'
  if (DIAGNOSE_PHRASES.some(v => l.startsWith(v))) return 'diagnose'
  if (EXTRACT_PHRASES.some(v => l.includes(v))) return 'extract'
  if (ASK_PHRASES.some(v => l.startsWith(v))) return 'ask'
  if (l.startsWith('set ') || l.startsWith('settings')) return 'configure'
  return 'generate'
}

/** Identify transform axes mentioned in a modify request. */
function detectTransforms(input: string): TransformSpec[] {
  const out: TransformSpec[] = []
  const l = input.toLowerCase()

  // Setting / era.
  const setRx = /\b(set (in|during|against)|in)\b ([^,.;]+?(?: war| period| era|s\b|france|paris|tokyo|harlem|berlin|moscow|london|rome|nyc|new york))/i
  const setM = input.match(setRx)
  if (setM) out.push({ axis: 'setting', to: setM[3].trim() })

  // Genre rewrite.
  if (/\brewrite as\b/i.test(l)) {
    const m = input.match(/\brewrite as\b ([a-z- ]+)/i)
    if (m) out.push({ axis: 'genre', to: m[1].trim() })
  }

  // Tone (make it X).
  const makeIt = input.match(/\bmake it (more )?([a-z]+)\b/i)
  if (makeIt) out.push({ axis: 'tone', to: makeIt[2] })

  // Length.
  if (/\bcompress\b/i.test(l)) out.push({ axis: 'length', to: 'shorter' })
  if (/\bexpand\b/i.test(l)) out.push({ axis: 'length', to: 'longer' })
  const pageM = input.match(/(\d+)[- ]?(page|pages|min|minutes)/i)
  if (pageM) out.push({ axis: 'length', to: `${pageM[1]} ${pageM[2]}` })

  // POV.
  if (/from (the )?(pov|perspective) of/i.test(l)) {
    const m = input.match(/from (?:the )?(?:pov|perspective) of\s+([a-z' ]+)/i)
    if (m) out.push({ axis: 'pov', to: m[1].trim() })
  }

  // Voice / cadence.
  const styleM = input.match(/in the (style|voice|cadence) of\s+([^,.;]+)/i)
  if (styleM) out.push({ axis: 'voice', to: styleM[2].trim() })

  // Format.
  if (/\bconvert to\b/i.test(l) || /\bturn into\b/i.test(l)) {
    const m = input.match(/\b(?:convert to|turn into)\b\s+([^,.;]+)/i)
    if (m) out.push({ axis: 'format', to: m[1].trim() })
  }

  return out
}

/** Default preserve axes for any Modify with at least one transform. */
function defaultPreserves(transforms: TransformSpec[]): PreserveSpec[] {
  if (transforms.length === 0) return []
  return [
    { axis: 'plot' },
    { axis: 'beats' },
    { axis: 'relationships' },
    { axis: 'character_functions' },
    { axis: 'theme' },
    { axis: 'arcs' },
  ]
}

/** Coarse source resolution from text cues. */
function detectSource(
  input: string,
  ctx: { hasProject?: boolean; hasReference?: boolean },
): IntentClassification['source'] {
  const l = input.toLowerCase()
  if (/\bthis scene\b/.test(l)) return { kind: 'scene' }
  if (/\bthis beat\b/.test(l)) return { kind: 'beat' }
  if (/\bthis character\b/.test(l)) return { kind: 'character' }
  if (/\bthis selection\b/.test(l) || /\bhighlighted\b/.test(l)) return { kind: 'selection' }
  if (/\bthe reference\b|\bref(?:erence)? #\d+\b|\buploaded\b/.test(l) && ctx.hasReference) return { kind: 'reference' }
  if (ctx.hasProject) return { kind: 'project' }
  return { kind: 'project' }
}

export function interpretIntent(
  input: string,
  ctx: { hasProject?: boolean; hasReference?: boolean },
): IntentClassification {
  const intent = classifyIntent(input)
  const transform = intent === 'modify' ? detectTransforms(input) : []
  const preserve = intent === 'modify' ? defaultPreserves(transform) : []
  const source = detectSource(input, ctx)
  return { intent, source, transform, preserve, raw: input }
}
