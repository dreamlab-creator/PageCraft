import type { SectionConfirmations } from '@/types'
import { useProjectStore } from '@/store'

interface Props {
  section: keyof SectionConfirmations
  label?: string
  /** Optional: number of fields/items that should be filled before we let the user confirm. */
  readyHint?: { satisfied: number; total: number; label?: string }
}

const SECTION_LABELS: Record<keyof SectionConfirmations, string> = {
  overview: 'Overview',
  characters: 'Characters',
  beats: 'Beats',
  scenes: 'Scenes',
  themes: 'Theme · Stakes',
  vertical: 'Tropes',
}

/** Vertical-only label overrides so the user sees their nomenclature
 *  everywhere ("Episodes" instead of "Beats", "Tropes" instead of "Vertical Plan"). */
const SECTION_LABELS_VERTICAL: Partial<Record<keyof SectionConfirmations, string>> = {
  beats: 'Episodes',
  vertical: 'Tropes',
}

/**
 * Bottom-of-section bar that lets the user lock the section in or unlock it.
 * When locked, every subsequent AI call treats this section's contents as
 * canonical truth and is forbidden from contradicting it.
 */
export function SectionConfirmBar({ section, label, readyHint }: Props) {
  const project = useProjectStore(s => s.project)
  const patch = useProjectStore(s => s.patchPlanning)
  if (!project) return null
  const locked = project.planning.confirmations[section]
  const isVertical = !!project.format.verticalSandbox
  const sectionLabel =
    label
    ?? (isVertical ? SECTION_LABELS_VERTICAL[section] ?? SECTION_LABELS[section] : SECTION_LABELS[section])

  const toggle = () => {
    patch({
      confirmations: { ...project.planning.confirmations, [section]: !locked },
    })
  }

  return (
    <div
      className="my-5 flex items-center justify-between gap-3 border px-3 py-2"
      style={{
        borderColor: locked ? 'var(--accent)' : 'var(--border)',
        background: locked ? 'rgba(168,133,90,0.06)' : 'var(--bg-deep)',
      }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest" style={{ color: locked ? 'var(--accent)' : 'var(--fg-muted)' }}>
          {locked ? <Lock /> : <Unlock />}
          {locked ? `${sectionLabel} — Locked` : `${sectionLabel} — Editing`}
          {readyHint && (
            <span className="text-[10px] font-normal tracking-normal normal-case" style={{ color: 'var(--fg-muted)' }}>
              · {readyHint.label ?? 'Filled'} {readyHint.satisfied}/{readyHint.total}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--fg-soft)' }}>
          {locked
            ? `Canonical. The AI treats this section as immutable.`
            : `Confirm to lock this section in. The AI will treat it as canonical truth.`}
        </p>
      </div>
      <button
        onClick={toggle}
        className={locked ? 'btn-ghost text-xs' : 'btn-accent text-xs'}
      >
        {locked ? 'Unlock' : `Confirm ${sectionLabel}`}
      </button>
    </div>
  )
}

function Lock() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="2" y="4" width="6" height="5" stroke="currentColor" strokeWidth="1" />
      <path d="M3 4 V3 a2 2 0 0 1 4 0 V4" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function Unlock() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="2" y="4" width="6" height="5" stroke="currentColor" strokeWidth="1" />
      <path d="M3 4 V3 a2 2 0 0 1 4 0 V3.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}
