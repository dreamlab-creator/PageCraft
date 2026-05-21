/**
 * Industry-standard screenplay page geometry. Used as the baseline for
 * every preset. Specific formats (multi-cam, vertical) override selected
 * properties.
 *
 * Sourced from: Final Draft 13 user guide, Academy of Motion Picture Arts &
 * Sciences sample, BBC Writersroom format guide, Writers Guild Foundation.
 */

import type { FormatConfig } from '@/types'

/**
 * US Letter 8.5×11 with Final Draft 13 default element column geometry.
 *
 * All "left" / "right" values are inches from the PAGE EDGE (not from
 * each other), so the rendered position is unambiguous. The screenplay
 * CSS uses these directly as absolute column anchors.
 *
 *   width 8.5″, margins 1.5″ left and 1.0″ right → usable width = 6.0″
 *   font Courier 12pt: ~10 chars/inch horizontal, 6 lines/inch vertical
 *
 * Element positions (Final Draft 13 defaults):
 *   - Scene Heading: 1.5″ → 7.5″ (6.0″ wide, full text width)
 *   - Action:        1.5″ → 7.5″ (6.0″ wide, ~60 chars/line)
 *   - Character cue: 3.7″ → ~7.0″ (≈3.3″ wide, fits up to ~30 char names)
 *   - Dialogue:      2.5″ → 6.0″ (3.5″ wide, ~33–35 chars/line)
 *   - Parenthetical: 3.1″ → 5.5″ (2.4″ wide, ~24 chars/line)
 *   - Transition:    right-aligned to 7.5″ (ALL CAPS, "CUT TO:" etc.)
 *   - Shot:          1.5″ → 7.5″ (same column as scene heading)
 */
export const STANDARD_PAGE: FormatConfig['page'] = {
  width: 8.5,
  height: 11,
  marginLeft: 1.5,
  marginRight: 1.0,
  marginTop: 1.0,
  marginBottom: 1.0,
  font: '"Courier Prime", "Courier New", Courier, monospace',
  fontSize: 12,
  elementIndents: {
    action:        { left: 1.5, right: 1.0 },
    character:     { left: 3.7, right: 1.5 },  // ~3.3" wide column
    dialogue:      { left: 2.5, right: 2.5 },  // 3.5" wide column
    parenthetical: { left: 3.1, right: 3.0 },  // 2.4" wide column
    transition:    { left: 6.0, right: 1.0 },  // right-aligned to 7.5"
    shot:          { left: 1.5, right: 1.0 },
  },
  elementCasing: {
    action: 'normal',
    sceneHeading: 'all_caps',
    character: 'all_caps',
    transition: 'all_caps',
    shot: 'all_caps',
  },
  dialogueLineSpacing: 1,
  secondsPerPage: 60, // 1 page = 1 minute (industry rough heuristic)
}

/** Multi-cam sitcom variant: all-caps action, double-spaced dialogue. */
export const MULTI_CAM_PAGE: FormatConfig['page'] = {
  ...STANDARD_PAGE,
  elementCasing: {
    ...STANDARD_PAGE.elementCasing,
    action: 'all_caps',
  },
  dialogueLineSpacing: 2,
  secondsPerPage: 30, // 1 page = 30 seconds for sitcom (per Final Draft)
}

/**
 * Vertical-mode page geometry. The vertical "page" maps to the portrait
 * mobile screen rather than US Letter. We still use Letter for the underlying
 * document so screenwriters can read/edit conventionally; pagination metrics
 * are calibrated to episode runtime instead.
 */
export const VERTICAL_PAGE: FormatConfig['page'] = {
  ...STANDARD_PAGE,
  // Vertical uses standard Letter for the editor but counts episodes, not pages.
  secondsPerPage: 30, // shorter vertical pages — dense dialogue
}
