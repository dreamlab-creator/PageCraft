import { useProjectStore, useUIStore } from '@/store'
import { ScreenplayEditor } from './ScreenplayEditor'
import { BeatsSidebar } from './BeatsSidebar'
import { SceneNavigatorSidebar } from './SceneNavigatorSidebar'
import { NotesPanel } from './NotesPanel'
import { CastIncongruencyBanner } from './CastIncongruencyBanner'
import { WritingAIProvider } from './WritingAIContext'
import { DiagnosticsPanel } from '@/components/diagnostics/DiagnosticsPanel'
import { ReferencesPanel } from '@/components/references/ReferencesPanel'
import { useCastReconciler } from '@/hooks/useCastReconciler'

export function WritingMode() {
  const project = useProjectStore(s => s.project)
  const showBeats = useUIStore(s => s.showBeatsPanel)
  const showSceneNav = useUIStore(s => s.showSceneNavigator)
  const showNotes = useUIStore(s => s.showNotesPanel)
  const showDiag = useUIStore(s => s.showDiagnostics)
  const showRefs = useUIStore(s => s.showReferences)
  const focusMode = useUIStore(s => s.focusMode)

  // Live cast reconciliation: auto-adopt newly cued characters into the bible.
  useCastReconciler({ enabled: !!project })

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--fg-muted)' }}>
        No project loaded.
      </div>
    )
  }

  // Sidebar widths (kept in sync with the aside classNames below).
  const LEFT_SIDEBAR_REM = 16   // w-64 = 16rem
  const RIGHT_SIDEBAR_REM = 20  // w-80 = 20rem

  // The screenplay page is centered inside `main`. When only ONE sidebar
  // is showing, the page would visually drift toward the empty side. We
  // compensate by adding equivalent inner padding to main on the empty
  // side so the page appears centered in the full visible viewport.
  const leftShown = !focusMode && showSceneNav
  const rightShown = !focusMode && (showBeats || showNotes || showDiag || showRefs)
  const compensationLeft = !leftShown && rightShown ? `${RIGHT_SIDEBAR_REM}rem` : '0'
  const compensationRight = leftShown && !rightShown ? `${LEFT_SIDEBAR_REM}rem` : '0'

  return (
    <WritingAIProvider>
      <div className="flex h-full overflow-hidden">
        {leftShown && (
          <aside
            className="w-64 shrink-0 overflow-y-auto border-r subtle-scrollbar"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}
          >
            <SceneNavigatorSidebar />
          </aside>
        )}
        <main
          className="relative flex-1 overflow-y-auto subtle-scrollbar"
          style={{
            background: 'var(--bg)',
            paddingLeft: compensationLeft,
            paddingRight: compensationRight,
          }}
        >
          <CastIncongruencyBanner />
          <ScreenplayEditor />
        </main>
        {rightShown && (
          <aside
            className="w-80 shrink-0 overflow-y-auto border-l subtle-scrollbar"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}
          >
            {showDiag && <DiagnosticsPanel />}
            {showRefs && <ReferencesPanel />}
            {showBeats && <BeatsSidebar />}
            {showNotes && <NotesPanel />}
          </aside>
        )}
      </div>
    </WritingAIProvider>
  )
}
