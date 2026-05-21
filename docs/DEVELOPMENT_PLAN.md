# PageCraft Development Plan

The plan you asked for, in writing. It documents the architecture decisions, the craft principles encoded in the app, and the post-MVP roadmap.

## 1. Tech stack

- **Vite + React 18 + TypeScript** for the app surface
- **Tailwind CSS** for styling — used surgically for spacing and tokens, not chunky pre-fab components. Visual language stays neutral and serious.
- **Zustand** for state. Predictable, small surface, perfect for a screenplay document + UI state.
- **IndexedDB via idb-keyval** as the canonical local store, with the **File System Access API** for true on-disk save/load. Falls back to download/upload for non-supporting browsers.
- **Custom block-based editor.** Each screenplay paragraph is a focusable contenteditable block with a typed element. This gives us Final Draft 13-exact behavior on Tab/Enter routing, SmartType, and per-element formatting that a generic rich-text editor cannot match.
- **AI provider abstraction**, pluggable. OpenAI-compatible, Anthropic-compatible, and local-runtime adapters (post-MVP). User supplies their own key; nothing leaves the device except direct API calls.

## 2. App architecture

```
Project (single source of truth, lives in IndexedDB)
   ├── FormatConfig (preset or composed-from-NL)
   ├── ScreenplayDocument (ordered ScreenplayElement[])
   ├── Characters[] (with Want/Need/Wound + VoiceFingerprint + State)
   ├── Locations[]
   ├── PlanningData (logline, summary, themes, stakes, etc.)
   ├── Beats[] (with substance fields)
   ├── SceneCards[] (with McKee scene-turn)
   ├── SetupsPayoffs[] (the ledger)
   ├── KnowledgeGraph (facts, who-knows-what)
   ├── Notes[] (inline ScriptNotes)
   ├── References[] (with intent + scope + tags)
   ├── Versions[] (named history)
   ├── VerticalSeasonPlan? (only if format is vertical)
   └── ProjectSettings
```

## 3. Data model: every type is in `src/types/*.ts`

