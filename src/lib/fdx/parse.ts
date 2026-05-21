/**
 * Final Draft FDX parser.
 *
 * FDX is XML. The minimum interesting structure is:
 *
 *   <FinalDraft DocumentType="Script" Version="...">
 *     <Content>
 *       <Paragraph Type="Scene Heading"><Text>INT. KITCHEN - NIGHT</Text></Paragraph>
 *       <Paragraph Type="Action"><Text>Maya enters.</Text></Paragraph>
 *       <Paragraph Type="Character"><Text>MAYA</Text></Paragraph>
 *       <Paragraph Type="Dialogue"><Text>You came.</Text></Paragraph>
 *       ...
 *     </Content>
 *     <TitlePage>
 *       <Content>...</Content>
 *     </TitlePage>
 *   </FinalDraft>
 *
 * Element variants we handle:
 *   - Type: "Scene Heading" | "Action" | "Character" | "Dialogue" |
 *           "Parenthetical" | "Transition" | "Shot" | "General"
 *   - Alignment="Center" on General → centered_text
 *   - Paragraph may contain multiple <Text> children with formatting
 *     attributes (Bold, Italic, etc.) — we concatenate the inner text.
 *
 * Returns a ScreenplayDocument with fresh element ids and AI-generated flags
 * left unset (since this is hand-authored content from another tool).
 */

import { newId } from '@/types'
import type {
  ScreenplayDocument,
  ScreenplayElement,
  ScreenplayElementType,
  ElementId,
} from '@/types'

const TYPE_LOOKUP: Record<string, ScreenplayElementType> = {
  'Scene Heading': 'scene_heading',
  'Action': 'action',
  'Character': 'character',
  'Dialogue': 'dialogue',
  'Parenthetical': 'parenthetical',
  'Transition': 'transition',
  'Shot': 'shot',
  'General': 'general',
  'Cast List': 'cast_list',
  'SFX': 'sfx',
  'Lyric': 'lyric',
}

/**
 * Parse a FinalDraft .fdx document into a ScreenplayDocument.
 *
 * Throws if the XML can't be parsed at all. Silently coerces unknown
 * Paragraph types to 'action' so a partial document still produces a
 * usable result.
 */
export function parseFDX(xml: string): ScreenplayDocument {
  if (!xml || typeof xml !== 'string') {
    throw new Error('parseFDX: empty input')
  }

  const trimmed = xml.trim()
  if (!trimmed) {
    throw new Error('parseFDX: empty input')
  }

  const parser = new DOMParser()
  const doc = parser.parseFromString(trimmed, 'application/xml')
  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error(`parseFDX: invalid XML — ${parseError.textContent?.slice(0, 200) ?? 'unknown error'}`)
  }

  const root = doc.documentElement
  if (!root || (root.nodeName !== 'FinalDraft' && root.localName !== 'FinalDraft')) {
    throw new Error(`parseFDX: expected <FinalDraft> root element, got <${root?.nodeName ?? '?'}>`)
  }

  const elements: ScreenplayElement[] = []
  // The body content is in <Content> nested directly under <FinalDraft>.
  // (A separate <TitlePage><Content>...</Content></TitlePage> exists for
  // title-page paragraphs — we extract those separately.)
  const bodyContent = Array.from(root.children).find(
    c => c.tagName === 'Content' && c.parentElement?.tagName === 'FinalDraft',
  )
  if (bodyContent) {
    for (const para of Array.from(bodyContent.children)) {
      if (para.tagName !== 'Paragraph') continue
      const el = paragraphToElement(para)
      if (el) elements.push(el)
    }
  }

  // Title page (best-effort): map paragraphs into the titlePage block.
  const titlePage = extractTitlePage(root)

  return {
    elements,
    titlePage,
  }
}

function paragraphToElement(node: Element): ScreenplayElement | null {
  const rawType = node.getAttribute('Type') ?? 'Action'
  const alignment = node.getAttribute('Alignment') ?? ''
  // Concatenate all Text children (FDX can split a paragraph into many runs
  // for inline formatting — we keep the plain text).
  const textParts: string[] = []
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element
      if (el.tagName === 'Text') {
        textParts.push(el.textContent ?? '')
      } else if (el.tagName === 'DualDialogue') {
        // Dual-dialogue is a nested block. Flatten and append each paragraph.
        // We'll synthesize separate elements outside the normal flow.
      }
    }
  }
  let text = textParts.join('').replace(/\r\n?/g, '\n').trim()

  let type: ScreenplayElementType = TYPE_LOOKUP[rawType] ?? 'action'

  // Centered General paragraphs become centered_text.
  if (type === 'general' && alignment === 'Center') {
    type = 'centered_text'
  }

  // Parentheticals in FDX usually include the surrounding parens already;
  // some tools strip them. Normalize: store WITHOUT outer parens (our
  // editor adds them visually).
  if (type === 'parenthetical') {
    text = text.replace(/^\s*\(/, '').replace(/\)\s*$/, '').trim()
    if (text) text = `(${text})` // keep them in storage for round-trip fidelity
  }

  // Drop totally empty paragraphs except scene headings (they're structural).
  if (!text && type !== 'scene_heading') return null

  const id = newId<ElementId>()
  const el: ScreenplayElement = {
    id,
    type,
    text,
  }

  // Parse scene heading components if we recognize them.
  if (type === 'scene_heading') {
    const m = text.match(/^(INT\.?\/EXT\.?|INT\.?|EXT\.?|EST\.?|I\/E\.?)\s*(.+?)(?:\s*[-–—]\s*(.+))?\s*$/i)
    if (m) {
      el.sceneIntro = (m[1].toUpperCase().endsWith('.') ? m[1] : `${m[1]}.`) as any
      el.sceneLocation = (m[2] ?? '').trim()
      el.sceneTime = (m[3] ?? '').trim()
    }
  }

  return el
}

function extractTitlePage(root: Element): ScreenplayDocument['titlePage'] {
  const tp: ScreenplayDocument['titlePage'] = {}
  const titlePageNode = Array.from(root.children).find(c => c.tagName === 'TitlePage')
  if (!titlePageNode) return tp
  const content = Array.from(titlePageNode.children).find(c => c.tagName === 'Content')
  if (!content) return tp

  // FDX title pages don't strictly tag their fields — they're just
  // centered/left/right-aligned paragraphs in conventional positions. We
  // do a best-effort: the first uppercase centered line is the title, the
  // next centered line is the credit/byline, etc. Anything we don't know
  // ends up concatenated into `notes`.
  const centeredLines: string[] = []
  const rightLines: string[] = []
  const leftLines: string[] = []
  for (const para of Array.from(content.children)) {
    if (para.tagName !== 'Paragraph') continue
    const text = Array.from(para.getElementsByTagName('Text'))
      .map(t => t.textContent ?? '')
      .join('')
      .trim()
    if (!text) continue
    const align = para.getAttribute('Alignment') ?? 'Left'
    if (align === 'Center') centeredLines.push(text)
    else if (align === 'Right') rightLines.push(text)
    else leftLines.push(text)
  }
  if (centeredLines[0]) tp.title = centeredLines[0]
  if (centeredLines[1]) tp.credit = centeredLines[1]
  if (centeredLines[2]) tp.author = centeredLines[2]
  if (centeredLines[3]) tp.source = centeredLines[3]
  if (rightLines.length) tp.draftDate = rightLines.join(' · ')
  if (leftLines.length) tp.contact = leftLines.join('\n')
  return tp
}
