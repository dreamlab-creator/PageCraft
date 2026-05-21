import { useMemo, useState } from 'react'
import { PRESET_LIST, interpretFormat } from '@/lib/formats'
import type { FormatConfig } from '@/types'
import { useProjectStore, useUIStore } from '@/store'
import { createBlankProject } from '@/lib/storage/blank-project'

export function NewProjectWizard({ onClose }: { onClose: () => void }) {
  const setProject = useProjectStore(s => s.setProject)
  const setMode = useUIStore(s => s.setMode)

  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [selectedPresetKind, setSelectedPresetKind] = useState<string>('feature_drama')
  const [customSpec, setCustomSpec] = useState('')

  const interpretation = useMemo(() => {
    if (customSpec.trim()) return interpretFormat(customSpec)
    return null
  }, [customSpec])

  const activeFormat: FormatConfig =
    interpretation?.config ??
    (PRESET_LIST.find(p => p.kind === selectedPresetKind) ?? PRESET_LIST[0])

  const handleCreate = () => {
    const project = createBlankProject({
      title: title.trim() || 'Untitled Screenplay',
      author: author.trim(),
      format: activeFormat,
    })
    setProject(project)
    setMode('planning')
    onClose()
  }

  return (
    <div
      className="flex w-[760px] max-w-[94vw] flex-col border shadow-2xl"
      style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', maxHeight: '88vh' }}
    >
      <header
        className="border-b px-5 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <h2 className="text-base font-semibold tracking-tight" style={{ color: 'var(--fg)' }}>
          New Project
        </h2>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--fg-muted)' }}>
          Pick a format or describe what you're writing. PageCraft composes the structural intelligence for any
          screenplay you can describe.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto subtle-scrollbar px-5 py-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Untitled"
              className="input"
            />
          </div>
          <div>
            <label className="field">Writer</label>
            <input
              value={author}
              onChange={e => setAuthor(e.target.value)}
              placeholder="Your name"
              className="input"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="field">Format</label>
          {/* Grid cells are auto-sized to a uniform row height (via
              `auto-rows-fr`) so every preset card matches the tallest
              one. The button fills its cell (`h-full`) so the borders
              of all cards line up regardless of how many lines the
              description wraps to. */}
          <ul className="grid auto-rows-fr grid-cols-2 gap-2">
            {PRESET_LIST.map(p => (
              <li key={p.kind} className="h-full">
                <button
                  onClick={() => { setSelectedPresetKind(p.kind); setCustomSpec('') }}
                  className="flex h-full w-full flex-col items-start border p-2.5 text-left transition-colors"
                  style={{
                    borderColor: selectedPresetKind === p.kind && !customSpec ? 'var(--fg)' : 'var(--border)',
                    background: selectedPresetKind === p.kind && !customSpec ? 'var(--bg-deep)' : 'transparent',
                  }}
                >
                  <span className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{p.label}</span>
                  <span className="mt-0.5 text-xs leading-snug" style={{ color: 'var(--fg-muted)' }}>
                    {p.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4">
          <label className="field">Or describe your own format</label>
          <textarea
            value={customSpec}
            onChange={e => setCustomSpec(e.target.value)}
            placeholder='e.g. "A 2D animated comedy with two-minute episodes and two acts per episode"'
            className="textarea"
            rows={3}
          />
          <p className="mt-1 text-xs" style={{ color: 'var(--fg-muted)' }}>
            PageCraft will interpret your description and assemble a custom format. You can adjust every parameter.
          </p>
        </div>

        {interpretation && (
          <div
            className="mt-4 border p-3"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-deep)' }}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--fg-muted)' }}>
              Inferred Format
            </h3>
            <p className="mt-2 text-sm" style={{ color: 'var(--fg)' }}>{interpretation.summary}</p>
            <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs" style={{ color: 'var(--fg-soft)' }}>
              <li>Medium: <strong>{interpretation.config.medium.replace('_', ' ')}</strong></li>
              <li>Pages: <strong>{interpretation.config.structure.targetPagesMin}–{interpretation.config.structure.targetPagesMax}</strong></li>
              <li>Acts: <strong>{interpretation.config.structure.actStructure.replace(/_/g, ' ')}</strong></li>
              <li>Pacing: <strong>{interpretation.config.pacing.profile.replace('_', ' ')}</strong></li>
              <li>Audience: <strong>{interpretation.config.audience}</strong></li>
              <li>Vertical sandbox: <strong>{interpretation.config.verticalSandbox ? 'yes' : 'no'}</strong></li>
            </ul>
            {interpretation.ambiguities.length > 0 && (
              <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--fg-muted)' }}>
                  Need to clarify
                </p>
                <ul className="mt-2 space-y-2 text-xs" style={{ color: 'var(--fg-soft)' }}>
                  {interpretation.ambiguities.map(a => (
                    <li key={a.id}>
                      <strong>{a.question}</strong> — {a.defaultAssumption}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <footer
        className="flex items-center justify-end gap-2 border-t px-5 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
        <button onClick={handleCreate} className="btn-accent text-sm">Create Project</button>
      </footer>
    </div>
  )
}
