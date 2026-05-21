/**
 * File System Access API helpers + download/upload fallbacks.
 *
 * Native project bundle format:
 *
 *   .pagecraft  — a JSON file wrapping the entire Project plus optional
 *                 app-level settings (including the user's Anthropic API
 *                 key, when they opt in). Carries everything in the
 *                 project: Overview, Characters, Beats, Scene Cards,
 *                 Screenplay, References, Settings.
 *
 *   .pgcraft.json — the legacy bare-project file. Still readable for
 *                   backwards compatibility.
 */

import type { Project } from '@/types'
import type { AppSettings } from './db'

const BUNDLE_EXT = 'pagecraft'
const LEGACY_EXT = 'pgcraft.json'
const BUNDLE_KIND = 'pagecraft-bundle'
const BUNDLE_VERSION = 1

/** The everything-bundle file format. */
export interface ProjectBundle {
  kind: typeof BUNDLE_KIND
  version: number
  app: 'PageCraft'
  exportedAt: number
  /** The complete project document. */
  project: Project
  /** Optional embedded app-level settings (AI provider config, etc.). */
  settings?: BundledSettings
}

/**
 * Subset of AppSettings that travels with a project bundle. We don't ship
 * the recentProjects list or per-machine UI preferences.
 */
export interface BundledSettings {
  ai?: AppSettings['ai']
  customFormats?: AppSettings['customFormats']
}

/** Feature-detect the File System Access API. */
export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window
}

/** Project file handle cached for "Save" (vs Save As). */
let currentProjectHandle: FileSystemFileHandle | null = null

/* ============================================================================
 * Bundle export
 * ========================================================================= */

export interface ExportBundleOptions {
  /** When true, embed the user's AppSettings (including any Anthropic API key). */
  includeSettings?: boolean
  /** The settings to embed. Required when includeSettings is true. */
  settings?: AppSettings
}

/**
 * Export the WHOLE project (and optionally the AI/settings) to a single
 * .pagecraft file. This is the canonical "Save As" / "Export Project" path.
 */
export async function exportProjectBundle(
  project: Project,
  opts: ExportBundleOptions = {},
): Promise<void> {
  const bundle: ProjectBundle = {
    kind: BUNDLE_KIND,
    version: BUNDLE_VERSION,
    app: 'PageCraft',
    exportedAt: Date.now(),
    project,
  }

  if (opts.includeSettings && opts.settings) {
    bundle.settings = pickBundledSettings(opts.settings)
  }

  const data = JSON.stringify(bundle, null, 2)
  const filename = `${sanitize(project.title || 'Untitled')}.${BUNDLE_EXT}`
  if (supportsFileSystemAccess()) {
    // @ts-expect-error: standard, not always in lib.dom
    const handle: FileSystemFileHandle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: 'PageCraft Project Bundle',
          accept: { 'application/json': [`.${BUNDLE_EXT}`] },
        },
      ],
    })
    const writable = await handle.createWritable()
    await writable.write(data)
    await writable.close()
    currentProjectHandle = handle
  } else {
    downloadBlob(data, filename, 'application/json')
  }
}

/**
 * Strip the AppSettings down to just the fields that should travel with a
 * project bundle (so we don't accidentally embed per-machine UI prefs,
 * recents list, etc.).
 */
function pickBundledSettings(settings: AppSettings): BundledSettings {
  const out: BundledSettings = {}
  if (settings.ai) out.ai = settings.ai
  if (settings.customFormats) out.customFormats = settings.customFormats
  return out
}

/* ============================================================================
 * Bundle import (also handles legacy bare-project files)
 * ========================================================================= */

export interface OpenedProject {
  project: Project
  /** Present when the file was a full bundle that carried settings. */
  settings?: BundledSettings
  handle?: FileSystemFileHandle
}

/**
 * Open a project file. Accepts:
 *   - .pagecraft        → full bundle (with optional settings).
 *   - .pgcraft.json     → legacy bare-project file.
 *   - any .json shape   → tries to recognize bundle vs bare project.
 *
 * Returns null on cancel or unrecognized file shape. Never throws — any
 * picker error falls back transparently to the file-input path so the
 * user only ever has to confirm the file once.
 */
