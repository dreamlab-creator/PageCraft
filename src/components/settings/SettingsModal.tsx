import { useState } from 'react'
import { useLibraryStore, useProjectStore } from '@/store'
import { DEFAULT_MODELS } from '@/lib/ai/models'
import { callAnthropic } from '@/lib/ai/anthropic'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useLibraryStore(s => s.settings)
  const patch = useLibraryStore(s => s.patchSettings)
  const project = useProjectStore(s => s.project)
  const patchProject = useProjectStore(s => s.patchSettings)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'err'>('idle')
  const [testMsg, setTestMsg] = useState('')

  const ai = settings.ai
  const apiKey = ai.apiKey ?? ''

  // Defaults from registry.
  const creativeModel = ai.model || DEFAULT_MODELS.creative.id
  const balancedModel = (ai as any).balancedModel || DEFAULT_MODELS.balanced.id
  const fastModel = (ai as any).fastModel || DEFAULT_MODELS.fast.id

  const setModels = (creative: string, balanced: string, fast: string) => {
    patch({
      ai: {
        ...ai,
        provider: 'anthropic',
        model: creative,
        // Stash the other two on the ai settings object (typed loosely on purpose).
        ...({ balancedModel: balanced, fastModel: fast } as any),
      },
    })
  }

  const handleTestKey = async () => {
    if (!apiKey) {
      setTestStatus('err')
      setTestMsg('Enter your API key first.')
      return
    }
    setTestStatus('testing')
    setTestMsg('')
    try {
      const res = await callAnthropic({
        apiKey,
        model: DEFAULT_MODELS.fast.id,
        systemPrompt: 'You are a connectivity test. Reply with exactly the word: OK',
        messages: [{ role: 'user', content: 'Test.' }],
        maxTokens: 8,
        temperature: 0,
      })
      if (res.text.toUpperCase().includes('OK')) {
        setTestStatus('ok')
        setTestMsg(`Connected. Used ${res.model}.`)
      } else {
        setTestStatus('ok')
        setTestMsg(`Connected. Got: ${res.text.slice(0, 60)}`)
      }
    } catch (e) {
      setTestStatus('err')
      setTestMsg((e as Error).message)
    }
  }

  return (
    <div
      className="w-[640px] max-w-[94vw] max-h-[88vh] overflow-y-auto subtle-scrollbar border shadow-2xl"
      style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)' }}
    >
      <header className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-base font-semibold">Settings</h2>
        <button onClick={onClose} className="text-xs uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>Close</button>
      </header>
      <div className="space-y-4 px-5 py-4">

        <Section title="Anthropic API">
          <p className="text-xs italic" style={{ color: 'var(--fg-muted)' }}>
            PageCraft uses your Anthropic API key for all AI Assist actions. The key is stored locally on this device only.
            It is sent directly to api.anthropic.com when you trigger an AI action. Get a key at console.anthropic.com.
          </p>
          <Field label="API key">
            <input
              type="password"
              value={apiKey}
              onChange={e => patch({ ai: { ...ai, provider: 'anthropic', apiKey: e.target.value } })}
              className="input"
              placeholder="sk-ant-..."
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div className="flex items-center gap-3">
            <button onClick={handleTestKey} disabled={testStatus === 'testing'} className="btn-ghost text-xs">
              {testStatus === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
            {testStatus !== 'idle' && (
              <span
                className="text-xs"
                style={{ color: testStatus === 'ok' ? 'var(--ok)' : testStatus === 'err' ? 'var(--error)' : 'var(--fg-muted)' }}
              >
                {testStatus === 'ok' ? '✓ ' : testStatus === 'err' ? '✗ ' : ''}{testMsg}
              </span>
            )}
          </div>
        </Section>

        <Section title="Models">
          <p className="text-xs italic" style={{ color: 'var(--fg-muted)' }}>
            PageCraft routes different kinds of work to different models. Creative tier handles prose, dialogue, and
            character writing. Balanced tier handles outlines, beats, and analysis. Fast tier handles short fills.
          </p>
          <Field label="Creative tier (prose, dialogue, character bibles)">
            <input
              value={creativeModel}
              onChange={e => setModels(e.target.value, balancedModel, fastModel)}
              className="input"
              placeholder={DEFAULT_MODELS.creative.id}
            />
            <p className="mt-1 text-[11px] italic" style={{ color: 'var(--fg-muted)' }}>
              Default: {DEFAULT_MODELS.creative.id}
            </p>
          </Field>
          <Field label="Balanced tier (structure, beats, diagnostics)">
            <input
              value={balancedModel}
              onChange={e => setModels(creativeModel, e.target.value, fastModel)}
              className="input"
              placeholder={DEFAULT_MODELS.balanced.id}
            />
            <p className="mt-1 text-[11px] italic" style={{ color: 'var(--fg-muted)' }}>
              Default: {DEFAULT_MODELS.balanced.id}
            </p>
          </Field>
          <Field label="Fast tier (short fills, quick suggestions)">
            <input
              value={fastModel}
              onChange={e => setModels(creativeModel, balancedModel, e.target.value)}
              className="input"
              placeholder={DEFAULT_MODELS.fast.id}
            />
            <p className="mt-1 text-[11px] italic" style={{ color: 'var(--fg-muted)' }}>
              Default: {DEFAULT_MODELS.fast.id}
            </p>
          </Field>
        </Section>

        <Section title="Writing">
          <Toggle
            label="Typewriter mode (keep current line centered)"
            value={settings.typewriterMode}
            onChange={v => patch({ typewriterMode: v })}
          />
          <Toggle
            label="Fast dialogue (Enter after Dialogue → new Character)"
            value={settings.fastDialogue}
            onChange={v => patch({ fastDialogue: v })}
          />
          <Toggle
            label="Show status bar"
            value={settings.showStatusBar}
            onChange={v => patch({ showStatusBar: v })}
          />
        </Section>

        {project && (
          <Section title="This Project">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Humanization strictness">
                <select
                  value={project.settings.humanizationStrictness}
                  onChange={e => patchProject({ humanizationStrictness: e.target.value as any })}
                  className="select"
                >
                  <option value="strict">Strict</option>
                  <option value="standard">Standard</option>
                  <option value="lenient">Lenient</option>
                </select>
              </Field>
              <Field label="Autosave interval (ms)">
                <input
                  type="number"
                  value={project.settings.autosaveIntervalMs}
                  onChange={e => patchProject({ autosaveIntervalMs: +e.target.value })}
                  className="input"
                />
              </Field>
            </div>
            <Toggle
              label="Live diagnostics"
              value={project.settings.enableLiveDiagnostics}
              onChange={v => patchProject({ enableLiveDiagnostics: v })}
            />
            <Toggle
              label="Show structure lines"
              value={project.settings.showStructureLines}
              onChange={v => patchProject({ showStructureLines: v })}
            />
          </Section>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="field">{label}</label>
      {children}
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-sm">
      <span style={{ color: 'var(--fg)' }}>{label}</span>
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
    </label>
  )
}
