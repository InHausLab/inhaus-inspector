const STORAGE_KEY = 'hans-workbench-v1';
const LEGACY_STORAGE_KEY = 'hans-workbench-v0';
const STUCK_WARNING_MINUTES = 30;
const TOKEN_WARNING_COUNT = 80000;
const TOKEN_HARD_COUNT = 120000;
const FAILURE_PLAN_COUNT = 2;
const FAILURE_STOP_COUNT = 3;
const EM_DASH = '\u2014';

const PROTOCOL_STAGES = [
  {
    label: 'DIAGNOSED',
    description: 'Root cause is identified with evidence. No patch or fix claim yet.'
  },
  {
    label: 'PATCHED',
    description: 'A change was made. Verification is still required before claiming success.'
  },
  {
    label: 'VERIFIED',
    description: 'Evidence proves the intended behavior works in the checked environment.'
  },
  {
    label: 'DEPLOYED',
    description: 'The verified change is live in the target environment.'
  },
  {
    label: 'MONITORED',
    description: 'Post-deploy observation or follow-up confirmed no regression.'
  }
];

const REQUIRED_FINAL_LABELS = [
  'VERIFIED',
  'PARTIALLY VERIFIED',
  'CHANGE APPLIED NOT VERIFIED',
  'BLOCKED',
  'STOPPED AFTER 3 FAILURES'
];

const EVIDENCE_REQUIRED_STAGES = ['PATCHED', 'VERIFIED', 'DEPLOYED', 'MONITORED'];
const EVIDENCE_REQUIRED_FINAL_LABELS = [
  'VERIFIED',
  'PARTIALLY VERIFIED',
  'CHANGE APPLIED NOT VERIFIED'
];

const fields = {};
let state = loadState();
let activeOutput = 'handoff';

document.addEventListener('DOMContentLoaded', () => {
  bindFields();
  bindEvents();
  if (!state.tasks.length) createTask(seedTask());
  if (!state.selectedId) state.selectedId = state.tasks[0].id;
  render();
  setInterval(renderSession, 60000);
});

function bindFields() {
  [
    'title',
    'owner',
    'objective',
    'mode',
    'verificationSteps',
    'stuckMinutes',
    'contextTokens',
    'newTopic',
    'expectedEvidence',
    'liveSystem',
    'delegationDecision',
    'urlText',
    'urlsVerified',
    'requiresVisibility',
    'visibilityPlan',
    'doNotBreak',
    'accounts',
    'currentState',
    'exactChanges',
    'rollbackPlan',
    'staleMemory',
    'verificationLabel',
    'finalLabel',
    'evidence',
    'finalResponse',
    'notes'
  ].forEach(id => fields[id] = document.getElementById(id));
}

