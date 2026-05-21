import type { BeatId, CharacterId, SceneCardId, SetupPayoffId } from './id'

/**
 * A single beat in the outline. Each beat is one dramatic charge — what happens,
 * who's involved, what changes, what's set up, what's paid off.
 *
 * Beats are the unit of structural intelligence. The Outline Editor visualizes
 * them on a page-timeline; the Beat Board lets the writer move them freely.
 */
export interface Beat {
  id: BeatId
  title: string
  // Short paragraph describing what happens, in plain language. This is what
  // the AI uses as the source of truth when drafting the scene from this beat.
  body: string

  // Structural placement.
  actNumber?: number          // 1, 2, 3, 4, 5...
  sequenceNumber?: number     // within act
  // Page target — where this beat is expected to land in the script.
  pageRangeStart?: number
  pageRangeEnd?: number

  // Substance fields — what makes a beat worth its existence.
  storyPurpose: string        // why does this beat exist
  charactersInvolved: CharacterId[]
  characterObjective: string  // what the POV character wants
  obstacle: string            // what stands in the way
  valueAtStart: string        // McKee opening value
  valueAtEnd: string          // McKee closing value
  changeMechanism: string     // how the value flips
  newInformation: string      // what the audience learns
  emotionalCharge: string     // what the audience feels

  // Setup/payoff linkage.
  setupIds: SetupPayoffId[]   // what this beat sets up
  payoffIds: SetupPayoffId[]  // what this beat pays off

  // For TV: act-out / cliffhanger / commercial break.
  actOut?: string
  // For Vertical: cliffhanger details.
  cliffhanger?: string

  /**
   * Which subplot(s) this beat belongs to. References `Subplot.id` on the
   * project. A beat can serve multiple subplots (e.g., a confrontation
   * scene that's both the A-story turning point and a B-story moment).
   * The PRIMARY subplot is index 0; secondary subplots follow.
   */
  subplotIds?: string[]

  // Author intent: locked beats never get modified by AI/Modify.
  locked?: boolean
  // Visual: assigned color (for Beat Board grouping).
  color?: string
  // Optional image attached (storyboard, mood, etc.).
  image?: string

  // Beat Board position (free-form layout).
  boardPosition?: { x: number; y: number; w: number; h: number }
  // Flow lines: connections to other beats.
  flowLinesTo: BeatId[]

  // Linked scene cards generated from this beat.
  generatedSceneCardIds: SceneCardId[]
}

/**
 * A scene card — finer-grained than a beat. One scene card per actual screenplay
 * scene. Created either from a beat ("expand to scene cards") or directly.
 */
export interface SceneCard {
  id: SceneCardId
  beatId?: BeatId
  title: string
  slugLine: string            // e.g., "INT. KITCHEN - NIGHT"
  summary: string
  // What changes in this scene (McKee scene turn discipline).
  openingValue: string
  closingValue: string
  turn: string                // how the value changes
  whoWantsWhat: string
  obstacle: string
  tactic: string              // primary tactic used
  // Story bookkeeping.
  setupIds: SetupPayoffId[]
  payoffIds: SetupPayoffId[]
  audienceKnowledgeDelta: string // what the audience learns
  // Estimated page length.
  estimatedPages: number
  // Tension level at start and end (0-10).
  tensionStart: number
  tensionEnd: number
  // Order in the script.
  order: number
  // Color (for grouping / index card view).
  color?: string
  // Linked screenplay element id where this scene starts.
  startElementId?: string
  // Locked?
  locked?: boolean
}

/**
 * A subplot / story-line — A, B, C, D, etc. A subplot is a coherent
 * narrative thread that runs across multiple beats. Each beat tags which
 * subplot(s) it serves so the Beat Board can color-code by thread, and so
 * the Substance Check can verify the AI is rotating between subplots
 * rather than camping on one.
 */
export interface Subplot {
  id: string
  /** "A", "B", "C", "D", ... — drives the conventional letter label. */
  letter: string
  /** Human-readable name: "The bank job", "Maya & Daniel romance", etc. */
  label: string
  /** Short paragraph describing the arc (start → end). */
  description: string
  /** Characters this subplot principally tracks. */
  characterIds: string[]
  /**
   * The dramatic question this subplot asks. Should be a question with a
   * clear yes/no answer at the climax (mirrors the central dramatic
   * question, but per-subplot).
   */
  dramaticQuestion: string
  /** Color hex for Beat Board cards. Auto-assigned but user-editable. */
  color: string
  /** Was this subplot AI-generated? Used by the Substance Check. */
  aiGenerated?: boolean
}

/**
 * A setup-and-payoff pair. The ledger tracks every Chekhov's gun the writer
 * has planted. Unfired guns get flagged. Orphan payoffs (no planted setup)
 * also get flagged.
 */
export interface SetupPayoff {
  id: SetupPayoffId
  description: string
  // Where was the setup planted (beat or scene card or element).
  setupAt?: { kind: 'beat' | 'scene' | 'element'; id: string; page?: number }
  // Where is the payoff intended (beat or scene card or element).
  payoffAt?: { kind: 'beat' | 'scene' | 'element'; id: string; page?: number }
  // Has the payoff happened?
  paid: boolean
  // Did it have a planted setup? (For payoff-first detection.)
  planted: boolean
  // Importance: a major reveal vs a callback joke.
  weight: 'minor' | 'medium' | 'major'
  // Category.
  kind: 'plot' | 'character' | 'theme' | 'visual' | 'verbal' | 'object' | 'relationship'
  // Optional notes.
  notes?: string
}
