import { useState } from 'react'
import { useProjectStore } from '@/store'
import { useAIAssist } from '@/hooks/useAIAssist'
import type { Subplot } from '@/types'
import { newId } from '@/types'
import {
  generateThemeQuestion,
  generateThemeTags,
  generateExternalStakes,
  generateInternalStakes,
  fillThemesSection,
  fillSubplotFields,
  suggestSubplotField,
} from '@/lib/ai'
import { DEFAULT_SUBPLOT_COLORS } from '@/lib/storage/blank-project'
import { AIAssistButton } from '@/components/ai/AIAssistButton'
import { TakeItFromHereButton } from '@/components/ai/TakeItFromHereButton'
import { SectionConfirmBar } from '@/components/ai/SectionConfirmBar'

/**
 * Theme · Stakes panel.
 *
 * The Subplots section here is the single source of truth for A-story,
 * B-story, C-story, D-story arcs. The Beat Board's color legend reads
 * from and writes to the same `project.planning.subplots` array, so a
 * rename or description change in either place is immediately reflected
 * in the other.
 */
export function ThemesAndStakesPanel() {
  const project = useProjectStore(s => s.project)
  const patch = useProjectStore(s => s.patchPlanning)
  const { runText, runDirect, drawer } = useAIAssist()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!project) return null
  const p = project.planning
  const locked = p.confirmations.themes
  const subplots = p.subplots ?? []

  const handleRunWithIt = async () => {
    setBusy(true); setError(null)
    // Step 1: fill scalar theme + stakes fields.
    const themesRes = await runDirect(fillThemesSection, (fill) => {
      const next: Partial<typeof p> = {}
      if (fill.themeQuestion && !p.themeQuestion) next.themeQuestion = fill.themeQuestion
      if (fill.themes && !p.themes.length) next.themes = fill.themes
      if (fill.externalStakes && !p.externalStakes) next.externalStakes = fill.externalStakes
      if (fill.internalStakes && !p.internalStakes) next.internalStakes = fill.internalStakes
      if (fill.seriesArcQuestion && !p.seriesArcQuestion) next.seriesArcQuestion = fill.seriesArcQuestion
      patch(next)
    })
    if (!themesRes.ok) {
      setError(themesRes.error ?? 'Unknown error.')
      setBusy(false)
      return
    }
    // Step 2: for every subplot that's still missing a description or
    // dramatic question, generate story-specific values from the now-
    // populated context. We update the project store directly so each
    // run sees the latest state.
    for (const sp of subplots) {
      const liveProject = useProjectStore.getState().project
      const liveSubplot = liveProject?.planning.subplots?.find(s => s.id === sp.id)
      if (!liveSubplot) continue
      if (liveSubplot.description && liveSubplot.dramaticQuestion && liveSubplot.label && liveSubplot.label !== `${liveSubplot.letter}-story`) continue
      const r = await runDirect(
        (input) => fillSubplotFields(input, { subplot: liveSubplot }),
        (fill) => {
          const merged: Partial<Subplot> = {}
          if (fill.label && (!liveSubplot.label || liveSubplot.label === `${liveSubplot.letter}-story`)) merged.label = fill.label
          if (fill.description && !liveSubplot.description) merged.description = fill.description
          if (fill.dramaticQuestion && !liveSubplot.dramaticQuestion) merged.dramaticQuestion = fill.dramaticQuestion
          if (Object.keys(merged).length > 0) {
            const next = (useProjectStore.getState().project?.planning.subplots ?? []).map(s =>
              s.id === sp.id ? { ...s, ...merged } : s,
            )
            patch({ subplots: next })
          }
        },
      )
      if (!r.ok) {
        // Non-fatal — keep going for the next subplot. Report at the end.
        // eslint-disable-next-line no-console
        console.warn(`[PageCraft] Could not auto-fill subplot ${sp.letter}: ${r.error}`)
      }
    }
    setBusy(false)
  }

  const updateSubplot = (id: string, sp: Partial<Subplot>) => {
    patch({ subplots: subplots.map(s => s.id === id ? { ...s, ...sp } : s) })
  }
  const removeSubplot = (id: string) => {
    patch({ subplots: subplots.filter(s => s.id !== id) })
  }
  // Vertical projects model the same data as "Loops" instead of "Subplots".
  // A loop = an entire mini-story arc with its own setup/payoff/resolution
  // played out across ~5 episodes. A season has 6–9 loops.
  const isVertical = !!project.format.verticalSandbox

  const addSubplot = () => {
    if (isVertical) {
      // Number the next loop. Loops use numeric labels ("1", "2", …)
      // instead of the prestige A/B/C letter system.
      const usedNumbers = new Set<number>()
      for (const s of subplots) {
        const n = parseInt(s.letter, 10)
        if (Number.isFinite(n)) usedNumbers.add(n)
      }
      let next = 1
      while (usedNumbers.has(next)) next += 1
      const color = DEFAULT_SUBPLOT_COLORS[subplots.length % DEFAULT_SUBPLOT_COLORS.length]
      const created: Subplot = {
        id: newId<any>(),
        letter: String(next),
        label: '',
        description: '',
        characterIds: [],
        dramaticQuestion: '',
        color,
      }
      patch({ subplots: [...subplots, created] })
      return
    }
    const used = new Set(subplots.map(s => s.letter.toUpperCase()))
    let letter = 'A'
    for (const c of 'ABCDEFGHIJ') {
      if (!used.has(c)) { letter = c; break }
    }
    const color = DEFAULT_SUBPLOT_COLORS[subplots.length % DEFAULT_SUBPLOT_COLORS.length]
    const created: Subplot = {
      id: newId<any>(),
      letter,
      label: '',
      description: '',
      characterIds: [],
      dramaticQuestion: '',
      color,
    }
    patch({ subplots: [...subplots, created] })
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-6">
      <div className="mb-4 flex items-end justify-between">
        <h2 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--fg)' }}>Theme · Stakes</h2>
        <TakeItFromHereButton
          busy={busy}
          disabled={locked}
          onClick={handleRunWithIt}
          title="Complete Theme · Stakes"
        />
      </div>
      {error && (
        <div className="mb-4 border px-3 py-2 text-xs" style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>
          {error}
        </div>
      )}

      <fieldset disabled={locked} className="space-y-4">
        <Field
          label="Theme question"
          ai={<AIAssistButton label="Generate" compact disabled={locked}
            onClick={() => runText({
              label: 'Theme question',
              task: input => generateThemeQuestion(input),
              onAccept: text => patch({ themeQuestion: text }),
            })}
          />}
        >
          <textarea value={p.themeQuestion} onChange={e => patch({ themeQuestion: e.target.value })} className="textarea" rows={3} placeholder='e.g. "Is freedom worth the people who love you?"' />
        </Field>
        <Field
          label="Theme tags (one per line)"
          ai={<AIAssistButton label="Generate" compact disabled={locked}
            onClick={() => runText({
              label: 'Theme tags',
              task: async input => {
                const r = await generateThemeTags(input)
                return r.ok ? { ...r, value: r.value.themes.join('\n') } : r
              },
              onAccept: text => patch({ themes: text.split('\n').filter(Boolean) }),
            })}
          />}
        >
          <textarea
            value={p.themes.join('\n')}
            onChange={e => patch({ themes: e.target.value.split('\n').filter(Boolean) })}
            className="textarea"
            rows={4}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="External stakes"
            ai={<AIAssistButton label="Generate" compact disabled={locked}
              onClick={() => runText({
                label: 'External stakes',
                task: input => generateExternalStakes(input),
                onAccept: text => patch({ externalStakes: text }),
              })}
            />}
          >
            <textarea value={p.externalStakes} onChange={e => patch({ externalStakes: e.target.value })} className="textarea" rows={4} />
          </Field>
          <Field
            label="Internal stakes"
            ai={<AIAssistButton label="Generate" compact disabled={locked}
              onClick={() => runText({
                label: 'Internal stakes',
                task: input => generateInternalStakes(input),
                onAccept: text => patch({ internalStakes: text }),
              })}
            />}
          >
            <textarea value={p.internalStakes} onChange={e => patch({ internalStakes: e.target.value })} className="textarea" rows={4} />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-end justify-between">
            <label className="field">{isVertical ? 'Loops (Cycles)' : 'Subplots'}</label>
            <button
              type="button"
              onClick={addSubplot}
              className="text-xs uppercase tracking-widest hover:underline"
              style={{ color: 'var(--fg-soft)' }}
            >
              {isVertical ? '+ Add loop' : '+ Add subplot'}
            </button>
          </div>
          {isVertical && (
            <p className="mb-2 text-xs leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
              A LOOP (also called a cycle) is a self-contained mini-story arc inside the season — its own
              setup, payoff, and resolution played out across ~5 episodes. A season holds 6–9 loops.
            </p>
          )}
          {subplots.length === 0 && (
            <div className="border px-4 py-6 text-center text-xs" style={{ borderColor: 'var(--border)', color: 'var(--fg-muted)' }}>
              {isVertical ? 'No loops yet.' : 'No subplots yet.'}
            </div>
          )}
          <div className="space-y-3">
            {subplots.map(sp => (
              <SubplotRow
                key={sp.id}
                subplot={sp}
                locked={locked}
                isVertical={isVertical}
                runText={runText}
                runDirect={runDirect}
                onChange={(patch) => updateSubplot(sp.id, patch)}
                onDelete={() => removeSubplot(sp.id)}
              />
            ))}
          </div>
        </div>

        <Field label="Series arc question (TV)">
          <textarea value={p.seriesArcQuestion} onChange={e => patch({ seriesArcQuestion: e.target.value })} className="textarea" rows={2} />
        </Field>
        <Field label="Continuity notes">
          <textarea value={p.continuityNotes} onChange={e => patch({ continuityNotes: e.target.value })} className="textarea" rows={4} />
        </Field>
      </fieldset>

      <SectionConfirmBar section="themes" />
      {drawer}
    </div>
  )
}

