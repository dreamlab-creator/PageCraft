import { useState } from 'react'
import { useLibraryStore } from '@/store'

interface Props {
  /** Display label. Default "AI Assist". */
  label?: string
  /** Compact icon-only style. */
  compact?: boolean
  /** Tooltip / aria-label. */
  title?: string
  /**
   * Callback invoked when the user clicks. Should return a Promise that
   * resolves when the AI task completes. Errors are shown inline.
   */
  onClick: () => Promise<void> | void
  /** Whether the parent is currently busy (e.g., multiple buttons share state). */
  busy?: boolean
  /** Disabled state. */
  disabled?: boolean
}

/**
 * The small inline button that appears everywhere AI assistance is available.
 * Tightly designed to feel quiet and serious — not chunky or playful.
 */
export function AIAssistButton({ label = 'AI Assist', compact, title, onClick, busy, disabled }: Props) {
  const apiKey = useLibraryStore(s => s.settings.ai.apiKey)
  const [localBusy, setLocalBusy] = useState(false)

  const isBusy = busy || localBusy
  const isDisabled = disabled || !apiKey || isBusy

  const handleClick = async () => {
    if (isDisabled) return
    setLocalBusy(true)
    try {
      await onClick()
    } finally {
      setLocalBusy(false)
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        title={title ?? (apiKey ? label : 'Add your Anthropic API key in Settings to enable AI Assist')}
        onClick={handleClick}
        disabled={isDisabled}
        className="inline-flex h-6 w-6 items-center justify-center border text-[10px]"
        style={{
          borderColor: 'var(--border)',
          color: !apiKey ? 'var(--fg-muted)' : isBusy ? 'var(--accent)' : 'var(--fg-soft)',
          background: isBusy ? 'var(--bg-deep)' : 'transparent',
          opacity: isDisabled && !isBusy ? 0.4 : 1,
        }}
      >
        {isBusy ? <Spinner /> : <Sparkles />}
      </button>
    )
  }

  return (
    <button
      type="button"
      title={title ?? (apiKey ? label : 'Add your Anthropic API key in Settings to enable AI Assist')}
      onClick={handleClick}
      disabled={isDisabled}
      className="inline-flex items-center gap-1.5 border px-2 py-1 text-[11px] uppercase tracking-widest transition-colors"
      style={{
        borderColor: isBusy ? 'var(--accent)' : 'var(--border)',
        color: !apiKey ? 'var(--fg-muted)' : isBusy ? 'var(--accent)' : 'var(--fg-soft)',
        background: isBusy ? 'var(--bg-deep)' : 'transparent',
        opacity: isDisabled && !isBusy ? 0.5 : 1,
      }}
    >
      {isBusy ? <Spinner /> : <Sparkles />}
      <span>{isBusy ? 'Thinking…' : label}</span>
    </button>
  )
}

function Sparkles() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <path d="M6 1 L7 5 L11 6 L7 7 L6 11 L5 7 L1 6 L5 5 Z" fill="currentColor" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
