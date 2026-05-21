/**
 * Series / Show-Bible Planning panel.
 *
 * Sits in the Planning sidebar for any TV / animation project (NOT
 * vertical). Houses the season-level show bible:
 *
 *   - Show metadata (title, premise, engine, season-arc question, tone)
 *   - Season arcs (multi-episode threads with their own dramatic questions)
 *   - Episode list (lean rows with title / logline / status / focus cast)
 *
 * Take-It-From-Here generates the entire season; per-episode AI fills
 * single episodes; the episode editor opens an inline drawer.
 *
 * Continuity (characters, world rules, hard constraints) is shared from
 * the rest of the project — the user writes one episode at a time using
 * the existing Beats / Scenes / Writing tools, with the show-bible data
 * always available as system context to the AI.
 */

import { useMemo, useState } from 'react'
import { useProjectStore } from '@/store'
import type { SeasonArc, SeriesEpisode } from '@/types'
import { newId } from '@/types'
import { useAIAssist } from '@/hooks/useAIAssist'
import {
  generateSeasonOutline,
  suggestEpisode,
  generateSeriesLogline,
  generateSeriesShortSummary,
  generateSeriesLongSynopsis,
  generateSeriesEngine,
  generateSeasonArcQuestion,
} from '@/lib/ai'
import { useChunkedTakeover } from '@/hooks/useChunkedTakeover'
import { DEFAULT_SUBPLOT_COLORS } from '@/lib/storage/blank-project'
import { AIAssistButton } from '@/components/ai/AIAssistButton'
import { TakeItFromHereButton } from '@/components/ai/TakeItFromHereButton'