function Field({ label, ai, children }: { label: string; ai?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="field">{label}</label>
        {ai}
      </div>
      {children}
    </div>
  )
}

function SubplotRow({
  subplot, locked, isVertical, runText, runDirect, onChange, onDelete,
}: {
  subplot: Subplot
  locked: boolean
  isVertical: boolean
  runText: ReturnType<typeof useAIAssist>['runText']
  runDirect: ReturnType<typeof useAIAssist>['runDirect']
  onChange: (patch: Partial<Subplot>) => void
  onDelete: () => void
}) {
  const [fillBusy, setFillBusy] = useState(false)
  const handleFillEmpty = async () => {
    setFillBusy(true)
    await runDirect(
      (input) => fillSubplotFields(input, { subplot }),
      (patch) => onChange(patch),
    )
    setFillBusy(false)
  }

  // Vertical UIs render "Loop N — <label>" instead of the letter system.
  const loopBadge = isVertical
    ? `Loop ${subplot.letter || '?'}`
    : subplot.letter

  return (
    <div className="border" style={{ borderColor: 'var(--border)', borderLeftWidth: 4, borderLeftColor: subplot.color }}>
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}>
        <div className="flex items-center gap-2">
          {isVertical ? (
            <span
              className="inline-flex h-7 min-w-[60px] items-center justify-center border px-2 text-xs font-bold uppercase tracking-widest"
              style={{ borderColor: 'var(--border)', color: 'var(--fg)' }}
              title="Loop number — auto-assigned"
            >
              {loopBadge}
            </span>
          ) : (
            <input
              value={subplot.letter}
              disabled={locked}
              onChange={e => onChange({ letter: e.target.value.toUpperCase().slice(0, 2) })}
              className="input max-w-[48px] text-xs font-bold"
            />
          )}
          <input
            value={subplot.label}
            disabled={locked}
            onChange={e => onChange({ label: e.target.value })}
            placeholder={isVertical ? `Loop ${subplot.letter || '?'} — what's this mini-arc about?` : `${subplot.letter}-story name`}
            className="input text-sm font-semibold"
          />
          <AIAssistButton
            label="Name"
            compact
            disabled={locked}
            onClick={() => runText({
              label: isVertical ? `Loop ${subplot.letter}: name` : `Subplot ${subplot.letter}: name`,
              task: input => suggestSubplotField(input, { subplot, field: 'label' }),
              onAccept: text => onChange({ label: text }),
            })}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={subplot.color}
            disabled={locked}
            onChange={e => onChange({ color: e.target.value })}
            className="h-7 w-9 border-0 bg-transparent p-0"
          />
          <AIAssistButton
            label="Fill empty"
            compact
            busy={fillBusy}
            disabled={locked}
            onClick={handleFillEmpty}
          />
          <button
            type="button"
            onClick={onDelete}
            disabled={locked}
            className="text-[10px] uppercase tracking-widest disabled:opacity-50"
            style={{ color: 'var(--fg-muted)' }}
          >
            Delete
          </button>
        </div>
      </div>
      <div className="space-y-3 px-3 py-3">
        <div>
          <div className="flex items-center justify-between">
            <label className="field">Description</label>
            <AIAssistButton
              label="Generate"
              compact
              disabled={locked}
              onClick={() => runText({
                label: isVertical ? `Loop ${subplot.letter}: description` : `Subplot ${subplot.letter}: description`,
                task: input => suggestSubplotField(input, { subplot, field: 'description' }),
                onAccept: text => onChange({ description: text }),
              })}
            />
          </div>
          <textarea
            value={subplot.description}
            disabled={locked}
            onChange={e => onChange({ description: e.target.value })}
            className="textarea"
            rows={3}
            placeholder='What this thread actually is, with named characters and a clear arc from start to finish.'
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="field">Dramatic question</label>
            <AIAssistButton
              label="Generate"
              compact
              disabled={locked}
              onClick={() => runText({
                label: isVertical ? `Loop ${subplot.letter}: dramatic question` : `Subplot ${subplot.letter}: dramatic question`,
                task: input => suggestSubplotField(input, { subplot, field: 'dramaticQuestion' }),
                onAccept: text => onChange({ dramaticQuestion: text }),
              })}
            />
          </div>
          <input
            value={subplot.dramaticQuestion}
            disabled={locked}
            onChange={e => onChange({ dramaticQuestion: e.target.value })}
            className="input"
            placeholder='e.g. "Will Maya tell her sister the truth before the wedding?"'
          />
        </div>
      </div>
    </div>
  )
}