export async function openProjectFile(): Promise<OpenedProject | null> {
  if (supportsFileSystemAccess()) {
    try {
      // @ts-expect-error: standard
      const [handle] = await window.showOpenFilePicker({
        // NOTE: multi-dot extensions (".pgcraft.json") are rejected by some
        // Chromium versions during accept-filter validation, which makes the
        // picker throw silently and force a second attempt. Stick to single-
        // dot extensions here; the JSON-shape detector below recognizes the
        // legacy bundle correctly via content.
        types: [
          {
            description: 'PageCraft Project',
            accept: { 'application/json': ['.pagecraft', '.json'] },
          },
        ],
        excludeAcceptAllOption: false,
        multiple: false,
      })
      const file = await handle.getFile()
      const text = await file.text()
      const opened = parseOpenedJSON(text)
      if (!opened) return null
      currentProjectHandle = handle
      return { ...opened, handle }
    } catch (e) {
      const err = e as Error
      // User dismissed the picker — treat as a no-op.
      if (err.name === 'AbortError') return null
      // The picker errored (invalid accept filter, permission denied,
      // sandboxed iframe, etc.) — fall back to the <input type="file">
      // path so the user gets a second chance via a working primitive
      // without having to click the button again.
      // eslint-disable-next-line no-console
      console.warn('[PageCraft] showOpenFilePicker failed, using fallback:', err)
      return openProjectFallback()
    }
  }
  return openProjectFallback()
}

/** Detect bundle vs bare-project shape. */
function parseOpenedJSON(text: string): { project: Project; settings?: BundledSettings } | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>
      // Full bundle.
      if (obj.kind === BUNDLE_KIND && obj.project) {
        return {
          project: obj.project as Project,
          settings: obj.settings as BundledSettings | undefined,
        }
      }
      // Bare project (legacy). Recognize by the presence of screenplay / format.
      if ('screenplay' in obj && 'format' in obj) {
        return { project: parsed as Project }
      }
    }
  } catch {
    /* fall through */
  }
  return null
}

async function openProjectFallback(): Promise<OpenedProject | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `.${BUNDLE_EXT},.${LEGACY_EXT},.json,application/json`
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      const text = await f.text()
      const opened = parseOpenedJSON(text)
      resolve(opened)
    }
    input.click()
  })
}

/* ============================================================================
 * Save As / Save (project-only, legacy compatibility)
 * ========================================================================= */

/**
 * Legacy: write the bare Project (no settings) to disk. Equivalent to
 * `exportProjectBundle(project, { includeSettings: false })`, but uses
 * the bundle format so downstream "Open" handles it uniformly.
 */
export async function saveProjectAs(project: Project): Promise<void> {
  return exportProjectBundle(project, { includeSettings: false })
}

/** Re-save to the currently open handle, falling back to Save As. */
export async function saveProjectFile(project: Project): Promise<void> {
  if (!currentProjectHandle) {
    await saveProjectAs(project)
    return
  }
  const bundle: ProjectBundle = {
    kind: BUNDLE_KIND,
    version: BUNDLE_VERSION,
    app: 'PageCraft',
    exportedAt: Date.now(),
    project,
  }
  const data = JSON.stringify(bundle, null, 2)
  const writable = await currentProjectHandle.createWritable()
  await writable.write(data)
  await writable.close()
}

/** Generic export: write any string to disk. */
export async function exportText(opts: {
  text: string
  suggestedName: string
  description: string
  mimeType: string
  extensions: string[]
}): Promise<void> {
  if (supportsFileSystemAccess()) {
    // @ts-expect-error: showSaveFilePicker
    const handle: FileSystemFileHandle = await window.showSaveFilePicker({
      suggestedName: opts.suggestedName,
      types: [
        {
          description: opts.description,
          accept: { [opts.mimeType]: opts.extensions },
        },
      ],
    })
    const writable = await handle.createWritable()
    await writable.write(opts.text)
    await writable.close()
  } else {
    downloadBlob(opts.text, opts.suggestedName, opts.mimeType)
  }
}

/** Generic import: read a file the user picks. */
export async function importFile(opts?: { accept?: string }): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (opts?.accept) input.accept = opts.accept
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      const text = await f.text()
      resolve({ name: f.name, text })
    }
    input.click()
  })
}

function downloadBlob(data: string, filename: string, mime: string) {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 100)
}

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim() || 'Untitled'
}

export function clearProjectFileHandle() {
  currentProjectHandle = null
}
