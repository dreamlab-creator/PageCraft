/**
 * Convert AI-generated Fountain text into an array of `ScreenplayElement`s
 * that can be spliced into the project's screenplay document.
 *
 * Uses the existing Fountain parser (which produces a full
 * `ScreenplayDocument`) and post-processes:
 *   - Each element gets a fresh `id` so insertion into the live document
 *     doesn't collide with anything that already exists.
 *   - Each element is tagged with `aiGenerated: true` so diagnostics and
 *     UI can distinguish drafted lines from hand-authored ones.
 *   - Em-dashes are stripped (defense in depth — the Anthropic adapter
 *     already strips them at the source).
 *   - Optional `episodeId` propagation if the caller provides one.
 */

import type { ScreenplayElement, ElementId } from '@/types'
import { newId } from '@/types'
import { parseFountain } from '@/lib/fountain'
import { stripEmDashes } from '@/lib/humanization'

export function fountainToElements(
  fountain: string,
  opts?: { episodeId?: string },
): ScreenplayElement[] {
  if (!fountain || !fountain.trim()) return []
  const doc = parseFountain(fountain)
  return doc.elements.map(el => {
    const ctx = el.type === 'dialogue' || el.type === 'parenthetical' ? 'dialogue' : 'action'
    const cleanText = stripEmDashes(el.text, ctx as any)
    const fresh: ScreenplayElement = {
      ...el,
      id: newId<ElementId>(),
      text: cleanText,
      aiGenerated: true,
    }
    if (opts?.episodeId) fresh.episodeId = opts.episodeId
    return fresh
  })
}
