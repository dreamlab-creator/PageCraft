/**
 * The six preset formats shipped with PageCraft. Each one is a complete
 * FormatConfig — the full structural intelligence for that medium.
 *
 * These are the "starting points." The Format Interpreter can also compose
 * custom configs on the fly from natural-language descriptions, blending
 * fragments from these presets.
 */

import type { FormatConfig } from '@/types'
import { STANDARD_PAGE, MULTI_CAM_PAGE, VERTICAL_PAGE } from './page-geometry'

export const FEATURE_DRAMA: FormatConfig = {
  kind: 'feature_drama',
  label: 'Feature Length Drama',
  description:
    'A 90 to 120 page dramatic feature. Three-act spine, with strong inciting incident, midpoint, low point, climax, and a transformation arc for the protagonist.',
  medium: 'live_action',
  page: STANDARD_PAGE,
  structure: {
    actStructure: '3_act',
    targetActs: 3,
    coldOpen: false,
    teaser: false,
    tag: false,
    targetPagesMin: 90,
    targetPagesMax: 120,
    expectActOuts: false,
  },
  conventions: {
    multiCam: false,
    underlineSceneHeadings: false,
    castListAfterSlug: false,
    underlineCharacterFirstIntro: false,
    sfxBolded: false,
    sceneNumbersAsLetters: false,
    portraitFrame: false,
    requireCliffhangerPerEpisode: false,
    requireRiseSpikeDropCliff: false,
    revisionColorsEnabled: true,
  },
  genres: ['drama'],
  tone: ['grounded', 'character-driven', 'emotional'],
  audience: 'adult',
  pacing: {
    profile: 'measured',
    avgScenePages: 2.5,
    tensionPeakIntervalPages: 18,
  },
  substanceThresholds: {
    minBeatsPerAct: 12,
    minScenePerAct: 18,
    maxFillerPercent: 3,
    minTurnsPerScene: 1,
    minActiveProtagonistChoicesPerAct: 5,
  },
  // Industry density target for a 100-120 page feature drama. Anchored to
  // Noam Kroll's 40-beat formula and Save-the-Cat 15-milestone + expansion.
  substanceTargets: {
    beats:           { min: 36, ideal: 42, max: 50 },
    scenes:          { min: 60, ideal: 80, max: 100 },
    subplots:        { min: 3,  ideal: 4,  max: 5 },
    majorReveals:    { min: 5,  ideal: 7,  max: 10 },
    setupsPayoffs:   { min: 8,  ideal: 12, max: 18 },
    longSynopsisWords: { min: 800, ideal: 1100, max: 1500 },
    namedCharacters: { min: 6,  ideal: 9,  max: 14 },
    subplotLabels: [
      { letter: 'A', conventionalRole: 'main external plot (the protagonist\'s active goal)' },
      { letter: 'B', conventionalRole: 'relational / love / emotional spine (often where theme is dramatized)' },
      { letter: 'C', conventionalRole: 'secondary character arc (antagonist or strong supporting)' },
      { letter: 'D', conventionalRole: 'thematic runner or minor subplot (cuts in 3–6 times)' },
    ],
  },
  humanization: 'strict',
  verticalSandbox: false,
}

