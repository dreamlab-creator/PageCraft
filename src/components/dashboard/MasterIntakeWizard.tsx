/**
 * Master Intake Wizard.
 *
 * Five-stage pipeline that turns writer-supplied source material into a
 * fully-populated project scaffold:
 *
 *   1. COMPOSE  — writer drops files + writes brief.
 *   2. READING  — every file parsed into normalized text (per-file ticks).
 *   3. THINKING — two small AI calls: classify intent, detect format.
 *   4. CONFIRM  — writer reviews / edits the AI's read.
 *   5. BUILDING — chunked synthesis, MANY small AI calls each ticking the
 *                 real progress bar forward:
 *                   a. ingestSourceChunk per chunk → merged digest
 *                   b. title + logline
 *                   c. short summary
 *                   d. long synopsis
 *                   e. themes + stakes
 *                   f. engine + world rules
 *                   g. foundational guidance + open questions
 *                   h. plan cast (names + roles only)
 *                   i. synthesize cast in batches of 2
 *
 * Every AI call carries an AbortSignal so Cancel actually cancels the
 * in-flight request, and progress is computed from weighted steps so
 * the bar reflects real work done rather than a CSS animation.
 */

import { useCallback, useRef, useState } from 'react'
import { useLibraryStore, useProjectStore, useUIStore } from '@/store'
import { createBlankProject } from '@/lib/storage/blank-project'
import { PRESETS, PRESET_LIST } from '@/lib/formats'
import {
  readMaterials,
  chunkMaterials,
  type IntakeMaterial,
} from '@/lib/intake/readers'
import {
  classifyIntakeIntent,
  detectFormatFromMaterials,
  ingestSourceChunk,
  mergeDigests,
  synthesizeTitleAndLogline,
  synthesizeShortSummary,
  synthesizeLongSynopsis,
  synthesizeThemesAndStakes,
  synthesizeEngineAndWorld,
  synthesizeFoundationalGuidance,
  planCastFromDigest,
  synthesizeCastBatch,
  type ClassifiedIntent,
  type FormatRecommendation,
  type IntakeIntent,
  type IntakeOverview,
  type SourceDigest,
} from '@/lib/ai/intake-tasks'
import { DEFAULT_MODELS, type ModelTier, type ModelConfig } from '@/lib/ai/models'
import type { Character, FormatKind, Reference, ReferenceId, ReferenceMode } from '@/types'
import { newId } from '@/types'

type Stage = 'compose' | 'reading' | 'thinking' | 'confirm' | 'building' | 'done' | 'error'

const INTENT_LABELS: Record<IntakeIntent, string> = {
  transform: 'Transform — keep the structure, swap the world',
  continue: 'Continue — scaffold the next material in an existing project',
  adapt: 'Adapt — turn this work in another medium into a screenplay',
  inspire: 'Inspire — use this material as foundation for a new project',
  unknown: 'Unclassified — the AI will infer',
}

const SUGGESTED_PROMPTS = [
  'Take this screenplay and turn Birds in Space into Dogs in the Forest. Keep every beat the same; just swap the world.',
  'Here\'s my show bible — outline season 2. Don\'t change anything already established.',
  'Adapt this novel into a 95-page feature drama. Compress the first three chapters into the opening sequence.',
  'These are my research notes on the 1972 break-in. Build me a feature drama in the All The President\'s Men register.',
]

/* ============================================================================
 * Build-stage progress weights
 *
 * The full BUILDING stage spans 0–100%. Each named sub-step claims a
 * weight; chunked steps subdivide their slice across sub-calls (one
 * tick per chunk / per batch). The wizard always shows the writer a
 * percentage AND the current sub-step label.
 * ========================================================================= */
const STEP_WEIGHTS = {
  ingest: 30,    // chunked across N source chunks
  logline: 5,
  shortSummary: 5,
  longSynopsis: 10,
  themesStakes: 7,
  engineWorld: 7,
  guidance: 6,
  castPlan: 5,
  castBuild: 25, // chunked across N character batches
} as const

const TOTAL_WEIGHT = Object.values(STEP_WEIGHTS).reduce((a, b) => a + b, 0)

/** Max characters per ingest chunk. Larger → fewer calls but slower each. */
const INGEST_CHUNK_CHARS = 14000
/** Characters per cast batch (smaller = more progress ticks, less truncation). */
const CAST_BATCH_SIZE = 2

