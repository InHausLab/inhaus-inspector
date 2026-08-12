import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const screensSource = fs.readFileSync(new URL('../screens.js', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

test('Start New clears a restored inspection before opening intake workflow', () => {
  const calls = [];
  const context = {
    _intakeMode: 'prepare',
    ctx: {
      inspection: { inspectionId: 'INH-OLD-ERIKSEN' },
      render: () => calls.push('render')
    },
    setInspection: value => calls.push(['setInspection', value]),
    clearActivePosition: () => calls.push('clearActivePosition'),
    setScreen: value => calls.push(['setScreen', value])
  };

  vm.runInNewContext(`${extractFunction(screensSource, 'beginNewInspection')}; this.begin = beginNewInspection;`, context);
  context.begin();

  assert.equal(context._intakeMode, 'field');
  assert.equal(context.ctx.inspection, null);
  assert.deepEqual(calls, [
    ['setInspection', null],
    'clearActivePosition',
    ['setScreen', 'truck-check'],
    'render'
  ]);
});

test('Start New button uses the reset-safe handler', () => {
  assert.match(screensSource, /onClick:\s*beginNewInspection[\s\S]{0,80}'Start New Inspection'/);
});
