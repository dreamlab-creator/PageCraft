/**
 * Project Context Builder.
 *
 * Assembles a single, dense "what we know so far" block that gets injected
 * into every AI call. The AI literally cannot answer without knowing every
 * fact the user has entered. Confirmed/locked sections are flagged
 * IMMUTABLE — the AI is forbidden from contradicting them.
 *
 * This is the brain behind "Do it for me" — the AI sees the whole project,
 * not just the field it's filling.
 */

import type { Project, Beat, Character, SceneCard } from '@/types'
import {
  HARD_RULES,
  HUMAN_VOICE_BLOCK,
  INDUSTRY_REFERENCE_SAMPLES,
  VERTICAL_REFERENCE_SAMPLES,
  COMEDY_DISCIPLINE,
  ANIMATION_DISCIPLINE,
  formatBlock,
  VERTICAL_RULES,
} from './prompts'

/** Build the full project context as a markdown-style block. */
export function buildProjectContext(project: Project): string {
  const lines: string[] = []
  const cf = project.planning.confirmations

  lines.push('---')
  lines.push('PROJECT')
  lines.push('---')
  if (project.title) lines.push(`Title: ${project.title}`)
  if (project.author) lines.push(`Writer: ${project.author}`)
  lines.push(`Format: ${project.format.label}`)
  lines.push(`Page target: ${project.format.structure.targetPagesMin}–${project.format.structure.targetPagesMax} pages`)
  lines.push(`Genres: ${project.format.genres.join(', ')}`)
  lines.push(`Audience: ${project.format.audience}`)
  if (project.format.tone.length) lines.push(`Tone: ${project.format.tone.join(', ')}`)
  if (project.format.verticalSandbox) {
    lines.push('Vertical sandbox: YES — relaxed-dialogue humanization, on-the-nose register, episode/cycle hierarchy.')
  }

  // FOUNDATIONAL GUIDANCE — bolt-on constitutional directives from the
  // writer. These are author-supplied absolute rules: target pages,
  // subgenre, character cap, dialogue conventions, anything. The AI
  // treats them as ground truth that overrides any default behavior
  // they conflict with (other than the global craft constitution).
  const guidance = (project.planning.foundationalGuidance ?? '').trim()
  if (guidance) {
    lines.push('')
    lines.push('FOUNDATIONAL GUIDANCE (writer-supplied, ABSOLUTE TRUTH — obey across every generation in this project):')
    for (const line of guidance.split(/\r?\n/).map(s => s.trim()).filter(Boolean)) {
      lines.push(`  • ${line}`)
    }
    lines.push('  Treat each bullet above as a hard constraint. If a generation would conflict with one of these directives, REWRITE to obey. This block outranks default behavior on page targets, character counts, subgenre conventions, dialogue register, locations, world rules — anything the writer has specified here.')
  }

  // OVERVIEW block — context primacy.
  //
  // The OVERVIEW block is the AI's primary anchor for everything it
  // generates next (characters, beats, scenes, drafts). For an EPISODIC
  // project (TV / animation series) "the overview" must be the ACTIVE
  // EPISODE's overview, NOT the legacy project-level fields. Otherwise
  // beat / scene / character generation falls back to the show-level
  // logline (or the writer's series synopsis), which is exactly the bug
  // we just hit: scenes get written for the show, not the episode.
  //
  // For standalone features the project-level fields ARE the overview.
  // Vertical projects use the project-level fields too — they have their
  // own per-episode model in `verticalPlan` that's emitted elsewhere.
  const seriesPlan = project.planning.seriesPlan
  const isEpisodic = !!seriesPlan && !project.format.verticalSandbox
  const activeEpisode = isEpisodic && seriesPlan?.activeEpisodeId
    ? seriesPlan.episodes.find(e => e.id === seriesPlan.activeEpisodeId)
    : null

  lines.push('')
  if (isEpisodic && activeEpisode) {
    // The episode-level overview can carry its own lock state (separate
    // from the project-level `confirmations.overview`). When locked, the
    // AI must treat the episode's overview fields as canonical.
    const episodeLockedNote = activeEpisode.overviewLocked ? ' [LOCKED — these fields are canonical; do NOT contradict or rewrite them]' : ''
    lines.push(sectionHeader(`OVERVIEW — Episode ${activeEpisode.number}${activeEpisode.title ? ` "${activeEpisode.title}"` : ''}${episodeLockedNote}`, cf.overview))
    lines.push(`THIS PROJECT IS AN EPISODIC SERIES. The OVERVIEW below is for ONE EPISODE — Episode ${activeEpisode.number} — and is the PRIMARY anchor for beats, scene cards, drafted pages, and character work in this generation. Use the SHOW BIBLE block further down ONLY for series-level continuity (recurring cast facts, tone, world rules) — never as the source of the story you are dramatizing.`)
    lines.push(`Episode logline: ${valueOrBlank(activeEpisode.logline)}`)
    lines.push(`Episode short summary: ${valueOrBlank(activeEpisode.summary)}`)
    lines.push(`Episode long synopsis: ${valueOrBlank(activeEpisode.longSynopsis || '')}`)
    if (activeEpisode.centralDramaticQuestion) lines.push(`Episode central question: ${activeEpisode.centralDramaticQuestion}`)
    if (activeEpisode.themeQuestion) lines.push(`Episode theme question: ${activeEpisode.themeQuestion}`)
    if (activeEpisode.themes && activeEpisode.themes.length) lines.push(`Episode themes: ${activeEpisode.themes.join(', ')}`)
    if (activeEpisode.hook) lines.push(`Episode cold-open / hook: ${activeEpisode.hook}`)
    if (activeEpisode.notes) lines.push(`Episode notes: ${activeEpisode.notes}`)
    if (activeEpisode.focusCharacterIds.length) {
      const names = activeEpisode.focusCharacterIds
        .map(id => project.characters.find(c => c.id === id)?.name)
        .filter(Boolean)
        .join(', ')
      if (names) lines.push(`Focus characters this episode: ${names}`)
    }
    if (activeEpisode.arcMovements.length && seriesPlan) {
      lines.push('What each season arc spends THIS episode:')
      for (const m of activeEpisode.arcMovements) {
        const arc = seriesPlan.seasonArcs.find(a => a.id === m.arcId)
        if (arc) lines.push(`  [${arc.label}] ${m.movement}`)
      }
    }
    // World rules + hard constraints stay project-level — they apply to
    // every episode in the series, so we emit them here for visibility.
    if (project.planning.worldRules.length) {
      lines.push('World rules (series-wide):')
      for (const r of project.planning.worldRules) lines.push(`  - ${r}`)
    }
    if (project.planning.hardConstraints.length) {
      lines.push('Hard constraints (series-wide; must respect, no exception):')
      for (const r of project.planning.hardConstraints) lines.push(`  - ${r}`)
    }

    lines.push('')
    lines.push(sectionHeader('THEME · STAKES (episode-scoped where set; series-scoped where not)', cf.themes))
    if (activeEpisode.themeQuestion) {
      lines.push(`Episode theme question: ${activeEpisode.themeQuestion}`)
    } else if (project.planning.themeQuestion) {
      lines.push(`(no per-episode theme question — using series-level) Theme question: ${project.planning.themeQuestion}`)
    }
    if (activeEpisode.themes && activeEpisode.themes.length) {
      lines.push(`Episode themes: ${activeEpisode.themes.join(', ')}`)
    } else if (project.planning.themes.length) {
      lines.push(`(no per-episode themes — using series-level) Themes: ${project.planning.themes.join(', ')}`)
    }
    if (project.planning.externalStakes) lines.push(`External stakes (series-wide): ${project.planning.externalStakes}`)
    if (project.planning.internalStakes) lines.push(`Internal stakes (series-wide): ${project.planning.internalStakes}`)
  } else {
    lines.push(sectionHeader('OVERVIEW', cf.overview))
    lines.push(`Logline: ${valueOrBlank(project.planning.logline)}`)
    lines.push(`Short summary: ${valueOrBlank(project.planning.shortSummary)}`)
    lines.push(`Long synopsis: ${valueOrBlank(project.planning.longSynopsis)}`)
    if (project.planning.centralDramaticQuestion) lines.push(`Central question: ${project.planning.centralDramaticQuestion}`)
    if (project.planning.storyEngine) lines.push(`Story engine: ${project.planning.storyEngine}`)
    if (project.planning.worldRules.length) {
      lines.push('World rules:')
      for (const r of project.planning.worldRules) lines.push(`  - ${r}`)
    }
    if (project.planning.hardConstraints.length) {
      lines.push('Hard constraints (must respect, no exception):')
      for (const r of project.planning.hardConstraints) lines.push(`  - ${r}`)
    }

    lines.push('')
    lines.push(sectionHeader('THEME · STAKES', cf.themes))
    if (project.planning.themeQuestion) lines.push(`Theme question: ${project.planning.themeQuestion}`)
    if (project.planning.themes.length) lines.push(`Themes: ${project.planning.themes.join(', ')}`)
    if (project.planning.externalStakes) lines.push(`External stakes: ${project.planning.externalStakes}`)
    if (project.planning.internalStakes) lines.push(`Internal stakes: ${project.planning.internalStakes}`)
    if (project.planning.aStory) lines.push(`A-story: ${project.planning.aStory}`)
    if (project.planning.bStory) lines.push(`B-story: ${project.planning.bStory}`)
    if (project.planning.cStory) lines.push(`C-story: ${project.planning.cStory}`)
    if (project.planning.seriesArcQuestion) lines.push(`Series arc question: ${project.planning.seriesArcQuestion}`)
  }

  lines.push('')
  lines.push(sectionHeader('CHARACTERS', cf.characters))
  if (project.characters.length === 0) {
    lines.push('(no characters defined yet)')
  } else {
    for (const c of project.characters) {
      lines.push(formatCharacter(c))
    }
  }

  lines.push('')
  lines.push(sectionHeader('BEATS', cf.beats))
  if (project.beats.length === 0) {
    lines.push('(no beats yet)')
  } else {
    const sorted = [...project.beats].sort((a, b) => (a.pageRangeStart ?? 0) - (b.pageRangeStart ?? 0))
    for (const b of sorted) lines.push(formatBeat(b))
  }

  lines.push('')
  lines.push(sectionHeader('SCENE CARDS', cf.scenes))
  if (project.sceneCards.length === 0) {
    lines.push('(no scene cards yet)')
  } else {
    const sorted = [...project.sceneCards].sort((a, b) => a.order - b.order)
    for (const s of sorted) lines.push(formatSceneCard(s))
  }

  // Locations.
  if (project.locations.length) {
    lines.push('')
    lines.push('LOCATIONS')
    for (const l of project.locations) {
      lines.push(`- ${l.name}${l.description ? ` — ${l.description}` : ''}`)
    }
  }

  // Active references — for STYLE references we embed actual prose excerpts so
  // the AI has concrete text to mimic, not just filenames. Style references
  // are the gospel: the AI is told elsewhere (PROSE_DISCIPLINE → "REFERENCE
  // SCRIPT STYLE") that this is the only style it may emulate.
  const activeRefs = project.references.filter(r => r.active)
  if (activeRefs.length) {
    lines.push('')
    lines.push('REFERENCES (user-supplied materials with stated intents)')
    // Split style references out and embed real prose from each — these are
    // what the AI is supposed to be matching when it writes.
    const styleRefs = activeRefs.filter(r => r.mode === 'style' || r.mode === 'mixed')
    const otherRefs = activeRefs.filter(r => r.mode !== 'style' && r.mode !== 'mixed')

    if (styleRefs.length) {
      lines.push('')
      lines.push('STYLE REFERENCES — match the prose voice in these excerpts. This is the ONLY style you may use. Copy the cadence, sentence length, vocabulary register, paragraph density, and restraint. If a sentence you draft does not feel like it could appear in one of these excerpts, rewrite.')
      const perRefBudget = Math.max(1200, Math.floor(8000 / styleRefs.length))
      for (const r of styleRefs) {
        lines.push('')
        lines.push(`>>> STYLE EXCERPT — ${r.filename}${r.intent ? ` (user intent: ${r.intent.slice(0, 200)})` : ''}`)
        for (const block of pickStyleExcerpts(r.raw, perRefBudget)) {
          lines.push(block)
          lines.push('---')
        }
      }
    }

    if (otherRefs.length) {
      lines.push('')
      lines.push('OTHER REFERENCES')
      for (const r of otherRefs) {
        lines.push(`- [${r.mode}] ${r.filename}: ${r.intent || '(no intent stated)'}`)
        if (r.mode === 'canon' || r.mode === 'extraction') {
          const snippet = (r.raw || '').slice(0, 1500)
          if (snippet) lines.push(`  Content (truncated): ${snippet}`)
        }
      }
    }
  }

  // SHOW BIBLE (series-level reference only).
  //
  // For episodic projects the OVERVIEW block above already covers the
  // active episode in primary detail. This block is supporting reference
  // ONLY: show-level facts the AI consults to keep tone / world / cast
  // consistent across episodes, plus a roster of other episodes so the
  // AI can avoid accidentally re-dramatizing what's already been told.
  //
  // CRITICAL framing: the AI must NOT treat any field in this block as
  // "the thing to dramatize." The active episode in the OVERVIEW above
  // is the story being told this generation; everything here is context.
  if (project.planning.seriesPlan) {
    const sp = project.planning.seriesPlan
    const bibleLockedNote = sp.locked ? ' [LOCKED — every series-level fact below is canonical; do NOT contradict or rewrite]' : ''
    lines.push('')
    lines.push(`--- SHOW BIBLE (series-level REFERENCE only — supporting context for the OVERVIEW above; do NOT dramatize any fact below as if it were the story this generation is telling)${bibleLockedNote} ---`)
    if (sp.showTitle) lines.push(`Show title: ${sp.showTitle}`)
    lines.push(`Season ${sp.seasonNumber} (target ${sp.targetEpisodeCount} episodes)`)
    if (sp.seriesLogline) lines.push(`Series logline (about the WHOLE SHOW, not any one episode): ${sp.seriesLogline}`)
    if (sp.seriesShortSummary) lines.push(`Series short summary: ${sp.seriesShortSummary}`)
    if (sp.seriesLongSynopsis) lines.push(`Series long synopsis: ${sp.seriesLongSynopsis}`)
    if (sp.premise) lines.push(`Premise (legacy): ${sp.premise}`)
    if (sp.engine) lines.push(`Engine — what generates an episode every week: ${sp.engine}`)
    if (sp.seasonArcQuestion) lines.push(`Season arc question: ${sp.seasonArcQuestion}`)
    if (sp.toneNotes) lines.push(`Tone notes: ${sp.toneNotes}`)
    if (sp.seasonArcs.length) {
      lines.push('Season arcs (long-running threads across episodes):')
      for (const a of sp.seasonArcs) {
        lines.push(`  - ${a.label}: ${a.description}${a.dramaticQuestion ? ` Q: ${a.dramaticQuestion}` : ''}`)
      }
    }
    if (sp.episodes.length) {
      const activeId = sp.activeEpisodeId
      lines.push('Other episodes in this season (REFERENCE for continuity / non-duplication only — never the story you are dramatizing):')
      const sorted = [...sp.episodes].sort((a, b) => a.number - b.number)
      for (const e of sorted) {
        const tag = e.id === activeId ? ' ← THIS GENERATION IS FOR THIS EPISODE' : ''
        lines.push(`  Ep ${e.number} — "${e.title}" [${e.status}]${tag}: ${e.logline}`)
        if (e.summary && e.id !== activeId) lines.push(`    ${e.summary}`)
      }
      if (activeId) {
        lines.push('REMINDER: beats, scene cards, drafted pages, and character work in this generation are FOR THE ACTIVE EPISODE marked above. Use the rest of this block as continuity context — never as the story to dramatize.')
      }
    }
  }

  // Vertical-specific data.
  if (project.format.verticalSandbox && project.verticalPlan) {
    lines.push('')
    lines.push(sectionHeader('VERTICAL PLAN', cf.vertical))
    lines.push(`Total episodes: ${project.verticalPlan.totalEpisodes}`)
    lines.push(`Paywall after episode: ${project.verticalPlan.paywallAfterEpisode} — the (PAYWALL) Fountain marker goes IMMEDIATELY AFTER the Cliff beat of this episode's final scene, and before the \`# EPISODE\` header of the next episode. Paywall placement is by EPISODE number, not by scene count or page count.`)
    lines.push(`Plot type: ${project.verticalPlan.plotType.replace(/_/g, ' ')}`)
    if (project.verticalPlan.tropeStack.selected.length) {
      lines.push(`Trope stack: ${project.verticalPlan.tropeStack.selected.join(', ')}`)
    }
    if (project.verticalPlan.tropeStack.notes) {
      lines.push(`Trope notes: ${project.verticalPlan.tropeStack.notes}`)
    }
  }

  return lines.join('\n')
}

