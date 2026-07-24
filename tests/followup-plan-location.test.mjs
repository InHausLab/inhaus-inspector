import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const steps = readFileSync(new URL('../steps.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
const fields = readFileSync(new URL('../fields.js', import.meta.url), 'utf8');

test('AI follow-up plan generator is not rendered in the inspector app', () => {
  assert.doesNotMatch(steps, /type: 'ai-followup-plan'/);
  assert.doesNotMatch(ui, /Generate Follow-Up Plan/);
});

test('room-level follow-up capture remains in the inspector app', () => {
  assert.match(fields, /yesno\('followUpNeeded', 'Follow-up recommended\?'\)/);
  assert.match(fields, /followUpTimeframe/);
  assert.match(fields, /followUpNote/);
  assert.match(fields, /_followUpPhotos/);
});

test('customer debrief data remains intact after moving the generator', () => {
  assert.match(steps, /yesno\('debriefCompleted', 'Debrief completed'\)/);
  assert.match(steps, /yesno\('radonPickupReminder', 'Homeowner reminded about radon pickup'\)/);
  assert.match(steps, /textarea\('debriefNotes', 'Notes from debrief'\)/);
});
