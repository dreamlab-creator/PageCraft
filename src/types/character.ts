import type { CharacterId } from './id'

/** Character function in the story. Tracked by the Story Doctor. */
export type CharacterRole =
  | 'protagonist'
  | 'antagonist'
  | 'love_interest'
  | 'ally'
  | 'foil'
  | 'mentor'
  | 'tempter'
  | 'ghost'         // the wound personified
  | 'supporting'
  | 'minor'
  | 'ensemble'

/**
 * A character's voice fingerprint — the multi-axis vector used to enforce
 * consistency across dialogue. The Voice Check grades every line against the
 * fingerprint and flags drift.
 *
 * The fingerprint can be:
 *   - hand-defined by the user
 *   - auto-calibrated from the first ~100 lines a character speaks
 *   - imported from a Reference (e.g., "match this character's voice")
 */
export interface VoiceFingerprint {
  // Sentence length register. "staccato" = mostly <8 words. "expansive" = >18.
  sentenceLength: 'staccato' | 'short' | 'medium' | 'long' | 'expansive' | 'variable'
  // Vocabulary register.
  vocabulary: 'street' | 'casual' | 'plainspoken' | 'formal' | 'literary' | 'period' | 'technical'
  // Speech rhythm.
  rhythm: 'clipped' | 'flowing' | 'interrupted' | 'rolling' | 'measured' | 'breathless'
  // Humor mode.
  humor: 'none' | 'dry' | 'absurd' | 'self_deprecating' | 'cruel' | 'observational' | 'situational' | 'wordplay'
  // Emotional restraint level.
  restraint: 'closed' | 'guarded' | 'mixed' | 'open' | 'effusive'
  // Default tactics in conflict.
  defaultTactics: Array<'attack' | 'evade' | 'charm' | 'bargain' | 'withdraw' | 'manipulate' | 'plead' | 'mock' | 'confess' | 'lecture' | 'flirt' | 'threaten'>
  // Vocabulary tendencies — favorite words, never-uses, regionalisms.
  favoriteWords: string[]
  bannedWords: string[]
  // Verbal tics: recurring phrases, sign-offs, opening words.
  verbalTics: string[]
  // Contraction policy.
  contractions: 'almost_always' | 'usually' | 'sometimes' | 'rarely' | 'never'
  // Profanity register.
  profanity: 'none' | 'mild' | 'casual' | 'heavy' | 'creative'
  // Free-text notes about the voice (paragraph-level).
  notes: string
}

/**
 * A character's evolving state through the story. Updated as scenes are
 * written. The Continuity Engine reads this so an AI draft can't put a
 * dead character on screen or have a character know something they shouldn't.
 */
export interface CharacterState {
  // Current emotional pitch (-5 broken to +5 elated, 0 neutral).
  emotionalPitch: number
  // Physical condition: injuries, exhaustion, etc.
  physicalCondition: string
  // Current location.
  currentLocation: string
  // What this character currently knows that the audience also knows.
  knowsFacts: string[]
  // What this character does NOT know yet that the audience does.
  unawareFacts: string[]
  // What this character has promised to do, ledger.
  promises: Array<{ id: string; promise: string; toCharacter?: string; resolved: boolean }>
  // Open conflicts (per-relationship).
  openConflicts: Array<{ withCharacter: string; nature: string }>
  // Last tactic used in dialogue.
  lastTactic?: string
  // Page on which this state snapshot was set.
  asOfPage?: number
}

/**
 * The full character bible entry. This is what's authored in Planning Mode,
 * Characters panel.
 */
export interface Character {
  id: CharacterId
  // Display name. ALL CAPS preserved for screenplay use.
  name: string
  // Casting age range, e.g., "30s", "60", "early 20s".
  age: string
  // Visual + behavioral description for the screenplay's first introduction.
  // Should be concise (1-2 lines max) and playable.
  shortDescription: string
  // Longer biographical notes — not for the script pages.
  biography: string
  role: CharacterRole

  // The three pillars (Want/Need/Wound architecture).
  externalGoal: string
  internalNeed: string
  wound: string
  // Secondary architecture.
  fear: string
  flaw: string
  secret: string
  // Stakes
  publicCost: string  // What they lose externally if they fail
  privateCost: string // What they lose internally if they fail
  // Arc: state at start vs end of story (the transformation).
  arcStart: string
  arcEnd: string
  // Final choice that proves transformation.
  arcTurn: string

  // Relationships: per-other-character dynamics.
  relationships: Array<{
    withCharacterId: CharacterId
    nature: string // "estranged daughter", "rival", "co-conspirator"
    initialState: string
    endState: string
  }>

  voice: VoiceFingerprint
  state: CharacterState

  // Tracking: has this character been introduced (first-appearance ALL CAPS in action)?
  introduced: boolean
  // Page number of first introduction (for the Character Intro Checker).
  introducedAtPage?: number

  // User-defined locks on the character.
  lockedFields: Array<keyof Character>

  // Visual: optional headshot / casting reference image (data URL or asset ref).
  referenceImage?: string

  // Color used in the Highlight Characters feature (FD-style).
  highlightColor?: string

  /**
   * Where this character came from. Used by the cast reconciler to tell
   * apart hand-authored, AI-generated, and auto-adopted-from-script entries.
   *
   *   - 'user'        : the writer created and edited it.
   *   - 'ai_bible'    : produced by Generate Character (full bible).
   *   - 'ai_scene'    : the AI introduced this name while drafting a scene
   *                     and a stub bible was created on accept.
   *   - 'auto_script' : the writer typed this name as a character cue or
   *                     ALL-CAPS intro and the editor adopted it as a stub.
   */
  provenance?: 'user' | 'ai_bible' | 'ai_scene' | 'auto_script'

  /** Set when this character is still a stub the user hasn't reviewed. */
  needsReview?: boolean

  /** First page where this name was seen in the script (for the audit). */
  firstSeenAtPage?: number
}

/** Helper: a fresh blank voice fingerprint for a new character. */
export const blankVoiceFingerprint = (): VoiceFingerprint => ({
  sentenceLength: 'medium',
  vocabulary: 'plainspoken',
  rhythm: 'flowing',
  humor: 'none',
  restraint: 'mixed',
  defaultTactics: [],
  favoriteWords: [],
  bannedWords: [],
  verbalTics: [],
  contractions: 'usually',
  profanity: 'none',
  notes: '',
})

/** Helper: a fresh blank character state. */
export const blankCharacterState = (): CharacterState => ({
  emotionalPitch: 0,
  physicalCondition: 'baseline',
  currentLocation: '',
  knowsFacts: [],
  unawareFacts: [],
  promises: [],
  openConflicts: [],
})