function bindEvents() {
  document.getElementById('task-form').addEventListener('submit', event => event.preventDefault());

  document.getElementById('new-task-btn').addEventListener('click', () => {
    const task = createTask();
    state.selectedId = task.id;
    saveState();
    render();
    fields.title.focus();
  });

  document.getElementById('reset-session-btn').addEventListener('click', () => {
    state.sessionStartedAt = new Date().toISOString();
    saveState();
    render();
  });

  document.getElementById('add-failure-btn').addEventListener('click', addFailure);
  document.getElementById('reset-failures-btn').addEventListener('click', resetFailures);
  document.getElementById('mark-done-btn').addEventListener('click', markDone);
  document.getElementById('reopen-btn').addEventListener('click', reopenTask);
  document.getElementById('copy-output-btn').addEventListener('click', copyOutput);

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeOutput = btn.dataset.output;
      updateActiveTab();
      renderOutput();
    });
  });

  Object.entries(fields).forEach(([key, field]) => {
    field.addEventListener('input', () => updateTaskFromField(key, field));
    field.addEventListener('change', () => updateTaskFromField(key, field));
  });
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || '{}';
    const parsed = JSON.parse(raw);
    return {
      sessionStartedAt: parsed.sessionStartedAt || new Date().toISOString(),
      selectedId: parsed.selectedId || '',
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTask) : []
    };
  } catch (err) {
    return { sessionStartedAt: new Date().toISOString(), selectedId: '', tasks: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const save = document.getElementById('save-state');
  if (save) {
    save.textContent = 'Saved';
    window.clearTimeout(save._timer);
    save._timer = window.setTimeout(() => { save.textContent = 'Saved'; }, 700);
  }
}

function seedTask() {
  return {
    title: 'Apps Script auth fix for report viewer',
    objective: 'Use this task as the first real test of the Workbench before touching the report-viewer auth problem.',
    owner: 'Hans',
    mode: 'Verify',
    liveSystem: true,
    expectedEvidence: 'Working endpoint response, verified report link, and exact evidence before claiming fixed.',
    verificationSteps: 4,
    delegationDecision: 'Codex recommended',
    verificationLabel: 'DIAGNOSED',
    finalLabel: 'BLOCKED',
    doNotBreak: 'Do not change the field inspector workflow while working on report-viewer auth.',
    currentState: 'Workbench v1 should create a handoff before live-system execution.'
  };
}

function createTask(overrides = {}) {
  const task = normalizeTask({
    id: makeId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: '',
    objective: '',
    owner: 'Hans',
    mode: 'Think',
    verificationSteps: 0,
    stuckMinutes: 0,
    contextTokens: 0,
    newTopic: false,
    expectedEvidence: '',
    liveSystem: false,
    delegationDecision: 'Not assessed',
    urlText: '',
    urlsVerified: false,
    requiresVisibility: false,
    visibilityPlan: '',
    doNotBreak: '',
    accounts: '',
    currentState: '',
    exactChanges: '',
    rollbackPlan: '',
    failures: [],
    staleMemory: '',
    verificationLabel: '',
    finalLabel: '',
    evidence: '',
    finalResponse: '',
    notes: '',
    done: false,
    ...overrides
  });
  state.tasks.unshift(task);
  state.selectedId = task.id;
  saveState();
  return task;
}

function normalizeTask(task) {
  const normalized = {
    id: task.id || makeId(),
    createdAt: task.createdAt || new Date().toISOString(),
    updatedAt: task.updatedAt || new Date().toISOString(),
    title: task.title || '',
    objective: task.objective || '',
    owner: task.owner || 'Hans',
    mode: task.mode || 'Think',
    verificationSteps: Number(task.verificationSteps || 0),
    stuckMinutes: Number(task.stuckMinutes || 0),
    contextTokens: Number(task.contextTokens || 0),
    newTopic: Boolean(task.newTopic),
    expectedEvidence: task.expectedEvidence || '',
    liveSystem: Boolean(task.liveSystem),
    delegationDecision: task.delegationDecision || 'Not assessed',
    urlText: task.urlText || '',
    urlsVerified: Boolean(task.urlsVerified),
    requiresVisibility: Boolean(task.requiresVisibility),
    visibilityPlan: task.visibilityPlan || '',
    doNotBreak: task.doNotBreak || '',
    accounts: task.accounts || '',
    currentState: task.currentState || '',
    exactChanges: task.exactChanges || '',
    rollbackPlan: task.rollbackPlan || '',
    failures: Array.isArray(task.failures) ? task.failures : [],
    staleMemory: task.staleMemory || '',
    verificationLabel: task.verificationLabel || '',
    finalLabel: task.finalLabel || '',
    evidence: task.evidence || '',
    finalResponse: task.finalResponse || '',
    notes: task.notes || '',
    done: Boolean(task.done)
  };

  if (!PROTOCOL_STAGES.some(stage => stage.label === normalized.verificationLabel)) {
    const oldLabel = String(task.verificationLabel || '');
    if (oldLabel === 'CHANGE APPLIED') {
      normalized.verificationLabel = 'PATCHED';
      normalized.finalLabel = normalized.finalLabel || 'CHANGE APPLIED NOT VERIFIED';
    } else if (oldLabel === 'PARTIALLY VERIFIED') {
      normalized.verificationLabel = 'VERIFIED';
      normalized.finalLabel = normalized.finalLabel || 'PARTIALLY VERIFIED';
    } else if (oldLabel === 'UNVERIFIED') {
      normalized.verificationLabel = 'DIAGNOSED';
      normalized.finalLabel = normalized.finalLabel || 'BLOCKED';
    } else if (oldLabel === 'VERIFIED') {
      normalized.verificationLabel = 'VERIFIED';
      normalized.finalLabel = normalized.finalLabel || 'VERIFIED';
    } else {
      normalized.verificationLabel = '';
    }
  }

  if (!REQUIRED_FINAL_LABELS.includes(normalized.finalLabel)) {
    normalized.finalLabel = '';
  }

  return normalized;
}

function makeId() {
  return 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function currentTask() {
  return state.tasks.find(task => task.id === state.selectedId) || state.tasks[0];
}

function updateTaskFromField(key, field) {
  const task = currentTask();
  if (!task) return;
  if (field.type === 'checkbox') task[key] = field.checked;
  else if (field.type === 'number') task[key] = Number(field.value || 0);
  else task[key] = field.value;

  if (key === 'requiresVisibility' && field.checked) {
    activeOutput = 'handoff';
    if (task.delegationDecision === 'Not assessed') task.delegationDecision = 'Codex recommended';
    if (task.mode !== 'Delegate') task.mode = 'Delegate';
  }

  task.updatedAt = new Date().toISOString();
  task.done = false;
  saveState();
  renderForm();
  renderDerived();
}

function addFailure() {
  const task = currentTask();
  const input = document.getElementById('failure-note');
  const note = input.value.trim();
  if (!task || !note) return;
  task.failures.push({ at: new Date().toISOString(), note });
  task.updatedAt = new Date().toISOString();
  task.done = false;
  if (task.failures.length >= FAILURE_STOP_COUNT) task.finalLabel = 'STOPPED AFTER 3 FAILURES';
  input.value = '';
  saveState();
  render();
}

function resetFailures() {
  const task = currentTask();
  if (!task) return;
  task.failures = [];
  if (task.finalLabel === 'STOPPED AFTER 3 FAILURES') task.finalLabel = '';
  task.updatedAt = new Date().toISOString();
  task.done = false;
  saveState();
  render();
}

function markDone() {
  const task = currentTask();
  if (!task) return;
  const gate = evaluateTask(task);
  if (!gate.canComplete) {
    renderDerived();
    return;
  }
  task.done = true;
  task.updatedAt = new Date().toISOString();
  saveState();
  render();
}

function reopenTask() {
  const task = currentTask();
  if (!task) return;
  task.done = false;
  task.updatedAt = new Date().toISOString();
  saveState();
  render();
}

function render() {
  renderTaskList();
  renderForm();
  renderDerived();
  renderSession();
}

function renderTaskList() {
  const list = document.getElementById('task-list');
  const count = document.getElementById('task-count');
  count.textContent = String(state.tasks.length);
  list.innerHTML = '';

  state.tasks.forEach(task => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'task-item' + (task.id === state.selectedId ? ' active' : '');
    const label = task.finalLabel || task.verificationLabel || 'No label';
    btn.innerHTML = `<strong>${escapeHTML(task.title || 'Untitled task')}</strong><span>${escapeHTML(label)} / ${task.done ? 'Done' : 'Open'}</span>`;
    btn.addEventListener('click', () => {
      state.selectedId = task.id;
      saveState();
      render();
    });
    list.appendChild(btn);
  });
}

function renderForm() {
  const task = currentTask();
  if (!task) return;
  Object.entries(fields).forEach(([key, field]) => {
    if (field.type === 'checkbox') field.checked = !!task[key];
    else field.value = task[key] == null ? '' : task[key];
  });
}

function renderDerived() {
  const task = currentTask();
  if (!task) return;
  const gate = evaluateTask(task);
  const nudge = document.getElementById('delegation-nudge');
  nudge.hidden = !task.liveSystem && !task.requiresVisibility;
  nudge.textContent = task.requiresVisibility
    ? 'Phone/browser visibility requires Codex handoff before any attempt.'
    : 'Should this be delegated to Codex?';
  renderStageHelp(task);
  renderGates(gate);
  renderFailures(task);
  renderDoneState(task, gate);
  renderTaskList();
  updateActiveTab();
  renderOutput();
  renderSession();
}

function renderSession() {
  const panel = document.getElementById('session-panel');
  const task = currentTask();
  const elapsed = elapsedMinutes();
  const tokens = Number(task && task.contextTokens || 0);
  const stuck = Number(task && task.stuckMinutes || 0);
  let className = 'gate-pill ok';
  let label = 'Session clear';
  let copy = `${elapsed} minutes since session reset.`;

  if (tokens >= TOKEN_HARD_COUNT) {
    className = 'gate-pill blocked';
    label = '120K context stop';
    copy = task && task.newTopic
      ? 'Hard stop on new topics. Start a clean session before continuing.'
      : '120K context threshold reached. Do not start new topics here.';
  } else if (tokens >= TOKEN_WARNING_COUNT) {
    className = 'gate-pill warn';
    label = '80K context warning';
    copy = 'Prepare a handoff or end-of-session summary before more execution work.';
  } else if (stuck >= STUCK_WARNING_MINUTES) {
    className = 'gate-pill warn';
    label = '30-minute stuck flag';
    copy = 'Stop momentum, diagnose, and hand off or ask before another blind attempt.';
  }

  panel.innerHTML = `
    <div class="status-title">
      <strong>Session guard</strong>
      <span class="${className}">${label}</span>
    </div>
    <div class="status-copy">${escapeHTML(copy)}</div>
  `;
}

function elapsedMinutes() {
  const started = new Date(state.sessionStartedAt).getTime();
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.round((Date.now() - started) / 60000));
}

