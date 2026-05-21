export * from './anthropic'
export * from './context'
export * from './models'
export * from './prompts'
export * from './tasks'

// Legacy provider stubs are deprecated in favor of the Anthropic adapter.
export {
  thinkAndDraft,
  getProvider,
  NULL_PROVIDER,
  type AIProvider,
  type AICompletionInput,
  type AICompletionOutput,
  type ProviderId,
} from './provider'
