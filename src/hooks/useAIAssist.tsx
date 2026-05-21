/**
 * useAIAssist — single hook that powers every AI button in the app.
 *
 * Pattern:
 *   const { runText, runField, drawer } = useAIAssist()
 *   <AIAssistButton onClick={() => runText({
 *     label: 'Logline',
 *     task: input => generateLogline(input),
 *     onAccept: text => patchPlanning({ logline: text }),
 *   })} />
 *   {drawer}
 *
 * The drawer renders into the React tree once at the top level of the page.
 * It opens whenever runText/runField is invoked, populates with the AI's
 * result, and lets the user Accept / Regenerate / Edit.
 */

import { useCallback, useMemo, useState } from 'react'
import { useLibraryStore, useProjectStore } from '@/store'
import type {
  TaskInput,
  TaskOutcome,
} from '@/lib/ai/tasks'
import { DEFAULT_MODELS, type ModelTier, type ModelConfig } from '@/lib/ai/models'
import { AIResultDrawer } from '@/components/ai/AIResultDrawer'

interface RunTextArgs<T> {
  /** Title shown in the drawer. */
  label: string
  /** Subtitle (optional, e.g., field name). */
  subtitle?: string
  /** The task function. Receives a TaskInput and returns a TaskOutcome. */
  task: (input: TaskInput) => Promise<TaskOutcome<T>>
  /**
   * Convert the typed output to a display string. Defaults to smart coercion.
   * Note: deliberately NOT named "toString" — that would collide with the
   * built-in Object.prototype.toString on every plain options object.
   */
  format?: (v: T) => string
  /** Convert the (possibly user-edited) string back to a typed value before onAccept. */
  parse?: (s: string) => T
  /** Called with the accepted value. */
  onAccept: (value: T) => void
}

interface DrawerState {
  open: boolean
  title: string
  subtitle?: string
  result: string
  error: string | null
  regenerating: boolean
}

const INITIAL: DrawerState = {
  open: false, title: '', subtitle: undefined, result: '', error: null, regenerating: false,
}

