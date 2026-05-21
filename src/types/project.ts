/**
 * The top-level Project type. Everything lives here. This is the JSON
 * structure saved to disk (.pgcraft.json) and stored in IndexedDB.
 */

import type {
  ProjectId,
  CharacterId,
  LocationId,
  VersionId,
  NoteId,
} from './id'
import type { ScreenplayDocument } from './screenplay'
import type { Character } from './character'
import type { Beat, SceneCard, SetupPayoff, Subplot } from './beat'
import type { FormatConfig } from './format'
import type { VerticalSeasonPlan } from './vertical'
import type { Reference } from './reference'
import type { SeriesPlan } from './series'

/** A location used in the project. Tracked separately for SmartType + continuity. */
export interface Location {
  id: LocationId
  name: string
  description: string
  rules: string                  // world rules / continuity facts about this location
  // Optional reference image.
  referenceImage?: string
  // Times of day used at this location.
  timesUsed: string[]
  // Scenes that use this location.
  sceneIds: string[]
}

/** Inline screenplay note (FD ScriptNote equivalent). */
export interface ScriptNote {
  id: NoteId
  // Anchored to a screenplay element.
  elementId: string
  body: string
  author?: string
  createdAt: number
  resolved: boolean
  priority: 'low' | 'normal' | 'high' | 'critical'
  color?: string
  tag?: string
}

/** A timeline event (in-story time tracking for continuity). */
export interface TimelineEvent {
  id: string
  storyDate: string             // "Day 3, evening" or absolute date
  description: string
  involvedCharacters: CharacterId[]
  involvedLocations: LocationId[]
  // Page on which this is depicted, if any.
  page?: number
}

/** A version snapshot in the project's history. */
export interface ProjectVersion {
  id: VersionId
  // Display label, user-named ("Before agent's notes", "Studio Draft").
  label: string
  createdAt: number
  // Auto vs manual.
  auto: boolean
  // Compressed snapshot of the project at this point.
  snapshot: string              // JSON-stringified, optionally compressed
  // Optional notes from the user.
  notes?: string
}

/**
 * Section confirmations. When a section is "confirmed", its data is treated
 * as canonical truth by every subsequent AI call. The user can unlock to edit.
 */
export interface SectionConfirmations {
  overview: boolean
  characters: boolean
  beats: boolean
  scenes: boolean
  themes: boolean
  vertical: boolean
}

/** The planning surface — everything you build before drafting. */
export interface PlanningData {
  // Top-line.
  logline: string
  shortSummary: string
  longSynopsis: string
  themes: string[]
  themeQuestion: string         // theme expressed as a paradox/question
  tone: string[]
  targetAudience: string
  storyEngine: string           // what makes this story go (esp. TV)
  centralDramaticQuestion: string // for features
  // World.
  worldRules: string[]
  // Stakes.
  externalStakes: string
  internalStakes: string
  // For TV.
  aStory: string
  bStory: string
  cStory: string
  // For series.
  seriesArcQuestion: string
  /**
   * The project's named subplots / story-lines. Each Beat and Scene Card
   * can tag which subplot(s) it serves. The Beat Board color-codes by
   * subplot, the Substance Check verifies rotation, and the AI uses this
   * to interleave threads when generating beats.
   *
   * Typical conventions:
   *   - A-story: main external goal
   *   - B-story: relational / theme spine
   *   - C-story: secondary character or runner
   *   - D-story: thematic runner or seasonal arc thread
   */
  subplots: Subplot[]
  // Continuity notes.
  continuityNotes: string
  /**
   * Foundational Guidance — free-text directives the writer enters once at
   * the very top of Planning. These are NOT decorative notes; they are
   * pushed into every AI call as constitutional law. The writer can say
   * "Target 90 pages," "Found-footage subgenre," "Limit to 5 characters,"
   * "Every character speaks like a redneck," and the AI is bound to obey
   * across loglines, summaries, character bibles, beats, scene cards, and
   * drafted pages.
   *
   * Optional on the type so projects created before this field existed
   * still load. Treat missing as empty string in all read sites.
   */
  foundationalGuidance?: string
  // Locked elements list (free text).
  hardConstraints: string[]
  // Section confirmations.
  confirmations: SectionConfirmations
  /**
   * Series / Show-Bible scaffold. Present only on TV / animated-series
   * projects (i.e., format.kind is one of the TV / animation kinds and
   * NOT a vertical). Verticals use the separate `verticalPlan` instead.
   */
  seriesPlan?: SeriesPlan
}

/** The Knowledge Graph — derived facts that drive continuity. */
export interface KnowledgeGraph {
  facts: Array<{
    id: string
    statement: string            // "Maya is Sarah's mother"
    establishedAtPage?: number
    establishedByElementId?: string
    knownToCharacters: CharacterId[]
    unknownToCharacters: CharacterId[]
    audienceKnowsAt?: number
    tags: string[]
  }>
}

/** Project-level user settings. */
export interface ProjectSettings {
  appearance: 'system' | 'day' | 'night' | 'midnight'
  showStructureLines: boolean
  showSceneNumbers: boolean
  enableSpellCheck: boolean
  enableLiveDiagnostics: boolean
  // Strictness of humanization linter inside this project.
  humanizationStrictness: 'strict' | 'standard' | 'lenient'
  // Autosave interval ms.
  autosaveIntervalMs: number
  // Number of recent versions to keep.
  versionRetention: number
  // Target page count override (else uses format default).
  targetPageOverride?: number
}

export interface Project {
  id: ProjectId
  title: string
  createdAt: number
  updatedAt: number

  // The format config (preset or custom-composed).
  format: FormatConfig

  // Author + collaboration.
  author: string
  credit: string                 // "Written by", "Story by", etc.

  // Core data.
  screenplay: ScreenplayDocument
  characters: Character[]
  locations: Location[]
  planning: PlanningData

  // Outline.
  beats: Beat[]
  sceneCards: SceneCard[]
  setupsPayoffs: SetupPayoff[]
  timeline: TimelineEvent[]

  // Knowledge graph (continuity engine).
  knowledge: KnowledgeGraph

  // Inline notes.
  notes: ScriptNote[]

  // References (uploaded materials with intent).
  references: Reference[]

  // Version history.
  versions: ProjectVersion[]

  // Vertical-specific season plan (only present if format is vertical).
  verticalPlan?: VerticalSeasonPlan

  // Settings.
  settings: ProjectSettings

  // Schema version for forward-compat migrations.
  schemaVersion: number
}

export const PROJECT_SCHEMA_VERSION = 1
