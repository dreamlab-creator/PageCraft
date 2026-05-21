import { useMemo, useState } from 'react'
import { useProjectStore, useUIStore } from '@/store'
import { useAIAssist } from '@/hooks/useAIAssist'
import {
  generateLogline,
  generateShortSummary,
  generateLongSynopsis,
  generateCentralQuestion,
  generateStoryEngine,
  generateWorldRules,
  generateHardConstraints,
  fillOverviewSection,
} from '@/lib/ai'
import { AIAssistButton } from '@/components/ai/AIAssistButton'
import { TakeItFromHereButton } from '@/components/ai/TakeItFromHereButton'
import { SectionConfirmBar } from '@/components/ai/SectionConfirmBar'
import { createBlankEpisode, type SeriesEpisode } from '@/types'

/**
 * The Overview panel is dual-mode.
 *
 * For STANDALONE features (no seriesPlan): it edits the project-level
 * Overview — the feature's logline, summary, synopsis, central question,
 * story engine, world rules, hard constraints. Same shape as it's always
 * been.
 *
 * For EPISODIC projects (TV / animation with a seriesPlan): it edits the
 * CURRENTLY-ACTIVE EPISODE — that episode's title, logline, short
 * summary, long synopsis, central dramatic question, theme question.
 * Series-level facts (show title, series logline, season arc question)
 * live in the Show Bible tab; this tab is for the one episode the
 * writer is currently working on.
 *
 * The switch is automatic: if `project.planning.seriesPlan` exists and
 * the project isn't a Vertical sandbox, episodic mode is on. Vertical
 * projects use their own episode model (`verticalPlan`) and do NOT
 * enter the episodic branch here.
 */
export function OverviewPanel() {
  const project = useProjectStore(s => s.project)
  if (!project) return null
  const isEpisodic = !!project.planning.seriesPlan && !project.format.verticalSandbox
  return isEpisodic ? <EpisodeOverview /> : <FeatureOverview />
}

/* ============================================================================
 * FEATURE / standalone screenplay branch — the original Overview UI.
 * ========================================================================= */

