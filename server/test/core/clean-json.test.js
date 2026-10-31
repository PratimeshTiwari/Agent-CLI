/**
 * Raw control characters inside a tool call's strings (v8.1). Reported: a
 * 10k-character `edit_file` failed with "Bad control character in string
 * literal" — the old regex paired quotes without knowing `\"`, so the
 * newlines after the first escaped quote were left raw.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentLoop } from '../../src/core/agent-loop.js';

const clean = (s) => AgentLoop.prototype._cleanJsonString(s);

test('newlines after an escaped quote are escaped too', () => {
  const raw = '{"name": "edit_file", "args": {"oldText": "say \\"hi\\"\nthen\n\tmore", "newText": "a\r\nb"}}';
  assert.throws(() => JSON.parse(raw));
  const parsed = JSON.parse(clean(raw));
  assert.equal(parsed.args.oldText, 'say "hi"\nthen\n\tmore');
  assert.equal(parsed.args.newText, 'a\r\nb');
});

test('a backslash at the end of a string, and structure outside strings, are left alone', () => {
  const raw = '{\n  "path": "C:\\\\dir\\\\",\n  "n": 1\n}';
  assert.deepEqual(JSON.parse(clean(raw)), { path: 'C:\\dir\\', n: 1 });
});

test('valid JSON comes back byte for byte', () => {
  const ok = JSON.stringify({ a: 'x\ny "z"', b: [1, { c: '\\' }] }, null, 2);
  assert.equal(clean(ok), ok);
});

test('other control characters become \\u escapes', () => {
  assert.equal(JSON.parse(clean('{"a": "x\u0001y"}')).a, 'x\u0001y');
});