function evaluateTask(task) {
  const blocks = [];
  const warnings = [];
  const oks = [];
  const hasEvidence = Boolean(String(task.evidence || '').trim());
  const hasUrls = /https?:\/\//i.test(task.urlText || '');
  const failureCount = task.failures.length;
  const scan = scanFinalOutput(task);

  if (!task.title.trim()) blocks.push('Task title is required.');
  else oks.push('Task title exists.');

  if (!task.objective.trim()) warnings.push('Objective is empty.');
  else oks.push('Objective exists.');

  if (!task.verificationLabel) blocks.push('Protocol stage is required before closeout.');
  else oks.push(`Protocol stage selected: ${task.verificationLabel}.`);

  if (!task.finalLabel) blocks.push('Final closeout label is required before closeout.');
  else oks.push(`Final closeout label selected: ${task.finalLabel}.`);

  if (EVIDENCE_REQUIRED_STAGES.includes(task.verificationLabel) && !hasEvidence) {
    blocks.push(`${task.verificationLabel} requires evidence before closeout.`);
  }

  if (EVIDENCE_REQUIRED_FINAL_LABELS.includes(task.finalLabel) && !hasEvidence) {
    blocks.push(`${task.finalLabel} requires evidence before closeout.`);
  }

  if (task.finalLabel === 'STOPPED AFTER 3 FAILURES' && failureCount < FAILURE_STOP_COUNT) {
    blocks.push('STOPPED AFTER 3 FAILURES requires three recorded failures.');
  }

  if (failureCount >= FAILURE_PLAN_COUNT && failureCount < FAILURE_STOP_COUNT) {
    warnings.push('Two failures reached. Announce diagnosis and plan before another attempt.');
  }

  if (failureCount >= FAILURE_STOP_COUNT) {
    if (task.finalLabel !== 'STOPPED AFTER 3 FAILURES') {
      blocks.push('Three-failure stop reached. Use STOPPED AFTER 3 FAILURES and hand off.');
    } else {
      oks.push('Three-failure stop label is active.');
    }
    blocks.push('STOPPED AFTER 3 FAILURES. Hard block further execution and hand off.');
  }

  if (task.requiresVisibility) {
    blocks.push('Phone/browser visibility requires immediate Codex handoff before any attempt.');
  }

  if (hasUrls && !task.urlsVerified && ['VERIFIED', 'DEPLOYED', 'MONITORED'].includes(task.verificationLabel)) {
    blocks.push('URLs are present but not marked verified.');
  } else if (hasUrls && !task.urlsVerified) {
    warnings.push('URLs are present and not marked verified.');
  }

  if (Number(task.verificationSteps || 0) > 3) {
    warnings.push('More than 3 verification/tool steps expected. Codex/subagent recommended.');
  }

  if (Number(task.stuckMinutes || 0) >= STUCK_WARNING_MINUTES && !['BLOCKED', 'STOPPED AFTER 3 FAILURES'].includes(task.finalLabel)) {
    blocks.push('30-minute stuck rule reached. Use BLOCKED or hand off before more execution.');
  }

  if (Number(task.contextTokens || 0) >= TOKEN_HARD_COUNT && task.newTopic) {
    blocks.push('120K context threshold reached. Hard stop on new topics.');
  } else if (Number(task.contextTokens || 0) >= TOKEN_HARD_COUNT) {
    warnings.push('120K context threshold reached. Do not start new topics here.');
  } else if (Number(task.contextTokens || 0) >= TOKEN_WARNING_COUNT) {
    warnings.push('80K context warning. Prepare handoff or summary.');
  }

  if (task.liveSystem && task.delegationDecision === 'Not assessed') {
    warnings.push('Live system involved. Delegation decision not assessed.');
  }

  if (task.liveSystem && task.owner === 'Hans' && task.mode === 'Execute') {
    warnings.push('Hans is executing live-system work. Codex handoff should be considered.');
  }

  if (task.staleMemory.trim()) {
    warnings.push('Stale-memory correction is recorded. Create/update memory note after task.');
  }

  scan.blocks.forEach(item => blocks.push(item));
  scan.warnings.forEach(item => warnings.push(item));
  scan.oks.forEach(item => oks.push(item));

  if (!blocks.length && !warnings.length) oks.push('No active gate warnings.');

  return {
    blocks,
    warnings,
    oks,
    canComplete: blocks.length === 0,
    status: blocks.length ? 'blocked' : warnings.length ? 'warn' : 'ok'
  };
}

