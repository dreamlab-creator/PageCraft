/**
 * Factory: produce a fresh, well-formed Project for a given FormatConfig.
 */

import type { FormatConfig, Project, ProjectId } from '@/types'
import { newId, PROJECT_SCHEMA_VERSION } from '@/types'
import { createBlankSeriesPlan } from '@/types/series'

/**
 * Detects whether a format calls for a Series / Show-Bible scaffold —
 * any TV format or 2D animation, but NOT vertical (which has its own
 * episode model in `verticalPlan`).
 */
function isSeriesFormat(format: FormatConfig): boolean {
  if (format.verticalSandbox) return false
  return (
    format.kind === 'tv_1hr_drama'
    || format.kind === 'tv_30min_comedy_single_cam'
    || format.kind === 'tv_30min_comedy_multi_cam'
    || format.kind === 'animation_2d'
    || (format.kind === 'custom' && (format.structure.episodesPerSeason ?? 0) > 0)
  )
}

/**
 * Default color palette for subplot threads on the Beat Board. Chosen to
 * be readable in both day and night themes, and spaced so adjacent letters
 * (A vs B, B vs C) read as visually distinct categories.
 */
export const DEFAULT_SUBPLOT_COLORS = [
  '#a8855a', // A — warm clay (main plot)
  '#5e6f8a', // B — slate blue (relational)
  '#4d6a3d', // C — olive (antagonist / supporting)
  '#8a5e7d', // D — mauve (thematic runner)
  '#b95b1a', // E — burnt orange (seasonal arc)
  '#7d623f', // F — dark walnut (rare fifth)
]

export function createBlankProject(opts: {
  title: string
  format: FormatConfig
  author?: string
}): Project {
  const now = Date.now()
  return {
    id: newId<ProjectId>(),
    title: opts.title || 'Untitled Screenplay',
    createdAt: now,
    updatedAt: now,
    format: opts.format,
    author: opts.author ?? '',
    credit: 'Written by',
    screenplay: {
      elements: [],
      titlePage: {
        title: opts.title || 'Untitled',
        credit: 'Written by',
        author: opts.author ?? '',
      },
    },
    characters: [],
    locations: [],
    planning: {
      logline: '',
      shortSummary: '',
      longSynopsis: '',
      themes: [],
      themeQuestion: '',
      tone: [...opts.format.tone],
      targetAudience: opts.format.audience,
      storyEngine: '',
      centralDramaticQuestion: '',
      worldRules: [],
      externalStakes: '',
      internalStakes: '',
      aStory: '',
      bStory: '',
      cStory: '',
      seriesArcQuestion: '',
      // Seed the subplots / loops scaffold.
      //
      // For Vertical projects: we seed 6 LOOPS (cycles). A loop is a
      // self-contained mini-story arc inside the season — its own
      // setup/payoff/resolution played out across ~5 episodes. A season
      // has 6–9 loops; we start at 6 and let the writer add or remove
      // in the Theme · Stakes panel. Loops are numbered (1..6) instead
      // of lettered (A..F).
      //
      // For everything else (features, TV, animation): we seed empty
      // subplot scaffolds from the format's substanceTargets so the
      // Beat Board has a color palette ready before the AI runs.
      subplots: opts.format.verticalSandbox
        ? Array.from({ length: 6 }, (_, i) => ({
            id: newId<any>(),
            letter: String(i + 1),
            label: '',
            description: '',
            characterIds: [],
            dramaticQuestion: '',
            color: DEFAULT_SUBPLOT_COLORS[i % DEFAULT_SUBPLOT_COLORS.length],
            aiGenerated: false,
          }))
        : opts.format.substanceTargets.subplotLabels.map((s, i) => ({
            id: newId<any>(),
            letter: s.letter,
            label: `${s.letter}-story`,
            description: '',
            characterIds: [],
            dramaticQuestion: '',
            color: DEFAULT_SUBPLOT_COLORS[i % DEFAULT_SUBPLOT_COLORS.length],
            aiGenerated: false,
          })),
      continuityNotes: '',
      foundationalGuidance: '',
      hardConstraints: [],
      confirmations: {
        overview: false,
        characters: false,
        beats: false,
        scenes: false,
        themes: false,
        vertical: false,
      },
      // Seed a series plan on TV / animation projects (NOT vertical —
      // verticals use the separate verticalPlan structure). The user can
      // ignore it on features.
      seriesPlan: isSeriesFormat(opts.format)
        ? createBlankSeriesPlan(opts.format.structure.episodesPerSeason ?? 8)
        : undefined,
    },
    beats: [],
    sceneCards: [],
    setupsPayoffs: [],
    timeline: [],
    knowledge: { facts: [] },
    notes: [],
    references: [],
    versions: [],
    verticalPlan: opts.format.verticalSandbox
      ? {
          cycles: [],
          episodes: [],
          loops: [],
          tropeStack: {
            selected: [],
            primaryFamily: 'relationship_core',
            notes: '',
          },
          totalEpisodes: opts.format.structure.episodesPerSeason ?? 50,
          paywallAfterEpisode: 3,
          plotType: 'romance',
        }
      : undefined,
    settings: {
      appearance: 'system',
      showStructureLines: true,
      showSceneNumbers: false,
      enableSpellCheck: true,
      enableLiveDiagnostics: true,
      humanizationStrictness: 'strict',
      autosaveIntervalMs: 2000,
      versionRetention: 50,
    },
    schemaVersion: PROJECT_SCHEMA_VERSION,
  }
}
