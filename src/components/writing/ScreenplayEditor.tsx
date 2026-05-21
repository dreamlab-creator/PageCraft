import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useProjectStore, useUIStore } from '@/store'
import type { ScreenplayElement, ScreenplayElementType, ElementId } from '@/types'
import { newId } from '@/types'
import {
  nextElementOnEnter,
  nextElementOnTab,
  ELEMENT_HOTKEYS,
  detectElementType,
  paginate,
} from '@/lib/screenplay'
import { stripEmDashes } from '@/lib/humanization'
import { ScreenplayBlock } from './ScreenplayBlock'
import { ElementStatusChip } from './ElementStatusChip'
import { SmartTypePopup } from './SmartTypePopup'
import { WritingAIBar } from './WritingAIBar'

/**
 * The screenplay editor: block-based, contenteditable-per-paragraph,
 * Final Draft 13-style behavior.
 *
 * Notes on implementation:
 *   - Each element is a focusable contenteditable block. We manage selection
 *     and focus manually so Tab/Enter routing produces exactly the right
 *     element type.
 *   - We never store HTML in elements. Text is plain. Inline formatting
 *     (bold/italic/underline) would be added post-MVP via Fountain-style
 *     emphasis markers.
 */
export function ScreenplayEditor() {
  const project = useProjectStore(s => s.project)
  const updateElement = useProjectStore(s => s.updateElement)
  const insertElement = useProjectStore(s => s.insertElement)
  const removeElement = useProjectStore(s => s.removeElement)
  const focusMode = useUIStore(s => s.focusMode)
  const typewriterMode = useUIStore(s => s.typewriterMode)
  const structureLines = useUIStore(s => s.structureLines)

  const [activeId, setActiveId] = useState<ElementId | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  // Tracks whether we've already seeded the empty-project scene heading
  // for THIS project mount, so React's StrictMode double-invoke can't
  // cause duplicate "ghost" elements.
  const seededProjectIdRef = useRef<string | null>(null)

  const elements = project?.screenplay.elements ?? []
  const format = project?.format

  // Pagination map for the live page-number rendering.
  const pagination = useMemo(() => {
    if (!project) return null
    return paginate(project.screenplay, project.format)
  }, [project])

  // For a brand-new project: seed ONE empty scene_heading so the writer
  // has something to click into. Guarded by a ref so this never runs
  // twice for the same project mount (StrictMode dev double-invoke).
  //
  // We deliberately DO NOT auto-focus the seeded line. Entering Writing
  // mode shouldn't pop the Element chip in the toolbar or show the
  // ghost "INT./EXT. LOCATION — DAY" placeholder. The writer chooses
  // when to start: clicking anywhere on the page focuses the first
  // block (see the page's onMouseDown handler below), and at that point
  // both the chip and the placeholder appear naturally.
  useEffect(() => {
    if (!project) return
    if (seededProjectIdRef.current === project.id) return
    if (elements.length === 0) {
      seededProjectIdRef.current = project.id
      const first: ScreenplayElement = {
        id: newId<ElementId>(),
        type: 'scene_heading',
        text: '',
      }
      insertElement(null, first)
    } else {
      seededProjectIdRef.current = project.id
    }
    // Intentionally NOT setting activeId here — entering Writing mode
    // should not auto-select anything.
  }, [project, elements.length, insertElement])

  // Focus the active block whenever it changes. (Only fires when the
  // user explicitly clicks or navigates into a line.)
  useEffect(() => {
    if (!activeId) return
    const el = document.querySelector<HTMLDivElement>(`[data-block-id="${activeId}"] [contenteditable]`)
    if (el) {
      el.focus()
      placeCaretAtEnd(el)
      if (typewriterMode) scrollToCenter(el)
    }
  }, [activeId, typewriterMode])

  /** Insert a new paragraph of [type] AFTER [afterId] and focus it. */
  const insertAfter = useCallback(
    (afterId: ElementId | null, type: ScreenplayElementType, initialText = '') => {
      const el: ScreenplayElement = {
        id: newId<ElementId>(),
        type,
        text: initialText,
      }
      insertElement(afterId, el)
      setActiveId(el.id)
      return el.id
    },
    [insertElement],
  )

  /** Convert the type of an existing paragraph. */
  const convertType = useCallback(
    (id: ElementId, type: ScreenplayElementType) => {
      const patch: Partial<ScreenplayElement> = { type }
      const current = elements.find(e => e.id === id)
      // For act / episode break elements that are currently empty, fill in a
      // sensible default text the writer can edit.
      //  - Vertical projects: "EPISODE TWO" (then THREE, FOUR, …)
      //  - TV / feature projects: alternate between "END OF ACT N" and
      //    "ACT N+1" the way Final Draft 13 lays out act breaks.
      const empty = !current || !current.text.trim()
      if (empty && (type === 'act_label' || type === 'episode_label')) {
        patch.text = nextStructuralBreakText(type, elements)
      }
      updateElement(id, patch)
    },
    [elements, updateElement],
  )

  /** Handle Enter: insert next-logical paragraph. */
  const handleEnter = useCallback(
    (current: ScreenplayElement) => {
      const next = nextElementOnEnter(current.type)
      insertAfter(current.id as ElementId, next)
    },
    [insertAfter],
  )

  /** Handle Tab: switch the CURRENT empty element's type, or insert next. */
  const handleTab = useCallback(
    (current: ScreenplayElement) => {
      const empty = current.text.trim() === ''
      const next = nextElementOnTab(current.type, empty)
      if (empty) {
        convertType(current.id as ElementId, next)
      } else {
        insertAfter(current.id as ElementId, next)
      }
    },
    [convertType, insertAfter],
  )

  /**
   * Backspace on an empty block — remove it. The trick is we can ALSO be
   * looking at the very first block (the seeded scene heading on a brand-
   * new project). In that case there's no previous block to fall back to,
   * but if there ARE blocks below us we delete the ghost line and move
   * focus to the next one. Only when the empty block is the ONLY block in
   * the document do we leave it alone — the writer always needs at least
   * one paragraph to type into.
   */
  const handleBackspaceEmpty = useCallback(
    (current: ScreenplayElement) => {
      const idx = elements.findIndex(e => e.id === current.id)
      if (idx < 0) return

      // The only block left — keep it so the writer has a place to type.
      // But reset the type back to scene_heading if it has drifted, so the
      // empty page returns to a known state.
      if (elements.length <= 1) {
        if (current.type !== 'scene_heading') {
          updateElement(current.id as ElementId, { type: 'scene_heading' })
        }
        return
      }

      // First block: remove it and focus the NEXT one so the writer
      // continues forward from the top of the script.
      if (idx === 0) {
        const next = elements[1]
        removeElement(current.id as ElementId)
        setActiveId(next.id as ElementId)
        return
      }

      // Normal case — remove and merge focus into the previous block.
      const prev = elements[idx - 1]
      removeElement(current.id as ElementId)
      setActiveId(prev.id as ElementId)
    },
    [elements, removeElement, updateElement],
  )

  /** Cmd+1..9: force-create the corresponding element type. */
  const handleElementHotkey = useCallback(
    (current: ScreenplayElement, num: string) => {
      const type = ELEMENT_HOTKEYS[num]
      if (!type) return
      // Convert the current element if it's empty; otherwise insert a new one.
      if (current.text.trim() === '') {
        convertType(current.id as ElementId, type)
      } else {
        insertAfter(current.id as ElementId, type)
      }
    },
    [convertType, insertAfter],
  )

  /** As the user types, optionally upgrade element type via auto-detect. */
  const handleTextChange = useCallback(
    (el: ScreenplayElement, raw: string) => {
      // Strip em-dashes per element context (handled at the store level too).
      const text = el.type === 'dialogue' || el.type === 'parenthetical'
        ? stripEmDashes(raw, 'dialogue')
        : stripEmDashes(raw, 'action')

      // Auto-upgrade rules — only when the user has just typed something
      // distinctive (e.g., "INT. " becomes a scene heading even if current
      // type is action). We only upgrade UP, not down.
      const idx = elements.findIndex(e => e.id === el.id)
      const prev = idx > 0 ? elements[idx - 1] : null
      const detected = detectElementType(text, prev?.type)
      const shouldUpgrade =
        el.type === 'action' &&
        (detected === 'scene_heading' || detected === 'transition' || detected === 'character')

      if (shouldUpgrade) {
        updateElement(el.id as ElementId, { type: detected, text })
      } else {
        updateElement(el.id as ElementId, { text })
      }
    },
    [elements, updateElement],
  )

  if (!project || !format) return null

  // Group elements by page using the pagination engine's output. Each
  // group renders inside its own visual sheet so the writer sees real
  // printed pages, not an endless scroll of text.
  const pageGroups = useMemo<Array<{ page: number; elements: ScreenplayElement[] }>>(() => {
    if (!pagination) {
      return [{ page: 1, elements }]
    }
    const groups: Array<{ page: number; elements: ScreenplayElement[] }> = []
    for (const el of elements) {
      const page = pagination.pageOfElement.get(el.id) ?? 1
      const last = groups[groups.length - 1]
      if (!last || last.page !== page) {
        groups.push({ page, elements: [el] })
      } else {
        last.elements.push(el)
      }
    }
    return groups.length === 0 ? [{ page: 1, elements: [] }] : groups
  }, [elements, pagination])

  return (
    <div
      ref={editorRef}
      className={`screenplay-editor flex flex-col items-center ${focusMode ? 'focus-mode' : ''} ${format.conventions.multiCam ? 'multi-cam' : ''}`}
    >
      {/*
       * Shared sticky header — a single bar that owns top-0 so the
       * WritingAIBar and ElementStatusChip don't fight each other for
       * sticky position (which caused the "scrolls behind Element" bug).
       *
       * Compact vertical footprint: the toolbar row and the (optional)
       * element-status row total ~64px when nothing else is expanded.
       */}
      <header
        className="sticky top-0 z-20 w-full border-b"
        style={{
          background: 'color-mix(in srgb, var(--bg) 92%, transparent)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="mx-auto w-full max-w-[8.5in]">
          <WritingAIBar activeId={activeId} />
          {activeId && (
            <div className="flex items-center gap-2 border-t px-4 py-1.5"
              style={{ borderColor: 'var(--border)' }}
            >
              <ElementStatusChip
                activeId={activeId}
                elements={elements}
                onChangeType={(id, type) => convertType(id, type)}
              />
            </div>
          )}
        </div>
      </header>

      <div className="h-6" />

      {pageGroups.map((group, groupIdx) => {
        const isLastPage = groupIdx === pageGroups.length - 1
        return (
        <div
          key={`page-${group.page}`}
          className="screenplay-page screenplay-font"
          style={{ marginBottom: '1.5rem' }}
          // Final Draft-style: clicking ANYWHERE on the page focuses the
          // nearest editable block. On the last page we focus the very
          // last element (or the previous element if the click landed in
          // the empty area below the content). This rescues the writer
          // from a "I clicked but nothing happened" dead zone on blank
          // projects, and matches FD13's behavior.
          onMouseDown={(e) => {
            const target = e.target as HTMLElement
            // Only handle clicks that didn't already land on a block —
            // the block's own contenteditable focus path is already wired.
            if (target.closest('[data-block-id]')) return
            const lastEl = isLastPage
              ? group.elements[group.elements.length - 1]
              : null
            if (lastEl) {
              e.preventDefault()
              setActiveId(lastEl.id as ElementId)
            }
          }}
        >
          {/* FD-style page number: top right, "n." */}
          {group.page > 1 && (
            <div className="screenplay-page__page-number">
              {group.page}.
            </div>
          )}

          {group.elements.map((el, i) => {
            const globalIdx = elements.findIndex(e => e.id === el.id)
            return (
              <ScreenplayBlock
                key={el.id}
                element={el}
                isActive={el.id === activeId}
                isFirstOnPage={i === 0}
                format={format}
                structureLines={structureLines}
                onFocus={() => setActiveId(el.id as ElementId)}
                onTextChange={text => handleTextChange(el, text)}
                onEnter={() => handleEnter(el)}
                onTab={() => handleTab(el)}
                onBackspaceEmpty={() => handleBackspaceEmpty(el)}
                onElementHotkey={num => handleElementHotkey(el, num)}
                onToggleLock={() => updateElement(el.id as ElementId, { locked: !el.locked })}
                onConvert={type => convertType(el.id as ElementId, type)}
                onArrowUp={() => {
                  if (globalIdx > 0) setActiveId(elements[globalIdx - 1].id as ElementId)
                }}
                onArrowDown={() => {
                  if (globalIdx < elements.length - 1) setActiveId(elements[globalIdx + 1].id as ElementId)
                }}
              />
            )
          })}
        </div>
        )
      })}

      <div className="h-[40vh]" />

      <SmartTypePopup activeId={activeId} elements={elements} project={project} />
    </div>
  )
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function scrollToCenter(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  const middle = rect.top + rect.height / 2
  const winMid = window.innerHeight / 2
  window.scrollBy({ top: middle - winMid, behavior: 'smooth' })
}

/**
 * Generate the default text for a newly inserted Act/Episode break.
 *
 *   Vertical projects (episode_label):
 *     "EPISODE TWO" / "EPISODE THREE" / "EPISODE FOUR" …
 *
 *   TV / Feature projects (act_label):
 *     Final Draft 13 lays out TV act breaks as a PAIR of paragraphs:
 *       "END OF ACT ONE"  (close out the previous act)
 *       "ACT TWO"         (open the next act)
 *     We count existing act_labels and alternate accordingly. The writer
 *     can edit either line freely; the helper just supplies a smart default.
 */
function nextStructuralBreakText(
  type: 'act_label' | 'episode_label',
  elements: ScreenplayElement[],
): string {
  const NUMBERS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE']
  if (type === 'episode_label') {
    const existing = elements.filter(e => e.type === 'episode_label' && e.text.trim())
    // Episodes 1..N are auto-detected by counting existing labels; the next
    // one is N+1 (so "EPISODE TWO" the first time the writer adds one).
    const next = Math.min(NUMBERS.length, existing.length + 2)
    return `EPISODE ${NUMBERS[next - 1]}`
  }
  // act_label (TV / feature)
  const existing = elements.filter(e => e.type === 'act_label' && e.text.trim())
  const last = existing[existing.length - 1]?.text.trim().toUpperCase() ?? ''
  // If the previous break was an "ACT N" line we now close it with
  // "END OF ACT N". Otherwise we open the next act.
  const actMatch = last.match(/^ACT\s+(\w+)$/)
  if (actMatch) {
    return `END OF ACT ${actMatch[1]}`
  }
  // Default: open the next act. Count "ACT N" lines to figure out which one.
  const opened = existing.filter(e => /^ACT\s/i.test(e.text.trim())).length
  const next = Math.min(NUMBERS.length, opened + 2)
  return `ACT ${NUMBERS[next - 1]}`
}
