import { useEffect, useRef } from 'react'
import type { ScreenplayElement, ScreenplayElementType, FormatConfig } from '@/types'

interface Props {
  element: ScreenplayElement
  isActive: boolean
  format: FormatConfig
  structureLines: boolean
  /** Whether this is the first block on its visual page (resets top margin). */
  isFirstOnPage?: boolean
  onFocus: () => void
  onTextChange: (text: string) => void
  onEnter: () => void
  onTab: () => void
  onBackspaceEmpty: () => void
  onElementHotkey: (num: string) => void
  onToggleLock: () => void
  onConvert: (type: ScreenplayElementType) => void
  onArrowUp: () => void
  onArrowDown: () => void
}

export function ScreenplayBlock({
  element,
  isActive,
  format,
  isFirstOnPage,
  onFocus,
  onTextChange,
  onEnter,
  onTab,
  onBackspaceEmpty,
  onElementHotkey,
  onToggleLock,
  onConvert,
  onArrowUp,
  onArrowDown,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // Silence unused imports kept for API parity (these come through props
  // for future use — element-status chip handles type changes today).
  void onToggleLock
  void onConvert
  void isActive

  // Mirror the stored text into the contenteditable only when it changes externally.
  useEffect(() => {
    if (!ref.current) return
    if (ref.current.textContent !== element.text) {
      ref.current.textContent = element.text
    }
  }, [element.text])

  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const meta = e.metaKey || e.ctrlKey

    // Cmd+1..9: element hotkey.
    if (meta && /^[1-9]$/.test(e.key)) {
      e.preventDefault()
      onElementHotkey(e.key)
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onEnter()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      onTab()
      return
    }
    if (e.key === 'Backspace') {
      const text = ref.current?.textContent ?? ''
      if (!text) {
        e.preventDefault()
        onBackspaceEmpty()
      }
      return
    }
    if (e.key === 'ArrowUp' && atFirstLine(ref.current)) {
      e.preventDefault()
      onArrowUp()
      return
    }
    if (e.key === 'ArrowDown' && atLastLine(ref.current)) {
      e.preventDefault()
      onArrowDown()
      return
    }

    // Live-prevent em-dash typing — we replace immediately.
    if (e.key === '—') {
      e.preventDefault()
      document.execCommand('insertText', false, element.type === 'dialogue' || element.type === 'parenthetical' ? '--' : ',')
    }
  }

  const handleInput = () => {
    const text = ref.current?.textContent ?? ''
    onTextChange(text)
  }

  // Apply per-format casing override (e.g., multi-cam action in ALL CAPS).
  const casingOverride = (format.page.elementCasing as any)[element.type]
  const casingStyle: React.CSSProperties =
    casingOverride === 'all_caps'
      ? { textTransform: 'uppercase' }
      : {}

  const isEmpty = !element.text
  const placeholder = isEmpty ? PLACEHOLDERS[element.type] ?? '' : ''

  return (
    <div
      data-block-id={element.id}
      data-type={element.type}
      data-locked={element.locked ? 'true' : undefined}
      data-first-on-page={isFirstOnPage ? 'true' : undefined}
      data-empty={isEmpty ? 'true' : undefined}
      className="sp-element relative"
      style={casingStyle}
    >
      <div
        ref={ref}
        contentEditable={!element.locked}
        suppressContentEditableWarning
        spellCheck
        data-placeholder={placeholder}
        onFocus={onFocus}
        onInput={handleInput}
        onKeyDown={handleKey}
        // Prevent rich paste — we want plain text in screenplay elements.
        onPaste={e => {
          e.preventDefault()
          const text = e.clipboardData.getData('text/plain')
          document.execCommand('insertText', false, text)
        }}
      />
    </div>
  )
}

/**
 * Ghost text shown inside an empty contenteditable to tell the writer
 * exactly what kind of line they're on. Disappears the moment any text
 * is typed (via the `data-empty` attribute on the parent).
 */
const PLACEHOLDERS: Partial<Record<ScreenplayElementType, string>> = {
  scene_heading: 'INT./EXT. LOCATION — DAY',
  action: 'Action',
  character: 'CHARACTER',
  parenthetical: '(parenthetical)',
  dialogue: 'Dialogue',
  transition: 'TRANSITION:',
  shot: 'SHOT',
  general: '',
  lyric: 'Lyric',
  cast_list: 'Cast list',
  sfx: 'SFX',
  act_label: 'ACT LABEL',
  episode_label: 'EPISODE LABEL',
  centered_text: 'Centered',
  page_break: '',
  note: 'Note',
}

function atFirstLine(el: HTMLElement | null): boolean {
  if (!el) return true
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return true
  const range = sel.getRangeAt(0)
  const elRect = el.getBoundingClientRect()
  const caretRect = range.getBoundingClientRect()
  if (caretRect.top === 0 && caretRect.bottom === 0) return true
  return caretRect.top - elRect.top < 8
}

function atLastLine(el: HTMLElement | null): boolean {
  if (!el) return true
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return true
  const range = sel.getRangeAt(0)
  const elRect = el.getBoundingClientRect()
  const caretRect = range.getBoundingClientRect()
  if (caretRect.top === 0 && caretRect.bottom === 0) return true
  return elRect.bottom - caretRect.bottom < 8
}
