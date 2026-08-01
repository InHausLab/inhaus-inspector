#!/usr/bin/env node

const args = process.argv.slice(2);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) throw new Error(`unexpected argument: ${item}`);
    const [rawKey, inlineValue] = item.slice(2).split('=', 2);
    const key = rawKey.trim();
    if (!key) throw new Error('empty option name');
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function parseInteger(value, label, { min = 0 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new Error(`${label} must be an integer >= ${min}`);
  }
  return number;
}

function leftPad3(value) {
  return String(value).padStart(3, '0');
}

function computeSeed({ trackerMax, buffer }) {
  const firstReservedNumber = trackerMax + buffer;
  const setvalValue = firstReservedNumber - 1;
  return {
    trackerMax,
    buffer,
    firstReservedNumber,
    firstReservedDisplay: leftPad3(firstReservedNumber),
    setvalValue
  };
}

function renderSql(plan) {
  return `-- InHaus W7 assessment sequence seed plan
-- Tracker max assessment number: ${plan.trackerMax}
-- Buffer: ${plan.buffer}
-- First Worker-reserved assessment number: ${plan.firstReservedDisplay}
--
-- Important:
-- - Run only after the W7 handoff migration is applied.
-- - Run only after verifying the tracker max is still ${plan.trackerMax}.
-- - Do not call nextval() just to test; that consumes a number.
-- - PostgreSQL sequence increments are not rolled back by transactions.
-- - If public.assessment_number_reservations already has rows, verify its max
--   assessment_number is below ${plan.firstReservedNumber} before running this.

select setval('public.assessment_number_sequence', ${plan.setvalValue}, true);

-- Non-consuming verification:
select
  '${plan.firstReservedDisplay}' as expected_next_assessment_number,
  last_value,
  is_called
from public.assessment_number_sequence;
`;
}

function runSelfTest() {
  const plan = computeSeed({ trackerMax: 27, buffer: 5 });
  assert(plan.firstReservedNumber === 32, 'first number uses tracker max + buffer');
  assert(plan.firstReservedDisplay === '032', 'display is 3-digit padded');
  assert(plan.setvalValue === 31, 'setval value makes nextval return first number');
  const sql = renderSql(plan);
  assert(sql.includes("setval('public.assessment_number_sequence', 31, true)"), 'SQL uses safe setval value');
  assert(sql.includes('Do not call nextval() just to test'), 'SQL warns against consuming sequence values');
  console.log('compute-assessment-sequence-seed self-test passed');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function usage() {
  return `Usage:
  node scripts/compute-assessment-sequence-seed.mjs --tracker-max 27 [--buffer 5]
  node scripts/compute-assessment-sequence-seed.mjs --self-test

Purpose:
  Prints the exact SQL to seed public.assessment_number_sequence from the current
  Report Tracker max plus an intentional buffer. This does not read or write live
  systems by itself.`;
}

try {
  const options = parseArgs(args);
  if (options.help || options.h) {
    console.log(usage());
    process.exit(0);
  }
  if (options['self-test']) {
    runSelfTest();
    process.exit(0);
  }

  if (options['tracker-max'] === undefined) throw new Error('missing --tracker-max');
  const trackerMax = parseInteger(options['tracker-max'], '--tracker-max', { min: 0 });
  const buffer = parseInteger(options.buffer === undefined ? 5 : options.buffer, '--buffer', { min: 1 });
  const plan = computeSeed({ trackerMax, buffer });
  console.log(renderSql(plan));
} catch (error) {
  console.error(error.message || String(error));
  console.error('');
  console.error(usage());
  process.exit(1);
}
