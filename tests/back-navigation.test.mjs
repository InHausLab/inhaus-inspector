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

test('Back accepts one step change per touch window', () => {
  let now = 1000;
  let renderCount = 0;
  const context = {
    Date: { now: () => now },
    STEP_BACK_LOCK_MS: 700,
    _stepBackLockedUntil: 0,
    ctx: { currentStepIdx: 5, render: () => { renderCount += 1; } },
    window: { scrollTo: () => {} }
  };
  vm.runInNewContext(`${extractFunction(screensSource, 'navigateBackOneStep')}; this.navigate = navigateBackOneStep;`, context);

  const firstButton = { disabled: false };
  context.navigate({ currentTarget: firstButton });
  context.navigate({ currentTarget: { disabled: false } });
  assert.equal(context.ctx.currentStepIdx, 4);
  assert.equal(renderCount, 1);
  assert.equal(firstButton.disabled, true);

  now += 701;
  context.navigate({ currentTarget: { disabled: false } });
  assert.equal(context.ctx.currentStepIdx, 3);
  assert.equal(renderCount, 2);
});

test('step Back no longer uses an unguarded decrement handler', () => {
  assert.match(screensSource, /onClick: navigateBackOneStep/);
  assert.doesNotMatch(screensSource, /onClick:\s*\(\)\s*=>\s*\{\s*ctx\.currentStepIdx--/);
});
