/**
 * WritingAIBar — granular AI controls that sit above the screenplay editor.
 *
 * Lets the writer hand-pick assistance:
 *
 *   1. Continue from the active line — "AI takeover for the next N
 *      paragraphs". The most common request from a stuck writer.
 *   2. Draft pages from an unwritten scene card — pick any card from the
 *      planning side and the AI produces its pages.
 *   3. Open the per-line gear menu on any element for Rewrite / Punch up /
 *      Expand actions (handled by the gutter button on the block).
 *
 * Every AI insert goes through the cast reconciler so newly introduced
 * characters get adopted into the bible automatically.
 */

import { useMemo, useRef, useState } from 'react'
import { useProjectStore } from '@/store'
import type { ElementId, SceneCard } from '@/types'
import { useWritingAI } from './WritingAIContext'
import {
  continueFromHere,
  draftSceneFromCard,
  adoptAISceneCharacters,
  type DraftedScene,
} from '@/lib/ai'
import { fountainToElements } from '@/lib/screenplay'
import { AIAssistButton } from '@/components/ai/AIAssistButton'
import { TakeItFromHereButton } from '@/components/ai/TakeItFromHereButton'

interface Props {
  activeId: ElementId | null
}

/** Smaller-bites page counts. The autopilot uses these as a hard cap when
 *  writing forward from the cursor — it'll auto-pull from upcoming scene
 *  cards as it needs material, stopping when it's added ~N pages. */
const PAGE_COUNTS = [1, 2, 5, 10] as const

