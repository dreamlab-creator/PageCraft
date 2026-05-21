import { useState } from 'react'
import { useProjectStore } from '@/store'
import type { Beat, BeatId } from '@/types'
import { newId } from '@/types'
import { useAIAssist } from '@/hooks/useAIAssist'
import {
  effectiveBeatTargets,
  generateBeatStructure,
  suggestBeatField,
  fillBeatFields,
  suggestNextBeats,
  type BeatFieldKey,
} from '@/lib/ai'
import { useChunkedTakeover } from '@/hooks/useChunkedTakeover'
import { AIAssistButton } from '@/components/ai/AIAssistButton'
import { TakeItFromHereButton } from '@/components/ai/TakeItFromHereButton'
import { SectionConfirmBar } from '@/components/ai/SectionConfirmBar'
import { SubplotLegend } from './SubplotLegend'

const BEAT_COLORS = [
  '#a8855a', '#7d623f', '#4d6a3d', '#5e6f8a', '#8a5e7d', '#b95b1a', '#a13a2e',
]

/**
 * Convert an AI-generated AIBeat payload into a stored Beat object,
 * positioning it on the board and resolving its subplot letter against
 * the project's named subplots.
 */
function aiBeatToBeat(
  b: {
    title: string; body: string; actNumber?: number;
    pageRangeStart?: number; pageRangeEnd?: number;
    storyPurpose: string; characterObjective: string; obstacle: string;
    valueAtStart: string; valueAtEnd: string; changeMechanism: string;
    newInformation: string; emotionalCharge: string; actOut?: string;
    subplotLetter?: string; secondarySubplotLetters?: string[];
  },
  pos: { x: number; y: number },
  subplots: Array<{ id: string; letter: string; color: string }>,
): Beat {
  // Resolve subplot letters to ids.
  const findByLetter = (letter?: string) =>
    letter ? subplots.find(s => s.letter === letter.toUpperCase()) : undefined
  const primary = findByLetter(b.subplotLetter)
  const secondaries = (b.secondarySubplotLetters ?? [])
    .map(findByLetter)
    .filter((s): s is { id: string; letter: string; color: string } => !!s && s.id !== primary?.id)
  const subplotIds = primary
    ? [primary.id, ...secondaries.map(s => s.id)]
    : (secondaries.length > 0 ? secondaries.map(s => s.id) : undefined)

  // Card color follows the primary subplot when available, otherwise act-based.
  const color = primary?.color ?? BEAT_COLORS[(b.actNumber ?? 1) % BEAT_COLORS.length]

  return {
    id: newId<BeatId>(),
    title: b.title ?? 'New beat',
    body: b.body ?? '',
    actNumber: b.actNumber,
    pageRangeStart: b.pageRangeStart,
    pageRangeEnd: b.pageRangeEnd,
    storyPurpose: b.storyPurpose ?? '',
    charactersInvolved: [],
    characterObjective: b.characterObjective ?? '',
    obstacle: b.obstacle ?? '',
    valueAtStart: b.valueAtStart ?? '',
    valueAtEnd: b.valueAtEnd ?? '',
    changeMechanism: b.changeMechanism ?? '',
    newInformation: b.newInformation ?? '',
    emotionalCharge: b.emotionalCharge ?? '',
    setupIds: [],
    payoffIds: [],
    flowLinesTo: [],
    generatedSceneCardIds: [],
    boardPosition: { x: pos.x, y: pos.y, w: 260, h: 180 },
    color,
    actOut: b.actOut,
    subplotIds,
  }
}

/**
 * Beat Board: free-positioning index cards on a virtual canvas + a linear
 * outline view at the bottom. Inspired by Final Draft 13's Beat Board.
 *
 * AI assistance is granular:
 *   - "Generate full structure" produces the whole outline in one shot.
 *   - "Suggest next N" appends a small batch after the existing flow.
 *   - Each card has an "Insert AI beat after" affordance.
 *   - The BeatEditor has per-field AI buttons and a "Fill empty fields" action.
 */
