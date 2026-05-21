/**
 * SubplotLegend — color legend strip + quick editor at the top of the
 * Beat Board.
 *
 * Lets the writer see at a glance which color codes which thread (A, B,
 * C, D), rename a thread, edit its description / dramatic question,
 * change its color, or add a new subplot. Beat cards on the board are
 * tinted by the primary subplot's color.
 */

import { useState } from 'react'
import { useProjectStore, useUIStore } from '@/store'
import type { Subplot } from '@/types'
import { newId } from '@/types'
import { DEFAULT_SUBPLOT_COLORS } from '@/lib/storage/blank-project'

export function SubplotLegend() {
  const project = useProjectStore(s => s.project)
  const patchPlanning = useProjectStore(s => s.patchPlanning)
  const navigateTo = useUIStore(s => s.navigateTo)
  const [openId, setOpenId] = useState<string | null>(null)

  if (!project) return null

  const subplots = project.planning.subplots ?? []
  const beatsBySubplotId = countBeatsBySubplot(project)
  // Vertical projects use "Loops (Cycles)" terminology in place of
  // subplots. The data shape is the same; the label flips per format.
  const isVertical = !!project.format.verticalSandbox
  const SECTION_LABEL = isVertical ? 'Loops (Cycles)' : 'Subplots'
  const ADD_FIRST_LABEL = isVertical ? '+ Add first loop' : '+ Add first subplot'

  const updateSubplot = (id: string, patch: Partial<Subplot>) => {
    patchPlanning({
      subplots: subplots.map(s => s.id === id ? { ...s, ...patch } : s),
    })
  }

  const removeSubplot = (id: string) => {
    patchPlanning({ subplots: subplots.filter(s => s.id !== id) })
    if (openId === id) setOpenId(null)
  }

  const addSubplot = () => {
    const nextLetter = nextAvailableLetter(subplots)
    const nextColor = DEFAULT_SUBPLOT_COLORS[subplots.length % DEFAULT_SUBPLOT_COLORS.length]
    const created: Subplot = {
      id: newId<any>(),
      letter: nextLetter,
      label: `${nextLetter}-story`,
      description: '',
      characterIds: [],
      dramaticQuestion: '',
      color: nextColor,
    }
    patchPlanning({ subplots: [...subplots, created] })
    setOpenId(created.id)
  }

  if (subplots.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
        <span className="uppercase tracking-widest">{SECTION_LABEL}</span>
        <button onClick={addSubplot} className="hover:underline" style={{ color: 'var(--fg-soft)' }}>
          {ADD_FIRST_LABEL}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
        {SECTION_LABEL}
      </span>
      {subplots.map(sp => {
        const count = beatsBySubplotId.get(sp.id) ?? 0
        return (
          <button
            key={sp.id}
            onClick={() => setOpenId(openId === sp.id ? null : sp.id)}
            className="flex items-center gap-1.5 border px-2 py-1"
            style={{
              borderColor: openId === sp.id ? 'var(--fg)' : 'var(--border)',
              background: 'var(--bg)',
              color: 'var(--fg)',
            }}
            title={sp.description || sp.label}
          >
            <span className="inline-block h-3 w-3" style={{ background: sp.color, border: '1px solid rgba(0,0,0,0.2)' }} />
            <span className="font-semibold">{sp.letter}</span>
            <span style={{ color: 'var(--fg-soft)' }}>{sp.label}</span>
            {count > 0 && (
              <span className="ml-1 text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                {count}
              </span>
            )}
          </button>
        )
      })}
      <button onClick={addSubplot} className="hover:underline" style={{ color: 'var(--fg-soft)' }}>
        + Add
      </button>
      <button
        onClick={() => navigateTo({ mode: 'planning', planningTab: 'theme' })}
        className="text-[10px] uppercase tracking-widest hover:underline"
        style={{ color: 'var(--fg-muted)' }}
        title="Subplot descriptions are edited in Theme · Stakes"
      >
        Edit in Theme · Stakes ↗
      </button>

      {openId && (() => {
        const sp = subplots.find(s => s.id === openId)
        if (!sp) return null
        return (
          <div
            className="mt-2 w-full border p-3"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
          >
            <div className="mb-2 flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                Letter
              </span>
              <input
                value={sp.letter}
                onChange={e => updateSubplot(sp.id, { letter: e.target.value.toUpperCase().slice(0, 2) })}
                className="input max-w-[60px] text-xs font-semibold"
              />
              <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                Label
              </span>
              <input
                value={sp.label}
                onChange={e => updateSubplot(sp.id, { label: e.target.value })}
                className="input text-xs"
              />
              <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                Color
              </span>
              <input
                type="color"
                value={sp.color}
                onChange={e => updateSubplot(sp.id, { color: e.target.value })}
                className="h-7 w-9 border-0 bg-transparent p-0"
              />
              <button
                onClick={() => removeSubplot(sp.id)}
                className="ml-auto text-[10px] uppercase tracking-widest hover:underline"
                style={{ color: 'var(--fg-muted)' }}
              >
                Delete
              </button>
            </div>
            <div className="mb-2">
              <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                Description
              </span>
              <textarea
                value={sp.description}
                onChange={e => updateSubplot(sp.id, { description: e.target.value })}
                className="textarea mt-1 text-xs"
                rows={2}
                placeholder='e.g. "Maya repairs her relationship with her estranged sister"'
              />
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                Dramatic question
              </span>
              <input
                value={sp.dramaticQuestion}
                onChange={e => updateSubplot(sp.id, { dramaticQuestion: e.target.value })}
                className="input mt-1 text-xs"
                placeholder='e.g. "Will Maya let her sister back in before the wedding?"'
              />
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function countBeatsBySubplot(project: { beats: { subplotIds?: string[] }[] }): Map<string, number> {
  const out = new Map<string, number>()
  for (const b of project.beats) {
    const primary = b.subplotIds?.[0]
    if (!primary) continue
    out.set(primary, (out.get(primary) ?? 0) + 1)
  }
  return out
}

function nextAvailableLetter(subplots: { letter: string }[]): string {
  const used = new Set(subplots.map(s => s.letter.toUpperCase()))
  for (const c of 'ABCDEFGHIJKLMN') {
    if (!used.has(c)) return c
  }
  return 'Z'
}
