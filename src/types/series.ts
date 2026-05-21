/**
 * Series / Show-Bible types.
 *
 * Lives alongside (not inside) the Beat / SceneCard / Character types. A
 * Project flagged as a series has its `planning.seriesPlan` populated with
 * the season-level scaffolding: episode list, season arcs, recurring
 * dynamics, and per-episode metadata.
 *
 * Episodes themselves are LIGHT records here — title, logline, summary,
 * arc beat, status. The user writes one episode at a time using the
 * existing Beat Board / Scene Cards / Writing canvas. The active episode
 * is tracked on the seriesPlan so the rest of the app can scope to it.
 *
 * Vertical projects intentionally do NOT use this scaffold — verticals
 * already have their own episode model (`verticalPlan`) calibrated to the
 * Rise/Spike/Drop/Cliff structure.
 */

/** An episode in a TV / animated series season. */
export interface SeriesEpisode {
  id: string
  /** 1-based episode number within the season. */
  number: number
  /** Optional season number (defaults to 1). */
  season?: number
  /** Episode title. */
  title: string
  /** One-sentence pitch for this specific episode. */
  logline: string
  /** A short paragraph: what happens this week. */
  summary: string
  /**
   * Long synopsis for THIS episode (not the whole series). Scales with
   * the project's per-episode page target — a 22-page hour gets ~150
   * words, a 2-page vertical episode gets ~50, a 60-page pilot gets
   * ~400. The AI honors the actual page count rather than padding to
   * hit a fixed length.
   *
   * Optional because legacy episodic projects pre-date this field;
   * blank means "writer hasn't filled it in yet."
   */
  longSynopsis?: string
  /**
   * The dramatic question THIS episode answers. One sentence, Yes/No
   * form. Separate from the series-level season-arc question on
   * `SeriesPlan.seasonArcQuestion`.
   */
  centralDramaticQuestion?: string
  /**
   * Episode-level theme question — one sentence stating what this
   * specific episode is arguing about. Independent of the series's
   * larger theme.
   */
  themeQuestion?: string
  /** Episode-level theme tags. Short, 1–3 words each. */
  themes?: string[]
  /**
   * How this episode advances the season's arcs. One short paragraph
   * per arc, keyed by arc id. Cheap to fill in; tells the writer (and
   * AI) what each arc "spends" this week.
   */
  arcMovements: Array<{ arcId: string; movement: string }>
  /**
   * The principal characters who get screen time this episode. Subset of
   * the project's `characters` array. Used by the AI to scope beat /
   * scene / writing prompts to the right people.
   */
  focusCharacterIds: string[]
  /**
   * Workflow status, so the user can see at a glance where each episode
   * is in the pipeline.
   */
  status: 'planned' | 'outlined' | 'drafted' | 'final'
  /** Free-text production notes. */
  notes?: string
  /** Optional cliffhanger / cold-open hook for this episode. */
  hook?: string
  /**
   * Per-episode lock state for the Episode Overview tab. When true the
   * writer has confirmed this episode's overview and the AI treats those
   * fields as canonical / immutable. Distinct from the project-level
   * `confirmations.overview` (which applies to standalone features).
   */
  overviewLocked?: boolean
}

/**
 * A multi-episode story thread (e.g., "Maya's prosecution of the cartel
 * across episodes 3-9"). Independent of A/B/C subplots, which apply per
 * episode. A season arc is a longer-running thread.
 */
export interface SeasonArc {
  id: string
  /** Letter or label — "Arc 1", "Maya v Cartel", etc. */
  label: string
  /** What this arc IS — 2–4 sentences. */
  description: string
  /** The dramatic question it asks (one yes/no question per arc). */
  dramaticQuestion: string
  /**
   * Episodes this arc is active in. Stored as ids referencing
   * `seriesPlan.episodes[].id`. An arc may sit out some episodes.
   */
  episodeIds: string[]
  /** Color hex for at-a-glance visualization. */
  color: string
}

/**
 * The complete show-bible scaffold. Sits on `project.planning.seriesPlan`.
 */
export interface SeriesPlan {
  /** Show title (defaults to project title when blank). */
  showTitle: string
  /**
   * Series-level logline — ONE sentence pitching the show as a whole.
   * Distinct from any single episode's logline; the AI consults this on
   * every generation so all episodes feel like they belong to the same
   * show. Optional for legacy compatibility.
   */
  seriesLogline?: string
  /**
   * Series-level short summary — one paragraph that pitches the whole
   * show: hook, ensemble, world, recurring tension. Optional for legacy.
   */
  seriesShortSummary?: string
  /**
   * Series-level long synopsis — multi-paragraph pitch describing the
   * show, its world, its arcs, and what a typical season feels like.
   * Optional for legacy.
   */
  seriesLongSynopsis?: string
  /**
   * One sentence describing the series concept. Legacy field; for new
   * projects use `seriesLogline` instead. Kept for backward compat.
   */
  premise: string
  /** What recurring engine generates episode situations week to week. */
  engine: string
  /** What the whole season is asking — the spine question. */
  seasonArcQuestion: string
  /** Tonal notes for the show as a whole. */
  toneNotes: string
  /** Episodes in story order. */
  episodes: SeriesEpisode[]
  /** Season arcs the user wants to track across episodes. */
  seasonArcs: SeasonArc[]
  /** Currently focused episode (for filtering downstream views). */
  activeEpisodeId?: string
  /** Target number of episodes the user is planning toward. */
  targetEpisodeCount: number
  /** Season number (defaults to 1). */
  seasonNumber: number
  /**
   * Show-bible lock state. When true, the series-level fields below
   * (showTitle, seriesLogline, seriesShortSummary, seriesLongSynopsis,
   * premise, engine, seasonArcQuestion, season arcs, target episode
   * count, tone notes) are treated as canonical by the AI on every
   * subsequent generation, and the UI disables those inputs.
   *
   * This is independent from per-episode locks (`SeriesEpisode.overviewLocked`)
   * — a writer can lock the show bible while leaving individual episodes
   * still editable.
   */
  locked?: boolean
}

export const createBlankSeriesPlan = (targetEpisodes = 8): SeriesPlan => ({
  showTitle: '',
  seriesLogline: '',
  seriesShortSummary: '',
  seriesLongSynopsis: '',
  premise: '',
  engine: '',
  seasonArcQuestion: '',
  toneNotes: '',
  episodes: [],
  seasonArcs: [],
  activeEpisodeId: undefined,
  targetEpisodeCount: targetEpisodes,
  seasonNumber: 1,
})

/**
 * Build a fresh empty episode. Useful when an episodic project needs a
 * stub Episode 1 so the Overview tab has something to edit on first
 * load — without a seeded episode the Overview would have nothing to
 * read or write to.
 */
export function createBlankEpisode(number = 1, season = 1): SeriesEpisode {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    number,
    season,
    title: '',
    logline: '',
    summary: '',
    longSynopsis: '',
    centralDramaticQuestion: '',
    themeQuestion: '',
    themes: [],
    arcMovements: [],
    focusCharacterIds: [],
    status: 'planned',
  }
}