function sectionHeader(title: string, locked: boolean): string {
  return locked
    ? `--- ${title} (LOCKED — DO NOT CONTRADICT) ---`
    : `--- ${title} ---`
}

function valueOrBlank(s: string): string {
  return s && s.trim() ? s : '(not entered yet)'
}

function formatCharacter(c: Character): string {
  const parts: string[] = []
  parts.push(`- ${c.name} (${c.age || 'age?'}, ${c.role})`)
  if (c.shortDescription) parts.push(`    Intro: ${c.shortDescription}`)
  if (c.externalGoal) parts.push(`    Wants: ${c.externalGoal}`)
  if (c.internalNeed) parts.push(`    Needs: ${c.internalNeed}`)
  if (c.wound) parts.push(`    Wound: ${c.wound}`)
  if (c.fear) parts.push(`    Fear: ${c.fear}`)
  if (c.flaw) parts.push(`    Flaw: ${c.flaw}`)
  if (c.secret) parts.push(`    Secret: ${c.secret}`)
  if (c.arcStart || c.arcEnd) parts.push(`    Arc: "${c.arcStart}" → "${c.arcEnd}"`)
  if (c.arcTurn) parts.push(`    Arc turn: ${c.arcTurn}`)
  // Voice fingerprint summary.
  const v = c.voice
  const voiceParts = [
    v.sentenceLength && v.sentenceLength !== 'medium' ? `${v.sentenceLength} sentences` : '',
    v.vocabulary && v.vocabulary !== 'plainspoken' ? v.vocabulary : '',
    v.humor && v.humor !== 'none' ? `humor: ${v.humor}` : '',
    v.restraint ? `restraint: ${v.restraint}` : '',
  ].filter(Boolean)
  if (voiceParts.length) parts.push(`    Voice: ${voiceParts.join(' · ')}`)
  if (v.verbalTics.length) parts.push(`    Verbal tics: ${v.verbalTics.join(' / ')}`)
  if (v.notes) parts.push(`    Voice notes: ${v.notes}`)
  return parts.join('\n')
}

