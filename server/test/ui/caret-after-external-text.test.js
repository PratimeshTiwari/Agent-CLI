/**
 * Where the caret lands when text arrives from outside the keyboard.
 *
 * A recalled history entry, an expanded paste, a completed slash command — the
 * caret belongs at the end of what was just handed over, which is where someone
 * carries on typing.
 *
 * **Two mechanisms were doing that, and the redundant one could be wrong.**
 * `App` kept a `cursorRef` and called `toEnd()` on a zero-delay timeout after
 * `setInput`. But `cursorRef.current` is rebuilt during render, so `toEnd`
 * closes over *that render's* value — and the timeout fired before React had
 * re-rendered the field with the new text. It therefore ran
 * `setOffset(previousValue.length)`.
 *
 * Recalling a long entry into an **empty** prompt set the caret to `''.length`
 * — zero — with a long value behind it. `backspace` is the one key that returns
 * early at offset 0, so it silently did nothing while every other key worked,
 * and pressing up/down again repaired it by recalling from a value that was no
 * longer empty. Reported as *"backspace is not working… but working again after
 * I did up and down arrow."*
 *
 * `PromptInput`'s own effect has always done this correctly, against the value
 * that actually arrived.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../src/ui/App.jsx', import.meta.url), 'utf8');
const field = readFileSync(
  new URL('../../src/ui/components/PromptInput.jsx', import.meta.url), 'utf8',
);

/** `setInputAtEnd`'s body. */
const setter = (() => {
  const start = app.indexOf('const setInputAtEnd = React.useCallback(');
  assert.ok(start > -1, 'setInputAtEnd is gone — this test needs rewriting, not deleting');
  return app.slice(start, app.indexOf('}, []);', start));
})();

test('handing text to the prompt does not move the caret from outside', () => {
  assert.doesNotMatch(setter, /toEnd/,
    'the caret is set against a value captured a render ago, which lands on 0 '
    + 'when the prompt was empty — and backspace is silent at 0');
  assert.doesNotMatch(setter, /setTimeout/,
    'a timeout here races the re-render it depends on');
});

test('it still sets the text', () => {
  assert.match(setter, /setInput\(next\)/);
});

/*
 * The mechanism that does the job, which must keep doing it. If this effect
 * goes, the caret stays where it was and the next keystroke lands in the middle
 * of the recalled text — the bug `PromptInput` was written to replace
 * `ink-text-input` over.
 */
test('the field moves its own caret to the end of text it did not produce', () => {
  const effect = field.slice(field.indexOf('useEffect(() => {'), field.indexOf('}, [value]);'));
  assert.match(effect, /selfEdit\.current/,
    'the field cannot tell its own edits from text arriving, so backspacing in '
    + 'the middle of a line would jump the caret to the end');
  assert.match(effect, /setOffset\(value\.length\)/);
});

// And the guard that made the bug silent rather than loud.
test('backspace at offset 0 is a no-op, which is why this was invisible', () => {
  const handler = field.slice(field.indexOf('if (key.backspace || key.delete)'));
  assert.match(handler.slice(0, 120), /if \(offset === 0\) return;/);
});
