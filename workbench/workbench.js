const STORAGE_KEY = 'hans-workbench-v0';
const SESSION_WARNING_MINUTES = 90;
const SESSION_HARD_MINUTES = 180;
const FAILURE_STOP_COUNT = 3;

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
    'expectedEvidence',
    'liveSystem',
    'delegationDecision',
    'urlText',
    'urlsVerified',
    'requiresVisibility',
    'visibilityPlan',
    'staleMemory',
    'verificationLabel',
    'evidence',
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
      document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab === btn));
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
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      sessionStartedAt: parsed.sessionStartedAt || new Date().toISOString(),
      selectedId: parsed.selectedId || '',
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : []
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
    delegationDecision: 'Codex recommended'
  };
}

function createTask(overrides = {}) {
  const task = {
    id: makeId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: '',
    objective: '',
    owner: 'Hans',
    mode: 'Think',
    liveSystem: false,
    expectedEvidence: '',
    verificationSteps: 0,
    delegationDecision: 'Not assessed',
    urlText: '',
    urlsVerified: false,
    requiresVisibility: false,
    visibilityPlan: '',
    failures: [],
    staleMemory: '',
    verificationLabel: '',
    evidence: '',
    notes: '',
    done: false,
    ...overrides
  };
  state.tasks.unshift(task);
  state.selectedId = task.id;
  saveState();
  return task;
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
  task.updatedAt = new Date().toISOString();
  task.done = false;
  saveState();
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
  input.value = '';
  saveState();
  render();
}

function resetFailures() {
  const task = currentTask();
  if (!task) return;
  task.failures = [];
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
    btn.innerHTML = `<strong>${escapeHTML(task.title || 'Untitled task')}</strong><span>${escapeHTML(task.verificationLabel || 'No label')} / ${task.done ? 'Done' : 'Open'}</span>`;
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
  document.getElementById('delegation-nudge').hidden = !task.liveSystem;
  renderGates(gate);
  renderFailures(task);
  renderDoneState(task, gate);
  renderTaskList();
  renderOutput();
}

function renderSession() {
  const panel = document.getElementById('session-panel');
  const elapsed = elapsedMinutes();
  let className = 'gate-pill ok';
  let label = 'Session clear';
  let copy = `${elapsed} minutes since session reset.`;
  if (elapsed >= SESSION_HARD_MINUTES) {
    className = 'gate-pill blocked';
    label = 'Context debt high';
    copy = 'Force a handoff or end-of-session summary before starting more execution work.';
  } else if (elapsed >= SESSION_WARNING_MINUTES) {
    className = 'gate-pill warn';
    label = 'Context debt rising';
    copy = 'Prefer a clean handoff before live-system work or multi-step verification.';
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

  if (!task.title.trim()) blocks.push('Task title is required.');
  else oks.push('Task title exists.');

  if (!task.objective.trim()) warnings.push('Objective is empty.');
  else oks.push('Objective exists.');

  if (!task.verificationLabel) blocks.push('Verification label is required before done.');
  else oks.push(`Verification label selected: ${task.verificationLabel}.`);

  if (task.verificationLabel === 'VERIFIED' && !hasEvidence) {
    blocks.push('VERIFIED requires evidence text, link, command output, or observation.');
  }

  if (task.verificationLabel === 'CHANGE APPLIED' && !hasEvidence) {
    blocks.push('CHANGE APPLIED requires evidence of the change.');
  }

  if (hasUrls && !task.urlsVerified && ['VERIFIED', 'CHANGE APPLIED'].includes(task.verificationLabel)) {
    blocks.push('URLs are present but not marked verified.');
  } else if (hasUrls && !task.urlsVerified) {
    warnings.push('URLs are present and not marked verified.');
  }

  if (task.requiresVisibility && !task.visibilityPlan.trim() && ['VERIFIED', 'CHANGE APPLIED'].includes(task.verificationLabel)) {
    blocks.push('Phone/browser visibility is required, but no verification plan is recorded.');
  } else if (task.requiresVisibility && !task.visibilityPlan.trim()) {
    warnings.push('Phone/browser visibility required.');
  }

  if (failureCount >= FAILURE_STOP_COUNT && ['VERIFIED', 'CHANGE APPLIED'].includes(task.verificationLabel)) {
    blocks.push('Three-failure stop reached. Do not claim verified until reset or handed off.');
  } else if (failureCount >= FAILURE_STOP_COUNT) {
    warnings.push('Three-failure stop reached. Handoff recommended.');
  }

  if (Number(task.verificationSteps || 0) > 3) {
    warnings.push('More than 3 verification/tool steps expected. Codex/subagent recommended.');
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

  if (!blocks.length && !warnings.length) oks.push('No active gate warnings.');

  return {
    blocks,
    warnings,
    oks,
    canComplete: blocks.length === 0,
    status: blocks.length ? 'blocked' : warnings.length ? 'warn' : 'ok'
  };
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
  count.className = 'gate-pill ' + (total >= FAILURE_STOP_COUNT ? 'blocked' : total ? 'warn' : 'ok');

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
  const gate = evaluateTask(task);
  return [
    '# Codex Handoff Brief',
    '',
    `Task: ${task.title || 'Untitled task'}`,
    `Owner: ${task.owner}`,
    `Mode: ${task.mode}`,
    `Live system: ${task.liveSystem ? 'Yes' : 'No'}`,
    `Delegation decision: ${task.delegationDecision}`,
    '',
    'Objective:',
    task.objective || '[missing]',
    '',
    'Expected evidence:',
    task.expectedEvidence || '[missing]',
    '',
    `Verification steps expected: ${task.verificationSteps || 0}`,
    `Verification label: ${task.verificationLabel || '[not selected]'}`,
    '',
    'Current evidence:',
    task.evidence || '[none yet]',
    '',
    'Gate status:',
    ...formatGateLines(gate),
    '',
    'Failures:',
    task.failures.length ? task.failures.map((f, i) => `${i + 1}. ${f.note}`).join('\n') : 'None recorded.',
    '',
    'Constraints:',
    '- Do not claim verified without evidence.',
    '- Stop after three repeated failures and hand back a brief.',
    '- Verify any URL before sending it.',
    '- Use phone/browser proof when visibility is required.',
    '',
    'Notes / caveats:',
    task.notes || '[none]'
  ].join('\n');
}

function makeFinalTemplate(task) {
  return [
    `${task.verificationLabel || 'UNVERIFIED'}: ${task.title || 'Untitled task'}`,
    '',
    task.evidence ? `Evidence: ${task.evidence}` : 'Evidence: [none recorded]',
    task.notes ? `Caveats: ${task.notes}` : 'Caveats: [none recorded]',
    task.done ? 'Status: Done in Workbench.' : 'Status: Not marked done in Workbench.'
  ].join('\n');
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
    active ? `${active.title || 'Untitled task'} / ${active.verificationLabel || 'No label'} / ${active.done ? 'Done' : 'Open'}` : 'None',
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

function formatGateLines(gate) {
  const lines = [];
  if (gate.blocks.length) gate.blocks.forEach(item => lines.push(`BLOCKED: ${item}`));
  if (gate.warnings.length) gate.warnings.forEach(item => lines.push(`WARN: ${item}`));
  if (!gate.blocks.length && !gate.warnings.length) lines.push('CLEAR: No active blockers.');
  return lines;
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