function formatBeat(b: Beat): string {
  const parts: string[] = []
  const range = b.pageRangeStart != null
    ? ` [p.${b.pageRangeStart}${b.pageRangeEnd && b.pageRangeEnd !== b.pageRangeStart ? `–${b.pageRangeEnd}` : ''}]`
    : ''
  parts.push(`- ${b.title}${range}`)
  if (b.body) parts.push(`    ${b.body}`)
  if (b.storyPurpose) parts.push(`    Purpose: ${b.storyPurpose}`)
  if (b.valueAtStart || b.valueAtEnd) parts.push(`    Value: "${b.valueAtStart}" → "${b.valueAtEnd}"`)
  if (b.changeMechanism) parts.push(`    Mechanism: ${b.changeMechanism}`)
  if (b.characterObjective) parts.push(`    Objective: ${b.characterObjective}`)
  if (b.obstacle) parts.push(`    Obstacle: ${b.obstacle}`)
  if (b.newInformation) parts.push(`    Reveal: ${b.newInformation}`)
  if (b.actOut || b.cliffhanger) parts.push(`    Act-out: ${b.actOut || b.cliffhanger}`)
  return parts.join('\n')
}

function formatSceneCard(s: SceneCard): string {
  const parts: string[] = []
  parts.push(`- [${s.order + 1}] ${s.title}${s.slugLine ? ` (${s.slugLine})` : ''}`)
  if (s.summary) parts.push(`    ${s.summary}`)
  if (s.openingValue || s.closingValue) parts.push(`    Value: "${s.openingValue}" → "${s.closingValue}"`)
  if (s.turn) parts.push(`    Turn: ${s.turn}`)
  return parts.join('\n')
}

