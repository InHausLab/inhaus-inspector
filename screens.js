// InHaus Inspector - Screen Rendering
import { VISION_PROXY_URL } from './config.js?v=145';
import { setInspection, getScreen, setScreen, getLastSaveText, getBestCloudSyncAt, getSyncStatus } from './state.js?v=145';
import { saveNow, scheduleSave } from './storage.js?v=145';
import { buildExportJSON, extractAllPhotosFromExport } from './inspection.js?v=145';
import { checkpointToCloud, submitInspection } from './sync.js?v=145';
import { STEP_FIELDS, PHASES, buildStepList, getStepData, validateStep, warnStep } from './steps.js?v=145';
import { text, textarea, date, sel, chips, photo, divider, showIf } from './fields.js?v=145';

// UI globals — accessed lazily via ui() to guarantee window.UI is ready
function ui() { return window.UI; }

// ── Context (set via initScreens) ───────────────────────────
let ctx = null;
let _stepRenderJob = 0;

const SPARE_SLOT_GROUPS = [
  { title: 'Observation', prefix: 'obs_', count: 6 },
  { title: 'Action Taken', prefix: 'actionTaken_', count: 6 },
  { title: 'Follow-Up', prefix: 'followUp_', count: 5 }
];

function buildSpareSlotPicker(selectedValue, onSelect, opts) {
  const options = opts || {};
  let selected = selectedValue || '';
  const wrap = document.createElement('div');
  wrap.className = 'spare-slot-picker' + (options.compact ? ' spare-slot-picker-compact' : '');

  function updateSelected() {
    wrap.querySelectorAll('.spare-slot-choice').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.value === selected);
    });
  }

  function addChoice(grid, value, label, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'spare-slot-choice' + (extraClass ? ' ' + extraClass : '');
    btn.dataset.value = value;
    btn.textContent = label;
    btn.onclick = () => {
      selected = value;
      updateSelected();
      onSelect(value || null);
    };
    grid.appendChild(btn);
  }

  if (options.includeUnassigned) {
    const clearGrid = document.createElement('div');
    clearGrid.className = 'spare-slot-grid spare-slot-grid-clear';
    addChoice(clearGrid, '', 'Unassigned', 'spare-slot-unassigned');
    wrap.appendChild(clearGrid);
  }

  SPARE_SLOT_GROUPS.forEach(group => {
    const groupWrap = document.createElement('div');
    groupWrap.className = 'spare-slot-group';

    const title = document.createElement('div');
    title.className = 'spare-slot-group-title';
    title.textContent = group.title;
    groupWrap.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'spare-slot-grid';
    for (let i = 1; i <= group.count; i++) {
      addChoice(grid, group.prefix + i, String(i));
    }
    groupWrap.appendChild(grid);
    wrap.appendChild(groupWrap);
  });

  updateSelected();
  return wrap;
}

export function initScreens(context) {
  ctx = context;
}

function renderFieldsIncrementally({ card, fields, data, onFieldChange, inspection, onSave, jobId, onComplete }) {
  let idx = 0;
  const placeholder = ui().el('div', { className: 'field-render-placeholder' }, 'Loading fields...');
  card.appendChild(placeholder);

  function isCurrentJob() {
    return ctx && jobId === _stepRenderJob && document.body.contains(card);
  }

  function finish() {
    if (!isCurrentJob()) return;
    placeholder.remove();
    ui().updateShowIf(card, data);
    if (onComplete) onComplete();
  }

  function frame() {
    if (!isCurrentJob()) return;

    const started = performance.now();
    const batch = document.createDocumentFragment();
    let renderedThisFrame = 0;

    while (idx < fields.length && renderedThisFrame < 2 && (renderedThisFrame === 0 || performance.now() - started < 6)) {
      const f = fields[idx++];
      const rendered = ui().renderField(f, data, onFieldChange, inspection, onSave);
      if (rendered) batch.appendChild(rendered);
      renderedThisFrame++;
    }

    if (batch.childNodes.length) card.insertBefore(batch, placeholder);
    ui().updateShowIf(card, data);

    if (idx < fields.length) requestAnimationFrame(frame);
    else finish();
  }

  requestAnimationFrame(frame);
}

function goToStep(idx) {
  ctx.currentStepIdx = idx;
  setScreen('step');
  ctx.render();
  window.scrollTo(0, 0);
}

function getStepReviewIssues(step) {
  if (!ctx || !ctx.inspection || step.type === 'review') return [];
  const data = (ctx.inspection.stepData && ctx.inspection.stepData[step.id]) || {};
  if (!data._visited) return ['Section not visited'];
  return validateStep(step, data);
}

function collectInspectionIssues() {
  const issues = [];
  if (!ctx || !ctx.stepList) return issues;

  ctx.stepList.forEach((step, idx) => {
    if (step.type === 'review') return;
    getStepReviewIssues(step).forEach(message => {
      issues.push({ step, stepIdx: idx, message });
    });
  });

  return issues;
}

function visitScreenPhotos(insp, callback) {
  const seen = new Set();
  function walk(obj, path) {
    if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
    seen.add(obj);
    if (Array.isArray(obj)) {
      if (obj.length && obj[0] && typeof obj[0].photoId === 'string') {
        obj.forEach((photo, idx) => callback(photo, path + '[' + idx + ']'));
      } else {
        obj.forEach((item, idx) => walk(item, path + '[' + idx + ']'));
      }
      return;
    }
    Object.keys(obj).forEach(key => {
      if (key === '_photoRetryQueue') return;
      walk(obj[key], path ? path + '.' + key : key);
    });
  }
  walk(insp, 'inspection');
}

function getStepNameFromPhotoPath(path) {
  if (!ctx || !ctx.stepList || !path) return '';
  const match = path.match(/stepData\.([^.[\]]+)/);
  if (!match) return '';
  const step = ctx.stepList.find(s => s.id === match[1]);
  return step ? step.name : '';
}

function collectInspectionPhotoRefs() {
  const refs = [];
  if (!ctx || !ctx.inspection) return refs;
  visitScreenPhotos(ctx.inspection, (photo, path) => {
    if (!photo || !photo.photoId) return;
    const stepName = photo.stepName || getStepNameFromPhotoPath(path);
    refs.push({
      photo,
      path,
      stepName,
      title: photo.roomName || stepName || 'Inspection photo'
    });
  });
  return refs;
}

function getPhotoPreviewSrc(photo) {
  if (!photo) return '';
  if (photo.thumbnailDataUrl) return photo.thumbnailDataUrl;
  if (photo.dataUrl && photo.dataUrl !== '__uploaded__') return photo.dataUrl;
  return '';
}

function getPhotoStatus(photo) {
  const hasLocal = !!(photo && photo.dataUrl && photo.dataUrl !== '__uploaded__');
  const hasDrive = !!(photo && (photo._driveConfirmed === true || photo._uploaded === true || photo.driveUrl || photo.driveId || photo.storagePath));
  const hasVault = !!(photo && photo._vaultSaved);
  if (hasDrive && hasLocal) return { label: 'Cloud + phone', tone: 'good' };
  if (hasDrive) return { label: 'Cloud', tone: 'good' };
  if (hasLocal || hasVault) return { label: 'Waiting', tone: 'wait' };
  return { label: 'Missing', tone: 'bad' };
}

