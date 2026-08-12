import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

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

function loadResumeScreenHelper() {
  const context = {
    RESTORABLE_SCREENS: new Set(['truck-check', 'intake', 'precheck', 'step', 'photos', 'team'])
  };
  vm.runInNewContext(`${extractFunction(appSource, 'resumeScreenForSavedPosition')}; this.pick = resumeScreenForSavedPosition;`, context);
  return context.pick;
}

test('a newly claimed inspection cannot resume back into the cloud picker', () => {
  const pick = loadResumeScreenHelper();
  assert.equal(pick({ screen: 'cloud-resume' }, { _lastStepIdx: 0, stepData: {} }), 'precheck');
});

test('an established inspection saved on the cloud picker resumes field work', () => {
  const pick = loadResumeScreenHelper();
  assert.equal(pick({ screen: 'cloud-resume' }, {
    _lastStepIdx: 4,
    stepData: { arrival: { _visited: true } }
  }), 'step');
});

test('normal field resume screens remain unchanged', () => {
  const pick = loadResumeScreenHelper();
  assert.equal(pick({ screen: 'team' }, { stepData: {} }), 'team');
  assert.equal(pick({ screen: 'unexpected' }, { stepData: {} }), 'step');
});
