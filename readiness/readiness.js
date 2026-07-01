const STORAGE_KEY = 'openclaw-readiness-v0';
const PASS = 'pass';
const WARN = 'warn';
const FAIL = 'fail';
const BLOCKED = 'blocked';
const UNCHECKED = 'unchecked';

const autoChecks = [
  {
    id: 'field-app-shell',
    title: 'Field app shell',
    detail: 'Inspector app index loads from the current origin.',
    path: '/index.html',
    expect: text => text.includes('InHaus') && text.includes('service-worker.js'),
    critical: true
  },
  {
    id: 'service-worker-bypass',
    title: 'Service worker isolation',
    detail: 'Standalone report, workbench, and readiness routes bypass field-app cache.',
    path: '/service-worker.js',
    expect: text => text.includes("'/readiness'") && text.includes("'/workbench'") && text.includes("'/reports'"),
    critical: true
  },
  {
    id: 'workbench-v1',
    title: 'Hans Workbench v1',
    detail: 'Protocol workbench is live with v1 labels and closeout gates.',
    path: '/workbench/index.html',
    expect: text => text.includes('Hans Operating Workbench') && text.includes('20260701-2') && text.includes('STOPPED AFTER 3 FAILURES'),
    critical: true
  },
  {
    id: 'report-viewer',
    title: 'Report viewer shell',
    detail: 'Standalone report viewer route is available.',
    path: '/reports/report.html',
    expect: text => text.includes('report.js') && text.includes('report.css'),
    critical: true
  },
  {
    id: 'report-static-list',
    title: 'Report static list',
    detail: 'Static fallback report inventory is available.',
    path: '/reports/api/list.json',
    expect: text => {
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : parsed.inspections || parsed.reports || [];
      return Array.isArray(items) && items.length > 0;
    },
    critical: true
  },
  {
    id: 'config-script',
    title: 'Inspector config',
    detail: 'Client config script is present with Google Script URL and sync secret keys.',
    path: '/config.js',
    expect: text => text.includes('GOOGLE_SCRIPT_URL') && text.includes('SYNC_SECRET'),
    critical: true
  },
  {
    id: 'manifest',
    title: 'PWA manifest',
    detail: 'Install/offline manifest is available.',
    path: '/manifest.json',
    expect: text => text.includes('InHaus') || text.includes('manifest'),
    critical: false
  }
];

const manualGates = [
  {
    id: 'gateway',
    title: 'Gateway watchdog',
    detail: 'doctor --fix has run or watchdog status is clean; no 3+ consecutive failures.',
    required: true
  },
  {
    id: 'gog-auth',
    title: 'gog auth',
    detail: 'Confirmed the real keyring value is used, not a redacted display string.',
    required: true
  },
  {
    id: 'apps-script',
    title: 'Apps Script v36',
    detail: 'List/getReview or safe sync smoke test has evidence from the live endpoint.',
    required: true
  },
  {
    id: 'drive-write',
    title: 'Drive write path',
    detail: 'A safe checkpoint/write test landed in the expected Shared Drive location.',
    required: true
  },
  {
    id: 'last-sync',
    title: 'Last inspection sync',
    detail: 'A recent inspection sync has row/folder evidence, not just a UI banner.',
    required: true
  },
  {
    id: 'last-report',
    title: 'Last report render',
    detail: 'A real report URL rendered with sections/photos and can be shown to a person.',
    required: true
  },
  {
    id: 'rollback',
    title: 'Rollback path',
    detail: 'Current commit, deploy target, and rollback command/link are known.',
    required: true
  },
  {
    id: 'user-boundaries',
    title: 'User boundary',
    detail: 'Known who can use what today, and what not to touch without handoff.',
    required: true
  }
];

const failureDrills = [
  {
    id: 'mac-mini-down',
    title: 'Mac mini down',
    detail: 'Hetzner failover path tested or explicitly scheduled before new users.'
  },
  {
    id: 'bad-auth-token',
    title: 'Bad auth token',
    detail: 'System fails closed with a clear message and no false success claim.'
  },
  {
    id: 'drive-permission',
    title: 'Drive permission failure',
    detail: 'Write failure produces evidence and a recovery path.'
  },
  {
    id: 'netlify-delay',
    title: 'Netlify deploy delay',
    detail: 'Operator knows how to distinguish stale edge content from broken code.'
  },
  {
    id: 'broken-link',
    title: 'Broken report link',
    detail: 'URL verification catches a broken viewer link before sending it.'
  },
  {
    id: 'phone-only',
    title: 'Phone-only bug',
    detail: 'Phone/browser visibility rule routes work to Codex before attempts.'
  },
  {
    id: 'failure-stop',
    title: 'Three-failure stop',
    detail: 'Workbench blocks further execution and generates a handoff.'
  }
];

let state = loadState();

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  renderManualSections();
  renderAutoChecks();
  renderSummary();
  runChecks();
});