export function SeriesPanel() {
  const project = useProjectStore(s => s.project)
  const patchPlan = useProjectStore(s => s.patchSeriesPlan)
  const upsertEpisode = useProjectStore(s => s.upsertEpisode)
  const removeEpisode = useProjectStore(s => s.removeEpisode)
  const upsertArc = useProjectStore(s => s.upsertSeasonArc)
  const removeArc = useProjectStore(s => s.removeSeasonArc)
  const { runText, runDirect, drawer } = useAIAssist()
  const patchProjectPlanning = useProjectStore(s => s.patchPlanning)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const chunked = useChunkedTakeover()
  const [error, setError] = useState<string | null>(null)
  const [editingEpisodeId, setEditingEpisodeId] = useState<string | null>(null)

  if (!project) return null
  const plan = project.planning.seriesPlan
  if (!plan) {
    return (
      <div className="px-8 py-6 text-sm" style={{ color: 'var(--fg-muted)' }}>
        This project does not have a series scaffold. (Available on TV / animation formats.)
      </div>
    )
  }

  const sortedEpisodes = [...plan.episodes].sort((a, b) => a.number - b.number)
  const editing = editingEpisodeId ? plan.episodes.find(e => e.id === editingEpisodeId) ?? null : null
  const bibleLocked = !!plan.locked

  /**
   * Take It From Here for the season.
   *
   * Two-phase chunked execution:
   *   1. First call to `generateSeasonOutline` lands the season arcs +
   *      the first batch of episodes. This is bounded — generateSeasonOutline
   *      already targets the new-episode count, but on very long seasons
   *      we cap the initial batch via a small target and supplement with
   *      single-episode calls.
   *   2. For the remaining episodes the orchestrator iterates calling
   *      `suggestEpisode` one episode at a time. Each call is small so
   *      truncation is effectively impossible; on any single failure we
   *      keep going for the rest.
   */
  const handleGenerateSeason = async () => {
    setError(null); setNotice(null)
    setBusy(true)

    // Phase 1: arcs + initial 4 episodes via generateSeasonOutline.
    const phase1 = await runDirect(generateSeasonOutline, ({ arcs, episodes }) => {
      const existingArcLabels = new Set(plan.seasonArcs.map(a => a.label.trim().toLowerCase()))
      const newArcs: SeasonArc[] = arcs
        .filter(a => !existingArcLabels.has(a.label.trim().toLowerCase()))
        .map((a, i) => ({
          id: newId<any>(),
          label: a.label,
          description: a.description,
          dramaticQuestion: a.dramaticQuestion,
          episodeIds: [],
          color: DEFAULT_SUBPLOT_COLORS[(plan.seasonArcs.length + i) % DEFAULT_SUBPLOT_COLORS.length],
        }))
      for (const a of newArcs) upsertArc(a)

      const arcByLabel = new Map<string, string>()
      ;[...plan.seasonArcs, ...newArcs].forEach(a => arcByLabel.set(a.label.trim().toLowerCase(), a.id))

      const existingNumbers = new Set(plan.episodes.map(e => e.number))
      for (const ai of episodes) {
        if (typeof ai.number !== 'number' || existingNumbers.has(ai.number)) continue
        const ep: SeriesEpisode = {
          id: newId<any>(),
          number: ai.number,
          season: plan.seasonNumber,
          title: ai.title || `Episode ${ai.number}`,
          logline: ai.logline || '',
          summary: ai.summary || '',
          hook: ai.hook,
          arcMovements: (ai.arcMovements ?? []).map(m => ({
            arcId: arcByLabel.get(m.arcLabel.trim().toLowerCase()) ?? '',
            movement: m.movement,
          })).filter(m => m.arcId),
          focusCharacterIds: matchCharacterIdsByName(project.characters, ai.focusCharacters ?? []),
          status: ai.status ?? 'planned',
        }
        upsertEpisode(ep)
      }
    })

    if (!phase1.ok) {
      // Even arcs failed — surface a clear error and stop.
      setBusy(false)
      setError(`Could not generate season arcs: ${phase1.error ?? 'unknown error'}`)
      return
    }

    // Phase 2: chunk any episodes still missing via suggestEpisode (one
    // call per episode — small, safe, recoverable).
    const livePlan = useProjectStore.getState().project?.planning.seriesPlan
    const target = livePlan?.targetEpisodeCount ?? plan.targetEpisodeCount
    const have = new Set((livePlan?.episodes ?? []).map(e => e.number))
    const remaining: number[] = []
    for (let n = 1; n <= target; n++) {
      if (!have.has(n)) remaining.push(n)
    }
    if (remaining.length === 0) {
      setBusy(false)
      setNotice(`Season filled: ${target} episodes laid out.`)
      return
    }

    const summary = await chunked.run<number, void>({
      items: remaining,
      batchSize: 1, // one episode per call — small and safe
      runBatch: async (batch) => {
        const number = batch[0]
        const res = await runDirect(
          (input) => suggestEpisode(input, { number }),
          (ai) => {
            const livePlanInner = useProjectStore.getState().project?.planning.seriesPlan
            const arcByLabel = new Map<string, string>()
            ;(livePlanInner?.seasonArcs ?? []).forEach(a => arcByLabel.set(a.label.trim().toLowerCase(), a.id))
            const ep: SeriesEpisode = {
              id: newId<any>(),
              number: ai.number,
              season: livePlanInner?.seasonNumber ?? plan.seasonNumber,
              title: ai.title || `Episode ${ai.number}`,
              logline: ai.logline || '',
              summary: ai.summary || '',
              hook: ai.hook,
              arcMovements: (ai.arcMovements ?? []).map(m => ({
                arcId: arcByLabel.get(m.arcLabel.trim().toLowerCase()) ?? '',
                movement: m.movement,
              })).filter(m => m.arcId),
              focusCharacterIds: matchCharacterIdsByName(project.characters, ai.focusCharacters ?? []),
              status: ai.status ?? 'planned',
            }
            upsertEpisode(ep)
          },
        )
        if (res.ok) return { ok: true, value: undefined }
        const errLower = (res.error ?? '').toLowerCase()
        const truncated =
          errLower.includes('max_tokens')
          || errLower.includes('cut off')
          || errLower.includes('context length')
          || errLower.includes('too long')
          || errLower.includes('exceeds')
        return { ok: false, error: res.error ?? 'Unknown error.', truncated }
      },
      onPartial: () => { /* applied via runDirect's onAccept */ },
    })

    setBusy(false)
    if (summary.completed.length >= remaining.length && !summary.error) {
      setNotice(`Season filled: ${target} episodes laid out.`)
    } else if (summary.completed.length > 0) {
      setNotice(
        `Wrote ${summary.completed.length} of ${remaining.length} remaining episodes. `
        + `Click "Take It From Here" again to continue.`,
      )
    } else if (summary.error) {
      setError(summary.error)
    }
  }

  const handleAddEpisode = () => {
    const nextNumber = plan.episodes.length > 0
      ? Math.max(...plan.episodes.map(e => e.number)) + 1
      : 1
    const ep: SeriesEpisode = {
      id: newId<any>(),
      number: nextNumber,
      season: plan.seasonNumber,
      title: `Episode ${nextNumber}`,
      logline: '',
      summary: '',
      arcMovements: [],
      focusCharacterIds: [],
      status: 'planned',
    }
    upsertEpisode(ep)
    setEditingEpisodeId(ep.id)
  }

  const handleSuggestSingleEpisode = async () => {
    setBusy(true); setError(null)
    const res = await runDirect(
      (input) => suggestEpisode(input, {}),
      (ai) => {
        const arcByLabel = new Map<string, string>()
        plan.seasonArcs.forEach(a => arcByLabel.set(a.label.trim().toLowerCase(), a.id))
        const ep: SeriesEpisode = {
          id: newId<any>(),
          number: ai.number,
          season: plan.seasonNumber,
          title: ai.title || `Episode ${ai.number}`,
          logline: ai.logline || '',
          summary: ai.summary || '',
          hook: ai.hook,
          arcMovements: (ai.arcMovements ?? []).map(m => ({
            arcId: arcByLabel.get(m.arcLabel.trim().toLowerCase()) ?? '',
            movement: m.movement,
          })).filter(m => m.arcId),
          focusCharacterIds: matchCharacterIdsByName(project.characters, ai.focusCharacters ?? []),
          status: ai.status ?? 'planned',
        }
        upsertEpisode(ep)
      },
    )
    setBusy(false)
    if (!res.ok) setError(res.error ?? 'Unknown error.')
  }

  const handleAddArc = () => {
    const arc: SeasonArc = {
      id: newId<any>(),
      label: `Arc ${plan.seasonArcs.length + 1}`,
      description: '',
      dramaticQuestion: '',
      episodeIds: [],
      color: DEFAULT_SUBPLOT_COLORS[plan.seasonArcs.length % DEFAULT_SUBPLOT_COLORS.length],
    }
    upsertArc(arc)
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-6">
      <div className="mb-4 flex items-end justify-between">
        <h2 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--fg)' }}>
          Show Bible
        </h2>
        <TakeItFromHereButton
          busy={busy || chunked.busy}
          onClick={handleGenerateSeason}
          title="Generate the full season"
        />
      </div>

      {chunked.busy && chunked.progress && (
        <div
          className="mb-4 flex items-center gap-3 border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--accent)', background: 'var(--bg-elev)' }}
        >
          <span className="uppercase tracking-widest" style={{ color: 'var(--accent)' }}>Autopilot</span>
          <span style={{ color: 'var(--fg)' }}>
            {chunked.progress.completed}/{chunked.progress.total} episodes —{' '}
            <span style={{ color: 'var(--fg-soft)' }}>{chunked.progress.label}</span>
          </span>
          <div className="ml-3 h-1 flex-1 overflow-hidden" style={{ background: 'var(--border)' }}>
            <div
              className="h-full transition-all"
              style={{
                background: 'var(--accent)',
                width: `${Math.min(100, Math.round((chunked.progress.completed / Math.max(1, chunked.progress.total)) * 100))}%`,
              }}
            />
          </div>
          <button
            onClick={chunked.cancel}
            className="border px-2 py-0.5 text-[10px] uppercase tracking-widest"
            style={{ borderColor: 'var(--border)', color: 'var(--fg-soft)' }}
          >
            Stop after this batch
          </button>
        </div>
      )}
      {notice && !chunked.busy && (
        <div className="mb-4 border px-3 py-2 text-xs" style={{ borderColor: 'var(--accent)', color: 'var(--fg)' }}>
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-4 border px-3 py-2 text-xs" style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>
          {error}
        </div>
      )}

      {/* Show-metadata block. EVERYTHING in this block is series-level —
          facts about the whole show, not any single episode. Per-episode
          loglines / summaries / synopses live on each Episode and are
          edited from the Episode Overview tab. */}
      <fieldset disabled={bibleLocked} className={`mb-6 space-y-3 ${bibleLocked ? 'opacity-95' : ''}`}>
        <div
          className="border-l-4 px-3 py-1.5 text-[11px] uppercase tracking-widest"
          style={{ borderColor: 'var(--fg)', color: 'var(--fg-muted)', background: 'var(--bg-deep)' }}
        >
          Series-level — facts about the whole show. Episode loglines, summaries, and synopses are
          edited from the Episode Overview tab.
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Show title">
            <input
              value={plan.showTitle}
              onChange={e => patchPlan({ showTitle: e.target.value })}
              className="input"
              placeholder={project.title}
            />
          </Field>
          <Field label="Season">
            <input
              type="number"
              min={1}
              value={plan.seasonNumber}
              onChange={e => patchPlan({ seasonNumber: parseInt(e.target.value, 10) || 1 })}
              className="input"
            />
          </Field>
        </div>
        <Field
          label="Series logline"
          hint="ONE sentence pitching the whole show — not any single episode. The AI consults this on every generation."
          ai={
            <AIAssistButton
              label="Generate"
              onClick={() => runText({
                label: 'Series logline',
                subtitle: 'One sentence about the show',
                task: input => generateSeriesLogline(input),
                onAccept: text => patchPlan({ seriesLogline: text }),
              })}
            />
          }
        >
          <textarea
            value={plan.seriesLogline ?? ''}
            onChange={e => patchPlan({ seriesLogline: e.target.value })}
            className="textarea"
            rows={2}
            placeholder={`e.g. "A burned-out federal prosecutor takes a small-town job and discovers her predecessor disappeared chasing the same cartel her father once worked for."`}
          />
        </Field>
        <Field
          label="Series short summary"
          hint="One paragraph pitching the show: hook, ensemble, world, recurring tension."
          ai={
            <AIAssistButton
              label="Generate"
              onClick={() => runText({
                label: 'Series short summary',
                subtitle: '3–5 sentences about the show',
                task: input => generateSeriesShortSummary(input),
                onAccept: text => patchPlan({ seriesShortSummary: text }),
              })}
            />
          }
        >
          <textarea
            value={plan.seriesShortSummary ?? ''}
            onChange={e => patchPlan({ seriesShortSummary: e.target.value })}
            className="textarea"
            rows={4}
          />
        </Field>
        <Field
          label="Series long synopsis"
          hint="Multi-paragraph pitch — the world, the arcs, what a typical season feels like."
          ai={
            <AIAssistButton
              label="Generate"
              onClick={() => runText({
                label: 'Series long synopsis',
                subtitle: '500–900 words about the show',
                task: input => generateSeriesLongSynopsis(input),
                onAccept: text => patchPlan({ seriesLongSynopsis: text }),
              })}
            />
          }
        >
          <textarea
            value={plan.seriesLongSynopsis ?? ''}
            onChange={e => patchPlan({ seriesLongSynopsis: e.target.value })}
            className="textarea"
            rows={6}
          />
        </Field>
        <Field
          label="Premise (legacy / quick-pitch)"
          hint="A one-line pitch kept for backward compatibility. Newer projects use 'Series logline' above instead."
        >
          <textarea
            value={plan.premise}
            onChange={e => patchPlan({ premise: e.target.value })}
            className="textarea"
            rows={2}
            placeholder="One sentence: what the show IS."
          />
        </Field>
        <Field
          label="Engine — what generates an episode every week"
          ai={
            <AIAssistButton
              label="Generate"
              onClick={() => runText({
                label: 'Series engine',
                subtitle: 'The recurring weekly mechanism',
                task: input => generateSeriesEngine(input),
                onAccept: text => patchPlan({ engine: text }),
              })}
            />
          }
        >
          <textarea
            value={plan.engine}
            onChange={e => patchPlan({ engine: e.target.value })}
            className="textarea"
            rows={2}
            placeholder="e.g. 'A prosecutor takes a new case each week, building a longer cartel investigation underneath.'"
          />
        </Field>
        <Field
          label="Season-arc question"
          ai={
            <AIAssistButton
              label="Generate"
              onClick={() => runText({
                label: 'Season arc question',
                subtitle: 'One yes/no question the finale answers',
                task: input => generateSeasonArcQuestion(input),
                onAccept: text => patchPlan({ seasonArcQuestion: text }),
              })}
            />
          }
        >
          <input
            value={plan.seasonArcQuestion}
            onChange={e => patchPlan({ seasonArcQuestion: e.target.value })}
            className="input"
            placeholder='e.g. "Will Sarah bring her father to trial?"'
          />
        </Field>
        <Field
          label="Foundational Guidance (project-wide, optional)"
          hint={`Hard constraints applied to EVERY generation in this project — series-wide and episode-wide. E.g.: "22 pages per episode. Single-cam comedy register. Limit ensemble to 6. Keep dialogue tight."`}
        >
          <textarea
            value={project.planning.foundationalGuidance ?? ''}
            onChange={e => patchProjectPlanning({ foundationalGuidance: e.target.value })}
            className="textarea"
            rows={4}
            placeholder="One directive per line."
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Target episode count">
            <input
              type="number"
              min={1}
              value={plan.targetEpisodeCount}
              onChange={e => patchPlan({ targetEpisodeCount: parseInt(e.target.value, 10) || 1 })}
              className="input"
            />
          </Field>
          <Field label="Tone notes">
            <input
              value={plan.toneNotes}
              onChange={e => patchPlan({ toneNotes: e.target.value })}
              className="input"
              placeholder="grounded, character-first, slow-burn"
            />
          </Field>
        </div>
      </fieldset>

      {/* Season arcs — also series-level. Locked together with the show
          bible metadata above so the writer can commit "the whole show
          is settled" with one confirmation at the bottom. */}
      <fieldset disabled={bibleLocked} className={`mb-10 ${bibleLocked ? 'opacity-95' : ''}`}>
        <div className="mb-2 flex items-end justify-between">
          <label className="field">Season arcs (multi-episode threads)</label>
          <button
            onClick={handleAddArc}
            className="text-xs uppercase tracking-widest hover:underline"
            style={{ color: 'var(--fg-soft)' }}
          >
            + Add arc
          </button>
        </div>
        {plan.seasonArcs.length === 0 ? (
          <div className="border px-3 py-4 text-center text-xs" style={{ borderColor: 'var(--border)', color: 'var(--fg-muted)' }}>
            No season arcs yet.
          </div>
        ) : (
          <div className="space-y-2">
            {plan.seasonArcs.map(arc => (
              <ArcRow key={arc.id} arc={arc} onChange={upsertArc} onDelete={() => removeArc(arc.id)} />
            ))}
          </div>
        )}
      </fieldset>

      {/* Episode list. */}
      <section>
        <div className="mb-2 flex items-end justify-between">
          <label className="field">Episodes</label>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAddEpisode}
              className="text-xs uppercase tracking-widest hover:underline"
              style={{ color: 'var(--fg-soft)' }}
            >
              + Add blank
            </button>
            <AIAssistButton
              label="Suggest next"
              compact
              busy={busy}
              onClick={handleSuggestSingleEpisode}
            />
          </div>
        </div>

        {sortedEpisodes.length === 0 ? (
          <div className="border px-3 py-6 text-center text-xs" style={{ borderColor: 'var(--border)', color: 'var(--fg-muted)' }}>
            No episodes yet. Fill in the premise above and click "Take It From Here".
          </div>
        ) : (
          <ul className="space-y-2">
            {sortedEpisodes.map(ep => (
              <li
                key={ep.id}
                className="border"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--bg-elev)',
                }}
              >
                <button
                  onClick={() => setEditingEpisodeId(editingEpisodeId === ep.id ? null : ep.id)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm"
                >
                  <div className="flex items-baseline gap-3">
                    <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                      Ep {ep.number}
                    </span>
                    <span className="font-semibold" style={{ color: 'var(--fg)' }}>{ep.title || '(untitled)'}</span>
                    {ep.logline && (
                      <span className="truncate" style={{ color: 'var(--fg-soft)' }}>— {ep.logline}</span>
                    )}
                  </div>
                  <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                    {ep.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <EpisodeEditor
          episode={editing}
          allArcs={plan.seasonArcs}
          allCharacters={project.characters}
          onChange={upsertEpisode}
          onDelete={() => { removeEpisode(editing.id); setEditingEpisodeId(null) }}
          onClose={() => setEditingEpisodeId(null)}
        />
      )}

      {/* Confirm Show Bible — lives at the very bottom of the page so it's
          the last thing the writer sees after they've populated the
          series metadata, arcs, and episodes. Locks the series-level
          fields above; per-episode locks live on each episode. */}
      <ShowBibleLockBar
        plan={plan}
        locked={bibleLocked}
        onToggle={() => patchPlan({ locked: !bibleLocked })}
      />

      {drawer}
    </div>
  )
}

