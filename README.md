# PageCraft

A prestige-level professional screenwriting environment.

PageCraft is not a toy AI writing demo. It is a serious tool for working writers, producers, showrunners, and development executives. It supports a writer at any level of involvement — light assistance when stuck, full-draft generation from an approved outline, or anything in between — across feature, television, animation, and vertical drama formats. It produces real industry-format screenplays with real structural intelligence behind them.

## What's in it

- **Final Draft 13-flavored editor.** Courier Prime 12pt, real industry margins, Cmd+1..7 element shortcuts, Tab/Enter routing that matches Final Draft exactly, SmartType autocomplete, page view, focus mode, typewriter mode, midnight mode.
- **Six format presets + a custom Format Interpreter.** Feature Drama, Feature Comedy, Hour-Long 5-Act TV Drama, Half-Hour Single-Cam, Half-Hour Multi-Cam, 2D Animation, Vertical Drama — plus a natural-language interpreter that composes any custom format the user can describe.
- **Vertical mode (sandboxed).** A walled-garden module for vertical drama with its own Rise/Spike/Drop/Cliff episode structure, 12-family trope library, on-the-nose-friendly dialogue, cycle/episode hierarchy, paywall planning, and CPI moment tracking. None of these rules leak into any other format.
- **Real planning surface.** Logline, summary, world rules, central dramatic question (feature) or story engine (TV), themes as questions, stakes (public + private), A/B/C story, hard constraints. Character Bible built on the Want/Need/Wound architecture with full Voice Fingerprints.
- **Beat Board + scene cards.** Free-positioning beat cards on a virtual whiteboard, color-coded, draggable. Scene cards with the McKee scene-turn discipline: opening value, closing value, turn mechanism.
- **Diagnostics that think like a reader.** Scene-Turn Check (McKee), Substance Check, Pacing EKG, Voice Drift, Continuity, Setup/Payoff Ledger, Character Intro Caps, Humanization Linter, Pre-Flight before export.
- **Humanization, hard-enforced.** No em dashes (auto-converted to `--` in dialogue or `,`/`.` in prose). No AI tells. No corporate connectors. No interiority leak in action lines. Every AI output runs through the Thinking Layer: pre-mortem → plan → draft → self-critique → revision.
- **References subsystem.** Upload any script, outline, treatment, or bible. Attach an intent ("use as dialogue style," "rewrite this with new characters," "treat as canon"). PageCraft uses it accordingly.
- **Modify, baked into the app's thought process.** Natural-language transformation requests ("Set this in WW2 France") are interpreted, applied with smart preservation defaults (plot, beats, relationships, theme, arcs preserved unless explicitly changed), and surfaced as side-by-side diffs.
- **Fountain import/export.** Full Fountain 1.1 round-trip.
- **Local-first storage.** Autosave to IndexedDB, Save As / Open to disk via File System Access API.

## Setup

```bash
# Requires Node 18+ (Node 20 recommended).
npm install
npm run dev
```

Open http://localhost:5173 and start a new project from the Dashboard.

## Bring-your-own AI key

PageCraft does not run its own AI backend. Every AI call goes directly from the user's browser to Anthropic's Messages API, using the Anthropic key the user enters in `Settings → AI`. The key is stored in IndexedDB on the visitor's own machine; it is never sent to PageCraft itself.

