/**
 * Up and down in the prompt move between drawn rows, wrapped ones included,
 * and give the key to history only at the top and bottom (v7.9).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { visualRows, rowOf, moveVertical } from '../../src/frontend/prompt-rows.js';

const slices = (text, w) => visualRows(text, w).map((r) => text.slice(r.start, r.end));

test('a long line wraps at the last space that fits, a long word is cut', () => {
  assert.deepEqual(slices('aaa bbb ccc', 8), ['aaa bbb ', 'ccc']);
  assert.deepEqual(slices('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  assert.deepEqual(slices('one\ntwo', 10), ['one', 'two']);
  assert.deepEqual(slices('', 10), ['']);
});

test('at a wrap the caret belongs to the next row', () => {
  const rows = visualRows('aaa bbb ccc', 8);
  assert.equal(rowOf(rows, 7), 0);
  assert.equal(rowOf(rows, 8), 1);
  assert.equal(rowOf(rows, 11), 1);
});

test('up and down move through real lines, keeping the column', () => {
  const text = 'first line\nsecond\nthird line';
  assert.equal(moveVertical(text, 3, 1, 80), 14);             // fir|st → sec|ond
  assert.equal(moveVertical(text, 9, 1, 80), 17);             // past "second": its end
  assert.equal(moveVertical(text, 14, -1, 80), 3);
});

test('and through the rows of one wrapped line', () => {
  const text = 'aaa bbb ccc';
  assert.equal(moveVertical(text, 10, -1, 8), 2);             // cc|c → aa|a
  assert.equal(moveVertical(text, 2, 1, 8), 10);
  // The end of a wrapped row is the next row's start: stop one short of it.
  assert.equal(moveVertical(text, 11, -1, 8), 3);
});

test('at the top or bottom row the key is history\'s', () => {
  assert.equal(moveVertical('one line', 4, -1, 80), null);
  assert.equal(moveVertical('one line', 4, 1, 80), null);
  assert.equal(moveVertical('a\nb', 0, -1, 80), null);
  assert.equal(moveVertical('a\nb', 3, 1, 80), null);
  assert.equal(moveVertical('', 0, -1, 80), null);
});
