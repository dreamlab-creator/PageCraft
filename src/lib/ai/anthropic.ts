/**
 * Anthropic API adapter.
 *
 * Direct browser-to-Anthropic API calls using the user's API key. Key is
 * stored locally in app settings and never sent anywhere except to Anthropic.
 *
 * Uses the Messages API: https://docs.anthropic.com/en/api/messages
 *
 * All responses are sanitized through the humanization pipeline (em-dash
 * stripping, AI-tell scrubbing) before reaching the caller.
 */

import { deepStripEmDashes } from '@/lib/humanization'

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AnthropicCallOptions {
  apiKey: string
  model: string
  systemPrompt: string
  messages: AnthropicMessage[]
  maxTokens?: number
  temperature?: number
  /** Caller-provided abort signal. */
  signal?: AbortSignal
  /**
   * Hard timeout for the request, in milliseconds. After this elapses
   * the fetch is aborted and an AnthropicError with type='timeout' is
   * thrown. Callers can pass a longer value for heavy synthesis steps.
   * Default: 120000 (2 minutes) — comfortable for any single response
   * under ~8000 output tokens.
   */
  timeoutMs?: number
}

export interface AnthropicCallResult {
  text: string
  model: string
  inputTokens?: number
  outputTokens?: number
  stopReason?: string
}

export class AnthropicError extends Error {
  status: number
  type: string
  constructor(message: string, status: number, type = 'api_error') {
    super(message)
    this.status = status
    this.type = type
  }
}

/**
 * Per-request max-output-token ceilings for the models we route through.
 *
 * Anthropic's API rejects any request whose `max_tokens` exceeds the
 * model's documented per-response ceiling. When a task asks for a number
 * higher than this, we silently clamp here — better to truncate the
 * response and let the caller chunk-and-recover than to hard-error out
 * of the picker entirely. Defaults are conservative; the actual API
 * limits are higher and may grow over time.
 */
const MODEL_MAX_OUTPUT_TOKENS: Array<[RegExp, number]> = [
  [/sonnet/i,  64000],  // Sonnet 4.x supports up to 64K
  [/opus/i,    32000],  // Opus 4.x supports up to 32K
  [/haiku/i,    8192],  // Haiku 4.x conservative
]
const FALLBACK_MAX_OUTPUT_TOKENS = 8192

function clampMaxTokens(model: string, requested: number | undefined): number {
  const want = Math.max(256, requested ?? 2048)
  const ceiling = MODEL_MAX_OUTPUT_TOKENS.find(([rx]) => rx.test(model))?.[1] ?? FALLBACK_MAX_OUTPUT_TOKENS
  return Math.min(want, ceiling)
}

/**
 * Call the Anthropic Messages API and return the text response.
 *
 * Note: browser-side calls require the
 * `anthropic-dangerous-direct-browser-access` header. The user's key is
 * exposed in network requests by design — this is a desktop-quality app
 * where the user supplies their own key.
 */
export async function callAnthropic(opts: AnthropicCallOptions): Promise<AnthropicCallResult> {
  if (!opts.apiKey) {
    throw new AnthropicError('No API key configured. Add your Anthropic API key in Settings.', 401, 'missing_key')
  }

  const body = {
    model: opts.model,
    max_tokens: clampMaxTokens(opts.model, opts.maxTokens),
    temperature: opts.temperature ?? 0.7,
    system: opts.systemPrompt,
    messages: opts.messages,
  }

  // Compose the effective abort signal:
  //   - caller's signal (Cancel button), if provided
  //   - hard timeout signal (so a stalled connection eventually fails)
  // If either fires, the fetch aborts.
  const timeoutMs = opts.timeoutMs ?? 120000
  const timeoutController = new AbortController()
  const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs)
  const composedSignal = mergeAbortSignals(opts.signal, timeoutController.signal)

  let response: Response
  let timedOut = false
  try {
    response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: composedSignal,
    })
  } catch (err) {
    clearTimeout(timeoutHandle)
    // If the timeout fired, surface that specifically — a timeout looks
    // identical to a Cancel at the AbortError level otherwise.
    if (timeoutController.signal.aborted) {
      timedOut = true
      throw new AnthropicError(
        `Anthropic request exceeded ${Math.round(timeoutMs / 1000)}s timeout and was aborted. The model may be overloaded; retry in a moment.`,
        0,
        'timeout',
      )
    }
    if ((err as Error).name === 'AbortError') {
      throw new AnthropicError('Cancelled', 0, 'aborted')
    }
    throw new AnthropicError(
      `Network error calling Anthropic. Check your connection and that your API key is valid.\n${(err as Error).message}`,
      0,
      'network',
    )
  } finally {
    if (!timedOut) clearTimeout(timeoutHandle)
  }

  if (!response.ok) {
    let detail = ''
    try {
      const j = await response.json()
      detail = j?.error?.message ?? JSON.stringify(j)
    } catch {
      detail = await response.text().catch(() => '')
    }
    throw new AnthropicError(
      `Anthropic ${response.status}: ${detail || response.statusText}`,
      response.status,
      'api_error',
    )
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>
    model: string
    usage?: { input_tokens?: number; output_tokens?: number }
    stop_reason?: string
  }

  // Defense in depth: every content block's `text` should be a string. We
  // coerce defensively because some experimental Anthropic models have
  // returned unusual shapes in the past, and React happily renders an
  // object as "[object Object]" if it ever slips through.
  const text = (Array.isArray(data.content) ? data.content : [])
    .filter(b => b && b.type === 'text')
    .map(b => {
      const t = (b as any).text
      if (typeof t === 'string') return t
      if (t == null) return ''
      if (Array.isArray(t)) return t.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join('')
      if (typeof t === 'object') return (t as any).text ?? (t as any).value ?? JSON.stringify(t)
      return String(t)
    })
    .join('\n')

  // Humanization pass: strip em-dashes from anything the model returned.
  const clean = deepStripEmDashes(text, 'ai_output')

  if (typeof clean !== 'string') {
    // Should never happen, but guard against returning a non-string.
    console.warn('[PageCraft AI] Non-string response from Anthropic:', clean, data)
  }

  return {
    text: typeof clean === 'string' ? clean : JSON.stringify(clean),
    model: data.model,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
    stopReason: data.stop_reason,
  }
}

/** Helper: lightweight one-shot completion. */
export async function completeWithSystem(opts: {
  apiKey: string
  model: string
  systemPrompt: string
  userPrompt: string
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<AnthropicCallResult> {
  return callAnthropic({
    apiKey: opts.apiKey,
    model: opts.model,
    systemPrompt: opts.systemPrompt,
    messages: [{ role: 'user', content: opts.userPrompt }],
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
  })
}

/**
 * Compose multiple AbortSignals into one — if any source signal aborts,
 * the returned signal aborts. We don't have `AbortSignal.any()` in every
 * runtime we target, so we hand-roll it.
 */
function mergeAbortSignals(...sources: (AbortSignal | undefined)[]): AbortSignal {
  const ctrl = new AbortController()
  const valid = sources.filter((s): s is AbortSignal => !!s)
  for (const s of valid) {
    if (s.aborted) { ctrl.abort(); break }
    s.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  return ctrl.signal
}
