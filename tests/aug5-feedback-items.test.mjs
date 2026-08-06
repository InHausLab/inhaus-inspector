import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ui = fs.readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
const inspection = fs.readFileSync(new URL('../inspection.js', import.meta.url), 'utf8');
const storage = fs.readFileSync(new URL('../storage.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('photo cards offer the common photo types requested by the inspector', () => {
  assert.match(ui, /Photo type/);
  assert.match(ui, /Zoomed-out overview/);
  assert.match(ui, /Location \/ context/);
  assert.match(ui, /Area of concern \/ fault/);
  assert.match(ui, /Close-up detail/);
});

test('selecting a photo type preserves inspector detail and prefills only an empty caption', () => {
  assert.match(ui, /!String\(p\.caption \|\| ''\)\.trim\(\)/);
  assert.match(ui, /p\.caption = p\.photoPurposeLabel/);
  assert.match(ui, /photoPurpose: p\.photoPurpose/);
  assert.match(ui, /photoPurposeLabel: p\.photoPurposeLabel/);
  assert.match(ui, /window\.updatePhotoMetadata\(p, inspectionId\)/);
  assert.match(app, /window\.updatePhotoMetadata = updatePhotoMetadata/);
});

test('photo type metadata survives local backup and inspection export', () => {
  assert.match(inspection, /photoPurpose: p\.photoPurpose \|\| ''/);
  assert.match(inspection, /photoPurposeLabel: p\.photoPurposeLabel \|\| ''/);
  assert.match(storage, /photoPurpose: p\.photoPurpose \|\| ''/);
  assert.match(storage, /photoPurposeLabel: p\.photoPurposeLabel \|\| ''/);
});
