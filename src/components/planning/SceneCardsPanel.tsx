/**
 * Scene Cards panel — the structural-but-not-yet-prose layer of planning.
 *
 * AI integration is layered the same way the Beat Board is:
 *
 *   - "Generate from beats" produces a complete scene list in one pass,
 *     deciding how many scenes each beat needs (NOT 1:1 with beats — a
 *     "first date" beat may need 3 scenes; a small connective beat may
 *     need just one).
 *   - "Expand this beat" turns a single beat into its scenes without
 *     touching the rest.
 *   - "Suggest next N" appends new scenes at the end of the flow.
 *   - Each card has "+AI" to insert one scene after it.
 *   - The editor modal has per-field Generate buttons and a "Fill empty
 *     fields" action.
 *   - Cards can be "Locked" to protect them from AI fill.
 */

import { useState } from 'react'
import { useProjectStore } from '@/store'
import type { Beat, BeatId, SceneCard, SceneCardId } from '@/types'
import { newId } from '@/types'
import { useAIAssist } from '@/hooks/useAIAssist'
import { useChunkedTakeover } from '@/hooks/useChunkedTakeover'
import {
  expandBeatToScenes,
  fillSceneCardFields,
  generateSceneCardsFromBeats,
  suggestNextScenes,
  suggestSceneCardField,
  type SceneCardFieldKey,
} from '@/lib/ai'
import { AIAssistButton } from '@/components/ai/AIAssistButton'
import { TakeItFromHereButton } from '@/components/ai/TakeItFromHereButton'
import { SectionConfirmBar } from '@/components/ai/SectionConfirmBar'

