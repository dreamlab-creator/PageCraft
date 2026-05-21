import type { ReactNode } from 'react'
import { Titlebar } from './Titlebar'
import { StatusBar } from './StatusBar'
import { useUIStore, useLibraryStore } from '@/store'

export function AppShell({ children }: { children: ReactNode }) {
  const showStatus = useLibraryStore(s => s.settings.showStatusBar)
  const focusMode = useUIStore(s => s.focusMode)

  return (
    <div className="flex h-screen w-screen flex-col" style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
      {!focusMode && <Titlebar />}
      <div className="flex-1 overflow-hidden">{children}</div>
      {showStatus && !focusMode && <StatusBar />}
    </div>
  )
}
