import { useState } from 'react'
import { useProjectStore } from '@/store'
import type { Reference, ReferenceId, ReferenceMode, ReferenceTag } from '@/types'
import { newId } from '@/types'
import { readMaterials } from '@/lib/intake/readers'

const TAG_OPTIONS: ReferenceTag[] = [
  'dialogue', 'tone', 'pacing', 'voice', 'rewrite_source', 'outline_source',
  'world_rules', 'character_bible', 'series_bible', 'mood_board', 'treatment',
  'beat_sheet', 'pitch_deck',
]
const MODE_OPTIONS: ReferenceMode[] = ['style', 'structure', 'content_source', 'canon', 'extraction', 'mixed']

export function ReferencesPanel() {
  const project = useProjectStore(s => s.project)
  const add = useProjectStore(s => s.addReference)
  const update = useProjectStore(s => s.updateReference)
  const remove = useProjectStore(s => s.removeReference)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!project) return null

  // Upload supports every format intake supports — TXT, MD, Fountain, FDX,
  // PDF, DOCX, JSON. The same readers the Master Intake wizard uses are
  // invoked here so the writer can keep adding source material to a
  // project at any time (a new draft, a director\'s note, a research file)
  // without losing the format-coverage they got at intake time.
  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      const materials = await readMaterials(Array.from(files))
      for (const m of materials) {
        const ref: Reference = {
          id: newId<ReferenceId>(),
          filename: m.filename,
          format: m.format,
          raw: m.text,
          uploadedAt: Date.now(),
          intent: '',
          mode: 'extraction',
          scope: { kind: 'project' },
          tags: ['tone'],
          active: true,
          estimatedTokens: Math.ceil((m.text?.length ?? 0) / 4),
          ownedByUser: true,
        }
        add(ref)
        if (m.warning) {
          setError(prev => (prev ? prev + '\n' : '') + `⚠ ${m.filename}: ${m.warning}`)
        }
      }
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message ?? 'unknown error'}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
            Source Materials
          </h3>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--fg-muted)' }}>
            Scripts, bibles, treatments, notes. Every AI call in this project sees what lives here.
          </p>
        </div>
        <label className="cursor-pointer text-xs uppercase tracking-widest hover:underline" style={{ color: 'var(--fg-soft)' }}>
          {uploading ? 'Uploading…' : '+ Upload'}
          <input
            type="file"
            multiple
            className="hidden"
            accept=".txt,.md,.fountain,.fdx,.json,.pagecraft,.pdf,.docx"
            onChange={e => { void handleUpload(e.target.files); e.currentTarget.value = '' }}
          />
        </label>
      </header>
      {error && (
        <div className="border-b px-4 py-2 text-[11px] whitespace-pre-line" style={{ borderColor: 'var(--border)', color: 'var(--warn)' }}>
          {error}
        </div>
      )}
      <ul className="flex-1 overflow-y-auto subtle-scrollbar">
        {project.references.length === 0 && (
          <li className="px-4 py-4 text-xs" style={{ color: 'var(--fg-muted)' }}>
            Drop in a script, outline, show bible, treatment, or research file. PageCraft uses what lives here on every later AI call —
            as <em>canon</em>, <em>style reference</em>, or <em>content source</em> depending on the mode you set per file.
          </li>
        )}
        {project.references.map(r => (
          <li key={r.id} className="border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{r.filename}</span>
              <label className="flex cursor-pointer items-center gap-1 text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                <input
                  type="checkbox"
                  checked={r.active}
                  onChange={e => update(r.id, { active: e.target.checked })}
                />
                Active
              </label>
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
              {r.format} · ≈ {r.estimatedTokens.toLocaleString()} tokens
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <select
                value={r.mode}
                onChange={e => update(r.id, { mode: e.target.value as ReferenceMode })}
                className="select py-1 text-xs"
              >
                {MODE_OPTIONS.map(m => (
                  <option key={m} value={m}>{m.replace('_', ' ')}</option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-[10px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
                <input
                  type="checkbox"
                  checked={r.ownedByUser}
                  onChange={e => update(r.id, { ownedByUser: e.target.checked })}
                />
                I own this
              </label>
            </div>
            <textarea
              value={r.intent}
              onChange={e => update(r.id, { intent: e.target.value })}
              className="textarea mt-2 text-xs"
              rows={2}
              placeholder='Intent: e.g., "Use as dialogue style reference"'
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {TAG_OPTIONS.map(t => {
                const active = r.tags.includes(t)
                return (
                  <button
                    key={t}
                    onClick={() => update(r.id, { tags: active ? r.tags.filter(x => x !== t) : [...r.tags, t] })}
                    className="border px-1.5 py-0.5 text-[10px] uppercase tracking-widest"
                    style={{
                      background: active ? 'var(--fg)' : 'transparent',
                      color: active ? 'var(--bg)' : 'var(--fg-muted)',
                      borderColor: 'var(--border)',
                    }}
                  >
                    {t.replace('_', ' ')}
                  </button>
                )
              })}
            </div>
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => remove(r.id)}
                className="text-[10px] uppercase tracking-widest hover:underline"
                style={{ color: 'var(--fg-muted)' }}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