function bindEvents() {
  document.getElementById('run-checks').addEventListener('click', runChecks);
  document.getElementById('copy-report').addEventListener('click', copyReport);
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      lastRunAt: parsed.lastRunAt || '',
      auto: parsed.auto || {},
      manual: parsed.manual || {},
      drills: parsed.drills || {}
    };
  } catch (err) {
    return { lastRunAt: '', auto: {}, manual: {}, drills: {} };
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

function renderAutoChecks() {
  const wrap = document.getElementById('auto-checks');
  wrap.innerHTML = '';
  autoChecks.forEach(check => {
    const result = state.auto[check.id] || { status: UNCHECKED, message: 'Not run yet.' };
    const row = document.createElement('article');
    row.className = 'check-row';
    row.innerHTML = `
      <div class="row-top">
        <div>
          <div class="row-title">${escapeHTML(check.title)}</div>
          <div class="row-copy">${escapeHTML(check.detail)}</div>
        </div>
        <span class="status-chip ${result.status}">${statusLabel(result.status)}</span>
      </div>
      <div class="row-copy">${escapeHTML(result.message || '')}</div>
    `;
    wrap.appendChild(row);
  });
}

function renderManualSections() {
  renderManualList('manual-gates', manualGates, 'manual');
  renderManualList('failure-drills', failureDrills, 'drills');
}

function renderManualList(containerId, items, bucket) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';
  items.forEach(item => {
    const value = state[bucket][item.id] || { status: UNCHECKED, evidence: '' };
    const row = document.createElement('article');
    row.className = 'manual-row';
    row.innerHTML = `
      <div class="row-top">
        <div>
          <div class="row-title">${escapeHTML(item.title)}</div>
          <div class="row-copy">${escapeHTML(item.detail)}</div>
        </div>
        <span class="status-chip ${value.status}">${statusLabel(value.status)}</span>
      </div>
      <div class="manual-controls">
        <select data-bucket="${bucket}" data-id="${item.id}" aria-label="${escapeHTML(item.title)} status">
          ${statusOptions(value.status)}
        </select>
        <textarea data-bucket="${bucket}" data-id="${item.id}" aria-label="${escapeHTML(item.title)} evidence" placeholder="Evidence, timestamp, URL, command output, owner, or caveat.">${escapeHTML(value.evidence)}</textarea>
      </div>
    `;
    wrap.appendChild(row);
  });

  wrap.querySelectorAll('select').forEach(select => {
    select.addEventListener('change', event => updateManual(event.target));
  });
  wrap.querySelectorAll('textarea').forEach(textarea => {
    textarea.addEventListener('input', event => updateManual(event.target));
  });
}

