import React from 'react';
import { Text, useInput } from 'ink';
import { Panel, Choices } from './Panel.jsx';
import { T } from '../theme.js';
import { panelRoom } from '../menus/panel.js';
import { fitCommand } from '../menus/mcp-add.js';
import {
  checkStatus, editorItems, homeItems, installLines, otherCommand, startingPicks,
} from '../menus/update-view.js';
import {
  checkFailure, checkForUpdate, clearPendingReload, readPendingReload, treeState,
} from '../../backend/core/install/update.js';
import { companionSettled, companionVsix, installCompanion, readEditors } from '../../backend/core/install/editors.js';

/**
 * Update, Editor companion and a dismiss row, on one menu.
 *
 * It opens at once and fills in behind: the check is a `git fetch` of up to ten
 * seconds, and each editor's list takes about half a second.
 */
export function UpdateMenu({ agentLoop, width, rows, onDone, onPull }) {
  const dir = agentLoop.agentSourceDir;
  const [vsix] = React.useState(() => companionVsix());
  const [pending, setPending] = React.useState(() => readPendingReload());
  const [check, setCheck] = React.useState(null);
  const [blocked, setBlocked] = React.useState([]);
  const [editors, setEditors] = React.useState(null);
  const [picks, setPicks] = React.useState(new Set());
  const [view, setView] = React.useState('home');
  const [installing, setInstalling] = React.useState(null);
  const [cameBack, setCameBack] = React.useState(false);

  React.useEffect(() => {
    let gone = false;
    (async () => {
      const state = await checkForUpdate(dir);
      if (gone) return;
      setCheck(state);
      // Said before a pull is refused: it is the one thing that would stop it.
      if (state.available) {
        const tree = await treeState(dir);
        if (!gone) setBlocked(tree?.blocking || []);
      }
    })().catch(() => { if (!gone) setCheck({ reason: 'the check failed' }); });
    readEditors().then((found) => {
      if (gone) return;
      setEditors(found);
      if (vsix) setPicks(startingPicks(found, vsix.version));
    }).catch(() => { if (!gone) setEditors([]); });
    return () => { gone = true; };
  }, []);

  const install = async (chosen) => {
    setView('installing');
    const results = [];
    for (const editor of chosen) {
      setInstalling(editor.name);
      results.push(await installCompanion(editor, vsix));
    }
    const now = await readEditors();
    if (companionSettled(now, vsix.version)) clearPendingReload();
    onDone(installLines(results, vsix.version));
  };

  useInput((_input, key) => {
    if (!key.escape || view === 'installing') return;
    if (view === 'home') onDone(null);
    else setView(view === 'other' ? 'editors' : 'home');
  });

  if (view === 'installing') {
    return <Panel width={width} title="Editor companion" status={`installing in ${installing || '…'}`} tight keys="this can take a minute" />;
  }

  if (view === 'other') {
    const command = fitCommand(otherCommand(vsix.path), width, Math.max(1, rows - 4));
    const room = rows - command.length - 3;
    return (
      <Panel width={width} title="Another editor" tight keys="esc back">
        {command.map((line) => <Text key={line} wrap="truncate" color={T.accent}> {line}</Text>)}
        {room >= 1 ? <Text wrap="truncate"> Or Extensions → … → Install from VSIX.</Text> : null}
        {room >= 2 ? <Text wrap="truncate"> Then reload its window.</Text> : null}
      </Panel>
    );
  }

  if (view === 'editors') {
    const list = editors || [];
    const { sub, tight, room } = panelRoom({ rows, width, subtitle: 'Each editor keeps its own copy.' });
    return (
      <Panel width={width} title="Editor companion" status={vsix.version} sub={sub} tight={tight} keys="↑↓ move · space select · enter install · esc back">
        <Choices
          limit={room}
          // Back from the command, on the row it was opened from.
          initialIndex={cameBack ? list.length : 0}
          items={editorItems(list, vsix.version, picks)}
          onToggle={(item) => {
            if (item.value === 'other') return;
            const next = new Set(picks);
            if (!next.delete(item.value)) next.add(item.value);
            setPicks(next);
          }}
          onSelect={(item) => {
            if (item.value === 'other') { setCameBack(true); setView('other'); return; }
            // With nothing ticked, enter means the row it is pressed on.
            const ids = picks.size ? picks : new Set([item.value]);
            install(list.filter((e) => ids.has(e.id)));
          }}
        />
      </Panel>
    );
  }

  const failure = check?.reason ? checkFailure(check) : null;
  const { sub, tight, room } = panelRoom({ rows, width, subtitle: failure || '' });
  const items = homeItems({ check, blocked, editors, vsix, pending });
  return (
    <Panel
      width={width}
      title="Update"
      status={checkStatus(check)}
      statusTone={check?.reason ? 'attention' : null}
      sub={sub}
      tight={tight}
      keys="↑↓ move · enter choose · esc close"
    >
      <Choices
        limit={room}
        items={items}
        onSelect={(item) => {
          if (item.value === 'pull') { onPull(); return; }
          if (item.value === 'editors') { setView(editors?.length ? 'editors' : 'other'); return; }
          clearPendingReload();
          setPending(null);
        }}
      />
    </Panel>
  );
}
