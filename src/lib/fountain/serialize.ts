/**
 * Fountain 1.1 serializer. Round-trips a ScreenplayDocument back to .fountain
 * plain text.
 */

import type { ScreenplayDocument, ScreenplayElement } from '@/types'

export function serializeFountain(doc: ScreenplayDocument): string {
  const out: string[] = []

  // Title page.
  const tp = doc.titlePage
  const hasTitle = Object.values(tp).some(v => v && v.length > 0)
  if (hasTitle) {
    if (tp.title) out.push(`Title: ${tp.title}`)
    if (tp.credit) out.push(`Credit: ${tp.credit}`)
    if (tp.author) out.push(`Author: ${tp.author}`)
    if (tp.source) out.push(`Source: ${tp.source}`)
    if (tp.draftDate) out.push(`Draft date: ${tp.draftDate}`)
    if (tp.contact) out.push(`Contact: ${tp.contact.replace(/\n/g, '\n    ')}`)
    if (tp.notes) out.push(`Notes: ${tp.notes}`)
    out.push('')
  }

  // Body.
  let prev: ScreenplayElement | null = null
  for (let i = 0; i < doc.elements.length; i++) {
    const el = doc.elements[i]
    const next = doc.elements[i + 1] ?? null
    const lines = serializeElement(el, prev, next)
    if (lines !== null) out.push(...lines)
    prev = el
  }
  return out.join('\n') + '\n'
}

function serializeElement(
  el: ScreenplayElement,
  prev: ScreenplayElement | null,
  next: ScreenplayElement | null,
): string[] | null {
  const text = el.text
  switch (el.type) {
    case 'scene_heading': {
      const sceneNumber = el.sceneNumber ? ` #${el.sceneNumber}#` : ''
      // Add blank line before if previous wasn't already blank-separated.
      const out: string[] = []
      if (prev) out.push('')
      out.push(text + sceneNumber)
      out.push('')
      return out
    }
    case 'action': {
      const out: string[] = []
      const needsBlank = !prev || prev.type !== 'action'
      if (needsBlank && prev) out.push('')
      // Force action if the line looks like a character cue (all caps, short).
      const forced = looksLikeCueShape(text) ? `!${text}` : text
      out.push(forced)
      return out
    }
    case 'character': {
      const out: string[] = []
      if (prev) out.push('')
      const dual = el.dualWith !== undefined && el.dualWith !== null ? ' ^' : ''
      const ext = el.extension ? ` (${el.extension})` : ''
      // Use @ prefix if name has any lowercase to preserve casing.
      const prefix = /[a-z]/.test(text) ? '@' : ''
      out.push(`${prefix}${text}${ext}${dual}`)
      return out
    }
    case 'parenthetical': {
      // Parenthetical follows character or dialogue. No blank line between.
      const txt = text.startsWith('(') ? text : `(${text})`
      return [txt]
    }
    case 'dialogue': {
      return [text]
    }
    case 'transition': {
      const out: string[] = []
      if (prev) out.push('')
      const forced = !/TO:\s*$/.test(text) ? `>${text}` : text
      out.push(forced)
      out.push('')
      return out
    }
    case 'shot': {
      const out: string[] = []
      if (prev) out.push('')
      out.push(text)
      return out
    }
    case 'general': {
      const out: string[] = []
      if (prev) out.push('')
      out.push(text)
      return out
    }
    case 'lyric': {
      return [`~${text}`]
    }
    case 'centered_text': {
      const out: string[] = []
      if (prev) out.push('')
      out.push(`> ${text} <`)
      return out
    }
    case 'page_break': {
      return ['', '===', '']
    }
    case 'act_label':
    case 'episode_label': {
      const out: string[] = []
      if (prev) out.push('')
      // Use forced action so it doesn't trigger character interpretation.
      out.push(`!${text}`)
      out.push('')
      return out
    }
    case 'cast_list':
    case 'sfx':
      return [text]
    case 'note':
      return [`[[${text}]]`]
  }
  return null
}

function looksLikeCueShape(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  return /^[A-Z0-9 .'\-#&!?,]+$/.test(t) && t.length <= 40 && t.split(/\s+/).length <= 6
}
