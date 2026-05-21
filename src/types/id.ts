import { nanoid } from 'nanoid'

/** Branded ID types for compile-time safety. They are all strings at runtime. */
export type ProjectId = string & { readonly __brand: 'ProjectId' }
export type ElementId = string & { readonly __brand: 'ElementId' }
export type CharacterId = string & { readonly __brand: 'CharacterId' }
export type LocationId = string & { readonly __brand: 'LocationId' }
export type BeatId = string & { readonly __brand: 'BeatId' }
export type SceneCardId = string & { readonly __brand: 'SceneCardId' }
export type ReferenceId = string & { readonly __brand: 'ReferenceId' }
export type VersionId = string & { readonly __brand: 'VersionId' }
export type NoteId = string & { readonly __brand: 'NoteId' }
export type SetupPayoffId = string & { readonly __brand: 'SetupPayoffId' }
export type EpisodeId = string & { readonly __brand: 'EpisodeId' }
export type CycleId = string & { readonly __brand: 'CycleId' }
export type LoopId = string & { readonly __brand: 'LoopId' }

export const newId = <T extends string>() => nanoid(12) as T
