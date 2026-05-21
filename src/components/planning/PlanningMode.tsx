import { useEffect, useRef } from 'react'
import { useProjectStore, useUIStore } from '@/store'
import { OverviewPanel } from './OverviewPanel'
import { CharactersPanel } from './CharactersPanel'
import { BeatBoard } from './BeatBoard'
import { SceneCardsPanel } from './SceneCardsPanel'
import { ThemesAndStakesPanel } from './ThemesAndStakesPanel'
import { VerticalPlanningPanel } from './VerticalPlanningPanel'
import { SeriesPanel } from './SeriesPanel'
import { ReferencesPanel } from '@/components/references/ReferencesPanel'
import type { PlanningTab as Tab } from '@/store/ui-store'

export function PlanningMode() {
  const project = useProjectStore(s => s.project)
  const tab = useUIStore(s => s.planningTab)
  const setTab = useUIStore(s => s.setPlanningTab)
  // Per-project-id ref so we only auto-pick the default tab ONCE when a
  // different project is loaded. After that the writer's tab selection
  // is sticky for that project (so Show Bible → Episode Overview →
  // Characters → … flows naturally without snapping back).
  const lastProjectIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!project) return
    if (lastProjectIdRef.current === project.id) return
    lastProjectIdRef.current = project.id
    // Pick the right default for this project type:
    //   - Vertical → Tropes (the writer's pitch is the trope stack)
    //   - Episodic (TV / animation series) → Show Bible (series-level
    //     facts are the foundation every episode reads from)
    //   - Standalone feature → Overview
    if (project.format.verticalSandbox) {
      setTab('vertical')
    } else if (project.planning.seriesPlan) {
      setTab('series')
    } else {
      setTab('overview')
    }
  }, [project, setTab])

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--fg-muted)' }}>
        Open or create a project to begin planning.
      </div>
    )
  }

  const isSeries = !!project.planning.seriesPlan
  const isVertical = project.format.verticalSandbox

  // Two distinct navigation orders, because Vertical projects start with a
  // trope stack and reframe "Beats" as "Episodes" (the on-screen unit the
  // audience consumes one swipe at a time).
  const tabs: Array<{ id: Tab; label: string }> = []
  if (isVertical) {
    // Vertical: Tropes IS the starting point — the trope stack is the
    // pitch, so it goes before Overview.
    tabs.push(
      { id: 'vertical', label: 'Tropes' },
      { id: 'overview', label: 'Overview' },
      { id: 'characters', label: 'Characters' },
      { id: 'beats', label: 'Episodes' },
      { id: 'scenes', label: 'Scenes' },
      { id: 'theme', label: 'Theme · Stakes' },
    )
  } else if (isSeries) {
    // Episodic (TV / animation) projects: the Show Bible is where the
    // series-level facts live (show title, series logline, season arcs,
    // engine, episode roster). It goes FIRST because every episode's
    // Overview depends on it. The Overview tab below is scoped to the
    // currently-active episode — its logline, summary, synopsis, and
    // beats are about THAT episode, not the show.
    tabs.push(
      { id: 'series', label: 'Show Bible' },
      { id: 'overview', label: 'Episode Overview' },
      { id: 'characters', label: 'Characters' },
      { id: 'beats', label: 'Beats' },
      { id: 'scenes', label: 'Scenes' },
      { id: 'theme', label: 'Theme · Stakes' },
    )
  } else {
    // Standalone feature / one-shot screenplay: Overview is the project.
    tabs.push(
      { id: 'overview', label: 'Overview' },
      { id: 'characters', label: 'Characters' },
      { id: 'beats', label: 'Beats' },
      { id: 'scenes', label: 'Scenes' },
      { id: 'theme', label: 'Theme · Stakes' },
    )
  }
  // Sources lives at the bottom of every project's planning nav. It's the
  // permanent home for uploaded materials — scripts the writer is reskinning,
  // show bibles they're continuing, treatments, novels, research notes. Every
  // AI call in the project consults what lives here as canon / extraction /
  // content source, depending on each material's stated mode.
  tabs.push({ id: 'sources', label: 'Sources' })

  return (
    <div className="flex h-full overflow-hidden">
      <aside
        className="w-56 shrink-0 overflow-y-auto border-r"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}
      >
        <div className="px-5 py-4">
          <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
            Planning
          </div>
          <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--fg)' }}>
            {project.title || 'Untitled'}
          </div>
          <div className="mt-0.5 text-xs" style={{ color: 'var(--fg-muted)' }}>
            {project.format.label}
          </div>
        </div>
        <nav className="border-t pt-1" style={{ borderColor: 'var(--border)' }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="block w-full px-5 py-2 text-left text-sm transition-colors"
              style={{
                background: tab === t.id ? 'var(--bg-deep)' : 'transparent',
                color: tab === t.id ? 'var(--fg)' : 'var(--fg-soft)',
                borderLeft: tab === t.id ? '2px solid var(--fg)' : '2px solid transparent',
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto subtle-scrollbar">
        {tab === 'overview' && <OverviewPanel />}
        {tab === 'series' && <SeriesPanel />}
        {tab === 'characters' && <CharactersPanel />}
        {tab === 'beats' && <BeatBoard />}
        {tab === 'scenes' && <SceneCardsPanel />}
        {tab === 'theme' && <ThemesAndStakesPanel />}
        {tab === 'vertical' && <VerticalPlanningPanel />}
        {tab === 'sources' && <ReferencesPanel />}
      </main>
    </div>
  )
}
