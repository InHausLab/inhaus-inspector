import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');

test('multi-photo library import renders once after every selected file is saved', () => {
  assert.match(ui, /type: 'file', accept: 'image\/\*', multiple: 'true'/);
  assert.match(ui, /for \(const file of Array\.from\(files\)\)[\s\S]*photos\.push\(newPhoto\)[\s\S]*savedCount\+\+;[\s\S]*if \(savedCount > 0 && window\.showToast\)[\s\S]*section\.replaceWith\(renderPhoto/);
  assert.doesNotMatch(ui, /photos\.push\(newPhoto\);\s*onUpdate\(\);\s*section\.replaceWith/);
});