The branded ID types prevent cross-wiring (a `BeatId` can't be passed where a `CharacterId` is expected). Everything serializes to JSON cleanly for save/load.

## 4. Core screens & user flow

- **Dashboard** → list of projects, new-project wizard, open from file, import Fountain
- **Planning Mode** → Overview / Characters / Beat Board / Scene Cards / Themes & Stakes / Vertical Plan (when vertical)
- **Writing Mode** → Scene navigator left, screenplay page center, characters/beats/notes/diagnostics/references panels right
- **Command Palette (⌘K)** → anything you can do is accessible by typing what you want

## 5. Local save strategy

- Debounced autosave to IndexedDB every 2 seconds (configurable per-project)
- Manual Save (⌘S) writes through the current file handle if one is bound
- Save As / Open use the File System Access API where available
- Project file format is `.pgcraft.json` (JSON)
- Library entries (id, title, format, timestamps) are stored in a separate IndexedDB store for fast dashboard rendering

## 6. Import / Export

- **Fountain** — full Fountain 1.1 round-trip in `src/lib/fountain/{parse,serialize}.ts`
- **JSON** — native `.pgcraft.json` save/load
- **Plain text** — re-uses the Fountain serializer
- Post-MVP: FDX, PDF (proper pagination), DOCX

## 7. Screenplay formatting engine

- Courier Prime 12pt, monospaced
- Industry-standard margins: 1.5" left, 1.0" right, 1.0" top, 1.0" bottom
- Per-element indents calibrated to the Academy sample + Final Draft 13 user guide
- Multi-cam variant: ALL-CAPS action, double-spaced dialogue, underlined slugs, lettered scenes, SFX bold
- Pagination engine in `src/lib/screenplay/pagination.ts` — line-count approximation good enough for live status bar; pixel-perfect rendering is post-MVP

## 8. AI prompting strategy (anti-filler)

- A "hard rules" block included in every system prompt: no em dashes, no AI tells, no formal connectors, no interiority leak, character intros capped only on first appearance, scene-turn discipline.
- Format-specific block describing the project's structural targets.
- Vertical block (only injected for vertical-sandbox projects) that INVERTS the on-the-nose rule.
- Project context block: logline, theme, characters with Want/Need/Wound, world rules, hard constraints.
- The **Thinking Layer**: every AI request goes through pre-mortem → plan → draft → self-critique → revision before the user sees output.
- All output is sanitized by `deepStripEmDashes` and the humanization linter.

## 9. Research baseline

- Final Draft 13 user guide (read in full)
- Academy of Motion Picture Arts & Sciences screenplay format guide
- BBC Writersroom format guides
- WGF formatting primers (single-cam, multi-cam, hour drama variations)
- McKee's *Story* — scene-turn discipline
- Field's *Screenplay* — three-act paradigm, plot points, midpoint
- Save the Cat — 15-beat sheet, four-act variant
- Fountain 1.1 spec (fountain.io)
- The user's curated study set of produced scripts (read for tonal calibration only)
- The user's complete Vertical Screenwriting Guidelines (sandboxed)
- The user's Humanization Rules (em-dash zero tolerance, AI-tell scrubbing)

## 10. MVP feature list (shipped)

- Project creation (six presets + custom Format Interpreter)
- Planning Mode with all six panels
- Writing Mode with Final Draft 13-flavored editor
- Tab/Enter routing across all element types
- Cmd+1..9 element hotkeys
- SmartType auto-complete (locations, characters, transitions, scene intros)
- Auto-detect element type from text patterns
- Character intro tracking
- Beat Board with drag-and-drop cards
- Scene Cards
- Vertical Plan with trope library
- Diagnostics: scene-turn, substance, pacing, character intro, humanization
- Pre-Flight modal
- References subsystem (upload + intent + tags + mode)
- Modify modal (Intent Router + transform/preserve detection)
- Settings (AI provider, writing prefs, project prefs)
- IndexedDB autosave + File System Access save/open
- Fountain import/export
- Day / Night / Midnight / System appearance
- Command Palette (⌘K)
- Status bar (pages, scenes, characters, words, runtime, save state)
- Em-dash hard-prohibit across all inputs/outputs/UI

## 11. Post-MVP roadmap

- Real AI provider adapters (OpenAI / Anthropic / local)
- PDF export with Courier Prime pagination accuracy
- FDX import/export
- Revision Mode (White → Blue → Pink → Yellow → Green → Goldenrod → Buff → Salmon → Cherry) with revision marks + collated drafts
- Lock pages (A-pages, AA-pages)
- Production-ready tagging (Cast, Props, Vehicles, Set Dressing)
- Table Read with per-character voice assignment
- Series Architecture View
- Showrunner chat (persistent agent with full project context)
- Pitch / Treatment / Series-Bible generators
- Multi-collaborator support
- Real-time What-If Sandbox (branch any element/scene/beat)
- Visual mood-board panel
- Comp-title library + marketability lens

## 12. Risks and technical challenges

- **Pagination accuracy.** Current pagination engine is line-count approximation; pixel-perfect rendering across browsers requires a font-metric-aware layout engine. Post-MVP.
- **AI cost.** The Thinking Layer makes 5 provider calls per generation. Users may want a "fast mode" that skips pre-mortem and self-critique. Configurable.
- **Reference IP posture.** Content-source transformations require explicit user affirmation of ownership. Hard-gated in UI.
- **Vertical sandbox isolation.** Must ensure vertical rules never leak into other formats. Enforced via the `verticalSandbox` flag on every relevant decision point + per-mode lint configuration.
- **Large project performance.** A 100-scene project has thousands of elements. Editor rendering must virtualize for very large scripts. Post-MVP optimization.

## 13. How the app preserves professional formatting

- Element types are typed in the data model — never inferred from text alone after creation.
- The pagination engine uses real Courier 12pt geometry from the FormatConfig.
- The character-intro tracker watches every first appearance.
- The lint pass catches and replaces em-dashes at write time, save time, AI-output time, and serialization time (defense in depth).
- The Fountain serializer respects the screenplay element types so round-trips are lossless.

## 14. How the app tracks characters, arcs, beats, and continuity

- Each `Character` has a full state (knowledge, emotional pitch, physical condition, last tactic).
- The Knowledge Graph stores discrete facts with audience-knowledge timing.
- Beats and Scene Cards carry the substance fields the diagnostics read from (opening value, closing value, change mechanism, audience knowledge delta).
- The Setup/Payoff ledger is a first-class collection on the Project.
- The Diagnostics Engine reads all of the above and produces actionable findings the user can jump to.

This is the plan. It is the document the app was built against.
