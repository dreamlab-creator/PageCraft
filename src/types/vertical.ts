/**
 * Vertical-mode-only types. These are kept in their own walled-garden module
 * to make the sandbox boundary explicit. Nothing here applies to other formats.
 */

import type { BeatId, CycleId, EpisodeId, LoopId, CharacterId } from './id'

/** The 4-beat micro-structure of every vertical episode. */
export interface EpisodeBeats {
  rise: BeatId | null   // tension/anticipation builds
  spike: BeatId | null  // explosive emotional payoff
  drop: BeatId | null   // consequence/vulnerability
  cliff: BeatId | null  // unresolved hook
}

/** A single vertical episode (≈ 60-90 seconds of screen time). */
export interface VerticalEpisode {
  id: EpisodeId
  cycleId: CycleId
  number: number       // 1, 2, 3 ... within season
  numberInCycle: number
  title?: string
  beats: EpisodeBeats
  // Optional rating of cliffhanger strength 1-10.
  cliffStrength?: number
  // Has at least one CPI moment (TikTok-thumbnail-worthy visual)?
  hasCPIMoment: boolean
  cpiMomentDescription?: string
  // The link to the screenplay starts here.
  startElementId?: string
  endElementId?: string
  // Is this the paywall episode?
  isPaywall: boolean
  // Is this an episode in a free preview block?
  isFree: boolean
}

/** A cycle: 4-8 episodes that form a complete sub-arc within the season. */
export interface VerticalCycle {
  id: CycleId
  number: number
  title?: string
  // The trope-stack pillars this cycle leans on most.
  activeTropeFamilies: TropeFamilyId[]
  // Escalation level. Cycle 1 = 1, Cycle 9 = 9. Used to ensure rising intensity.
  escalationLevel: number
  episodes: EpisodeId[]
  // The active loop type for this cycle.
  activeLoopId?: LoopId
}

/** Tracks the cause/effect loop that powers each cycle. */
export interface VerticalLoop {
  id: LoopId
  // Who plays each role this cycle.
  villainCharacterId?: CharacterId
  mcCharacterId?: CharacterId
  loveInterestCharacterId?: CharacterId
  // The phases of the loop (open text the user can edit per cycle).
  cause: {
    villainProvoked: string
    villainsIdea: string
    villainSetsUp: string
    mcBullied: string
  }
  effect: {
    mcStrikesBack: string
    liAssists: string
    villainPunished: string
    villainResetsForNext: string
  }
}

/** Master List of Vertical Tropes (12 families). */
export type TropeFamilyId =
  | 'relationship_core'
  | 'identity_secret'
  | 'power_status_imbalance'
  | 'revenge_betrayal_humiliation'
  | 'pregnancy_child'
  | 'family_inheritance'
  | 'forced_proximity'
  | 'steam_heat'
  | 'second_chance_time_bend'
  | 'supernatural_romance'
  | 'mystery_danger'
  | 'micro_tropes_per_episode'

/** Specific trope tags within families. */
export interface TropeTag {
  id: string
  family: TropeFamilyId
  label: string
  description: string
  // Common variants the user can opt into.
  variants?: string[]
}

/** The project's declared trope stack — sticks across the season. */
export interface VerticalTropeStack {
  // Selected trope tag ids.
  selected: string[]
  // Primary family — drives genre overlay.
  primaryFamily: TropeFamilyId
  // Optional secondary family.
  secondaryFamily?: TropeFamilyId
  // User notes about how tropes combine.
  notes: string
}

/** Vertical season-level planning. */
export interface VerticalSeasonPlan {
  cycles: VerticalCycle[]
  episodes: VerticalEpisode[]
  loops: VerticalLoop[]
  tropeStack: VerticalTropeStack
  // The total season length in episodes (default 30-50 typical).
  totalEpisodes: number
  // Paywall placement (episode number where free preview ends).
  paywallAfterEpisode: number
  // Plot type.
  plotType: 'romance' | 'revenge' | 'romance_overlay_revenge'
  // Primary POV character.
  povCharacterId?: CharacterId
}