function Field({ label, hint, ai, children }: { label: string; hint?: string; ai?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="field">{label}</label>
        {ai}
      </div>
      {hint && <p className="-mt-1 mb-2 text-xs" style={{ color: 'var(--fg-muted)' }}>{hint}</p>}
      {children}
    </div>
  )
}

/**
 * Series-level confirm bar. When locked, the show-bible inputs (show
 * title, series logline / short summary / synopsis, premise, engine,
 * season-arc question, target episode count, tone notes, foundational
 * guidance) are disabled and the AI treats them as canonical / immutable
 * on every subsequent generation.
 *
 * Independent of per-episode locks — locking the show bible doesn't
 * lock the episodes, and vice versa.
 */
function ShowBibleLockBar({
  plan, locked, onToggle,
}: {
  plan: NonNullable<ReturnType<typeof useProjectStore.getState>['project']>['planning']['seriesPlan']
  locked: boolean
  onToggle: () => void
}) {
  if (!plan) return null
  const filled = [
    plan.seriesLogline,
    plan.seriesShortSummary,
    plan.seriesLongSynopsis,
    plan.engine,
    plan.seasonArcQuestion,
  ].filter(Boolean).length
  const total = 5

  return (
    <div
      className="my-5 flex items-center justify-between gap-3 border px-3 py-2"
      style={{
        borderColor: locked ? 'var(--accent)' : 'var(--border)',
        background: locked ? 'rgba(168,133,90,0.06)' : 'var(--bg-deep)',
      }}
    >
      <div className="min-w-0">
        <div
          className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest"
          style={{ color: locked ? 'var(--accent)' : 'var(--fg-muted)' }}
        >
          {locked ? <LockGlyph /> : <UnlockGlyph />}
          {locked ? 'Show Bible — Locked' : 'Show Bible — Editing'}
          <span className="text-[10px] font-normal tracking-normal normal-case" style={{ color: 'var(--fg-muted)' }}>
            · Filled {filled}/{total}
          </span>
        </div>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--fg-soft)' }}>
          {locked
            ? `Canonical. Every AI generation in this project treats series-level facts as immutable.`
            : `Confirm to lock the series-level facts. Individual episodes can still be edited.`}
        </p>
      </div>
      <button onClick={onToggle} className={locked ? 'btn-ghost text-xs' : 'btn-accent text-xs'}>
        {locked ? 'Unlock' : 'Confirm Show Bible'}
      </button>
    </div>
  )
}

function LockGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="2" y="4" width="6" height="5" stroke="currentColor" strokeWidth="1" />
      <path d="M3 4 V3 a2 2 0 0 1 4 0 V4" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function UnlockGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="2" y="4" width="6" height="5" stroke="currentColor" strokeWidth="1" />
      <path d="M3 4 V3 a2 2 0 0 1 4 0 V3.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function ArcRow({
  arc, onChange, onDelete,
}: {
  arc: SeasonArc
  onChange: (a: SeasonArc) => void
  onDelete: () => void
}) {
  return (
    <div className="border" style={{ borderColor: 'var(--border)', borderLeftWidth: 4, borderLeftColor: arc.color }}>
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--border)' }}>
        <input
          value={arc.label}
          onChange={e => onChange({ ...arc, label: e.target.value })}
          className="input text-sm font-semibold"
          placeholder="Arc label"
        />
        <input
          type="color"
          value={arc.color}
          onChange={e => onChange({ ...arc, color: e.target.value })}
          className="h-7 w-9 border-0 bg-transparent p-0"
        />
        <button
          onClick={onDelete}
          className="text-[10px] uppercase tracking-widest hover:underline"
          style={{ color: 'var(--fg-muted)' }}
        >
          Delete
        </button>
      </div>
      <div className="space-y-2 px-3 py-3">
        <textarea
          value={arc.description}
          onChange={e => onChange({ ...arc, description: e.target.value })}
          className="textarea text-sm"
          rows={2}
          placeholder="What this thread is across the season, with named characters."
        />
        <input
          value={arc.dramaticQuestion}
          onChange={e => onChange({ ...arc, dramaticQuestion: e.target.value })}
          className="input text-sm"
          placeholder='Dramatic question (yes/no, answered by the finale)'
        />
      </div>
    </div>
  )
}

