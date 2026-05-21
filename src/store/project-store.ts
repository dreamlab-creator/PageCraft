/**
 * Project Store — the live state for the currently open project.
 *
 * Loads/saves to IndexedDB via the storage layer. Debounced autosave keeps
 * the persisted copy in sync. The UI subscribes to slices of this store.
 */

import { create } from 'zustand'
import type {
  Project,
  ProjectId,
  ScreenplayElement,
  Character,
  Beat,
  SceneCard,
  Reference,
  ScriptNote,
  Location,
  ElementId,
  CharacterId,
  SeriesEpisode,
  SeasonArc,
} from '@/types'
import { newId } from '@/types'
import { saveProject, loadProject as loadFromDb } from '@/lib/storage'
import { stripEmDashes } from '@/lib/humanization'
import {
  reconcileCast,
  buildStubCharacter,
  type CastReconcileReport,
  canonicalName,
} from '@/lib/screenplay'

interface ProjectStore {
  project: Project | null
  /** Last autosave timestamp. */
  lastAutosave: number
  /** Whether the project has unsaved changes since last autosave. */
  dirty: boolean

  // ---- Undo / Redo -------------------------------------------------------
  /** Stack of previous project snapshots (oldest at index 0). */
  past: Project[]
  /** Stack of future project snapshots after an undo (newest at index 0). */
  future: Project[]
  /** Whether undo / redo are currently available. UI subscribes to these. */
  canUndo: () => boolean
  canRedo: () => boolean
  undo: () => void
  redo: () => void

  // ---- Lifecycle ---------------------------------------------------------
  setProject: (p: Project) => void
  load: (id: ProjectId) => Promise<void>
  clear: () => void
  saveNow: () => Promise<void>

  // ---- Mutations: top-level ---------------------------------------------
  setTitle: (title: string) => void
  setAuthor: (author: string) => void
  patchPlanning: (patch: Partial<Project['planning']>) => void
  patchSettings: (patch: Partial<Project['settings']>) => void

  // ---- Mutations: screenplay --------------------------------------------
  setElements: (elements: ScreenplayElement[]) => void
  updateElement: (id: ElementId, patch: Partial<ScreenplayElement>) => void
  insertElement: (after: ElementId | null, el: ScreenplayElement) => void
  /**
   * Insert a batch of elements after `after`. If `after` is null, the
   * batch is appended at the end. If `replace` is true, the `after`
   * element itself is removed and replaced by the batch (used by
   * "expand to scene" which replaces the source one-liner with its
   * played-out version).
   */
  insertElementsAfter: (after: ElementId | null, batch: ScreenplayElement[], replace?: boolean) => void
  removeElement: (id: ElementId) => void
  /**
   * Remove an entire scene: the scene heading at `headingId` plus every
   * subsequent element until the next scene heading (or end of document).
   * Also drops any linked SceneCard whose `startElementId` matched the
   * heading, since the screenplay no longer contains its anchor.
   */
  removeScene: (headingId: ElementId) => void
  reorderElements: (newOrder: ElementId[]) => void

  // ---- Mutations: characters --------------------------------------------
  upsertCharacter: (c: Character) => void
  removeCharacter: (id: CharacterId) => void

  // ---- Cast reconciliation ----------------------------------------------
  /**
   * Compute the current incongruency report between screenplay and bible.
   * Pure — does not mutate the store.
   */
  castReport: () => CastReconcileReport | null
  /**
   * Adopt every script-only name from the report as a stub character. Used
   * by the live editor reconciler and by AI scene acceptance.
   *
   * @param provenance  who created these (defaults to 'auto_script').
   * @param onlyNames   if provided, only adopt these canonical names. Used
   *                    when the user clicks "Add to bible" on a specific row.
   */
  adoptScriptCharacters: (
    provenance?: Character['provenance'],
    onlyNames?: string[],
  ) => Character[]
  /**
   * Mark an auto-adopted character as user-reviewed (clears `needsReview`).
   */
  reviewCharacter: (id: CharacterId) => void

