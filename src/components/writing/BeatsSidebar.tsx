import { useProjectStore, useUIStore } from '@/store'

export function BeatsSidebar() {
  const project = useProjectStore(s => s.project)
  const navigateTo = useUIStore(s => s.navigateTo)
  if (!project) return null

  const sorted = [...project.beats].sort((a, b) => (a.pageRangeStart ?? 0) - (b.pageRangeStart ?? 0))

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
          Beats
        </h3>
        <button
          onClick={() => navigateTo({ mode: 'planning', planningTab: 'beats' })}
          className="text-xs hover:underline"
          style={{ color: 'var(--fg-soft)' }}
        >
          Beat Board →
        </button>
      </header>
      <ul className="flex-1 overflow-y-auto subtle-scrollbar py-2">
        {sorted.length === 0 && (
          <li className="px-4 py-3 text-xs" style={{ color: 'var(--fg-muted)' }}>
            No beats yet. Plan your story in Planning Mode.
          </li>
        )}
        {sorted.map(b => (
          <li
            key={b.id}
            className="border-l-2"
            style={{ borderColor: b.color ?? 'var(--border)' }}
          >
            <button
              type="button"
              onClick={() => navigateTo({ mode: 'planning', planningTab: 'beats', focus: { kind: 'beat', id: b.id } })}
              className="block w-full px-4 py-2 text-left transition-colors hover:bg-[var(--bg-elev)]"
              title={`Open ${b.title || 'this beat'} in Beat Board`}
            >
              <div className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{b.title || '(untitled beat)'}</div>
              {b.pageRangeStart != null && (
                <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                  pp. {b.pageRangeStart}{b.pageRangeEnd && b.pageRangeEnd !== b.pageRangeStart ? `–${b.pageRangeEnd}` : ''}
                </div>
              )}
              {b.storyPurpose && (
                <div className="mt-1 line-clamp-3 text-xs italic" style={{ color: 'var(--fg-soft)' }}>
                  {b.storyPurpose}
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
