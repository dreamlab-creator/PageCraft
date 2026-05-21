import { useState } from 'react'
import { useProjectStore } from '@/store'
import { interpretIntent } from '@/lib/intent'

export function ModifyModal({ onClose }: { onClose: () => void }) {
  const project = useProjectStore(s => s.project)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)

  if (!project) return null

  const interpretation = instruction.trim()
    ? interpretIntent(instruction, { hasProject: true, hasReference: project.references.length > 0 })
    : null

  return (
    <div
      className="w-[640px] max-w-[94vw] border shadow-2xl"
      style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)' }}
    >
      <header className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-base font-semibold">Modify</h2>
        <button onClick={onClose} className="text-xs uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>Close</button>
      </header>
      <div className="px-5 py-4">
        <p className="mb-3 text-sm" style={{ color: 'var(--fg-soft)' }}>
          Describe a transformation in plain language. PageCraft will interpret the intent, identify what to change and what
          to preserve, and run the transformation with a diff view for you to accept, edit, or reject.
        </p>
        <textarea
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          className="textarea"
          rows={4}
          placeholder='e.g. "Take this script and set it in WW2 France, keep the plot and relationships." Or: "Compress this feature into a 30-page pilot." Or: "Make scene 14 funnier."'
        />

        {interpretation && (
          <div className="mt-4 border p-3 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--bg-deep)' }}>
            <div className="font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
              Interpreted as: {interpretation.intent}
            </div>
            {interpretation.transform.length > 0 && (
              <div className="mt-2">
                <span style={{ color: 'var(--fg-muted)' }}>Change:</span>{' '}
                <span style={{ color: 'var(--fg)' }}>{interpretation.transform.map(t => `${t.axis} → ${t.to}`).join(', ')}</span>
              </div>
            )}
            {interpretation.preserve.length > 0 && (
              <div className="mt-1">
                <span style={{ color: 'var(--fg-muted)' }}>Preserve:</span>{' '}
                <span style={{ color: 'var(--fg)' }}>{interpretation.preserve.map(p => p.axis).join(', ')}</span>
              </div>
            )}
            <div className="mt-1">
              <span style={{ color: 'var(--fg-muted)' }}>Source:</span>{' '}
              <span style={{ color: 'var(--fg)' }}>{interpretation.source.kind}</span>
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <p className="text-xs italic" style={{ color: 'var(--fg-muted)' }}>
            AI provider not configured. Configure in Settings to run transformations.
          </p>
          <button
            disabled={busy || !instruction.trim()}
            onClick={() => {
              setBusy(true)
              // The actual AI invocation is delegated to the AI provider layer
              // (see lib/ai). Until a provider is configured, we just close.
              setTimeout(() => { setBusy(false); onClose() }, 200)
            }}
            className="btn-accent text-sm"
          >
            {busy ? 'Working...' : 'Run Modify'}
          </button>
        </div>
      </div>
    </div>
  )
}