function statusOptions(selected) {
  return [
    [UNCHECKED, 'Not checked'],
    [PASS, 'Pass'],
    [WARN, 'Caution'],
    [FAIL, 'Fail'],
    [BLOCKED, 'Blocked']
  ].map(([value, label]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`).join('');
}

function updateManual(field) {
  const bucket = field.dataset.bucket;
  const id = field.dataset.id;
  const current = state[bucket][id] || { status: UNCHECKED, evidence: '' };
  if (field.tagName === 'SELECT') current.status = field.value;
  else current.evidence = field.value;
  state[bucket][id] = current;
  saveState();
  renderManualSections();
  renderSummary();
}

async function runChecks() {
  state.lastRunAt = new Date().toISOString();
  autoChecks.forEach(check => {
    state.auto[check.id] = { status: UNCHECKED, message: 'Running...' };
  });
  saveState();
  renderAutoChecks();
  renderSummary();

  for (const check of autoChecks) {
    state.auto[check.id] = await runOneCheck(check);
    saveState();
    renderAutoChecks();
    renderSummary();
  }
}

async function runOneCheck(check) {
  try {
    const response = await fetch(check.path, { cache: 'no-store' });
    if (!response.ok) {
      return { status: check.critical ? FAIL : WARN, message: `HTTP ${response.status} from ${check.path}` };
    }
    const text = await response.text();
    const ok = Boolean(check.expect(text));
    return {
      status: ok ? PASS : check.critical ? FAIL : WARN,
      message: ok ? `Passed: ${check.path}` : `Loaded but expected signal was missing: ${check.path}`
    };
  } catch (err) {
    return { status: check.critical ? FAIL : WARN, message: err.message || 'Check failed.' };
  }
}

function renderSummary() {
  const summary = calculateReadiness();
  const hero = document.querySelector('.hero-status');
  hero.className = 'hero-status ' + summary.status;
  document.getElementById('readiness-title').textContent = summary.title;
  document.getElementById('readiness-copy').textContent = summary.copy;
  document.getElementById('score-value').textContent = `${summary.score}%`;
  document.getElementById('last-run').textContent = state.lastRunAt ? `Last run: ${formatDateTime(state.lastRunAt)}` : 'Not run';

  setSummaryPill('auto-summary', summary.autoText, summary.autoStatus);
  setSummaryPill('manual-summary', summary.manualText, summary.manualStatus);
  setSummaryPill('drill-summary', summary.drillText, summary.drillStatus);

  document.getElementById('readiness-report').value = makeReport(summary);
}

function calculateReadiness() {
  const autoResults = autoChecks.map(check => ({ check, result: state.auto[check.id] || { status: UNCHECKED } }));
  const manualResults = manualGates.map(item => ({ item, result: state.manual[item.id] || { status: UNCHECKED, evidence: '' } }));
  const drillResults = failureDrills.map(item => ({ item, result: state.drills[item.id] || { status: UNCHECKED, evidence: '' } }));
  const allResults = [
    ...autoResults.map(item => item.result),
    ...manualResults.map(item => item.result),
    ...drillResults.map(item => item.result)
  ];

  const hasCriticalAutoFail = autoResults.some(item => item.check.critical && [FAIL, BLOCKED].includes(item.result.status));
  const hasManualFail = manualResults.some(item => [FAIL, BLOCKED].includes(item.result.status));
  const hasRequiredManualMissing = manualResults.some(item => item.item.required && item.result.status !== PASS);
  const hasDrillFail = drillResults.some(item => [FAIL, BLOCKED].includes(item.result.status));
  const hasUncheckedAuto = autoResults.some(item => item.result.status === UNCHECKED);
  const hasUncheckedDrills = drillResults.some(item => item.result.status === UNCHECKED);

  const passed = allResults.filter(result => result.status === PASS).length;
  const total = allResults.length || 1;
  const score = Math.round((passed / total) * 100);

  let status = 'warn';
  let title = 'Caution';
  let copy = 'Some checks are missing evidence. Do not add users until required manual gates pass.';

  if (hasCriticalAutoFail || hasManualFail || hasDrillFail) {
    status = 'blocked';
    title = 'Do Not Add Users';
    copy = 'At least one required health check failed or is blocked.';
  } else if (!hasRequiredManualMissing && !hasUncheckedAuto && !hasUncheckedDrills) {
    status = 'ok';
    title = 'Ready For Limited User Expansion';
    copy = 'All live checks, manual gates, and failure drills have passing evidence.';
  }

  return {
    status,
    title,
    copy,
    score,
    autoStatus: summarizeGroup(autoResults.map(item => item.result)).status,
    autoText: summarizeGroup(autoResults.map(item => item.result)).text,
    manualStatus: summarizeGroup(manualResults.map(item => item.result), manualGates.length).status,
    manualText: summarizeGroup(manualResults.map(item => item.result), manualGates.length).text,
    drillStatus: summarizeGroup(drillResults.map(item => item.result), failureDrills.length).status,
    drillText: summarizeGroup(drillResults.map(item => item.result), failureDrills.length).text,
    autoResults,
    manualResults,
    drillResults
  };
}

function summarizeGroup(results) {
  const passCount = results.filter(result => result.status === PASS).length;
  const failCount = results.filter(result => [FAIL, BLOCKED].includes(result.status)).length;
  const uncheckedCount = results.filter(result => result.status === UNCHECKED).length;
  const warnCount = results.filter(result => result.status === WARN).length;
  let status = 'ok';
  if (failCount) status = 'blocked';
  else if (uncheckedCount || warnCount) status = 'warn';
  return { status, text: `${passCount}/${results.length} pass` };
}

function setSummaryPill(id, text, status) {
  const pill = document.getElementById(id);
  pill.textContent = text;
  pill.className = 'pill ' + status;
}

function makeReport(summary) {
  return [
    '# OpenClaw System Readiness Report',
    '',
    `Status: ${summary.title}`,
    `Score: ${summary.score}%`,
    `Last run: ${state.lastRunAt ? formatDateTime(state.lastRunAt) : 'Not run'}`,
    'Protocol: Workbench v1',
    '',
    '## Live Checks',
    ...summary.autoResults.map(({ check, result }) => `- ${statusLabel(result.status)}: ${check.title} - ${result.message || check.detail}`),
    '',
    '## Manual Gates',
    ...summary.manualResults.map(({ item, result }) => `- ${statusLabel(result.status)}: ${item.title} - ${result.evidence || '[no evidence]'}`),
    '',
    '## Failure Drills',
    ...summary.drillResults.map(({ item, result }) => `- ${statusLabel(result.status)}: ${item.title} - ${result.evidence || '[no evidence]'}`),
    '',
    '## Decision',
    summary.status === 'ok'
      ? 'VERIFIED: Safe for limited user expansion with continued monitoring.'
      : 'BLOCKED: Do not add users until failed or missing gates are resolved.'
  ].join('\n');
}

async function copyReport() {
  const report = document.getElementById('readiness-report');
  report.select();
  try {
    await navigator.clipboard.writeText(report.value);
  } catch (err) {
    document.execCommand('copy');
  }
}

function statusLabel(status) {
  return {
    [PASS]: 'PASS',
    [WARN]: 'CAUTION',
    [FAIL]: 'FAIL',
    [BLOCKED]: 'BLOCKED',
    [UNCHECKED]: 'NOT CHECKED'
  }[status] || 'UNKNOWN';
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
