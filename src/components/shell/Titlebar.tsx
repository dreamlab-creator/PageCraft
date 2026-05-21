import { useUIStore, useProjectStore, useLibraryStore, useEffectiveTheme } from '@/store'
import type { Appearance } from '@/store'

export function Titlebar() {
  const mode = useUIStore(s => s.mode)
  const setMode = useUIStore(s => s.setMode)
  const project = useProjectStore(s => s.project)
  // Subscribe to the past/future stacks so the undo/redo button enable
  // states re-render whenever history changes.
  const undo = useProjectStore(s => s.undo)
  const redo = useProjectStore(s => s.redo)
  const canUndo = useProjectStore(s => s.past.length > 0)
  const canRedo = useProjectStore(s => s.future.length > 0)
  const appearance = useUIStore(s => s.appearance)
  const setAppearance = useUIStore(s => s.setAppearance)
  const patchSettings = useLibraryStore(s => s.patchSettings)
  const effectiveTheme = useEffectiveTheme()
  const logoSrc = effectiveTheme === 'light'
    ? '/pagecraft-logo-black.png'
    : '/pagecraft-logo-white.png'

  const cycleAppearance = () => {
    const order: Appearance[] = ['system', 'day', 'night', 'midnight']
    const next = order[(order.indexOf(appearance) + 1) % order.length]
    setAppearance(next)
    patchSettings({ appearance: next })
  }

  return (
    <header
      className="flex h-12 shrink-0 items-center justify-between border-b px-4"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}
    >
      <div className="flex items-center gap-6">
        <button
          onClick={() => setMode('dashboard')}
          className="flex items-center"
          aria-label="PageCraft — back to dashboard"
          title="PageCraft — back to dashboard"
        >
          <img
            src={logoSrc}
            alt="PageCraft"
            className="block"
            style={{ height: 22, width: 'auto' }}
            draggable={false}
          />
        </button>
        {project && (
          <nav className="flex items-center gap-1">
            <ModeTab label="Planning" active={mode === 'planning'} onClick={() => setMode('planning')} />
            <ModeTab label="Writing" active={mode === 'writing'} onClick={() => setMode('writing')} />
          </nav>
        )}
      </div>

      <div className="flex items-center gap-2">
        {project && (
          <div className="mr-3 text-xs" style={{ color: 'var(--fg-muted)' }}>
            <span style={{ color: 'var(--fg-soft)' }}>{project.title}</span>
            <span className="mx-2">·</span>
            <span>{project.format.label}</span>
          </div>
        )}
        {project && (
          <div className="mr-2 flex items-center gap-1">
            <UndoRedoButton
              onClick={undo}
              disabled={!canUndo}
              title="Undo (⌘Z)"
              icon="undo"
            />
            <UndoRedoButton
              onClick={redo}
              disabled={!canRedo}
              title="Redo (⌘⇧Z)"
              icon="redo"
            />
          </div>
        )}
        {project && (
          <>
            <button
              onClick={() => useUIStore.getState().openModal('export_script')}
              className="border px-3 py-1.5 text-xs uppercase tracking-widest"
              style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
              title="Export the screenplay (PDF, FDX, Fountain, TXT) with optional title page"
            >
              Export Script
            </button>
            <button
              onClick={() => useUIStore.getState().openModal('export')}
              className="border px-3 py-1.5 text-xs uppercase tracking-widest"
              style={{ borderColor: 'var(--border)', color: 'var(--fg-soft)' }}
              title="Save the entire project (Overview, Characters, Beats, Scenes, References, settings) as a .pagecraft file"
            >
              Export Project
            </button>
          </>
        )}
        <AIStatusChip />
        <button
          onClick={() => useUIStore.getState().openCommandPalette()}
          className="border px-3 py-1.5 text-xs tracking-wide"
          style={{ borderColor: 'var(--border)', color: 'var(--fg-soft)' }}
          title="Command palette (⌘K)"
        >
          ⌘K
        </button>
        <button
          onClick={cycleAppearance}
          className="border px-2.5 py-1.5 text-xs"
          style={{ borderColor: 'var(--border)', color: 'var(--fg-soft)' }}
          title="Cycle appearance: System → Day → Night → Midnight"
        >
          {appearance === 'system' ? 'Sys' : appearance === 'day' ? 'Day' : appearance === 'night' ? 'Night' : 'Midnight'}
        </button>
      </div>
    </header>
  )
}

function AIStatusChip() {
  const hasKey = useLibraryStore(s => !!s.settings.ai.apiKey)
  const openModal = useUIStore(s => s.openModal)
  return (
    <button
      onClick={() => openModal('settings')}
      className="border px-2.5 py-1.5 text-[11px] uppercase tracking-widest"
      style={{
        borderColor: hasKey ? 'var(--accent)' : 'var(--border)',
        color: hasKey ? 'var(--accent)' : 'var(--fg-muted)',
      }}
      title={hasKey ? 'Anthropic API connected — click for settings' : 'No API key set — click to add'}
    >
      {hasKey ? 'AI · Live' : 'AI · Off'}
    </button>
  )
}

function ModeTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="border-b-2 px-3 py-1 text-xs font-medium tracking-wide"
      style={{
        borderColor: active ? 'var(--fg)' : 'transparent',
        color: active ? 'var(--fg)' : 'var(--fg-muted)',
      }}
    >
      {label.toUpperCase()}
    </button>
  )
}

/**
 * Tiny undo / redo button shown in the titlebar. Disabled when the
 * corresponding history stack is empty.
 */
function UndoRedoButton({
  onClick,
  disabled,
  title,
  icon,
}: {
  onClick: () => void
  disabled: boolean
  title: string
  icon: 'undo' | 'redo'
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex h-7 w-7 items-center justify-center border transition-colors disabled:opacity-30"
      style={{
        borderColor: 'var(--border)',
        color: 'var(--fg-soft)',
      }}
    >
      {icon === 'undo' ? <UndoIcon /> : <RedoIcon />}
    </button>
  )
}

function UndoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      {/* Curved arrow pointing left-back, FD-style monoline. */}
      <path
        d="M 4 8 L 7 5 M 4 8 L 7 11 M 4 8 H 11 a 3 3 0 0 1 0 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path
        d="M 12 8 L 9 5 M 12 8 L 9 11 M 12 8 H 5 a 3 3 0 0 0 0 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