export const FEATURE_COMEDY: FormatConfig = {
  kind: 'feature_comedy',
  label: 'Feature Length Comedy',
  description:
    'A 90 to 110 page comedy feature. High-concept premise, escalation, comic set pieces, character-driven humor, running jokes with payoffs, and an emotional arc beneath the laughs.',
  medium: 'live_action',
  page: STANDARD_PAGE,
  structure: {
    actStructure: '3_act',
    targetActs: 3,
    coldOpen: false,
    teaser: false,
    tag: false,
    targetPagesMin: 90,
    targetPagesMax: 110,
    expectActOuts: false,
  },
  conventions: {
    multiCam: false,
    underlineSceneHeadings: false,
    castListAfterSlug: false,
    underlineCharacterFirstIntro: false,
    sfxBolded: false,
    sceneNumbersAsLetters: false,
    portraitFrame: false,
    requireCliffhangerPerEpisode: false,
    requireRiseSpikeDropCliff: false,
    revisionColorsEnabled: true,
  },
  genres: ['comedy'],
  tone: ['comedic', 'character-first', 'kinetic'],
  audience: 'adult',
  pacing: {
    profile: 'brisk',
    avgScenePages: 2.0,
    tensionPeakIntervalPages: 12,
    gagIntervalSeconds: 60,
  },
  substanceThresholds: {
    minBeatsPerAct: 10,
    minScenePerAct: 16,
    maxFillerPercent: 4,
    minTurnsPerScene: 1,
    minActiveProtagonistChoicesPerAct: 4,
  },
  // Comedy features run leaner per scene; beats slightly fewer than drama,
  // but with stronger emphasis on running gags and comic set pieces.
  substanceTargets: {
    beats:           { min: 32, ideal: 38, max: 46 },
    scenes:          { min: 55, ideal: 75, max: 95 },
    subplots:        { min: 3,  ideal: 4,  max: 5 },
    majorReveals:    { min: 4,  ideal: 6,  max: 8 },
    setupsPayoffs:   { min: 10, ideal: 14, max: 20 }, // runner jokes count here
    longSynopsisWords: { min: 700, ideal: 1000, max: 1300 },
    namedCharacters: { min: 6,  ideal: 9,  max: 14 },
    subplotLabels: [
      { letter: 'A', conventionalRole: 'main comedic engine / external goal' },
      { letter: 'B', conventionalRole: 'romance / emotional spine' },
      { letter: 'C', conventionalRole: 'antagonist or rival arc' },
      { letter: 'D', conventionalRole: 'runner gags & callbacks' },
    ],
  },
  humanization: 'strict',
  verticalSandbox: false,
}

export const FEATURE_HORROR: FormatConfig = {
  kind: 'feature_horror',
  label: 'Feature Length Horror',
  description:
    'A 85 to 110 page horror feature. Three-act spine with a strong cold-open hook, isolation setup, escalating dread, mounting kills/encounters, a midpoint reveal that recontextualizes the threat, a false-dawn beat, a brutal third-act sequence, and an earned final image. Substance is built on rules + violations + escalating threat + character isolation, not on jump scares.',
  medium: 'live_action',
  page: STANDARD_PAGE,
  structure: {
    actStructure: '3_act',
    targetActs: 3,
    coldOpen: true,         // horror almost always opens with a hook scene
    teaser: false,
    tag: false,
    targetPagesMin: 85,
    targetPagesMax: 110,
    expectActOuts: false,
  },
  conventions: {
    multiCam: false,
    underlineSceneHeadings: false,
    castListAfterSlug: false,
    underlineCharacterFirstIntro: false,
    sfxBolded: false,
    sceneNumbersAsLetters: false,
    portraitFrame: false,
    requireCliffhangerPerEpisode: false,
    requireRiseSpikeDropCliff: false,
    revisionColorsEnabled: true,
  },
  genres: ['horror'],
  tone: ['dread-driven', 'visual', 'restrained', 'specific-threat', 'character-isolated'],
  audience: 'mature',
  pacing: {
    profile: 'measured',
    avgScenePages: 2.2,
    tensionPeakIntervalPages: 12, // a scare / threat beat every ~12 pages
  },
  substanceThresholds: {
    minBeatsPerAct: 12,
    minScenePerAct: 18,
    maxFillerPercent: 2,        // horror is the LEAST tolerant of filler
    minTurnsPerScene: 1,
    minActiveProtagonistChoicesPerAct: 5,
  },
  // Horror substance density. The genre rewards dense setup-payoff work
  // (every rule must be violated; every threat must escalate; every safe
  // space must collapse). Beat count slightly higher than drama because of
  // the sequence-heavy third act (the chase, the final confrontation, the
  // false defeat, the final image — each typically a beat unto itself).
  substanceTargets: {
    beats:           { min: 38, ideal: 44, max: 52 },
    scenes:          { min: 65, ideal: 85, max: 105 },
    subplots:        { min: 3,  ideal: 4,  max: 5 },
    majorReveals:    { min: 6,  ideal: 9,  max: 12 },  // recontextualizing reveals are core to horror
    setupsPayoffs:   { min: 14, ideal: 20, max: 28 },  // rules / Chekhov's guns / iconography
    longSynopsisWords: { min: 900, ideal: 1200, max: 1600 },
    namedCharacters: { min: 5,  ideal: 7,  max: 11 },  // smaller casts; characters get picked off
    subplotLabels: [
      { letter: 'A', conventionalRole: 'main survival plot (the protagonist vs the threat)' },
      { letter: 'B', conventionalRole: 'relational spine — bond or schism that determines who survives' },
      { letter: 'C', conventionalRole: 'mystery / lore / "what is this thing" subplot — feeds the midpoint reveal' },
      { letter: 'D', conventionalRole: 'rule book — the world\'s rules being established and broken' },
    ],
  },
  humanization: 'strict',
  verticalSandbox: false,
}