/**
 * Pull representative excerpts from a reference script for style-matching.
 *
 * Strategy: rather than ship the first N characters (which is almost always
 * the title page, the opening fade-in, or the cover sheet), we sample three
 * windows — opening, middle, and a later section — and return whichever
 * chunks fit inside the byte budget. This gives the model a real cross-
 * section of how the reference reads on the page.
 *
 * The total returned text is approximately `byteBudget` characters across
 * 1–3 excerpts.
 */
function pickStyleExcerpts(raw: string, byteBudget: number): string[] {
  const text = typeof raw === 'string' ? raw : ''
  if (!text.trim()) return []
  const len = text.length
  if (len <= byteBudget) return [text.trim()]

  // Each window is roughly byteBudget / 3, but clamped to something sensible.
  const windowSize = Math.max(600, Math.floor(byteBudget / 3))

  const anchors = [
    // Opening — skip the first 200 chars to step past title page noise.
    Math.min(200, Math.floor(len * 0.05)),
    // Middle.
    Math.floor(len * 0.45),
    // Late.
    Math.floor(len * 0.78),
  ]

  const excerpts: string[] = []
  for (const start of anchors) {
    const slice = text.slice(start, start + windowSize).trim()
    if (slice) excerpts.push(slice)
  }
  return excerpts
}

