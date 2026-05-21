/**
 * ExportScriptModal — export ONLY the screenplay (not the whole project).
 *
 * Formats:
 *   - PDF     — print-to-PDF via the browser dialog
 *   - FDX     — Final Draft import-ready XML
 *   - Fountain — plain-text industry-standard format
 *   - Plain text (.txt) — read-anywhere fallback
 *
 * Optional title page (industry-format): title, "Written by" credit,
 * author name, source / based on, draft label, date, contact block.
 * The page is rendered to a centered first page when PDF-exported; for
 * FDX it's emitted as a proper <TitlePage> block. Fountain export
 * embeds title-page key/value lines at the top of the file.
 */

import { useEffect, useState } from 'react'
import { useProjectStore, useUIStore } from '@/store'
import {
  exportText,
  printScreenplayPdf,
  type PdfTitlePage,
} from '@/lib/storage'
import { serializeFountain } from '@/lib/fountain'
import { serializeFDX, type FDXTitlePage } from '@/lib/fdx'

type ExportFormat = 'pdf' | 'fdx' | 'fountain' | 'txt'

interface TitleForm {
  enabled: boolean
  title: string
  credit: string
  author: string
  basedOn: string
  draftLabel: string
  date: string
  contactBlock: string
}

const INITIAL: TitleForm = {
  enabled: true,
  title: '',
  credit: 'Written by',
  author: '',
  basedOn: '',
  draftLabel: '',
  date: '',
  contactBlock: '',
}