export const TV_1HR_DRAMA: FormatConfig = {
  kind: 'tv_1hr_drama',
  label: 'Hour-Long 5-Act TV Drama',
  description:
    'A network or streaming hour drama with a teaser plus 4-5 acts. 45 pages for broadcast / 55-65 for cable/streaming. Strong act-outs, an A-story-plus-B-story spine, and a recurring series engine.',
  medium: 'live_action',
  page: STANDARD_PAGE,
  structure: {
    actStructure: 'teaser_plus_4_act',
    targetActs: 5,
    coldOpen: false,
    teaser: true,
    tag: false,
    targetPagesMin: 45,
    targetPagesMax: 65,
    episodesPerSeason: 10,
    expectActOuts: true,
  },
  conventions: {
    multiCam: false,
    underlineSceneHeadings: false,
    castListAfterSlug: false,
    underlineCharacterFirstIntro: false,
    sfxBolded: false,
    sceneNumbersAsLetters: false,
    portraitFrame: false,
    requireCliffhangerPerEpisode: false,
    requireRiseSpikeDropCliff: false,
    revisionColorsEnabled: true,
  },
  genres: ['drama'],
  tone: ['serialized', 'character-driven'],
  audience: 'adult',
  pacing: {
    profile: 'measured',
    avgScenePages: 2.0,
    tensionPeakIntervalPages: 10, // every act-out
  },
  substanceThresholds: {
    minBeatsPerAct: 5,
    minScenePerAct: 7,
    maxFillerPercent: 2,
    minTurnsPerScene: 1,
    minActiveProtagonistChoicesPerAct: 3,
  },
  // Hour drama: 5 acts, each carrying an act-out / cliffhanger.
  // Real pilots run 28–35 beats per episode with A + B + C (and sometimes D).
  substanceTargets: {
    beats:           { min: 24, ideal: 32, max: 40 },
    scenes:          { min: 32, ideal: 42, max: 55 },
    subplots:        { min: 3,  ideal: 4,  max: 5 },
    majorReveals:    { min: 4,  ideal: 6,  max: 8 },
    setupsPayoffs:   { min: 6,  ideal: 10, max: 14 },
    longSynopsisWords: { min: 500, ideal: 800, max: 1100 },
    namedCharacters: { min: 5,  ideal: 8,  max: 12 },
    subplotLabels: [
      { letter: 'A', conventionalRole: 'main episode plot' },
      { letter: 'B', conventionalRole: 'secondary lead arc (relational or partner POV)' },
      { letter: 'C', conventionalRole: 'ensemble subplot or runner' },
      { letter: 'D', conventionalRole: 'serialized engine / season arc thread' },
    ],
  },
  humanization: 'strict',
  verticalSandbox: false,
}