function EpisodeEditor({
  episode, allArcs, allCharacters, onChange, onDelete, onClose,
}: {
  episode: SeriesEpisode
  allArcs: SeasonArc[]
  allCharacters: Array<{ id: string; name: string }>
  onChange: (e: SeriesEpisode) => void
  onDelete: () => void
  onClose: () => void
}) {
  const update = <K extends keyof SeriesEpisode>(k: K, v: SeriesEpisode[K]) =>
    onChange({ ...episode, [k]: v })

  const arcMovementById = useMemo(() => {
    const out = new Map<string, string>()
    for (const m of episode.arcMovements) out.set(m.arcId, m.movement)
    return out
  }, [episode.arcMovements])

  const setArcMovement = (arcId: string, movement: string) => {
    const next = [
      ...episode.arcMovements.filter(m => m.arcId !== arcId),
      ...(movement.trim() ? [{ arcId, movement }] : []),
    ]
    update('arcMovements', next)
  }

  const toggleFocus = (charId: string) => {
    const has = episode.focusCharacterIds.includes(charId)
    update('focusCharacterIds', has
      ? episode.focusCharacterIds.filter(id => id !== charId)
      : [...episode.focusCharacterIds, charId])
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[720px] max-w-[94vw] max-h-[88vh] overflow-y-auto subtle-scrollbar border"
        style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)' }}
      >
        <header className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold">
            Ep {episode.number} — {episode.title || '(untitled)'}
          </h3>
          <div className="flex items-center gap-3">
            <button
              onClick={onDelete}
              className="text-xs uppercase tracking-widest hover:underline"
              style={{ color: 'var(--fg-muted)' }}
            >
              Delete
            </button>
            <button onClick={onClose} className="text-xs uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
              Close
            </button>
          </div>
        </header>
        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Episode number">
              <input
                type="number"
                value={episode.number}
                onChange={e => update('number', parseInt(e.target.value, 10) || 1)}
                className="input"
              />
            </Field>
            <Field label="Status">
              <select
                value={episode.status}
                onChange={e => update('status', e.target.value as SeriesEpisode['status'])}
                className="select"
              >
                <option value="planned">Planned</option>
                <option value="outlined">Outlined</option>
                <option value="drafted">Drafted</option>
                <option value="final">Final</option>
              </select>
            </Field>
          </div>
          <Field label="Title">
            <input value={episode.title} onChange={e => update('title', e.target.value)} className="input" />
          </Field>
          <Field label="Logline">
            <input
              value={episode.logline}
              onChange={e => update('logline', e.target.value)}
              className="input"
              placeholder="One-sentence pitch for this episode."
            />
          </Field>
          <Field label="Summary">
            <textarea
              value={episode.summary}
              onChange={e => update('summary', e.target.value)}
              className="textarea"
              rows={5}
              placeholder="3–5 sentences: what HAPPENS this week, with named characters."
            />
          </Field>
          <Field label="Cold-open hook (optional)">
            <textarea
              value={episode.hook ?? ''}
              onChange={e => update('hook', e.target.value)}
              className="textarea"
              rows={2}
              placeholder="The pre-title sequence idea."
            />
          </Field>

          {allArcs.length > 0 && (
            <div>
              <label className="field">Arc movements (what each arc spends this week)</label>
              <div className="space-y-2">
                {allArcs.map(arc => (
                  <div
                    key={arc.id}
                    className="border-l-4 pl-3 py-1"
                    style={{ borderLeftColor: arc.color }}
                  >
                    <div className="text-[11px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                      {arc.label}
                    </div>
                    <input
                      value={arcMovementById.get(arc.id) ?? ''}
                      onChange={e => setArcMovement(arc.id, e.target.value)}
                      className="input text-sm"
                      placeholder='e.g. "Maya wins her witness; the cartel learns her name."'
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {allCharacters.length > 0 && (
            <div>
              <label className="field">Focus characters (in this episode)</label>
              <div className="flex flex-wrap gap-2">
                {allCharacters.map(c => {
                  const active = episode.focusCharacterIds.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleFocus(c.id)}
                      className="border px-2 py-1 text-xs"
                      style={{
                        borderColor: active ? 'var(--fg)' : 'var(--border)',
                        background: active ? 'var(--fg)' : 'var(--bg)',
                        color: active ? 'var(--bg)' : 'var(--fg)',
                      }}
                    >
                      {c.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <Field label="Notes (optional)">
            <textarea
              value={episode.notes ?? ''}
              onChange={e => update('notes', e.target.value)}
              className="textarea"
              rows={2}
            />
          </Field>
        </div>
      </div>
    </div>
  )
}

function matchCharacterIdsByName(
  cast: Array<{ id: string; name: string }>,
  names: string[],
): string[] {
  const byUpper = new Map<string, string>()
  for (const c of cast) byUpper.set(c.name.trim().toUpperCase(), c.id)
  const out: string[] = []
  for (const n of names) {
    const id = byUpper.get((n ?? '').trim().toUpperCase())
    if (id) out.push(id)
  }
  return out
}