export function WritingAIBar({ activeId }: Props) {
  const project = useProjectStore(s => s.project)
  const insertElementsAfter = useProjectStore(s => s.insertElementsAfter)
  const upsertCharacter = useProjectStore(s => s.upsertCharacter)
  const { runDirect } = useWritingAI()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pages, setPages] = useState<number>(2)
  const [draftCardId, setDraftCardId] = useState<string>('')
  const [hint, setHint] = useState('')
  const [noteOpen, setNoteOpen] = useState(false)
  // Autopilot state.
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoProgress, setAutoProgress] = useState<{ current: number; total: number; label: string } | null>(null)
  const autoCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false })

  // Cards ordered by their narrative order. "Drafted" cards are those whose
  // slug line already appears as a scene heading in the screenplay — that's
  // our signal that pages exist for them. Cheap and surprisingly accurate.
  const cardsInOrder = useMemo(() => {
    if (!project) return []
    return [...project.sceneCards].sort((a, b) => a.order - b.order)
  }, [project])

  const draftedSlugs = useMemo(() => {
    if (!project) return new Set<string>()
    const out = new Set<string>()
    for (const el of project.screenplay.elements) {
      if (el.type === 'scene_heading' && el.text.trim()) {
        out.add(el.text.trim().toUpperCase())
      }
    }
    return out
  }, [project])

  const undraftedCards: SceneCard[] = useMemo(() => {
    return cardsInOrder.filter(c => {
      const slug = (c.slugLine || '').trim().toUpperCase()
      // If the card has no slug, we assume it hasn't been drafted.
      if (!slug) return true
      return !draftedSlugs.has(slug)
    })
  }, [cardsInOrder, draftedSlugs])

  if (!project) return null

  const applyDraftedScene = (
    after: ElementId | null,
    drafted: DraftedScene,
    replace?: boolean,
  ) => {
    const els = fountainToElements(drafted.fountain ?? '')
    if (els.length === 0) {
      setError('The model returned no usable screenplay text. Try again.')
      return
    }
    insertElementsAfter(after, els, replace)
    if (drafted.newCharacters && drafted.newCharacters.length > 0) {
      const newChars = adoptAISceneCharacters(project, drafted.newCharacters)
      for (const c of newChars) upsertCharacter(c)
    }
  }

  /**
   * AI Autopilot — pick up from wherever the writer is and run to the end.
   *
   *   - If there are scene cards: draft each undraft card in order, one at a
   *     time, until the cards are exhausted (or the user cancels).
   *   - If there are no scene cards: do a long continuation from the active
   *     line. Honest about not knowing where the end is; produces a chunky
   *     pass the writer can keep extending manually.
   */
  const handleTakeItFromHere = async () => {
    setError(null)
    autoCancelRef.current.cancelled = false
    setAutoBusy(true)

    try {
      if (undraftedCards.length > 0) {
        // Multi-scene autopilot.
        let i = 0
        for (const card of undraftedCards) {
          if (autoCancelRef.current.cancelled) break
          i += 1
          setAutoProgress({ current: i, total: undraftedCards.length, label: card.title || `Scene ${i}` })

          const projectNow = useProjectStore.getState().project
          if (!projectNow) break
          const lastId = projectNow.screenplay.elements.length > 0
            ? (projectNow.screenplay.elements[projectNow.screenplay.elements.length - 1].id as ElementId)
            : null

          const res = await runDirect(
            (input) => draftSceneFromCard(input, { sceneCardId: card.id }),
            (drafted) => applyDraftedScene(lastId, drafted, false),
          )
          if (!res.ok) {
            setError(`Stopped at scene ${i}: ${res.error}`)
            break
          }
        }
      } else if (project.sceneCards.length > 0) {
        // The project HAS scene cards but every one of them is already
        // drafted. Refuse to hallucinate beyond the developed material —
        // tell the writer to add more scene cards (or beats) and stop.
        setError(
          'End of developed scenes reached. Every scene card in this project is already drafted. '
          + 'Add more scene cards in the Scenes section (or new beats first) before asking the AI to continue.',
        )
        return
      } else {
        // No scene cards in the project at all — the writer is working
        // free-form. Run one large continuation from the active line.
        if (!activeId) {
          setError('Place your cursor anywhere on the page first. Autopilot needs a starting point.')
          return
        }
        setAutoProgress({ current: 1, total: 1, label: 'Drafting pages from here' })
        const res = await runDirect(
          (input) => continueFromHere(input, {
            elementId: activeId,
            pages: 8,
            hint: hint || 'Run this scene to a natural close. End on a strong button or transition.',
          }),
          (drafted) => applyDraftedScene(activeId, drafted, false),
        )
        if (!res.ok) setError(res.error ?? 'Unknown error.')
      }
    } finally {
      setAutoBusy(false)
      setAutoProgress(null)
      autoCancelRef.current.cancelled = false
    }
  }

  const handleCancelAutopilot = () => {
    autoCancelRef.current.cancelled = true
  }

  const handleContinue = async () => {
    if (!activeId) {
      setError('Place your cursor on a line first.')
      return
    }
    // Guardrail: if this project uses a card-based workflow and every
    // scene card is already drafted, refuse to invent further content.
    // The writer needs to add new scene cards (or new beats) to extend
    // the developed material first.
    if (project.sceneCards.length > 0 && undraftedCards.length === 0) {
      setError(
        'End of developed scenes reached. Every scene card in this project is already drafted. '
        + 'Add more scene cards in the Scenes section (or new beats first) before asking the AI to continue.',
      )
      return
    }
    setBusy(true); setError(null)
    const res = await runDirect(
      (input) => continueFromHere(input, {
        elementId: activeId,
        pages,
        hint: hint || undefined,
      }),
      (drafted) => applyDraftedScene(activeId, drafted, false),
    )
    setBusy(false)
    if (!res.ok) setError(res.error ?? 'Unknown error.')
  }

  const handleDraftCard = async () => {
    if (!draftCardId) {
      setError('Pick a scene card to draft.')
      return
    }
    const card = project.sceneCards.find(s => s.id === draftCardId)
    if (!card) return
    setBusy(true); setError(null)
    const res = await runDirect(
      (input) => draftSceneFromCard(input, { sceneCardId: draftCardId }),
      (drafted) => {
        // Append to the end of the screenplay; the writer can rearrange.
        const lastId = project.screenplay.elements.length > 0
          ? (project.screenplay.elements[project.screenplay.elements.length - 1].id as ElementId)
          : null
        applyDraftedScene(lastId, drafted, false)
      },
    )
    setBusy(false)
    if (!res.ok) setError(res.error ?? 'Unknown error.')
  }

  const autopilotSubtitle = undraftedCards.length > 0
    ? `Draft ${undraftedCards.length} scene${undraftedCards.length === 1 ? '' : 's'} through the end of the outline`
    : project.sceneCards.length > 0
      ? 'End of developed scenes reached — add more scene cards to continue'
      : 'Write 30 paragraphs forward from the active line'

  // Rendered INLINE inside the shared sticky toolbar (see ScreenplayEditor).
  // The toolbar owns its own sticky positioning + outer chrome.
  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2">
        <TakeItFromHereButton
          busy={autoBusy}
          disabled={busy || (undraftedCards.length === 0 && !activeId)}
          onClick={handleTakeItFromHere}
          title={autopilotSubtitle}
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs" style={{ color: 'var(--fg-muted)' }}>
          {/*
           * "Continue from here" cluster — label + selector + AI button all
           * wrapped in a single flex group with `whitespace-nowrap` so the
           * label, control, and button never split across rows.
           */}
          <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
            <span className="uppercase tracking-widest">Continue from here</span>
            <select
              value={pages}
              onChange={e => setPages(parseInt(e.target.value, 10) || 1)}
              disabled={busy || autoBusy}
              className="select max-w-[100px] text-xs"
            >
              {PAGE_COUNTS.map(n => (
                <option key={n} value={n}>{n} page{n === 1 ? '' : 's'}</option>
              ))}
            </select>
            <AIAssistButton
              label="Continue"
              compact
              busy={busy}
              disabled={!activeId || autoBusy}
              onClick={handleContinue}
              title="Draft the next pages from the active line; auto-pulls from upcoming scene cards as needed"
            />
          </div>

          {/*
           * "Draft one card" cluster — label + scene selector + AI button
           * all wrapped together. As an inline flex group with
           * `whitespace-nowrap`, the label, the scene picker, and the
           * "Draft" button stay on the same row at every viewport width.
           */}
          <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
            <span className="uppercase tracking-widest">Draft one card</span>
            <select
              value={draftCardId}
              onChange={e => setDraftCardId(e.target.value)}
              disabled={busy || autoBusy || cardsInOrder.length === 0}
              className="select min-w-[160px] max-w-[260px] text-xs"
            >
              <option value="">
                {cardsInOrder.length === 0 ? 'No scene cards yet' : 'Pick a scene…'}
              </option>
              {cardsInOrder.map((card, index) => (
                <option key={card.id} value={card.id}>
                  #{index + 1} · {card.title || '(untitled)'}{card.slugLine ? ` — ${card.slugLine}` : ''}
                </option>
              ))}
            </select>
            <AIAssistButton
              label="Draft pages"
              compact
              busy={busy}
              disabled={!draftCardId || autoBusy}
              onClick={handleDraftCard}
              title="Draft this single card's pages and append them to the screenplay"
            />
          </div>
        </div>

        <button
          onClick={() => setNoteOpen(o => !o)}
          className="ml-auto text-[11px] uppercase tracking-widest hover:underline"
          style={{ color: 'var(--fg-soft)' }}
        >
          {noteOpen ? 'Hide note' : 'Note'}
        </button>
      </div>

      {autoBusy && autoProgress && (
        <div className="flex items-center gap-3 border-t px-4 py-2 text-xs" style={{ borderColor: 'var(--border)' }}>
          <span className="uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
            Autopilot
          </span>
          <span style={{ color: 'var(--fg)' }}>
            Scene {autoProgress.current} of {autoProgress.total} —{' '}
            <span style={{ color: 'var(--fg-soft)' }}>{autoProgress.label}</span>
          </span>
          <div className="ml-3 h-1 flex-1 overflow-hidden" style={{ background: 'var(--border)' }}>
            <div
              className="h-full transition-all"
              style={{
                background: 'var(--accent)',
                width: `${Math.min(100, Math.round((autoProgress.current / Math.max(1, autoProgress.total)) * 100))}%`,
              }}
            />
          </div>
          <button
            onClick={handleCancelAutopilot}
            className="border px-2 py-0.5 text-[10px] uppercase tracking-widest"
            style={{ borderColor: 'var(--border)', color: 'var(--fg-soft)' }}
          >
            Stop after this scene
          </button>
        </div>
      )}

      {noteOpen && (
        <div className="border-t px-4 py-2" style={{ borderColor: 'var(--border)' }}>
          <input
            value={hint}
            onChange={e => setHint(e.target.value)}
            placeholder='e.g. "Maya stays cold." or "Land a button on dialogue."'
            className="input text-xs"
          />
        </div>
      )}

      {error && (
        <div className="border-t px-4 py-2 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--error)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