export const TV_30MIN_COMEDY_SINGLE_CAM: FormatConfig = {
  kind: 'tv_30min_comedy_single_cam',
  label: 'Half-Hour Single-Cam Comedy',
  description:
    'Half-hour single-camera comedy. 30 to 35 pages. Optional cold open and tag. Three acts of comic escalation, fast pacing, character-based jokes, strong scene turns.',
  medium: 'live_action',
  page: STANDARD_PAGE,
  structure: {
    actStructure: 'cold_open_plus_3_act_plus_tag',
    targetActs: 3,
    coldOpen: true,
    teaser: false,
    tag: true,
    targetPagesMin: 30,
    targetPagesMax: 35,
    episodesPerSeason: 8,
    expectActOuts: false,
  },
  conventions: {
    multiCam: false,
    underlineSceneHeadings: false,
    castListAfterSlug: false,
    underlineCharacterFirstIntro: false,
    sfxBolded: false,
    sceneNumbersAsLetters: false,
    portraitFrame: false,
    requireCliffhangerPerEpisode: false,
    requireRiseSpikeDropCliff: false,
    revisionColorsEnabled: true,
  },
  genres: ['comedy'],
  tone: ['comedic', 'character-based'],
  audience: 'adult',
  pacing: {
    profile: 'fast',
    avgScenePages: 1.5,
    tensionPeakIntervalPages: 8,
    gagIntervalSeconds: 45,
  },
  substanceThresholds: {
    minBeatsPerAct: 5,
    minScenePerAct: 7,
    maxFillerPercent: 3,
    minTurnsPerScene: 1,
    minActiveProtagonistChoicesPerAct: 3,
  },
  // Single-cam half-hour. Tight A/B (sometimes C), cold open + tag.
  substanceTargets: {
    beats:           { min: 16, ideal: 22, max: 28 },
    scenes:          { min: 22, ideal: 28, max: 36 },
    subplots:        { min: 2,  ideal: 3,  max: 4 },
    majorReveals:    { min: 2,  ideal: 3,  max: 5 },
    setupsPayoffs:   { min: 5,  ideal: 8,  max: 12 },
    longSynopsisWords: { min: 400, ideal: 600, max: 800 },
    namedCharacters: { min: 4,  ideal: 6,  max: 10 },
    subplotLabels: [
      { letter: 'A', conventionalRole: 'main comedic plot' },
      { letter: 'B', conventionalRole: 'secondary character storyline' },
      { letter: 'C', conventionalRole: 'runner / ensemble bit (when present)' },
    ],
  },
  humanization: 'strict',
  verticalSandbox: false,
}

