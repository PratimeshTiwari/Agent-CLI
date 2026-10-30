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
  'userFg', 'userBg', 'addBg', 'delBg',
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
    // No tint: the named-colour look is the classic one, and a named background
    // (bright green behind code) is not one anybody wants.
    addBg: null, delBg: null,
  },

  /** Truecolor, tuned for a dark background. chalk drops to 256 colours where truecolor is missing. */
  dark: {
    text: '#e6e6e6', muted: '#8b93b0',
    accent: '#7aa2f7', attention: '#ff9e64', success: '#9ece6a', danger: '#f7768e',
    plan: '#e0af68', auto: '#73daca', strict: '#bb9af7',
    menu: '#7aa2f7', link: '#7dcfff', review: '#bb9af7', shell: '#9ece6a', diffHeader: '#7dcfff',
    userFg: '#e6e6e6', userBg: '#2a2f45', addBg: '#132a1f', delBg: '#2d1a1d',
  },

  /** The same roles with darker inks, for a light background. */
  light: {
    text: '#1f2328', muted: '#57606a',
    accent: '#0969da', attention: '#bc4c00', success: '#1a7f37', danger: '#cf222e',
    plan: '#9a6700', auto: '#0b7a75', strict: '#8250df',
    menu: '#0969da', link: '#0550ae', review: '#8250df', shell: '#1a7f37', diffHeader: '#0550ae',
    userFg: '#1f2328', userBg: '#e6eaef', addBg: '#dafbe1', delBg: '#ffebe9',
  },

  /**
   * Red–green safe (Okabe–Ito): success is blue and failure orange, so a
   * finished step and a failed one never differ only by red against green.
   */
  'dark-colorblind': {
    text: '#e6e6e6', muted: '#9aa0a6',
    accent: '#cc79a7', attention: '#f0e442', success: '#56b4e9', danger: '#e69f00',
    plan: '#f0e442', auto: '#56b4e9', strict: '#cc79a7',
    menu: '#a5d6ff', link: '#a5d6ff', review: '#cc79a7', shell: '#56b4e9', diffHeader: '#a5d6ff',
    userFg: '#e6e6e6', userBg: '#2a2f45', addBg: '#0f2742', delBg: '#3a2410',
  },

  'light-colorblind': {
    text: '#1f2328', muted: '#57606a',
    accent: '#a3417f', attention: '#7a5f00', success: '#0067a3', danger: '#b54a00',
    plan: '#7a5f00', auto: '#0067a3', strict: '#a3417f',
    menu: '#0067a3', link: '#0067a3', review: '#a3417f', shell: '#0067a3', diffHeader: '#0067a3',
    userFg: '#1f2328', userBg: '#e6eaef', addBg: '#ddf4ff', delBg: '#fff1e5',
  },

  /**
   * No colour at all: `null` is "leave the terminal's own", which Ink draws as
   * plain text. Bold and dim still carry structure, and a diff keeps its `+`
   * and `-`. Chosen automatically when `NO_COLOR` is set (no-color.org).
   */
  mono: Object.fromEntries(ROLES.map((role) => [role, null])),
};

/**
 * What the picker says about each palette, and the background its contrast is
 * checked against (`theme-tokens.test.js`). `null`: it uses the terminal's own
 * colours, so there is nothing of ours to check.
 */
/*
 * Names that say what each one *is* (owner, 2026-10-30: "terminal colour and
 * dark colour … not clear"). `terminal` borrows your terminal's own 16 colours,
 * so it changes with the terminal's theme; the others are fixed colours chosen
 * for one kind of background. The blurb is drawn beside the name, so all six
 * can be compared without moving the cursor.
 */
export const PALETTE_INFO = {
  terminal: { label: 'Match terminal', blurb: 'your terminal\'s own colours', background: null },
  dark: { label: 'Dark', blurb: 'fixed colours for a dark background', background: '#1e1e1e' },
  light: { label: 'Light', blurb: 'fixed colours for a light background', background: '#ffffff' },
  'dark-colorblind': { label: 'Dark, colour-blind', blurb: 'blue and orange for green and red', background: '#1e1e1e' },
  'light-colorblind': { label: 'Light, colour-blind', blurb: 'the same, for a light background', background: '#ffffff' },
  mono: { label: 'No colour', blurb: 'bold and dim only (also NO_COLOR)', background: null },
};

/**
 * The theme to start with: `NO_COLOR` wins (it is the user saying so for every
 * program at once), then the saved choice, then the default.
 */
export function startupTheme(env = process.env, saved = null) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 'mono';
  return saved && PALETTES[saved] ? saved : DEFAULT_THEME;
}

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
