/**
 * TakeItFromHereButton — the canonical autonomous-completion action.
 *
 * Visual treatment: same size as other action buttons in the toolbar.
 * No big colored block — instead, a thin border in the accent color and
 * the accent color used for the label text. The button reads as a peer
 * to the granular AI buttons next to it, not as a giant CTA that
 * dominates the layout.
 *
 * Subtitle/icon affordances have been removed: every section of the app
 * uses the same plain label so the user always knows what they're
 * clicking.
 */

import type { ButtonHTMLAttributes } from 'react'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** When true, shows "Working…" instead of the label. */
  busy?: boolean
  /** Optional override label (rare — only when "Take It From Here" doesn't fit grammatically). */
  label?: string
}

export function TakeItFromHereButton({
  busy,
  label = 'Take It From Here',
  disabled,
  className,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={busy || disabled}
      className={[
        'border px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors disabled:opacity-50',
        className ?? '',
      ].join(' ')}
      style={{
        background: 'transparent',
        color: 'var(--accent)',
        borderColor: 'var(--accent)',
      }}
    >
      {busy ? 'Working…' : label}
    </button>
  )
}