export const TV_30MIN_COMEDY_MULTI_CAM: FormatConfig = {
  kind: 'tv_30min_comedy_multi_cam',
  label: 'Half-Hour Multi-Cam Comedy',
  description:
    'Half-hour multi-camera sitcom. 42 to 58 pages. ALL-CAPS action lines, double-spaced dialogue, scene headings underlined and lettered. Two to three acts plus optional cold open and tag. Theatrical scene architecture, callback ledger emphasis.',
  medium: 'live_action',
  page: MULTI_CAM_PAGE,
  structure: {
    actStructure: '3_act',
    targetActs: 3,
    coldOpen: true,
    teaser: false,
    tag: true,
    targetPagesMin: 42,
    targetPagesMax: 58,
    episodesPerSeason: 22,
    expectActOuts: true,
  },
  conventions: {
    multiCam: true,
    underlineSceneHeadings: true,
    castListAfterSlug: true,
    underlineCharacterFirstIntro: true,
    sfxBolded: true,
    sceneNumbersAsLetters: true,
    portraitFrame: false,
    requireCliffhangerPerEpisode: false,
    requireRiseSpikeDropCliff: false,
    revisionColorsEnabled: true,
  },
  genres: ['comedy'],
  tone: ['multi-cam', 'theatrical', 'audience-friendly'],
  audience: 'family',
  pacing: {
    profile: 'fast',
    avgScenePages: 4.0, // multi-cam runs longer pages per scene
    tensionPeakIntervalPages: 10,
    gagIntervalSeconds: 30,
  },
  substanceThresholds: {
    minBeatsPerAct: 5,
    minScenePerAct: 6,
    maxFillerPercent: 2,
    minTurnsPerScene: 1,
    minActiveProtagonistChoicesPerAct: 3,
  },
  // Multi-cam: fewer, longer scenes; punch-up-heavy.
  substanceTargets: {
    beats:           { min: 18, ideal: 22, max: 28 },
    scenes:          { min: 18, ideal: 24, max: 32 },
    subplots:        { min: 2,  ideal: 3,  max: 4 },
    majorReveals:    { min: 2,  ideal: 3,  max: 5 },
    setupsPayoffs:   { min: 6,  ideal: 10, max: 14 }, // callbacks are sacred in multi-cam
    longSynopsisWords: { min: 400, ideal: 600, max: 800 },
    namedCharacters: { min: 4,  ideal: 6,  max: 10 },
    subplotLabels: [
      { letter: 'A', conventionalRole: 'main plot of the week' },
      { letter: 'B', conventionalRole: 'second-lead storyline' },
      { letter: 'C', conventionalRole: 'C-story / runner bit' },
    ],
  },
  humanization: 'strict',
  verticalSandbox: false,
}

export const ANIMATION_2D: FormatConfig = {
  kind: 'animation_2d',
  label: '2D Animation',
  description:
    '2D animated screenplay. Visual storytelling first, strong silhouettes, clear world rules, efficient dialogue, stylized movement. Audience and runtime configurable.',
  medium: 'animation',
  page: STANDARD_PAGE,
  structure: {
    actStructure: '3_act',
    targetActs: 3,
    coldOpen: false,
    teaser: false,
    tag: false,
    targetPagesMin: 22,
    targetPagesMax: 100,
    expectActOuts: false,
  },
  conventions: {
    multiCam: false,
    underlineSceneHeadings: false,
    castListAfterSlug: false,
    underlineCharacterFirstIntro: false,
    sfxBolded: false,
    sceneNumbersAsLetters: false,
    portraitFrame: false,
    requireCliffhangerPerEpisode: false,
    requireRiseSpikeDropCliff: false,
    revisionColorsEnabled: true,
  },
  genres: ['family'],
  tone: ['visual-first', 'world-driven'],
  audience: 'family',
  pacing: {
    profile: 'fast',
    avgScenePages: 1.5,
    tensionPeakIntervalPages: 8,
  },
  substanceThresholds: {
    minBeatsPerAct: 6,
    minScenePerAct: 8,
    maxFillerPercent: 2,
    minTurnsPerScene: 1,
    minActiveProtagonistChoicesPerAct: 3,
  },
  // 2D animation runtimes vary widely (short → feature). Targets here assume
  // a roughly 22-page TV episode. For 90-minute features the user should
  // bump targetPages and the AI will scale beat count proportionally.
  substanceTargets: {
    beats:           { min: 18, ideal: 24, max: 32 },
    scenes:          { min: 24, ideal: 32, max: 42 },
    subplots:        { min: 2,  ideal: 3,  max: 4 },
    majorReveals:    { min: 3,  ideal: 4,  max: 6 },
    setupsPayoffs:   { min: 5,  ideal: 8,  max: 12 },
    longSynopsisWords: { min: 500, ideal: 700, max: 1000 },
    namedCharacters: { min: 4,  ideal: 6,  max: 10 },
    subplotLabels: [
      { letter: 'A', conventionalRole: 'main external adventure' },
      { letter: 'B', conventionalRole: 'emotional / relationship arc' },
      { letter: 'C', conventionalRole: 'comic relief or ensemble runner' },
    ],
  },
  humanization: 'strict',
  verticalSandbox: false,
}

