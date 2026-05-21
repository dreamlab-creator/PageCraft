/**
 * Format configuration — the structural intelligence that drives every other
 * system. Produced by the Format Library presets or composed on the fly by
 * the Format Interpreter from a natural-language description.
 */

export type FormatKind =
  | 'feature_drama'
  | 'feature_comedy'
  | 'feature_horror'
  | 'tv_1hr_drama'
  | 'tv_30min_comedy_single_cam'
  | 'tv_30min_comedy_multi_cam'
  | 'animation_2d'
  | 'vertical'
  | 'custom'

export type AudienceTier =
  | 'kids'
  | 'family'
  | 'teen'
  | 'adult'
  | 'mature'
  | 'unspecified'

export type ActStructure =
  | 'actless'
  | '2_act'
  | '3_act'
  | '4_act'
  | '5_act'
  | 'teaser_plus_4_act'
  | 'cold_open_plus_3_act_plus_tag'
  | 'anthology_frame'
  | 'episode_cycles' // vertical-only

export type GenreLane =
  | 'drama'
  | 'comedy'
  | 'thriller'
  | 'horror'
  | 'mystery'
  | 'romance'
  | 'sci_fi'
  | 'fantasy'
  | 'action'
  | 'crime'
  | 'period'
  | 'family'
  | 'musical'
  | 'biopic'
  | 'documentary_drama'

/**
 * The composed Format Config that drives the entire app for a given project.
 */
export interface FormatConfig {
  kind: FormatKind
  label: string
  description: string

  // Medium.
  medium: 'live_action' | 'animation' | 'mixed'

  // Page geometry: defaults to industry standard. Vertical and multi-cam may override.
  page: {
    width: number               // inches
    height: number              // inches
    marginLeft: number          // inches
    marginRight: number
    marginTop: number
    marginBottom: number
    font: string                // CSS font family name
    fontSize: number            // pt
    // Element-specific indents (inches from left edge of page).
    elementIndents: {
      action: { left: number; right: number }
      character: { left: number; right: number }
      dialogue: { left: number; right: number }
      parenthetical: { left: number; right: number }
      transition: { left: number; right: number }
      shot: { left: number; right: number }
    }
    // Element-specific casing rules.
    elementCasing: {
      action: 'normal' | 'all_caps'      // multi-cam: all_caps
      sceneHeading: 'all_caps'
      character: 'all_caps'
      transition: 'all_caps'
      shot: 'all_caps'
    }
    // Dialogue line spacing within blocks.
    dialogueLineSpacing: 1 | 1.5 | 2  // multi-cam: 2
    // Page numbering: roughly 1 page = N seconds.
    secondsPerPage: number
  }

  // Structural targets.
  structure: {
    actStructure: ActStructure
    targetActs: number          // 0 for actless
    coldOpen: boolean
    teaser: boolean
    tag: boolean
    // Page target range for a complete script.
    targetPagesMin: number
    targetPagesMax: number
    // For TV series only: episodes per season target.
    episodesPerSeason?: number
    // For Vertical only: cycle structure.
    cyclesPerSeason?: number
    episodesPerCycle?: number
    beatsPerEpisode?: number
    targetEpisodeRuntimeSeconds?: number
    // For TV: standard act-out expectations.
    expectActOuts: boolean
  }

  // Conventions per the docs.
  conventions: {
    multiCam: boolean
    underlineSceneHeadings: boolean  // multi-cam
    castListAfterSlug: boolean       // multi-cam
    underlineCharacterFirstIntro: boolean // multi-cam
    sfxBolded: boolean               // multi-cam
    sceneNumbersAsLetters: boolean   // multi-cam
    portraitFrame: boolean           // vertical
    requireCliffhangerPerEpisode: boolean // vertical
    requireRiseSpikeDropCliff: boolean    // vertical
    revisionColorsEnabled: boolean        // most formats
  }

  // Genre tags — drives genre-specific diagnostics.
  genres: GenreLane[]
  tone: string[]                  // free-text tone tags
  audience: AudienceTier

  // Pacing calibration.
  pacing: {
    profile: 'very_slow' | 'slow' | 'measured' | 'brisk' | 'fast' | 'very_fast' | 'vertical'
    // Average scene length in pages target.
    avgScenePages: number
    // Tension peak target every N pages.
    tensionPeakIntervalPages: number
    // Comedy-only: gag/beat target frequency in seconds.
    gagIntervalSeconds?: number
  }

  // Substance check thresholds. Lower = stricter.
  substanceThresholds: {
    minBeatsPerAct: number
    minScenePerAct: number
    maxFillerPercent: number
    minTurnsPerScene: number     // typically 1
    minActiveProtagonistChoicesPerAct: number
  }

  /**
   * Substance targets — the *quantitative* density the AI must produce.
   *
   * These exist because the most common AI failure mode in screenplay
   * generation is thinness: 20 beats for a feature is half a script. The
   * targets here are calibrated to industry practice (Noam Kroll's 40-beat
   * feature template; the BS2 + Snyder + Field framework; standard hour-
   * drama A/B/C structure; sitcom A/B + runner; vertical Rise/Spike/Drop/
   * Cliff per episode).
   */
  substanceTargets: {
    /** Total beats across the whole project. */
    beats: { min: number; ideal: number; max: number }
    /** Total scene cards across the whole project (typically 1.5-2.5x beats). */
    scenes: { min: number; ideal: number; max: number }
    /** Distinct named subplots (A + B + C + ...). */
    subplots: { min: number; ideal: number; max: number }
    /** How many "major reveals" or twists a fully-substanced outline carries. */
    majorReveals: { min: number; ideal: number; max: number }
    /** How many distinct setup→payoff pairs to plant. */
    setupsPayoffs: { min: number; ideal: number; max: number }
    /**
     * Long-synopsis target length in words. Industry coverage synopses for
     * features run 700–1500 words; for hour pilots 500–900; for half-hour
     * 350–500.
     */
    longSynopsisWords: { min: number; ideal: number; max: number }
    /** Named characters with meaningful arcs (excludes one-line minor roles). */
    namedCharacters: { min: number; ideal: number; max: number }
    /**
     * The expected breakdown of subplot labels. The AI must rotate beats
     * between these and explicitly tag each beat by subplot letter.
     */
    subplotLabels: Array<{ letter: string; conventionalRole: string }>
  }

  // Humanization mode override (defaults to "strict" everywhere except Vertical's
  // on-the-nose-friendly dialogue, where we relax some constraints inside dialogue
  // but still kill em dashes and AI tells).
  humanization: 'strict' | 'vertical_relaxed_dialogue'

  // Sandbox flag — if true, this project is in the Vertical walled garden and
  // none of the general craft rules apply. The Vertical-specific modules drive
  // everything.
  verticalSandbox: boolean
}