  // ---- Mutations: beats / scenes ----------------------------------------
  upsertBeat: (b: Beat) => void
  removeBeat: (id: string) => void
  upsertSceneCard: (s: SceneCard) => void
  removeSceneCard: (id: string) => void
  /**
   * Insert one or more scene cards in story order. Each card's `order`
   * must already be set to its intended slot; later cards' `order` is
   * shifted up by the insertion count so the sequence stays contiguous.
   */
  insertSceneCards: (cards: SceneCard[]) => void

  // ---- Mutations: references --------------------------------------------
  addReference: (r: Reference) => void
  updateReference: (id: string, patch: Partial<Reference>) => void
  removeReference: (id: string) => void

  // ---- Series (show-bible) ----------------------------------------------
  /** Partial patch of the seriesPlan object. */
  patchSeriesPlan: (patch: Partial<NonNullable<Project['planning']['seriesPlan']>>) => void
  /** Insert or update an episode by id. */
  upsertEpisode: (ep: SeriesEpisode) => void
  /** Remove an episode by id. */
  removeEpisode: (id: string) => void
  /**
   * Patch arbitrary fields on the currently-active episode (the one the
   * Overview tab is editing). No-op if there is no series plan or no
   * active episode.
   */
  patchActiveEpisode: (patch: Partial<SeriesEpisode>) => void
  /** Set the active episode for the Overview / Beats / Scenes / Writing scope. */
  setActiveEpisode: (id: string | undefined) => void
  /** Insert or update a season arc by id. */
  upsertSeasonArc: (arc: SeasonArc) => void
  /** Remove a season arc by id. */
  removeSeasonArc: (id: string) => void

  // ---- Notes & locations -------------------------------------------------
  upsertNote: (n: ScriptNote) => void
  removeNote: (id: string) => void
  upsertLocation: (l: Location) => void
  removeLocation: (id: string) => void
}

const markDirty = (set: any) => set({ dirty: true })

let autosaveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleAutosave(get: () => ProjectStore, set: any) {
  if (autosaveTimer) clearTimeout(autosaveTimer)
  const interval = get().project?.settings.autosaveIntervalMs ?? 2000
  autosaveTimer = setTimeout(async () => {
    const proj = get().project
    if (!proj) return
    await saveProject(proj)
    set({ lastAutosave: Date.now(), dirty: false })
  }, interval)
}

/* ----- Undo history ----------------------------------------------------- */
/** Maximum number of past snapshots we keep. ~120 is enough for most
 *  writing sessions without blowing memory: a typical Project blob is
 *  a few hundred KB JSON, so even 120 deep copies stay well under
 *  ~50 MB. We deep-clone on push since the live `project` is mutated by
 *  reference in some places via `{ ...p, ... }` spreads. */
const HISTORY_LIMIT = 120

/**
 * Take a deep snapshot of the project for the undo stack. JSON
 * stringify+parse is the simplest reliable structural clone for this
 * shape (no functions, no Dates that need preserving, no Map/Set).
 */
function snapshot(p: Project | null): Project | null {
  return p ? (JSON.parse(JSON.stringify(p)) as Project) : null
}

/**
 * Coalesce-aware history push. Most mutations push a new snapshot. But
 * rapid contiguous keystroke edits (typing into a contenteditable) call
 * `updateElement` once per character — we don't want to fill the undo
 * stack with one entry per keystroke. So `pushHistory` accepts a
 * `coalesceKey` argument; if the previous push had the SAME key and was
 * < 600 ms ago, we skip recording a new snapshot and just keep the
 * earlier one. Cmd+Z then rewinds to that pre-typing state in one shot.
 */