export function BeatBoard() {
  const project = useProjectStore(s => s.project)
  const upsert = useProjectStore(s => s.upsertBeat)
  const remove = useProjectStore(s => s.removeBeat)
  const [editingId, setEditingId] = useState<BeatId | null>(null)
  const { runDirect, drawer } = useAIAssist()
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiNotice, setAiNotice] = useState<string | null>(null)
  const [nextCount, setNextCount] = useState<number>(3)
  const chunked = useChunkedTakeover()

  if (!project) return null
  const locked = project.planning.confirmations.beats

  /** Pick a sane drop position for a new card, given how many beats already exist. */
  const nextDropPosition = (idx: number) => {
    const cols = 4
    const col = idx % cols
    const row = Math.floor(idx / cols)
    return { x: 60 + col * 290, y: 80 + row * 220 }
  }

  /**
   * Take It From Here for beats — chunked + recoverable.
   *
   * The format's substanceTargets dictate the ideal beat count for this
   * project (40 for a feature drama, ~200 for a vertical season). We
   * compute how many beats are still needed and produce them in small
   * sequential batches via `suggestNextBeats`. On a token-cap error the
   * orchestrator halves the batch and retries; whatever beats land along
   * the way are persisted immediately. The first batch uses the spec-
   * accurate `generateBeatStructure` task so the milestone beats (cold
   * open, midpoint, all-is-lost, etc.) get planted properly; subsequent
   * batches use the lighter-weight `suggestNextBeats` continuation.
   */
  const handleGenerateStructure = async () => {
    setAiError(null)
    setAiNotice(null)
    const liveProject = useProjectStore.getState().project
    if (!liveProject) return
    // Scale the beat target to the project's effective page count, not
    // the format preset's default. A 2-page animation project wants ~3
    // beats, not the preset's 24. Foundational-guidance overrides win.
    const targets = effectiveBeatTargets(liveProject)
    const ideal = targets.ideal
    const remaining = Math.max(0, ideal - liveProject.beats.length)
    const unitWord = liveProject.format.verticalSandbox ? 'episodes' : 'beats'
    if (remaining <= 0) {
      setAiNotice(`Already has ${liveProject.beats.length} ${unitWord} (target ~${ideal}). Use "Suggest next" to add more.`)
      return
    }
    // Chunk sizes: vertical packs ~4 beats per episode; features can take
    // bigger batches but still benefit from chunking past ~16.
    const initialBatch = liveProject.format.verticalSandbox ? 8 : 12
    // Build a synthetic items array — one entry per beat slot. The
    // orchestrator only cares about COUNT for the items, the actual
    // generation is a single task call per batch.
    const slots = Array.from({ length: remaining }, (_, i) => i)

    setAiBusy(true)
    const summary = await chunked.run<number, void>({
      items: slots,
      batchSize: initialBatch,
      minBatchSize: 1,
      runBatch: async (batch) => {
        // Determine whether this is the first call (no beats yet) — if so
        // use the spec-accurate generateBeatStructure for the milestone
        // beats. Otherwise continue with suggestNextBeats which is leaner.
        const currentProjectBeats = useProjectStore.getState().project?.beats ?? []
        const isFirstCall = currentProjectBeats.length === 0
        const count = batch.length
        const subs = useProjectStore.getState().project?.planning.subplots ?? []

        const res = isFirstCall
          ? await runDirect(
              generateBeatStructure,
              ({ beats }) => {
                let i = useProjectStore.getState().project?.beats.length ?? 0
                for (const b of beats.slice(0, count)) {
                  upsert(aiBeatToBeat(b, nextDropPosition(i), subs))
                  i++
                }
              },
            )
          : await runDirect(
              (input) => suggestNextBeats(input, { count }),
              ({ beats }) => {
                let i = useProjectStore.getState().project?.beats.length ?? 0
                for (const b of beats) {
                  upsert(aiBeatToBeat(b, nextDropPosition(i), subs))
                  i++
                }
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
    setAiBusy(false)
    if (summary.completed.length >= remaining && !summary.error) {
      setAiNotice(`Wrote ${summary.completed.length} new ${unitWord}. Target ~${ideal} reached.`)
    } else if (summary.completed.length > 0) {
      setAiNotice(
        `Wrote ${summary.completed.length} of ${remaining} planned new ${unitWord}. `
        + `Click "Take It From Here" again to continue, or use "Suggest next" for small batches.`,
      )
    } else if (summary.error) {
      setAiError(summary.error)
    }
  }

  const handleSuggestNext = async (count: number, afterBeatId?: BeatId, hint?: string) => {
    setAiBusy(true)
    setAiError(null)
    // Guardrail: if the beat sheet has already reached its format's max
    // density AND the user isn't anchoring on a specific beat (which
    // would mean they're intentionally inserting more in the middle),
    // refuse to invent further beats and tell them they're caught up.
    const liveProject = useProjectStore.getState().project
    if (liveProject && !afterBeatId) {
      // Scaled max — same source of truth as Take-It-From-Here.
      const max = effectiveBeatTargets(liveProject).max
      if (liveProject.beats.length >= max) {
        setAiBusy(false)
        const unit = liveProject.format.verticalSandbox ? 'episodes' : 'beats'
        setAiError(
          `End of ${unit} reached. The sheet is at the upper bound for this format (${max} ${unit}). `
          + `If the story genuinely needs more, add ${unit} manually with the "+ New ${liveProject.format.verticalSandbox ? 'Episode' : 'Beat'}" button.`,
        )
        return
      }
    }
    const res = await runDirect(
      (input) => suggestNextBeats(input, { count, afterBeatId, hint }),
      ({ beats }) => {
        const subs = project.planning.subplots ?? []
        let i = project.beats.length
        for (const b of beats) {
          upsert(aiBeatToBeat(b, nextDropPosition(i), subs))
          i++
        }
      },
    )
    setAiBusy(false)
    if (!res.ok) setAiError(res.error ?? 'Unknown error.')
  }

  const addBeat = () => {
    const b: Beat = {
      id: newId<BeatId>(),
      title: 'New beat',
      body: '',
      storyPurpose: '',
      charactersInvolved: [],
      characterObjective: '',
      obstacle: '',
      valueAtStart: '',
      valueAtEnd: '',
      changeMechanism: '',
      newInformation: '',
      emotionalCharge: '',
      setupIds: [],
      payoffIds: [],
      flowLinesTo: [],
      generatedSceneCardIds: [],
      boardPosition: { ...nextDropPosition(project.beats.length), w: 240, h: 160 },
      color: BEAT_COLORS[project.beats.length % BEAT_COLORS.length],
    }
    upsert(b)
    setEditingId(b.id)
  }

  // Vertical projects show this panel as "Episodes" everywhere — the
  // unit feels (and is consumed) like an episode in that format. Same
  // data model, different label.
  const isVertical = project.format.verticalSandbox
  const headerLabel = isVertical ? 'Episodes' : 'Beat Board'
  const newItemLabel = isVertical ? '+ New Episode' : '+ New Beat'

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-8 py-3" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--fg)' }}>
          {headerLabel}
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={addBeat} disabled={locked} className="btn-accent text-sm disabled:opacity-50">{newItemLabel}</button>
        </div>
      </div>

      <div className="border-b px-8 py-2.5" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}>
        <div className="flex flex-wrap items-center gap-3">
          <TakeItFromHereButton
            busy={aiBusy || chunked.busy}
            disabled={locked}
            onClick={handleGenerateStructure}
            title="Generate the full beat sheet"
          />

          <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
            <span className="uppercase tracking-widest shrink-0">Suggest next</span>
            <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
              <select
                value={nextCount}
                onChange={e => setNextCount(parseInt(e.target.value, 10) || 1)}
                disabled={locked || aiBusy}
                className="select max-w-[100px] text-xs"
              >
                {[1, 2, 3, 5, 8].map(n => (
                  <option key={n} value={n}>{n} {isVertical ? 'episode' : 'beat'}{n === 1 ? '' : 's'}</option>
                ))}
              </select>
              <AIAssistButton
                label="Suggest"
                compact
                busy={aiBusy}
                disabled={locked}
                onClick={() => handleSuggestNext(nextCount)}
              />
            </div>
          </div>
        </div>
        <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <SubplotLegend />
        </div>
      </div>

      {chunked.busy && chunked.progress && (
        <div
          className="mx-10 my-2 flex items-center gap-3 border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--accent)', background: 'var(--bg-elev)' }}
        >
          <span className="uppercase tracking-widest" style={{ color: 'var(--accent)' }}>Autopilot</span>
          <span style={{ color: 'var(--fg)' }}>
            {chunked.progress.completed}/{chunked.progress.total} beats —{' '}
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
      {aiNotice && !chunked.busy && (
        <div className="px-8 py-1.5 text-xs" style={{ color: 'var(--fg)' }}>{aiNotice}</div>
      )}
      {aiError && (
        <div className="px-8 py-1.5 text-xs" style={{ color: 'var(--error)' }}>{aiError}</div>
      )}

      <div
        className="relative flex-1 overflow-auto subtle-scrollbar"
        style={{ background: 'var(--bg-deep)' }}
      >
        <div className="relative" style={{ minHeight: '1200px', minWidth: '1600px' }}>
          {project.beats.map(b => {
            const sp = b.subplotIds?.[0]
              ? project.planning.subplots?.find(s => s.id === b.subplotIds![0]) ?? null
              : null
            return (
              <DraggableBeatCard
                key={b.id}
                beat={b}
                subplot={sp}
                onChange={upsert}
                onOpen={() => setEditingId(b.id as BeatId)}
                onDelete={() => remove(b.id)}
                onInsertAfter={() => handleSuggestNext(1, b.id as BeatId)}
                aiBusy={aiBusy}
                locked={locked}
              />
            )
          })}
          {project.beats.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm" style={{ color: 'var(--fg-muted)' }}>
              Click "{newItemLabel}" to start, or use "Take It From Here" / "Suggest next" above.
            </div>
          )}
        </div>
      </div>

      <div className="px-8">
        <SectionConfirmBar
          section="beats"
          readyHint={{ satisfied: project.beats.length, total: Math.max(8, project.beats.length), label: 'Beats' }}
        />
      </div>

      {editingId && (() => {
        const beat = project.beats.find(b => b.id === editingId)
        if (!beat) return null
        return <BeatEditor beat={beat} onChange={upsert} onClose={() => setEditingId(null)} />
      })()}
      {drawer}
    </div>
  )
}

function DraggableBeatCard({
  beat,
  subplot,
  onChange,
  onOpen,
  onDelete,
  onInsertAfter,
  aiBusy,
  locked,
}: {
  beat: Beat
  subplot: { letter: string; label: string; color: string } | null
  onChange: (b: Beat) => void
  onOpen: () => void
  onDelete: () => void
  onInsertAfter: () => void
  aiBusy: boolean
  locked: boolean
}) {
  const pos = beat.boardPosition ?? { x: 40, y: 40, w: 240, h: 160 }
  const [dragging, setDragging] = useState(false)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, textarea, input')) return
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    const initX = pos.x
    const initY = pos.y

    const onMove = (ev: PointerEvent) => {
      onChange({ ...beat, boardPosition: { ...pos, x: Math.max(0, initX + (ev.clientX - startX)), y: Math.max(0, initY + (ev.clientY - startY)) } })
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Subplot wins over the beat's stored color so legend edits are live.
  const accent = subplot?.color ?? beat.color ?? 'var(--border)'

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onOpen}
      className={`absolute cursor-grab border select-none ${dragging ? 'cursor-grabbing opacity-90' : ''}`}
      style={{
        left: pos.x,
        top: pos.y,
        width: pos.w,
        height: pos.h,
        background: 'var(--bg-elev)',
        borderColor: accent,
        borderLeftWidth: 4,
      }}
    >
      <div className="flex items-center justify-between px-3 py-1.5" style={{ background: accent, color: '#fff' }}>
        <div className="flex items-center gap-2 truncate">
          {subplot && (
            <span
              className="inline-flex h-4 w-4 items-center justify-center text-[9px] font-bold"
              style={{ background: 'rgba(0,0,0,0.35)', borderRadius: 2 }}
              title={`${subplot.letter}-story: ${subplot.label}`}
            >
              {subplot.letter}
            </span>
          )}
          <span className="text-xs font-semibold truncate">{beat.title}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={(e) => { e.stopPropagation(); onOpen() }} className="text-[10px] uppercase tracking-widest opacity-80 hover:opacity-100">Edit</button>
          <button
            onClick={(e) => { e.stopPropagation(); if (!aiBusy && !locked) onInsertAfter() }}
            className="text-[10px] uppercase tracking-widest opacity-80 hover:opacity-100 disabled:opacity-30"
            disabled={aiBusy || locked}
            title="Insert one AI-generated beat after this one"
          >
            +AI
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="text-[10px] uppercase tracking-widest opacity-60 hover:opacity-100">×</button>
        </div>
      </div>
      <div className="px-3 py-2 text-xs line-clamp-5" style={{ color: 'var(--fg-soft)' }}>
        {beat.body || beat.storyPurpose || <em style={{ color: 'var(--fg-muted)' }}>(empty)</em>}
      </div>
    </div>
  )
}

function BeatEditor({
  beat,
  onChange,
  onClose,
}: {
  beat: Beat
  onChange: (b: Beat) => void
  onClose: () => void
}) {
  const update = <K extends keyof Beat>(k: K, v: Beat[K]) => onChange({ ...beat, [k]: v })
  const project = useProjectStore(s => s.project)
  const subplots = project?.planning.subplots ?? []
  const isVertical = !!project?.format.verticalSandbox
  const { runText, runDirect, drawer } = useAIAssist()
  const [fillBusy, setFillBusy] = useState(false)
  const [fillError, setFillError] = useState<string | null>(null)

  const handleFillEmpty = async () => {
    setFillBusy(true)
    setFillError(null)
    const res = await runDirect(
      (input) => fillBeatFields(input, { beat }),
      (patch) => onChange({ ...beat, ...patch }),
    )
    setFillBusy(false)
    if (!res.ok) setFillError(res.error ?? 'Unknown error.')
  }

  const fieldButton = (field: BeatFieldKey, label: string) => (
    <AIAssistButton
      label="Generate"
      compact
      disabled={!!beat.locked}
      onClick={() => runText({
        label: `Beat "${beat.title || '(untitled)'}": ${label}`,
        task: input => suggestBeatField(input, { beat, field, label }),
        onAccept: text => update(field as keyof Beat, text as any),
      })}
    />
  )

  const FieldRow = ({ label, field, children }: { label: string; field: BeatFieldKey; children: React.ReactNode }) => (
    <div>
      <div className="flex items-center justify-between">
        <label className="field">{label}</label>
        {fieldButton(field, label)}
      </div>
      {children}
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[680px] max-w-[94vw] max-h-[88vh] overflow-y-auto subtle-scrollbar border"
        style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)' }}
      >
        <header className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-semibold">Edit {isVertical ? 'Episode' : 'Beat'}</h3>
          <div className="flex items-center gap-3">
            <AIAssistButton
              label="Fill empty fields"
              compact
              busy={fillBusy}
              disabled={!!beat.locked}
              onClick={handleFillEmpty}
              title="Generate values for every empty field on this beat, using its existing context"
            />
            <label className="flex items-center gap-1 text-[11px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
              <input
                type="checkbox"
                checked={!!beat.locked}
                onChange={e => update('locked', e.target.checked)}
              />
              Locked
            </label>
            <button onClick={onClose} className="text-xs uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>Close</button>
          </div>
        </header>
        {fillError && (
          <div className="border-b px-5 py-2 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--error)' }}>
            {fillError}
          </div>
        )}
        <div className="space-y-4 px-5 py-4">
          <FieldRow label="Title" field="title">
            <input value={beat.title} disabled={beat.locked} onChange={e => update('title', e.target.value)} className="input" />
          </FieldRow>
          {subplots.length > 0 && (
            <div>
              <label className="field">{isVertical ? 'Loop (Cycle) — primary thread this episode serves' : 'Subplot (primary thread this beat serves)'}</label>
              <div className="flex flex-wrap items-center gap-2">
                {subplots.map(sp => {
                  const active = (beat.subplotIds?.[0] ?? null) === sp.id
                  return (
                    <button
                      key={sp.id}
                      onClick={() => update('subplotIds', active
                        ? (beat.subplotIds?.slice(1) ?? [])
                        : [sp.id, ...(beat.subplotIds ?? []).filter(id => id !== sp.id)])
                      }
                      disabled={beat.locked}
                      className="flex items-center gap-1.5 border px-2 py-1 text-xs disabled:opacity-50"
                      style={{
                        borderColor: active ? sp.color : 'var(--border)',
                        background: active ? sp.color : 'var(--bg)',
                        color: active ? '#fff' : 'var(--fg)',
                      }}
                      title={sp.description || sp.label}
                    >
                      <span className="font-semibold">{sp.letter}</span>
                      <span>{sp.label}</span>
                    </button>
                  )
                })}
                {beat.subplotIds && beat.subplotIds.length > 0 && (
                  <button
                    onClick={() => update('subplotIds', undefined)}
                    disabled={beat.locked}
                    className="text-[10px] uppercase tracking-widest hover:underline"
                    style={{ color: 'var(--fg-muted)' }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}
          <FieldRow label="Body — what happens in this beat" field="body">
            <textarea value={beat.body} disabled={beat.locked} onChange={e => update('body', e.target.value)} className="textarea" rows={4} />
          </FieldRow>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field">Page range start</label>
              <input type="number" disabled={beat.locked} value={beat.pageRangeStart ?? ''} onChange={e => update('pageRangeStart', e.target.value ? +e.target.value : undefined)} className="input" />
            </div>
            <div>
              <label className="field">Page range end</label>
              <input type="number" disabled={beat.locked} value={beat.pageRangeEnd ?? ''} onChange={e => update('pageRangeEnd', e.target.value ? +e.target.value : undefined)} className="input" />
            </div>
          </div>
          <FieldRow label="Story purpose — why this beat exists" field="storyPurpose">
            <input value={beat.storyPurpose} disabled={beat.locked} onChange={e => update('storyPurpose', e.target.value)} className="input" />
          </FieldRow>
          <div className="grid grid-cols-2 gap-4">
            <FieldRow label="Opening value" field="valueAtStart">
              <input value={beat.valueAtStart} disabled={beat.locked} onChange={e => update('valueAtStart', e.target.value)} className="input" placeholder='e.g. "trust"' />
            </FieldRow>
            <FieldRow label="Closing value" field="valueAtEnd">
              <input value={beat.valueAtEnd} disabled={beat.locked} onChange={e => update('valueAtEnd', e.target.value)} className="input" placeholder='e.g. "betrayal"' />
            </FieldRow>
          </div>
          <FieldRow label="Change mechanism — what flips the value" field="changeMechanism">
            <textarea value={beat.changeMechanism} disabled={beat.locked} onChange={e => update('changeMechanism', e.target.value)} className="textarea" rows={2} />
          </FieldRow>
          <div className="grid grid-cols-2 gap-4">
            <FieldRow label="Character objective" field="characterObjective">
              <input value={beat.characterObjective} disabled={beat.locked} onChange={e => update('characterObjective', e.target.value)} className="input" />
            </FieldRow>
            <FieldRow label="Obstacle" field="obstacle">
              <input value={beat.obstacle} disabled={beat.locked} onChange={e => update('obstacle', e.target.value)} className="input" />
            </FieldRow>
          </div>
          <FieldRow label="New information (what does the audience learn?)" field="newInformation">
            <textarea value={beat.newInformation} disabled={beat.locked} onChange={e => update('newInformation', e.target.value)} className="textarea" rows={2} />
          </FieldRow>
          <FieldRow label="Emotional charge (what should the audience feel?)" field="emotionalCharge">
            <textarea value={beat.emotionalCharge} disabled={beat.locked} onChange={e => update('emotionalCharge', e.target.value)} className="textarea" rows={2} />
          </FieldRow>
          <FieldRow label={isVertical ? 'Cliffhanger — how this episode ends' : 'Act-out / Cliffhanger (TV)'} field="actOut">
            <textarea value={beat.actOut ?? beat.cliffhanger ?? ''} disabled={beat.locked} onChange={e => update('actOut', e.target.value)} className="textarea" rows={2} />
          </FieldRow>
          <div className="grid grid-cols-7 gap-2">
            {BEAT_COLORS.map(c => (
              <button
                key={c}
                onClick={() => update('color', c)}
                className="h-6 w-full border"
                style={{ background: c, borderColor: beat.color === c ? 'var(--fg)' : 'transparent' }}
              />
            ))}
          </div>
        </div>
        {drawer}
      </div>
    </div>
  )
}