function scanFinalOutput(task) {
  const blocks = [];
  const warnings = [];
  const oks = [];
  const hasEvidence = Boolean(String(task.evidence || '').trim());
  const draft = getFinalDraft(task);
  const trimmed = draft.trim();
  const lower = draft.toLowerCase();

  if (!trimmed) {
    blocks.push('Final response draft or generated final output is required.');
    return { blocks, warnings, oks };
  }

  if (/\bhonest(?:ly)?\b/i.test(draft)) {
    blocks.push('Final response scan failed: "honest" / "honestly" is banned.');
  }

  if (draft.includes(EM_DASH)) {
    warnings.push('Final response scan warning: em dash detected.');
  }

  if (/\bfixed\b/i.test(draft) && !hasEvidence) {
    blocks.push('Final response scan failed: "fixed" appears without evidence.');
  }

  if (/\b(working|deployed|resolved|complete)\b/i.test(draft) && !hasEvidence) {
    blocks.push('Final response scan failed: success claim appears without evidence.');
  }

  if (['BLOCKED', 'STOPPED AFTER 3 FAILURES'].includes(task.finalLabel) && /\b(fixed|working|deployed|verified|resolved|complete)\b/i.test(lower)) {
    blocks.push('Final response scan failed: blocked/stopped response contains success language.');
  }

  if (task.finalLabel === 'CHANGE APPLIED NOT VERIFIED' && /\b(working|deployed|resolved)\b/i.test(lower)) {
    blocks.push('Final response scan failed: unverified change cannot claim working/deployed/resolved.');
  }

  if (task.finalLabel && !endsWithSelectedFinalLabel(trimmed, task.finalLabel)) {
    blocks.push('Final response must end with the selected closeout label.');
  } else if (task.finalLabel) {
    oks.push('Final response ends with selected closeout label.');
  }

  return { blocks, warnings, oks };
}

