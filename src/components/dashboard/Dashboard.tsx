import { useEffect, useState } from 'react'
import { useLibraryStore, useProjectStore, useUIStore, useEffectiveTheme } from '@/store'
import { loadProject, openProjectFile, importFile } from '@/lib/storage'
import { parseFountain } from '@/lib/fountain'
import { parseFDX } from '@/lib/fdx'
import { createBlankProject } from '@/lib/storage/blank-project'
import { PRESETS } from '@/lib/formats'
import type { ProjectId } from '@/types'

export function Dashboard() {
  const entries = useLibraryStore(s => s.entries)
  const refresh = useLibraryStore(s => s.refresh)
  const removeProj = useLibraryStore(s => s.removeProject)
  const applyBundled = useLibraryStore(s => s.applyBundledSettings)
  const openModal = useUIStore(s => s.openModal)
  const setMode = useUIStore(s => s.setMode)
  const setProject = useProjectStore(s => s.setProject)
  const pushRecent = useLibraryStore(s => s.pushRecent)
  const effectiveTheme = useEffectiveTheme()
  const logoSrc = effectiveTheme === 'light'
    ? '/pagecraft-logo-black.png'
    : '/pagecraft-logo-white.png'

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleOpen = async (id: ProjectId) => {
    const p = await loadProject(id)
    if (p) {
      setProject(p)
      pushRecent(id)
      setMode('writing')
    }
  }

  const handleOpenFile = async () => {
    setImportError(null)
    let r: Awaited<ReturnType<typeof openProjectFile>> = null
    try {
      r = await openProjectFile()
    } catch (e) {
      setImportError(`Could not open file: ${(e as Error).message ?? 'unknown error'}`)
      return
    }
    if (!r) return
    // Apply the project FIRST so a subsequent settings-apply failure
    // doesn't strand the user on the dashboard.
    setProject(r.project)
    setMode('writing')
    // Settings apply is best-effort; never block navigation on it.
    if (r.settings) {
      try {
        const result = await applyBundled(r.settings)
        if (result.aiApplied || result.formatsAppliedCount > 0) {
          // eslint-disable-next-line no-console
          console.info(
            '[PageCraft] Applied embedded bundle settings:',
            result.aiApplied ? 'AI configuration' : '',
            result.formatsAppliedCount ? `${result.formatsAppliedCount} custom format(s)` : '',
          )
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[PageCraft] Could not apply bundled settings:', e)
      }
    }
  }

  const [importError, setImportError] = useState<string | null>(null)

  /**
   * Import a script from Final Draft (.fdx) or Fountain (.fountain / .txt).
   * Format is detected from the file extension or content (FDX begins with
   * an XML prolog or <FinalDraft> root).
   */
  const handleImportScript = async () => {
    setImportError(null)
    const f = await importFile({ accept: '.fdx,.fountain,.txt' })
    if (!f) return

    const lowerName = f.name.toLowerCase()
    const looksLikeFdx =
      lowerName.endsWith('.fdx')
      || /^\s*<\?xml/i.test(f.text)
      || /<\s*FinalDraft\b/i.test(f.text)

    try {
      const project = createBlankProject({
        title: f.name.replace(/\.[^.]+$/, ''),
        format: PRESETS.feature_drama,
      })
      if (looksLikeFdx) {
        const doc = parseFDX(f.text)
        project.screenplay = doc
        if (doc.titlePage?.title) project.title = doc.titlePage.title
        if (doc.titlePage?.author) project.author = doc.titlePage.author
      } else {
        const doc = parseFountain(f.text)
        project.screenplay = doc
      }
      setProject(project)
      setMode('writing')
    } catch (e) {
      setImportError(`Could not import "${f.name}": ${(e as Error).message ?? 'unknown error'}`)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div
        className="border-b px-10 pb-5 pt-7"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="mx-auto max-w-5xl">
          <img
            src={logoSrc}
            alt="PageCraft"
            className="mb-2 block"
            style={{ height: 44, width: 'auto' }}
            draggable={false}
          />
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            A serious screenwriting environment. Plan deeply, draft cleanly, ship a script that reads like the best in
            the business.
          </p>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-10 py-6 subtle-scrollbar overflow-y-auto">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <button onClick={() => openModal('new_project')} className="btn-accent text-sm">
            New Project
          </button>
          <button onClick={handleOpenFile} className="btn-ghost text-sm">
            Open from file
          </button>
          <button
            onClick={handleImportScript}
            className="btn-ghost text-sm"
            title="Import a Final Draft (.fdx) or Fountain (.fountain / .txt) screenplay"
          >
            Import Final Draft
          </button>
          <button
            onClick={() => openModal('intake')}
            className="btn-ghost text-sm"
            title="Drop in existing materials (script, show bible, treatment, novel, research) plus a brief; PageCraft builds the project from them."
          >
            Intake from Source Material
          </button>
        </div>

        {importError && (
          <div
            className="mb-4 border px-3 py-2 text-xs"
            style={{ borderColor: 'var(--error)', color: 'var(--error)' }}
          >
            {importError}
          </div>
        )}

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
          Recent Projects
        </h2>

        {entries.length === 0 ? (
          <div
            className="border px-6 py-12 text-center text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--fg-muted)' }}
          >
            Import or start a new one.
          </div>
        ) : (
          // Auto-rows-fr makes every grid row the same height as its tallest
          // tile so long-titled projects don't leave shorter neighbors at
          // uneven heights. Each card stretches to fill its cell.
          <ul className="grid auto-rows-fr grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {entries.map(e => (
              <li
                key={e.id}
                className="group flex h-full flex-col border p-3 transition-colors"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}
              >
                <button onClick={() => handleOpen(e.id)} className="flex flex-1 flex-col items-start text-left">
                  <span className="mb-0.5 font-semibold tracking-tight" style={{ color: 'var(--fg)' }}>
                    {e.title || 'Untitled'}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>{e.formatLabel}</span>
                  <span className="mt-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
                    Updated {new Date(e.updatedAt).toLocaleString()}
                  </span>
                </button>
                <div className="mt-2 flex items-center justify-between">
                  <button
                    onClick={() => handleOpen(e.id)}
                    className="text-xs uppercase tracking-wider hover:underline"
                    style={{ color: 'var(--fg-soft)' }}
                  >
                    Open
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${e.title}"? This cannot be undone.`)) {
                        removeProj(e.id)
                      }
                    }}
                    className="text-xs uppercase tracking-wider opacity-0 transition-opacity group-hover:opacity-100 hover:underline"
                    style={{ color: 'var(--fg-muted)' }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
