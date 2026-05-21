/**
 * Reference Materials subsystem types.
 *
 * A reference is any document the user uploads with an attached intent. The
 * AI uses it according to that intent: as a style template, a structural
 * model, a content source for transformation, a canon document, or as
 * extraction source for characters/beats/world rules.
 */

import type { ReferenceId, CharacterId, BeatId, SceneCardId } from './id'

export type ReferenceFormat =
  | 'pdf'
  | 'docx'
  | 'txt'
  | 'md'
  | 'fountain'
  | 'fdx'
  | 'json'
  | 'image'
  | 'other'

/** How the AI is permitted to use the reference. */
export type ReferenceMode =
  | 'style'           // study-only: match cadence/tone/voice
  | 'structure'       // study-only: match beat structure/act pattern
  | 'content_source'  // user owns it, AI may transform directly
  | 'canon'           // immutable facts, never contradict
  | 'extraction'      // one-time pull of characters/beats/world
  | 'mixed'

/** Tags describing what facet of the reference is targeted. */
export type ReferenceTag =
  | 'dialogue'
  | 'tone'
  | 'pacing'
  | 'voice'
  | 'rewrite_source'
  | 'outline_source'
  | 'world_rules'
  | 'character_bible'
  | 'series_bible'
  | 'mood_board'
  | 'treatment'
  | 'beat_sheet'
  | 'pitch_deck'

/** Scope of a reference's application. */
export type ReferenceScopeKind =
  | 'project'
  | 'character'
  | 'scene'
  | 'beat'
  | 'mode_planning'
  | 'mode_writing'

/** Style fingerprint — a compact compressed style signature derived from a reference. */
export interface StyleFingerprint {
  // Average sentence length (in dialogue + action separately).
  avgDialogueSentenceLength: number
  avgActionSentenceLength: number
  // Sentence length distribution percentiles.
  sentenceLengthPercentiles: { p10: number; p50: number; p90: number }
  // Estimated dialogue ratio (% of text that's dialogue).
  dialogueRatio: number
  // Action line block size distribution.
  avgActionParagraphLines: number
  // Vocabulary register estimation.
  vocabularyRegister: 'formal' | 'literary' | 'plainspoken' | 'casual' | 'street' | 'mixed'
  // Cadence rhythm.
  cadence: 'staccato' | 'flowing' | 'mixed' | 'lyrical' | 'kinetic'
  // Emphasis on visual specificity (objects, sensory cues).
  visualSpecificity: 'low' | 'medium' | 'high' | 'very_high'
  // Interiority leak — is the source using novelistic interiority in action?
  interiorityLeak: 'none' | 'low' | 'medium' | 'high'
  // Tone tags.
  toneTags: string[]
  // Genre cues.
  genreCues: string[]
  // Per-character: line counts + sample lines (if a screenplay).
  characterSamples?: Array<{
    name: string
    lineCount: number
    sampleLines: string[]
    estimatedSentenceLength: number
  }>
}

/** Parsed structured content extracted from a reference. */
export interface ParsedReference {
  type: 'screenplay' | 'outline' | 'treatment' | 'beat_sheet' | 'character_bible' | 'world_bible' | 'notes' | 'pitch_deck' | 'image' | 'other'
  // Auto-generated summary of the content (paragraph).
  summary: string
  // For screenplay-parsed references: characters, scenes, beats extracted.
  extractedCharacters?: Array<{
    name: string
    intro?: string
    lineCount: number
  }>
  extractedScenes?: Array<{
    slug: string
    summary: string
  }>
  extractedBeats?: Array<{
    title: string
    body: string
  }>
  // For world bibles: facts.
  extractedFacts?: string[]
}

/** A single reference material attached to a project. */
export interface Reference {
  id: ReferenceId
  filename: string
  format: ReferenceFormat
  // Raw extracted text (for non-image formats).
  raw: string
  uploadedAt: number
  // User's free-text instruction for how to use this.
  intent: string
  // Structured mode.
  mode: ReferenceMode
  // Scope.
  scope: {
    kind: ReferenceScopeKind
    id?: string // character id, scene id, beat id when scoped
  }
  // Tags.
  tags: ReferenceTag[]
  // Optional parsed content.
  parsed?: ParsedReference
  // Optional computed style fingerprint.
  fingerprint?: StyleFingerprint
  // Active vs paused.
  active: boolean
  // Token budget estimate (approximate; used to manage AI context budget).
  estimatedTokens: number
  // IP posture: does the user own this? (Required true for content_source mode.)
  ownedByUser: boolean
}
