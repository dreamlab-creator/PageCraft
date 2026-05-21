/**
 * useChunkedTakeover — a generic orchestrator for any "Take It From Here"
 * action that needs to be broken into smaller AI calls.
 *
 * The orchestrator:
 *   - splits a list of work items into batches of a target size,
 *   - runs each batch sequentially through the supplied task function,
 *   - on a per-request truncation / max-token error, automatically
 *     retries the batch with HALF the size (and keeps halving down to a
 *     single item before giving up on that batch),
 *   - calls `onPartial` after each successful batch so the UI can
 *     persist results incrementally — the user always gets WHATEVER the
 *     AI could complete, even if a later batch fails,
 *   - exposes live progress (current batch, total batches, status), and
 *   - returns a structured summary the caller can render: how many items
 *     succeeded, which items still need work, the last error if any.
 *
 * The caller doesn't need to know about token budgets, retries, or
 * partial state — it just defines its work items and how to apply a
 * batch result.
 */

import { useCallback, useRef, useState } from 'react'

export type TakeoverOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; /** true when the failure was a token / truncation cap. */ truncated?: boolean }

export interface ChunkedTakeoverOptions<Item, Result> {
  /** All items the user wants done. */
  items: Item[]
  /** Initial batch size to attempt. The orchestrator will shrink on failure. */
  batchSize: number
  /** Minimum batch size before we give up on a single batch. Default 1. */
  minBatchSize?: number
  /** Run one batch through the AI. Return success + result or failure + error. */
  runBatch: (batch: Item[]) => Promise<TakeoverOutcome<Result>>
  /** Apply a successful batch's output to the project store / state. */
  onPartial: (batch: Item[], result: Result) => void
  /** Optional progress callback for status text. */
  onProgress?: (info: { completed: number; total: number; batchLabel?: string }) => void
}

export interface ChunkedTakeoverResult<Item> {
  /** True when every item finished successfully. */
  ok: boolean
  /** Items the AI completed. */
  completed: Item[]
  /** Items that never got attempted because of an upstream stop (cancel / hard error). */
  remaining: Item[]
  /** Items that were attempted but failed even at the smallest batch size. */
  failed: Item[]
  /** Human-readable summary of what stopped us, if any. */
  error?: string
}

export function useChunkedTakeover() {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ completed: number; total: number; label?: string } | null>(null)
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false })

  const cancel = useCallback(() => {
    cancelRef.current.cancelled = true
  }, [])

  /**
   * Run the chunked orchestrator. Returns a summary; UIs can use it to
   * present a clear status. The state hooks above (busy, progress) are
   * cleared automatically.
   */
  const run = useCallback(async <Item, Result>(
    opts: ChunkedTakeoverOptions<Item, Result>,
  ): Promise<ChunkedTakeoverResult<Item>> => {
    const total = opts.items.length
    const min = Math.max(1, opts.minBatchSize ?? 1)
    setBusy(true)
    setProgress({ completed: 0, total, label: 'Preparing…' })
    cancelRef.current.cancelled = false

    const completed: Item[] = []
    const failed: Item[] = []
    const remaining = [...opts.items]
    let lastError: string | undefined

    try {
      while (remaining.length > 0) {
        if (cancelRef.current.cancelled) {
          lastError = 'Cancelled.'
          break
        }
        // Take the next batch off the front.
        let take = Math.min(opts.batchSize, remaining.length)
        let batch = remaining.slice(0, take)
        setProgress({
          completed: completed.length,
          total,
          label: `Batch of ${batch.length} (${completed.length}/${total} done)…`,
        })

        let outcome = await opts.runBatch(batch)

        // Retry with smaller batches on truncation, halving each time.
        while (!outcome.ok && outcome.truncated && take > min) {
          if (cancelRef.current.cancelled) break
          const halved = Math.max(min, Math.floor(take / 2))
          take = halved
          batch = remaining.slice(0, take)
          setProgress({
            completed: completed.length,
            total,
            label: `Hit token cap — retrying with ${take} item${take === 1 ? '' : 's'} (${completed.length}/${total} done)…`,
          })
          outcome = await opts.runBatch(batch)
        }

        if (cancelRef.current.cancelled) {
          lastError = 'Cancelled.'
          break
        }

        if (outcome.ok) {
          opts.onPartial(batch, outcome.value)
          completed.push(...batch)
          remaining.splice(0, batch.length)
        } else {
          // Even a single-item batch failed. Mark that item failed, advance.
          failed.push(...batch)
          remaining.splice(0, batch.length)
          lastError = outcome.error
        }
      }
    } finally {
      setBusy(false)
      setProgress(null)
      cancelRef.current.cancelled = false
    }

    return {
      ok: failed.length === 0 && remaining.length === 0,
      completed,
      remaining,
      failed,
      error: lastError,
    }
  }, [])

  return { run, busy, progress, cancel }
}
