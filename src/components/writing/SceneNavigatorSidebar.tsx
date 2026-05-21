import { useMemo } from 'react'
import { useProjectStore } from '@/store'
import type { ElementId } from '@/types'

export function SceneNavigatorSidebar() {
  const project = useProjectStore(s => s.project)
  const removeScene = useProjectStore(s => s.removeScene)

  const scenes = useMemo(() => {
    if (!project) return []
    const out: Array<{ id: string; heading: string; idx: number }> = []
    project.screenplay.elements.forEach((e, i) => {
      // Skip empty scene headings — those are placeholder slots the
      // editor seeds and the user hasn't filled in yet. Showing them
      // as "(untitled)" clutters the navigator with ghost entries.
      if (e.type === 'scene_heading' && e.text.trim()) {
        out.push({ id: e.id, heading: e.text, idx: i })
      }
    })
    return out
  }, [project])

  const scrollTo = (id: string) => {
    const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const handleDelete = (id: string, label: string) => {
    if (confirm(`Delete scene "${label || '(untitled)'}" and all its lines?`)) {
      removeScene(id as ElementId)
    }
  }

  if (!project) return null

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
          Scenes
        </h3>
      </header>
      <ul className="flex-1 overflow-y-auto subtle-scrollbar py-2">
        {scenes.length === 0 && (
          <li className="px-4 py-3 text-xs" style={{ color: 'var(--fg-muted)' }}>
            No scenes yet. Type INT. or EXT. to begin.
          </li>
        )}
        {scenes.map((s, i) => (
          <li
            key={s.id}
            className="group flex items-center justify-between gap-2 pr-2 hover:bg-[var(--bg-deep)]"
          >
            <button
              onClick={() => scrollTo(s.id)}
              className="flex flex-1 items-center gap-2 px-4 py-1.5 text-left text-xs"
              style={{ color: 'var(--fg)' }}
            >
              <span style={{ color: 'var(--fg-muted)' }}>{String(i + 1).padStart(2, '0')}</span>
              <span className="truncate">{s.heading || '(untitled)'}</span>
            </button>
            <button
              onClick={() => handleDelete(s.id, s.heading)}
              className="px-1 text-[10px] uppercase tracking-widest opacity-0 transition-opacity group-hover:opacity-100 hover:underline"
              style={{ color: 'var(--fg-muted)' }}
              title="Delete this scene (heading and all lines until the next scene)"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
