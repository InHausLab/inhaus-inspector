// InHaus Inspector - Screen Rendering
import { VISION_PROXY_URL } from './config.js';
import { setInspection, getScreen, setScreen, getLastSaveText } from './state.js';
import { saveNow, scheduleSave } from './storage.js';
import { buildExportJSON, extractAllPhotosFromExport, stripPhotosFromExport } from './inspection.js';
import { scriptFetch, updateSyncStatus, uploadPhotoImmediate, checkpointToCloud, submitInspection } from './sync.js';
import { STEP_FIELDS, PHASES, buildStepList, getStepData, validateStep, warnStep } from './steps.js';
import { text, textarea, date, sel, chips, photo, divider, showIf } from './fields.js';

// UI globals — accessed lazily via ui() to guarantee window.UI is ready
function ui() { return window.UI; }

// ── Context (set via initScreens) ───────────────────────────
let ctx = null;

export function initScreens(context) {
  ctx = context;
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

  const overlay = ui().el('div', { id: 'room-drawer-overlay', className: 'room-drawer-overlay' });
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
          ctx.currentStepIdx = sIdx;
          overlay.remove();
          ctx.render();
          window.scrollTo(0, 0);
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

  const overlay = ui().el('div', { id: 'search-overlay', className: 'search-overlay' });
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
let __rendering = false;
let __renderCount = 0;
export function render() {
  __renderCount++;
  console.log('[render start]', { count: __renderCount, screen: getScreen(), stepIdx: ctx && ctx.currentStepIdx, stack: new Error().stack });
  if (__rendering) {
    console.error('[RE-ENTRANT RENDER BLOCKED]', { screen: getScreen(), stepIdx: ctx && ctx.currentStepIdx, stack: new Error().stack });
    alert('Blocked re-entrant render — check console for stack trace.');
    return;
  }
  __rendering = true;
  try {
    // Kill any body-level overlays that may have leaked across renders
    ['room-drawer-overlay', 'search-overlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    window.inspection = ctx.inspection;
    ctx.root.innerHTML = '';
    switch (getScreen()) {
      case 'home': renderHome(); break;
      case 'truck-check': renderTruckCheck(); break;
      case 'intake': renderIntake(); break;
      case 'precheck': renderPrecheck(); break;
      case 'step': renderStep(); break;
      case 'review': renderReview(); break;
    }
  } finally {
    __rendering = false;
    console.log('[render end]', { count: __renderCount });
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

  // ── Dev Mode toggle ─────────────────────────────────────
  const devToggle = ui().el('button', {
    className: 'btn btn-outline btn-full',
    style: 'margin-top:8px;font-size:0.8rem;color:#999;border-color:#ddd;',
    onClick: () => {
      toggleDevMode();
    }
  }, isDevMode() ? '\u26a0\ufe0f Dev Mode ON \u2014 tap to disable' : 'Enable Dev Mode');
  c.appendChild(devToggle);

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
        onClick: () => {
          ctx._truckCheck[item.key] = !ctx._truckCheck[item.key];
          box.className = 'check-box' + (ctx._truckCheck[item.key] ? ' checked' : '');
          box.textContent = ctx._truckCheck[item.key] ? '\u2713' : '';
          const checked = countChecked();
          progressEl.textContent = checked + ' of ' + totalItems() + ' items checked';
          continueBtn.className = 'btn btn-full ' + (allRequiredChecked() ? 'btn-primary' : 'btn-disabled');
          continueBtn.disabled = !allRequiredChecked();
        }
      });
      row.appendChild(box);
      row.appendChild(ui().el('div', { className: 'check-label' }, labelText));
      card.appendChild(row);
    });
  });

  // Continue button
  const ready = allRequiredChecked();
  const continueBtn = ui().el('button', {
    className: 'btn btn-full ' + (ready ? 'btn-primary' : 'btn-disabled'),
    disabled: !ready,
    onClick: () => {
      if (!allRequiredChecked()) return;
      setScreen('intake');
      ctx.render();
    }
  }, 'Continue \u2192');

  card.appendChild(ui().el('div', { style: 'margin-top: 1.5rem;' }, [continueBtn]));
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
        saveNow();
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
          const SPARE_SLOTS_CAPTURE = [
            ...Array.from({length:6}, (_,i) => ({ value: 'obs_' + (i+1),         label: 'Observation ' + (i+1) })),
            ...Array.from({length:6}, (_,i) => ({ value: 'actionTaken_' + (i+1), label: 'Action Taken ' + (i+1) })),
            ...Array.from({length:5}, (_,i) => ({ value: 'followUp_' + (i+1),    label: 'Follow-up ' + (i+1) }))
          ];

          const overlay = document.createElement('div');
          overlay.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center;';

          const sheet = document.createElement('div');
          sheet.style = 'background:#fff;border-radius:16px 16px 0 0;padding:20px 16px 32px;width:100%;max-width:480px;box-sizing:border-box;';

          const preview = document.createElement('img');
          preview.src = dataUrl;
          preview.style = 'width:100%;max-height:180px;object-fit:cover;border-radius:8px;margin-bottom:14px;';
          sheet.appendChild(preview);

          const sheetTitle = document.createElement('div');
          sheetTitle.style = 'font-size:1rem;font-weight:800;color:#1e293b;margin-bottom:4px;';
          sheetTitle.textContent = '📸 Assign spare photo';
          sheet.appendChild(sheetTitle);

          const sheetSub = document.createElement('div');
          sheetSub.style = 'font-size:12px;color:#64748b;margin-bottom:14px;';
          sheetSub.textContent = 'Pick a section now or skip — you can assign it later in Review.';
          sheet.appendChild(sheetSub);

          const selEl = document.createElement('select');
          selEl.style = 'width:100%;padding:12px;font-size:15px;font-family:inherit;border:2px solid #f59e0b;border-radius:8px;background:#fff;color:#1e293b;-webkit-appearance:none;appearance:none;margin-bottom:14px;box-sizing:border-box;';
          const blankOpt2 = document.createElement('option');
          blankOpt2.value = ''; blankOpt2.textContent = '— Skip for now —';
          selEl.appendChild(blankOpt2);
          SPARE_SLOTS_CAPTURE.forEach(slot => {
            const opt = document.createElement('option');
            opt.value = slot.value; opt.textContent = slot.label;
            selEl.appendChild(opt);
          });
          sheet.appendChild(selEl);

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
            if (selEl.value) sp.assignedSlot = selEl.value;
            if (capInput.value.trim()) sp.caption = capInput.value.trim();
            saveNow();
            document.body.removeChild(overlay);
            ui().showToast(selEl.value ? '📸 Spare photo saved + assigned' : '📸 Spare photo saved — assign in Review');
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
  if (fieldGen) {
    const fields = fieldGen();
    const card = ui().el('div', { className: 'card' });
    const onFieldChange = () => {
      data._updatedAt = new Date().toISOString();
      scheduleSave();
      ui().updateShowIf(card, data);
      // Change 3: Detect allSectionsComplete on post-assessment step
      if (step.type === 'post-assessment' && data.finalCheck && data.finalCheck.allSectionsComplete === true) {
        if (ctx._finalSyncTriggeredId !== (ctx.inspection && ctx.inspection.inspectionId)) {
          ctx._finalSyncTriggeredId = ctx.inspection.inspectionId;
          ctx.triggerFinalSync();
        }
      }
    };
    // DEBUG: render first 6 fields only
    fields.slice(0, 6).forEach(f => {
      const rendered = ui().renderField(f, data, onFieldChange, ctx.inspection, () => { scheduleSave(); });
      if (rendered) card.appendChild(rendered);
    });
    ui().updateShowIf(card, data);
    c.appendChild(card);
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

  const navButtons = [
    ctx.currentStepIdx > 0
      ? ui().el('button', { className: 'btn btn-outline btn-nav', onClick: () => { ctx.currentStepIdx--; ctx.render(); window.scrollTo(0, 0); } }, '\u2190 Back')
      : ui().el('div'),
    ui().el('button', {
      type: 'button',
      className: 'btn btn-outline btn-home',
      onClick: () => {
        if (confirm('Return to home? Your progress is saved.')) {
          setScreen('home');
          ctx.render();
        }
      }
    }, '\uD83C\uDFE0'),
    ui().el('button', { className: 'btn btn-primary btn-nav', onClick: () => {
      try {
        console.log('[next] before validate');
        const missing = validateStep(step);
        console.log('[next] before warn');
        const warnings = warnStep(step);
        if (missing.length) { ui().showToast(missing.length + ' item' + (missing.length > 1 ? 's' : '') + ' still required'); ui().flashUncheckedItems(c); return; }
        if (warnings.length) { ui().showToast('\u26a0\ufe0f ' + warnings.join(', '), 3500); }
        data._completedAt = new Date().toISOString();
        console.log('[next] before increment, idx:', ctx.currentStepIdx);
        ctx.currentStepIdx++;
        console.log('[next] before render, new idx:', ctx.currentStepIdx);
        ctx.render(); window.scrollTo(0, 0);
        console.log('[next] after render');
        saveNow();
        checkpointToCloud(ctx.stepList);
      } catch (e) {
        console.error('Next button error:', e);
        ui().showToast('Error: ' + (e && e.message ? e.message : String(e)));
      }
    }}, ctx.currentStepIdx < ctx.stepList.length - 2 ? 'Next \u2192' : 'Review \u2192')
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
}

// ── REVIEW SCREEN ──────────────────────────────────────────
export function renderReview() {
  const c = ui().el('div', { className: 'screen review-screen' });
  c.appendChild(buildAppHeader('Final Review'));
  c.appendChild(ui().renderStatusBar(getLastSaveText()));

  // Status legend bar
  const legendBar = ui().el('div', { style: 'background:#f0f7ee;border-radius:8px;padding:10px 14px;margin:0 0 8px;font-size:0.8rem;color:#4a5568;line-height:1.6;' });
  legendBar.innerHTML = '<strong style="color:#2C3F16">Status guide:</strong>' +
    ' <span style="background:#e8f5e9;padding:2px 6px;border-radius:4px;">Visited</span> = section opened during inspection.' +
    ' <span style="background:#fef3c7;padding:2px 6px;border-radius:4px;">Not visited</span> = section was skipped.' +
    ' Photos showing <strong>\u2601\ufe0f Uploaded to Drive</strong> have been synced to Google Drive - their local copy has been cleared to save storage.' +
    ' A photo marked <strong>?</strong> or <em>Unreviewed</em> in a report means no caption was added - tap the photo here to add one.';
  c.appendChild(legendBar);

  // ── 6a: Departure Checklist ──
  if (!ctx.inspection._departureChecklist) ctx.inspection._departureChecklist = {};
  const depData = ctx.inspection._departureChecklist;
  const depItems = [
    { key: 'downloadQtrak', label: 'Download Q-Trak data to computer' },
    { key: 'shipSamples', label: 'Ship all lab samples' }
  ];
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

  ctx.stepList.forEach((step, idx) => {
    if (step.type === 'review') return;
    const data = (ctx.inspection.stepData && ctx.inspection.stepData[step.id]) || {};
    const visited = !!data._visited;
    const sCard = ui().el('div', { className: 'card' + (!visited ? ' card-incomplete' : '') });
    sCard.appendChild(ui().el('div', { className: 'review-step-header' }, [
      ui().el('h3', { className: 'section-heading' }, [
        document.createTextNode(step.name + ' '),
        ui().el('span', { className: 'badge ' + (visited ? 'completed' : 'in-progress') }, visited ? 'Visited' : 'Not visited')
      ]),
      ui().el('button', { className: 'btn btn-small btn-outline', onClick: () => { ctx.currentStepIdx = idx; setScreen('step'); ctx.render(); } }, 'Edit')
    ]));

    const summary = ui().el('div', { className: 'review-summary' });
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
            ui().el('img', { src: p.dataUrl, className: 'review-photo-img' }),
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
      const unvisited = ctx.stepList.filter(s => s.type !== 'review' && !(ctx.inspection.stepData && ctx.inspection.stepData[s.id] && ctx.inspection.stepData[s.id]._visited));
      const atpData = (ctx.inspection.stepData && ctx.inspection.stepData['atp-kitchen']) || {};
      const atpIssues = [];
      if (!(atpData._atpBeforePhotos && atpData._atpBeforePhotos.length)) atpIssues.push('ATP Before photo missing');
      if (!(atpData._atpAfterPhotos && atpData._atpAfterPhotos.length)) atpIssues.push('ATP After photo missing');
      const allIssues = [
        ...unvisited.map(s => 'Section not visited: ' + s.name),
        ...atpIssues
      ];
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
      saveNow().then(() => {
        submitInspection(completeData).then(ok => {
          if (!ok) { submitBtn.disabled = false; submitBtn.textContent = '\u2713 Submit Inspection'; }
        });
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
        // Send main data first (no photos)
        const mainPayload = stripPhotosFromExport(reuploadData);
        await scriptFetch(mainPayload);
        // Send photos one at a time to avoid payload size limits
        const allPhotos = extractAllPhotosFromExport(reuploadData);
        for (let i = 0; i < allPhotos.length; i++) {
          reuploadBtn.textContent = 'Uploading photo ' + (i + 1) + ' of ' + allPhotos.length + '\u2026';
          await uploadPhotoImmediate(
            { photoId: allPhotos[i].photoId, roomName: allPhotos[i].roomName, stepName: allPhotos[i].stepName, dataUrl: allPhotos[i].imageData, caption: allPhotos[i].caption || '' },
            reuploadData.inspectionId,
            reuploadData.clientName || '',
            reuploadData.propertyAddress || ''
          );
        }
        reuploadBtn.textContent = '\u2713 Upload Complete (' + allPhotos.length + ' photos)';
      } catch(e) {
        reuploadBtn.disabled = false;
        reuploadBtn.textContent = '\u21ba Re-upload to Drive';
        alert('Upload failed: ' + e.message);
      }
    }}, '\u21ba Re-upload to Drive');
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
    const SPARE_SLOTS = [
      ...Array.from({length:6}, (_,i) => ({ value: 'obs_' + (i+1),        label: 'Observation ' + (i+1) })),
      ...Array.from({length:6}, (_,i) => ({ value: 'actionTaken_' + (i+1), label: 'Action Taken ' + (i+1) })),
      ...Array.from({length:5}, (_,i) => ({ value: 'followUp_' + (i+1),   label: 'Follow-up ' + (i+1) }))
    ];

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
      spImg.src = sp.dataUrl || '';
      spImg.className = 'photo-img';
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

      // Section assignment dropdown
      const assignWrap = document.createElement('div');
      assignWrap.style = 'padding:8px 10px;border-top:1px solid #e5e7eb;background:#f8fafc;';

      const assignLabel = document.createElement('div');
      assignLabel.style = 'font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;';
      assignLabel.textContent = 'Assign to section';
      assignWrap.appendChild(assignLabel);

      const sel = document.createElement('select');
      sel.style = 'width:100%;padding:10px 12px;font-size:14px;font-family:inherit;border:2px solid ' + (sp.assignedSlot ? '#22c55e' : '#f59e0b') + ';border-radius:6px;background:#fff;color:#1e293b;-webkit-appearance:none;appearance:none;cursor:pointer;';

      const blankOpt = document.createElement('option');
      blankOpt.value = '';
      blankOpt.textContent = '— Select section —';
      sel.appendChild(blankOpt);

      SPARE_SLOTS.forEach(slot => {
        const opt = document.createElement('option');
        opt.value = slot.value;
        opt.textContent = slot.label;
        if (sp.assignedSlot === slot.value) opt.selected = true;
        sel.appendChild(opt);
      });

      sel.onchange = () => {
        sp.assignedSlot = sel.value || null;
        scheduleSave();
        // Refresh the whole spare photos section so bucket counts update
        const container = document.getElementById('spare-photos-container');
        if (container) {
          container.parentNode.removeChild(container);
        }
        renderSpareSection();
      };

      assignWrap.appendChild(sel);
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