export function MasterIntakeWizard({ onClose }: { onClose: () => void }) {
  const ai = useLibraryStore(s => s.settings.ai)
  const setProject = useProjectStore(s => s.setProject)
  const setMode = useUIStore(s => s.setMode)

  const modelOverrides: Partial<Record<ModelTier, ModelConfig>> = {
    creative: { ...DEFAULT_MODELS.creative, id: ai.model || DEFAULT_MODELS.creative.id },
    balanced: { ...DEFAULT_MODELS.balanced, id: ai.balancedModel || DEFAULT_MODELS.balanced.id },
    fast: { ...DEFAULT_MODELS.fast, id: ai.fastModel || DEFAULT_MODELS.fast.id },
  }

  const [stage, setStage] = useState<Stage>('compose')
  const [statusLine, setStatusLine] = useState('')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [stepStart, setStepStart] = useState<number>(0)
  // Tick counter exists purely to force a re-render every second during the
  // build stage so the per-step elapsed clock keeps moving. The value isn't read.
  const [, setTick] = useState(0)

  // Cancellation
  const abortRef = useRef<AbortController | null>(null)
  const cancelledRef = useRef(false)

  // Stage 1: compose inputs
  const [brief, setBrief] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])

  // Stage 2: parsed materials
  const [materials, setMaterials] = useState<IntakeMaterial[]>([])

  // Stage 3: AI's read
  const [intent, setIntent] = useState<ClassifiedIntent | null>(null)
  const [formatRec, setFormatRec] = useState<FormatRecommendation | null>(null)
  const [chosenFormatKind, setChosenFormatKind] = useState<FormatKind>('feature_drama')

  // Stage 4: writer's confirmed values
  const [confirmedIntentSummary, setConfirmedIntentSummary] = useState('')
  const [confirmedDirectives, setConfirmedDirectives] = useState('')

  // Stage 5: built artifacts (for the done screen)
  const [overview, setOverview] = useState<IntakeOverview | null>(null)
  const [characterCount, setCharacterCount] = useState(0)

  const hasApiKey = !!ai.apiKey
  const canStart = !!brief.trim() || pendingFiles.length > 0

  const handleFilesPicked = (files: FileList | File[]) => {
    const arr = Array.from(files)
    setPendingFiles(prev => [...prev, ...arr])
  }

  const handleRemoveFile = (idx: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== idx))
  }

  const handleCancel = () => {
    cancelledRef.current = true
    abortRef.current?.abort()
    onClose()
  }

  const runRead = useCallback(async () => {
    setStage('reading')
    setError(null)
    setProgress(0)
    setStatusLine('Reading source materials…')
    try {
      const out: IntakeMaterial[] = []
      const total = Math.max(1, pendingFiles.length)
      for (let i = 0; i < pendingFiles.length; i++) {
        const f = pendingFiles[i]
        setStatusLine(`Reading ${f.name} (${i + 1}/${pendingFiles.length})…`)
        setStepStart(Date.now())
        const m = await readMaterials([f])
        out.push(...m)
        // Tick AFTER each file completes so the bar reflects work done.
        setProgress(Math.round(((i + 1) / total) * 100))
      }
      setMaterials(out)
      return out
    } catch (e) {
      setError(`Could not read materials: ${(e as Error).message ?? 'unknown error'}`)
      setStage('error')
      return null
    }
  }, [pendingFiles])

  const runThink = useCallback(async (mats: IntakeMaterial[]) => {
    setStage('thinking')
    setError(null)
    setProgress(0)

    const abort = new AbortController()
    abortRef.current = abort

    const scaffold = createBlankProject({ title: 'Intake (working)', format: PRESETS.feature_drama })
    const input = {
      project: scaffold,
      apiKey: ai.apiKey ?? '',
      modelOverrides,
      signal: abort.signal,
    }

    // Two AI calls in this stage. Each one represents 50% of the bar.
    setStatusLine('Classifying your intent…')
    setStepStart(Date.now())
    const intentRes = await classifyIntakeIntent(input, { brief, materials: mats })
    if (!intentRes.ok) {
      setError(`Intent classification failed: ${intentRes.error}`)
      setStage('error')
      return
    }
    setIntent(intentRes.value)
    setConfirmedIntentSummary(intentRes.value.summary)
    setConfirmedDirectives(intentRes.value.directives.join('\n'))
    setProgress(50)

    setStatusLine('Choosing a screenplay format…')
    setStepStart(Date.now())
    const fmtRes = await detectFormatFromMaterials(input, {
      materials: mats,
      intent: intentRes.value,
      brief,
    })
    if (!fmtRes.ok) {
      setError(`Format detection failed: ${fmtRes.error}`)
      setStage('error')
      return
    }
    setFormatRec(fmtRes.value)
    setChosenFormatKind(fmtRes.value.presetKind)
    setProgress(100)

    setStage('confirm')
    setStatusLine('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.apiKey, brief])

  const handleStart = async () => {
    if (!hasApiKey) {
      setError('No Anthropic API key configured. Open Settings and add one before running intake.')
      setStage('error')
      return
    }
    cancelledRef.current = false
    // Run a re-render tick during reading + thinking so the elapsed-clock
    // updates every second. We clear the interval when we leave the busy
    // stages (confirm / done / error).
    const tickInterval = setInterval(() => setTick(n => n + 1), 1000)
    try {
      const mats = await runRead()
      if (!mats) return
      if (mats.length === 0 && !brief.trim()) {
        setError('Nothing to work with — upload at least one file or describe what you want.')
        setStage('error')
        return
      }
      await runThink(mats)
    } finally {
      clearInterval(tickInterval)
    }
  }

  const handleBuild = async () => {
    if (!intent || !formatRec) return
    setStage('building')
    setError(null)
    setProgress(0)
    setStatusLine('')

    cancelledRef.current = false
    const abort = new AbortController()
    abortRef.current = abort

    // Periodic re-render so the per-step elapsed clock keeps moving.
    const tickInterval = setInterval(() => setTick(n => n + 1), 1000)

    const chosenFormat = PRESETS[chosenFormatKind]
    const editedDirectives = confirmedDirectives.split('\n').map(d => d.trim()).filter(Boolean)
    const editedIntent: ClassifiedIntent = {
      ...intent,
      summary: confirmedIntentSummary.trim() || intent.summary,
      directives: editedDirectives,
    }

    // The working project we mutate as the pipeline progresses. We commit
    // to the global store only at the end so failures don't strand the
    // writer in a half-populated project.
    //
    // IMPORTANT: we do NOT attach the uploaded materials to
    // scaffold.references during synthesis — they're already in each
    // task prompt as a digest, and adding them to .references would
    // cause composeSystemPrompt() to inject the raw text a SECOND time,
    // doubling the prompt size and risking context-window overflow.
    // References are attached at the very end.
    const scaffold = createBlankProject({
      title: 'Intake (working)',
      format: chosenFormat,
    })

    const baseInput = {
      project: scaffold,
      apiKey: ai.apiKey ?? '',
      modelOverrides,
      signal: abort.signal,
    }

    let accumulated = 0
    const advance = (weight: number) => {
      accumulated += weight
      setProgress(Math.min(100, Math.round((accumulated / TOTAL_WEIGHT) * 100)))
    }

    const startStep = (label: string) => {
      setStatusLine(label)
      setStepStart(Date.now())
    }

    // Helper: fail the pipeline with a useful message and stop the clock.
    const fail = (msg: string) => {
      clearInterval(tickInterval)
      if (cancelledRef.current) {
        // Silent cancel — the wizard is already closing.
        return
      }
      setError(msg)
      setStage('error')
    }

    try {
      /* ----- Step A: Ingest the source material (chunked) -------------- */
      const chunks = chunkMaterials(materials, INGEST_CHUNK_CHARS)
      const digests: SourceDigest[] = []
      if (chunks.length === 0) {
        // No source files — still synthesize from the brief alone. Move on.
        advance(STEP_WEIGHTS.ingest)
      } else {
        const perChunkWeight = STEP_WEIGHTS.ingest / chunks.length
        for (let i = 0; i < chunks.length; i++) {
          if (cancelledRef.current) return
          const ch = chunks[i]
          startStep(`Studying ${ch.filename}${ch.total > 1 ? ` — chunk ${ch.index + 1} of ${ch.total}${ch.pageHint ? ` (${ch.pageHint})` : ''}` : ''}…`)
          const r = await ingestSourceChunk(baseInput, { chunk: ch, intent: editedIntent })
          if (!r.ok) {
            // Soft-fail per chunk — log and proceed. A single bad chunk
            // shouldn't kill the whole intake.
            // eslint-disable-next-line no-console
            console.warn(`[PageCraft intake] Chunk ${i + 1} ingest failed:`, r.error)
          } else {
            digests.push(r.value)
          }
          advance(perChunkWeight)
        }
      }
      const digest = mergeDigests(digests)

      const ctx = {
        digest,
        intent: editedIntent,
        brief,
        format: chosenFormat,
      }

      /* ----- Step B: Title + logline ----------------------------------- */
      if (cancelledRef.current) return
      startStep('Writing the logline…')
      const llRes = await synthesizeTitleAndLogline(baseInput, ctx)
      if (!llRes.ok) return fail(`Logline step failed: ${llRes.error}`)
      const { title, logline } = llRes.value
      advance(STEP_WEIGHTS.logline)

      /* ----- Step C: Short summary ------------------------------------- */
      if (cancelledRef.current) return
      startStep('Writing the short summary…')
      const ssRes = await synthesizeShortSummary(baseInput, { ...ctx, title, logline })
      if (!ssRes.ok) return fail(`Short summary step failed: ${ssRes.error}`)
      const { shortSummary } = ssRes.value
      advance(STEP_WEIGHTS.shortSummary)

      /* ----- Step D: Long synopsis ------------------------------------- */
      if (cancelledRef.current) return
      startStep('Writing the long synopsis…')
      const lsRes = await synthesizeLongSynopsis(baseInput, { ...ctx, title, logline, shortSummary })
      if (!lsRes.ok) return fail(`Long synopsis step failed: ${lsRes.error}`)
      const { longSynopsis } = lsRes.value
      advance(STEP_WEIGHTS.longSynopsis)

      /* ----- Step E: Themes + stakes ----------------------------------- */
      if (cancelledRef.current) return
      startStep('Setting themes and stakes…')
      const tsRes = await synthesizeThemesAndStakes(baseInput, { ...ctx, title, logline, shortSummary, longSynopsis })
      if (!tsRes.ok) return fail(`Themes / stakes step failed: ${tsRes.error}`)
      const themesStakes = tsRes.value
      advance(STEP_WEIGHTS.themesStakes)

      /* ----- Step F: Engine + world ------------------------------------ */
      if (cancelledRef.current) return
      startStep('Defining the story engine and world rules…')
      const ewRes = await synthesizeEngineAndWorld(baseInput, { ...ctx, title, logline, longSynopsis })
      if (!ewRes.ok) return fail(`Engine / world step failed: ${ewRes.error}`)
      const engineWorld = ewRes.value
      advance(STEP_WEIGHTS.engineWorld)

      /* ----- Step G: Foundational guidance + open questions ------------ */
      if (cancelledRef.current) return
      startStep('Composing foundational guidance…')
      const gRes = await synthesizeFoundationalGuidance(baseInput, { ...ctx, title, logline, shortSummary })
      if (!gRes.ok) return fail(`Foundational guidance step failed: ${gRes.error}`)
      const guidance = gRes.value
      advance(STEP_WEIGHTS.guidance)

      // Compose the full overview snapshot for the done-screen.
      const builtOverview: IntakeOverview = {
        title,
        logline,
        shortSummary,
        longSynopsis,
        themes: themesStakes.themes,
        themeQuestion: themesStakes.themeQuestion,
        externalStakes: themesStakes.externalStakes,
        internalStakes: themesStakes.internalStakes,
        storyEngine: engineWorld.storyEngine,
        centralDramaticQuestion: engineWorld.centralDramaticQuestion,
        worldRules: engineWorld.worldRules,
        foundationalGuidance: composeFoundationalGuidance(guidance.foundationalGuidance, editedIntent),
        openQuestions: guidance.openQuestions,
      }
      setOverview(builtOverview)

      // Commit the Overview into the working project NOW so a downstream
      // cast failure still leaves the writer with a usable project.
      if (builtOverview.title) scaffold.title = builtOverview.title
      scaffold.planning = {
        ...scaffold.planning,
        logline: builtOverview.logline,
        shortSummary: builtOverview.shortSummary,
        longSynopsis: builtOverview.longSynopsis,
        themes: builtOverview.themes,
        themeQuestion: builtOverview.themeQuestion,
        centralDramaticQuestion: builtOverview.centralDramaticQuestion,
        storyEngine: builtOverview.storyEngine,
        worldRules: builtOverview.worldRules,
        externalStakes: builtOverview.externalStakes,
        internalStakes: builtOverview.internalStakes,
        foundationalGuidance: builtOverview.foundationalGuidance,
      }

      // Open questions → continuityNotes (visible in Overview / available to AI).
      if (builtOverview.openQuestions.length) {
        const header = `Intake — open questions (review before generating beats):\n${builtOverview.openQuestions.map(q => `  • ${q}`).join('\n')}`
        scaffold.planning.continuityNotes = scaffold.planning.continuityNotes
          ? `${header}\n\n---\n${scaffold.planning.continuityNotes}`
          : header
      }

      /* ----- Step H: Plan the cast (names + roles only) ---------------- */
      if (cancelledRef.current) return
      startStep('Planning the cast…')
      const planRes = await planCastFromDigest(baseInput, { ...ctx, title, logline, shortSummary })
      if (!planRes.ok) {
        // Cast planning failed — commit overview and bail with a soft error.
        attachReferences(scaffold, materials, editedIntent)
        setProject(scaffold)
        setMode('planning')
        setError(`Overview is ready, but cast planning failed: ${planRes.error}. You can build the cast from the Characters panel.`)
        setCharacterCount(0)
        setStage('done')
        clearInterval(tickInterval)
        return
      }
      const seeds = planRes.value.seeds
      advance(STEP_WEIGHTS.castPlan)

      /* ----- Step I: Build cast bibles in batches of 2 ----------------- */
      const built: Character[] = []
      const existingNames: string[] = []
      const batches: Array<typeof seeds> = []
      for (let i = 0; i < seeds.length; i += CAST_BATCH_SIZE) {
        batches.push(seeds.slice(i, i + CAST_BATCH_SIZE))
      }
      const perBatchWeight = batches.length > 0 ? STEP_WEIGHTS.castBuild / batches.length : STEP_WEIGHTS.castBuild
      for (let bi = 0; bi < batches.length; bi++) {
        if (cancelledRef.current) break
        const batch = batches[bi]
        const names = batch.map(s => s.name).join(' & ')
        startStep(`Writing bibles for ${names}… (${bi + 1} of ${batches.length})`)
        const r = await synthesizeCastBatch(baseInput, {
          ...ctx,
          title,
          logline,
          shortSummary,
          seeds: batch,
          existingNames: [...existingNames],
        })
        if (!r.ok) {
          // eslint-disable-next-line no-console
          console.warn(`[PageCraft intake] Cast batch ${bi + 1} failed:`, r.error)
          // Continue to next batch — partial cast is better than no cast.
        } else {
          built.push(...r.value.characters)
          for (const c of r.value.characters) existingNames.push(c.name)
        }
        advance(perBatchWeight)
      }
      if (batches.length === 0) advance(STEP_WEIGHTS.castBuild)

      // Final attach: cast + uploaded materials → references.
      scaffold.characters = built
      attachReferences(scaffold, materials, editedIntent)

      setProject(scaffold)
      setMode('planning')
      setCharacterCount(built.length)
      setProgress(100)
      setStage('done')
      clearInterval(tickInterval)
    } catch (e) {
      clearInterval(tickInterval)
      if (cancelledRef.current) return
      const msg = (e as Error)?.message ?? 'unknown error'
      setError(`Unexpected failure during build: ${msg}`)
      setStage('error')
    }
  }

  const elapsedForStep = stage === 'building' && stepStart > 0
    ? Math.floor((Date.now() - stepStart) / 1000)
    : 0

  return (
    <div
      className="flex w-[820px] max-w-[94vw] flex-col border shadow-2xl"
      style={{ background: 'var(--bg-elev)', borderColor: 'var(--border)', maxHeight: '90vh' }}
    >
      <header
        className="border-b px-5 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <h2 className="text-base font-semibold tracking-tight" style={{ color: 'var(--fg)' }}>
          Intake from Source Material
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
          Drop in anything you have — a finished screenplay, a show bible, a treatment, research, notes — and tell PageCraft what you want done with it.
          PageCraft reads everything, picks the screenplay format, and builds the Overview and Cast for you. Beats and scenes stay yours.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto subtle-scrollbar px-5 py-4">
        {stage === 'compose' && (
          <ComposeStage
            brief={brief}
            setBrief={setBrief}
            files={pendingFiles}
            onAddFiles={handleFilesPicked}
            onRemoveFile={handleRemoveFile}
            hasApiKey={hasApiKey}
          />
        )}

        {stage === 'reading' && (
          <BusyStage
            headline="Reading your source materials"
            statusLine={statusLine}
            progress={progress}
            elapsedSec={elapsedForStep}
            files={pendingFiles.map(f => f.name)}
          />
        )}

        {stage === 'thinking' && (
          <BusyStage
            headline="Reading your brief and choosing a format"
            statusLine={statusLine}
            progress={progress}
            elapsedSec={elapsedForStep}
            files={materials.map(m => m.filename)}
          />
        )}

        {stage === 'building' && (
          <BusyStage
            headline="Building your project"
            statusLine={statusLine}
            progress={progress}
            elapsedSec={elapsedForStep}
            files={materials.map(m => m.filename)}
          />
        )}

        {stage === 'confirm' && intent && formatRec && (
          <ConfirmStage
            intent={intent}
            formatRec={formatRec}
            materials={materials}
            confirmedIntentSummary={confirmedIntentSummary}
            setConfirmedIntentSummary={setConfirmedIntentSummary}
            confirmedDirectives={confirmedDirectives}
            setConfirmedDirectives={setConfirmedDirectives}
            chosenFormatKind={chosenFormatKind}
            setChosenFormatKind={setChosenFormatKind}
          />
        )}

        {stage === 'done' && overview && (
          <DoneStage
            overview={overview}
            characterCount={characterCount}
            materialCount={materials.length}
          />
        )}

        {stage === 'error' && (
          <div className="border px-4 py-4 text-sm" style={{ borderColor: 'var(--error)', color: 'var(--error)' }}>
            <strong>Something went wrong.</strong>
            <p className="mt-1 leading-relaxed">{error}</p>
          </div>
        )}
      </div>

      <footer
        className="flex items-center justify-end gap-2 border-t px-5 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        {stage === 'compose' && (
          <>
            <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
            <button
              onClick={handleStart}
              disabled={!canStart || !hasApiKey}
              className="btn-accent text-sm disabled:opacity-50"
            >
              Read materials
            </button>
          </>
        )}
        {(stage === 'reading' || stage === 'thinking' || stage === 'building') && (
          <button onClick={handleCancel} className="btn-ghost text-sm">
            Cancel
          </button>
        )}
        {stage === 'confirm' && (
          <>
            <button onClick={() => setStage('compose')} className="btn-ghost text-sm">Back</button>
            <button onClick={handleBuild} className="btn-accent text-sm">Build Project</button>
          </>
        )}
        {stage === 'done' && (
          <button onClick={onClose} className="btn-accent text-sm">Open Planning</button>
        )}
        {stage === 'error' && (
          <>
            <button onClick={() => { setError(null); setStage('compose') }} className="btn-ghost text-sm">Back</button>
            <button onClick={onClose} className="btn-ghost text-sm">Close</button>
          </>
        )}
      </footer>
    </div>
  )
}

