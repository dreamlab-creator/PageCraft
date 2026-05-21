/**
 * UI Store — app-wide UI state. Mode (dashboard / planning / writing),
 * appearance (system / day / night / midnight), panels, modals, command
 * palette, focus state.
 */

import { create } from 'zustand'
import { useEffect, useState } from 'react'

export type AppMode = 'dashboard' | 'planning' | 'writing'
export type Appearance = 'system' | 'day' | 'night' | 'midnight'

/**
 * Cross-component navigation requests. Components elsewhere in the app
 * (e.g., the writing-mode Cast banner) can ask the UI to focus a specific
 * surface — a planning tab, a character row, a beat, a scene. The target
 * component reads this once, performs the focus, and clears the request.
 */
export type PlanningTab = 'overview' | 'series' | 'characters' | 'beats' | 'scenes' | 'theme' | 'vertical' | 'sources'

interface UIStore {
  mode: AppMode
  appearance: Appearance
  // Editor view modes (FD13-style).
  pageView: boolean             // Normal vs Page View
  speedView: boolean            // Speed View (raw, fastest typing)
  typewriterMode: boolean       // Auto-scroll keeping current line centered
  focusMode: boolean            // Distraction-free
  structureLines: boolean       // Visualize act/sequence boundaries

  // Side panels (writing mode).
  showBeatsPanel: boolean
  showNotesPanel: boolean
  showSceneNavigator: boolean
  showReferences: boolean
  showDiagnostics: boolean

  // Command palette.
  commandPaletteOpen: boolean
  commandPaletteQuery: string

  // Modal stack (one at a time).
  modal: { kind: 'new_project' | 'open_project' | 'settings' | 'export' | 'export_script' | 'modify' | 'pre_flight' | 'intake' | null }

  // Wizard state (for new project flow).
  wizardSelectedPreset?: string

  // Cross-section navigation: which Planning tab is active + an optional
  // focus target (character id, beat id, etc.). Consumed by PlanningMode
  // and individual panels on mount/update.
  planningTab: PlanningTab
  planningFocus?: {
    kind: 'character' | 'beat' | 'scene' | 'episode' | 'subplot'
    id: string
  }

  // Setters
  setMode: (m: AppMode) => void
  /**
   * Jump to a specific surface anywhere in the app in one call. Use this
   * when a chip / row / link wants to deep-link the user to a particular
   * planning tab AND a particular item within it.
   */
  navigateTo: (target: {
    mode?: AppMode
    planningTab?: PlanningTab
    focus?: UIStore['planningFocus']
  }) => void
  setPlanningTab: (t: PlanningTab) => void
  /** Called by a panel after it consumes the focus (single-shot). */
  consumePlanningFocus: () => void
  setAppearance: (a: Appearance) => void
  togglePageView: () => void
  toggleSpeedView: () => void
  toggleTypewriter: () => void
  toggleFocus: () => void
  toggleStructureLines: () => void
  togglePanel: (k: 'beats' | 'notes' | 'sceneNav' | 'references' | 'diagnostics') => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  setCommandPaletteQuery: (q: string) => void
  openModal: (kind: NonNullable<UIStore['modal']['kind']>) => void
  closeModal: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  mode: 'dashboard',
  // Boot always starts in Day mode so the launch state is deterministic
  // regardless of OS preference or any saved value. The user can still
  // cycle to Night / Midnight / System via the appearance button in the
  // titlebar; that change persists for the session.
  appearance: 'day',
  pageView: true,
  speedView: false,
  typewriterMode: false,
  focusMode: false,
  structureLines: true,

  showBeatsPanel: false,
  showNotesPanel: false,
  showSceneNavigator: true,
  showReferences: false,
  showDiagnostics: false,

  commandPaletteOpen: false,
  commandPaletteQuery: '',

  modal: { kind: null },

  planningTab: 'overview',
  planningFocus: undefined,

