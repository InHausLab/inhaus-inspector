const STORAGE_KEY = 'inhaus-inspector-readiness-v173';
const PASS = 'pass';
const WARN = 'warn';
const FAIL = 'fail';
const BLOCKED = 'blocked';
const UNCHECKED = 'unchecked';
const LIVE_BRIDGE_URL = 'https://script.google.com/macros/s/AKfycbzwyXsEmFCBkkRYIA0VXBCd89WWt4n2YqSAlJXRU477g7ws7_JitbZpvr4GopEQ2UqlXQ/exec'; // Apps Script v71 — updated July 20 2026
const REVIEW_ACCESS_TOKEN = 'InHaus2026';
const SAMPLE_INSPECTION_ID = 'INH-20260717-YZNHG0'; // Jay cabin — verified in the v71 bridge on July 20 2026
const EXPECTED_PHOTO_COUNT = 34;

const autoChecks = [
  {
    id: 'field-app-shell',
    title: 'Field app shell',
    detail: 'Inspector app v173 loads from the current production origin.',
    path: '/index.html',
    expect: text => text.includes('InHaus') && text.includes('service-worker.js') && text.includes('v173'),
    critical: true
  },
  {
    id: 'service-worker-bypass',
    title: 'Service worker isolation',
    detail: 'The v173 service worker is live and standalone tools bypass the field-app cache.',
    path: '/service-worker.js',
    expect: text => text.includes("CACHE_NAME = 'inhaus-v173'") && text.includes("'/readiness'") && text.includes("'/reports'"),
    critical: true
  },
  {
    id: 'apps-script-post',
    title: 'Apps Script POST checkpoint',
    detail: 'The same-origin health function sends a real POST checkpoint to Apps Script and verifies status:ok.',
    path: '/.netlify/functions/apps-script-post-check',
    timeoutMs: 30000,
    expect: text => {
      const parsed = JSON.parse(text);
      return parsed.status === 'ok' && parsed.upstreamStatus === 200 && parsed.checkpointed === true;
    },
    critical: true
  },
  {
    id: 'apps-script-review-list',
    title: 'Apps Script review list',
    detail: 'Live v71 bridge returns the real inspection in the review inventory.',
    path: bridgeUrl({ action: 'list', token: REVIEW_ACCESS_TOKEN }),
    timeoutMs: 30000,
    expect: text => {
      const parsed = JSON.parse(text);
      const inspections = Array.isArray(parsed.inspections) ? parsed.inspections : [];
      const sample = inspections.find(item => item.inspectionId === SAMPLE_INSPECTION_ID);
      return parsed.status === 'ok'
        && Boolean(sample)
        && sample.photoCount === EXPECTED_PHOTO_COUNT
        && sample.missingCount === 0;
    },
    critical: true
  },
  {
    id: 'apps-script-report-detail',
    title: 'Apps Script report detail',
    detail: 'Live v71 bridge returns the complete 34-photo production inspection.',
    path: bridgeUrl({ action: 'get', id: SAMPLE_INSPECTION_ID, token: REVIEW_ACCESS_TOKEN }),
    timeoutMs: 30000,
    expect: text => {
      const parsed = JSON.parse(text);
      const inspection = parsed.inspection || {};
      return parsed.status === 'ok'
        && inspection.inspectionId === SAMPLE_INSPECTION_ID
        && Array.isArray(inspection.photos)
        && inspection.photos.length === EXPECTED_PHOTO_COUNT;
    },
    critical: true
  },
  {
    id: 'review-portal',
    title: 'Review portal',
    detail: 'The current report-building portal is deployed with the approved-findings build.',
    path: 'https://inhauslab.github.io/inhaus-review/',
    timeoutMs: 15000,
    expect: text => text.includes('InHaus') && text.includes('portal.js?v=20260720-12'),
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
    id: 'phone-version',
    title: 'Phone version',
    detail: 'The inspector phone shows v173 after refresh or cache reset.',
    required: true
  },
  {
    id: 'camera-capture',
    title: 'Camera capture',
    detail: 'A new photo can be captured, commented on, uploaded, and seen in Findings.',
    required: true
  },
  {
    id: 'prepared-resume',
    title: 'Office-to-phone resume',
    detail: 'A prepared inspection appears under Continue Inspection on the inspector phone.',
    required: true
  },
  {
    id: 'photo-backup',
    title: 'Photo backup',
    detail: 'The test photo shows cloud saved and appears on a second device or in review.',
    required: true
  },
  {
    id: 'final-cloud-status',
    title: 'Final cloud status',
    detail: 'Final Review reports cloud save verified and zero photos waiting.',
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
    id: 'bad-auth-token',
    title: 'Bad auth token',
    detail: 'System fails closed with a clear message and no false success claim.'
  },
  {
    id: 'upload-recovery',
    title: 'Upload recovery',
    detail: 'A failed photo upload remains local and can be retried without retaking the photo.'
  },
  {
    id: 'netlify-delay',
    title: 'Netlify deploy delay',
    detail: 'Operator knows how to distinguish stale edge content from broken code.'
  },
  {
    id: 'review-recovery',
    title: 'Review portal recovery',
    detail: 'A portal load failure is clearly reported and can be retried without changing inspection data.'
  },
  {
    id: 'phone-only',
    title: 'Phone-only bug',
    detail: 'Phone/browser visibility rule routes work to Codex before attempts.'
  },
  {
    id: 'backend-outage',
    title: 'Backend outage',
    detail: 'The app preserves work locally and never claims cloud success during an outage.'
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
  // POST checks have a postBody field
  if (check.postBody) return runOnePostCheck(check);

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), check.timeoutMs || 5000);
  try {
    const response = await fetch(check.path, { cache: 'no-store', redirect: 'follow', signal: controller.signal });
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
    const message = err.name === 'AbortError' ? `Timed out checking ${check.path}` : err.message || 'Check failed.';
    return { status: check.critical ? FAIL : WARN, message };
  } finally {
    window.clearTimeout(timer);
  }
}

