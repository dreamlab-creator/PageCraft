/**
 * useCastReconciler — runs the cast-vs-script audit on a debounce and
 * auto-adopts newly cued character names into the bible as stubs.
 *
 * Design choices:
 *
 *   - We only auto-adopt names that appear as *character cues*. Cues are
 *     unambiguous: the writer (or AI) is putting words into someone's
 *     mouth, so that person clearly exists.
 *
 *   - ALL-CAPS names in action lines are NOT auto-adopted. They're flagged
 *     in the incongruency report so the writer can review (false-positive
 *     risk is much higher there: "MONTAGE", "ANGLE ON", proper nouns,
 *     etc.).
 *
 *   - Adoption ignores the `characters` section confirmation lock. The
 *     screenplay is the source of truth — if a character is on the page,
 *     they belong in the bible. The user reviews and fleshes them out.
 */

import { useEffect, useRef } from 'react'
import { useProjectStore } from '@/store'

interface Options {
  /** Debounce window before running the audit. */
  debounceMs?: number
  /** When false, the reconciler does not auto-adopt — it just reports. */
  enabled?: boolean
}

export function useCastReconciler({ debounceMs = 600, enabled = true }: Options = {}) {
  const elements = useProjectStore(s => s.project?.screenplay.elements)
  const adopt = useProjectStore(s => s.adoptScriptCharacters)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSig = useRef<string>('')

  useEffect(() => {
    if (!enabled) return
    if (!elements) return

    // Cheap signature so we don't re-audit when only non-cue text changed.
    const sig = elements
      .filter(e => e.type === 'character')
      .map(e => e.text.trim().toUpperCase())
      .join('|')
    if (sig === lastSig.current) return
    lastSig.current = sig

    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      adopt('auto_script')
    }, debounceMs)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [elements, adopt, enabled, debounceMs])
}
