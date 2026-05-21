import { useProjectStore } from '@/store'
import { paginate, approximateRuntime } from '@/lib/screenplay'
import { useMemo } from 'react'

export function StatusBar() {
  const project = useProjectStore(s => s.project)
  const dirty = useProjectStore(s => s.dirty)
  const lastAutosave = useProjectStore(s => s.lastAutosave)

  const pagination = useMemo(() => {
    if (!project) return null
    return paginate(project.screenplay, project.format)
  }, [project])

  const sceneCount = useMemo(() => {
    if (!project) return 0
    return project.screenplay.elements.filter(e => e.type === 'scene_heading').length
  }, [project])

  const wordCount = useMemo(() => {
    if (!project) return 0
    return project.screenplay.elements.reduce(
      (n, e) => n + (e.text?.trim() ? e.text.trim().split(/\s+/).length : 0),
      0,
    )
  }, [project])

  const characterCount = project?.characters.length ?? 0

  if (!project) {
    return (
      <footer
        className="flex h-7 shrink-0 items-center justify-between border-t px-3 text-[11px]"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)', color: 'var(--fg-muted)' }}
      >
        <span>No project open</span>
        <span>PageCraft</span>
      </footer>
    )
  }

  const runtime = pagination ? approximateRuntime(pagination.totalPages, project.format) : 0
  const minutes = Math.floor(runtime / 60)
  const seconds = Math.floor(runtime % 60)

  const saveLabel = dirty
    ? 'Editing...'
    : lastAutosave
      ? `Saved ${timeAgo(lastAutosave)}`
      : 'Unsaved'

  return (
    <footer
      className="flex h-7 shrink-0 items-center justify-between border-t px-3 text-[11px]"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)', color: 'var(--fg-muted)' }}
    >
      <div className="flex items-center gap-4">
        <span>{pagination?.totalPages ?? 0} {pagination?.totalPages === 1 ? 'page' : 'pages'}</span>
        <span>{sceneCount} {sceneCount === 1 ? 'scene' : 'scenes'}</span>
        <span>{characterCount} {characterCount === 1 ? 'character' : 'characters'}</span>
        <span>{wordCount.toLocaleString()} words</span>
        <span>≈ {minutes}m {seconds}s</span>
      </div>
      <div className="flex items-center gap-4">
        <span>{project.format.label}</span>
        <span style={{ color: dirty ? 'var(--accent)' : 'var(--fg-muted)' }}>{saveLabel}</span>
      </div>
    </footer>
  )
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 5_000) return 'just now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  return `${Math.floor(diff / 3_600_000)}h ago`
}
