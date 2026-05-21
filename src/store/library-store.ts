/**
 * Library Store — the dashboard's project list and app-wide settings.
 */

import { create } from 'zustand'
import type { ProjectId } from '@/types'
import {
  listLibrary,
  deleteProject as deleteFromDb,
  loadAppSettings,
  saveAppSettings,
  type LibraryEntry,
  type AppSettings,
  DEFAULT_APP_SETTINGS,
} from '@/lib/storage'

interface LibraryStore {
  entries: LibraryEntry[]
  loading: boolean
  settings: AppSettings

  refresh: () => Promise<void>
  removeProject: (id: ProjectId) => Promise<void>

  loadSettings: () => Promise<void>
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>
  /**
   * Merge in app-level settings that came embedded in a project bundle on
   * import. Returns the fields that were actually applied (so the UI can
   * surface a "AI connected from bundle" toast or similar).
   */
  applyBundledSettings: (bundled: { ai?: AppSettings['ai']; customFormats?: AppSettings['customFormats'] }) => Promise<{ aiApplied: boolean; formatsAppliedCount: number }>
  pushRecent: (id: ProjectId) => Promise<void>
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  entries: [],
  loading: false,
  settings: DEFAULT_APP_SETTINGS,

  refresh: async () => {
    set({ loading: true })
    const entries = await listLibrary()
    set({ entries, loading: false })
  },

  removeProject: async (id) => {
    await deleteFromDb(id)
    await get().refresh()
  },

  loadSettings: async () => {
    const settings = await loadAppSettings()
    set({ settings })
  },

  patchSettings: async (patch) => {
    const next = { ...get().settings, ...patch }
    set({ settings: next })
    await saveAppSettings(next)
  },

  applyBundledSettings: async (bundled) => {
    const current = get().settings
    let aiApplied = false
    let formatsAppliedCount = 0
    const next: AppSettings = { ...current }

    // AI settings: when the bundle carries an `ai` block, treat it as the
    // user's intent — the file is meant to be self-contained and bring its
    // own AI configuration back online. The BUNDLE wins for any non-empty
    // field; existing local values fill in any gap the bundle omits.
    if (bundled.ai) {
      const incoming = bundled.ai
      const mergedAi: AppSettings['ai'] = {
        provider: incoming.provider || current.ai.provider,
        apiKey: incoming.apiKey || current.ai.apiKey || undefined,
        model: incoming.model || current.ai.model,
        balancedModel: incoming.balancedModel || current.ai.balancedModel,
        fastModel: incoming.fastModel || current.ai.fastModel,
      }
      // Determine whether anything actually changed.
      const changed =
        mergedAi.provider !== current.ai.provider
        || mergedAi.apiKey !== current.ai.apiKey
        || mergedAi.model !== current.ai.model
        || mergedAi.balancedModel !== current.ai.balancedModel
        || mergedAi.fastModel !== current.ai.fastModel
      next.ai = mergedAi
      aiApplied = changed
      // eslint-disable-next-line no-console
      console.info('[PageCraft] Bundle AI settings applied.', {
        hadKeyBefore: !!current.ai.apiKey,
        hasKeyAfter: !!mergedAi.apiKey,
        changed,
      })
    }

    // Custom formats: union by id, prefer existing when there's a clash.
    if (bundled.customFormats && bundled.customFormats.length > 0) {
      const existingIds = new Set(current.customFormats.map(f => f.id))
      const additions = bundled.customFormats.filter(f => !existingIds.has(f.id))
      if (additions.length > 0) {
        next.customFormats = [...current.customFormats, ...additions]
        formatsAppliedCount = additions.length
      }
    }

    if (aiApplied || formatsAppliedCount > 0) {
      set({ settings: next })
      await saveAppSettings(next)
    }
    return { aiApplied, formatsAppliedCount }
  },

  pushRecent: async (id) => {
    const s = get().settings
    const without = s.recentProjects.filter(x => x !== id)
    const next = [id, ...without].slice(0, 16)
    const updated = { ...s, recentProjects: next }
    set({ settings: updated })
    await saveAppSettings(updated)
  },
}))
