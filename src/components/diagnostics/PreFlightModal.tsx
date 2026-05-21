import { useMemo } from 'react'
import { useProjectStore } from '@/store'
import { runDiagnostics } from '@/lib/diagnostics'

export function PreFlightModal({ onClose }: { onClose: () => void }) {
  const project = useProjectStore(s => s.project)
  const report = useMemo(() => (project ? runDiagnostics(project) : null), [project])
  if (!project || !report) return null

  return (
    <div
      className="w-[640px] max-w-[94vw] max-h-[85vh] overflow-y-auto subtle-scrollbar border shadow-2xl"
      style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)' }}
    >
      <header className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-base font-semibold">Pre-Flight Check</h2>
        <button onClick={onClose} className="text-xs uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>Close</button>
      </header>
      <div className="px-5 py-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <Stat label="Errors" n={report.totalsBySeverity.error} color="var(--error)" />
          <Stat label="Warnings" n={report.totalsBySeverity.warning} color="var(--warning)" />
          <Stat label="Notes" n={report.totalsBySeverity.suggestion} color="var(--fg-muted)" />
        </div>

        <h3 className="mt-6 mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
          By Category
        </h3>
        <ul className="space-y-1 text-sm">
          {Object.entries(report.totalsByCategory).map(([cat, n]) => (
            <li key={cat} className="flex items-center justify-between border-b py-1.5" style={{ borderColor: 'var(--border)' }}>
              <span style={{ color: 'var(--fg)' }}>{cat.replace(/_/g, ' ')}</span>
              <span style={{ color: 'var(--fg-muted)' }}>{n}</span>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-xs italic" style={{ color: 'var(--fg-muted)' }}>
          Open the Diagnostics panel in Writing mode to address each finding. Errors will block PageCraft's strict export.
        </p>
      </div>
    </div>
  )
}

function Stat({ label, n, color }: { label: string; n: number; color: string }) {
  return (
    <div className="border py-4" style={{ borderColor: 'var(--border)' }}>
      <div className="text-3xl font-light" style={{ color }}>{n}</div>
      <div className="mt-1 text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>{label}</div>
    </div>
  )
}
