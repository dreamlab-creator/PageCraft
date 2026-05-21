import { useEffect } from 'react'
import { useUIStore, useLibraryStore, useProjectStore } from '@/store'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { PlanningMode } from '@/components/planning/PlanningMode'
import { WritingMode } from '@/components/writing/WritingMode'
import { AppShell } from '@/components/shell/AppShell'
import { CommandPalette } from '@/components/shell/CommandPalette'
import { ModalRoot } from '@/components/shell/ModalRoot'

export default function App() {
  const mode = useUIStore(s => s.mode)
  const appearance = useUIStore(s => s.appearance)
  const setAppearance = useUIStore(s => s.setAppearance)
  const loadSettings = useLibraryStore(s => s.loadSettings)
  const refresh = useLibraryStore(s => s.refresh)

  // Initial load: app settings + project library.
  //
  // We DELIBERATELY do NOT restore the saved appearance on boot — the app
  // always launches in Day mode (set by the ui-store initial state). The
  // boot path used to call setAppearance(savedValue) here, which made the
  // first paint depend on the user's last theme + OS resolution, and the
  // PageCraft logo's light/dark variant could disagree with the actual
  // background during that race. Now boot is deterministic; the user can
  // cycle the theme via the titlebar button after launch.
  useEffect(() => {
    loadSettings()
    refresh()
    // Make sure the Day theme is actually applied to <html> at first
    // paint, even before the store's setAppearance runs. The store
    // initial value is 'day' but applyAppearance only fires on
    // setAppearance — so we kick it once here.
    setAppearance('day')
  }, [loadSettings, refresh, setAppearance])

  // Listen for system appearance changes when in 'system' mode.
  useEffect(() => {
    if (appearance !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const cb = () => setAppearance('system')
    mq.addEventListener('change', cb)
    return () => mq.removeEventListener('change', cb)
  }, [appearance, setAppearance])

  // Persist autosave when the window is about to unload.
  useEffect(() => {
    const handler = () => {
      const proj = useProjectStore.getState().project
      if (proj && useProjectStore.getState().dirty) {
        // Fire-and-forget; the OS may not allow async here.
        useProjectStore.getState().saveNow()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Global keyboard shortcuts (Cmd+K for command palette, etc.)
  //
  // Most shortcuts run on the regular keydown listener. Undo/redo
  // (Cmd+Z / Cmd+Shift+Z / Cmd+Y) is special: the browser will try to
  // run its own native undo on whichever contenteditable currently has
  // focus inside the screenplay editor. That native undo doesn't see
  // our Zustand state, so we install the undo/redo listener in CAPTURE
  // phase so we intercept the key BEFORE it reaches the contenteditable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      // Cmd+K: command palette
      if (meta && e.key === 'k') {
        e.preventDefault()
        useUIStore.getState().openCommandPalette()
      }
      // Cmd+S: manual save
      if (meta && e.key === 's' && !e.shiftKey) {
        e.preventDefault()
        useProjectStore.getState().saveNow()
      }
    }

    const onKeyCapture = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      // Cmd+Z (undo) and Cmd+Shift+Z (redo); also Ctrl+Y on Windows for redo.
      if (meta && (e.key === 'z' || e.key === 'Z')) {
        const proj = useProjectStore.getState().project
        if (!proj) return
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) {
          useProjectStore.getState().redo()
        } else {
          useProjectStore.getState().undo()
        }
      }
      if (meta && e.key === 'y' && !e.shiftKey) {
        const proj = useProjectStore.getState().project
        if (!proj) return
        e.preventDefault()
        e.stopPropagation()
        useProjectStore.getState().redo()
      }
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('keydown', onKeyCapture, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', onKeyCapture, { capture: true } as any)
    }
  }, [])

  return (
    <AppShell>
      {mode === 'dashboard' && <Dashboard />}
      {mode === 'planning' && <PlanningMode />}
      {mode === 'writing' && <WritingMode />}
      <CommandPalette />
      <ModalRoot />
    </AppShell>
  )
}
