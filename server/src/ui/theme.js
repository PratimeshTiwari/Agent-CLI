/**
 * Colour, by what it means — never by name.
 *
 * Components asked for `"cyan"` and `"yellow"` directly, about 86 times, and
 * the two colours had drifted into meaning ten things between them: cyan was
 * the agent working, auto mode, a selected row, connected, "context is fine"
 * and every menu frame; yellow was plan mode, warnings, disconnected and
 * "this wants you". A colour that means six things means nothing, and a
 * palette change was an edit at every call site.
 *
 * So a component names the role (`T.accent`, `T.attention`) and the palette
 * decides the colour. The plan this implements is
 * `.agent/artifacts/plans/2026-10-24-ui-redesign.md`.
 *
 * **`terminal` is today's look, exactly.** Phase 1 changes no pixel: every role
 * maps back to the named ANSI colour that call site used before, which is why
 * some roles share a colour here (`menu`, `link` and `accent` are all cyan).
 * They are separate roles because they will not share one in the other
 * palettes. `test/ui/theme-tokens.test.js` fails on a literal colour in a
 * component, so the next one cannot slip back in.
 *
 * `T` is one object mutated in place by `setTheme`, rather than a React
 * context: components read it during render, and a theme switch has to reprint
 * `<Static>` anyway (committed rows belong to the terminal and cannot be
 * recoloured), which re-renders everything that reads it.
 */

/** Every role a component may ask for. A palette must define all of them. */
export const ROLES = [
  'text', 'muted', 'accent', 'attention', 'success', 'danger',
  'plan', 'auto', 'strict',
  'menu', 'link', 'review', 'shell', 'diffHeader',
  'userFg', 'userBg',
];

export const PALETTES = {
  /** Named ANSI colours only, so it follows the terminal's own palette. Today's look. */
  terminal: {
    text: 'white',
    muted: 'gray',
    accent: 'cyan', // the agent is doing something: spinner, running tool, thinking line
    attention: 'yellow', // this wants you, or something is wrong but not failed
    success: 'green',
    danger: 'red',
    plan: 'yellow',
    auto: 'cyan',
    strict: 'magenta',
    menu: 'cyan', // a menu's frame and heading
    link: 'cyan', // a name or command you can act on (`/history`, the browser's model)
    review: 'magenta', // the plan-review frame
    shell: 'green', // the ctrl+t shell
    diffHeader: 'cyan',
    userFg: 'white',
    // A hex grey, not the named `gray`: what a terminal paints for bright-black
    // is its theme's choice, and VS Code's is light — see UserBar.
    userBg: '#303030',
  },
};

export const DEFAULT_THEME = 'terminal';

/** The live palette. Read during render; replaced in place by `setTheme`. */
export const T = { ...PALETTES[DEFAULT_THEME] };

let current = DEFAULT_THEME;

/** Switch palettes. Unknown names are refused rather than half-applied. */
export function setTheme(name) {
  const palette = PALETTES[name];
  if (!palette) return false;
  Object.assign(T, palette);
  current = name;
  return true;
}

export const themeName = () => current;

/** The mode's colour — the input border *is* the mode, so each mode has a role. */
export function modeColor(mode) {
  if (mode === 'auto') return T.auto;
  if (mode === 'strict') return T.strict;
  return T.plan;
}
