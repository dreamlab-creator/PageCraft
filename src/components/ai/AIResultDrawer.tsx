import { useEffect, useRef, useState } from 'react'

interface Props {
  open: boolean
  title: string
  /** Initial AI-produced text. */
  result: string
  /** Whether a regen is currently in flight. */
  regenerating?: boolean
  /** Optional error message. */
  error?: string | null
  onAccept: (text: string) => void
  onRegenerate: (nudge: string) => void
  onCancel: () => void
  /** Optional sub-line shown under the title (e.g., model id, token cost). */
  subtitle?: string
}

/**
 * Modal drawer that shows AI output and lets the user Accept / Regenerate /
 * Edit / Cancel. The user can also enter a nudge to steer a regenerate
 * ("make it darker", "more visual", "shorter").
 */
export function AIResultDrawer({
  open, title, result, regenerating, error, subtitle, onAccept, onRegenerate, onCancel,
}: Props) {
  const [text, setText] = useState(result)
  const [nudge, setNudge] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setText(result) }, [result])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onAccept(text) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onAccept, onCancel, text])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[720px] max-w-[94vw] flex-col border shadow-2xl"
        style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', maxHeight: '88vh' }}
      >
        <header className="flex items-start justify-between border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{title}</h3>
            {subtitle && <p className="mt-0.5 text-[11px]" style={{ color: 'var(--fg-muted)' }}>{subtitle}</p>}
          </div>
          <button onClick={onCancel} className="text-xs uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
            Cancel
          </button>
        </header>

        <div className="flex-1 overflow-y-auto subtle-scrollbar px-5 py-4">
          {error && (
            <div
              className="mb-3 border px-3 py-2 text-xs"
              style={{ borderColor: 'var(--error)', color: 'var(--error)', background: 'rgba(161,58,46,0.05)' }}
            >
              {error}
            </div>
          )}

          <label className="field">Suggestion (editable)</label>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            className="textarea"
            rows={Math.max(6, Math.min(20, Math.ceil(text.length / 80)))}
          />

          <label className="field mt-4">Nudge for regenerate (optional)</label>
          <input
            value={nudge}
            onChange={e => setNudge(e.target.value)}
            className="input"
            placeholder='e.g., "make it darker", "shorter", "more visual", "less on-the-nose"'
          />
        </div>

        <footer
          className="flex items-center justify-between border-t px-5 py-3"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
            ⌘↵ Accept · Esc Cancel
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onRegenerate(nudge)}
              disabled={!!regenerating}
              className="btn-ghost text-xs"
            >
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
            <button
              onClick={() => onAccept(text)}
              disabled={!!regenerating}
              className="btn-accent text-xs"
            >
              Accept
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
