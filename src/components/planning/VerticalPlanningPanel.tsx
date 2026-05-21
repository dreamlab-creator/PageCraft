import { useProjectStore } from '@/store'
import { VERTICAL_TROPES } from '@/lib/vertical/tropes'
import { SectionConfirmBar } from '@/components/ai/SectionConfirmBar'

export function VerticalPlanningPanel() {
  const project = useProjectStore(s => s.project)
  const setProject = useProjectStore(s => s.setProject)
  if (!project || !project.verticalPlan) return null
  const locked = project.planning.confirmations.vertical

  const vp = project.verticalPlan

  const update = (patch: Partial<typeof vp>) => {
    setProject({ ...project, verticalPlan: { ...vp, ...patch } })
  }

  const updateTrope = (patch: Partial<typeof vp.tropeStack>) => {
    setProject({ ...project, verticalPlan: { ...vp, tropeStack: { ...vp.tropeStack, ...patch } } })
  }

  const toggleTrope = (id: string) => {
    const has = vp.tropeStack.selected.includes(id)
    updateTrope({
      selected: has ? vp.tropeStack.selected.filter(t => t !== id) : [...vp.tropeStack.selected, id],
    })
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-6">
      <h2 className="mb-1 text-xl font-semibold tracking-tight" style={{ color: 'var(--fg)' }}>
        Tropes
      </h2>
      <p className="mb-5 text-sm" style={{ color: 'var(--fg-muted)' }}>
        Your trope stack is the pitch. Pick the tropes and the paywall position first — every beat, every scene, and
        every line of dialogue downstream will be written to serve them.
      </p>

      <fieldset disabled={locked} className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="field">Total episodes</label>
            <input
              type="number"
              value={vp.totalEpisodes}
              onChange={e => update({ totalEpisodes: +e.target.value })}
              className="input"
            />
          </div>
          <div>
            <label className="field">Paywall after episode</label>
            <input
              type="number"
              value={vp.paywallAfterEpisode}
              onChange={e => update({ paywallAfterEpisode: +e.target.value })}
              className="input"
            />
          </div>
          <div>
            <label className="field">Plot type</label>
            <select value={vp.plotType} onChange={e => update({ plotType: e.target.value as any })} className="select">
              <option value="romance">Romance</option>
              <option value="revenge">Revenge</option>
              <option value="romance_overlay_revenge">Romance overlaying Revenge</option>
            </select>
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
            Trope Stack
          </h3>
          <div className="space-y-4">
            {Object.entries(VERTICAL_TROPES).map(([family, tropes]) => (
              <div key={family}>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-soft)' }}>
                  {family.replace(/_/g, ' ')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tropes.map(t => {
                    const selected = vp.tropeStack.selected.includes(t.id)
                    return (
                      <button
                        key={t.id}
                        onClick={() => toggleTrope(t.id)}
                        className="border px-2 py-1 text-xs"
                        style={{
                          background: selected ? 'var(--fg)' : 'transparent',
                          color: selected ? 'var(--bg)' : 'var(--fg-soft)',
                          borderColor: selected ? 'var(--fg)' : 'var(--border)',
                        }}
                      >
                        {t.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className="field">Trope notes — how these combine in your story</label>
          <textarea
            value={vp.tropeStack.notes}
            onChange={e => updateTrope({ notes: e.target.value })}
            className="textarea"
            rows={4}
          />
        </div>
      </fieldset>
      <SectionConfirmBar section="vertical" />
    </div>
  )
}
