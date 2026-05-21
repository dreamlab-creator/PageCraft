import { useProjectStore } from '@/store'

export function NotesPanel() {
  const project = useProjectStore(s => s.project)
  if (!project) return null

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
          Notes
        </h3>
      </header>
      <ul className="flex-1 overflow-y-auto subtle-scrollbar py-2">
        {project.notes.length === 0 ? (
          <li className="px-4 py-3 text-xs" style={{ color: 'var(--fg-muted)' }}>
            No notes yet.
          </li>
        ) : (
          project.notes.map(n => (
            <li
              key={n.id}
              className="border-l-2 px-4 py-2"
              style={{ borderColor: n.color ?? 'var(--accent)' }}
            >
              <div className="text-xs italic" style={{ color: 'var(--fg-soft)' }}>{n.body}</div>
              {n.priority !== 'normal' && (
                <div className="mt-1 text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                  {n.priority}
                </div>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