function getFinalDraft(task) {
  return String(task.finalResponse || makeFinalTemplate(task) || '');
}

function endsWithSelectedFinalLabel(text, selectedLabel) {
  return REQUIRED_FINAL_LABELS.includes(selectedLabel) && text.endsWith(selectedLabel);
}

function renderStageHelp(task) {
  const help = document.getElementById('stage-help');
  help.innerHTML = '';
  PROTOCOL_STAGES.forEach(stage => {
    const row = document.createElement('div');
    row.className = 'stage-line' + (task.verificationLabel === stage.label ? ' active' : '');
    row.textContent = `${stage.label}: ${stage.description}`;
    help.appendChild(row);
  });
}

function renderGates(gate) {
  const result = document.getElementById('gate-result');
  result.className = 'gate-pill ' + gate.status;
  result.textContent = gate.status === 'blocked' ? 'Blocked' : gate.status === 'warn' ? 'Needs attention' : 'Clear';

  const list = document.getElementById('gate-list');
  list.innerHTML = '';
  [
    ...gate.blocks.map(text => ({ text, type: 'blocked' })),
    ...gate.warnings.map(text => ({ text, type: 'warn' })),
    ...gate.oks.map(text => ({ text, type: 'ok' }))
  ].forEach(item => {
    const row = document.createElement('div');
    row.className = 'gate-item ' + item.type;
    row.textContent = item.text;
    list.appendChild(row);
  });
}