This means PageCraft can be hosted as a pure static site (no server, no env vars, no API budget on the host's side) and every visitor pays for their own AI usage with their own key.

## Deploying to Vercel

PageCraft is a Vite SPA with IndexedDB persistence — it ships as static files and runs entirely in the browser, so Vercel's free tier hosts it well.

**Prerequisites**

- A GitHub account (so Vercel can pull the repo and auto-deploy on every push).
- A free Vercel account (vercel.com).

**One-time setup**

```bash
# 1. From the project root, initialize git and push to GitHub.
git init
git add .
git commit -m "Initial PageCraft commit"
git branch -M main
# Create an empty repo on GitHub first, then:
git remote add origin git@github.com:YOUR_USERNAME/pagecraft.git
git push -u origin main
```

```text
# 2. On Vercel
- New Project → Import Git Repository → pick the PageCraft repo.
- Framework Preset: Vite (auto-detected).
- Build Command: npm run build (auto-detected).
- Output Directory: dist (auto-detected).
- Environment Variables: NONE required.
- Click Deploy. The first build takes ~60s.
```

Vercel hands back a URL like `pagecraft-yourname.vercel.app`. Open it from any browser, enter an Anthropic key in `Settings → AI`, and the app is fully functional.

**Auto-deploys on every commit**

Once Vercel is connected to the repo, every `git push` to `main` triggers a new production deployment. PRs and branch pushes get free preview URLs. To roll out an update:

```bash
git add .
git commit -m "Tighten comedy discipline"
git push
```

Vercel sees the push, builds, and replaces the live site in ~60 seconds. No manual deploy step.

**The `vercel.json` shipped at the repo root** wires:

- SPA fallback (every unmatched path serves `index.html` so deep-links work).
- Long-lived caching for hashed asset bundles in `/assets/*`.
- No-cache on `index.html` so users always get the latest build immediately after a deploy.
- Tagged framework: Vite, with `dist` as the output directory.

**What lives where in production**

| Data | Where | Survives a deploy? |
|---|---|---|
| The writer's projects | Their browser's IndexedDB | Yes (only their browser, not yours) |
| The writer's Anthropic key | Their browser's IndexedDB | Yes |
| Auto-saved versions | Their browser's IndexedDB | Yes |
| Uploaded source materials (intake) | Their browser's IndexedDB | Yes |
| Static app bundle (JS / CSS / pdfjs worker / mammoth) | Vercel CDN, hashed filenames | Replaced on every deploy |

There is no PageCraft-side database. Visitors' work is theirs alone; the host sees nothing.

## Architecture

```
src/
  types/                  Domain types (Project, Screenplay, Character, Beat, ...)
  lib/
    formats/              Six presets + Format Interpreter (NL → FormatConfig)
    screenplay/           Routing, auto-detect, pagination
    humanization/         Em-dash policy + AI-tell linter
    fountain/             Fountain 1.1 parser + serializer
    storage/              IndexedDB + File System Access + autosave
    diagnostics/          Scene-turn, substance, pacing, character intro
    intent/               Intent Router (generate/modify/diagnose/extract/ask)
    ai/                   Provider abstraction + prompt library + Thinking Layer
    vertical/             Vertical Trope Master List (sandboxed)
  store/                  Zustand stores: project, library, ui
  components/
    shell/                AppShell, Titlebar, StatusBar, CommandPalette, ModalRoot
    dashboard/            Dashboard, NewProjectWizard
    planning/             Overview, Characters, Beat Board, Scene Cards, Themes, Vertical
    writing/              ScreenplayEditor, ScreenplayBlock, SmartType, sidebars
    diagnostics/          Diagnostics panel + Pre-Flight modal
    references/           References panel
    modify/               Modify modal
    settings/             Settings modal
  styles/                 Global CSS + theme tokens
```

## Hard rules baked into the app

- **No em dashes.** The character `—` is never emitted. Dialogue gets `--`; prose gets `,` or `.`. Linter flags any em dash with a one-click fix.
- **No AI tells.** "However", "Moreover", "Therefore", "Furthermore", "It is worth noting", "From a computational standpoint", and similar phrases are linted out of every AI output and flagged in user-typed prose (outside Vertical dialogue, where on-the-nose is the craft target).
- **No interiority leak in action lines.** "feels", "thinks", "knows", "realizes" all trigger lint warnings in action.
- **Character introduction caps tracked.** First appearance in action = ALL CAPS. Subsequent appearances = normal case. PageCraft auto-tracks and flags violations.
- **Scene-turn discipline.** Scenes with identical opening and closing values are flagged as nonevents.
- **Vertical sandbox.** Vertical-mode projects use the relaxed-dialogue humanization mode plus mandatory Rise/Spike/Drop/Cliff per episode. None of these rules apply to any other format.

## License & Use

Personal/commercial use is up to the project owner. The Reference Materials subsystem requires the user to explicitly affirm ownership before any content-source transformation is allowed.

## Next steps (post-MVP)

- Real AI provider adapters (OpenAI, Anthropic, local)
- PDF export with proper Courier Prime pagination
- FDX import/export
- Revision colors UI (White → Blue → Pink → Yellow → Green → ...)
- Table Read mode with assigned voices
- Series Architecture View (season tension curve, cross-episode runners)
- Real-time AI sidebar chat ("Showrunner")
- Pitch / treatment / series bible generators
- Multi-window collaboration

## Why PageCraft

Most screenwriting AI tools sit on top of a text box and autocomplete. PageCraft is built differently: a structured intelligence layer underneath, with a knowledge graph, character state engine, setup/payoff ledger, voice fingerprinting, and a self-critiquing Thinking Layer. Every page that leaves PageCraft has to pass a pre-flight that catches what professional readers catch.

It's built to be the screenwriting program that helps a writer write at the level of the writers they admire most.
