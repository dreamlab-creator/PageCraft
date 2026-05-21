/**
 * BlockAIMenu — a tiny menu that pops out from a screenplay block's gutter
 * and offers per-line AI actions:
 *
 *   - Rewrite (tighten / sharper / visual / alt)
 *   - Punch up (dialogue only)
 *   - Expand to scene (action one-liner → played-out segment)
 *
 * The menu calls the rewrite or expand task, opens the standard AI Result
 * Drawer for review, and on accept either:
 *   - replaces the line's text (rewrite, punch up), or
 *   - replaces the line with a multi-element batch (expand to scene).
 */

import { useState } from 'react'
import { useProjectStore } from '@/store'
import type { ElementId, ScreenplayElement } from '@/types'
import { useWritingAI } from './WritingAIContext'
import {
  rewriteElement,
  expandToScene,
  adoptAISceneCharacters,
  type RewriteMode,
} from '@/lib/ai'
import { fountainToElements } from '@/lib/screenplay'

interface Props {
  element: ScreenplayElement
}

export function BlockAIMenu({ element }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const updateElement = useProjectStore(s => s.updateElement)
  const insertElementsAfter = useProjectStore(s => s.insertElementsAfter)
  const upsertCharacter = useProjectStore(s => s.upsertCharacter)
  const project = useProjectStore(s => s.project)
  const { runText, runDirect } = useWritingAI()

  if (!project || element.locked) return null

  const isDialogueish = element.type === 'dialogue' || element.type === 'parenthetical'
  const isActionish = element.type === 'action' || element.type === 'general'

  const handleRewrite = (mode: RewriteMode, label: string) => {
    setOpen(false)
    runText({
      label: `${label}: "${element.text.slice(0, 60)}${element.text.length > 60 ? '…' : ''}"`,
      task: input => rewriteElement(input, { elementId: element.id, mode }),
      onAccept: text => updateElement(element.id as ElementId, { text, humanEdited: false, aiGenerated: true }),
    })
  }

  const handleExpand = async () => {
    setOpen(false)
    setBusy(true); setError(null)
    const res = await runDirect(
      (input) => expandToScene(input, { elementId: element.id, paragraphs: 5 }),
      (drafted) => {
        const els = fountainToElements(drafted.fountain ?? '')
        if (els.length === 0) {
          setError('The model returned no usable text.')
          return
        }
        // Replace the source one-liner with the played-out version.
        insertElementsAfter(element.id as ElementId, els, true)
        if (drafted.newCharacters && drafted.newCharacters.length > 0) {
          const created = adoptAISceneCharacters(project, drafted.newCharacters)
          for (const c of created) upsertCharacter(c)
        }
      },
    )
    setBusy(false)
    if (!res.ok) setError(res.error ?? 'Unknown error.')
  }

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        disabled={busy}
        className="h-5 w-5 select-none border text-[10px] disabled:opacity-30"
        style={{
          background: 'var(--bg-elev)',
          borderColor: 'var(--border)',
          color: 'var(--fg-soft)',
        }}
        title="AI Assist for this line"
      >
        AI
      </button>
      {open && (
        <div
          className="absolute left-7 top-0 z-20 w-52 border text-xs"
          style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {isActionish && (
            <>
              <MenuItem label="Tighten" onClick={() => handleRewrite('tighten', 'Tighten action')} />
              <MenuItem label="Sharper" onClick={() => handleRewrite('sharper', 'Sharper action')} />
              <MenuItem label="More visual" onClick={() => handleRewrite('visual', 'Visualize')} />
              <MenuItem label="Alternate take" onClick={() => handleRewrite('alt', 'Alt action')} />
              <Divider />
              <MenuItem label="Expand to scene…" onClick={() => void handleExpand()} />
            </>
          )}
          {isDialogueish && (
            <>
              <MenuItem label="Punch up" onClick={() => handleRewrite('punch_up', 'Punch up')} />
              <MenuItem label="Tighten" onClick={() => handleRewrite('tighten', 'Tighten dialogue')} />
              <MenuItem label="Alternate take" onClick={() => handleRewrite('alt', 'Alt dialogue')} />
            </>
          )}
          {(element.type === 'scene_heading' || element.type === 'transition' || element.type === 'shot') && (
            <>
              <MenuItem label="Alternate phrasing" onClick={() => handleRewrite('alt', 'Alt phrasing')} />
            </>
          )}
        </div>
      )}
      {error && (
        <div className="absolute left-7 top-7 z-20 w-64 border px-2 py-1 text-[10px]"
          style={{ background: 'var(--bg-elev)', borderColor: 'var(--error)', color: 'var(--error)' }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--bg-deep)]"
      style={{ color: 'var(--fg)' }}
    >
      {label}
    </button>
  )
}

function Divider() {
  return <div className="my-1 h-px" style={{ background: 'var(--border)' }} />
}
