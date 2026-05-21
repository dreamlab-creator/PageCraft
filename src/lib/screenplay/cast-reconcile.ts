/**
 * Cast Reconciler — keeps the Characters Bible and the screenplay in sync.
 *
 * Two-way audit:
 *   1. Names that appear in the script as character cues but have no entry
 *      in the bible. These are the most actionable: the writer (or AI) just
 *      introduced someone new. They should be auto-adopted as a stub.
 *
 *   2. Names that exist in the bible but never appear in the script. Those
 *      may simply be "planned but not yet introduced" — we don't delete
 *      them, we just surface them.
 *
 *   3. Case / spelling conflicts: the bible has "MAYA RIVERS", the script
 *      has cues for "MAYA" and "MAYA RIVERS" both. The reconciler flags
 *      these so the writer can resolve which is canonical.
 *
 * This module is pure — no React, no store. It just computes a report.
 * `auto-adopt.ts` does the mutation.
 */

import type { Character, CharacterId, Project } from '@/types'
import { newId, blankCharacterState, blankVoiceFingerprint } from '@/types'
import {
  canonicalName,
  cleanCueName,
  detectNames,
  type NameObservation,
} from '@/lib/screenplay/character-detect'

export interface ScriptOnlyName {
  /** Canonical (uppercase, trimmed) name. */
  name: string
  /** The original cue text — preserved as-is so we can use it as the stub's name. */
  displayName: string
  /** Where it first appeared. */
  firstObservation: NameObservation
  /** How many times it appears as a cue. */
  cueCount: number
  /** Whether it was introduced in ALL CAPS in an action line. */
  introducedInAction: boolean
}

export interface BibleOnlyCharacter {
  characterId: CharacterId
  name: string
}

export interface CaseConflict {
  /** The set of distinct surface forms found, e.g., ["MAYA", "MAYA RIVERS"]. */
  surfaceForms: string[]
  /** The canonical form chosen by the reconciler. */
  canonical: string
  /** Character ids in the bible that match (case-insensitively) any surface form. */
  bibleMatches: CharacterId[]
}

export interface CastReconcileReport {
  /** Names in the script with no bible entry — candidates for auto-adoption. */
  scriptOnly: ScriptOnlyName[]
  /** Bible entries that never appear in the script (after a soft warmup). */
  bibleOnly: BibleOnlyCharacter[]
  /** Names with multiple surface forms across script/bible. */
  caseConflicts: CaseConflict[]
}

/**
 * Compute the full reconciliation report against a project.
 *
 * @param pageOf  optional map from element id → page number for ordering.
 */
export function reconcileCast(
  project: Project,
  pageOf?: Map<string, number>,
): CastReconcileReport {
  const observations = detectNames(project.screenplay.elements, pageOf)

  // Group cue observations by canonical name (cues are authoritative).
  const cueByCanonical = new Map<string, NameObservation[]>()
  const introByCanonical = new Map<string, NameObservation>()
  for (const o of observations) {
    const c = canonicalName(o.name)
    if (!c) continue
    if (o.source === 'cue') {
      const arr = cueByCanonical.get(c) ?? []
      arr.push(o)
      cueByCanonical.set(c, arr)
    } else if (o.source === 'action_intro' && !introByCanonical.has(c)) {
      introByCanonical.set(c, o)
    }
  }

  // Index the bible by canonical name AND by every first-name alias the
  // characters' names produce. "MAYA RIVERS" generates an alias "MAYA" so
  // a cue typed as just "MAYA" matches the full bible entry.
  //
  // This is the industry convention: a character is introduced with their
  // full name, then referred to by first name afterward. The cue "MAYA"
  // and the bible entry "MAYA RIVERS" describe the SAME person — they are
  // not a conflict and should not flag anywhere.
  const bibleByCanonical = new Map<string, Character>()
  const bibleByAlias = new Map<string, Character>()
  for (const ch of project.characters) {
    const key = canonicalName(ch.name)
    if (!key) continue
    bibleByCanonical.set(key, ch)
    // Index every first-name / last-name slice so cues like "MAYA" or
    // "RIVERS" both resolve to "MAYA RIVERS".
    for (const alias of aliasesForBibleName(key)) {
      // First registration wins (so the writer can't accidentally hijack
      // an alias with a later character).
      if (!bibleByAlias.has(alias)) bibleByAlias.set(alias, ch)
    }
  }

  /** Resolve a cue's canonical name against the bible (exact OR alias). */
  const lookupCharacter = (canon: string): Character | null => {
    return bibleByCanonical.get(canon) ?? bibleByAlias.get(canon) ?? null
  }

  // --- Script-only names: cues that don't match ANY bible entry ----------
  const scriptOnly: ScriptOnlyName[] = []
  for (const [canon, cues] of cueByCanonical.entries()) {
    if (lookupCharacter(canon)) continue // matched by exact or first/last-name alias
    const first = cues[0]
    const intro = introByCanonical.get(canon)
    const elText = project.screenplay.elements.find(e => e.id === first.elementId)?.text ?? canon
    const displayName = cleanCueName(elText) || canon
    scriptOnly.push({
      name: canon,
      displayName: displayName.toUpperCase(),
      firstObservation: intro ?? first,
      cueCount: cues.length,
      introducedInAction: !!intro,
    })
  }

  // --- Bible-only characters: planned but not yet on the page -----------
  // A bible character is "on the page" if their full canonical name OR any
  // of their aliases (first/last names) appears as a cue.
  const cuedCharacterIds = new Set<string>()
  for (const canon of cueByCanonical.keys()) {
    const ch = lookupCharacter(canon)
    if (ch) cuedCharacterIds.add(ch.id)
  }
  const bibleOnly: BibleOnlyCharacter[] = []
  for (const ch of project.characters) {
    if (cuedCharacterIds.has(ch.id)) continue
    if (cueByCanonical.size === 0) continue // empty script — skip noise
    if (/^NEW CHARACTER$/i.test(ch.name)) continue
    bibleOnly.push({ characterId: ch.id, name: ch.name })
  }

  // --- Case conflicts -----------------------------------------------------
  // The previous heuristic flagged "MAYA" vs "MAYA RIVERS" as a conflict.
  // That's the OPPOSITE of correct: it's the screenwriting convention. We
  // now only flag conflicts that look like genuine misspellings — two
  // different canonical names that share a meaningful prefix BUT are NOT
  // a strict first-name / last-name relationship of a known bible entry.
  const caseConflicts: CaseConflict[] = []
  const allCanon = new Set<string>([
    ...cueByCanonical.keys(),
    ...bibleByCanonical.keys(),
  ])
  // Group cues whose first letters match (potential typos), but skip
  // every pair we can already explain via the bible's alias table.
  const considered: string[][] = []
  const seen = new Set<string>()
  for (const a of allCanon) {
    if (seen.has(a)) continue
    const group = [a]
    for (const b of allCanon) {
      if (a === b || seen.has(b)) continue
      // Skip pairs that share a known bible entry via alias matching.
      const charA = lookupCharacter(a)
      const charB = lookupCharacter(b)
      if (charA && charB && charA.id === charB.id) continue
      // Skip strict prefix relationships (one name is the other's first word).
      if (isPrefixOf(a, b) || isPrefixOf(b, a)) continue
      // Skip pairs where they share their first 3+ letters but are clearly
      // distinct names (e.g., "MAYA" vs "MARIA" — could be a typo).
      if (closeStringMatch(a, b)) {
        group.push(b)
        seen.add(b)
      }
    }
    if (group.length > 1) {
      considered.push(group)
      seen.add(a)
    }
  }
  for (const group of considered) {
    const sorted = [...group].sort((a, b) => b.length - a.length)
    const canonical = sorted[0]
    const bibleMatches = group
      .map(f => bibleByCanonical.get(f)?.id)
      .filter((id): id is CharacterId => !!id)
    caseConflicts.push({ surfaceForms: sorted, canonical, bibleMatches })
  }

  return { scriptOnly, bibleOnly, caseConflicts }
}

