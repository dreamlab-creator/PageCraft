/**
 * Element Routing Logic — replicates Final Draft 13's Tab/Enter behavior.
 *
 * Sourced from the Final Draft 13 User Guide (Format > Elements > Behavior):
 *
 *   Tab:
 *     Scene Heading → Action
 *     Action → Character
 *     Character → Parenthetical (default) OR Transition (when Character is blank)
 *     Dialogue → Parenthetical
 *     Parenthetical → Dialogue
 *     Transition → Scene Heading
 *
 *   Enter/Return (at end of a paragraph):
 *     Scene Heading → Action
 *     Action → Action
 *     Character → Dialogue
 *     Dialogue → Action (default; settable to Character for fast dialogue)
 *     Parenthetical → Dialogue
 *     Transition → Scene Heading
 *
 *   Cmd+1..9 force-creates the corresponding element type.
 */

import type { ScreenplayElementType } from '@/types'

/**
 * Map: pressing Tab at the end of a paragraph of [type], with the current
 * paragraph empty?, produces a new paragraph of [returned type] (or "stay"
 * if Tab toggles within the same element, like scene-heading parts).
 */
export const TAB_ROUTE: Record<
  ScreenplayElementType,
  { ifEmpty?: ScreenplayElementType; ifContent?: ScreenplayElementType }
> = {
  scene_heading: { ifEmpty: 'action', ifContent: 'action' },
  action:        { ifEmpty: 'character', ifContent: 'character' },
  character:     { ifEmpty: 'transition', ifContent: 'parenthetical' },
  dialogue:      { ifEmpty: 'parenthetical', ifContent: 'parenthetical' },
  parenthetical: { ifEmpty: 'dialogue', ifContent: 'dialogue' },
  transition:    { ifEmpty: 'scene_heading', ifContent: 'scene_heading' },
  shot:          { ifEmpty: 'action', ifContent: 'action' },
  general:       { ifEmpty: 'character', ifContent: 'character' },
  lyric:         { ifEmpty: 'action', ifContent: 'action' },
  cast_list:     { ifEmpty: 'action', ifContent: 'action' },
  sfx:           { ifEmpty: 'action', ifContent: 'action' },
  act_label:     { ifEmpty: 'scene_heading', ifContent: 'scene_heading' },
  episode_label: { ifEmpty: 'scene_heading', ifContent: 'scene_heading' },
  centered_text: { ifEmpty: 'action', ifContent: 'action' },
  page_break:    { ifEmpty: 'scene_heading', ifContent: 'scene_heading' },
  note:          { ifEmpty: 'action', ifContent: 'action' },
}

/**
 * Map: pressing Enter at the end of a paragraph produces the next logical
 * paragraph type. (User can override via project settings — e.g., set
 * Dialogue → Character for fast dialogue.)
 */
export const ENTER_ROUTE_DEFAULT: Record<ScreenplayElementType, ScreenplayElementType> = {
  scene_heading: 'action',
  action:        'action',
  character:     'dialogue',
  dialogue:      'action',
  parenthetical: 'dialogue',
  transition:    'scene_heading',
  shot:          'action',
  general:       'general',
  lyric:         'lyric',
  cast_list:     'action',
  sfx:           'action',
  act_label:     'scene_heading',
  episode_label: 'scene_heading',
  centered_text: 'action',
  page_break:    'scene_heading',
  note:          'action',
}

/** Cmd+1..Cmd+9 force-create map. */
export const ELEMENT_HOTKEYS: Record<string, ScreenplayElementType> = {
  '1': 'scene_heading',
  '2': 'action',
  '3': 'character',
  '4': 'parenthetical',
  '5': 'dialogue',
  '6': 'transition',
  '7': 'shot',
  '8': 'general',
  '9': 'cast_list',
}

/** Human-readable name. */
export const ELEMENT_LABEL: Record<ScreenplayElementType, string> = {
  scene_heading: 'Scene Heading',
  action:        'Action',
  character:     'Character',
  dialogue:      'Dialogue',
  parenthetical: 'Parenthetical',
  transition:    'Transition',
  shot:          'Shot',
  general:       'General',
  lyric:         'Lyric',
  cast_list:     'Cast List',
  sfx:           'SFX',
  act_label:     'Act Label',
  episode_label: 'Episode Label',
  centered_text: 'Centered',
  page_break:    'Page Break',
  note:          'Note',
}

export function nextElementOnEnter(
  current: ScreenplayElementType,
  override?: Partial<Record<ScreenplayElementType, ScreenplayElementType>>,
): ScreenplayElementType {
  return (override && override[current]) ?? ENTER_ROUTE_DEFAULT[current]
}

export function nextElementOnTab(
  current: ScreenplayElementType,
  currentTextIsEmpty: boolean,
): ScreenplayElementType {
  const route = TAB_ROUTE[current]
  return currentTextIsEmpty ? (route.ifEmpty ?? route.ifContent!) : (route.ifContent ?? route.ifEmpty!)
}
