import { useEffect, useRef, useState } from 'react'
import { useProjectStore, useUIStore } from '@/store'
import type { Character, CharacterId, CharacterRole } from '@/types'
import { blankCharacterState, blankVoiceFingerprint, newId } from '@/types'
import { useAIAssist } from '@/hooks/useAIAssist'
import {
  buildCastFromPlanning,
  fillCharacterFields,
  suggestCharacterField,
  type CharacterFieldKey,
} from '@/lib/ai'
import { AIAssistButton } from '@/components/ai/AIAssistButton'
import { TakeItFromHereButton } from '@/components/ai/TakeItFromHereButton'
import { SectionConfirmBar } from '@/components/ai/SectionConfirmBar'

const ROLES: CharacterRole[] = [
  'protagonist',
  'antagonist',
  'love_interest',
  'ally',
  'foil',
  'mentor',
  'tempter',
  'ghost',
  'supporting',
  'minor',
  'ensemble',
]

export function CharactersPanel() {
  const project = useProjectStore(s => s.project)
  const upsert = useProjectStore(s => s.upsertCharacter)
  const remove = useProjectStore(s => s.removeCharacter)
  const planningFocus = useUIStore(s => s.planningFocus)
  const consumePlanningFocus = useUIStore(s => s.consumePlanningFocus)
  const [selectedId, setSelectedId] = useState<CharacterId | null>(null)
  const { runDirect, drawer } = useAIAssist()
  const [genBusy, setGenBusy] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Consume cross-section navigation: when the user arrived here via a
  // "focus this character" request (e.g., from the writing-mode Cast
  // banner), select that character and scroll the list to it once.
  useEffect(() => {
    if (!project) return
    if (planningFocus?.kind !== 'character') return
    const target = project.characters.find(c => c.id === planningFocus.id)
    if (!target) {
      consumePlanningFocus()
      return
    }
    setSelectedId(target.id)
    // Scroll the list entry into view.
    requestAnimationFrame(() => {
      const node = listRef.current?.querySelector<HTMLElement>(`[data-character-id="${target.id}"]`)
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    consumePlanningFocus()
  }, [project, planningFocus, consumePlanningFocus])

  if (!project) return null

  const selected = project.characters.find(c => c.id === selectedId) ?? null
  const locked = project.planning.confirmations.characters

  const newCharacter = (): Character => ({
    id: newId<CharacterId>(),
    name: 'NEW CHARACTER',
    age: '',
    shortDescription: '',
    biography: '',
    role: 'supporting',
    externalGoal: '',
    internalNeed: '',
    wound: '',
    fear: '',
    flaw: '',
    secret: '',
    publicCost: '',
    privateCost: '',
    arcStart: '',
    arcEnd: '',
    arcTurn: '',
    relationships: [],
    voice: blankVoiceFingerprint(),
    state: blankCharacterState(),
    introduced: false,
    lockedFields: [],
  })

  const handleBuildCast = async () => {
    setGenBusy(true)
    setGenError(null)
    const res = await runDirect(
      (input) => buildCastFromPlanning(input),
      ({ characters }) => {
        for (const c of characters) upsert(c)
        // Auto-select the protagonist (or the first lead) so the user lands somewhere useful.
        const focus = characters.find(c => c.role === 'protagonist') ?? characters[0]
        if (focus) setSelectedId(focus.id)
      },
    )
    setGenBusy(false)
    if (!res.ok) setGenError(res.error ?? 'Unknown error.')
  }


  return (
    <div className="flex h-full">
      <aside
        className="w-72 shrink-0 overflow-y-auto border-r"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
            Cast
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (locked) return
                const c = newCharacter()
                upsert(c)
                setSelectedId(c.id)
              }}
              disabled={locked}
              className="text-xs uppercase tracking-widest hover:underline disabled:opacity-50"
              style={{ color: 'var(--fg-soft)' }}
            >
              + Add
            </button>
          </div>
        </div>
        <div className="border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          <TakeItFromHereButton
            busy={genBusy}
            disabled={locked}
            onClick={handleBuildCast}
            title="Build the cast from the Overview"
          />
        </div>
        {genError && (
          <div className="border-b px-5 py-2 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--error)' }}>
            {genError}
          </div>
        )}
        <ul ref={listRef}>
          {project.characters.map(c => (
            <li key={c.id} data-character-id={c.id}>
              <button
                onClick={() => setSelectedId(c.id)}
                className="block w-full px-5 py-2 text-left"
                style={{
                  background: selectedId === c.id ? 'var(--bg-deep)' : 'transparent',
                  color: 'var(--fg)',
                  borderLeft: c.needsReview ? '2px solid var(--warning, #c89c4d)' : '2px solid transparent',
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{c.name}</span>
                  {c.needsReview && (
                    <span
                      className="rounded-sm px-1 py-0.5 text-[9px] uppercase tracking-widest"
                      style={{
                        color: 'var(--warning, #c89c4d)',
                        border: '1px solid var(--warning, #c89c4d)',
                      }}
                      title={`Auto-adopted from ${c.provenance === 'ai_scene' ? 'AI-drafted scene' : 'script'} — review to clear`}
                    >
                      new
                    </span>
                  )}
                </div>
                <div className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                  {c.age || '(age?)'} · {c.role.replace('_', ' ')}
                </div>
              </button>
            </li>
          ))}
          {project.characters.length === 0 && (
            <li className="px-5 py-4 text-xs" style={{ color: 'var(--fg-muted)' }}>
              No characters yet.
            </li>
          )}
        </ul>
      </aside>

      <section className="flex-1 overflow-y-auto subtle-scrollbar">
        {!selected ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-sm" style={{ color: 'var(--fg-muted)' }}>
            Select a character to edit, or use AI Generate to create one.
            <div className="max-w-md px-12 py-6">
              <SectionConfirmBar
                section="characters"
                readyHint={{ satisfied: project.characters.length, total: Math.max(2, project.characters.length), label: 'Characters' }}
              />
            </div>
          </div>
        ) : (
          <CharacterEditor
            key={selected.id}
            character={selected}
            locked={locked}
            onChange={upsert}
            onDelete={() => {
              if (confirm(`Delete "${selected.name}"?`)) {
                remove(selected.id)
                setSelectedId(null)
              }
            }}
          />
        )}
      </section>
      {drawer}
    </div>
  )
}

function CharacterEditor({
  character, locked, onChange, onDelete,
}: {
  character: Character
  locked: boolean
  onChange: (c: Character) => void
  onDelete: () => void
}) {
  const { runText, runDirect, drawer } = useAIAssist()
  const reviewCharacter = useProjectStore(s => s.reviewCharacter)
  const [fillBusy, setFillBusy] = useState(false)
  const [fillError, setFillError] = useState<string | null>(null)

  const update = <K extends keyof Character>(key: K, val: Character[K]) => {
    onChange({ ...character, [key]: val })
  }

  // The parent's runText drives the only drawer mounted on this editor (see
  // `{drawer}` at the bottom). Child fields share it so their AI Assist
  // clicks actually show up in the UI.

  const handleFillFields = async () => {
    setFillBusy(true)
    setFillError(null)
    const res = await runDirect(
      (input) => fillCharacterFields(input, character),
      (patch) => onChange({ ...character, ...patch }),
    )
    setFillBusy(false)
    if (!res.ok) setFillError(res.error ?? 'Unknown error.')
  }

  return (
    <div className={`mx-auto max-w-3xl px-8 py-6 ${locked ? 'opacity-90' : ''}`}>
      {character.needsReview && (
        <div
          className="mb-4 flex items-center justify-between border px-3 py-2 text-xs"
          style={{ borderColor: 'var(--warning, #c89c4d)', background: 'var(--bg-elev)' }}
        >
          <span style={{ color: 'var(--fg-soft)' }}>
            Auto-adopted from {character.provenance === 'ai_scene' ? 'an AI-drafted scene' : 'the script'}.
            Flesh out the fields below or click "Mark reviewed" to dismiss.
          </span>
          <button
            onClick={() => reviewCharacter(character.id)}
            className="rounded-sm border px-2 py-1 text-[11px] uppercase tracking-widest hover:opacity-80"
            style={{ borderColor: 'var(--border)', color: 'var(--fg)' }}
          >
            Mark reviewed
          </button>
        </div>
      )}
      <div className="mb-2 flex items-start justify-between">
        <div className="flex-1">
          <input
            value={character.name}
            disabled={locked}
            onChange={e => update('name', e.target.value.toUpperCase())}
            className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none"
            style={{ color: 'var(--fg)' }}
            placeholder="CHARACTER NAME"
          />
          <div className="mt-2 flex items-center gap-3">
            <input
              value={character.age}
              disabled={locked}
              onChange={e => update('age', e.target.value)}
              className="input max-w-[140px] text-xs"
              placeholder="Age (e.g., 30s)"
            />
            <select
              value={character.role}
              disabled={locked}
              onChange={e => update('role', e.target.value as CharacterRole)}
              className="select max-w-[180px] text-xs"
            >
              {ROLES.map(r => (
                <option key={r} value={r}>{r.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <AIAssistButton
            label="Fill empty fields"
            busy={fillBusy}
            disabled={locked}
            onClick={handleFillFields}
          />
          <button onClick={onDelete} disabled={locked} className="text-xs uppercase tracking-widest disabled:opacity-50 hover:underline" style={{ color: 'var(--fg-muted)' }}>
            Delete
          </button>
        </div>
      </div>
      {fillError && (
        <div className="mb-4 border px-3 py-2 text-xs" style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>
          {fillError}
        </div>
      )}

      <Section title="Profile">
        <FieldWithAI
          label="Script-page intro line (brief — used in the screenplay)"
          locked={locked}
          ai={
            <AIAssistButton
              label="Generate"
              compact
              disabled={locked}
              onClick={() => runText({
                label: `${character.name}: script intro line`,
                subtitle: 'Visual + behavioral, 4–12 words',
                task: input => suggestCharacterField(input, {
                  character,
                  field: 'shortDescription',
                  label: 'script-page intro line',
                }),
                onAccept: text => update('shortDescription', text),
              })}
            />
          }
        >
          <input
            value={character.shortDescription}
            disabled={locked}
            onChange={e => update('shortDescription', e.target.value)}
            className="input"
            placeholder='e.g. "sharp-eyed and sleep-deprived"'
          />
        </FieldWithAI>
        <FieldWithAI
          label="Full biography (the planning bible — deep, multi-paragraph)"
          locked={locked}
          ai={
            <AIAssistButton
              label="Generate"
              compact
              disabled={locked}
              onClick={() => runText({
                label: `${character.name}: biography`,
                subtitle: 'Full dossier: childhood, formative events, relationships, vices, secrets',
                task: input => suggestCharacterField(input, {
                  character,
                  field: 'biography',
                  label: 'biography',
                }),
                onAccept: text => update('biography', text),
              })}
            />
          }
        >
          <textarea
            value={character.biography}
            disabled={locked}
            onChange={e => update('biography', e.target.value)}
            className="textarea"
            rows={14}
            placeholder='Where they grew up, the defining childhood event, education, mentor figures, prior relationships, work history, vices, money, beliefs, a signature object, one thing they would never tell anyone, the lie they live by.'
          />
        </FieldWithAI>
      </Section>

      <Section title="Architecture: Want · Need · Wound">
        <ThreeField
          runText={runText}
          character={character}
          fieldKey="externalGoal"
          label="External goal (Want)"
          value={character.externalGoal}
          locked={locked}
          onChange={v => update('externalGoal', v)}
          placeholder='e.g. "To keep custody of her daughter."'
        />
        <ThreeField
          runText={runText}
          character={character}
          fieldKey="internalNeed"
          label="Internal need"
          value={character.internalNeed}
          locked={locked}
          onChange={v => update('internalNeed', v)}
          placeholder='e.g. "Stop interpreting care as control."'
        />
        <ThreeField
          runText={runText}
          character={character}
          fieldKey="wound"
          label="Wound / misbelief"
          value={character.wound}
          locked={locked}
          onChange={v => update('wound', v)}
          placeholder='e.g. "If I need anyone, they will own me."'
        />
        <div className="grid grid-cols-2 gap-4">
          <ThreeField runText={runText} character={character} fieldKey="flaw" label="Flaw" value={character.flaw} locked={locked} onChange={v => update('flaw', v)} />
          <ThreeField runText={runText} character={character} fieldKey="fear" label="Fear" value={character.fear} locked={locked} onChange={v => update('fear', v)} />
        </div>
        <ThreeField runText={runText} character={character} fieldKey="secret" label="Secret" value={character.secret} locked={locked} onChange={v => update('secret', v)} />
      </Section>

      <Section title="Stakes">
        <div className="grid grid-cols-2 gap-4">
          <ThreeField
            runText={runText}
            character={character}
            fieldKey="publicCost"
            label="Public cost (if they fail)"
            value={character.publicCost}
            locked={locked}
            onChange={v => update('publicCost', v)}
            longTextarea
          />
          <ThreeField
            runText={runText}
            character={character}
            fieldKey="privateCost"
            label="Private cost (if they fail)"
            value={character.privateCost}
            locked={locked}
            onChange={v => update('privateCost', v)}
            longTextarea
          />
        </div>
      </Section>

      <Section title="Arc">
        <div className="grid grid-cols-2 gap-4">
          <ThreeField
            runText={runText}
            character={character}
            fieldKey="arcStart"
            label="State at the start"
            value={character.arcStart}
            locked={locked}
            onChange={v => update('arcStart', v)}
            longTextarea
          />
          <ThreeField
            runText={runText}
            character={character}
            fieldKey="arcEnd"
            label="State at the end"
            value={character.arcEnd}
            locked={locked}
            onChange={v => update('arcEnd', v)}
            longTextarea
          />
        </div>
        <ThreeField
          runText={runText}
          character={character}
          fieldKey="arcTurn"
          label="Final choice (the behavior that proves they changed)"
          value={character.arcTurn}
          locked={locked}
          onChange={v => update('arcTurn', v)}
          longTextarea
        />
      </Section>

      <Section title="Voice Fingerprint">
        <div className="grid grid-cols-3 gap-4">
          <SelectField
            label="Sentence length"
            value={character.voice.sentenceLength}
            options={['staccato', 'short', 'medium', 'long', 'expansive', 'variable']}
            disabled={locked}
            onChange={v => update('voice', { ...character.voice, sentenceLength: v as any })}
          />
          <SelectField
            label="Vocabulary"
            value={character.voice.vocabulary}
            options={['street', 'casual', 'plainspoken', 'formal', 'literary', 'period', 'technical']}
            disabled={locked}
            onChange={v => update('voice', { ...character.voice, vocabulary: v as any })}
          />
          <SelectField
            label="Rhythm"
            value={character.voice.rhythm}
            options={['clipped', 'flowing', 'interrupted', 'rolling', 'measured', 'breathless']}
            disabled={locked}
            onChange={v => update('voice', { ...character.voice, rhythm: v as any })}
          />
          <SelectField
            label="Humor"
            value={character.voice.humor}
            options={['none', 'dry', 'absurd', 'self_deprecating', 'cruel', 'observational', 'situational', 'wordplay']}
            disabled={locked}
            onChange={v => update('voice', { ...character.voice, humor: v as any })}
          />
          <SelectField
            label="Restraint"
            value={character.voice.restraint}
            options={['closed', 'guarded', 'mixed', 'open', 'effusive']}
            disabled={locked}
            onChange={v => update('voice', { ...character.voice, restraint: v as any })}
          />
          <SelectField
            label="Contractions"
            value={character.voice.contractions}
            options={['almost_always', 'usually', 'sometimes', 'rarely', 'never']}
            disabled={locked}
            onChange={v => update('voice', { ...character.voice, contractions: v as any })}
          />
        </div>
        <FieldWithAI label="Verbal tics (one per line)" locked={locked}>
          <textarea
            value={character.voice.verbalTics.join('\n')}
            disabled={locked}
            onChange={e => update('voice', { ...character.voice, verbalTics: e.target.value.split('\n').filter(Boolean) })}
            className="textarea"
            rows={3}
          />
        </FieldWithAI>
        <FieldWithAI
          label="Voice notes (what makes them sound like them)"
          locked={locked}
          ai={
            <AIAssistButton
              label="Generate"
              compact
              disabled={locked}
              onClick={() => runText({
                label: `${character.name}: voice notes`,
                subtitle: 'Cadence, register, humor, restraint',
                task: input => suggestCharacterField(input, {
                  character,
                  field: 'voice.notes',
                  label: 'voice notes',
                }),
                onAccept: text => update('voice', { ...character.voice, notes: text }),
              })}
            />
          }
        >
          <textarea
            value={character.voice.notes}
            disabled={locked}
            onChange={e => update('voice', { ...character.voice, notes: e.target.value })}
            className="textarea"
            rows={3}
          />
        </FieldWithAI>
      </Section>

      <SectionConfirmBar section="characters" />
      {drawer}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10 border-t pt-6" style={{ borderColor: 'var(--border)' }}>
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
        {title}
      </h3>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function FieldWithAI({ label, locked: _locked, ai, children }: { label: string; locked: boolean; ai?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="field">{label}</label>
        {ai}
      </div>
      {children}
    </div>
  )
}

type RunTextFn = ReturnType<typeof useAIAssist>['runText']

/**
 * A single character-bible field with an AI Assist button wired to
 * `suggestCharacterField`, which is anchored to ONE character and given
 * explicit anti-cross-contamination context from the other characters.
 */
function ThreeField({
  runText, character, fieldKey, label, value, locked, onChange, placeholder, longTextarea,
}: {
  runText: RunTextFn
  /** The character this field belongs to. Required for AI to stay on-character. */
  character: Character
  /** Which character-bible field this is (drives the per-field prompt). */
  fieldKey: CharacterFieldKey
  label: string
  value: string
  locked: boolean
  onChange: (v: string) => void
  placeholder?: string
  longTextarea?: boolean
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="field">{label}</label>
        <AIAssistButton
          label="Generate"
          compact
          disabled={locked}
          onClick={() => runText({
            label: `${character.name}: ${label}`,
            task: input => suggestCharacterField(input, {
              character,
              field: fieldKey,
              label,
            }),
            onAccept: text => onChange(text),
          })}
        />
      </div>
      {longTextarea ? (
        <textarea value={value} disabled={locked} onChange={e => onChange(e.target.value)} className="textarea" rows={3} placeholder={placeholder} />
      ) : (
        <input value={value} disabled={locked} onChange={e => onChange(e.target.value)} className="input" placeholder={placeholder} />
      )}
    </div>
  )
}

function SelectField({ label, value, options, onChange, disabled }: { label: string; value: string; options: string[]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <label className="field">{label}</label>
      <select value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className="select">
        {options.map(o => (
          <option key={o} value={o}>{o.replace('_', ' ')}</option>
        ))}
      </select>
    </div>
  )
}