export function ExportScriptModal() {
  const project = useProjectStore(s => s.project)
  const close = useUIStore(s => s.closeModal)
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [form, setForm] = useState<TitleForm>(INITIAL)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pre-fill from project title / author each time the modal opens.
  useEffect(() => {
    if (!project) return
    setForm(prev => ({
      ...prev,
      title: project.screenplay.titlePage.title ?? project.title ?? '',
      author: project.screenplay.titlePage.author ?? project.author ?? '',
      credit: project.screenplay.titlePage.credit ?? project.credit ?? 'Written by',
      basedOn: project.screenplay.titlePage.source ?? '',
      date: project.screenplay.titlePage.draftDate ?? '',
      contactBlock: project.screenplay.titlePage.contact ?? '',
    }))
  }, [project])

  if (!project) return null

  const updateForm = <K extends keyof TitleForm>(k: K, v: TitleForm[K]) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const titleForPdf = (): PdfTitlePage | undefined =>
    !form.enabled ? undefined : {
      title: form.title,
      credit: form.credit,
      author: form.author,
      basedOn: form.basedOn,
      draftLabel: form.draftLabel,
      date: form.date,
      contactBlock: form.contactBlock,
    }

  const titleForFdx = (): FDXTitlePage | undefined =>
    !form.enabled ? undefined : {
      title: form.title,
      credit: form.credit,
      author: form.author,
      source: form.basedOn,
      draftDate: [form.draftLabel, form.date].filter(Boolean).join(' · '),
      contact: form.contactBlock,
    }

  const titleForFountain = (): string => {
    if (!form.enabled) return ''
    const lines: string[] = []
    if (form.title) lines.push(`Title: ${form.title}`)
    if (form.credit) lines.push(`Credit: ${form.credit}`)
    if (form.author) lines.push(`Author: ${form.author}`)
    if (form.basedOn) lines.push(`Source: ${form.basedOn}`)
    if (form.draftLabel) lines.push(`Draft date: ${form.draftLabel}${form.date ? ` (${form.date})` : ''}`)
    else if (form.date) lines.push(`Draft date: ${form.date}`)
    if (form.contactBlock) {
      const contactLines = form.contactBlock.split('\n').map(l => l.trim()).filter(Boolean)
      if (contactLines.length > 0) lines.push(`Contact:`, ...contactLines.map(l => `\t${l}`))
    }
    return lines.length > 0 ? `${lines.join('\n')}\n\n` : ''
  }

  const baseFilename = () =>
    (form.title || project.title || 'screenplay').replace(/[^a-z0-9_\- ]/gi, '_').replace(/\s+/g, '_')

  const handleExport = async () => {
    setBusy(true); setError(null)
    try {
      if (format === 'pdf') {
        const ok = printScreenplayPdf({
          doc: project.screenplay,
          titlePage: titleForPdf(),
          documentTitle: form.title || project.title || 'Screenplay',
        })
        if (!ok) {
          setError('Could not open the print dialog. If your browser blocked the popup, allow it and try again.')
        } else {
          close()
        }
      } else if (format === 'fdx') {
        const xml = serializeFDX(project.screenplay, titleForFdx())
        await exportText({
          text: xml,
          suggestedName: `${baseFilename()}.fdx`,
          description: 'Final Draft (FDX)',
          mimeType: 'application/xml',
          extensions: ['.fdx'],
        })
        close()
      } else if (format === 'fountain') {
        const text = `${titleForFountain()}${serializeFountain(project.screenplay)}`
        await exportText({
          text,
          suggestedName: `${baseFilename()}.fountain`,
          description: 'Fountain',
          mimeType: 'text/plain',
          extensions: ['.fountain'],
        })
        close()
      } else if (format === 'txt') {
        const text = `${titleForFountain()}${serializeFountain(project.screenplay)}`
        await exportText({
          text,
          suggestedName: `${baseFilename()}.txt`,
          description: 'Plain text',
          mimeType: 'text/plain',
          extensions: ['.txt'],
        })
        close()
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        close()
      } else {
        setError((e as Error).message ?? 'Export failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-[600px] max-w-[94vw]" style={{ background: 'var(--bg-elev)' }}>
      <header className="border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Export script</h3>
      </header>

      <div className="space-y-4 px-5 py-4">
        <div>
          <label className="field">Format</label>
          <div className="flex flex-wrap gap-2">
            {FORMAT_OPTIONS.map(opt => (
              <button
                key={opt.kind}
                onClick={() => setFormat(opt.kind)}
                className="border px-3 py-2 text-left text-xs"
                style={{
                  borderColor: format === opt.kind ? 'var(--accent)' : 'var(--border)',
                  background: format === opt.kind ? 'var(--bg)' : 'var(--bg-elev)',
                  color: 'var(--fg)',
                  minWidth: 120,
                }}
              >
                <div className="font-semibold">{opt.label}</div>
                <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                  {opt.ext}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="border" style={{ borderColor: 'var(--border)' }}>
          <label className="flex items-center gap-2 border-b px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={e => updateForm('enabled', e.target.checked)}
            />
            <span style={{ color: 'var(--fg)' }}>Include a title page</span>
          </label>
          {form.enabled && (
            <div className="space-y-3 px-3 py-3">
              <Row label="Title">
                <input value={form.title} onChange={e => updateForm('title', e.target.value)} className="input text-sm" placeholder="SCREENPLAY TITLE" />
              </Row>
              <div className="grid grid-cols-2 gap-3">
                <Row label="Credit">
                  <input value={form.credit} onChange={e => updateForm('credit', e.target.value)} className="input text-sm" placeholder="Written by" />
                </Row>
                <Row label="Writer name">
                  <input value={form.author} onChange={e => updateForm('author', e.target.value)} className="input text-sm" placeholder="Jane Doe" />
                </Row>
              </div>
              <Row label="Based on (optional)">
                <input value={form.basedOn} onChange={e => updateForm('basedOn', e.target.value)} className="input text-sm" placeholder="Based on the novel by …" />
              </Row>
              <div className="grid grid-cols-2 gap-3">
                <Row label="Draft (optional)">
                  <input value={form.draftLabel} onChange={e => updateForm('draftLabel', e.target.value)} className="input text-sm" placeholder="First Draft" />
                </Row>
                <Row label="Date (optional)">
                  <input value={form.date} onChange={e => updateForm('date', e.target.value)} className="input text-sm" placeholder="May 2026" />
                </Row>
              </div>
              <Row label="Contact (optional, one per line)">
                <textarea
                  value={form.contactBlock}
                  onChange={e => updateForm('contactBlock', e.target.value)}
                  className="textarea text-sm"
                  rows={3}
                  placeholder={'Jane Doe\\njane@email.com\\n(555) 555-5555'}
                />
              </Row>
            </div>
          )}
        </div>

        {error && (
          <div className="border px-3 py-2 text-xs" style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>
            {error}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-end gap-3 border-t px-5 py-3" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={close}
          disabled={busy}
          className="text-xs uppercase tracking-widest disabled:opacity-50"
          style={{ color: 'var(--fg-muted)' }}
        >
          Cancel
        </button>
        <button
          onClick={handleExport}
          disabled={busy}
          className="btn-accent text-sm disabled:opacity-50"
        >
          {busy ? 'Exporting…' : format === 'pdf' ? 'Open print dialog' : 'Save file'}
        </button>
      </footer>
    </div>
  )
}

const FORMAT_OPTIONS: Array<{ kind: ExportFormat; label: string; ext: string }> = [
  { kind: 'pdf', label: 'PDF', ext: '.pdf' },
  { kind: 'fdx', label: 'Final Draft', ext: '.fdx' },
  { kind: 'fountain', label: 'Fountain', ext: '.fountain' },
  { kind: 'txt', label: 'Plain Text', ext: '.txt' },
]

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="field">{label}</label>
      {children}
    </div>
  )
}
