/**
 * IndexedDB storage layer. Two stores:
 *   - projects: keyed by project id; the canonical autosave home.
 *   - library : a small index of all projects (id, title, format, timestamps)
 *               used to render the dashboard without loading every project.
 *
 * We use idb-keyval for a tiny dependency footprint, but with a custom
 * database name + per-store handles for organization.
 */

import { createStore, get, set, del, keys, values } from 'idb-keyval'
import type { Project, ProjectId } from '@/types'

const PROJECT_STORE = createStore('pagecraft-db', 'projects')
const LIBRARY_STORE = createStore('pagecraft-db', 'library')
const SETTINGS_STORE = createStore('pagecraft-db', 'settings')

export interface LibraryEntry {
  id: ProjectId
  title: string
  formatKind: string
  formatLabel: string
  createdAt: number
  updatedAt: number
  // Optional cover image (data URL) for the dashboard card.
  cover?: string
}

/** Save a project (writes both stores in a single conceptual operation). */
export async function saveProject(project: Project): Promise<void> {
  const updated: Project = { ...project, updatedAt: Date.now() }
  await set(updated.id, updated, PROJECT_STORE)
  const entry: LibraryEntry = {
    id: updated.id,
    title: updated.title,
    formatKind: updated.format.kind,
    formatLabel: updated.format.label,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  }
  await set(updated.id, entry, LIBRARY_STORE)
}

/** Load a project by id. */
export async function loadProject(id: ProjectId): Promise<Project | undefined> {
  return get(id, PROJECT_STORE)
}

/** Delete a project. */
export async function deleteProject(id: ProjectId): Promise<void> {
  await del(id, PROJECT_STORE)
  await del(id, LIBRARY_STORE)
}

/** List all library entries (for the dashboard). */
export async function listLibrary(): Promise<LibraryEntry[]> {
  const entries = (await values(LIBRARY_STORE)) as LibraryEntry[]
  return entries.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** List all project ids. */
export async function listProjectIds(): Promise<ProjectId[]> {
  const ks = (await keys(PROJECT_STORE)) as ProjectId[]
  return ks
}

/** Settings (app-wide, not per-project). */
export interface AppSettings {
  recentProjects: ProjectId[]
  ai: {
    provider: 'openai' | 'anthropic' | 'local' | 'none'
    apiKey?: string
    /** The "creative" tier model id (Opus). */
    model?: string
    /** The "balanced" tier model id (Sonnet). */
    balancedModel?: string
    /** The "fast" tier model id (Haiku). */
    fastModel?: string
  }
  appearance: 'system' | 'day' | 'night' | 'midnight'
  typewriterMode: boolean
  focusMode: boolean
  showStatusBar: boolean
  /** Last-used elements transition tweak (dialogue → character vs action). */
  fastDialogue: boolean
  /** Custom format presets the user has saved. */
  customFormats: Array<{ id: string; label: string; description: string; configJson: string }>
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  recentProjects: [],
  ai: { provider: 'none' },
  appearance: 'system',
  typewriterMode: false,
  focusMode: false,
  showStatusBar: true,
  fastDialogue: false,
  customFormats: [],
}

export async function loadAppSettings(): Promise<AppSettings> {
  const s = (await get('app', SETTINGS_STORE)) as AppSettings | undefined
  return { ...DEFAULT_APP_SETTINGS, ...(s ?? {}) }
}

export async function saveAppSettings(s: AppSettings): Promise<void> {
  await set('app', s, SETTINGS_STORE)
}
