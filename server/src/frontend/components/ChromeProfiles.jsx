import React from 'react';
import { Text, useInput } from 'ink';
import { Panel, Choices } from './Panel.jsx';
import { T } from '../theme.js';
import { panelRoom } from '../menus/panel.js';
import { chromeLine, loadSteps, PAIR_WAIT_MS, profileItems } from '../menus/chrome-view.js';
import { EXTENSION_DIR, chromeDataDir, listChromeProfiles, openChromeProfile } from '../../backend/core/workspace/chrome-profiles.js';
import { pairUrl } from '../../backend/core/workspace/profile-binding.js';
import { changed } from '../../backend/core/turn/slash-commands.js';

/**
 * The list, then a wait for that profile's extension to answer. The wait ends
 * on the binding changing, so a slow Chrome start needs no polling here.
 */
export function ChromeProfiles({ agentLoop, width, rows, onDone }) {
  const binding = agentLoop.browserProfile;
  const [profiles] = React.useState(() => listChromeProfiles());
  const [view, setView] = React.useState({ step: 'list' });

  const waitFor = (profile) => {
    const token = binding.startPairing(profile);
    const opened = openChromeProfile(profile.dir, pairUrl(token));
    setView(opened ? { step: 'waiting', profile, from: binding.current?.name || 'any' } : { step: 'failed', profile, reason: 'Chrome could not be opened.' });
  };

  React.useEffect(() => {
    if (view.step !== 'waiting') return undefined;
    const timer = setTimeout(() => {
      binding.cancelPairing();
      setView({ step: 'failed', profile: view.profile, reason: `${view.profile.name} did not answer.` });
    }, PAIR_WAIT_MS);
    const off = binding.onChange((current) => {
      if (current?.dir === view.profile.dir) onDone(changed('Chrome profile', view.from, current.name, 'nothing else gets prompts'));
    });
    return () => { clearTimeout(timer); off(); };
  }, [view]);

  useInput((_input, key) => {
    if (!key.escape) return;
    if (view.step === 'list') { onDone(null); return; }
    binding.cancelPairing();
    setView({ step: 'list' });
  });

  if (view.step === 'waiting') {
    const steps = view.profile.hasExtension ? [] : loadSteps(EXTENSION_DIR).slice(0, Math.max(0, rows - 3));
    return (
      <Panel width={width} title={`Opening ${view.profile.name}`} status="waiting for its extension" tight keys="esc stop">
        {steps.map((line) => <Text key={line} wrap="truncate"> {line}</Text>)}
      </Panel>
    );
  }

  if (view.step === 'failed') {
    return (
      <Panel width={width} title={view.reason} tone="attention" tight keys="enter choose · esc back">
        {loadSteps(EXTENSION_DIR).slice(0, Math.max(0, rows - 5)).map((line) => <Text key={line} wrap="truncate"> {line}</Text>)}
        <Choices
          limit={2}
          items={[{ label: 'Try again', value: 'again' }, { label: 'Back', value: 'back' }]}
          onSelect={(item) => (item.value === 'again' ? waitFor(view.profile) : setView({ step: 'list' }))}
        />
      </Panel>
    );
  }

  const { sub, tight, room } = panelRoom({ rows, width, subtitle: chromeLine(binding.current) });
  const items = profileItems(profiles, binding.current);
  return (
    <Panel width={width} title="Chrome profile" sub={sub} tight={tight} keys="↑↓ move · enter choose · esc cancel">
      {profiles.length ? null : <Text wrap="truncate" color={T.attention}> No Chrome profiles found in {chromeDataDir()}</Text>}
      <Choices
        limit={room}
        items={items}
        onSelect={(item) => {
          if (item.value) { waitFor(profiles.find((p) => p.dir === item.value)); return; }
          const had = binding.current;
          binding.clear();
          onDone(had ? changed('Chrome profile', had.name, 'any') : null);
        }}
      />
    </Panel>
  );
}