export const VERTICAL: FormatConfig = {
  kind: 'vertical',
  label: 'Vertical Drama / Vertical Series',
  description:
    'Mobile-first vertical drama. 30 to 70 episodes, each 60-90 seconds, organized into 6-9 cycles of 4-8 episodes each. Each episode follows Rise/Spike/Drop/Cliff. Romance or Revenge engine. On-the-nose dialogue, high hook density, trope-stack-driven.',
  medium: 'live_action',
  page: VERTICAL_PAGE,
  structure: {
    actStructure: 'episode_cycles',
    targetActs: 0,
    coldOpen: false,
    teaser: false,
    tag: false,
    targetPagesMin: 60,
    targetPagesMax: 100,
    episodesPerSeason: 50,
    cyclesPerSeason: 8,
    episodesPerCycle: 6,
    beatsPerEpisode: 4,
    targetEpisodeRuntimeSeconds: 75,
    expectActOuts: false,
  },
  conventions: {
    multiCam: false,
    underlineSceneHeadings: false,
    castListAfterSlug: false,
    underlineCharacterFirstIntro: false,
    sfxBolded: false,
    sceneNumbersAsLetters: false,
    portraitFrame: true,
    requireCliffhangerPerEpisode: true,
    requireRiseSpikeDropCliff: true,
    revisionColorsEnabled: true,
  },
  genres: ['romance', 'drama'],
  tone: ['melodramatic', 'on-the-nose', 'high-hook'],
  audience: 'adult',
  pacing: {
    profile: 'vertical',
    avgScenePages: 1.0,
    tensionPeakIntervalPages: 1, // peak per episode
  },
  substanceThresholds: {
    minBeatsPerAct: 4,
    minScenePerAct: 4,
    maxFillerPercent: 0, // zero filler in vertical
    minTurnsPerScene: 1,
    minActiveProtagonistChoicesPerAct: 1,
  },
  // Vertical computes from episodes × 4 (Rise/Spike/Drop/Cliff). For a
  // 50-episode arc that's 200 beats — but the UI presents per-episode
  // counts. We track totals here so substance check can validate.
  substanceTargets: {
    beats:           { min: 120, ideal: 200, max: 280 },
    scenes:          { min: 100, ideal: 160, max: 240 },
    subplots:        { min: 2,   ideal: 3,   max: 5 },
    majorReveals:    { min: 8,   ideal: 14,  max: 22 },
    setupsPayoffs:   { min: 12,  ideal: 20,  max: 36 },
    longSynopsisWords: { min: 600, ideal: 1000, max: 1500 },
    namedCharacters: { min: 4,   ideal: 6,   max: 9 },
    subplotLabels: [
      { letter: 'A', conventionalRole: 'central romance / revenge engine' },
      { letter: 'B', conventionalRole: 'rival / betrayer / love-triangle arc' },
      { letter: 'C', conventionalRole: 'family or workplace runner' },
    ],
  },
  humanization: 'vertical_relaxed_dialogue',
  verticalSandbox: true,
}

export const PRESETS: Record<string, FormatConfig> = {
  feature_drama: FEATURE_DRAMA,
  feature_comedy: FEATURE_COMEDY,
  feature_horror: FEATURE_HORROR,
  tv_1hr_drama: TV_1HR_DRAMA,
  tv_30min_comedy_single_cam: TV_30MIN_COMEDY_SINGLE_CAM,
  tv_30min_comedy_multi_cam: TV_30MIN_COMEDY_MULTI_CAM,
  animation_2d: ANIMATION_2D,
  vertical: VERTICAL,
}

export const PRESET_LIST = [
  FEATURE_DRAMA,
  FEATURE_COMEDY,
  FEATURE_HORROR,
  TV_1HR_DRAMA,
  TV_30MIN_COMEDY_SINGLE_CAM,
  TV_30MIN_COMEDY_MULTI_CAM,
  ANIMATION_2D,
  VERTICAL,
] as const
