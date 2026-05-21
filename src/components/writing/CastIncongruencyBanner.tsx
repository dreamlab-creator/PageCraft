/**
 * CastIncongruencyBanner — sits above the screenplay editor and surfaces
 * discrepancies between the script and the Character Bible.
 *
 * Three categories:
 *   1. Names introduced in action lines that haven't been adopted as cues
 *      (so the live reconciler didn't auto-add them) — writer chooses.
 *   2. Bible entries with no on-page presence yet.
 *   3. Case / spelling conflicts (e.g., "MAYA" vs "MAYA RIVERS").
 *
 * Live-cued names are silently auto-adopted by `useCastReconciler`, so they
 * only appear here as "needs review" flags on the new stubs, not as
 * full-blown banner items.
 */

import { useMemo, useState } from 'react'
import { useProjectStore, useUIStore } from '@/store'
import type { CharacterId } from '@/types'
import { reconcileCast, canonicalName } from '@/lib/screenplay'

export function CastIncongruencyBanner() {
  const project = useProjectStore(s => s.project)
  const adopt = useProjectStore(s => s.adoptScriptCharacters)
  const navigateTo = useUIStore(s => s.navigateTo)
  const [collapsed, setCollapsed] = useState(false)

  // Jump straight to a specific character row in Planning → Characters.
  const focusCharacter = (characterId: CharacterId) => {
    navigateTo({
      mode: 'planning',
      planningTab: 'characters',
      focus: { kind: 'character', id: characterId },
    })
  }

  const report = useMemo(() => {
    if (!project) return null
    return reconcileCast(project)
  }, [project])

  if (!project || !report) return null

  // Auto-cued script-only names are handled silently by the reconciler;
  // here we only surface names that came in as action-line ALL CAPS
  // candidates (i.e., they aren't cues — they're "did the writer introduce
  // someone we should know about?" prompts).
  const actionOnly = report.scriptOnly.filter(s => s.introducedInAction && s.cueCount === 0)
  const conflicts = report.caseConflicts

  const reviewStubs = project.characters.filter(c => c.needsReview)

  // We intentionally DON'T surface bible-only characters here. A character
  // existing in the bible without being on the page yet is not an
  // incongruency — it's a planned cast member who hasn't been introduced.
  // The reconciler still tracks them internally for diagnostics, but the
  // writing canvas should stay focused on actionable mismatches.

  const total = actionOnly.length + conflicts.length + reviewStubs.length
  if (total === 0) return null

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="mx-auto my-2 flex items-center gap-2 rounded-sm border px-3 py-1 text-xs uppercase tracking-widest"
        style={{
          background: 'var(--bg-elev)',
          borderColor: 'var(--border)',
          color: 'var(--fg-soft)',
        }}
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: 'var(--warning, #c89c4d)' }}
        />
        Cast: {total} item{total === 1 ? '' : 's'} to review
      </button>
    )
  }

  return (
    <aside
      className="mx-auto my-3 max-w-[8.5in] border"
      style={{
        background: 'var(--bg-elev)',
        borderColor: 'var(--border)',
      }}
    >
      <header
        className="flex items-center justify-between border-b px-4 py-2"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: 'var(--warning, #c89c4d)' }}
          />
          <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
            Cast · {total} to review
          </h3>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-xs hover:underline"
          style={{ color: 'var(--fg-soft)' }}
        >
          Hide
        </button>
      </header>

      <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {reviewStubs.length > 0 && (
          <Group title="Newly added (needs review)">
            <div className="flex flex-wrap gap-2">
              {reviewStubs.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => focusCharacter(c.id)}
                  className="rounded-sm border px-2 py-1 text-xs hover:opacity-80"
                  style={{
                    borderColor: 'var(--border)',
                    color: 'var(--fg)',
                    background: 'var(--bg)',
                  }}
                  title={`Open ${c.name} in Planning → Characters`}
                >
                  {c.name}
                  <span
                    className="ml-2 text-[10px] uppercase tracking-widest"
                    style={{ color: 'var(--fg-muted)' }}
                  >
                    {labelForProvenance(c.provenance)}
                  </span>
                </button>
              ))}
            </div>
          </Group>
        )}

        {actionOnly.length > 0 && (
          <Group title="Mentioned in action, not yet cued">
            <ul className="space-y-1">
              {actionOnly.map(s => (
                <li key={s.name} className="flex items-center justify-between text-xs">
                  <span style={{ color: 'var(--fg)' }}>{s.displayName}</span>
                  <button
                    onClick={() => adopt('auto_script', [s.name])}
                    className="rounded-sm border px-2 py-0.5 text-[11px] uppercase tracking-widest hover:opacity-80"
                    style={{
                      borderColor: 'var(--border)',
                      color: 'var(--fg-soft)',
                    }}
                  >
                    Add to bible
                  </button>
                </li>
              ))}
            </ul>
          </Group>
        )}

        {conflicts.length > 0 && (
          <Group title="Possible name conflicts">
            <ul className="space-y-1">
              {conflicts.map(c => (
                <li key={c.canonical} className="text-xs" style={{ color: 'var(--fg)' }}>
                  {c.surfaceForms.join('  ·  ')}
                  <span
                    className="ml-2 text-[10px] uppercase tracking-widest"
                    style={{ color: 'var(--fg-muted)' }}
                  >
                    canonical: {canonicalName(c.canonical)}
                  </span>
                </li>
              ))}
            </ul>
          </Group>
        )}
      </div>
    </aside>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
        {title}
      </h4>
      {children}
    </div>
  )
}

function labelForProvenance(p?: string): string {
  switch (p) {
    case 'ai_scene':
      return 'AI scene'
    case 'ai_bible':
      return 'AI bible'
    case 'auto_script':
      return 'From script'
    case 'user':
    default:
      return ''
  }
}