function FeatureOverview() {
  const project = useProjectStore(s => s.project)!
  const patch = useProjectStore(s => s.patchPlanning)
  const setTitle = useProjectStore(s => s.setTitle)
  const setAuthor = useProjectStore(s => s.setAuthor)
  const { runText, runDirect, drawer, hasApiKey } = useAIAssist()
  const [runWithItBusy, setRunWithItBusy] = useState(false)
  const [runWithItError, setRunWithItError] = useState<string | null>(null)

  const p = project.planning
  const locked = p.confirmations.overview

  const handleRunWithIt = async () => {
    setRunWithItBusy(true)
    setRunWithItError(null)
    const res = await runDirect(fillOverviewSection, (fill) => {
      const next: Partial<typeof p> = {}
      if (fill.logline && !p.logline) next.logline = fill.logline
      if (fill.shortSummary && !p.shortSummary) next.shortSummary = fill.shortSummary
      if (fill.longSynopsis && !p.longSynopsis) next.longSynopsis = fill.longSynopsis
      if (fill.centralDramaticQuestion && !p.centralDramaticQuestion) next.centralDramaticQuestion = fill.centralDramaticQuestion
      if (fill.storyEngine && !p.storyEngine) next.storyEngine = fill.storyEngine
      if (fill.worldRules && !p.worldRules.length) next.worldRules = fill.worldRules
      if (fill.hardConstraints && !p.hardConstraints.length) next.hardConstraints = fill.hardConstraints
      patch(next)
    })
    setRunWithItBusy(false)
    if (!res.ok) setRunWithItError(res.error ?? 'Unknown error.')
  }

  const fields = [p.logline, p.shortSummary, p.longSynopsis, p.centralDramaticQuestion || p.storyEngine, p.worldRules.length > 0]
  const filled = fields.filter(Boolean).length

  return (
    <div className={`mx-auto max-w-3xl px-8 py-6 ${locked ? 'opacity-90' : ''}`}>
      <div className="mb-4 flex items-end justify-between">
        <h2 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--fg)' }}>
          Overview
        </h2>
        <div className="flex items-center gap-3">
          {!hasApiKey && (
            <span className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
              No AI key set
            </span>
          )}
          <TakeItFromHereButton
            busy={runWithItBusy}
            disabled={locked}
            onClick={handleRunWithIt}
            title="Complete the Overview"
          />
        </div>
      </div>

      <AILegend />

      {runWithItError && (
        <div
          className="mb-4 border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--error)', color: 'var(--error)', background: 'rgba(161,58,46,0.05)' }}
        >
          {runWithItError}
        </div>
      )}

      <fieldset disabled={locked} className="space-y-4">
        <Field label="Title">
          <input value={project.title} onChange={e => setTitle(e.target.value)} className="input" placeholder="Untitled" />
        </Field>
        <Field label="Writer">
          <input value={project.author} onChange={e => setAuthor(e.target.value)} className="input" placeholder="Your name" />
        </Field>

        <Field
          label="Foundational Guidance (optional)"
          hint='Hard constraints the AI must obey across the whole project. E.g.: "Target 90 pages. Keep dialogue minimal. Found-footage subgenre. Limit to 5 characters. Every character speaks with a French accent."'
        >
          <textarea
            value={p.foundationalGuidance ?? ''}
            onChange={e => patch({ foundationalGuidance: e.target.value })}
            className="textarea"
            rows={4}
            placeholder="One directive per line — e.g. Target 90 pages, Keep dialogue minimal, Limit to 5 characters, Found-footage subgenre."
          />
        </Field>

        <Field
          label="Logline"
          hint="One sentence: who, want, obstacle, stakes."
          ai={
            <AIAssistButton
              label="Generate"
              disabled={locked}
              onClick={() => runText({
                label: 'Logline',
                subtitle: 'One-sentence pitch',
                task: input => generateLogline({ ...input, userNudge: input.userNudge }),
                onAccept: text => patch({ logline: text }),
              })}
            />
          }
        >
          <textarea value={p.logline} onChange={e => patch({ logline: e.target.value })} className="textarea" rows={2} placeholder='e.g. "A retired hitman returns for one last job, only to discover the target is the daughter he abandoned twenty years ago."' />
        </Field>

        <Field
          label="Short summary"
          hint="A paragraph. The version you'd tell at a party."
          ai={
            <AIAssistButton
              label="Generate"
              disabled={locked}
              onClick={() => runText({
                label: 'Short summary',
                subtitle: '3–5 sentences',
                task: input => generateShortSummary(input),
                onAccept: text => patch({ shortSummary: text }),
              })}
            />
          }
        >
          <textarea value={p.shortSummary} onChange={e => patch({ shortSummary: e.target.value })} className="textarea" rows={4} />
        </Field>

        <Field
          label="Long synopsis"
          hint="A page or so. The story beats, in plain language."
          ai={
            <AIAssistButton
              label="Generate"
              disabled={locked}
              onClick={() => runText({
                label: 'Long synopsis',
                subtitle: 'Scaled to the project\'s page target',
                task: input => generateLongSynopsis(input),
                onAccept: text => patch({ longSynopsis: text }),
              })}
            />
          }
        >
          <textarea value={p.longSynopsis} onChange={e => patch({ longSynopsis: e.target.value })} className="textarea" rows={8} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Central dramatic question"
            ai={
              <AIAssistButton
                label="Generate"
                compact
                disabled={locked}
                onClick={() => runText({
                  label: 'Central dramatic question',
                  subtitle: 'Yes/no, climax-answerable',
                  task: input => generateCentralQuestion(input),
                  onAccept: text => patch({ centralDramaticQuestion: text }),
                })}
              />
            }
          >
            <textarea value={p.centralDramaticQuestion} onChange={e => patch({ centralDramaticQuestion: e.target.value })} className="textarea" rows={3} />
          </Field>
          <Field
            label="Story engine"
            hint="What recurring pressure / mechanism generates scenes?"
            ai={
              <AIAssistButton
                label="Generate"
                compact
                disabled={locked}
                onClick={() => runText({
                  label: 'Story engine',
                  subtitle: 'The recurring pattern',
                  task: input => generateStoryEngine(input),
                  onAccept: text => patch({ storyEngine: text }),
                })}
              />
            }
          >
            <textarea value={p.storyEngine} onChange={e => patch({ storyEngine: e.target.value })} className="textarea" rows={3} />
          </Field>
        </div>

        <Field
          label="World rules"
          hint="One per line. Anything that defines how this world works."
          ai={
            <AIAssistButton
              label="Generate"
              disabled={locked}
              onClick={() => runText({
                label: 'World rules',
                subtitle: '4–8 short rules',
                task: async input => {
                  const r = await generateWorldRules(input)
                  return r.ok ? { ...r, value: r.value.rules.join('\n') } : r
                },
                onAccept: text => patch({ worldRules: text.split('\n').filter(Boolean) }),
              })}
            />
          }
        >
          <textarea value={p.worldRules.join('\n')} onChange={e => patch({ worldRules: e.target.value.split('\n').filter(s => s.length) })} className="textarea" rows={5} />
        </Field>

        <Field
          label="Hard constraints (locked elements, never to be changed)"
          ai={
            <AIAssistButton
              label="Generate"
              disabled={locked}
              onClick={() => runText({
                label: 'Hard constraints',
                subtitle: 'Author-locked facts',
                task: async input => {
                  const r = await generateHardConstraints(input)
                  return r.ok ? { ...r, value: r.value.constraints.join('\n') } : r
                },
                onAccept: text => patch({ hardConstraints: text.split('\n').filter(Boolean) }),
              })}
            />
          }
        >
          <textarea value={p.hardConstraints.join('\n')} onChange={e => patch({ hardConstraints: e.target.value.split('\n').filter(s => s.length) })} className="textarea" rows={4} />
        </Field>
      </fieldset>

      <SectionConfirmBar section="overview" readyHint={{ satisfied: filled, total: fields.length, label: 'Fields filled' }} />

      {drawer}
    </div>
  )
}

