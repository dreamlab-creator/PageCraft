import type { ScreenplayElement, ScreenplayElementType, ElementId } from '@/types'
import { ELEMENT_LABEL, ELEMENT_HOTKEYS } from '@/lib/screenplay/routing'
import { useProjectStore } from '@/store'

interface Props {
  activeId: ElementId | null
  elements: ScreenplayElement[]
  onChangeType: (id: ElementId, type: ScreenplayElementType) => void
}

const TYPES_PRESTIGE: ScreenplayElementType[] = [
  'scene_heading',
  'action',
  'character',
  'parenthetical',
  'dialogue',
  'transition',
  'shot',
  'general',
  'cast_list',
  'act_label',
]

const TYPES_VERTICAL: ScreenplayElementType[] = [
  'scene_heading',
  'action',
  'character',
  'parenthetical',
  'dialogue',
  'transition',
  'shot',
  'general',
  'cast_list',
  'episode_label',
]

/**
 * A small floating dropdown-equivalent that shows the current element type.
 * Mimics Final Draft's Element dropdown.
 */
export function ElementStatusChip({ activeId, elements, onChangeType }: Props) {
  const project = useProjectStore(s => s.project)
  const active = elements.find(e => e.id === activeId)
  if (!active) return null

  const isVertical = !!project?.format.verticalSandbox
  const TYPES = isVertical ? TYPES_VERTICAL : TYPES_PRESTIGE

  // Friendlier label for Act vs Episode break depending on format.
  const labelFor = (t: ScreenplayElementType): string => {
    if (t === 'act_label') return 'Act Break'
    if (t === 'episode_label') return 'Episode Break'
    return ELEMENT_LABEL[t]
  }

  // Rendered INLINE inside the shared sticky toolbar (see ScreenplayEditor).
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
        Element
      </span>
      <select
        value={active.type}
        onChange={e => onChangeType(active.id as ElementId, e.target.value as ScreenplayElementType)}
        className="select max-w-[220px] py-1 text-xs"
        style={{ borderColor: 'var(--border)' }}
      >
        {TYPES.map(t => {
          const hotkey = Object.entries(ELEMENT_HOTKEYS).find(([, v]) => v === t)?.[0]
          return (
            <option key={t} value={t}>
              {labelFor(t)}{hotkey ? `  (⌘${hotkey})` : ''}
            </option>
          )
        })}
      </select>
    </div>
  )
}
