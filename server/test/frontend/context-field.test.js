/**
 * The status bar's context meter. The text beside it is `frontend/screen/status-bar.js`'s
 * `contextText` (v6.13), tested in `status-bar.test.js`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

test('the meter: five cells, any context shows one, full is full', async () => {
  const { contextMeter } = await import('../../src/frontend/transcript/status-rows.js');
  assert.equal(contextMeter(0), '▱▱▱▱▱');
  assert.equal(contextMeter(3), '▰▱▱▱▱', 'almost empty must not draw as empty');
  assert.equal(contextMeter(34), '▰▰▱▱▱');
  assert.equal(contextMeter(80), '▰▰▰▰▱');
  assert.equal(contextMeter(100), '▰▰▰▰▰');
  assert.equal(contextMeter(250), '▰▰▰▰▰');
});