/* ============================================================================
 * Stage components
 * ========================================================================= */

function ComposeStage({
  brief, setBrief, files, onAddFiles, onRemoveFile, hasApiKey,
}: {
  brief: string
  setBrief: (s: string) => void
  files: File[]
  onAddFiles: (files: FileList | File[]) => void
  onRemoveFile: (idx: number) => void
  hasApiKey: boolean
}) {
  const [dragging, setDragging] = useState(false)

  return (
    <div className="space-y-5">
      {!hasApiKey && (
        <div className="border px-3 py-2 text-xs" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
          Master Intake runs entirely on the AI. Open Settings → AI and add your Anthropic API key before you start.
        </div>
      )}

      <div>
        <label className="field">What do you want PageCraft to do with this material?</label>
        <textarea
          value={brief}
          onChange={e => setBrief(e.target.value)}
          rows={5}
          className="textarea"
          placeholder={`e.g. "Take this screenplay and change Birds in Space to Dogs in the Forest" or "Here's my show bible — outline season 2"`}
        />
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {SUGGESTED_PROMPTS.map(p => (
            <button
              key={p}
              onClick={() => setBrief(p)}
              className="border px-2 py-1 text-[11px] hover:underline"
              style={{ borderColor: 'var(--border)', color: 'var(--fg-soft)' }}
              title="Use this suggestion"
            >
              {p.slice(0, 64)}{p.length > 64 ? '…' : ''}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="field">Source materials</label>
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault()
            setDragging(false)
            onAddFiles(e.dataTransfer.files)
          }}
          className="flex flex-col items-center justify-center border-2 border-dashed px-6 py-8 text-xs"
          style={{
            borderColor: dragging ? 'var(--fg)' : 'var(--border)',
            color: 'var(--fg-muted)',
            background: dragging ? 'var(--bg-deep)' : 'transparent',
          }}
        >
          <span className="mb-2">Drag &amp; drop one or more files here</span>
          <span className="mb-3 text-[11px] uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>or</span>
          <label className="cursor-pointer border px-3 py-1.5 text-xs uppercase tracking-widest" style={{ borderColor: 'var(--border)', color: 'var(--fg)' }}>
            Choose files
            <input
              type="file"
              multiple
              className="hidden"
              accept=".txt,.md,.fountain,.fdx,.json,.pagecraft,.pdf,.docx"
              onChange={e => {
                if (e.target.files) onAddFiles(e.target.files)
                e.currentTarget.value = ''
              }}
            />
          </label>
          <span className="mt-3 text-[11px] leading-snug" style={{ color: 'var(--fg-muted)' }}>
            Supported: TXT, MD, Fountain, FDX, PDF, DOCX, JSON, PageCraft bundle. Stored permanently with this project — the AI references them on every future generation.
          </span>
        </div>

        {files.length > 0 && (
          <ul className="mt-3 space-y-1">
            {files.map((f, i) => (
              <li
                key={i}
                className="flex items-center justify-between border px-3 py-1.5 text-xs"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-deep)' }}
              >
                <span>
                  <strong style={{ color: 'var(--fg)' }}>{f.name}</strong>
                  <span style={{ color: 'var(--fg-muted)' }}> · {prettyBytes(f.size)}</span>
                </span>
                <button
                  onClick={() => onRemoveFile(i)}
                  className="text-xs uppercase tracking-widest"
                  style={{ color: 'var(--fg-muted)' }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function BusyStage({
  headline, statusLine, progress, elapsedSec, files,
}: {
  headline: string
  statusLine: string
  /** 0–100 for real progress; null for an indeterminate state. */
  progress: number | null
  elapsedSec?: number
  files: string[]
}) {
  return (
    <div className="space-y-3 py-2">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>{headline}</h3>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>{statusLine || '…'}</p>
        <div className="flex items-baseline gap-3 text-[11px]" style={{ color: 'var(--fg-muted)' }}>
          {elapsedSec != null && elapsedSec > 0 && <span>{formatElapsed(elapsedSec)} on this step</span>}
          {progress != null && <span style={{ color: 'var(--fg)' }} className="font-semibold">{progress}%</span>}
        </div>
      </div>

      {progress == null ? (
        <div className="h-1 w-full overflow-hidden" style={{ background: 'var(--bg-deep)' }}>
          <div
            className="h-full"
            style={{
              background: 'var(--fg)',
              width: '40%',
              animation: 'pagecraft-progress 1.6s linear infinite',
            }}
          />
        </div>
      ) : (
        <div className="h-1 w-full overflow-hidden" style={{ background: 'var(--bg-deep)' }}>
          <div
            className="h-full transition-all duration-500 ease-out"
            style={{ background: 'var(--fg)', width: `${progress}%` }}
          />
        </div>
      )}
      <style>{`@keyframes pagecraft-progress { 0% { transform: translateX(-100%) } 100% { transform: translateX(250%) } }`}</style>

      {files.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs" style={{ color: 'var(--fg-muted)' }}>
          {files.map((n, i) => (
            <li key={i}>• {n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ConfirmStage({
  intent, formatRec, materials,
  confirmedIntentSummary, setConfirmedIntentSummary,
  confirmedDirectives, setConfirmedDirectives,
  chosenFormatKind, setChosenFormatKind,
}: {
  intent: ClassifiedIntent
  formatRec: FormatRecommendation
  materials: IntakeMaterial[]
  confirmedIntentSummary: string
  setConfirmedIntentSummary: (s: string) => void
  confirmedDirectives: string
  setConfirmedDirectives: (s: string) => void
  chosenFormatKind: FormatKind
  setChosenFormatKind: (k: FormatKind) => void
}) {
  const totalChars = materials.reduce((acc, m) => acc + (m.text?.length ?? 0), 0)
  const totalPages = materials.reduce((acc, m) => acc + (m.pageCount ?? 0), 0)
  const warnings = materials.filter(m => m.warning)

  return (
    <div className="space-y-5">
      <section className="border px-3 py-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-deep)' }}>
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
          What PageCraft read
        </h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--fg)' }}>
          {materials.length} file{materials.length === 1 ? '' : 's'}, {prettyChars(totalChars)} of text{totalPages ? `, ${totalPages} PDF page${totalPages === 1 ? '' : 's'}` : ''}.
        </p>
        {warnings.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-xs" style={{ color: 'var(--warn)' }}>
            {warnings.map((m, i) => (
              <li key={i}>⚠ {m.filename}: {m.warning}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
          PageCraft&apos;s read of your intent
        </h3>
        <p className="mt-1 text-xs" style={{ color: 'var(--fg-muted)' }}>
          {INTENT_LABELS[intent.intent]} <span className="opacity-60">({intent.confidence} confidence)</span>
        </p>
        <label className="field mt-3">One-sentence summary (edit if it&apos;s off)</label>
        <textarea
          value={confirmedIntentSummary}
          onChange={e => setConfirmedIntentSummary(e.target.value)}
          rows={2}
          className="textarea"
        />
        <label className="field mt-3">Concrete directives (one per line — these are absolute, applied to every later AI call)</label>
        <textarea
          value={confirmedDirectives}
          onChange={e => setConfirmedDirectives(e.target.value)}
          rows={5}
          className="textarea"
          placeholder={`Target 90 pages\nLimit to 5 characters\nFound-footage subgenre`}
        />
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--fg-muted)' }}>
          PageCraft&apos;s format recommendation
        </h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--fg)' }}>
          <strong>{formatRec.label}</strong> <span style={{ color: 'var(--fg-muted)' }}>({formatRec.confidence} confidence)</span>
        </p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--fg-muted)' }}>{formatRec.reasoning}</p>
        {formatRec.alternatives.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs" style={{ color: 'var(--fg-muted)' }}>
            {formatRec.alternatives.map((a, i) => (
              <li key={i}>or <strong>{a.label}</strong> — {a.rationale}</li>
            ))}
          </ul>
        )}
        <label className="field mt-3">Adjust if needed</label>
        <select
          value={chosenFormatKind}
          onChange={e => setChosenFormatKind(e.target.value as FormatKind)}
          className="input"
        >
          {PRESET_LIST.map(p => (
            <option key={p.kind} value={p.kind}>{p.label}</option>
          ))}
        </select>
      </section>
    </div>
  )
}

function DoneStage({
  overview, characterCount, materialCount,
}: {
  overview: IntakeOverview
  characterCount: number
  materialCount: number
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--fg)' }}>Project ready.</h3>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
        PageCraft built {overview.title ? <strong style={{ color: 'var(--fg)' }}>{overview.title}</strong> : 'your project'} from {materialCount} source file{materialCount === 1 ? '' : 's'}.
        Overview is populated. {characterCount} character{characterCount === 1 ? '' : 's'} added.
        Your uploaded materials live in the Sources panel — every future AI call sees them as canon.
      </p>
      {overview.openQuestions.length > 0 && (
        <div className="border px-3 py-2 text-xs" style={{ borderColor: 'var(--border)', background: 'var(--bg-deep)' }}>
          <strong style={{ color: 'var(--fg)' }}>{overview.openQuestions.length} open question{overview.openQuestions.length === 1 ? '' : 's'}</strong>
          <p className="mt-1" style={{ color: 'var(--fg-muted)' }}>
            PageCraft guessed at a few details. You&apos;ll find them at the top of your continuity notes — review and confirm before generating beats.
          </p>
        </div>
      )}
    </div>
  )
}

/* ============================================================================
 * Utilities
 * ========================================================================= */

function referenceModeForIntent(i: IntakeIntent): ReferenceMode {
  switch (i) {
    case 'transform': return 'content_source'
    case 'continue':  return 'canon'
    case 'adapt':     return 'content_source'
    case 'inspire':   return 'extraction'
    default:          return 'extraction'
  }
}

function tagsForIntent(i: IntakeIntent) {
  switch (i) {
    case 'transform': return ['rewrite_source' as const, 'tone' as const]
    case 'continue':  return ['series_bible' as const, 'character_bible' as const, 'world_rules' as const]
    case 'adapt':     return ['rewrite_source' as const, 'tone' as const]
    case 'inspire':   return ['mood_board' as const]
    default:          return ['tone' as const]
  }
}

/** Attach uploaded materials to the project as Reference rows. */
function attachReferences(
  project: ReturnType<typeof createBlankProject>,
  materials: IntakeMaterial[],
  intent: ClassifiedIntent,
) {
  const refs: Reference[] = materials.map(m => ({
    id: newId<ReferenceId>(),
    filename: m.filename,
    format: m.format,
    raw: m.text,
    uploadedAt: Date.now(),
    intent: intent.summary,
    mode: referenceModeForIntent(intent.intent),
    scope: { kind: 'project' },
    tags: tagsForIntent(intent.intent),
    active: true,
    estimatedTokens: Math.ceil((m.text?.length ?? 0) / 4),
    ownedByUser: true,
  }))
  project.references = refs
}

/**
 * Compose the project's foundationalGuidance string from (a) the AI-
 * synthesized guidance block and (b) the writer's directives. Dedupe
 * lines so we don't repeat the same constraint twice.
 */
function composeFoundationalGuidance(aiGuidance: string, intent: ClassifiedIntent): string {
  const lines: string[] = []
  if (aiGuidance.trim()) {
    lines.push(...aiGuidance.split(/\r?\n/).map(s => s.trim()).filter(Boolean))
  }
  for (const d of intent.directives) {
    if (!lines.some(l => l.toLowerCase() === d.toLowerCase())) lines.push(d)
  }
  return lines.join('\n')
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`
  return `${(n / (1024 * 1024)).toFixed(1)}MB`
}

function prettyChars(n: number): string {
  if (n < 1000) return `${n} chars`
  if (n < 1_000_000) return `${(n / 1000).toFixed(0)}K chars`
  return `${(n / (1_000_000)).toFixed(1)}M chars`
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}