/* ============================================================================
 * EPISODIC branch — edits the active episode, with a visible scope banner.
 * ========================================================================= */

function EpisodeOverview() {
  const project = useProjectStore(s => s.project)!
  const patchActiveEpisode = useProjectStore(s => s.patchActiveEpisode)
  const setActiveEpisode = useProjectStore(s => s.setActiveEpisode)
  const upsertEpisode = useProjectStore(s => s.upsertEpisode)
  const setAuthor = useProjectStore(s => s.setAuthor)
  const setPlanningTab = useUIStore(s => s.setPlanningTab)
  const { runText, drawer, hasApiKey } = useAIAssist()

  const plan = project.planning.seriesPlan!
  const sortedEpisodes = useMemo(() => [...plan.episodes].sort((a, b) => a.number - b.number), [plan.episodes])

  // If the plan has no episodes yet, seed Episode 1 so this panel has
  // something to edit. The writer can change the title / logline /
  // summary immediately; the seeded record is otherwise empty.
  useMemo(() => {
    if (plan.episodes.length === 0) {
      const seed = createBlankEpisode(1, plan.seasonNumber || 1)
      upsertEpisode(seed)
      setActiveEpisode(seed.id)
    } else if (!plan.activeEpisodeId) {
      // Plan has episodes but no active selection — pick episode 1.
      setActiveEpisode(sortedEpisodes[0].id)
    }
    // We intentionally don't depend on every shape change here; we only
    // want to run on first mount per plan instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.episodes.length === 0, plan.activeEpisodeId])

  const active = plan.activeEpisodeId
    ? plan.episodes.find(e => e.id === plan.activeEpisodeId) ?? sortedEpisodes[0]
    : sortedEpisodes[0]

  if (!active) {
    return (
      <div className="mx-auto max-w-3xl px-8 py-6 text-sm" style={{ color: 'var(--fg-muted)' }}>
        Loading the active episode…
      </div>
    )
  }

  const patchEpisode = (p: Partial<SeriesEpisode>) => patchActiveEpisode(p)
  const episodeLocked = !!active.overviewLocked

  // Count "filled" fields for the lock bar's ready hint.
  const epFields = [
    active.logline,
    active.summary,
    active.longSynopsis,
    active.centralDramaticQuestion || active.themeQuestion,
    active.title,
  ]
  const epFilled = epFields.filter(Boolean).length

  return (
    <div className={`mx-auto max-w-3xl px-8 py-6 ${episodeLocked ? 'opacity-90' : ''}`}>
      {/* Scope banner — makes it unmistakable that this tab is editing
          ONE episode, not the show. Links to the Show Bible for any
          series-level work. */}
      <EpisodeScopeBanner
        plan={plan}
        active={active}
        episodes={sortedEpisodes}
        onPick={(id) => setActiveEpisode(id)}
        onJumpToShowBible={() => setPlanningTab('series')}
      />

      <h2 className="mt-4 text-xl font-semibold tracking-tight" style={{ color: 'var(--fg)' }}>
        Episode Overview
      </h2>
      <p className="mt-0.5 text-xs" style={{ color: 'var(--fg-muted)' }}>
        Everything below is for <strong style={{ color: 'var(--fg)' }}>Episode {active.number}{active.title ? ` — ${active.title}` : ''}</strong> only.
        Series-level fields (logline, summary, synopsis, engine, season arc question) and the project&apos;s Foundational Guidance live in the
        {' '}
        <button
          type="button"
          onClick={() => setPlanningTab('series')}
          className="underline hover:opacity-80"
          style={{ color: 'var(--fg-soft)' }}
        >
          Show Bible
        </button>
        .
      </p>

      <div className="mt-4">
        <AILegend />
      </div>

      {!hasApiKey && (
        <div className="mb-4 text-[11px]" style={{ color: 'var(--fg-muted)' }}>
          No AI key set
        </div>
      )}

      <fieldset disabled={episodeLocked} className="space-y-4">
        <div className="grid grid-cols-[120px_1fr] gap-4">
          <Field label="Episode #">
            <input
              type="number"
              min={1}
              value={active.number}
              onChange={e => patchEpisode({ number: Math.max(1, Number(e.target.value) || 1) })}
              className="input"
            />
          </Field>
          <Field label="Episode title">
            <input
              value={active.title}
              onChange={e => patchEpisode({ title: e.target.value })}
              className="input"
              placeholder={`Episode ${active.number} title`}
            />
          </Field>
        </div>

        <Field label="Writer">
          <input
            value={project.author}
            onChange={e => setAuthor(e.target.value)}
            className="input"
            placeholder="Your name"
          />
        </Field>

        <Field
          label="Episode logline"
          hint="ONE sentence about THIS episode — not the show. What happens this week and what's at stake."
          ai={
            <AIAssistButton
              label="Generate"
              onClick={() => runText({
                label: `Episode ${active.number} logline`,
                subtitle: 'One-sentence episode pitch',
                task: input => generateLogline({ ...input, userNudge: input.userNudge }),
                onAccept: text => patchEpisode({ logline: text }),
              })}
            />
          }
        >
          <textarea
            value={active.logline}
            onChange={e => patchEpisode({ logline: e.target.value })}
            className="textarea"
            rows={2}
            placeholder={`e.g. "When the new D.A. drops every case Sarah's built for a year, she has 48 hours to save the witness she promised to protect."`}
          />
        </Field>

        <Field
          label="Episode short summary"
          hint="One paragraph — what happens THIS WEEK, beat by beat in plain language."
          ai={
            <AIAssistButton
              label="Generate"
              onClick={() => runText({
                label: `Episode ${active.number} short summary`,
                subtitle: '3–5 sentences',
                task: input => generateShortSummary(input),
                onAccept: text => patchEpisode({ summary: text }),
              })}
            />
          }
        >
          <textarea
            value={active.summary}
            onChange={e => patchEpisode({ summary: e.target.value })}
            className="textarea"
            rows={4}
          />
        </Field>

        <Field
          label="Episode long synopsis"
          hint="Scaled to this episode's page target. A 22-page hour gets ~150 words; a 2-page short gets a single paragraph. The AI won't pad to hit a length — it honors the actual page count."
          ai={
            <AIAssistButton
              label="Generate"
              onClick={() => runText({
                label: `Episode ${active.number} long synopsis`,
                subtitle: 'Scaled to episode page target',
                task: input => generateLongSynopsis(input),
                onAccept: text => patchEpisode({ longSynopsis: text }),
              })}
            />
          }
        >
          <textarea
            value={active.longSynopsis ?? ''}
            onChange={e => patchEpisode({ longSynopsis: e.target.value })}
            className="textarea"
            rows={6}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Episode central question"
            hint="The yes/no this episode answers (not the series)."
            ai={
              <AIAssistButton
                label="Generate"
                compact
                onClick={() => runText({
                  label: 'Episode central question',
                  subtitle: 'Yes/no, this-episode-answerable',
                  task: input => generateCentralQuestion(input),
                  onAccept: text => patchEpisode({ centralDramaticQuestion: text }),
                })}
              />
            }
          >
            <textarea
              value={active.centralDramaticQuestion ?? ''}
              onChange={e => patchEpisode({ centralDramaticQuestion: e.target.value })}
              className="textarea"
              rows={3}
            />
          </Field>
          <Field label="Episode theme question" hint="One sentence: what is this episode arguing?">
            <textarea
              value={active.themeQuestion ?? ''}
              onChange={e => patchEpisode({ themeQuestion: e.target.value })}
              className="textarea"
              rows={3}
            />
          </Field>
        </div>

        <Field label="Cold-open / hook (optional)">
          <textarea
            value={active.hook ?? ''}
            onChange={e => patchEpisode({ hook: e.target.value })}
            className="textarea"
            rows={2}
            placeholder="The first beat or image that grabs the audience."
          />
        </Field>

        <Field label="Production / writers' room notes">
          <textarea
            value={active.notes ?? ''}
            onChange={e => patchEpisode({ notes: e.target.value })}
            className="textarea"
            rows={3}
            placeholder="Any per-episode notes, callbacks, continuity reminders."
          />
        </Field>

        <div>
          <label className="field">Status</label>
          <select
            value={active.status}
            onChange={e => patchEpisode({ status: e.target.value as SeriesEpisode['status'] })}
            className="select"
          >
            <option value="planned">Planned</option>
            <option value="outlined">Outlined</option>
            <option value="drafted">Drafted</option>
            <option value="final">Final</option>
          </select>
        </div>
      </fieldset>

      <EpisodeLockBar
        active={active}
        locked={episodeLocked}
        onToggle={() => patchEpisode({ overviewLocked: !episodeLocked })}
        filled={epFilled}
        total={epFields.length}
      />

      {drawer}
    </div>
  )
}

/**
 * Bottom-of-Episode-Overview lock bar. Mirrors `SectionConfirmBar` but
 * toggles a PER-EPISODE flag (`SeriesEpisode.overviewLocked`) instead of
 * the project-level confirmations array. Locking one episode's overview
 * does NOT lock the others — each episode confirms independently.
 */
function EpisodeLockBar({
  active, locked, onToggle, filled, total,
}: {
  active: SeriesEpisode
  locked: boolean
  onToggle: () => void
  filled: number
  total: number
}) {
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
          {locked
            ? `Episode ${active.number}${active.title ? ` — "${active.title}"` : ''} · Overview Locked`
            : `Episode ${active.number}${active.title ? ` — "${active.title}"` : ''} · Overview Editing`}
          <span className="text-[10px] font-normal tracking-normal normal-case" style={{ color: 'var(--fg-muted)' }}>
            · Filled {filled}/{total}
          </span>
        </div>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--fg-soft)' }}>
          {locked
            ? `Canonical. Every AI generation for this episode treats these fields as immutable.`
            : `Confirm to lock this episode's overview in. Other episodes are unaffected.`}
        </p>
      </div>
      <button onClick={onToggle} className={locked ? 'btn-ghost text-xs' : 'btn-accent text-xs'}>
        {locked ? 'Unlock' : 'Confirm Episode Overview'}
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

function EpisodeScopeBanner({
  plan, active, episodes, onPick, onJumpToShowBible,
}: {
  plan: NonNullable<ReturnType<typeof useProjectStore.getState>['project']>['planning']['seriesPlan']
  active: SeriesEpisode
  episodes: SeriesEpisode[]
  onPick: (id: string) => void
  onJumpToShowBible: () => void
}) {
  if (!plan) return null
  return (
    <div
      className="flex flex-wrap items-center gap-3 border px-3 py-2 text-xs"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-deep)' }}
    >
      <span className="font-semibold uppercase tracking-widest" style={{ color: 'var(--fg)' }}>
        Editing
      </span>
      <select
        value={active.id}
        onChange={e => onPick(e.target.value)}
        className="select py-1 text-xs"
        style={{ minWidth: 200 }}
      >
        {episodes.map(e => (
          <option key={e.id} value={e.id}>
            Ep {e.number}{e.title ? ` — ${e.title}` : ''} ({e.status})
          </option>
        ))}
      </select>
      <span style={{ color: 'var(--fg-muted)' }}>
        of {plan.showTitle || 'this series'} · season {plan.seasonNumber || 1}
      </span>
      <button
        onClick={onJumpToShowBible}
        className="ml-auto text-xs uppercase tracking-widest hover:underline"
        style={{ color: 'var(--fg-soft)' }}
        title="Switch to series-level work"
      >
        Show Bible →
      </button>
    </div>
  )
}

/* ============================================================================
 * Shared bits
 * ========================================================================= */

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

function AILegend() {
  return (
    <aside
      className="mb-6 border px-3 py-2 text-xs leading-relaxed"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)', color: 'var(--fg-soft)' }}
      aria-label="AI controls legend"
    >
      <p className="m-0">
        <SparkleSample />{' '}
        <strong style={{ color: 'var(--fg)' }}>The sparkle button</strong>
        {' '}next to a field asks the AI to generate or refine just that one field, using everything else you&apos;ve already filled in.{' '}
        <TakeItFromHereSample />{' '}
        <strong style={{ color: 'var(--fg)' }}>Take It From Here</strong>
        {' '}tells the AI to pick up where you are and run the current section to completion, leaving anything you&apos;ve locked or already written alone.
      </p>
    </aside>
  )
}

function SparkleSample() {
  return (
    <span
      className="inline-flex h-[18px] w-[18px] items-center justify-center border align-middle"
      style={{ borderColor: 'var(--border)', color: 'var(--fg-soft)' }}
      aria-hidden
    >
      <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
        <path d="M6 1 L7 5 L11 6 L7 7 L6 11 L5 7 L1 6 L5 5 Z" fill="currentColor" />
      </svg>
    </span>
  )
}

function TakeItFromHereSample() {
  return (
    <span
      className="inline-flex items-center border px-1.5 align-middle text-[10px] font-semibold tracking-wide"
      style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'transparent', lineHeight: '16px' }}
      aria-hidden
    >
      Take It From Here
    </span>
  )
}
