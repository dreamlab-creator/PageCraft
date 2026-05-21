import { useEffect, useMemo, useState } from 'react'
import type { ScreenplayElement, ElementId, Project } from '@/types'
import { useProjectStore } from '@/store'
import {
  STANDARD_SCENE_INTROS,
  STANDARD_TIMES_OF_DAY,
  STANDARD_TRANSITIONS,
  STANDARD_CHARACTER_EXTENSIONS,
} from '@/lib/screenplay/auto-detect'

interface Props {
  activeId: ElementId | null
  elements: ScreenplayElement[]
  project: Project
}

/**
 * Floating SmartType popup. When the user is typing certain elements, we
 * suggest completions:
 *   - Scene Heading partial: scene intros + known locations + times of day
 *   - Character partial: known characters + extensions
 *   - Transition partial: standard transitions
 *
 * The popup follows the caret position. Selection with arrow keys, Tab/Enter
 * to accept, Escape to dismiss.
 */
export function SmartTypePopup({ activeId, elements, project }: Props) {
  const active = elements.find(e => e.id === activeId)
  const updateElement = useProjectStore(s => s.updateElement)
  const [caret, setCaret] = useState<{ x: number; y: number } | null>(null)
  const [selected, setSelected] = useState(0)

  // Known location names from existing scene headings.
  const knownLocations = useMemo(() => {
    const set = new Set<string>()
    for (const e of elements) {
      if (e.type === 'scene_heading' && e.sceneLocation) set.add(e.sceneLocation.toUpperCase())
    }
    return Array.from(set).sort()
  }, [elements])

  // Known character names.
  const knownCharacters = useMemo(() => {
    const set = new Set<string>()
    for (const c of project.characters) set.add(c.name.toUpperCase())
    for (const e of elements) {
      if (e.type === 'character' && e.text.trim()) set.add(e.text.trim().toUpperCase().replace(/\s*\([^)]*\)\s*$/, ''))
    }
    return Array.from(set).sort()
  }, [project.characters, elements])

  // What suggestions to show.
  const suggestions = useMemo(() => {
    if (!active) return []
    const text = active.text
    switch (active.type) {
      case 'scene_heading': {
        // If empty or just typing intro: suggest intros.
        if (!text || /^(I|E|EST)?$/i.test(text.trim())) {
          return STANDARD_SCENE_INTROS as readonly string[]
        }
        // If intro is set, suggest locations.
        const m = text.match(/^(INT\.?|EXT\.?|EST\.?|INT\/EXT|I\/E\.?)\s+(.*)$/i)
        if (m) {
          const tail = m[2].toUpperCase().split('-')[0].trim()
          if (!text.includes('-')) {
            return knownLocations.filter(l => l.startsWith(tail))
          }
          // After dash, suggest times of day.
          const after = (text.split('-').pop() ?? '').trim().toUpperCase()
          return (STANDARD_TIMES_OF_DAY as readonly string[]).filter(t => t.startsWith(after))
        }
        return []
      }
      case 'character': {
        const partial = text.trim().toUpperCase().replace(/\s*\([^)]*\)\s*$/, '')
        if (/\($/.test(text)) return STANDARD_CHARACTER_EXTENSIONS as readonly string[]
        return knownCharacters.filter(c => c.startsWith(partial)).slice(0, 8)
      }
      case 'transition': {
        const partial = text.trim().toUpperCase()
        return (STANDARD_TRANSITIONS as readonly string[]).filter(t => t.startsWith(partial)).slice(0, 8)
      }
      default:
        return []
    }
  }, [active, knownLocations, knownCharacters])

  // Track caret to position the popup.
  useEffect(() => {
    if (!suggestions.length) { setCaret(null); return }
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) { setCaret(null); return }
    const range = sel.getRangeAt(0).cloneRange()
    const rect = range.getBoundingClientRect()
    if (rect.top === 0 && rect.bottom === 0) {
      // Find the active block's rect instead.
      const block = document.querySelector<HTMLElement>(`[data-block-id="${activeId}"]`)
      if (block) {
        const br = block.getBoundingClientRect()
        setCaret({ x: br.left + 60, y: br.top + br.height + 4 })
      } else {
        setCaret(null)
      }
    } else {
      setCaret({ x: rect.left, y: rect.bottom + 4 })
    }
  }, [activeId, suggestions, active?.text])

  useEffect(() => { setSelected(0) }, [activeId, active?.text])

  useEffect(() => {
    if (!suggestions.length || !active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(suggestions.length - 1, s + 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(0, s - 1)) }
      if (e.key === 'Escape')    { e.preventDefault(); setCaret(null) }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault()
        accept(suggestions[selected])
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [suggestions, selected, active])

  const accept = (value: string) => {
    if (!active) return
    if (active.type === 'scene_heading') {
      const text = active.text
      if (!text || /^(I|E|EST)?$/i.test(text.trim())) {
        updateElement(active.id as ElementId, { text: `${value} ` })
      } else if (!text.includes('-')) {
        const m = text.match(/^(INT\.?|EXT\.?|EST\.?|INT\/EXT|I\/E\.?)\s+(.*)$/i)
        if (m) {
          updateElement(active.id as ElementId, { text: `${m[1]} ${value} - ` })
        }
      } else {
        const head = text.slice(0, text.lastIndexOf('-') + 1)
        updateElement(active.id as ElementId, { text: `${head} ${value}` })
      }
    } else if (active.type === 'character') {
      if (/\($/.test(active.text)) {
        updateElement(active.id as ElementId, { text: `${active.text}${value})` })
      } else {
        updateElement(active.id as ElementId, { text: value })
      }
    } else if (active.type === 'transition') {
      updateElement(active.id as ElementId, { text: value })
    }
    setCaret(null)
  }

  if (!caret || !suggestions.length) return null

  return (
    <div
      className="fixed z-30 min-w-[160px] border shadow-lg"
      style={{ left: caret.x, top: caret.y, background: 'var(--bg-elev)', borderColor: 'var(--border)' }}
    >
      <ul className="max-h-64 overflow-y-auto subtle-scrollbar text-sm">
        {suggestions.map((s, i) => (
          <li
            key={`${s}-${i}`}
            onMouseDown={(e) => { e.preventDefault(); accept(s) }}
            className="cursor-pointer px-3 py-1.5 screenplay-font"
            style={{
              background: i === selected ? 'var(--bg-deep)' : 'transparent',
              color: 'var(--fg)',
              fontSize: 12,
            }}
          >
            {s}
          </li>
        ))}
      </ul>
    </div>
  )
}
