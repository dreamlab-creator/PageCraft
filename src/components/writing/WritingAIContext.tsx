/**
 * WritingAIContext — a single useAIAssist instance and drawer shared by
 * every AI affordance in Writing Mode (the toolbar, every block's gutter
 * menu, etc.). This avoids the "child component creates its own hook but
 * never mounts a drawer" footgun and guarantees the result-drawer always
 * appears wherever the user triggered the action from.
 */

import { createContext, useContext, type ReactNode } from 'react'
import { useAIAssist } from '@/hooks/useAIAssist'

type AIAssistHook = ReturnType<typeof useAIAssist>

const WritingAICtx = createContext<AIAssistHook | null>(null)

export function WritingAIProvider({ children }: { children: ReactNode }) {
  const ai = useAIAssist()
  return (
    <WritingAICtx.Provider value={ai}>
      {children}
      {ai.drawer}
    </WritingAICtx.Provider>
  )
}

export function useWritingAI(): AIAssistHook {
  const ctx = useContext(WritingAICtx)
  if (!ctx) {
    throw new Error('useWritingAI must be used inside <WritingAIProvider>')
  }
  return ctx
}