function getCloudLabel() {
  const lastCloud = getBestCloudSyncAt();
  if (!lastCloud) return 'No backup yet';
  return 'Last backup ' + new Date(lastCloud).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatPhotoTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatIssueList(issues) {
  return issues.map(issue => issue.step.name + ': ' + issue.message);
}

// ── Room Navigation Drawer ─────────────────────────────────
export function buildRoomDrawer() {
  // Sections match the inspection workflow levels
  // addRooms: array of { label, section, prefix } for add-room buttons at bottom of section
  const DRAWER_GROUPS = [
    { label: 'Setup', phases: ['setup', 'arrival'] },
    { label: 'Exterior', phases: ['exterior'] },
    { label: 'Lowest Level', phases: ['lowest'], addRooms: [
      { label: '+ Add Room', section: 'lowest', prefix: null }
    ]},
    { label: 'Utility Room', phases: ['utility'] },
    { label: 'Upper Level', phases: ['upper', 'rooms'], addRooms: [
      { label: '+ Add Bedroom', section: 'additional', prefix: 'Bedroom' },
      { label: '+ Add Bathroom', section: 'additional', prefix: 'Bathroom' }
    ]},
    { label: 'Main Level', phases: ['main'] },
    { label: 'Additional Rooms', phases: ['supplementary'], addRooms: [
      { label: '+ Add Room', section: 'additional', prefix: null }
    ]},
    { label: 'Wrap-Up', phases: ['wrapup', 'propdetails', 'post', 'review'] }
  ];

  const overlay = ui().el('div', { id: 'room-drawer-overlay', className: 'room-drawer-overlay active' });
  const drawer = ui().el('div', { className: 'room-drawer' });

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  drawer.addEventListener('click', e => e.stopPropagation());

  drawer.appendChild(ui().el('div', { className: 'room-drawer-handle' }));
  drawer.appendChild(ui().el('div', { className: 'room-drawer-title' }, '\uD83D\uDCCD Navigate'));

  const scrollArea = ui().el('div', { className: 'room-drawer-scroll' });

  DRAWER_GROUPS.forEach(group => {
    // All steps in this group's phases - no type restrictions (review included in Wrap-Up)
    const groupSteps = ctx.stepList.filter(s => group.phases.includes(s.phase));
    if (!groupSteps.length) return;

    scrollArea.appendChild(ui().el('div', { className: 'room-drawer-group-label' }, group.label));

    groupSteps.forEach(s => {
      const sData = (ctx.inspection.stepData && ctx.inspection.stepData[s.id]) || {};
      const completed = !!sData._completedAt;
      const visited = !!sData._visited;
      const sIdx = ctx.stepList.indexOf(s);
      const isCurrent = sIdx === ctx.currentStepIdx;

      const statusText = completed ? '\u2713' : (visited ? '\u25cf' : '');
      const cls = 'room-drawer-item' +
        (isCurrent ? ' room-item-current' : '') +
        (completed ? ' room-item-done' : '') +
        (visited && !completed ? ' room-item-partial' : '');

      const ROOM_NAMED_TYPES = ['bedroom', 'bathroom', 'room-test', 'additional-room'];
      const stepRoomName = ROOM_NAMED_TYPES.includes(s.type) &&
        ctx.inspection.stepData && ctx.inspection.stepData[s.id] && ctx.inspection.stepData[s.id].roomName;
      const displayName = stepRoomName || s.name;

      scrollArea.appendChild(ui().el('div', {
        className: cls,
        onClick: () => {
          overlay.remove();
          goToStep(sIdx);
        }
      }, [
        ui().el('span', { className: 'room-item-name' }, displayName),
        statusText ? ui().el('span', { className: 'room-item-status' + (completed ? ' status-done' : ' status-partial') }, statusText) : null
      ]));
    });

    // Per-section add-room buttons (Lowest Level, Upper Level, Additional Rooms)
    if (group.addRooms && group.addRooms.length) {
      const addRow = ui().el('div', { className: 'room-drawer-section-add' });
      group.addRooms.forEach(addDef => {
        addRow.appendChild(ui().el('button', {
          type: 'button',
          className: 'room-drawer-add-item-btn',
          onClick: () => {
            overlay.remove();
            ctx.addDynamicRoom(addDef.section, addDef.prefix);
          }
        }, addDef.label));
      });
      scrollArea.appendChild(addRow);
    }
  });

  drawer.appendChild(scrollArea);
  overlay.appendChild(drawer);
  return overlay;
}

// ── Search ─────────────────────────────────────────────────
export function openSearch() {
  const existing = document.getElementById('search-overlay');
  if (existing) { existing.remove(); return; }

  const searchIndex = [];
  ctx.stepList.forEach(s => {
    if (s.type === 'review') return;
    const sIdx = ctx.stepList.indexOf(s);
    searchIndex.push({ label: s.name, stepIdx: sIdx, context: '' });
    const fieldGen = STEP_FIELDS[s.type];
    if (fieldGen) {
      fieldGen().forEach(f => {
        if (!f.label || !f.key) return;
        if (['heading', 'info', 'divider', 'photo', 'timer', 'link'].includes(f.type)) return;
        searchIndex.push({ label: f.label, stepIdx: sIdx, context: s.name, key: f.key });
      });
    }
  });

  const overlay = ui().el('div', { id: 'search-overlay', className: 'search-overlay active' });
  const panel = ui().el('div', { className: 'search-panel' });

  const inputRow = ui().el('div', { className: 'search-input-row' });
  const inp = ui().el('input', {
    type: 'search', className: 'search-input',
    placeholder: 'Search sections, fields, rooms\u2026',
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off'
  });
  const closeBtn = ui().el('button', {
    type: 'button', className: 'search-close-btn',
    onClick: () => overlay.remove()
  }, '\u00d7');
  inputRow.appendChild(ui().el('span', { className: 'search-icon-prefix' }, '\uD83D\uDD0D'));
  inputRow.appendChild(inp);
  inputRow.appendChild(closeBtn);
  panel.appendChild(inputRow);

  const resultsList = ui().el('div', { className: 'search-results-list' });
  panel.appendChild(resultsList);
  overlay.appendChild(panel);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  inp.focus();

  let allMatches = [], matchCursor = 0;

  function renderResults(q) {
    resultsList.innerHTML = '';
    allMatches = [];
    matchCursor = 0;
    if (!q.trim()) return;
    const low = q.toLowerCase();
    const seen = new Set();
    searchIndex.forEach(item => {
      const dedupKey = item.key ? 'f-' + item.stepIdx + '-' + item.key : 's-' + item.stepIdx;
      if (seen.has(dedupKey)) return;
      if (item.label.toLowerCase().includes(low) || (item.context && item.context.toLowerCase().includes(low))) {
        seen.add(dedupKey);
        allMatches.push(item);
      }
    });

    if (!allMatches.length) {
      resultsList.appendChild(ui().el('div', { className: 'search-no-results' }, 'No results found'));
      return;
    }

    allMatches.slice(0, 25).forEach(item => {
      resultsList.appendChild(ui().el('div', {
        className: 'search-result-item',
        onClick: () => {
          ctx.currentStepIdx = item.stepIdx;
          overlay.remove();
          ctx.render();
          window.scrollTo(0, 0);
        }
      }, [
        ui().el('div', { className: 'search-result-label' }, item.label),
        item.context ? ui().el('div', { className: 'search-result-context' }, 'In: ' + item.context) : null
      ]));
    });

    if (allMatches.length > 1) {
      resultsList.appendChild(ui().el('button', {
        type: 'button', className: 'btn btn-primary btn-full search-next-btn',
        onClick: () => {
          matchCursor = (matchCursor + 1) % allMatches.length;
          ctx.currentStepIdx = allMatches[matchCursor].stepIdx;
          overlay.remove();
          ctx.render();
          window.scrollTo(0, 0);
        }
      }, 'Next \u203a (' + allMatches.length + ' matches)'));
    }
  }

  inp.addEventListener('input', () => renderResults(inp.value));
}

// ── Render ─────────────────────────────────────────────────
export function render() {
  // Kill any body-level overlays that may have leaked across renders
  ['room-drawer-overlay', 'search-overlay'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
  window.inspection = ctx.inspection;
  ctx.root.innerHTML = '';
  window.scrollTo(0, 0);
  switch (getScreen()) {
    case 'home': renderHome(); break;
    case 'truck-check': renderTruckCheck(); break;
    case 'intake': renderIntake(); break;
    case 'precheck': renderPrecheck(); break;
    case 'step': renderStep(); break;
    case 'review': renderReview(); break;
    case 'photos': renderPhotos(); break;
  }
}

// ── App Header (reused on all screens) ─────────────────────
let _devTapCount = 0, _devTapTimer = null;
function isDevMode() { return localStorage.getItem('inhausDevMode') === 'true'; }
function toggleDevMode() {
  const next = !isDevMode();
  localStorage.setItem('inhausDevMode', next ? 'true' : 'false');
  const msg = next ? '\u26a0\ufe0f Dev Mode ON \u2014 Skip buttons active' : 'Dev Mode OFF';
  ui().showToast(msg);
  ctx.render();
}

export function buildAppHeader(subtitle) {
  const header = ui().el('div', { className: 'app-header' });
  const logo = ui().el('div', { className: 'app-logo', style: 'cursor:pointer;', onClick: () => {
    _devTapCount++;
    if (_devTapTimer) clearTimeout(_devTapTimer);
    _devTapTimer = setTimeout(() => { _devTapCount = 0; }, 2000);
    if (_devTapCount >= 5) { _devTapCount = 0; toggleDevMode(); }
  }});
  logo.appendChild(ui().el('img', { src: 'icons/logo.png', alt: 'InHaus Lab' }));
  header.appendChild(logo);
  if (isDevMode()) {
    const banner = ui().el('div', { style: 'background:#ff9900;color:#000;font-size:11px;font-weight:bold;padding:2px 8px;border-radius:4px;' }, '\u26a0\ufe0f DEV');
    header.appendChild(banner);
  }
  header.appendChild(ui().el('p', { className: 'app-subtitle' }, subtitle || 'Field Inspector'));
  return header;
}

// ── HOME SCREEN ────────────────────────────────────────────
export function renderHome() {
  const c = ui().el('div', { className: 'screen home-screen' });
  c.appendChild(buildAppHeader());

  c.appendChild(ui().el('button', {
    className: 'btn btn-primary btn-full',
    onClick: () => { setScreen('truck-check'); ctx.render(); }
  }, 'New Inspection'));

  // ── Inspector mode toggle ─────────────────────────────────
  const isExp = localStorage.getItem('inhaus_experienced') === 'true';
  const modeBtn = ui().el('button', {
    className: 'btn btn-outline btn-full',
    style: 'margin-top:8px;font-size:0.85rem;color:#5a7a3a;border-color:#c8d8b8;',
    onClick: () => {
      const nowExp = localStorage.getItem('inhaus_experienced') === 'true';
      localStorage.setItem('inhaus_experienced', nowExp ? 'false' : 'true');
      ctx.render();
    }
  }, isExp
    ? '\uD83D\uDCCB Process steps collapsed (experienced mode) - tap to show all'
    : '\u2705 Process steps expanded (guided mode) - tap to collapse for experienced inspectors'
  );
  c.appendChild(modeBtn);

  // ── Dev Mode toggle (hidden in Advanced section) ────────
  const advancedSection = ui().el('details', { style: 'margin-top:16px;' });
  const advancedSummary = ui().el('summary', {
    style: 'font-size:0.75rem;color:#999;cursor:pointer;list-style:none;text-align:center;'
  }, '\u2699\ufe0f Advanced');
  advancedSection.appendChild(advancedSummary);
  const devToggle = ui().el('button', {
    className: 'btn btn-outline btn-full',
    style: 'margin-top:8px;font-size:0.8rem;color:#999;border-color:#ddd;',
    onClick: () => {
      if (!isDevMode()) {
        if (!confirm('\u26a0\ufe0f Dev Mode disables completion requirements and adds Skip buttons.\n\nOnly use for testing. Enable?')) return;
      }
      toggleDevMode();
    }
  }, isDevMode() ? '\u26a0\ufe0f Dev Mode ON \u2014 tap to disable' : 'Enable Dev Mode');
  advancedSection.appendChild(devToggle);
  c.appendChild(advancedSection);

  // ── Jump to Step (dev only) ─────────────────────────────
  if (isDevMode()) {
    const jumpBtn = ui().el('button', {
      className: 'btn btn-outline btn-full',
      style: 'margin-top:8px;font-size:0.8rem;color:#ff9900;border-color:#ff9900;',
      onClick: () => {
        DB.getAll().then(all => {
          const inProg = all.filter(x => x.status === 'in-progress');
          if (!inProg.length) { alert('No in-progress inspection. Start one first.'); return; }
          const insp = inProg[0];
          ctx.inspection = insp; setInspection(ctx.inspection);
          ctx.stepList = buildStepList(ctx.inspection);
          const stepListStr = ctx.stepList.map((s, i) => i + ': ' + s.name + ' (' + s.type + ')').join('\n');
          const input = prompt('Enter step number (0-' + (ctx.stepList.length - 1) + '):\n\n' + stepListStr);
          if (input === null) return;
          const idx = parseInt(input);
          if (isNaN(idx) || idx < 0 || idx >= ctx.stepList.length) { alert('Invalid step number'); return; }
          ctx.currentStepIdx = idx;
          setScreen('step');
          ctx.startAutoSave();
          ctx.render();
        });
      }
    }, '\u26a1 Jump to Step');
    c.appendChild(jumpBtn);
  }

  const list = ui().el('div', { className: 'inspection-list' });
  c.appendChild(list);

  DB.getAll().then(all => {
    all.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    const inProg = all.filter(x => x.status === 'in-progress');
    const done = all.filter(x => x.status === 'completed');

    if (inProg.length) {
      list.appendChild(ui().el('h2', { className: 'list-heading' }, 'In Progress'));
      inProg.forEach(x => list.appendChild(renderInspCard(x, true)));
    }
    if (done.length) {
      list.appendChild(ui().el('h2', { className: 'list-heading' }, 'Completed'));
      done.forEach(x => list.appendChild(renderInspCard(x, false)));
    }
    if (!all.length) {
      list.appendChild(ui().el('p', { className: 'empty-msg' }, 'No inspections yet. Tap "New Inspection" to begin.'));
    }
  });

  ctx.root.appendChild(c);
}

export function renderInspCard(insp, canResume) {
  return ui().el('div', { className: 'card insp-card' }, [
    ui().el('div', { className: 'card-top' }, [
      ui().el('strong', null, insp.inspectionId),
      ui().el('span', { className: 'badge ' + insp.status }, insp.status === 'completed' ? 'Complete' : 'In Progress')
    ]),
    ui().el('p', null, insp.propertyAddress || 'No address'),
    ui().el('p', { className: 'text-sm' }, (insp.inspectorName || '') + ' \u2022 ' + ui().fmtDate(insp.startedAt)),
    ui().el('div', { className: 'card-actions' }, [
      canResume ? ui().el('button', { className: 'btn btn-primary', onClick: () => resumeInsp(insp.inspectionId) }, 'Resume') : null,
      ui().el('button', { className: 'btn btn-outline', onClick: () => viewInsp(insp.inspectionId) }, 'View'),
      ui().el('button', { className: 'btn btn-danger-outline btn-small', onClick: () => {
        if (confirm('⚠️ Delete this inspection permanently?\n\nAll photos and data will be removed from this device.\n\nOnly delete after confirming your photos have been uploaded to Google Drive.\n\nThis cannot be undone.')) {
          DB.remove(insp.inspectionId).then(() => ctx.render());
        }
      }}, 'Delete')
    ])
  ]);
}

export async function resumeInsp(id) {
  ctx.inspection = await DB.get(id); setInspection(ctx.inspection);
  if (!ctx.inspection) return;
  ctx.stepList = buildStepList(ctx.inspection);
  const lastVisited = ctx.inspection._lastStepIdx || 0;
  ctx.currentStepIdx = Math.min(lastVisited, ctx.stepList.length - 1);
  setScreen('step');
  ctx.startAutoSave();
  ctx.render();
}

export async function viewInsp(id) {
  ctx.inspection = await DB.get(id); setInspection(ctx.inspection);
  if (!ctx.inspection) return;
  ctx.stepList = buildStepList(ctx.inspection);
  setScreen('review');
  ctx.startAutoSave();
  ctx.render();
}

// ── TRUCK CHECK SCREEN ────────────────────────────────────
export function renderTruckCheck() {
  const SECTIONS = [
    {
      title: 'Air Testing',
      items: [
        { key: 'tc_qtrak',        label: 'Q-Trak 7585 - charged, previous data deleted, rooms configured', required: true },
        { key: 'tc_flir',         label: 'FLIR MR277', required: true },
        { key: 'tc_corentium',    label: 'Airthings Corentium Pro + charging cube', required: true },
        { key: 'tc_breezePump',   label: 'Breeze ET pump + tripod', required: true },
        { key: 'tc_breezeTraps',  label: 'Breeze ST spore traps (6)', required: true },
        { key: 'tc_breezeSwabs',  label: 'Breeze mold swabs (2)', required: true },
        { key: 'tc_boulderFan',   label: 'Boulder Blue fan + filter', required: true }
      ]
    },
    {
      title: 'Water Testing',
      items: [
        { key: 'tc_waterPanel',   label: 'Full panel water test kit (SafeHome)', required: true },
        { key: 'tc_pfas',         label: 'PFAS test kit (Cyclopure)', required: false, asNeeded: true },
        { key: 'tc_microplastic', label: 'Microplastics test kit (Brooks Applied Labs)', required: false, asNeeded: true }
      ]
    },
    {
      title: 'Surface Testing',
      items: [
        { key: 'tc_atpDevice',    label: 'ATP device (SystemSURE Plus)', required: true },
        { key: 'tc_atpSwabs',     label: 'ATP swabs (2) - refrigerated, bring ice pack', required: true }
      ]
    },
    {
      title: 'Other Equipment',
      items: [
        { key: 'tc_dewalt',       label: 'Dewalt vacuum + attachments + bendy light', required: true },
        { key: 'tc_endoscope',    label: 'Endoscope', required: true },
        { key: 'tc_tape',         label: 'Measuring tape', required: true },
        { key: 'tc_cleaning',     label: 'Cleaning supplies', required: true }
      ]
    },
    {
      title: 'Personal / Safety',
      items: [
        { key: 'tc_tarp',         label: 'Tarp (for entryway)', required: true },
        { key: 'tc_shoeCovers',   label: 'Shoe covers', required: true },
        { key: 'tc_n95',          label: 'N95 masks', required: true },
        { key: 'tc_gloves',       label: 'Nitrile gloves', required: true },
        { key: 'tc_sanitizer',    label: 'Hand sanitizer', required: true }
      ]
    },
    {
      title: 'Technology',
      items: [
        { key: 'tc_ipad',         label: 'iPad - fully charged, all apps downloaded', required: true },
        { key: 'tc_airthingsApp', label: 'Airthings app installed', required: true },
        { key: 'tc_airthingsVP',  label: 'Airthings View Plus app installed', required: true }
      ]
    },
    {
      title: 'Shipping Supplies',
      items: [
        { key: 'tc_fedexLabel',   label: 'FedEx prepaid label (Breeze STs)', required: true },
        { key: 'tc_upsLabel',     label: 'UPS label (Boulder Blue)', required: true },
        { key: 'tc_waterLabel',   label: 'Safe Home water panel - prepaid label + package', required: true },
        { key: 'tc_cyclopureLabel', label: 'Cyclopure PFAS - prepaid label + package', required: false, asNeeded: true },
        { key: 'tc_microLabel',     label: 'Microplastics (Brooks Applied Labs) - prepaid label + package', required: false, asNeeded: true }
      ]
    }
  ];

  const allRequired = SECTIONS.flatMap(s => s.items.filter(i => i.required));

  function countChecked() {
    return SECTIONS.flatMap(s => s.items).filter(i => !!ctx._truckCheck[i.key]).length;
  }
  function totalItems() {
    return SECTIONS.flatMap(s => s.items).length;
  }
  function allRequiredChecked() {
    return allRequired.every(i => !!ctx._truckCheck[i.key]);
  }
  function missingRequiredItems() {
    return allRequired.filter(i => !ctx._truckCheck[i.key]);
  }
  function persistTruckCheck() {
    const _tcKey = 'inhausTruckCheck_' + new Date().toISOString().slice(0, 10);
    localStorage.setItem(_tcKey, JSON.stringify(ctx._truckCheck));
  }

  const c = ui().el('div', { className: 'screen' });
  c.appendChild(buildAppHeader());

  // Reset / back link
  const resetBar = ui().el('div', { className: 'truck-check-reset-bar' });
  const resetLink = ui().el('button', {
    className: 'btn-link',
    onClick: () => { setScreen('home'); ctx.render(); }
  }, '← Back to Home');
  resetBar.appendChild(resetLink);
  c.appendChild(resetBar);

  const card = ui().el('div', { className: 'card' });

  // Header
  card.appendChild(ui().el('h2', { className: 'screen-title' }, '🚛 Loading Truck Checklist'));
  card.appendChild(ui().el('p', { className: 'truck-check-subtitle' }, 'Check off every item before leaving'));

  // Progress counter
  const progressEl = ui().el('div', { className: 'truck-check-progress' }, countChecked() + ' of ' + totalItems() + ' items checked');
  card.appendChild(progressEl);
  let continueBtn = null;
  let continueHint = null;
  let missingNotice = null;

  function updateContinueState() {
    const missing = missingRequiredItems();
    const ready = missing.length === 0;
    if (continueBtn) {
      continueBtn.className = 'btn btn-full ' + (ready ? 'btn-primary' : 'btn-outline');
      continueBtn.setAttribute('data-ready', ready ? 'true' : 'false');
    }
    if (continueHint) {
      continueHint.className = 'truck-check-continue-hint ' + (ready ? 'ready' : 'blocked');
      continueHint.textContent = ready ? 'Ready for intake' : missing.length + ' required item' + (missing.length === 1 ? '' : 's') + ' left';
    }
    if (ready && missingNotice) missingNotice.innerHTML = '';
  }

  function showMissingRequiredItems() {
    const missing = missingRequiredItems();
    if (!missing.length) return false;
    const firstRow = card.querySelector('[data-truck-key="' + missing[0].key + '"]');
    if (firstRow) {
      firstRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      firstRow.classList.add('check-item-missing');
      setTimeout(() => firstRow.classList.remove('check-item-missing'), 1800);
    }
    if (missingNotice) {
      missingNotice.innerHTML = '';
      missingNotice.appendChild(ui().el('strong', null, missing.length + ' required item' + (missing.length === 1 ? '' : 's') + ' left'));
      missing.slice(0, 6).forEach(i => {
        missingNotice.appendChild(ui().el('div', null, i.label));
      });
      if (missing.length > 6) {
        missingNotice.appendChild(ui().el('div', null, '+' + (missing.length - 6) + ' more'));
      }
    }
    return true;
  }

  // Sections
  SECTIONS.forEach(section => {
    card.appendChild(ui().el('div', { className: 'section-heading' }, section.title));
    section.items.forEach(item => {
      const box = ui().el('div', {
        className: 'check-box' + (ctx._truckCheck[item.key] ? ' checked' : '')
      }, ctx._truckCheck[item.key] ? '\u2713' : '');
      const labelText = item.label + (item.asNeeded ? ' (as needed)' : !item.required ? ' (optional)' : '');
      const row = ui().el('div', {
        className: 'check-item' + (!item.required ? ' optional-item' : ''),
        'data-truck-key': item.key,
        onClick: () => {
          ctx._truckCheck[item.key] = !ctx._truckCheck[item.key];
          box.className = 'check-box' + (ctx._truckCheck[item.key] ? ' checked' : '');
          box.textContent = ctx._truckCheck[item.key] ? '\u2713' : '';
          persistTruckCheck();
          const checked = countChecked();
          progressEl.textContent = checked + ' of ' + totalItems() + ' items checked';
          updateContinueState();
        }
      });
      row.appendChild(box);
      row.appendChild(ui().el('div', { className: 'check-label' }, labelText));
      card.appendChild(row);
    });
  });

  // Continue button
  continueBtn = ui().el('button', {
    type: 'button',
    className: 'btn btn-full ' + (allRequiredChecked() ? 'btn-primary' : 'btn-outline'),
    onClick: e => {
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      if (showMissingRequiredItems()) return;
      setScreen('intake');
      ctx.render();
    }
  }, 'Continue \u2192');
  continueHint = ui().el('div', { className: 'truck-check-continue-hint' });
  missingNotice = ui().el('div', { className: 'truck-check-missing-list' });
  updateContinueState();

  card.appendChild(ui().el('div', { style: 'margin-top: 1.5rem;' }, [continueBtn, continueHint, missingNotice]));
  c.appendChild(card);
  ctx.root.appendChild(c);
}

// ── INTAKE SCREEN ──────────────────────────────────────────
export function renderIntake() {
  const isEdit = !!ctx.inspection;
  const data = isEdit ? {
    inspectionId: ctx.inspection.inspectionId,
    inspectorName: ctx.inspection.inspectorName || '',
    inspectionDate: ctx.inspection.inspectionDate || new Date().toISOString().slice(0, 10),
    clientName: ctx.inspection.clientName || '',
    propertyAddress: ctx.inspection.propertyAddress || '',
    numberOfLevels: ctx.inspection.numberOfLevels || '',
    numberOfBedrooms: ctx.inspection.numberOfBedrooms || '',
    numberOfBathrooms: ctx.inspection.numberOfBathrooms || '',
    waterSource: ctx.inspection.waterSource || '',
    waterSourceDescription: ctx.inspection.waterSourceDescription || '',
    wifiNetwork: ctx.inspection.wifiNetwork || '',
    wifiPassword: ctx.inspection.wifiPassword || '',
    clientConcerns: ctx.inspection.clientConcerns || '',
    blueprintNotes: ctx.inspection.blueprintNotes || '',
    inspectorEmail: ctx.inspection.inspectorEmail || ''
  } : {
    inspectionId: ctx.genId(),
    inspectorName: '',
    inspectionDate: new Date().toISOString().slice(0, 10),
    clientName: '',
    propertyAddress: '',
    numberOfLevels: '',
    numberOfBedrooms: '',
    numberOfBathrooms: '',
    waterSource: '',
    waterSourceDescription: '',
    wifiNetwork: '',
    wifiPassword: '',
    clientConcerns: '',
    blueprintNotes: ''
  };

  const c = ui().el('div', { className: 'screen' });
  c.appendChild(buildAppHeader(isEdit ? 'Edit Intake Details' : 'Customer & Property Intake'));
  c.appendChild(ui().renderStatusBar(getLastSaveText()));

  const card = ui().el('div', { className: 'card' });
  const fields = [
    { ...text('inspectionId', 'Inspection ID'), disabled: true },
    text('inspectorName', 'Inspector Name *'),
    text('inspectorEmail', 'Inspector Email'),
    date('inspectionDate', 'Inspection Date'),
    text('clientName', 'Client Name *'),
    text('propertyAddress', 'Property Address *'),
    photo('Title Page'),
    sel('numberOfLevels', 'Number of Levels *', ['1', '2', '3', '4', '5']),
    sel('numberOfBedrooms', 'Number of Bedrooms *', ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15']),
    sel('numberOfBathrooms', 'Number of Bathrooms *', ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20']),
    chips('waterSource', 'Water Source * (select all that apply)', ['Municipal', 'Well', 'Spring', 'Cistern', 'Other']),
    showIf(text('waterSourceDescription', 'If "Other": describe water source', { placeholder: 'e.g. Private spring on property' }), 'waterSource', 'Other'),
    divider(),
    text('wifiNetwork', 'Home wifi network name'),
    text('wifiPassword', 'WiFi Password', { placeholder: 'For Airthings and device connectivity' }),
    { type: 'wifi-copy' },
    textarea('clientConcerns', 'Client concerns / known problem areas', { placeholder: 'Tap \uD83C\uDF99 mic in your iPhone keyboard to dictate \u2014 read back and fix errors before saving.' }),
    textarea('blueprintNotes', 'Client blueprints / layout notes (optional)')
  ];

  const onIntakeChange = () => { ui().updateShowIf(card, data); };
  fields.forEach(f => {
    const rendered = ui().renderField(f, data, onIntakeChange, {}, () => {});
    if (rendered) card.appendChild(rendered);
  });
  ui().updateShowIf(card, data);
  c.appendChild(card);

  const nav = ui().el('div', { className: 'bottom-nav' }, [
    ui().el('button', { className: 'btn btn-outline btn-nav', onClick: () => {
      if (isEdit) { setScreen('step'); ctx.render(); } else { setScreen('truck-check'); ctx.render(); }
    } }, isEdit ? '\u2190 Back to Steps' : '\u2190 Back'),
    ui().el('button', { className: 'btn btn-primary btn-nav', onClick: () => {
      const required = ['inspectorName', 'clientName', 'propertyAddress', 'numberOfLevels', 'numberOfBedrooms', 'numberOfBathrooms'];
      const missing = required.filter(k => !data[k] || !data[k].trim || !data[k].trim());
      if (!data.waterSource || (Array.isArray(data.waterSource) ? data.waterSource.length === 0 : !data.waterSource)) missing.push('waterSource');
      if (missing.length) { alert('Please fill in all required fields (marked with *).'); return; }
      if (isEdit) {
        Object.assign(ctx.inspection, data);
        ctx.stepList = buildStepList(ctx.inspection);
        setScreen('step');
        ctx.render();
        saveNow();
      } else {
        ctx.inspection = {
          ...data,
          startedAt: new Date().toISOString(),
          endedAt: null,
          status: 'in-progress',
          stepData: {},
          timers: {},
          dynamicRooms: { lowest: [{ name: 'Lowest Level \u2014 Room 1' }], additional: [] },
          _lastStepIdx: 0,
          truckCheck: Object.assign({}, ctx._truckCheck)
        }; setInspection(ctx.inspection);
        ctx.stepList = buildStepList(ctx.inspection);
        ctx.currentStepIdx = 0;
        setScreen('precheck');
        ctx.startAutoSave();
        ctx.render();
        saveNow().then(() => {
          if (window.runCloudPreflight) window.runCloudPreflight();
        });
      }
    }}, isEdit ? 'Save Changes \u2713' : 'Start Inspection \u2192')
  ]);
  c.appendChild(nav);
  ctx.root.appendChild(c);
}

// ── STEP SCREEN ────────────────────────────────────────────
export function renderPrecheck() {
  const c = document.createElement('div');
  c.className = 'screen step-screen';
  c.appendChild(buildAppHeader('Pre-Inspection Checklist'));

  const title = document.createElement('h1');
  title.className = 'screen-title';
  title.textContent = 'Equipment Check';
  c.appendChild(title);

  const info = document.createElement('div');
  info.className = 'field-info';
  info.style = 'margin-bottom:16px;';
  info.textContent = 'Confirm everything is packed and ready before entering the home.';
  c.appendChild(info);

  const card = document.createElement('div');
  card.className = 'card';
  const data = getStepData('equipment');
  const fieldGen = STEP_FIELDS['equipment'];
  if (fieldGen) {
    const fields = fieldGen();
    const onFieldChange = () => { data._updatedAt = new Date().toISOString(); scheduleSave(); ui().updateShowIf(card, data); };
    fields.forEach(f => {
      const rendered = ui().renderField(f, data, onFieldChange, ctx.inspection, () => scheduleSave());
      if (rendered) card.appendChild(rendered);
    });
    ui().updateShowIf(card, data);
  }
  c.appendChild(card);

  const nav = document.createElement('div');
  nav.className = 'bottom-nav';

  const backBtn = document.createElement('button');
  backBtn.className = 'btn btn-outline btn-nav';
  backBtn.textContent = '← Back';
  backBtn.onclick = () => { setScreen('home'); ctx.render(); };

  const startBtn = document.createElement('button');
  startBtn.className = 'btn btn-primary btn-nav';
  startBtn.textContent = 'Begin Inspection →';
  startBtn.style = 'background:#2C3F16;';
  startBtn.onclick = () => {
    data._visited = true;
    data._completedAt = new Date().toISOString();
    ctx.currentStepIdx = 1; // skip equipment step - already done here
    setScreen('step');
    ctx.render(); window.scrollTo(0, 0);
    saveNow();
  };

  nav.appendChild(backBtn);
  nav.appendChild(startBtn);
  c.appendChild(nav);
  ctx.root.innerHTML = '';
  ctx.root.appendChild(c);
}

export function renderStep() {
  const renderJob = ++_stepRenderJob;
  if (ctx.currentStepIdx >= ctx.stepList.length || (ctx.stepList[ctx.currentStepIdx] && ctx.stepList[ctx.currentStepIdx].type === 'review')) {
    setScreen('review');
    renderReview();
    return;
  }
  const step = ctx.stepList[ctx.currentStepIdx];

  const data = getStepData(step.id);
  if (!data._enteredAt) data._enteredAt = new Date().toISOString();
  data._roomName = step.name;

  if (step.type === 'debrief') {
    setTimeout(() => {
      if (data.radonPickupTime && !document.getElementById('radon-cal-btn')) {
        const calBtn = document.createElement('button');
        calBtn.id = 'radon-cal-btn';
        calBtn.type = 'button';
        calBtn.className = 'btn btn-outline btn-full';
        calBtn.style = 'margin:8px 0;background:#e8f5e9;border-color:#2C3F16;color:#2C3F16;font-weight:700;';
        calBtn.textContent = '\uD83D\uDCC5 Add Radon Pickup to Calendar';
        calBtn.onclick = () => {
          const dt = new Date(data.radonPickupTime);
          const pad = n => String(n).padStart(2,'0');
          const fmt = d => d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+'T'+pad(d.getHours())+pad(d.getMinutes())+'00';
          const dtEnd = new Date(dt.getTime() + 30*60000);
          const addr = (ctx.inspection.propertyAddress || 'Inspection address').replace(/,/g, '\\,');
          const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nDTSTART:'+fmt(dt)+'\r\nDTEND:'+fmt(dtEnd)+'\r\nSUMMARY:Radon Pickup - '+addr+'\r\nDESCRIPTION:Pick up Airthings Corentium radon monitor\r\nLOCATION:'+addr+'\r\nEND:VEVENT\r\nEND:VCALENDAR';
          const blob = new Blob([ics], {type:'text/calendar'});
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href=url; a.download='radon-pickup.ics'; a.click();
          URL.revokeObjectURL(url);
        };
        const card = document.querySelector('.step-screen .card');
        if (card) card.appendChild(calBtn);
      }
    }, 400);
  }
  if (step.type === 'debrief' && !data.radonPickupTime && ctx.inspection.startedAt) {
    const pickupMs = new Date(ctx.inspection.startedAt).getTime() + 54 * 60 * 60 * 1000;
    const d = new Date(pickupMs);
    const pad = n => String(n).padStart(2, '0');
    data.radonPickupTime = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // Room name left blank intentionally - Dave types the actual room name

  ctx.inspection._lastStepIdx = ctx.currentStepIdx;
  if (ctx.inspection._furthestStepIdx === undefined || ctx.currentStepIdx > ctx.inspection._furthestStepIdx) {
    ctx.inspection._furthestStepIdx = ctx.currentStepIdx;
  }

  const c = ui().el('div', { className: 'screen step-screen' });
  c.appendChild(buildAppHeader(step.name));
  c.appendChild(ui().renderStatusBar(getLastSaveText()));

  const timersBar = ui().renderTimersBar(ctx.inspection);
  if (timersBar) c.appendChild(timersBar);

  const currentPhase = step.phase;
  const phasesWithState = PHASES.map(p => {
    const phaseSteps = ctx.stepList.filter(s => s.phase === p.id && s.type !== 'review');
    const allDone = phaseSteps.length > 0 && phaseSteps.every(s => {
      const d = ctx.inspection.stepData && ctx.inspection.stepData[s.id];
      return d && d._visited;
    });
    return { ...p, done: allDone };
  });
  c.appendChild(ui().renderProgressBar(phasesWithState, currentPhase, step.name, phaseId => {
    const idx = ctx.stepList.findIndex(s => s.phase === phaseId);
    if (idx >= 0) { ctx.currentStepIdx = idx; ctx.render(); }
  }, ctx.currentStepIdx + 1, ctx.stepList.length));

  const phaseSteps = ctx.stepList.filter(s => s.phase === currentPhase && s.type !== 'review');
  const alwaysShowSubNav = ['lowest', 'upper', 'rooms', 'supplementary', 'wrapup'].includes(currentPhase);
  if (phaseSteps.length > 1 || alwaysShowSubNav) {
    const subNav = ui().el('div', { className: 'sub-nav' });
    phaseSteps.forEach((s, i) => {
      const sIdx = ctx.stepList.indexOf(s);
      const isCurr = sIdx === ctx.currentStepIdx;
      const isDone = ctx.inspection.stepData && ctx.inspection.stepData[s.id] && ctx.inspection.stepData[s.id]._visited;
      const btn = ui().el('button', {
        type: 'button',
        className: 'sub-nav-btn' + (isCurr ? ' active' : '') + (isDone ? ' done' : ''),
        onClick: () => { ctx.currentStepIdx = sIdx; ctx.render(); window.scrollTo(0, 0); }
      }, s.name);
      subNav.appendChild(btn);
    });
    c.appendChild(subNav);
  }

  // Back to page 1 (edit intake) button
  const backToIntakeBtn = ui().el('button', {
    type: 'button',
    className: 'btn btn-outline btn-small',
    style: 'position:fixed;top:max(54px,calc(env(safe-area-inset-top) + 8px));right:10px;z-index:200;font-size:11px;padding:4px 10px;display:inline-flex;align-items:center;justify-content:center;',
    onClick: () => { setScreen('intake'); ctx.render(); }
  }, '\u270E Intake');
  c.appendChild(backToIntakeBtn);

  // Search button
  const searchBtn = ui().el('button', {
    type: 'button',
    style: 'position:fixed;top:max(54px,calc(env(safe-area-inset-top) + 8px));right:82px;z-index:200;background:#2C3F16;color:#fff;border:none;border-radius:8px;font-size:15px;padding:6px 12px;cursor:pointer;min-height:0;line-height:1.4;font-weight:700;touch-action:manipulation;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;',
    onClick: () => openSearch()
  }, '\uD83D\uDD0D');
  c.appendChild(searchBtn);

  // Room navigation FAB
  const roomNavFab = ui().el('button', {
    type: 'button',
    className: 'room-nav-fab',
    onClick: () => {
      const existing = document.getElementById('room-drawer-overlay');
      if (existing) { existing.remove(); return; }
      document.body.appendChild(buildRoomDrawer());
    }
  }, '\uD83D\uDCCD');
  c.appendChild(roomNavFab);

  // Spare photos FAB
  const spareFab = ui().el('button', {
    type: 'button',
    style: 'position:fixed;bottom:160px;right:16px;width:48px;height:48px;background:#f59e0b;color:#fff;border:none;border-radius:50%;font-size:1.3rem;cursor:pointer;z-index:95;box-shadow:0 4px 14px rgba(0,0,0,0.25);touch-action:manipulation;display:flex;align-items:center;justify-content:center;',
    'aria-label': 'Add spare photo',
    onClick: () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
      inp.onchange = async e => {
        if (!e.target.files[0]) return;
        try {
          const dataUrl = await ui().compressImage ? ui().compressImage(e.target.files[0]) : new Promise(r => { const fr = new FileReader(); fr.onload = ev => r(ev.target.result); fr.readAsDataURL(e.target.files[0]); });
          if (!ctx.inspection.sparePhotos) ctx.inspection.sparePhotos = [];
          const sp = { photoId: 'spare-' + Math.random().toString(36).substr(2,9), timestamp: new Date().toISOString(), caption: '', dataUrl, stepName: step.name, roomName: (getStepData(step.id).roomName || step.name), assignedSlot: null };
          ctx.inspection.sparePhotos.push(sp);
          saveNow();
          if (window.savePhotoToDevice) window.savePhotoToDevice(dataUrl, sp.photoId);

          // ── Quick-assign sheet ──────────────────────────────────
          let selectedSlot = '';
          const overlay = document.createElement('div');
          overlay.className = 'spare-assign-overlay';

          const sheet = document.createElement('div');
          sheet.className = 'spare-assign-sheet';

          const preview = document.createElement('img');
          preview.src = dataUrl;
          preview.className = 'spare-assign-preview';
          sheet.appendChild(preview);

          const sheetTitle = document.createElement('div');
          sheetTitle.className = 'spare-assign-title';
          sheetTitle.textContent = '📸 Assign spare photo';
          sheet.appendChild(sheetTitle);

          const sheetSub = document.createElement('div');
          sheetSub.className = 'spare-assign-subtitle';
          sheetSub.textContent = 'Tap a bucket, then save. You can also skip and assign it in Review.';
          sheet.appendChild(sheetSub);

          sheet.appendChild(buildSpareSlotPicker('', value => { selectedSlot = value || ''; }));

          const capInput = document.createElement('input');
          capInput.type = 'text';
          capInput.placeholder = 'Caption (optional)…';
          capInput.style = 'width:100%;padding:12px;font-size:14px;font-family:inherit;border:1px solid #e5e7eb;border-radius:8px;box-sizing:border-box;margin-bottom:16px;';
          sheet.appendChild(capInput);

          const btnRow = document.createElement('div');
          btnRow.style = 'display:flex;gap:10px;';

          const confirmBtn = document.createElement('button');
          confirmBtn.type = 'button';
          confirmBtn.textContent = 'Save';
          confirmBtn.style = 'flex:1;padding:14px;background:#f59e0b;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;touch-action:manipulation;';
          confirmBtn.onclick = () => {
            if (selectedSlot) sp.assignedSlot = selectedSlot;
            if (capInput.value.trim()) sp.caption = capInput.value.trim();
            saveNow();
            document.body.removeChild(overlay);
            ui().showToast(selectedSlot ? '📸 Spare photo saved + assigned' : '📸 Spare photo saved — assign in Review');
          };

          const skipBtn = document.createElement('button');
          skipBtn.type = 'button';
          skipBtn.textContent = 'Skip';
          skipBtn.style = 'padding:14px 20px;background:transparent;color:#64748b;border:1px solid #e5e7eb;border-radius:10px;font-size:1rem;cursor:pointer;touch-action:manipulation;';
          skipBtn.onclick = () => {
            document.body.removeChild(overlay);
            ui().showToast('📸 Spare photo saved — assign in Review');
          };

          btnRow.appendChild(confirmBtn);
          btnRow.appendChild(skipBtn);
          sheet.appendChild(btnRow);
          overlay.appendChild(sheet);
          document.body.appendChild(overlay);
        } catch(err) { console.error(err); }
      };
      document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 2000);
    }
  }, '📸');
  c.appendChild(spareFab);

  c.appendChild(ui().el('h1', { className: 'screen-title' }, step.name));

  const fieldGen = STEP_FIELDS[step.type];
  let pendingFieldRender = null;
  if (fieldGen) {
    const fields = fieldGen();
    const card = ui().el('div', { className: 'card' });
    const onFieldChange = () => {
      data._updatedAt = new Date().toISOString();
      scheduleSave();
      ui().updateShowIf(card, data);
      // Change 3: Detect allSectionsComplete on post-assessment step
      if (step.type === 'post-assessment' && data.finalCheck &&
          data.finalCheck.allSectionsComplete === true &&
          data.finalCheck.allPhotosUploaded === true &&
          data.finalCheck.assessmentComplete === true) {
        const issues = collectInspectionIssues();
        if (issues.length) {
          data.finalCheck.allSectionsComplete = false;
          scheduleSave();
          alert('The following items are incomplete:\n\u2022 ' + formatIssueList(issues).join('\n\u2022 ') + '\n\nReview each flagged section before final sync.');
          setScreen('review');
          ctx.render();
          window.scrollTo(0, 0);
          return;
        }
        if (ctx._finalSyncTriggeredId !== (ctx.inspection && ctx.inspection.inspectionId)) {
          ctx._finalSyncTriggeredId = ctx.inspection.inspectionId;
          ctx.triggerFinalSync();
        }
      }
    };
    c.appendChild(card);
    pendingFieldRender = {
      card,
      fields,
      data,
      onFieldChange,
      inspection: ctx.inspection,
      onSave: () => { scheduleSave(); },
      jobId: renderJob
    };
  }

  if (step.dynamic === 'lowest') {
    const lowestSteps = ctx.stepList.filter(s => s.dynamic === 'lowest');
    if (step.id === lowestSteps[lowestSteps.length - 1].id) {
      c.appendChild(ui().el('button', { className: 'btn btn-outline btn-full', onClick: () => { ctx.addDynamicRoom('lowest'); window.scrollTo(0, 0); } }, '+ Add Another Room (Lowest Level)'));
    }
  }
  if (step.type === 'bedroom') {
    const bedroomSteps = ctx.stepList.filter(s => s.type === 'bedroom');
    if (step.id === bedroomSteps[bedroomSteps.length - 1].id) {
      c.appendChild(ui().el('button', { className: 'btn btn-outline btn-full', style: 'margin-top:8px', onClick: () => { ctx.addDynamicRoom('additional', 'Bedroom'); window.scrollTo(0, 0); } }, '+ Add Another Bedroom'));
    }
  }
  if (step.type === 'bathroom') {
    const bathroomSteps = ctx.stepList.filter(s => s.type === 'bathroom');
    if (step.id === bathroomSteps[bathroomSteps.length - 1].id) {
      c.appendChild(ui().el('button', { className: 'btn btn-outline btn-full', style: 'margin-top:8px', onClick: () => { ctx.addDynamicRoom('additional', 'Bathroom'); window.scrollTo(0, 0); } }, '+ Add Another Bathroom'));
    }
  }
  if (step.phase === 'supplementary' || (step.phase === 'main' && step.id === 'kitchen-air')) {
    if (step.id === 'kitchen-air' || (step.dynamic === 'additional' && step.id === ctx.stepList.filter(s => s.dynamic === 'additional').pop()?.id)) {
      c.appendChild(ui().el('button', { className: 'btn btn-outline btn-full', onClick: () => { ctx.addDynamicRoom('additional'); window.scrollTo(0, 0); } }, '+ Add Additional Room'));
    }
  }

  data._visited = true;

  const fieldsStillRendering = !!pendingFieldRender;
  const backButton = ctx.currentStepIdx > 0
    ? ui().el('button', { className: 'btn btn-outline btn-nav', onClick: () => { ctx.currentStepIdx--; ctx.render(); window.scrollTo(0, 0); } }, '\u2190 Back')
    : ui().el('div');
  const homeButton = ui().el('button', {
    type: 'button',
    className: 'btn btn-outline btn-home',
    onClick: () => {
      if (confirm('Return to home? Your progress is saved.')) {
        setScreen('home');
        ctx.render();
      }
    }
  }, '\uD83C\uDFE0');
  const nextLabel = ctx.currentStepIdx < ctx.stepList.length - 2 ? 'Next \u2192' : 'Review \u2192';
  const nextButton = ui().el('button', { className: 'btn btn-primary btn-nav', onClick: () => {
      if (nextButton.dataset.fieldsReady === 'false') {
        ui().showToast('Finishing this section...');
        return;
      }
      try {
        const missing = validateStep(step);
        const warnings = warnStep(step);
        if (missing.length) { ui().showToast(missing.length + ' item' + (missing.length > 1 ? 's' : '') + ' still required'); ui().flashUncheckedItems(c); return; }
        if (warnings.length) { ui().showToast('\u26a0\ufe0f ' + warnings.join(', '), 3500); }
        data._completedAt = new Date().toISOString();
        ctx.currentStepIdx++;
        ctx.render(); window.scrollTo(0, 0);
        saveNow();
        checkpointToCloud(ctx.stepList);
      } catch (e) {
        console.error('Next button error:', e);
        ui().showToast('Error: ' + (e && e.message ? e.message : String(e)));
      }
    }}, fieldsStillRendering ? 'Loading...' : nextLabel);
  nextButton.dataset.fieldsReady = fieldsStillRendering ? 'false' : 'true';
  if (fieldsStillRendering) nextButton.disabled = true;

  const navButtons = [
    backButton,
    homeButton,
    nextButton
  ];
  if (isDevMode()) {
    navButtons.push(ui().el('button', { className: 'btn btn-nav', style: 'background:#ff9900;color:#000;font-size:12px;padding:6px 10px;', onClick: () => {
      data._completedAt = new Date().toISOString();
      data._visited = true;
      ctx.currentStepIdx++;
      saveNow().then(() => { ctx.render(); window.scrollTo(0, 0); });
    }}, 'Skip \u23e9'));
  }
  const nav = ui().el('div', { className: 'bottom-nav' }, navButtons);
  c.appendChild(nav);
  ctx.root.appendChild(c);

  if (pendingFieldRender) {
    pendingFieldRender.onComplete = () => {
      nextButton.disabled = false;
      nextButton.dataset.fieldsReady = 'true';
      nextButton.textContent = nextLabel;
    };
    renderFieldsIncrementally(pendingFieldRender);
  }
}

// ── PHOTOS SCREEN ──────────────────────────────────────────
export function renderPhotos() {
  if (!ctx.inspection) {
    setScreen('home');
    ctx.render();
    return;
  }

  const c = ui().el('div', { className: 'screen photos-screen' });
  c.appendChild(buildAppHeader('Photos'));
  c.appendChild(ui().renderStatusBar(getLastSaveText()));

  const topActions = ui().el('div', { className: 'photo-review-toolbar' });
  topActions.appendChild(ui().el('button', {
    className: 'btn btn-outline',
    onClick: () => { setScreen('review'); ctx.render(); }
  }, 'Back to Review'));
  const rescueBtn = ui().el('button', {
    className: 'btn btn-secondary',
    onClick: async () => {
      rescueBtn.disabled = true;
      rescueBtn.textContent = 'Preparing...';
      try {
        const ok = window.exportLocalPhotoBackup ? await window.exportLocalPhotoBackup() : false;
        rescueBtn.textContent = ok ? 'Backup Ready' : 'Rescue Photos';
      } catch (err) {
        alert('Photo rescue failed: ' + (err && err.message ? err.message : String(err)));
        rescueBtn.textContent = 'Rescue Photos';
      } finally {
        rescueBtn.disabled = false;
      }
    }
  }, 'Rescue Photos');
  const cloudCheckBtn = ui().el('button', {
    className: 'btn btn-primary',
    onClick: async () => {
      cloudCheckBtn.disabled = true;
      cloudCheckBtn.textContent = 'Checking...';
      const result = window.runCloudPreflight ? await window.runCloudPreflight() : { ok: false, message: 'Cloud check unavailable' };
      cloudCheckBtn.textContent = result.ok ? 'Cloud Ready' : 'Cloud Failed';
      if (!result.ok) alert('Cloud check failed: ' + (result.message || 'Unknown error'));
      setTimeout(() => { cloudCheckBtn.textContent = 'Cloud Check'; cloudCheckBtn.disabled = false; }, 2500);
      renderPhotoSummary();
    }
  }, 'Cloud Check');
  topActions.appendChild(rescueBtn);
  topActions.appendChild(cloudCheckBtn);
  c.appendChild(topActions);

  const summaryCard = ui().el('div', { className: 'card photo-review-summary' });
  summaryCard.appendChild(ui().el('h3', { className: 'section-heading' }, 'Photo Status'));
  const summaryBody = ui().el('div', { className: 'photo-health-grid' }, 'Checking...');
  summaryCard.appendChild(summaryBody);
  c.appendChild(summaryCard);

  const list = ui().el('div', { className: 'photo-review-list' });
  c.appendChild(list);

  function statusPill(label, tone) {
    return ui().el('span', { className: 'photo-status-pill photo-status-' + tone }, label);
  }

  function renderPhotoSummary() {
    if (!window.getPhotoHealth) {
      summaryBody.textContent = 'Photo check unavailable.';
      return;
    }
    window.getPhotoHealth().then(h => {
      summaryBody.innerHTML = '';
      summaryBody.appendChild(statusPill(h.total + ' total', 'neutral'));
      summaryBody.appendChild(statusPill(h.local + ' phone', 'good'));
      summaryBody.appendChild(statusPill(h.drive + ' Drive', 'good'));
      summaryBody.appendChild(statusPill(h.pending + ' waiting', h.pending ? 'wait' : 'good'));
      summaryBody.appendChild(statusPill(h.missing + ' missing', h.missing ? 'bad' : 'good'));
      if (h.vaultOnly > 0) summaryBody.appendChild(statusPill(h.vaultOnly + ' vault only', 'wait'));
    }).catch(err => {
      summaryBody.textContent = 'Photo check failed: ' + (err && err.message ? err.message : String(err));
    });
  }

  function renderPhotoCard(ref, idx) {
    const p = ref.photo;
    const card = ui().el('div', { className: 'photo-review-card' });
    const preview = getPhotoPreviewSrc(p);
    const media = ui().el('div', { className: 'photo-review-media' });
    if (preview) {
      media.appendChild(ui().el('img', {
        className: 'photo-review-img',
        src: preview,
        loading: 'lazy',
        alt: 'Photo ' + (idx + 1)
      }));
    } else {
      media.appendChild(ui().el('div', { className: 'photo-review-placeholder' }, (p.driveUrl || p.driveId || p.storagePath || p._driveConfirmed) ? 'In cloud' : 'No preview'));
    }
    card.appendChild(media);

    const body = ui().el('div', { className: 'photo-review-body' });
    body.appendChild(ui().el('div', { className: 'photo-review-title' }, ref.title));
    const meta = [ref.stepName && ref.stepName !== ref.title ? ref.stepName : '', formatPhotoTime(p.timestamp)].filter(Boolean).join(' | ');
    if (meta) body.appendChild(ui().el('div', { className: 'photo-review-meta' }, meta));

    const status = getPhotoStatus(p);
    const statusRow = ui().el('div', { className: 'photo-status-row' });
    statusRow.appendChild(statusPill(status.label, status.tone));
    if (p._vaultSaved) statusRow.appendChild(statusPill('Vault', 'good'));
    if (p.driveUrl || p.driveId || p.storagePath || p._driveConfirmed) statusRow.appendChild(statusPill('Cloud confirmed', 'good'));
    if (p.dataUrl && p.dataUrl !== '__uploaded__') statusRow.appendChild(statusPill('Phone copy', 'good'));
    body.appendChild(statusRow);

    const cap = ui().el('textarea', {
      className: 'photo-caption-input',
      rows: 2,
      placeholder: 'Caption'
    });
    cap.value = p.caption || '';
    cap.addEventListener('input', () => {
      p.caption = cap.value;
      if (window.DB && window.DB.updatePhoto && p.photoId) {
        window.DB.updatePhoto(p.photoId, { caption: p.caption, updatedAt: Date.now() });
      }
      scheduleSave();
    });
    body.appendChild(cap);

    if (p.driveUrl) {
      body.appendChild(ui().el('button', {
        className: 'btn btn-small btn-outline photo-drive-btn',
        onClick: () => window.open(p.driveUrl, '_blank')
      }, 'Open Drive'));
    }

    card.appendChild(body);
    return card;
  }

  function renderPhotoList() {
    const refs = collectInspectionPhotoRefs();
    list.innerHTML = '';
    if (!refs.length) {
      list.appendChild(ui().el('div', { className: 'empty-msg' }, 'No photos yet'));
      return;
    }
    refs.forEach((ref, idx) => list.appendChild(renderPhotoCard(ref, idx)));
  }

  renderPhotoSummary();
  renderPhotoList();
  if (window.hydrateInspectionPhotosFromVault) {
    window.hydrateInspectionPhotosFromVault(ctx.inspection).then(result => {
      if (result && result.recovered && getScreen() === 'photos') {
        renderPhotoSummary();
        renderPhotoList();
      }
    }).catch(() => {});
  }

  c.appendChild(ui().el('div', { className: 'bottom-nav' }, [
    ui().el('button', { className: 'btn btn-outline btn-nav', onClick: () => { setScreen('review'); ctx.render(); } }, 'Back to Review')
  ]));

  ctx.root.appendChild(c);
  window.scrollTo(0, 0);
}

// ── REVIEW SCREEN ──────────────────────────────────────────
export function renderReview() {
  const c = ui().el('div', { className: 'screen review-screen' });
  c.appendChild(buildAppHeader('Final Review'));
  c.appendChild(ui().renderStatusBar(getLastSaveText()));
  const reviewIssues = collectInspectionIssues();
  if (!ctx.inspection._departureChecklist) ctx.inspection._departureChecklist = {};
  const depData = ctx.inspection._departureChecklist;
  const depItems = [
    { key: 'downloadQtrak', label: 'Download Q-Trak data to computer' },
    { key: 'shipSamples', label: 'Ship all lab samples' }
  ];

  const leaveCard = ui().el('div', { className: 'card leave-card', id: 'leave-status-card' });
  leaveCard.appendChild(ui().el('h3', { className: 'section-heading' }, 'Can I Leave?'));
  const leaveStatus = ui().el('div', { className: 'leave-status leave-wait' }, 'Checking...');
  const leaveDetail = ui().el('div', { className: 'leave-detail' });
  const leaveMetrics = ui().el('div', { className: 'leave-metrics' });
  leaveCard.appendChild(leaveStatus);
  leaveCard.appendChild(leaveDetail);
  leaveCard.appendChild(leaveMetrics);
  const leaveActions = ui().el('div', { className: 'leave-actions' });
  const photosBtn = ui().el('button', {
    className: 'btn btn-primary',
    onClick: () => { setScreen('photos'); ctx.render(); }
  }, 'Photos');
  const rescueBtn = ui().el('button', {
    className: 'btn btn-outline',
    onClick: async () => {
      rescueBtn.disabled = true;
      rescueBtn.textContent = 'Preparing...';
      try {
        const ok = window.exportLocalPhotoBackup ? await window.exportLocalPhotoBackup() : false;
        rescueBtn.textContent = ok ? 'Backup Ready' : 'Rescue Photos';
      } catch (err) {
        alert('Photo rescue failed: ' + (err && err.message ? err.message : String(err)));
        rescueBtn.textContent = 'Rescue Photos';
      } finally {
        rescueBtn.disabled = false;
      }
    }
  }, 'Rescue Photos');
  const cloudCheckBtn = ui().el('button', {
    className: 'btn btn-secondary',
    onClick: async () => {
      cloudCheckBtn.disabled = true;
      cloudCheckBtn.textContent = 'Checking...';
      const result = window.runCloudPreflight ? await window.runCloudPreflight() : { ok: false, message: 'Cloud check unavailable' };
      cloudCheckBtn.textContent = result.ok ? 'Cloud Ready' : 'Cloud Failed';
      if (!result.ok) alert('Cloud check failed: ' + (result.message || 'Unknown error'));
      setTimeout(() => { cloudCheckBtn.textContent = 'Cloud Check'; cloudCheckBtn.disabled = false; }, 2500);
      refreshLeaveStatus();
    }
  }, 'Cloud Check');
  leaveActions.appendChild(photosBtn);
  leaveActions.appendChild(rescueBtn);
  leaveActions.appendChild(cloudCheckBtn);
  leaveCard.appendChild(leaveActions);
  c.appendChild(leaveCard);

  function leaveMetric(label, value, tone) {
    return ui().el('div', { className: 'leave-metric leave-metric-' + tone }, [
      ui().el('span', null, label),
      ui().el('strong', null, value)
    ]);
  }

  async function refreshLeaveStatus() {
    const departureDone = depItems.every(i => !!depData[i.key]);
    const lastCloud = getBestCloudSyncAt();
    const syncStatus = getSyncStatus();
    let health = { total: 0, local: 0, drive: 0, pending: 0, missing: 0, vaultOnly: 0 };
    let healthError = '';
    if (window.getPhotoHealth) {
      try {
        health = await window.getPhotoHealth();
      } catch (err) {
        healthError = err && err.message ? err.message : String(err);
      }
    } else {
      healthError = 'Photo check unavailable';
    }

    const blockers = [];
    const warnings = [];
    if (healthError) blockers.push('Photo check failed');
    if (health.missing > 0) blockers.push(health.missing + ' missing photo' + (health.missing === 1 ? '' : 's'));
    if (reviewIssues.length) blockers.push(reviewIssues.length + ' required item' + (reviewIssues.length === 1 ? '' : 's'));
    if (!departureDone) blockers.push('Leave checklist open');
    if (!lastCloud) blockers.push('No cloud backup yet');
    if (health.pending > 0) warnings.push(health.pending + ' photo' + (health.pending === 1 ? '' : 's') + ' waiting to upload');
    if ((syncStatus === 'failed' || syncStatus === 'final-failed') && lastCloud) warnings.push('Cloud retry needed');

    let tone = 'go';
    let title = 'Safe to leave';
    if (blockers.length) {
      tone = 'stop';
      title = 'Not yet';
    } else if (warnings.length) {
      tone = 'wait';
      title = 'Almost ready';
    }

    leaveStatus.className = 'leave-status leave-' + tone;
    leaveStatus.textContent = title;
    leaveDetail.textContent = blockers.length ? blockers.join(' | ') : (warnings.length ? warnings.join(' | ') : 'Photos, backup, checklist, and required fields are clear.');
    leaveMetrics.innerHTML = '';
    leaveMetrics.appendChild(leaveMetric('Photos', health.missing ? health.missing + ' missing' : (health.pending ? health.pending + ' waiting' : health.total + ' safe'), health.missing ? 'bad' : (health.pending ? 'wait' : 'good')));
    leaveMetrics.appendChild(leaveMetric('Cloud', getCloudLabel(), lastCloud ? ((syncStatus === 'failed' || syncStatus === 'final-failed') ? 'wait' : 'good') : 'bad'));
    leaveMetrics.appendChild(leaveMetric('Required', reviewIssues.length ? reviewIssues.length + ' open' : 'Clear', reviewIssues.length ? 'bad' : 'good'));
    leaveMetrics.appendChild(leaveMetric('Before leaving', departureDone ? 'Done' : 'Open', departureDone ? 'good' : 'bad'));
    if (health.vaultOnly > 0) leaveMetrics.appendChild(leaveMetric('Rescue vault', String(health.vaultOnly), 'wait'));
  }
  refreshLeaveStatus();

  const legendBar = ui().el('div', { className: 'review-guide' });
  legendBar.innerHTML = '<strong>Status guide:</strong> Visited = opened. Not visited = skipped. Drive photos are already backed up.';
  c.appendChild(legendBar);

  // ── 6a: Departure Checklist ──
  const depCard = ui().el('div', { className: 'card' });
  depCard.appendChild(ui().el('h3', { className: 'section-heading' }, 'Before You Leave'));
  const allInspBtn = ui().el('button', {
    className: 'btn btn-outline btn-full',
    onClick: () => { setScreen('home'); ctx.inspection = null; setInspection(null); ctx.stopAutoSave(); ctx.render(); }
  }, 'All Inspections');

  function updateDepState() {
    const allDone = depItems.every(i => !!depData[i.key]);
    allInspBtn.disabled = !allDone;
    allInspBtn.style.opacity = allDone ? '1' : '0.4';
    allInspBtn.style.pointerEvents = allDone ? 'auto' : 'none';
    scheduleSave();
  }

  depItems.forEach(item => {
    depCard.appendChild(ui().renderCheck(item.key, item.label, !!depData[item.key], v => {
      depData[item.key] = v;
      updateDepState();
      refreshLeaveStatus();
    }));
  });
  c.appendChild(depCard);

  const hCard = ui().el('div', { className: 'card' });
  hCard.appendChild(ui().el('h3', { className: 'section-heading' }, 'Inspection Details'));
  const infoFields = [
    ['ID', ctx.inspection.inspectionId], ['Inspector', ctx.inspection.inspectorName],
    ['Client', ctx.inspection.clientName], ['Address', ctx.inspection.propertyAddress],
    ['Date', ctx.inspection.inspectionDate], ['Levels', ctx.inspection.numberOfLevels],
    ['Bedrooms', ctx.inspection.numberOfBedrooms], ['Bathrooms', ctx.inspection.numberOfBathrooms],
    ['Water Source', (Array.isArray(ctx.inspection.waterSource) ? ctx.inspection.waterSource.join(', ') : (ctx.inspection.waterSource || '--')) + (ctx.inspection.waterSourceDescription ? ' (' + ctx.inspection.waterSourceDescription + ')' : '')],
    ['Wifi', ctx.inspection.wifiNetwork],
    ['Occupancy', ctx.inspection.stepData?.['property-details']?.occupancyDuringInspection], ['Weather', ctx.inspection.stepData?.['property-details']?.weatherConditions],
    ['Started', ui().fmtDate(ctx.inspection.startedAt)], ['Status', ctx.inspection.status]
  ];
  infoFields.forEach(([l, v]) => {
    hCard.appendChild(ui().el('div', { className: 'info-row' }, [
      ui().el('span', { className: 'info-label' }, l),
      ui().el('span', { className: 'info-value' }, v || '--')
    ]));
  });
  if (ctx.inspection.clientConcerns) hCard.appendChild(ui().el('div', { className: 'info-block' }, [ui().el('strong', null, 'Client Concerns: '), document.createTextNode(ctx.inspection.clientConcerns)]));
  if (ctx.inspection.knownProblemAreas) hCard.appendChild(ui().el('div', { className: 'info-block' }, [ui().el('strong', null, 'Known Problem Areas: '), document.createTextNode(ctx.inspection.knownProblemAreas)]));
  c.appendChild(hCard);

  // ── Room Summaries ──
  const summariesCard = ui().el('div', { className: 'card' });
  summariesCard.appendChild(ui().el('h3', { className: 'section-heading' }, 'Room Findings'));

  // Collect all rooms that have raw notes OR an AI summary
  const roomStepTypes = ['room-test','bedroom','bathroom','living-area','kitchen-appliance','water-sample','atp-kitchen','kitchen-air','additional-room','utility'];
  const roomSteps = ctx.stepList.filter(s => {
    if (!roomStepTypes.includes(s.type)) return false;
    const d = ctx.inspection.stepData && ctx.inspection.stepData[s.id];
    return d && (d.aiSummary || d.notes || (d.observations && d.observations.length) || d.followUpNote);
  });

  if (roomSteps.length === 0) {
    summariesCard.appendChild(ui().el('p', { style: 'color:var(--text-muted);font-size:0.9rem;padding:8px 0;' }, 'No room findings yet'));
  } else {
    roomSteps.forEach(s => {
      const d = ctx.inspection.stepData[s.id];
      const roomBlock = ui().el('div', { style: 'margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--accent-light);' });

      // Room name
      roomBlock.appendChild(ui().el('div', { style: 'font-weight:700;font-size:1rem;color:var(--primary);margin-bottom:8px;' }, d.roomName || s.name));

      // Raw notes side
      const hasObs = d.observations && d.observations.length > 0;
      const hasNotes = d.notes && d.notes.trim();
      const hasFollowUp = d.followUpNote && d.followUpNote.trim();
      const hasRaw = hasObs || hasNotes || hasFollowUp;

      if (hasRaw) {
        const rawBlock = ui().el('div', { style: 'background:#f8f9fa;border-left:3px solid #aaa;border-radius:0 6px 6px 0;padding:8px 10px;margin-bottom:8px;font-size:0.85rem;' });
        rawBlock.appendChild(ui().el('div', { style: 'font-size:0.75rem;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;' }, 'Inspector Notes'));
        if (hasObs) rawBlock.appendChild(ui().el('div', { style: 'margin-bottom:4px;' }, 'Observations: ' + d.observations.join(', ')));
        if (hasNotes) rawBlock.appendChild(ui().el('div', { style: 'margin-bottom:4px;' }, d.notes.trim()));
        if (hasFollowUp) rawBlock.appendChild(ui().el('div', { style: 'color:#b45309;' }, '⚠️ Follow-up: ' + d.followUpNote.trim()));
        roomBlock.appendChild(rawBlock);
      }

      // AI summary side
      if (d.aiSummary) {
        const aiBlock = ui().el('div', { style: 'background:#f0f7ee;border-left:3px solid var(--primary);border-radius:0 6px 6px 0;padding:8px 10px;font-size:0.85rem;' });
        aiBlock.appendChild(ui().el('div', { style: 'font-size:0.75rem;font-weight:600;color:var(--primary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;' }, 'AI Summary'));
        aiBlock.appendChild(ui().el('div', null, d.aiSummary));
        roomBlock.appendChild(aiBlock);
      }

      summariesCard.appendChild(roomBlock);
    });
  }
  c.appendChild(summariesCard);

  if (ctx.inspection.status !== 'completed' && reviewIssues.length) {
    const issuesByStep = new Map();
    reviewIssues.forEach(issue => {
      const existing = issuesByStep.get(issue.step.id);
      if (existing) existing.messages.push(issue.message);
      else issuesByStep.set(issue.step.id, {
        step: issue.step,
        stepIdx: issue.stepIdx,
        messages: [issue.message]
      });
    });

    const issueCard = ui().el('div', { className: 'card review-issues-card' });
    issueCard.appendChild(ui().el('h3', { className: 'section-heading' }, 'Needs Review'));
    issuesByStep.forEach(item => {
      issueCard.appendChild(ui().el('button', {
        type: 'button',
        className: 'review-issue-btn',
        onClick: () => goToStep(item.stepIdx)
      }, [
        ui().el('span', { className: 'review-issue-title' }, item.step.name),
        ui().el('span', { className: 'review-issue-detail' }, item.messages.join(' • '))
      ]));
    });
    c.appendChild(issueCard);
  }

  ctx.stepList.forEach((step, idx) => {
    if (step.type === 'review') return;
    const data = (ctx.inspection.stepData && ctx.inspection.stepData[step.id]) || {};
    const visited = !!data._visited;
    const stepIssues = getStepReviewIssues(step);
    const statusText = !visited ? 'Not visited' : (stepIssues.length ? 'Needs review' : 'Visited');
    const statusClass = !visited || stepIssues.length ? 'in-progress' : 'completed';
    const sCard = ui().el('div', { className: 'card' + ((!visited || stepIssues.length) ? ' card-incomplete' : '') });
    sCard.appendChild(ui().el('div', { className: 'review-step-header' }, [
      ui().el('h3', { className: 'section-heading' }, [
        document.createTextNode(step.name + ' '),
        ui().el('button', {
          type: 'button',
          className: 'badge review-status-badge ' + statusClass,
          onClick: () => goToStep(idx)
        }, statusText)
      ]),
      ui().el('button', { className: 'btn btn-small btn-outline', onClick: () => goToStep(idx) }, 'Edit')
    ]));

    const summary = ui().el('div', { className: 'review-summary' });
    if (stepIssues.length) {
      summary.appendChild(ui().el('div', { className: 'review-step-issues' }, stepIssues.map(issue =>
        ui().el('div', { className: 'review-step-issue' }, issue)
      )));
    }
    const fieldGen = STEP_FIELDS[step.type];
    if (fieldGen && visited) {
      const fields = fieldGen();
      fields.forEach(f => {
        if (!f.key || f.type === 'heading' || f.type === 'info' || f.type === 'divider' || f.type === 'photo' || f.type === 'timer') return;
        const val = data[f.key];
        if (val === undefined || val === null || val === '') return;
        let display = '';
        if (f.type === 'reading' && typeof val === 'object') {
          if (val.status === 'not_tested') display = 'Not tested';
          else if (val.status === 'not_applicable') display = 'N/A';
          else if (val.value != null) display = val.value + (val.unit ? ' ' + val.unit : '');
          else return;
        } else if (f.type === 'checklist' && typeof val === 'object') {
          const checked = Object.entries(val).filter(([, v]) => v === true).length;
          display = checked + '/' + (f.items ? f.items.length : 0) + ' checked';
        } else if (f.type === 'chips' && Array.isArray(val)) {
          if (!val.length) return;
          display = val.join(', ');
        } else if (typeof val === 'boolean') {
          display = val ? 'Yes' : 'No';
        } else {
          display = String(val);
        }
        summary.appendChild(ui().el('div', { className: 'review-item' }, [
          ui().el('span', { className: 'review-item-label' }, (f.label || f.key) + ': '),
          ui().el('span', null, display)
        ]));
      });
      // Show all photo arrays (handles _photos, _beforePhotos, _afterPhotos, ATP photos, etc.)
      const photoArrayKeys = Object.keys(data).filter(k =>
        k.startsWith('_') && Array.isArray(data[k]) && data[k].length &&
        data[k][0] && typeof data[k][0].photoId === 'string'
      );
      photoArrayKeys.forEach(pk => {
        const arr = data[pk];
        const labelRaw = pk.slice(1).replace(/Photos$/, '').replace(/([A-Z])/g, ' $1').trim();
        const label = (labelRaw || 'All') + ' Photos';
        summary.appendChild(ui().el('div', { className: 'review-photos-section' }, [ui().el('strong', null, arr.length + ' ' + label + ':')]));
        const grid = ui().el('div', { className: 'review-photo-grid' });
        arr.forEach(p => {
          grid.appendChild(ui().el('div', { className: 'review-photo-item' }, [
            ui().el('img', { src: getPhotoPreviewSrc(p), className: 'review-photo-img', loading: 'lazy' }),
            p.caption ? ui().el('div', { className: 'review-photo-caption' }, p.caption) : null
          ]));
        });
        summary.appendChild(grid);
      });
    }
    sCard.appendChild(summary);
    c.appendChild(sCard);
  });

  const exportData = buildExportJSON(ctx.stepList);

  const actCard = ui().el('div', { className: 'card actions-card' });

  if (ctx.inspection.status !== 'completed') {
    const submitBtn = ui().el('button', { className: 'btn btn-primary btn-full', onClick: () => {
      const allIssues = formatIssueList(collectInspectionIssues());
      if (allIssues.length) {
        const names = allIssues.join('\n\u2022 ');
        alert('The following items are incomplete:\n\u2022 ' + names + '\n\nPlease address these before marking as complete.');
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting... \u23f3';
      ctx.inspection.status = 'completed';
      ctx.inspection.endedAt = new Date().toISOString();
      ctx.inspection.completedAt = ctx.inspection.endedAt;
      const completeData = buildExportJSON(ctx.stepList);
      saveNow().then(async () => {
        const ok = await submitInspection(completeData);
        if (!ok) {
          submitBtn.disabled = false;
          submitBtn.textContent = '\u2713 Submit Inspection';
          return;
        }
        setScreen('home'); ctx.inspection = null; setInspection(null); ctx.stopAutoSave(); ctx.render();
      });
    }}, '\u2713 Submit Inspection');
    actCard.appendChild(submitBtn);
  } else {
    const reuploadBtn = ui().el('button', { className: 'btn btn-outline btn-full', onClick: async () => {
      reuploadBtn.disabled = true;
      reuploadBtn.textContent = 'Uploading\u2026 \u23f3';
      try {
        const reuploadData = buildExportJSON(ctx.stepList);
        const allPhotos = extractAllPhotosFromExport(reuploadData);
        const ok = await submitInspection(reuploadData);
        if (!ok) {
          throw new Error(
            (ctx.inspection && ctx.inspection._lastFinalSyncError) ||
            'Drive did not confirm every photo upload.'
          );
        }
        reuploadBtn.textContent = '\u2713 Upload Complete (' + allPhotos.length + ' photos)';
      } catch(e) {
        reuploadBtn.disabled = false;
        reuploadBtn.textContent = '\u21ba Re-upload photos';
        alert('Upload failed: ' + e.message);
      }
    }}, '\u21ba Re-upload photos');
    actCard.appendChild(ui().el('div', { className: 'completed-banner' }, [
      ui().el('strong', null, '\u2713 Inspection Complete'),
      ui().el('p', null, 'Completed: ' + ui().fmtDate(ctx.inspection.endedAt)),
      reuploadBtn
    ]));
  }
  c.appendChild(actCard);

  // Initial departure checklist state
  updateDepState();

  c.appendChild(ui().el('div', { className: 'bottom-nav' }, [
    ui().el('button', { className: 'btn btn-outline btn-nav', onClick: () => {
      if (ctx.inspection.status !== 'completed') { ctx.currentStepIdx = ctx.stepList.length - 2; setScreen('step'); }
      else { setScreen('home'); ctx.inspection = null; setInspection(null); ctx.stopAutoSave(); }
      ctx.render();
    }}, ctx.inspection.status !== 'completed' ? '\u2190 Back to Steps' : '\u2190 Home'),
    allInspBtn
  ]));


  // Spare Photos section in Review
  if (ctx.inspection.sparePhotos && ctx.inspection.sparePhotos.length) {
    const unassigned = ctx.inspection.sparePhotos.filter(sp => !sp.assignedSlot);
    const assigned   = ctx.inspection.sparePhotos.filter(sp =>  sp.assignedSlot);

    // ── Bucket header ──
    const spHead = document.createElement('div');
    spHead.style = 'background:' + (unassigned.length ? '#fff8e1' : '#f0fdf4') + ';border-left:4px solid ' + (unassigned.length ? '#f59e0b' : '#22c55e') + ';padding:12px 16px;margin:16px 0 8px;border-radius:4px;display:flex;align-items:center;justify-content:space-between;';
    spHead.innerHTML = '<span style="font-weight:800;color:' + (unassigned.length ? '#92400e' : '#166534') + ';">📸 Spare Photos (' + ctx.inspection.sparePhotos.length + ')</span>' +
      (unassigned.length ? '<span style="font-size:12px;font-weight:700;background:#f59e0b;color:#fff;padding:2px 10px;border-radius:99px;">' + unassigned.length + ' need assignment</span>' : '<span style="font-size:12px;color:#166534;">✓ All assigned</span>');
    c.appendChild(spHead);

    // ── Render a single spare photo card ──
    function renderSpareCard(sp, i) {
      const spCard = document.createElement('div');
      spCard.className = 'photo-card';
      spCard.style = 'margin-bottom:10px;border:2px solid ' + (sp.assignedSlot ? '#22c55e' : '#f59e0b') + ';border-radius:8px;overflow:hidden;';
      spCard.id = 'spare-card-' + sp.photoId;

      // Photo
      const spImg = document.createElement('img');
      spImg.src = getPhotoPreviewSrc(sp);
      spImg.className = 'photo-img';
      spImg.loading = 'lazy';
      spImg.alt = 'Spare ' + (i + 1);
      spCard.appendChild(spImg);

      // Meta
      const spMeta = document.createElement('div');
      spMeta.style = 'padding:4px 10px;font-size:11px;color:#64748b;';
      spMeta.textContent = 'Captured during: ' + (sp.roomName || sp.stepName || 'inspection') + ' • ' + new Date(sp.timestamp).toLocaleTimeString();
      spCard.appendChild(spMeta);

      // Caption
      const spCap = document.createElement('input');
      spCap.type = 'text';
      spCap.placeholder = 'Caption…';
      spCap.value = sp.caption || '';
      spCap.style = 'width:100%;border:none;border-top:1px solid #e5e7eb;padding:10px;font-size:13px;font-family:inherit;box-sizing:border-box;';
      spCap.oninput = () => { sp.caption = spCap.value; scheduleSave(); };
      spCard.appendChild(spCap);

      // ── AI Caption Suggestion (spare photos) ────────────────────
      if (sp.dataUrl && sp.dataUrl !== '__uploaded__') {
        const aiSpareBtn = document.createElement('button');
        aiSpareBtn.type = 'button';
        aiSpareBtn.textContent = '✨ Suggest caption';
        aiSpareBtn.style = 'display:block;width:100%;padding:6px 10px;border-top:1px solid #e5e7eb;background:#f0f4ff;border-left:none;border-right:none;border-bottom:none;color:#3a5ec5;font-size:0.82rem;font-weight:600;cursor:pointer;text-align:left;';
        aiSpareBtn.onclick = async () => {
          aiSpareBtn.disabled = true;
          aiSpareBtn.textContent = '⏳ Analyzing photo...';
          try {
            const PROXY_URL = VISION_PROXY_URL;
            const base64 = sp.dataUrl.split(',')[1];
            const mimeType = (sp.dataUrl.split(';')[0].split(':')[1]) || 'image/jpeg';
            const prompt = 'You are a home health inspector writing a caption for a photo taken during a residential inspection.' +
              ' The caption should be 1-2 sentences, written in plain, accessible language — not overly technical.' +
              ' Describe what is visible in the photo.' +
              ' If there is any issue present, briefly explain how it could affect the health or comfort of the home\'s occupants if left unaddressed (e.g. mold risk, air quality, water quality, structural safety).' +
              ' If the photo shows something that appears normal and fine, just describe it briefly.' +
              ' Do not use alarming language. Be matter-of-fact and helpful.' +
              (sp.roomName ? ' Room: ' + sp.roomName + '.' : '') +
              (sp.stepName ? ' Section: ' + sp.stepName + '.' : '') +
              ' Return ONLY the caption text, no quotes, no labels, no extra formatting.';
            const resp = await fetch(PROXY_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ imageBase64: base64, mimeType, prompt })
            });
            if (!resp.ok) throw new Error('API_ERROR ' + resp.status);
            const result = await resp.json();
            const text = result.content && result.content[0] && result.content[0].text;
            if (!text) throw new Error('EMPTY_RESPONSE');
            sp.caption = text.trim();
            spCap.value = sp.caption;
            scheduleSave();
            aiSpareBtn.textContent = '✓ Caption added — edit if needed';
            aiSpareBtn.style.background = '#edfaf1';
            aiSpareBtn.style.color = '#1e7e34';
            setTimeout(() => {
              aiSpareBtn.textContent = '✨ Re-suggest caption';
              aiSpareBtn.disabled = false;
              aiSpareBtn.style.background = '#f0f4ff';
              aiSpareBtn.style.color = '#3a5ec5';
            }, 3000);
          } catch (err) {
            aiSpareBtn.disabled = false;
            aiSpareBtn.textContent = '✨ Suggest caption';
          }
        };
        spCard.appendChild(aiSpareBtn);
      }

      // Section assignment buttons
      const assignWrap = document.createElement('div');
      assignWrap.style = 'padding:8px 10px;border-top:1px solid #e5e7eb;background:#f8fafc;';

      const assignLabel = document.createElement('div');
      assignLabel.style = 'font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;';
      assignLabel.textContent = 'Assign to section';
      assignWrap.appendChild(assignLabel);

      const picker = buildSpareSlotPicker(sp.assignedSlot || '', value => {
        sp.assignedSlot = value || null;
        scheduleSave();
        const container = document.getElementById('spare-photos-container');
        if (container) {
          container.parentNode.removeChild(container);
        }
        renderSpareSection();
      }, { compact: true, includeUnassigned: true });

      assignWrap.appendChild(picker);
      spCard.appendChild(assignWrap);
      return spCard;
    }

    // ── Render the full spare section ──
    function renderSpareSection() {
      const wrap = document.createElement('div');
      wrap.id = 'spare-photos-container';

      const unassignedNow = ctx.inspection.sparePhotos.filter(sp => !sp.assignedSlot);
      const assignedNow   = ctx.inspection.sparePhotos.filter(sp =>  sp.assignedSlot);

      // Update header
      spHead.style.background = unassignedNow.length ? '#fff8e1' : '#f0fdf4';
      spHead.style.borderLeftColor = unassignedNow.length ? '#f59e0b' : '#22c55e';
      spHead.innerHTML = '<span style="font-weight:800;color:' + (unassignedNow.length ? '#92400e' : '#166534') + ';">📸 Spare Photos (' + ctx.inspection.sparePhotos.length + ')</span>' +
        (unassignedNow.length ? '<span style="font-size:12px;font-weight:700;background:#f59e0b;color:#fff;padding:2px 10px;border-radius:99px;">' + unassignedNow.length + ' need assignment</span>' : '<span style="font-size:12px;color:#166534;">✓ All assigned</span>');

      // Unassigned bucket
      if (unassignedNow.length) {
        const bucketHdr = document.createElement('div');
        bucketHdr.style = 'font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;padding:8px 0 4px;';
        bucketHdr.textContent = '⚠️ Needs assignment (' + unassignedNow.length + ')';
        wrap.appendChild(bucketHdr);
        unassignedNow.forEach((sp, i) => wrap.appendChild(renderSpareCard(sp, ctx.inspection.sparePhotos.indexOf(sp))));
      }

      // Assigned bucket
      if (assignedNow.length) {
        const assignedHdr = document.createElement('div');
        assignedHdr.style = 'font-size:11px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:0.05em;padding:12px 0 4px;';
        assignedHdr.textContent = '✓ Assigned (' + assignedNow.length + ')';
        wrap.appendChild(assignedHdr);
        assignedNow.forEach((sp, i) => wrap.appendChild(renderSpareCard(sp, ctx.inspection.sparePhotos.indexOf(sp))));
      }

      c.appendChild(wrap);
    }

    renderSpareSection();
  }

  ctx.root.appendChild(c);
  window.scrollTo(0, 0);
}