async function runOnePostCheck(check) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), check.timeoutMs || 10000);
  try {
    const response = await fetch(check.path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(check.postBody),
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) {
      return { status: check.critical ? FAIL : WARN, message: `POST HTTP ${response.status} — Apps Script POST broken (405 = bad deployment settings)` };
    }
    const text = await response.text();
    const ok = Boolean(check.expect(text));
    return {
      status: ok ? PASS : check.critical ? FAIL : WARN,
      message: ok ? `POST verified: ${check.path}` : `POST returned unexpected response: ${text.slice(0, 120)}`
    };
  } catch (err) {
    const message = err.name === 'AbortError' ? `POST timed out — Apps Script not responding` : err.message || 'POST check failed.';
    return { status: check.critical ? FAIL : WARN, message };
  } finally {
    window.clearTimeout(timer);
  }
}

function bridgeUrl(params) {
  const url = new URL(LIVE_BRIDGE_URL);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
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
  const hasCriticalAutoFail = autoResults.some(item => item.check.critical && [FAIL, BLOCKED].includes(item.result.status));
  const hasManualFail = manualResults.some(item => [FAIL, BLOCKED].includes(item.result.status));
  const hasRequiredManualMissing = manualResults.some(item => item.item.required && item.result.status !== PASS);
  const hasUncheckedAuto = autoResults.some(item => item.result.status === UNCHECKED);

  // The headline score is machine-verifiable live health. Manual phone checks
  // remain visible as the gate between supervised testing and unsupervised use.
  const passed = autoResults.filter(item => item.result.status === PASS).length;
  const total = autoResults.length || 1;
  const score = Math.round((passed / total) * 100);

  let status = 'warn';
  let title = 'Caution';
  let copy = 'Live checks are still running or field evidence is incomplete.';

  if (hasCriticalAutoFail || hasManualFail) {
    status = 'blocked';
    title = 'Stop — Fix Before Testing';
    copy = 'A production health check or required field check failed.';
  } else if (!hasRequiredManualMissing && !hasUncheckedAuto) {
    status = 'ok';
    title = 'Ready For Today\'s Team';
    copy = 'Production systems and required phone checks have passing evidence.';
  } else if (!hasUncheckedAuto) {
    title = 'Ready For Supervised Testing';
    copy = 'Production systems passed. Complete the phone checks below before unsupervised field use.';
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
    '# InHaus Inspector Readiness Report',
    '',
    `Status: ${summary.title}`,
    `Score: ${summary.score}%`,
    `Last run: ${state.lastRunAt ? formatDateTime(state.lastRunAt) : 'Not run'}`,
    'Release: v173 / Apps Script v71',
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
      ? 'VERIFIED: Ready for today\'s team.'
      : summary.status === 'blocked'
        ? 'BLOCKED: Fix the failed item before testing.'
        : 'SUPERVISED TESTING: Live systems passed; complete the required phone checks before unsupervised use.'
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