let lastPushKey: string | null = null
let lastPushTime = 0
const COALESCE_WINDOW_MS = 600
function pushHistory(
  set: any,
  get: () => ProjectStore,
  coalesceKey: string | null,
) {
  const p = get().project
  if (!p) return
  const now = Date.now()
  const coalesce =
    coalesceKey != null
    && coalesceKey === lastPushKey
    && now - lastPushTime < COALESCE_WINDOW_MS
  lastPushKey = coalesceKey
  lastPushTime = now
  if (coalesce) return
  const snap = snapshot(p)!
  const { past } = get()
  const nextPast = past.length >= HISTORY_LIMIT
    ? [...past.slice(past.length - HISTORY_LIMIT + 1), snap]
    : [...past, snap]
  // Any new edit invalidates the redo stack — standard undo/redo
  // semantics in every editor.
  set({ past: nextPast, future: [] })
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  lastAutosave: 0,
  dirty: false,
  past: [],
  future: [],

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  undo: () => {
    const { past, future, project } = get()
    if (past.length === 0 || !project) return
    const prev = past[past.length - 1]
    set({
      project: prev,
      past: past.slice(0, -1),
      future: [snapshot(project)!, ...future],
    })
    // Reset coalesce window so the next typing burst starts a fresh entry.
    lastPushKey = null
    lastPushTime = 0
    markDirty(set); scheduleAutosave(get, set)
  },
  redo: () => {
    const { past, future, project } = get()
    if (future.length === 0 || !project) return
    const next = future[0]
    set({
      project: next,
      past: [...past, snapshot(project)!],
      future: future.slice(1),
    })
    lastPushKey = null
    lastPushTime = 0
    markDirty(set); scheduleAutosave(get, set)
  },

  setProject: (p) => {
    // Loading or creating a new project resets the undo stack — you
    // can't undo INTO a previous project.
    set({ project: p, dirty: true, past: [], future: [] })
    scheduleAutosave(get, set)
  },
  load: async (id) => {
    const p = await loadFromDb(id)
    if (p) set({ project: p, lastAutosave: Date.now(), dirty: false, past: [], future: [] })
  },
  clear: () => set({ project: null, dirty: false, past: [], future: [] }),
  saveNow: async () => {
    const p = get().project
    if (!p) return
    await saveProject(p)
    set({ lastAutosave: Date.now(), dirty: false })
  },

  setTitle: (title) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, 'setTitle')
    set({
      project: {
        ...p,
        title: stripEmDashes(title, 'title'),
        screenplay: { ...p.screenplay, titlePage: { ...p.screenplay.titlePage, title: stripEmDashes(title, 'title') } },
      },
    })
    markDirty(set); scheduleAutosave(get, set)
  },
  setAuthor: (author) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, 'setAuthor')
    set({ project: { ...p, author: stripEmDashes(author, 'title') } })
    markDirty(set); scheduleAutosave(get, set)
  },

  patchPlanning: (patch) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, 'patchPlanning')
    const safe = sanitizePatch(patch)
    set({ project: { ...p, planning: { ...p.planning, ...safe } } })
    markDirty(set); scheduleAutosave(get, set)
  },
  patchSettings: (patch) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, 'patchSettings')
    set({ project: { ...p, settings: { ...p.settings, ...patch } } })
    markDirty(set); scheduleAutosave(get, set)
  },

  setElements: (elements) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, null)
    set({ project: { ...p, screenplay: { ...p.screenplay, elements } } })
    markDirty(set); scheduleAutosave(get, set)
  },
  updateElement: (id, patch) => {
    const p = get().project
    if (!p) return
    // Coalesce by element id so a burst of keystrokes on the same block
    // collapses into a single undoable entry. Different block, different
    // key — the coalesce window resets.
    pushHistory(set, get, `updateElement:${id}`)
    const elements = p.screenplay.elements.map(e =>
      e.id === id ? sanitizeElement({ ...e, ...patch }) : e,
    )
    set({ project: { ...p, screenplay: { ...p.screenplay, elements } } })
    markDirty(set); scheduleAutosave(get, set)
  },
  insertElement: (after, el) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, null)
    const safe = sanitizeElement(el)
    const elements = [...p.screenplay.elements]
    const idx = after ? elements.findIndex(e => e.id === after) + 1 : elements.length
    elements.splice(idx, 0, safe)
    set({ project: { ...p, screenplay: { ...p.screenplay, elements } } })
    markDirty(set); scheduleAutosave(get, set)
  },
  insertElementsAfter: (after, batch, replace) => {
    const p = get().project
    if (!p || batch.length === 0) return
    pushHistory(set, get, null)
    const safeBatch = batch.map(sanitizeElement)
    const elements = [...p.screenplay.elements]
    if (after == null) {
      elements.push(...safeBatch)
    } else {
      const idx = elements.findIndex(e => e.id === after)
      if (idx < 0) {
        elements.push(...safeBatch)
      } else if (replace) {
        elements.splice(idx, 1, ...safeBatch)
      } else {
        elements.splice(idx + 1, 0, ...safeBatch)
      }
    }
    set({ project: { ...p, screenplay: { ...p.screenplay, elements } } })
    markDirty(set); scheduleAutosave(get, set)
  },
  removeElement: (id) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, null)
    set({
      project: {
        ...p,
        screenplay: { ...p.screenplay, elements: p.screenplay.elements.filter(e => e.id !== id) },
      },
    })
    markDirty(set); scheduleAutosave(get, set)
  },
  removeScene: (headingId) => {
    const p = get().project
    if (!p) return
    const els = p.screenplay.elements
    const startIdx = els.findIndex(e => e.id === headingId && e.type === 'scene_heading')
    if (startIdx < 0) return
    pushHistory(set, get, null)
    // Walk forward until the next scene heading (or end).
    let endIdx = startIdx + 1
    while (endIdx < els.length && els[endIdx].type !== 'scene_heading') endIdx++
    const removedIds = new Set<string>(els.slice(startIdx, endIdx).map(e => e.id as string))
    const nextElements = els.filter(e => !removedIds.has(e.id as string))
    // Drop any linked SceneCard whose startElementId matched the deleted heading
    // or any element we just removed.
    const nextCards = p.sceneCards.filter(c => !c.startElementId || !removedIds.has(c.startElementId))
    set({
      project: {
        ...p,
        screenplay: { ...p.screenplay, elements: nextElements },
        sceneCards: nextCards,
      },
    })
    markDirty(set); scheduleAutosave(get, set)
  },
  reorderElements: (newOrder) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, null)
    const byId = new Map(p.screenplay.elements.map(e => [e.id, e]))
    const ordered = newOrder.map(id => byId.get(id)).filter(Boolean) as ScreenplayElement[]
    set({ project: { ...p, screenplay: { ...p.screenplay, elements: ordered } } })
    markDirty(set); scheduleAutosave(get, set)
  },

  upsertCharacter: (c) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, `upsertCharacter:${c.id}`)
    const existing = p.characters.findIndex(x => x.id === c.id)
    const characters = [...p.characters]
    if (existing >= 0) characters[existing] = c
    else characters.push(c)
    set({ project: { ...p, characters } })
    markDirty(set); scheduleAutosave(get, set)
  },
  removeCharacter: (id) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, null)
    set({ project: { ...p, characters: p.characters.filter(c => c.id !== id) } })
    markDirty(set); scheduleAutosave(get, set)
  },

  castReport: () => {
    const p = get().project
    if (!p) return null
    return reconcileCast(p)
  },

  adoptScriptCharacters: (provenance = 'auto_script', onlyNames) => {
    const p = get().project
    if (!p) return []
    const report = reconcileCast(p)
    const whitelist = onlyNames ? new Set(onlyNames.map(canonicalName)) : null
    const toAdopt = report.scriptOnly.filter(s =>
      whitelist ? whitelist.has(s.name) : true,
    )
    if (toAdopt.length === 0) return []
    const newChars = toAdopt.map(s => buildStubCharacter(s, { provenance }))
    set({ project: { ...p, characters: [...p.characters, ...newChars] } })
    markDirty(set); scheduleAutosave(get, set)
    return newChars
  },

  reviewCharacter: (id) => {
    const p = get().project
    if (!p) return
    set({
      project: {
        ...p,
        characters: p.characters.map(c =>
          c.id === id ? { ...c, needsReview: false } : c,
        ),
      },
    })
    markDirty(set); scheduleAutosave(get, set)
  },

  upsertBeat: (b) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, `upsertBeat:${b.id}`)
    const existing = p.beats.findIndex(x => x.id === b.id)
    const beats = [...p.beats]
    if (existing >= 0) beats[existing] = b
    else beats.push(b)
    set({ project: { ...p, beats } })
    markDirty(set); scheduleAutosave(get, set)
  },
  removeBeat: (id) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, null)
    set({ project: { ...p, beats: p.beats.filter(b => b.id !== id) } })
    markDirty(set); scheduleAutosave(get, set)
  },
  upsertSceneCard: (s) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, `upsertSceneCard:${s.id}`)
    const existing = p.sceneCards.findIndex(x => x.id === s.id)
    const sceneCards = [...p.sceneCards]
    if (existing >= 0) sceneCards[existing] = s
    else sceneCards.push(s)
    set({ project: { ...p, sceneCards } })
    markDirty(set); scheduleAutosave(get, set)
  },
  removeSceneCard: (id) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, null)
    set({ project: { ...p, sceneCards: p.sceneCards.filter(s => s.id !== id) } })
    markDirty(set); scheduleAutosave(get, set)
  },
  insertSceneCards: (cards) => {
    const p = get().project
    if (!p || cards.length === 0) return
    pushHistory(set, get, null)
    const insertOrder = Math.min(...cards.map(c => c.order))
    const shift = cards.length
    const shifted = p.sceneCards.map(c =>
      c.order >= insertOrder ? { ...c, order: c.order + shift } : c,
    )
    const merged = [...shifted, ...cards].sort((a, b) => a.order - b.order)
    // Normalize order to be 0..n-1 in case anything drifted.
    const normalized = merged.map((c, i) => ({ ...c, order: i }))
    set({ project: { ...p, sceneCards: normalized } })
    markDirty(set); scheduleAutosave(get, set)
  },

  addReference: (r) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, null)
    set({ project: { ...p, references: [...p.references, r] } })
    markDirty(set); scheduleAutosave(get, set)
  },
  updateReference: (id, patch) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, `updateReference:${id}`)
    set({
      project: {
        ...p,
        references: p.references.map(r => (r.id === id ? { ...r, ...patch } : r)),
      },
    })
    markDirty(set); scheduleAutosave(get, set)
  },
  removeReference: (id) => {
    const p = get().project
    if (!p) return
    pushHistory(set, get, null)
    set({ project: { ...p, references: p.references.filter(r => r.id !== id) } })
    markDirty(set); scheduleAutosave(get, set)
  },

  patchSeriesPlan: (patch) => {
    const p = get().project
    if (!p) return
    const current = p.planning.seriesPlan
    if (!current) return
    set({
      project: {
        ...p,
        planning: { ...p.planning, seriesPlan: { ...current, ...patch } },
      },
    })
    markDirty(set); scheduleAutosave(get, set)
  },
  upsertEpisode: (ep) => {
    const p = get().project
    if (!p?.planning.seriesPlan) return
    const current = p.planning.seriesPlan
    const existing = current.episodes.findIndex(x => x.id === ep.id)
    const next = [...current.episodes]
    if (existing >= 0) next[existing] = ep
    else next.push(ep)
    next.sort((a, b) => a.number - b.number)
    set({
      project: {
        ...p,
        planning: { ...p.planning, seriesPlan: { ...current, episodes: next } },
      },
    })
    markDirty(set); scheduleAutosave(get, set)
  },
  removeEpisode: (id) => {
    const p = get().project
    if (!p?.planning.seriesPlan) return
    const current = p.planning.seriesPlan
    const next = current.episodes.filter(e => e.id !== id)
    // Cascade: if the active episode was the deleted one, clear it.
    const activeEpisodeId = current.activeEpisodeId === id ? undefined : current.activeEpisodeId
    // Also strip the deleted episode id from any arc's episodeIds.
    const arcs = current.seasonArcs.map(a => ({
      ...a,
      episodeIds: a.episodeIds.filter(eid => eid !== id),
    }))
    set({
      project: {
        ...p,
        planning: {
          ...p.planning,
          seriesPlan: { ...current, episodes: next, seasonArcs: arcs, activeEpisodeId },
        },
      },
    })
    markDirty(set); scheduleAutosave(get, set)
  },
  patchActiveEpisode: (patch) => {
    const p = get().project
    if (!p?.planning.seriesPlan) return
    const plan = p.planning.seriesPlan
    const activeId = plan.activeEpisodeId
    if (!activeId) return
    const idx = plan.episodes.findIndex(e => e.id === activeId)
    if (idx < 0) return
    const next = [...plan.episodes]
    next[idx] = { ...next[idx], ...patch }
    pushHistory(set, get, `patchActiveEpisode:${activeId}`)
    set({
      project: {
        ...p,
        planning: {
          ...p.planning,
          seriesPlan: { ...plan, episodes: next },
        },
      },
    })
    markDirty(set); scheduleAutosave(get, set)
  },
  setActiveEpisode: (id) => {
    const p = get().project
    if (!p?.planning.seriesPlan) return
    set({
      project: {
        ...p,
        planning: {
          ...p.planning,
          seriesPlan: { ...p.planning.seriesPlan, activeEpisodeId: id },
        },
      },
    })
    markDirty(set); scheduleAutosave(get, set)
  },
  upsertSeasonArc: (arc) => {
    const p = get().project
    if (!p?.planning.seriesPlan) return
    const current = p.planning.seriesPlan
    const existing = current.seasonArcs.findIndex(x => x.id === arc.id)
    const next = [...current.seasonArcs]
    if (existing >= 0) next[existing] = arc
    else next.push(arc)
    set({
      project: {
        ...p,
        planning: { ...p.planning, seriesPlan: { ...current, seasonArcs: next } },
      },
    })
    markDirty(set); scheduleAutosave(get, set)
  },
  removeSeasonArc: (id) => {
    const p = get().project
    if (!p?.planning.seriesPlan) return
    const current = p.planning.seriesPlan
    const next = current.seasonArcs.filter(a => a.id !== id)
    set({
      project: {
        ...p,
        planning: { ...p.planning, seriesPlan: { ...current, seasonArcs: next } },
      },
    })
    markDirty(set); scheduleAutosave(get, set)
  },

  upsertNote: (n) => {
    const p = get().project
    if (!p) return
    const existing = p.notes.findIndex(x => x.id === n.id)
    const notes = [...p.notes]
    if (existing >= 0) notes[existing] = n
    else notes.push(n)
    set({ project: { ...p, notes } })
    markDirty(set); scheduleAutosave(get, set)
  },
  removeNote: (id) => {
    const p = get().project
    if (!p) return
    set({ project: { ...p, notes: p.notes.filter(n => n.id !== id) } })
    markDirty(set); scheduleAutosave(get, set)
  },
  upsertLocation: (l) => {
    const p = get().project
    if (!p) return
    const existing = p.locations.findIndex(x => x.id === l.id)
    const locations = [...p.locations]
    if (existing >= 0) locations[existing] = l
    else locations.push(l)
    set({ project: { ...p, locations } })
    markDirty(set); scheduleAutosave(get, set)
  },
  removeLocation: (id) => {
    const p = get().project
    if (!p) return
    set({ project: { ...p, locations: p.locations.filter(l => l.id !== id) } })
    markDirty(set); scheduleAutosave(get, set)
  },
}))

/** Strip em-dashes from a planning patch (defense in depth). */
function sanitizePatch(patch: Partial<Project['planning']>): Partial<Project['planning']> {
  const out: any = { ...patch }
  for (const k of ['logline', 'shortSummary', 'longSynopsis', 'storyEngine', 'centralDramaticQuestion', 'continuityNotes', 'aStory', 'bStory', 'cStory', 'seriesArcQuestion', 'externalStakes', 'internalStakes', 'targetAudience', 'themeQuestion']) {
    if (typeof out[k] === 'string') out[k] = stripEmDashes(out[k], 'ai_output')
  }
  return out
}

/** Strip em-dashes from a screenplay element's text. */
function sanitizeElement(el: ScreenplayElement): ScreenplayElement {
  const ctx = el.type === 'dialogue' || el.type === 'parenthetical' ? 'dialogue' : 'action'
  return { ...el, text: stripEmDashes(el.text, ctx as any) }
}