export function SceneCardsPanel() {
  const project = useProjectStore(s => s.project)
  const upsert = useProjectStore(s => s.upsertSceneCard)
  const insertMany = useProjectStore(s => s.insertSceneCards)
  const remove = useProjectStore(s => s.removeSceneCard)
  const [editingId, setEditingId] = useState<SceneCardId | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiNotice, setAiNotice] = useState<string | null>(null)
  const [nextCount, setNextCount] = useState<number>(3)
  const [expandBeatId, setExpandBeatId] = useState<BeatId | ''>('')
  // Vertical projects call the underlying "beat" data type "episode" in
  // every user-facing label. Same data, different word.
  const isVertical = !!project?.format.verticalSandbox
  const beatWord = isVertical ? 'episode' : 'beat'
  const BeatWord = isVertical ? 'Episode' : 'Beat'
  const { runDirect, drawer } = useAIAssist()
  const apiKey = useProjectStore(s => s.project)
  void apiKey
  const chunked = useChunkedTakeover()

  if (!project) return null
  const locked = project.planning.confirmations.scenes
  const beats: Beat[] = [...project.beats].sort((a, b) => {
    const pa = a.pageRangeStart ?? a.actNumber ?? 0
    const pb = b.pageRangeStart ?? b.actNumber ?? 0
    return pa - pb
  })

  /**
   * "Take It From Here" for scene cards.
   *
   * Big projects (especially Vertical with 200+ beats) can't be served by
   * a single API call — we'd ask for far more output tokens than any
   * model returns per request. The orchestrator splits unserved beats
   * into batches, runs them sequentially, and on a truncation error
   * automatically retries that batch with HALF the beats. Whatever scenes
   * get written along the way are persisted to the project immediately,
   * so the user is never left with nothing.
   */
  const handleGenerateFromBeats = async () => {
    setAiError(null)
    setAiNotice(null)
    const liveProject = useProjectStore.getState().project
    if (!liveProject) return
    // Pick the unserved beats — those that don't have any linked scene card.
    const served = new Set(
      liveProject.sceneCards.map(c => c.beatId).filter(Boolean) as BeatId[],
    )
    const unserved = beats.filter(b => !served.has(b.id as BeatId))
    if (unserved.length === 0) {
      setAiNotice(`Every ${beatWord} already has at least one scene card.`)
      return
    }
    // Vertical projects pack scenes denser per beat; keep batches small.
    const initialBatch = liveProject.format.verticalSandbox ? 4 : 8
    setAiBusy(true)
    const summary = await chunked.run<Beat, { cards: SceneCard[] }>({
      items: unserved,
      batchSize: initialBatch,
      runBatch: async (batch) => {
        // Call the task DIRECTLY so we can read the structured outcome
        // (including the `truncated` flag) and capture the cards before
        // applying them to the store.
        const liveInput = {
          project: useProjectStore.getState().project!,
          apiKey: '', // useAIAssist already injects this; runDirect uses its own path
        }
        void liveInput
        // We still need apiKey + model overrides from useAIAssist's plumbing.
        // Easiest: keep runDirect as the executor (it has all the right
        // wiring) and detect truncation by sniffing the error string. The
        // orchestrator only cares whether it was a truncation, not the
        // structured value — onPartial is a no-op here because runDirect
        // already inserted cards via its own onAccept callback.
        const res = await runDirect(
          (input) => generateSceneCardsFromBeats(input, { beatIds: batch.map(b => b.id) }),
          ({ cards }) => insertMany(cards),
        )
        if (res.ok) return { ok: true, value: { cards: [] } }
        const errLower = (res.error ?? '').toLowerCase()
        const truncated =
          errLower.includes('max_tokens')
          || errLower.includes('cut off')
          || errLower.includes('context length')
          || errLower.includes('too long')
          || errLower.includes('exceeds')
        return { ok: false, error: res.error ?? 'Unknown error.', truncated }
      },
      onPartial: () => { /* inserted via runDirect's onAccept above */ },
    })
    setAiBusy(false)
    if (summary.completed.length > 0 && summary.failed.length === 0 && !summary.error) {
      setAiNotice(`Scenes generated for ${summary.completed.length} ${beatWord}${summary.completed.length === 1 ? '' : 's'}.`)
    } else if (summary.completed.length > 0) {
      setAiNotice(
        `Generated scenes for ${summary.completed.length} of ${unserved.length} ${beatWord}s. `
        + `${summary.failed.length} failed, ${summary.remaining.length} remaining. `
        + `Click "Take It From Here" again to continue where it stopped.`,
      )
    } else if (summary.error) {
      setAiError(summary.error)
    }
  }

  const handleSuggestNext = async (count: number, afterCardId?: SceneCardId) => {
    setAiBusy(true)
    setAiError(null)
    // Guardrail: if every beat is already served by a scene card AND the
    // user hasn't anchored on an existing card (which would mean they're
    // intentionally re-expanding), refuse to invent material out of thin
    // air. The fix for the writer is to add more beats first.
    const served = new Set(
      project!.sceneCards.map(c => c.beatId).filter(Boolean) as BeatId[],
    )
    const allBeatsServed = beats.length > 0 && beats.every(b => served.has(b.id as BeatId))
    if (allBeatsServed && !afterCardId) {
      setAiBusy(false)
      setAiError(
        beats.length === 0
          ? `Build the ${beatWord} sheet first — there's nothing to base new scenes on.`
          : `End of ${beatWord}s reached. Every ${beatWord} already has at least one scene card. Add more ${beatWord}s in the ${BeatWord}s section first, then suggest scenes for them.`,
      )
      return
    }
    const res = await runDirect(
      (input) => suggestNextScenes(input, { count, afterCardId }),
      ({ cards }) => insertMany(cards),
    )
    setAiBusy(false)
    if (!res.ok) setAiError(res.error ?? 'Unknown error.')
  }

  const handleExpandBeat = async (beatId: BeatId) => {
    setAiBusy(true)
    setAiError(null)
    const res = await runDirect(
      (input) => expandBeatToScenes(input, { beatId }),
      ({ cards }) => insertMany(cards),
    )
    setAiBusy(false)
    if (!res.ok) setAiError(res.error ?? 'Unknown error.')
  }

  const addBlankCard = () => {
    const card: SceneCard = {
      id: newId<SceneCardId>(),
      // Manual-add placeholder. The card editor surfaces a clear prompt
      // for the writer to replace this with a specific active title like
      // "Maya destroys the file".
      title: '',
      slugLine: '',
      summary: '',
      openingValue: '',
      closingValue: '',
      turn: '',
      whoWantsWhat: '',
      obstacle: '',
      tactic: '',
      setupIds: [],
      payoffIds: [],
      audienceKnowledgeDelta: '',
      estimatedPages: 1,
      tensionStart: 3,
      tensionEnd: 6,
      order: project.sceneCards.length,
    }
    upsert(card)
    setEditingId(card.id)
  }

  const sorted = [...project.sceneCards].sort((a, b) => a.order - b.order)
  const editing = editingId ? sorted.find(c => c.id === editingId) ?? null : null

  return (
    <div className="px-8 py-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--fg)' }}>Scene Cards</h2>
        <div className="flex items-center gap-2">
          <button onClick={addBlankCard} disabled={locked} className="btn-accent text-sm disabled:opacity-50">+ New Card</button>
        </div>
      </div>

      <div className="mb-4 border" style={{ borderColor: 'var(--border)', background: 'var(--bg-elev)' }}>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <TakeItFromHereButton
            busy={aiBusy || chunked.busy}
            disabled={locked || beats.length === 0}
            onClick={handleGenerateFromBeats}
            title={beats.length === 0 ? `Build the ${beatWord} sheet first` : `Generate scene cards from ${beatWord}s`}
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
                  <option key={n} value={n}>{n} scene{n === 1 ? '' : 's'}</option>
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

            {/* Expand-beat cluster — selector + button glued together so the
                button never orphans to the next row at narrow widths. */}
            <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
              <select
                value={expandBeatId}
                onChange={e => setExpandBeatId(e.target.value as BeatId)}
                disabled={locked || aiBusy || beats.length === 0}
                className="select min-w-[180px] max-w-[260px] text-xs"
              >
                <option value="">{beats.length === 0 ? `No ${beatWord}s yet` : `Expand an ${beatWord}…`}</option>
                {beats.map((b, i) => (
                  <option key={b.id} value={b.id}>
                    {b.actNumber ? `[A${b.actNumber}] ` : ''}#{i + 1} {b.title || '(untitled)'}
                  </option>
                ))}
              </select>
              <AIAssistButton
                label="Expand"
                compact
                busy={aiBusy}
                disabled={locked || !expandBeatId}
                onClick={() => { if (expandBeatId) void handleExpandBeat(expandBeatId as BeatId) }}
              />
            </div>
          </div>
        </div>
      </div>

      {chunked.busy && chunked.progress && (
        <div
          className="mb-4 flex items-center gap-3 border px-3 py-2 text-xs"
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
        <div className="mb-4 border px-3 py-2 text-xs" style={{ borderColor: 'var(--accent)', color: 'var(--fg)' }}>
          {aiNotice}
        </div>
      )}
      {aiError && (
        <div className="mb-4 border px-3 py-2 text-xs" style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>
          {aiError}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="border px-8 py-16 text-center text-sm" style={{ borderColor: 'var(--border)', color: 'var(--fg-muted)' }}>
          {beats.length === 0 ? `Build the ${beatWord} sheet first.` : 'No scene cards yet.'}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {sorted.map((card, i) => {
            const linkedBeat = card.beatId ? beats.find(b => b.id === card.beatId) : null
            const linkedBeatIdx = linkedBeat ? beats.findIndex(b => b.id === linkedBeat.id) : -1
            return (
              <li
                key={card.id}
                className="border p-4"
                style={{
                  borderColor: card.locked ? 'var(--warning, #c89c4d)' : 'var(--border)',
                  background: 'var(--bg-elev)',
                  borderLeftWidth: 4,
                  borderLeftColor: card.color ?? linkedBeat?.color ?? 'var(--border)',
                }}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                    #{i + 1}
                    {linkedBeat && linkedBeatIdx >= 0 && (
                      <> · {BeatWord} #{linkedBeatIdx + 1} — {linkedBeat.title}</>
                    )}
                    {card.locked && <> · LOCKED</>}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditingId(card.id)}
                      className="text-[10px] uppercase tracking-widest hover:underline"
                      style={{ color: 'var(--fg-soft)' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => { if (!aiBusy && !locked) void handleSuggestNext(1, card.id) }}
                      disabled={aiBusy || locked}
                      className="text-[10px] uppercase tracking-widest hover:underline disabled:opacity-30"
                      style={{ color: 'var(--fg-soft)' }}
                      title="Insert one AI-generated scene after this one"
                    >
                      +AI
                    </button>
                    <button
                      onClick={() => remove(card.id)}
                      className="text-[10px] uppercase tracking-widest"
                      style={{ color: 'var(--fg-muted)' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <input
                  value={card.title}
                  disabled={card.locked}
                  onChange={e => upsert({ ...card, title: e.target.value })}
                  placeholder='e.g. "Maya destroys the file"'
                  className="mt-1 w-full bg-transparent text-sm font-semibold outline-none placeholder:font-normal placeholder:italic"
                  style={{ color: 'var(--fg)' }}
                />
                <input
                  value={card.slugLine}
                  disabled={card.locked}
                  onChange={e => upsert({ ...card, slugLine: e.target.value.toUpperCase() })}
                  placeholder="INT. LOCATION - DAY"
                  className="mt-1 w-full bg-transparent text-xs outline-none screenplay-font"
                  style={{ color: 'var(--fg-muted)' }}
                />
                <textarea
                  value={card.summary}
                  disabled={card.locked}
                  onChange={e => upsert({ ...card, summary: e.target.value })}
                  className="textarea mt-3 text-xs"
                  rows={5}
                  placeholder="What happens in this scene"
                />
                <div className="mt-2 flex items-center justify-between text-[10px]" style={{ color: 'var(--fg-muted)' }}>
                  <span>~{card.estimatedPages} pp</span>
                  {card.whoWantsWhat && <span className="italic truncate ml-3">{card.whoWantsWhat}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <SectionConfirmBar
        section="scenes"
        readyHint={{ satisfied: sorted.length, total: Math.max(beats.length, 8), label: 'Scenes' }}
      />

      {editing && (
        <SceneCardEditor
          card={editing}
          beats={beats}
          beatWord={beatWord}
          BeatWord={BeatWord}
          onChange={upsert}
          onClose={() => setEditingId(null)}
        />
      )}
      {drawer}
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function SceneCardEditor({
  card, beats, onChange, onClose, beatWord, BeatWord,
}: {
  card: SceneCard
  beats: Beat[]
  onChange: (c: SceneCard) => void
  onClose: () => void
  beatWord: string
  BeatWord: string
}) {
  const update = <K extends keyof SceneCard>(k: K, v: SceneCard[K]) => onChange({ ...card, [k]: v })
  const { runText, runDirect, drawer } = useAIAssist()
  const [fillBusy, setFillBusy] = useState(false)
  const [fillError, setFillError] = useState<string | null>(null)
  void beatWord

  const handleFillEmpty = async () => {
    setFillBusy(true)
    setFillError(null)
    const res = await runDirect(
      (input) => fillSceneCardFields(input, { card }),
      (patch) => onChange({ ...card, ...patch }),
    )
    setFillBusy(false)
    if (!res.ok) setFillError(res.error ?? 'Unknown error.')
  }

  const linkedBeat = card.beatId ? beats.find(b => b.id === card.beatId) : null

  const fieldButton = (field: SceneCardFieldKey, label: string) => (
    <AIAssistButton
      label="Generate"
      compact
      disabled={!!card.locked}
      onClick={() => runText({
        label: `Scene "${card.title || '(untitled)'}": ${label}`,
        task: input => suggestSceneCardField(input, { card, field, label }),
        onAccept: text => update(field as keyof SceneCard, text as any),
      })}
    />
  )

  const FieldRow = ({ label, field, children }: { label: string; field: SceneCardFieldKey; children: React.ReactNode }) => (
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
        className="w-[720px] max-w-[94vw] max-h-[88vh] overflow-y-auto subtle-scrollbar border"
        style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)' }}
      >
        <header className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h3 className="text-sm font-semibold">Edit Scene Card</h3>
            {linkedBeat && (
              <p className="text-[11px]" style={{ color: 'var(--fg-muted)' }}>
                {linkedBeat.title}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <AIAssistButton
              label="Fill empty fields"
              compact
              busy={fillBusy}
              disabled={!!card.locked}
              onClick={handleFillEmpty}
              title="Generate values for every empty field on this card"
            />
            <label className="flex items-center gap-1 text-[11px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
              <input
                type="checkbox"
                checked={!!card.locked}
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
            <input value={card.title} disabled={card.locked} onChange={e => update('title', e.target.value)} className="input" />
          </FieldRow>
          <FieldRow label="Slug line" field="slugLine">
            <input value={card.slugLine} disabled={card.locked} onChange={e => update('slugLine', e.target.value.toUpperCase())} className="input screenplay-font" placeholder="INT. LOCATION - DAY" />
          </FieldRow>
          <FieldRow label="What happens" field="summary">
            <textarea value={card.summary} disabled={card.locked} onChange={e => update('summary', e.target.value)} className="textarea" rows={5} placeholder="Describe what we see, in present tense" />
          </FieldRow>
          <div className="grid grid-cols-2 gap-4">
            <FieldRow label="How the scene starts" field="openingValue">
              <input value={card.openingValue} disabled={card.locked} onChange={e => update('openingValue', e.target.value)} className="input" placeholder='e.g. "trust"' />
            </FieldRow>
            <FieldRow label="How the scene ends" field="closingValue">
              <input value={card.closingValue} disabled={card.locked} onChange={e => update('closingValue', e.target.value)} className="input" placeholder='e.g. "betrayal"' />
            </FieldRow>
          </div>
          <FieldRow label="What flips" field="turn">
            <textarea value={card.turn} disabled={card.locked} onChange={e => update('turn', e.target.value)} className="textarea" rows={2} placeholder="The moment / action / reveal that changes things" />
          </FieldRow>
          <FieldRow label="Who wants what" field="whoWantsWhat">
            <input value={card.whoWantsWhat} disabled={card.locked} onChange={e => update('whoWantsWhat', e.target.value)} className="input" placeholder='e.g. "Maya wants the key back"' />
          </FieldRow>
          <FieldRow label="What's in the way" field="obstacle">
            <input value={card.obstacle} disabled={card.locked} onChange={e => update('obstacle', e.target.value)} className="input" placeholder="What blocks them in this scene" />
          </FieldRow>
          <FieldRow label="How they try" field="tactic">
            <input value={card.tactic} disabled={card.locked} onChange={e => update('tactic', e.target.value)} className="input" placeholder='e.g. "lies", "charms", "withdraws"' />
          </FieldRow>
          <FieldRow label="What the audience learns" field="audienceKnowledgeDelta">
            <textarea value={card.audienceKnowledgeDelta} disabled={card.locked} onChange={e => update('audienceKnowledgeDelta', e.target.value)} className="textarea" rows={2} placeholder="The new piece the audience knows or feels after this scene" />
          </FieldRow>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="field">Pages (est.)</label>
              <input type="number" step="0.25" value={card.estimatedPages} disabled={card.locked} onChange={e => update('estimatedPages', parseFloat(e.target.value) || 0)} className="input" />
            </div>
            <div>
              <label className="field">Tension start</label>
              <input type="number" min={0} max={10} value={card.tensionStart} disabled={card.locked} onChange={e => update('tensionStart', parseInt(e.target.value, 10) || 0)} className="input" />
            </div>
            <div>
              <label className="field">Tension end</label>
              <input type="number" min={0} max={10} value={card.tensionEnd} disabled={card.locked} onChange={e => update('tensionEnd', parseInt(e.target.value, 10) || 0)} className="input" />
            </div>
          </div>
          <div>
            <label className="field">Linked {beatWord}</label>
            <select
              value={card.beatId ?? ''}
              disabled={card.locked}
              onChange={e => update('beatId', (e.target.value || undefined) as any)}
              className="select"
            >
              <option value="">(none)</option>
              {beats.map((b, i) => (
                <option key={b.id} value={b.id}>
                  {b.actNumber ? `[A${b.actNumber}] ` : ''}{BeatWord} #{i + 1} — {b.title || '(untitled)'}
                </option>
              ))}
            </select>
          </div>
        </div>
        {drawer}
      </div>
    </div>
  )
}
