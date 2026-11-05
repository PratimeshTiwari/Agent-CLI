/**
 * `/chrome` (v9.3): the rows, and what to say when a profile does not answer.
 * Pure, like `mcp-view.js`.
 */
export const PAIR_WAIT_MS = 45_000;

export function profileItems(profiles, current) {
  return [
    { label: 'Any profile', detail: 'the first one connected', value: '', key: 'any', current: !current },
    ...profiles.map((p) => ({
      label: p.name,
      detail: [p.email, p.hasExtension ? 'has the extension' : ''].filter(Boolean).join(' · '),
      value: p.dir,
      current: current?.dir === p.dir,
    })),
  ];
}

export function chromeLine(current) {
  if (!current) return 'Prompts go to one profile. Choosing one keeps every other account out.';
  return `Only ${current.name} gets prompts. If it is closed, they wait.`;
}

/** Steps, for a profile that does not have the extension or did not answer. */
export const loadSteps = (extensionDir) => [
  'In that profile, open chrome://extensions and turn on Developer mode.',
  `Choose Load unpacked: ${extensionDir}`,
  'Sign in to Gemini there, then try again.',
];