  setMode: (mode) => set({ mode }),
  navigateTo: (target) => set((s) => ({
    mode: target.mode ?? s.mode,
    planningTab: target.planningTab ?? s.planningTab,
    planningFocus: target.focus ?? s.planningFocus,
  })),
  setPlanningTab: (planningTab) => set({ planningTab }),
  consumePlanningFocus: () => set({ planningFocus: undefined }),
  setAppearance: (appearance) => {
    set({ appearance })
    applyAppearance(appearance)
  },
  togglePageView: () => set((s) => ({ pageView: !s.pageView, speedView: false })),
  toggleSpeedView: () => set((s) => ({ speedView: !s.speedView, pageView: false })),
  toggleTypewriter: () => set((s) => ({ typewriterMode: !s.typewriterMode })),
  toggleFocus: () => set((s) => ({ focusMode: !s.focusMode })),
  toggleStructureLines: () => set((s) => ({ structureLines: !s.structureLines })),
  togglePanel: (k) =>
    set((s) => {
      switch (k) {
        case 'beats':       return { showBeatsPanel: !s.showBeatsPanel }
        case 'notes':       return { showNotesPanel: !s.showNotesPanel }
        case 'sceneNav':    return { showSceneNavigator: !s.showSceneNavigator }
        case 'references':  return { showReferences: !s.showReferences }
        case 'diagnostics': return { showDiagnostics: !s.showDiagnostics }
      }
    }),
  openCommandPalette: () => set({ commandPaletteOpen: true, commandPaletteQuery: '' }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  setCommandPaletteQuery: (q) => set({ commandPaletteQuery: q }),
  openModal: (kind) => set({ modal: { kind } }),
  closeModal: () => set({ modal: { kind: null } }),
}))

function applyAppearance(a: Appearance) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.remove('theme-day', 'theme-night', 'theme-midnight')
  const resolved = a === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'midnight' : 'day')
    : a
  root.classList.add(`theme-${resolved}`)
  // Also bind to color-scheme for native form controls.
  root.style.colorScheme = resolved === 'day' ? 'light' : 'dark'
}

/**
 * Resolve the current "light vs dark" effective theme.
 *
 * The source of truth is the `theme-day` / `theme-night` / `theme-midnight`
 * class that `applyAppearance` writes onto `<html>`. By reading directly
 * from that class (rather than re-running `matchMedia` independently),
 * this hook can never drift from what the page actually looks like — even
 * if the OS preference flips between renders or system-resolution edge
 * cases (browser overrides, "auto" theme schedules, etc.) make `matchMedia`
 * report different values at different moments.
 *
 * A MutationObserver subscribes the hook to the html class so any change
 * triggers a re-render in components that depend on the theme (the
 * PageCraft logo's black/white variant is the first use case).
 */
export function useEffectiveTheme(): 'light' | 'dark' {
  // Tie a render to the html class. We also subscribe to the appearance
  // store so the hook re-renders when the user toggles appearance — that
  // covers the case where appearance changed but the MutationObserver
  // hasn't fired yet (e.g., first render after a setAppearance call).
  useUIStore(s => s.appearance)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => resolveTheme())

  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    // 1. Observe class changes on <html>. applyAppearance writes here.
    const observer = new MutationObserver(() => setTheme(resolveTheme()))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    // 2. Also subscribe to OS preference changes directly. When the
    //    appearance is 'system', a flip in OS theme triggers
    //    setAppearance('system') (re-applying the class) — but we listen
    //    here too so even if that handler ever lags, the hook updates.
    let mq: MediaQueryList | null = null
    let mqHandler: ((e: MediaQueryListEvent) => void) | null = null
    if (typeof window !== 'undefined' && window.matchMedia) {
      mq = window.matchMedia('(prefers-color-scheme: dark)')
      mqHandler = () => setTheme(resolveTheme())
      mq.addEventListener('change', mqHandler)
    }
    // Sync on mount in case the class was set after the initial render.
    setTheme(resolveTheme())
    return () => {
      observer.disconnect()
      if (mq && mqHandler) mq.removeEventListener('change', mqHandler)
    }
  }, [])

  return theme
}

/**
 * Resolve light/dark from the live html class. If for some reason no
 * theme class is present (e.g., before applyAppearance runs), fall back
 * to the user's OS preference.
 */
function resolveTheme(): 'light' | 'dark' {
  if (typeof document !== 'undefined') {
    const cls = document.documentElement.classList
    if (cls.contains('theme-day')) return 'light'
    if (cls.contains('theme-night') || cls.contains('theme-midnight')) return 'dark'
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}