export function useAIAssist() {
  const [state, setState] = useState<DrawerState>(INITIAL)
  const ai = useLibraryStore(s => s.settings.ai)
  const apiKey = ai.apiKey ?? ''
  const project = useProjectStore(s => s.project)

  // The last run, so we can regenerate.
  const [lastRun, setLastRun] = useState<{
    args: RunTextArgs<any>
  } | null>(null)

  /** Model overrides from the user's settings. */
  const modelOverrides = useMemo<Partial<Record<ModelTier, ModelConfig>>>(() => ({
    creative: { ...DEFAULT_MODELS.creative, id: ai.model || DEFAULT_MODELS.creative.id },
    balanced: { ...DEFAULT_MODELS.balanced, id: ai.balancedModel || DEFAULT_MODELS.balanced.id },
    fast: { ...DEFAULT_MODELS.fast, id: ai.fastModel || DEFAULT_MODELS.fast.id },
  }), [ai.model, ai.balancedModel, ai.fastModel])

  const buildInput = useCallback((nudge?: string): TaskInput | null => {
    if (!project) return null
    return { project, apiKey, signal: undefined, userNudge: nudge, modelOverrides }
  }, [project, apiKey, modelOverrides])

  /**
   * Run any task. Opens the drawer with the result.
   */
  const runText = useCallback(async <T,>(args: RunTextArgs<T>): Promise<void> => {
    const input = buildInput()
    if (!input) return
    setLastRun({ args })
    setState({ open: true, title: args.label, subtitle: args.subtitle, result: '', error: null, regenerating: true })
    const outcome = await args.task(input)
    if (outcome.ok) {
      const str = coerceToString(outcome.value, args.format)
      setState(s => ({ ...s, result: str, error: null, regenerating: false }))
    } else {
      setState(s => ({ ...s, regenerating: false, error: outcome.error }))
    }
  }, [buildInput])

  /**
   * Run a task and apply its result directly (no drawer). Useful for "Fill section"
   * actions where multiple fields are produced in one shot.
   *
   * Exception-safe: any thrown error in the task is converted into an error
   * result so the caller's "busy" state always resolves.
   */
  const runDirect = useCallback(async <T,>(
    task: (input: TaskInput) => Promise<TaskOutcome<T>>,
    onAccept: (value: T) => void,
  ): Promise<{ ok: boolean; error?: string }> => {
    const input = buildInput()
    if (!input) return { ok: false, error: 'No project loaded.' }
    try {
      const outcome = await task(input)
      if (outcome.ok) {
        try {
          onAccept(outcome.value)
        } catch (e) {
          return { ok: false, error: `Result handling failed: ${(e as Error).message ?? 'unknown error'}` }
        }
        return { ok: true }
      }
      return { ok: false, error: outcome.error }
    } catch (e) {
      return { ok: false, error: (e as Error).message ?? 'Unknown error.' }
    }
  }, [buildInput])

  const handleAccept = useCallback((text: string) => {
    if (!lastRun) { setState(INITIAL); return }
    const value = lastRun.args.parse ? lastRun.args.parse(text) : (text as any)
    lastRun.args.onAccept(value)
    setState(INITIAL)
  }, [lastRun])

  const handleCancel = useCallback(() => {
    setState(INITIAL)
  }, [])

  const handleRegenerate = useCallback(async (nudge: string) => {
    if (!lastRun) return
    const input = buildInput(nudge || undefined)
    if (!input) return
    setState(s => ({ ...s, error: null, regenerating: true }))
    const outcome = await lastRun.args.task(input)
    if (outcome.ok) {
      const str = coerceToString(outcome.value, lastRun.args.format)
      setState(s => ({ ...s, result: str, error: null, regenerating: false }))
    } else {
      setState(s => ({ ...s, regenerating: false, error: outcome.error }))
    }
  }, [lastRun, buildInput])

  const drawer = (
    <AIResultDrawer
      open={state.open}
      title={state.title}
      subtitle={state.subtitle}
      result={state.result}
      regenerating={state.regenerating}
      error={state.error}
      onAccept={handleAccept}
      onRegenerate={handleRegenerate}
      onCancel={handleCancel}
    />
  )

  return { runText, runDirect, drawer, hasApiKey: !!apiKey }
}

/**
 * Coerce a task value to a string for display in the drawer. Handles common
 * cases where the AI returns a wrapped object (e.g., { logline: "..." } or
 * { text: "..." } or [{...}]) by extracting the obvious string content.
 *
 * The `format` callback is the caller's explicit transformer when they have
 * a typed object they want to format their way.
 */
function coerceToString<T>(value: T, format?: (v: T) => string): string {
  if (format) return format(value)
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    // Array of strings → join with newlines.
    if (value.every(v => typeof v === 'string')) return value.join('\n')
    // Array of { label } / { text } / { value } objects → extract field.
    return value
      .map(v => {
        if (typeof v === 'string') return v
        if (v && typeof v === 'object') {
          const obj = v as any
          return obj.text ?? obj.value ?? obj.label ?? obj.content ?? JSON.stringify(obj)
        }
        return String(v)
      })
      .join('\n')
  }
  if (typeof value === 'object') {
    const obj = value as any
    // Single common single-string-field wrappers.
    if (typeof obj.text === 'string') return obj.text
    if (typeof obj.value === 'string') return obj.value
    if (typeof obj.content === 'string') return obj.content
    if (typeof obj.result === 'string') return obj.result
    if (typeof obj.output === 'string') return obj.output
    // Multi-field object → render as readable plain text.
    const lines: string[] = []
    for (const [k, v] of Object.entries(obj)) {
      if (v == null || v === '') continue
      if (Array.isArray(v) && v.every(x => typeof x === 'string')) {
        lines.push(`${k}:`)
        for (const item of v) lines.push(`  - ${item}`)
      } else if (typeof v === 'string') {
        lines.push(`${k}: ${v}`)
      } else {
        lines.push(`${k}: ${JSON.stringify(v)}`)
      }
    }
    return lines.join('\n')
  }
  return String(value)
}