/**
 * Generate the list of valid aliases for a bible character's canonical
 * name. For "MAYA RIVERS", returns ["MAYA", "RIVERS"]. For single-word
 * names like "MAYA", returns []. Two-part names cover the most common
 * screenwriting case (first/last); deeper names (titles, suffixes) are
 * ignored intentionally to keep matches conservative.
 */
function aliasesForBibleName(canonical: string): string[] {
  const parts = canonical.split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return []
  // Take the first part (first name) and the last part (last name).
  const first = parts[0]
  const last = parts[parts.length - 1]
  const out = new Set<string>()
  if (first && first !== canonical) out.add(first)
  if (last && last !== canonical && last !== first) out.add(last)
  return Array.from(out)
}

/** True if `short` is the leading word of `long`. */
function isPrefixOf(short: string, long: string): boolean {
  if (short === long) return false
  const parts = long.split(/\s+/)
  return parts[0] === short
}

/**
 * Detect strings that are close enough to LOOK like a typo of each other
 * (shared 3+ leading letters AND Levenshtein distance ≤ 2 across the
 * full strings). Conservative — we'd rather miss a real typo than flag
 * a legitimate distinct name.
 */
function closeStringMatch(a: string, b: string): boolean {
  if (a === b) return false
  // Must share at least 3 leading letters.
  const prefix = sharedPrefixLength(a, b)
  if (prefix < 3) return false
  // Must be roughly the same length AND short enough that the prefix
  // covers most of the string.
  if (Math.abs(a.length - b.length) > 3) return false
  return levenshtein(a, b) <= 2
}

function sharedPrefixLength(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const prev = new Array(b.length + 1).fill(0)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    let last = i
    for (let j = 1; j <= b.length; j++) {
      const ins = prev[j] + 1
      const del = last + 1
      const sub = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      const next = Math.min(ins, del, sub)
      prev[j - 1] = last
      last = next
    }
    prev[b.length] = last
  }
  return prev[b.length]
}

/**
 * Build a stub character record from a script-only observation.
 *
 * The stub is intentionally lean: just the name, a default role, and
 * provenance/needsReview flags. The reconciler does not invent biography,
 * arc, or voice — that's for the writer (or a follow-up AI pass).
 */
export function buildStubCharacter(o: ScriptOnlyName, opts?: { provenance?: Character['provenance'] }): Character {
  return {
    id: newId<CharacterId>(),
    name: o.displayName,
    age: '',
    shortDescription: '',
    biography: '',
    role: 'minor',
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
    introduced: o.introducedInAction,
    introducedAtPage: o.firstObservation.page,
    firstSeenAtPage: o.firstObservation.page,
    lockedFields: [],
    provenance: opts?.provenance ?? 'auto_script',
    needsReview: true,
  }
}

/**
 * Total count of "things the writer should know about" across the report.
 * Useful for the sidebar badge.
 */
export function reportSeverityCount(r: CastReconcileReport): number {
  return r.scriptOnly.length + r.bibleOnly.length + r.caseConflicts.length
}