/* ============================================================================
 * System prompt composition
 * ========================================================================= */

/**
 * Compose the full system prompt for an AI call: hard rules, voice block,
 * format block, vertical block (if applicable), and the project context.
 *
 * @param project the current project (so we know everything entered so far)
 * @param taskInstructions task-specific instructions (what we want the AI to do)
 */
export function composeSystemPrompt(project: Project, taskInstructions: string): string {
  // Genre / medium detection used to pick the right discipline blocks.
  // These are intentionally broad: a "workplace comedy" animation
  // project should pick up BOTH the comedy and the animation block.
  const isVertical = project.format.verticalSandbox
  const formatKind = project.format.kind
  const genres = (project.format.genres ?? []).map(g => g.toLowerCase())
  const isComedy =
    formatKind === 'feature_comedy'
    || formatKind === 'tv_30min_comedy_single_cam'
    || formatKind === 'tv_30min_comedy_multi_cam'
    || genres.some(g => g.includes('comedy') || g.includes('sitcom') || g === 'humor' || g === 'comedic')
  const isAnimation = formatKind === 'animation_2d' || project.format.medium === 'animation'

  // Vertical projects use a deliberately stripped, on-the-nose voice; the
  // prestige reference samples would actively mislead the model in that
  // sandbox. For everything else (features, prestige TV, animation,
  // half-hour, etc.) we always ship the reference excerpts so the AI has
  // real working-screenwriter prose to mirror, even when the user hasn't
  // uploaded their own references yet.
  //
  // Comedy and animation projects also get their own register-specific
  // discipline blocks (COMEDY_DISCIPLINE / ANIMATION_DISCIPLINE) that
  // stack on top of PROSE_DISCIPLINE. The prestige reference scripts
  // are still shipped — they teach craft mechanics — but the
  // comedy/animation blocks tell the model the register changes:
  // faster pacing, visual primacy, punchline rhythm, joke density. And
  // both blocks explicitly invite the model to draw on its broader
  // knowledge of well-executed comedy / animation (Bob's Burgers, The
  // Simpsons, The Office, etc.) so it doesn't try to write a 3-page
  // animated workplace comedy in the cadence of Bugonia.
  const blocks = [
    // The reference samples are the CONSTITUTION. They go first so every
    // rule that follows is read in their context. Each mode gets its own
    // constitution: prestige projects ship the INDUSTRY_REFERENCE_SAMPLES
    // (Bugonia, Breaking Bad, GoT, etc.). Vertical projects ship the
    // VERTICAL_REFERENCE_SAMPLES (Borgeous, Secret Prince) — same role,
    // different voice. Mixing the two is forbidden by the rules below.
    isVertical ? VERTICAL_REFERENCE_SAMPLES : INDUSTRY_REFERENCE_SAMPLES,
    HARD_RULES,
    HUMAN_VOICE_BLOCK,
    // Register-specific overlays. Order matters: animation first
    // (medium), then comedy (genre), so the comedy block's pacing rules
    // sit closer to the task at the bottom of the prompt where the
    // model weighs them most.
    !isVertical && isAnimation ? ANIMATION_DISCIPLINE : '',
    !isVertical && isComedy ? COMEDY_DISCIPLINE : '',
    formatBlock(project.format),
    isVertical ? VERTICAL_RULES : '',
    `PROJECT CONTEXT — every fact below is already part of the project. The user fills these sections in NON-LINEAR order, so any populated section is canonical input regardless of which panel it came from. Pull from EVERY populated section when generating: if vertical tropes are listed, weave them in; if beats are defined but no synopsis exists, build the synopsis from the beats; if characters have wounds but no arcs, propose arcs from the wounds. Respect locked sections as immutable. Empty sections may be invented from the populated ones — never invent details that contradict what is already filled in.`,
    buildProjectContext(project),
    '---',
    'TASK',
    taskInstructions,
  ].filter(Boolean)
  return blocks.join('\n\n')
}
