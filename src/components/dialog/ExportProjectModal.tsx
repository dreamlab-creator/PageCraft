/**
 * ExportProjectModal — the obvious "save the whole project to a file" path.
 *
 * What it exports:
 *   - The complete Project (Overview, Characters, Beats, Scene Cards,
 *     Screenplay, References, Settings, Notes, Locations — everything).
 *
 * What it OPTIONALLY embeds:
 *   - The user's app-level settings, including the Anthropic API key. When
 *     the file is reopened, the API key is auto-applied so AI is online
 *     immediately.
 *
 * Privacy: the API-key checkbox is plainly labeled and accompanied by a
 * warning. Off by default unless the user has previously chosen to include
 * it.
 */

import { useState } from 'react'
import { useLibraryStore, useProjectStore, useUIStore } from '@/store'
import { exportProjectBundle } from '@/lib/storage'

export function ExportProjectModal() {
  const project = useProjectStore(s => s.project)
  const settings = useLibraryStore(s => s.settings)
  const patchSettings = useLibraryStore(s => s.patchSettings)
  const close = useUIStore(s => s.closeModal)

  const hasKey = !!settings.ai.apiKey
  // Default the checkbox to ON when a key exists. The user explicitly asked
  // for the API key to travel inside the bundle so it auto-activates on
  // re-import — that's only useful when the export side actually included it.
  const [includeKey, setIncludeKey] = useState<boolean>(hasKey)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!project) return null

  const handleExport = async () => {
    setBusy(true); setError(null)
    try {
      await exportProjectBundle(project, {
        includeSettings: includeKey,
        settings: includeKey ? settings : undefined,
      })
      // Remember the user's preference for next time (per-machine).
      await patchSettings({}) // no-op patch keeps any future preferences merged
      close()
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // User cancelled the native save dialog.
        close()
      } else {
        setError((e as Error).message ?? 'Export failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-[520px] max-w-[92vw]" style={{ background: 'var(--bg-elev)' }}>
      <header className="border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Export project</h3>
        <p className="mt-1 text-[11px] italic" style={{ color: 'var(--fg-muted)' }}>
          Save the entire project as a single <code>.pagecraft</code> file. This contains everything
          — Overview, Characters, Beats, Scenes, Screenplay, References, and project settings.
        </p>
      </header>

      <div className="space-y-4 px-5 py-4">
        <div>
          <label className="field">File name</label>
          <input
            value={`${project.title || 'Untitled'}.pagecraft`}
            readOnly
            className="input opacity-80"
          />
          <p className="mt-1 text-[10px]" style={{ color: 'var(--fg-muted)' }}>
            You'll pick the save location on the next step.
          </p>
        </div>

        <div
          className="border px-3 py-3"
          style={{
            borderColor: includeKey ? 'var(--warning, #c89c4d)' : 'var(--border)',
            background: 'var(--bg)',
          }}
        >
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={includeKey}
              disabled={!hasKey}
              onChange={e => setIncludeKey(e.target.checked)}
              className="mt-0.5"
            />
            <span style={{ color: 'var(--fg)' }}>
              <span className="font-semibold">Include my Anthropic API key</span>
              <span className="ml-2 text-[11px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                {hasKey ? 'recommended' : 'no key set'}
              </span>
              <p className="mt-1 text-xs" style={{ color: 'var(--fg-muted)' }}>
                When you reopen this file on this or another machine, the API key (and your model
                selections) will be applied automatically so AI assist is online immediately.
              </p>
            </span>
          </label>

          {includeKey && (
            <div
              className="mt-3 border-t pt-3 text-[11px]"
              style={{ borderColor: 'var(--border)', color: 'var(--warning, #c89c4d)' }}
            >
              <strong className="uppercase tracking-widest">Privacy:</strong>{' '}
              This file will contain your real API key in plain text. Do not share it, email it,
              or sync it to a public cloud folder. Treat it like a password.
            </div>
          )}
        </div>

        <div className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
          <strong className="uppercase tracking-widest">Tip:</strong> When you open a <code>.pagecraft</code> file
          via "Open project from file", this entire bundle is restored — every section, every character,
          every page. No data is left behind.
        </div>

        {error && (
          <div className="border px-3 py-2 text-xs" style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>
            {error}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-end gap-3 border-t px-5 py-3" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={close}
          disabled={busy}
          className="text-xs uppercase tracking-widest disabled:opacity-50"
          style={{ color: 'var(--fg-muted)' }}
        >
          Cancel
        </button>
        <button
          onClick={handleExport}
          disabled={busy}
          className="btn-accent text-sm disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save .pagecraft file'}
        </button>
      </footer>
    </div>
  )
}
