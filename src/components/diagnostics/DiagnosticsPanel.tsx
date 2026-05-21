import { useMemo, useState } from 'react'
import { useProjectStore } from '@/store'
import { runDiagnostics } from '@/lib/diagnostics'
import type { DiagnosticFinding, DiagnosticSeverity } from '@/lib/diagnostics'

const SEVERITY_COLOR: Record<DiagnosticSeverity, string> = {
  error: 'var(--error)',
  warning: 'var(--warning)',
  suggestion: 'var(--fg-muted)',
  info: 'var(--fg-muted)',
}

export function DiagnosticsPanel() {
  const project = useProjectStore(s => s.project)
  const [filter, setFilter] = useState<DiagnosticSeverity | 'all'>('all')

  const report = useMemo(() => {
    if (!project) return null
    return runDiagnostics(project)
  }, [project])

  if (!project || !report) return null

  const filtered = filter === 'all'
    ? report.findings
    : report.findings.filter(f => f.severity === filter)

  const handleJump = (f: DiagnosticFinding) => {
    if (f.anchor?.kind === 'element') {
      const el = document.querySelector<HTMLElement>(`[data-block-id="${f.anchor.id}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
          Diagnostics
        </h3>
        <div className="mt-2 flex gap-3 text-[11px]">
          <FilterChip label={`All ${report.findings.length}`}
            active={filter === 'all'} onClick={() => setFilter('all')} />
          <FilterChip label={`Errors ${report.totalsBySeverity.error}`}
            active={filter === 'error'} color={SEVERITY_COLOR.error}
            onClick={() => setFilter('error')} />
          <FilterChip label={`Warnings ${report.totalsBySeverity.warning}`}
            active={filter === 'warning'} color={SEVERITY_COLOR.warning}
            onClick={() => setFilter('warning')} />
          <FilterChip label={`Notes ${report.totalsBySeverity.suggestion}`}
            active={filter === 'suggestion'} color={SEVERITY_COLOR.suggestion}
            onClick={() => setFilter('suggestion')} />
        </div>
      </header>
      <ul className="flex-1 overflow-y-auto subtle-scrollbar py-2">
        {filtered.length === 0 && (
          <li className="px-4 py-6 text-xs" style={{ color: 'var(--fg-muted)' }}>
            All clean. Nothing flagged.
          </li>
        )}
        {filtered.map(f => (
          <li
            key={f.id}
            onClick={() => handleJump(f)}
            className="cursor-pointer border-l-2 px-4 py-2 hover:bg-[var(--bg-deep)]"
            style={{ borderColor: SEVERITY_COLOR[f.severity] }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                {f.category.replace(/_/g, ' ')}
              </span>
              <span className="text-[10px] uppercase tracking-widest" style={{ color: SEVERITY_COLOR[f.severity] }}>
                {f.severity}
              </span>
            </div>
            <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--fg)' }}>{f.title}</div>
            <div className="mt-1 text-xs" style={{ color: 'var(--fg-soft)' }}>{f.detail}</div>
            {f.suggestion && (
              <div className="mt-1 text-xs italic" style={{ color: 'var(--fg-muted)' }}>
                → {f.suggestion}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function FilterChip({ label, active, color, onClick }: { label: string; active: boolean; color?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="border px-2 py-0.5"
      style={{
        borderColor: active ? (color ?? 'var(--fg)') : 'var(--border)',
        color: active ? (color ?? 'var(--fg)') : 'var(--fg-muted)',
      }}
    >
      {label}
    </button>
  )
}