function renderFailures(task) {
  const count = document.getElementById('failure-count');
  const total = task.failures.length;
  count.textContent = `${total} failure${total === 1 ? '' : 's'}`;
  count.className = 'gate-pill ' + (total >= FAILURE_STOP_COUNT ? 'blocked' : total >= FAILURE_PLAN_COUNT ? 'warn' : total ? 'warn' : 'ok');

  const log = document.getElementById('failure-log');
  log.innerHTML = '';
  if (!total) return;
  task.failures.forEach((failure, index) => {
    const entry = document.createElement('div');
    entry.className = 'failure-entry';
    entry.textContent = `${index + 1}. ${failure.note} (${formatDateTime(failure.at)})`;
    log.appendChild(entry);
  });
}

function renderDoneState(task, gate) {
  const stateEl = document.getElementById('done-state');
  stateEl.textContent = task.done ? 'Done' : 'Not done';
  stateEl.className = 'gate-pill ' + (task.done ? 'ok' : gate.status);
  document.getElementById('mark-done-btn').disabled = !gate.canComplete;
}

function updateActiveTab() {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.output === activeOutput));
}

function renderOutput() {
  const output = document.getElementById('output-text');
  const task = currentTask();
  if (!task) {
    output.value = '';
    return;
  }
  if (activeOutput === 'handoff') output.value = makeHandoff(task);
  if (activeOutput === 'final') output.value = makeFinalTemplate(task);
  if (activeOutput === 'summary') output.value = makeSessionSummary();
  if (activeOutput === 'memory') output.value = makeMemoryCorrection(task);
}

