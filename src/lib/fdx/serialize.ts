/**
 * Final Draft FDX serializer.
 *
 * FDX is a structured XML format used by Final Draft. We emit a minimal
 * but valid FinalDraft 12 document containing the screenplay paragraphs
 * mapped to their proper element types, and an optional title page.
 *
 * Spec reference: Final Draft 12 SDK / industry-published FDX schemas.
 * We target the broad-compatibility subset: Content/Paragraph nodes with
 * Type and Text children, and a TitlePage block when title-page data is
 * available.
 */

import type { ScreenplayDocument, ScreenplayElementType, ScreenplayElement } from '@/types'

export interface FDXTitlePage {
  title?: string
  credit?: string
  author?: string
  source?: string
  draftDate?: string
  contact?: string
}

/** Map our element types to FDX paragraph Type values. */
const TYPE_MAP: Record<ScreenplayElementType, string> = {
  scene_heading: 'Scene Heading',
  action: 'Action',
  character: 'Character',
  dialogue: 'Dialogue',
  parenthetical: 'Parenthetical',
  transition: 'Transition',
  shot: 'Shot',
  general: 'General',
  lyric: 'Action', // FDX has no lyric type; render as action
  cast_list: 'Action',
  sfx: 'Action',
  act_label: 'General',
  episode_label: 'General',
  centered_text: 'General',
  page_break: 'Action',
  note: 'General',
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function paragraphXml(el: ScreenplayElement): string {
  const type = TYPE_MAP[el.type] ?? 'Action'
  const text = el.type === 'parenthetical'
    ? el.text.replace(/^\(|\)$/g, '')
    : el.text
  // Page break: emit Action with [page break] sentinel + FDX page break attr.
  if (el.type === 'page_break') {
    return `    <Paragraph Type="Action"><Text></Text></Paragraph>`
  }
  // Centered: FDX uses Alignment="Center" on the paragraph.
  if (el.type === 'centered_text') {
    const inner = text.replace(/^>\s*/, '').replace(/\s*<\s*$/, '')
    return `    <Paragraph Type="General" Alignment="Center"><Text>${xmlEscape(inner)}</Text></Paragraph>`
  }
  return `    <Paragraph Type="${type}"><Text>${xmlEscape(text)}</Text></Paragraph>`
}

function titlePageXml(title?: FDXTitlePage): string {
  if (!title) return ''
  const lines: string[] = []
  const push = (label: string, value: string | undefined, align: 'Center' | 'Left' | 'Right' = 'Center') => {
    if (!value) return
    lines.push(`      <Paragraph Type="General" Alignment="${align}"><Text>${xmlEscape(value)}</Text></Paragraph>`)
    lines.push(`      <Paragraph Type="General"><Text></Text></Paragraph>`)
  }
  if (title.title) push('TITLE', title.title.toUpperCase())
  push('CREDIT', title.credit ?? 'Written by')
  push('AUTHOR', title.author)
  if (title.source) push('SOURCE', title.source)
  if (title.draftDate) push('DRAFT_DATE', title.draftDate, 'Right')
  if (title.contact) push('CONTACT', title.contact, 'Left')
  if (lines.length === 0) return ''
  return `  <TitlePage>
    <Content>
${lines.join('\n')}
    </Content>
  </TitlePage>\n`
}

export function serializeFDX(doc: ScreenplayDocument, titlePage?: FDXTitlePage): string {
  const paragraphs = doc.elements.map(paragraphXml).join('\n')
  const titleXml = titlePageXml(titlePage)

  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
${paragraphs}
  </Content>
${titleXml}</FinalDraft>
`
}
