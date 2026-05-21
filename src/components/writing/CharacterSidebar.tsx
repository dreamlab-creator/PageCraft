import { useProjectStore, useUIStore } from '@/store'

export function CharacterSidebar() {
  const project = useProjectStore(s => s.project)
  const navigateTo = useUIStore(s => s.navigateTo)
  if (!project) return null

  const needsReviewCount = project.characters.filter(c => c.needsReview).length

  // Deep-link to a specific character in the Planning > Characters tab.
  // `navigateTo` sets mode + planningTab + a planningFocus payload in
  // one call; CharactersPanel reads the focus on mount, selects the
  // target, and scrolls it into view.
  const openCharacter = (id: string) => {
    navigateTo({
      mode: 'planning',
      planningTab: 'characters',
      focus: { kind: 'character', id },
    })
  }

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-baseline gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
            Characters
          </h3>
          {needsReviewCount > 0 && (
            <span
              className="rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-widest"
              style={{
                background: 'var(--warning, #c89c4d)',
                color: 'var(--bg)',
              }}
              title={`${needsReviewCount} auto-adopted character${needsReviewCount === 1 ? '' : 's'} need review`}
            >
              {needsReviewCount} new
            </span>
          )}
        </div>
        <button
          onClick={() => navigateTo({ mode: 'planning', planningTab: 'characters' })}
          className="text-xs hover:underline"
          style={{ color: 'var(--fg-soft)' }}
        >
          Edit Bible →
        </button>
      </header>
      <ul className="flex-1 overflow-y-auto subtle-scrollbar py-2">
        {project.characters.length === 0 && (
          <li className="px-4 py-3 text-xs" style={{ color: 'var(--fg-muted)' }}>
            No characters yet. Add them in Planning.
          </li>
        )}
        {project.characters.map(c => (
          <li
            key={c.id}
            className="border-l-2"
            style={{ borderColor: c.highlightColor ?? (c.needsReview ? 'var(--warning, #c89c4d)' : 'var(--border)') }}
          >
            <button
              type="button"
              onClick={() => openCharacter(c.id)}
              className="block w-full px-4 py-2 text-left transition-colors hover:bg-[var(--bg-elev)]"
              title={`Open ${c.name} in Planning`}
            >
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{c.name}</div>
                {c.needsReview && (
                  <span
                    className="rounded-sm px-1 py-0.5 text-[9px] uppercase tracking-widest"
                    style={{
                      background: 'var(--bg)',
                      color: 'var(--warning, #c89c4d)',
                      border: '1px solid var(--warning, #c89c4d)',
                    }}
                    title={`Auto-adopted (${c.provenance ?? 'auto_script'}) — open Planning to flesh out`}
                  >
                    new
                  </span>
                )}
              </div>
              <div className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                {c.age || '(age?)'} · {c.role.replace('_', ' ')}
              </div>
              {c.shortDescription && !c.externalGoal && (
                <div className="mt-1 text-xs italic" style={{ color: 'var(--fg-soft)' }}>
                  {c.shortDescription}
                </div>
              )}
              {c.externalGoal && (
                <div className="mt-1 text-xs italic" style={{ color: 'var(--fg-soft)' }}>
                  Wants: {c.externalGoal}
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
