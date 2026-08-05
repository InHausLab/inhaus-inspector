import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHEET_CELL_SAFE_CHARS,
  buildFormattedReviewRows,
  buildRawAppRows,
  buildRawReviewRows
} from '../workers/inhaus-photo-worker/src/index.js';

test('raw review data preserves oversized values in ordered sheet-safe parts', () => {
  const fieldData = {
    normal: 'saved value',
    system: {
      inspectionRecovery: {
        payload: 'x'.repeat(1_100_000),
        note: 'preserve me'
      }
    }
  };
  const rows = buildRawReviewRows(fieldData);
  const systemRows = rows.filter(row => row[0] === 'system');
  const expected = JSON.stringify(fieldData.system);

  assert.ok(systemRows.length > 1);
  assert.ok(systemRows.every(row => row[1].length <= SHEET_CELL_SAFE_CHARS));
  assert.match(systemRows[0][2], /^json part 1\/\d+$/);
  assert.equal(systemRows.map(row => row[1]).join(''), expected);
  assert.deepEqual(rows.find(row => row[0] === 'normal'), ['normal', 'saved value', 'string']);
});

test('formatted review data points to the raw safety files instead of embedding a giant snapshot', () => {
  const fieldData = {
    reportBuilderNotes: 'Ready for Tanner',
    system: {
      inspectionRecovery: { payload: 'x'.repeat(1_100_000) },
      startInspectionShell: { status: 'ready' }
    }
  };
  const rows = buildFormattedReviewRows(fieldData);
  const recoveryRow = rows.find(row => row[1] === 'inspectionRecovery');

  assert.ok(recoveryRow);
  assert.match(recoveryRow[2], /Raw Review Data and the raw JSON backup/);
  assert.ok(rows.flat().every(value => String(value).length <= SHEET_CELL_SAFE_CHARS));
  assert.equal(rows.some(row => String(row[2]).includes('x'.repeat(1000))), false);
});

test('raw app data preserves oversized recovery values in sheet-safe parts', () => {
  const oversized = `start-${'z'.repeat(SHEET_CELL_SAFE_CHARS * 2)}-end`;
  const rows = buildRawAppRows({ system: { inspectionRecovery: { stepData: oversized } } });
  const parts = rows.slice(1).filter(row => row[0] === 'stepData');

  assert.ok(parts.length > 1);
  assert.equal(parts.map(row => row[1]).join(''), oversized);
  assert.ok(parts.every(row => row[1].length <= SHEET_CELL_SAFE_CHARS));
});