function makeHandoff(task) {
  return [
    '# Codex Handoff Brief',
    '',
    '## Problem',
    task.objective || task.title || '[missing]',
    '',
    '## Do Not Break',
    task.doNotBreak || '[missing]',
    '',
    '## Accounts / Access',
    task.accounts || '[none recorded]',
    '',
    '## Current State',
    task.currentState || task.notes || '[missing]',
    '',
    '## Exact Changes Needed',
    task.exactChanges || '[missing]',
    '',
    '## Verification Steps',
    makeVerificationSteps(task),
    '',
    '## Rollback',
    task.rollbackPlan || '[missing]',
    '',
    '## Attempt History',
    makeAttemptHistory(task),
    '',
    '## Protocol State',
    `Owner: ${task.owner}`,
    `Mode: ${task.mode}`,
    `Live system: ${task.liveSystem ? 'Yes' : 'No'}`,
    `Phone/browser handoff required: ${task.requiresVisibility ? 'Yes' : 'No'}`,
    `Protocol stage: ${task.verificationLabel || '[not selected]'}`,
    `Final label: ${task.finalLabel || '[not selected]'}`,
    `Evidence: ${task.evidence || '[none yet]'}`
  ].join('\n');
}

function makeVerificationSteps(task) {
  const lines = [];
  lines.push(task.expectedEvidence || '[expected evidence missing]');
  lines.push(`Expected verification/tool steps: ${task.verificationSteps || 0}`);
  if (task.urlText) lines.push(`URLs to verify before sending: ${task.urlText}`);
  if (task.visibilityPlan) lines.push(`Visibility plan: ${task.visibilityPlan}`);
  return lines.join('\n');
}

function makeAttemptHistory(task) {
  if (!task.failures.length) return 'No failed attempts recorded.';
  return task.failures.map((failure, index) => `${index + 1}. ${failure.note} (${formatDateTime(failure.at)})`).join('\n');
}

function makeFinalTemplate(task) {
  const label = task.finalLabel || 'BLOCKED';
  const lines = [
    `${label}: ${task.title || 'Untitled task'}`,
    '',
    `Protocol stage: ${task.verificationLabel || '[not selected]'}`,
    task.evidence ? `Evidence: ${task.evidence}` : 'Evidence: [none recorded]',
    task.notes ? `Caveats: ${task.notes}` : 'Caveats: [none recorded]',
    task.done ? 'Workbench status: Done.' : 'Workbench status: Not marked done.',
    '',
    label
  ];
  return lines.join('\n');
}

function makeSessionSummary() {
  const done = state.tasks.filter(task => task.done).length;
  const open = state.tasks.length - done;
  const active = currentTask();
  return [
    '# End Of Session Summary',
    '',
    `Session started: ${formatDateTime(state.sessionStartedAt)}`,
    `Elapsed: ${elapsedMinutes()} minutes`,
    `Tasks total: ${state.tasks.length}`,
    `Done: ${done}`,
    `Open: ${open}`,
    '',
    'Current task:',
    active ? `${active.title || 'Untitled task'} / ${active.verificationLabel || 'No stage'} / ${active.finalLabel || 'No final label'} / ${active.done ? 'Done' : 'Open'}` : 'None',
    '',
    'Context flags:',
    active ? `Stuck minutes: ${active.stuckMinutes || 0}` : 'Stuck minutes: 0',
    active ? `Context tokens: ${active.contextTokens || 0}` : 'Context tokens: 0',
    '',
    'Open tasks:',
    ...state.tasks.filter(task => !task.done).map(task => `- ${task.title || 'Untitled task'} (${task.owner}, ${task.mode})`)
  ].join('\n');
}

function makeMemoryCorrection(task) {
  return [
    '# Memory Correction Note',
    '',
    `Task: ${task.title || 'Untitled task'}`,
    '',
    task.staleMemory || '[No stale-memory correction recorded.]',
    '',
    'Evidence:',
    task.evidence || '[none recorded]'
  ].join('\n');
}

async function copyOutput() {
  const output = document.getElementById('output-text');
  output.select();
  try {
    await navigator.clipboard.writeText(output.value);
  } catch (err) {
    document.execCommand('copy');
  }
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function escapeHTML(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}
