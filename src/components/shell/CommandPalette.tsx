import { useEffect, useMemo, useRef, useState } from 'react'
import { useUIStore, useProjectStore, useLibraryStore } from '@/store'
import { openProjectFile, exportText } from '@/lib/storage'
import { serializeFountain } from '@/lib/fountain'

interface Command {
  id: string
  label: string
  hint?: string
  group: 'Project' | 'View' | 'Mode' | 'Insert' | 'Format' | 'Export' | 'AI' | 'System'
  run: () => void | Promise<void>
}

export function CommandPalette() {
  const open = useUIStore(s => s.commandPaletteOpen)
  const query = useUIStore(s => s.commandPaletteQuery)
  const close = useUIStore(s => s.closeCommandPalette)
  const setQuery = useUIStore(s => s.setCommandPaletteQuery)
  const setMode = useUIStore(s => s.setMode)
  const togglePanel = useUIStore(s => s.togglePanel)
  const toggleStructure = useUIStore(s => s.toggleStructureLines)
  const toggleTypewriter = useUIStore(s => s.toggleTypewriter)
  const toggleFocus = useUIStore(s => s.toggleFocus)
  const project = useProjectStore(s => s.project)
  const saveNow = useProjectStore(s => s.saveNow)
  const openModal = useUIStore(s => s.openModal)

  const inputRef = useRef<HTMLInputElement>(null)
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    if (open) {
      setSelected(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const commands: Command[] = useMemo(() => [
    { id: 'new', label: 'New project', hint: 'Wizard', group: 'Project', run: () => openModal('new_project') },
    {
      id: 'open',
      label: 'Open project from file',
      hint: 'Open .pagecraft / .pgcraft.json',
      group: 'Project',
      run: async () => {
        let r: Awaited<ReturnType<typeof openProjectFile>> = null
        try { r = await openProjectFile() } catch { /* swallow — user cancelled or picker errored */ }
        if (!r) return
        useProjectStore.getState().setProject(r.project)
        setMode('writing')
        if (r.settings) {
          try { await useLibraryStore.getState().applyBundledSettings(r.settings) } catch { /* best-effort */ }
        }
      },
    },
    { id: 'save', label: 'Save', hint: 'Save current project (autosave)', group: 'Project', run: () => saveNow() },
    {
      id: 'export_project',
      label: 'Export project (everything)',
      hint: '.pagecraft — full bundle',
      group: 'Project',
      run: () => { if (project) openModal('export') },
    },
    {
      id: 'export_script',
      label: 'Export script…',
      hint: 'PDF · FDX · Fountain · TXT',
      group: 'Export',
      run: () => { if (project) openModal('export_script') },
    },
    { id: 'export_fountain', label: 'Export as Fountain', hint: '.fountain', group: 'Export', run: async () => {
      if (!project) return
      const text = serializeFountain(project.screenplay)
      await exportText({
        text,
        suggestedName: `${project.title || 'untitled'}.fountain`,
        description: 'Fountain Screenplay',
        mimeType: 'text/plain',
        extensions: ['.fountain'],
      })
    } },
    { id: 'export_txt', label: 'Export as plain text', hint: '.txt', group: 'Export', run: async () => {
      if (!project) return
      const text = serializeFountain(project.screenplay)
      await exportText({
        text,
        suggestedName: `${project.title || 'untitled'}.txt`,
        description: 'Plain Text',
        mimeType: 'text/plain',
        extensions: ['.txt'],
      })
    } },
    { id: 'mode_dashboard', label: 'Go to Dashboard', group: 'Mode', run: () => setMode('dashboard') },
    { id: 'mode_planning', label: 'Go to Planning', group: 'Mode', run: () => setMode('planning') },
    { id: 'mode_writing', label: 'Go to Writing', group: 'Mode', run: () => setMode('writing') },
    { id: 'view_typewriter', label: 'Toggle Typewriter Mode', group: 'View', run: () => toggleTypewriter() },
    { id: 'view_focus', label: 'Toggle Focus Mode', group: 'View', run: () => toggleFocus() },
    { id: 'view_structure', label: 'Toggle Structure Lines', group: 'View', run: () => toggleStructure() },
    { id: 'panel_beats', label: 'Toggle Beats Panel', group: 'View', run: () => togglePanel('beats') },
    { id: 'panel_notes', label: 'Toggle Notes Panel', group: 'View', run: () => togglePanel('notes') },
    { id: 'panel_diag', label: 'Toggle Diagnostics Panel', group: 'View', run: () => togglePanel('diagnostics') },
    { id: 'panel_refs', label: 'Toggle References Panel', group: 'View', run: () => togglePanel('references') },
    { id: 'open_settings', label: 'Open Settings', group: 'System', run: () => openModal('settings') },
    { id: 'preflight', label: 'Run Pre-Flight Check', hint: 'Story + format + lint', group: 'AI', run: () => openModal('pre_flight') },
    { id: 'modify', label: 'Modify (transform a script or scene)', hint: 'Set in WW2 France...', group: 'AI', run: () => openModal('modify') },
  ], [openModal, project, saveNow, setMode, togglePanel, toggleStructure, toggleTypewriter, toggleFocus])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter(c =>
      c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q) || (c.hint ?? '').toLowerCase().includes(q),
    )
  }, [commands, query])

  useEffect(() => { setSelected(0) }, [query])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(filtered.length - 1, s + 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(0, s - 1)) }
      if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = filtered[selected]
        if (cmd) { close(); cmd.run() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, selected, close])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-[92vw] border shadow-2xl"
        style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)' }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Type a command or describe what you want to do"
          className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
          style={{ borderColor: 'var(--border)', color: 'var(--fg)' }}
        />
        <ul className="max-h-[60vh] overflow-y-auto subtle-scrollbar">
          {filtered.map((c, i) => (
            <li
              key={c.id}
              onMouseEnter={() => setSelected(i)}
              onClick={() => { close(); c.run() }}
              className="flex cursor-pointer items-center justify-between px-4 py-2 text-sm"
              style={{
                background: i === selected ? 'var(--bg-deep)' : 'transparent',
                color: 'var(--fg)',
              }}
            >
              <span className="flex items-center gap-3">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--fg-muted)' }}>
                  {c.group}
                </span>
                <span>{c.label}</span>
              </span>
              {c.hint && <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>{c.hint}</span>}
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-sm" style={{ color: 'var(--fg-muted)' }}>
              No matching commands
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
