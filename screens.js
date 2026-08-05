// InHaus Inspector - Screen Rendering
import { setInspection, getScreen, setScreen, getLastSaveText, getBestCloudSyncAt, getSyncStatus, clearActivePosition } from './state.js?v=239';
import { saveNow, scheduleSave, createRestorePoint } from './storage.js?v=239';
import { buildExportJSON, extractAllPhotosFromExport } from './inspection.js?v=239';
import { checkpointToCloud, submitInspection, listCloudInspections, loadCloudInspection, ensureStartInspectionShell } from './sync.js?v=239';
import { STEP_FIELDS, PHASES, REQUIRED_TEST_OPTIONS, buildStepList, getStepData, getStepFields, validateStep, warnStep, ensureRoomRelationships } from './steps.js?v=239';
import { text, textarea, date, sel, chips, photo, heading, divider, showIf } from './fields.js?v=239';
import {
  ensureInspectionWorkspace, syncPhotoCommentsToFindings, createFinding, updateFinding,
  approveFinding, excludeFinding, saveFindingToLibrary, useLibraryComment,
  getInspectorIdentity, setInspectorIdentity,
  hasConfirmedInspectorIdentity, flattenInspectionCheckpoints,
  addTeamMember, removeTeamMember, setStepAssignment, getStepAssignment,
  markStepUpdated, recordTeamActivity, recordAuditEvent,
  setActiveStepPresence, getActivePresence
} from './findings.js?v=239';
import { buildPhotoRoutingSuggestions } from './photo-routing.js?v=239';
import { updatePhotoMetadata } from './supabase-photos.js?v=239';
import { FIELD_RESUME_TOKEN } from './config.js?v=239';
import {
  refreshCompanyComments, submitCompanyCommentCandidate,
  flushPendingCompanyCommentCandidates
} from './comment-library.js?v=239';

// UI globals — accessed lazily via ui() to guarantee window.UI is ready
function ui() { return window.UI; }

// ── Context (set via initScreens) ───────────────────────────
let ctx = null;
let _stepRenderJob = 0;
let _intakeMode = 'field';
let _workspaceReturnScreen = 'step';
let _rapidReturnScreen = 'step';
let _photosReturnScreen = 'review';
let _rapidCaptureContext = null;
let _globalWorkspaceListenersReady = false;
const _companyLibraryRequested = new Set();

export function initScreens(context) {
  ctx = context;
  if (!_globalWorkspaceListenersReady) {
    _globalWorkspaceListenersReady = true;
    window.addEventListener('inhaus-photo-deleted', event => {
      if (!ctx?.inspection) return;
      const detail = event.detail || {};
      if (!ctx.inspection.photoTombstones) ctx.inspection.photoTombstones = {};
      ctx.inspection.photoTombstones[detail.photoId] = { status: 'deleted', updatedAt: new Date().toISOString() };
      recordAuditEvent(ctx.inspection, 'photo_deleted', 'Photo moved to Recently Deleted', detail);
      scheduleSave();
    });
  }
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

function openInspectionWorkspace(screen, returnScreen, rapidContext) {
  if (screen === 'rapid-capture') _rapidReturnScreen = returnScreen || getScreen() || 'step';
  else _workspaceReturnScreen = returnScreen || getScreen() || 'step';
  if (rapidContext) _rapidCaptureContext = rapidContext;
  setScreen(screen);
  ctx.render();
  window.scrollTo(0, 0);
}

function returnFromInspectionWorkspace() {
  const currentScreen = getScreen();
  let returnScreen = currentScreen === 'rapid-capture' ? (_rapidReturnScreen || 'step') : (_workspaceReturnScreen || 'step');
  // A nested workspace (for example My Work -> Recovery) temporarily sets the
  // return target to My Work. Once back there, Back must return to the active
  // inspection instead of reopening My Work forever.
  if (currentScreen === 'my-work' && returnScreen === 'my-work') returnScreen = 'step';
  setScreen(returnScreen);
  ctx.render();
  window.scrollTo(0, 0);
}

function requestCompanyLibraryRefresh() {
  const inspection = ctx?.inspection;
  if (!inspection?.inspectionId || _companyLibraryRequested.has(inspection.inspectionId)) return;
  _companyLibraryRequested.add(inspection.inspectionId);
  Promise.all([
    refreshCompanyComments(inspection, false),
    flushPendingCompanyCommentCandidates(inspection)
  ]).then(([added, submitted]) => {
    if (added || submitted) {
      scheduleSave();
      if (getScreen() === 'rapid-capture' || getScreen() === 'findings') ctx.render();
    }
  }).catch(err => console.warn('Company comment refresh skipped:', err));
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
  const isDevTraining = isDevMode() && /test|training/i.test(String(ctx.inspection?.assessmentType || ''));
  if (isDevTraining) return issues;

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

function getPhotoContextFromPath(path) {
  const match = String(path || '').match(/stepData\.([^.[\]]+)/);
  if (!match || !ctx?.inspection?.stepData) return { roomName: '', stepName: '' };
  const stepId = match[1];
  const step = (ctx.stepList || []).find(item => item.id === stepId);
  const data = ctx.inspection.stepData[stepId] || {};
  return {
    roomName: String(data.roomName || data._roomName || step?.name || '').trim(),
    stepName: String(step?.name || data.stepName || '').trim()
  };
}

function formatPhotoDestination(roomName, stepName) {
  const room = String(roomName || '').trim();
  const step = String(stepName || '').trim();
  if (room && step && room.toLowerCase() !== step.toLowerCase()) return room + ' → ' + step;
  return room || step || 'Needs placement';
}

function photoRefNeedsPlacement(ref) {
  return !String(ref?.roomName || '').trim() && !String(ref?.stepName || '').trim();
}

function collectInspectionPhotoRefs() {
  const refs = [];
  if (!ctx || !ctx.inspection) return refs;
  visitScreenPhotos(ctx.inspection, (photo, path) => {
    if (!photo || !photo.photoId) return;
    const pathContext = getPhotoContextFromPath(path);
    const stepName = String(photo.stepName || pathContext.stepName || getStepNameFromPhotoPath(path) || '').trim();
    const roomName = String(photo.roomName || pathContext.roomName || '').trim();
    refs.push({
      photo,
      path,
      roomName,
      stepName,
      needsPlacement: !roomName && !stepName,
      destination: formatPhotoDestination(roomName, stepName),
      title: roomName || stepName || 'Inspection photo'
    });
  });
  return refs;
}

function collectPhotoDestinations() {
  const destinations = [];
  const seen = new Set();
  function add(roomName, stepName) {
    const room = String(roomName || '').trim();
    const step = String(stepName || '').trim();
    if (!room && !step) return;
    const key = room.toLowerCase() + '|' + step.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    destinations.push({ roomName: room, stepName: step, label: formatPhotoDestination(room, step) });
  }

  (ctx?.stepList || []).forEach(step => {
    const data = ctx?.inspection?.stepData?.[step.id] || {};
    add(data.roomName || data._roomName || step.name, step.name);
  });
  collectInspectionPhotoRefs().forEach(ref => add(ref.roomName, ref.stepName));
  return destinations.sort((a, b) => a.label.localeCompare(b.label));
}

function getPhotoPreviewSrc(photo) {
  if (!photo) return '';
  if (photo.thumbnailDataUrl) return photo.thumbnailDataUrl;
  if (photo.dataUrl && photo.dataUrl !== '__uploaded__') return photo.dataUrl;
  return '';
}

function getPhotoStatus(photo) {
  const hasLocal = !!(photo && photo.dataUrl && photo.dataUrl !== '__uploaded__');
  const hasCloud = !!(photo && (photo._driveConfirmed === true || photo._uploaded === true || photo.driveUrl || photo.driveId || photo.storagePath));
  const hasVault = !!(photo && photo._vaultSaved);
  if (hasCloud && hasLocal) return { label: 'Cloud + phone', tone: 'good' };
  if (hasCloud) return { label: 'Cloud', tone: 'good' };
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
    { label: 'Radon Setup', phases: ['lowest'] },
    { label: 'Bedrooms', phases: ['upper'], addRooms: [
      { label: '+ Add Bedroom', section: 'bedrooms', prefix: null }
    ]},
    { label: 'Bathrooms', phases: ['rooms'], addRooms: [
      { label: '+ Add Bathroom', section: 'bathrooms', prefix: null }
    ]},
    { label: 'Main Level', phases: ['main'] },
    { label: 'Additional Rooms', phases: ['supplementary'], addRooms: [
      { label: '+ Add Room', section: 'additional', prefix: null }
    ]},
    { label: 'Utility Room', phases: ['utility'] },
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
    if (!groupSteps.length && !(group.addRooms && group.addRooms.length)) return;

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

    // Per-section add-room buttons (Radon, Upper Level, Additional Rooms)
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
    getStepFields(s).forEach(f => {
      if (!f.label || !f.key) return;
      if (['heading', 'info', 'divider', 'photo', 'timer', 'link'].includes(f.type)) return;
      searchIndex.push({ label: f.label, stepIdx: sIdx, context: s.name, key: f.key });
    });
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
  if (ctx && typeof ctx.persistActivePosition === 'function') ctx.persistActivePosition();
  // Kill any body-level overlays that may have leaked across renders
  ['room-drawer-overlay', 'search-overlay', 'fixed-bottom-nav'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
  window.inspection = ctx.inspection;
  if (ctx.inspection) ui().startTimerAlarmManager(ctx.inspection, () => scheduleSave());
  else ui().stopTimerAlarmManager();
  ctx.root.innerHTML = '';
  window.scrollTo(0, 0);
  switch (getScreen()) {
    case 'home': renderHome(); break;
    case 'truck-check': renderTruckCheck(); break;
    case 'intake': renderIntake(); break;
    case 'cloud-resume': renderCloudResume(); break;
    case 'precheck': renderPrecheck(); break;
    case 'step': renderStep(); break;
    case 'review': renderReview(); break;
    case 'photos': renderPhotos(); break;
    case 'rapid-capture': renderRapidCapture(); break;
    case 'findings': renderFindingsInbox(); break;
    case 'team': renderTeamWorkspace(); break;
    case 'my-work': renderMyWork(); break;
    case 'recovery': renderRecoveryCenter(); break;
  }

  // A fixed element nested inside the long inspection screen can still scroll
  // or jump in iPhone Safari. Portal the nav to <body> so Back/Home/Next always
  // belong to the visual viewport, never to the checklist's document flow.
  const bottomNav = ctx.root.querySelector('.bottom-nav');
  if (bottomNav) {
    bottomNav.id = 'fixed-bottom-nav';
    bottomNav.setAttribute('data-fixed-footer', 'true');
    document.body.appendChild(bottomNav);
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

function quickTestPickupData() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  return {
    inspectionId: ctx.genId(),
    inspectorName: 'Codex QA',
    inspectorEmail: '',
    inspectionDate: now.toISOString().slice(0, 10),
    clientName: 'TEST Pickup ' + stamp.slice(4),
    propertyAddress: '123 Test Pickup Rd, Basalt CO',
    numberOfLevels: '2',
    numberOfBedrooms: '3',
    numberOfBathrooms: '2',
    waterSource: ['Municipal'],
    waterSourceDescription: '',
    wifiNetwork: '',
    wifiPassword: '',
    clientConcerns: 'Pipeline smoke test only. Do not report.',
    blueprintNotes: '',
    assessmentType: 'Test / Training',
    pfasSetup: 'No',
    pfasKitNum: '',
    waterPanelPlanned: 'Not requested',
    waterSampleId: '',
    waterSampleType: 'Not determined',
    requiredTests: [],
    microplasticsStatus: 'Not requested',
    microplasticsSampleId: '',
    pfasStatus: 'Not requested',
    pfasSampleId: '',
    officePrepNotes: 'Automated test pickup created from Advanced.',
    teamInspectorNames: ''
  };
}

async function createQuickTestPickup(button) {
  if (!confirm('Create a TEST / TRAINING pickup inspection now?\n\nThis creates a cloud pickup record and _Test Assessments folder, but no real tracker row.')) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Creating test pickup...';
  try {
    const now = new Date().toISOString();
    const data = quickTestPickupData();
    ctx.inspection = {
      ...intakeValuesOnly(data),
      inspectionId: data.inspectionId,
      startedAt: now,
      preparedAt: now,
      updatedAt: now,
      endedAt: null,
      status: 'prepared',
      reviewStatus: 'Prepared',
      stepData: {},
      timers: {},
      dynamicRooms: { lowest: [], additional: [{ name: 'Living Room' }, { name: 'Laundry Room' }] },
      _lastStepIdx: 0,
      truckCheck: {}
    };
    ensureInspectionWorkspace(ctx.inspection);
    setInspection(ctx.inspection);
    applyOfficePreparation(ctx.inspection, data);
    setInspection(ctx.inspection);
    ctx.stepList = buildStepList(ctx.inspection);
    const localSaved = await saveNow();
    if (!localSaved) throw new Error('Local save failed');
    const shellReady = await ensureStartInspectionShell(ctx.stepList, { force: true });
    if (!shellReady || shellReady.ok !== true) {
      throw new Error(shellReady?.message || 'folder/tracker receipt missing');
    }
    const cloudSaved = await checkpointToCloud(ctx.stepList);
    if (!cloudSaved) throw new Error('Cloud pickup save failed');
    await saveNow();
    const id = ctx.inspection.inspectionId;
    ui().showToast('Test pickup ready: ' + id);
    alert('Test pickup created.\n\nInspection ID:\n' + id + '\n\nNow open Continue Active Inspection on the phone.');
    ctx.inspection = null;
    setInspection(null);
    setScreen('home');
    ctx.render();
  } catch (err) {
    button.disabled = false;
    button.textContent = originalText;
    alert('Could not create test pickup: ' + (err?.message || String(err)));
  }
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

  // ── Hard-refresh reminder (once per session) ─────────────
  if (!sessionStorage.getItem('inhaus_refresh_dismissed')) {
    const refreshBanner = ui().el('div', {
      className: 'reminder-banner',
      style: 'cursor:pointer;position:relative;padding-right:36px;',
      onClick: () => {
        sessionStorage.setItem('inhaus_refresh_dismissed', '1');
        refreshBanner.remove();
      }
    });
    refreshBanner.innerHTML = '<strong>Before starting:</strong> pull down to refresh this page in Safari to make sure you have the latest version. <span style="position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:1.1rem;opacity:0.6;">✕</span>';
    c.appendChild(refreshBanner);
  }

  c.appendChild(ui().el('button', {
    className: 'btn btn-primary btn-full',
    onClick: () => { _intakeMode = 'field'; setScreen('truck-check'); ctx.render(); }
  }, 'Start New Inspection'));

  const handoffActions = ui().el('div', { className: 'home-handoff-actions' });
  handoffActions.appendChild(ui().el('button', {
    className: 'btn btn-secondary btn-full',
    onClick: () => {
      _intakeMode = 'prepare';
      ctx.inspection = null;
      setInspection(null);
      setScreen('intake');
      ctx.render();
    }
  }, 'Prepare Inspection in Office'));
  handoffActions.appendChild(ui().el('button', {
    className: 'btn btn-outline btn-full',
    onClick: () => { setScreen('cloud-resume'); ctx.render(); }
  }, 'Continue Active Cloud Inspection'));
  c.appendChild(handoffActions);

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
  const quickPickupBtn = ui().el('button', {
    className: 'btn btn-outline btn-full',
    style: 'margin-top:8px;font-size:0.8rem;color:#2563eb;border-color:#93c5fd;',
    onClick: () => createQuickTestPickup(quickPickupBtn)
  }, 'Create Test Pickup Inspection');
  advancedSection.appendChild(quickPickupBtn);
  c.appendChild(advancedSection);

  // ── Jump to Step (dev only) ─────────────────────────────
  if (isDevMode()) {
    const jumpBtn = ui().el('button', {
      className: 'btn btn-outline btn-full',
      style: 'margin-top:8px;font-size:0.8rem;color:#ff9900;border-color:#ff9900;',
      onClick: () => {
        window.DB.getAll().then(all => {
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

  window.DB.getAll().then(all => {
    all.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    const prepared = all.filter(x => x.status === 'prepared');
    const inProg = all.filter(x => x.status === 'in-progress');
    const done = all.filter(x => x.status === 'completed');

    if (prepared.length) {
      list.appendChild(ui().el('h2', { className: 'list-heading' }, 'Prepared in Office'));
      prepared.forEach(x => list.appendChild(renderInspCard(x, false)));
    }
    if (inProg.length) {
      list.appendChild(ui().el('h2', { className: 'list-heading' }, 'In Progress'));
      inProg.forEach(x => list.appendChild(renderInspCard(x, true)));
    }
    if (done.length) {
      list.appendChild(ui().el('h2', { className: 'list-heading' }, 'Completed'));
      done.forEach(x => list.appendChild(renderInspCard(x, false)));
    }
    if (!all.length) {
      list.appendChild(ui().el('p', { className: 'empty-msg' }, 'No inspections yet. Tap "Start New Inspection" to begin.'));
    }
  });

  ctx.root.appendChild(c);
}

export function renderInspCard(insp, canResume) {
  const isPrepared = insp.status === 'prepared';
  const badgeLabel = insp.status === 'completed' ? 'Complete' : (isPrepared ? 'Prepared' : 'In Progress');
  return ui().el('div', { className: 'card insp-card' }, [
    ui().el('div', { className: 'card-top' }, [
      ui().el('strong', null, insp.inspectionId),
      ui().el('span', { className: 'badge ' + insp.status }, badgeLabel)
    ]),
    ui().el('p', null, insp.propertyAddress || 'No address'),
    ui().el('p', { className: 'text-sm' }, (insp.inspectorName || '') + ' \u2022 ' + ui().fmtDate(insp.startedAt)),
    ui().el('div', { className: 'card-actions' }, [
      isPrepared ? ui().el('button', { className: 'btn btn-primary', onClick: () => editPreparedInspection(insp.inspectionId) }, 'Edit Preparation') : null,
      canResume ? ui().el('button', { className: 'btn btn-primary', onClick: () => resumeInsp(insp.inspectionId) }, 'Resume') : null,
      ui().el('button', { className: 'btn btn-outline', onClick: () => viewInsp(insp.inspectionId) }, 'View'),
      ui().el('button', { className: 'btn btn-danger-outline btn-small', onClick: () => {
        if (confirm('⚠️ Delete this inspection permanently?\n\nAll photos and data will be removed from this device.\n\nOnly delete after confirming the cloud backup is complete.\n\nThis cannot be undone.')) {
          clearActivePosition(insp.inspectionId);
          window.DB.remove(insp.inspectionId).then(() => ctx.render());
        }
      }}, 'Delete')
    ])
  ]);
}

export async function editPreparedInspection(id) {
  ctx.inspection = await window.DB.get(id);
  ensureInspectionWorkspace(ctx.inspection);
  setInspection(ctx.inspection);
  if (!ctx.inspection) return;
  _intakeMode = 'prepare';
  setScreen('intake');
  ctx.render();
}

export async function resumeInsp(id) {
  if (ctx.restoreActivePosition && await ctx.restoreActivePosition(id)) {
    const restored = ctx.inspection;
    const needsTeamIdentity = restored?.collaboration?.enabled &&
      restored.collaboration.members?.length > 1 &&
      !hasConfirmedInspectorIdentity(restored);
    if (needsTeamIdentity) {
      _workspaceReturnScreen = 'step';
      setScreen('team');
    }
    ctx.render();
    return;
  }
  ctx.inspection = await window.DB.get(id); setInspection(ctx.inspection);
  if (!ctx.inspection) return;
  ensureInspectionWorkspace(ctx.inspection);
  ctx.stepList = buildStepList(ctx.inspection);
  const lastVisited = ctx.inspection._lastStepIdx || 0;
  ctx.currentStepIdx = Math.min(lastVisited, ctx.stepList.length - 1);
  const needsTeamIdentity = ctx.inspection.collaboration?.enabled &&
    ctx.inspection.collaboration.members.length > 1 &&
    !hasConfirmedInspectorIdentity(ctx.inspection);
  _workspaceReturnScreen = 'step';
  setScreen(needsTeamIdentity ? 'team' : 'step');
  ctx.startAutoSave();
  ctx.render();
}

export async function viewInsp(id) {
  ctx.inspection = await window.DB.get(id); setInspection(ctx.inspection);
  if (!ctx.inspection) return;
  ensureInspectionWorkspace(ctx.inspection);
  ctx.stepList = buildStepList(ctx.inspection);
  setScreen('review');
  ctx.startAutoSave();
  ctx.render();
}

export function isContinuableCloudInspection(item) {
  const status = String(item?.status || '').trim().toLowerCase();
  return status === 'prepared' || status === 'field active';
}

export function isReviewableCloudInspection(item) {
  const status = String(item?.status || '').trim().toLowerCase();
  return status === 'needs review' || status === 'completed' ||
    status === 'submitted to tanner' || status === 'report complete' ||
    status === 'synced';
}

const HIDDEN_CLOUD_INSPECTIONS_KEY = 'inhausHiddenCloudInspectionIds';

function cloudInspectionKey(item) {
  return String(item?.inspectionId || item?.id || '').trim().toUpperCase();
}

export function getHiddenCloudInspectionIdsForPhone() {
  try {
    const raw = localStorage.getItem(HIDDEN_CLOUD_INSPECTIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (err) {
    return [];
  }
}

function setHiddenCloudInspectionIdsForPhone(ids) {
  try {
    const unique = Array.from(new Set((ids || []).map(id => String(id || '').trim().toUpperCase()).filter(Boolean)));
    localStorage.setItem(HIDDEN_CLOUD_INSPECTIONS_KEY, JSON.stringify(unique));
    return unique;
  } catch (err) {
    return [];
  }
}

export function isCloudInspectionHiddenForPhone(item) {
  const key = cloudInspectionKey(item);
  return !!key && getHiddenCloudInspectionIdsForPhone().includes(key);
}

export function hideCloudInspectionForPhone(item) {
  const key = cloudInspectionKey(item);
  if (!key) return getHiddenCloudInspectionIdsForPhone();
  return setHiddenCloudInspectionIdsForPhone(getHiddenCloudInspectionIdsForPhone().concat(key));
}

export function restoreCloudInspectionForPhone(item) {
  const key = cloudInspectionKey(item);
  if (!key) return getHiddenCloudInspectionIdsForPhone();
  return setHiddenCloudInspectionIdsForPhone(getHiddenCloudInspectionIdsForPhone().filter(id => id !== key));
}

function cloudRecordStatus(cloudRecord) {
  return String(
    cloudRecord?.status ||
    cloudRecord?.resumeData?.reviewStatus ||
    cloudRecord?.resumeData?.status ||
    ''
  ).trim();
}

function cloudItemFromRecord(cloudRecord, fallbackId) {
  const resume = cloudRecord?.resumeData || {};
  return {
    inspectionId: cloudRecord?.inspectionId || cloudRecord?.id || resume.inspectionId || fallbackId,
    id: cloudRecord?.id || cloudRecord?.inspectionId || resume.inspectionId || fallbackId,
    clientName: cloudRecord?.clientName || resume.clientName || '',
    propertyAddress: cloudRecord?.propertyAddress || resume.propertyAddress || '',
    inspectionDate: cloudRecord?.inspectionDate || resume.inspectionDate || '',
    inspectorName: cloudRecord?.inspectorName || resume.inspectorName || '',
    status: cloudRecordStatus(cloudRecord)
  };
}

export function cloudReviewUrl(item) {
  const id = item?.inspectionId || item?.id;
  if (!id) return '';
  const url = new URL('https://inhauslab.github.io/inhaus-review/review.html');
  url.searchParams.set('id', id);
  url.searchParams.set('token', FIELD_RESUME_TOKEN);
  return url.toString();
}

function openCloudReview(item) {
  const url = cloudReviewUrl(item);
  if (!url) {
    alert('This cloud inspection has no inspection ID.');
    return;
  }
  window.location.assign(url);
}

function cloudSearchText(item) {
  return [
    item?.propertyAddress,
    item?.clientName,
    item?.inspectorName,
    item?.inspectionDate,
    item?.inspectionId || item?.id
  ].filter(Boolean).join(' ').toLowerCase();
}

function cloudInspectionSortTime(item) {
  const candidates = [
    item?.preparedAt,
    item?.lastUpdated,
    item?.updatedAt,
    item?.inspectionDate,
    item?.startedAt
  ];
  for (const value of candidates) {
    const timestamp = Date.parse(value || '');
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

export function inspectionFromCloudRecord(cloudRecord) {
  const source = cloudRecord?.resumeData;
  if (!source || !source.inspectionId) {
    throw new Error('This inspection could not be loaded. No inspection data found.');
  }
  const inspection = flattenInspectionCheckpoints(JSON.parse(JSON.stringify(source)));
  inspection.inspectionId = inspection.inspectionId || cloudRecord.inspectionId || cloudRecord.id;
  inspection.stepData = inspection.stepData || {};
  inspection.timers = inspection.timers || {};
  inspection.dynamicRooms = inspection.dynamicRooms || { lowest: [], additional: [{ name: 'Living Room' }, { name: 'Laundry Room' }] };
  inspection.truckCheck = inspection.truckCheck || {};
  inspection.status = 'in-progress';
  inspection.reviewStatus = 'Field Active';
  inspection.fieldStartedAt = inspection.fieldStartedAt || new Date().toISOString();
  inspection._claimedFromCloudAt = new Date().toISOString();
  ensureInspectionWorkspace(inspection);
  return inspection;
}

async function continueCloudInspection(item, button, preloadedRecord) {
  const id = item.inspectionId || item.id;
  const local = await window.DB.get(id);
  if (local && local.status === 'in-progress') {
    await resumeInsp(id);
    return;
  }

  button.disabled = true;
  button.textContent = 'Downloading…';
  try {
    const cloudRecord = preloadedRecord || await loadCloudInspection(id);
    const inspection = inspectionFromCloudRecord(cloudRecord);
    ctx.inspection = inspection;
    setInspection(inspection);
    ctx.stepList = buildStepList(inspection);
    ctx.currentStepIdx = Math.min(Number(inspection._lastStepIdx || 0), Math.max(ctx.stepList.length - 1, 0));
    await saveNow();
    _intakeMode = 'field';
    const wasPrepared = String(cloudRecord?.resumeData?.status || '').toLowerCase() === 'prepared';
    const needsTeamIdentity = inspection.collaboration.enabled &&
      inspection.collaboration.members.length > 1 && !hasConfirmedInspectorIdentity(inspection);
    _workspaceReturnScreen = wasPrepared ? 'precheck' : 'step';
    setScreen(needsTeamIdentity ? 'team' : _workspaceReturnScreen);
    ctx.startAutoSave();
    if (ctx.persistActivePosition) ctx.persistActivePosition();
    ctx.render();
    if (needsTeamIdentity) {
      ui().showToast('Select your name before starting team work');
      return;
    }
    const cloudClaimed = await checkpointToCloud(ctx.stepList);
    if (!cloudClaimed) {
      ui().showToast('Inspection downloaded. Cloud claim will retry automatically.');
    }
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Continue on This Device';
    alert('Could not continue this inspection: ' + (err?.message || String(err)));
  }
}

async function openCloudInspectionById(rawId, button) {
  const id = String(rawId || '').trim();
  if (!id) {
    alert('Enter the inspection ID from the office preparation screen.');
    return;
  }

  button.disabled = true;
  button.textContent = 'Opening…';
  try {
    const cloudRecord = await loadCloudInspection(id);
    const item = cloudItemFromRecord(cloudRecord, id);
    if (isContinuableCloudInspection(item)) {
      await continueCloudInspection(item, button, cloudRecord);
      return;
    }
    if (isReviewableCloudInspection(item)) {
      openCloudReview(item);
      return;
    }
    throw new Error('This inspection is not marked prepared or active. Current status: ' + (item.status || 'unknown'));
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Open Inspection';
    alert('Could not open this inspection: ' + (err?.message || String(err)));
  }
}

export function renderCloudResume() {
  const c = ui().el('div', { className: 'screen cloud-resume-screen' });
  c.appendChild(buildAppHeader('Cloud Inspections'));
  c.appendChild(ui().el('button', {
    className: 'btn btn-outline',
    onClick: () => { setScreen('home'); ctx.render(); }
  }, '← Home'));
  c.appendChild(ui().el('div', { className: 'cloud-resume-intro' }, [
    ui().el('h1', { className: 'screen-title' }, 'Continue Active Inspection'),
    ui().el('p', null, 'Only prepared and active field inspections show here. Completed reports stay in the review portal.')
  ]));

  const directCard = ui().el('div', { className: 'card cloud-direct-card' });
  directCard.appendChild(ui().el('strong', null, 'Open prepared inspection'));
  directCard.appendChild(ui().el('p', { className: 'text-sm' }, 'Use the inspection ID shown on the laptop if the active list is unavailable.'));
  const directInput = ui().el('input', {
    className: 'field-input',
    type: 'text',
    placeholder: 'INH-YYYYMMDD-XXXXXX',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false'
  });
  const directBtn = ui().el('button', {
    className: 'btn btn-primary btn-full',
    onClick: () => openCloudInspectionById(directInput.value, directBtn)
  }, 'Open Inspection');
  directInput.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    openCloudInspectionById(directInput.value, directBtn);
  });
  directCard.appendChild(directInput);
  directCard.appendChild(directBtn);
  c.appendChild(directCard);

  const search = ui().el('input', {
    className: 'field-input cloud-resume-search',
    type: 'search',
    placeholder: 'Search address, client, inspector, or date…',
    autocomplete: 'off'
  });
  c.appendChild(search);

  const loadingSpinner = ui().el('span', {
    className: 'cloud-resume-spinner',
    role: 'status',
    'aria-label': 'Loading cloud inspections'
  });
  const status = ui().el('div', {
    className: 'cloud-resume-status',
    'aria-live': 'polite'
  }, [loadingSpinner, ui().el('span', null, 'Loading cloud inspections…')]);
  const hiddenControls = ui().el('div', { className: 'cloud-hidden-controls' });
  const list = ui().el('div', { className: 'cloud-resume-list' });
  c.appendChild(status);
  c.appendChild(hiddenControls);
  c.appendChild(list);
  ctx.root.appendChild(c);

  let inspections = [];
  let showHidden = false;
  function renderMatches() {
    const query = search.value.trim().toLowerCase();
    const active = inspections.filter(item => isContinuableCloudInspection(item));
    const hidden = active.filter(item => isCloudInspectionHiddenForPhone(item));
    const visible = active.filter(item => showHidden || !isCloudInspectionHiddenForPhone(item));
    const matches = visible.filter(item => !query || cloudSearchText(item).includes(query));
    list.innerHTML = '';
    hiddenControls.innerHTML = '';
    if (hidden.length > 0) {
      hiddenControls.appendChild(ui().el('button', {
        className: 'btn btn-outline btn-full',
        onClick: () => {
          showHidden = !showHidden;
          renderMatches();
        }
      }, showHidden ? 'Hide Hidden Inspections' : 'Show Hidden Inspections (' + hidden.length + ')'));
    }
    status.textContent = matches.length
      ? matches.length + (showHidden ? ' total' : ' active') + ' inspection' + (matches.length === 1 ? '' : 's')
      : (query
        ? 'No active inspections match that search.'
        : (showHidden
          ? 'No hidden inspections.'
          : 'No active cloud inspections. Start one or open by inspection ID above.'));
    matches.forEach(item => {
      const canContinue = isContinuableCloudInspection(item);
      const isHidden = isCloudInspectionHiddenForPhone(item);
      const continueBtn = ui().el(
        'button',
        { className: 'btn btn-primary btn-full' },
        canContinue ? 'Continue on This Device' : 'Open Full Review'
      );
      const hideBtn = ui().el('button', {
        className: 'btn btn-outline btn-full cloud-hide-btn',
        onClick: event => {
          event.stopPropagation();
          if (isHidden) {
            restoreCloudInspectionForPhone(item);
            ui().showToast('Inspection restored to active list');
          } else {
            hideCloudInspectionForPhone(item);
            ui().showToast('Inspection hidden on this phone');
          }
          renderMatches();
        }
      }, isHidden ? 'Restore to Active List' : 'Hide from This Phone');
      const openItem = () => canContinue
        ? continueCloudInspection(item, continueBtn)
        : openCloudReview(item);
      continueBtn.addEventListener('click', openItem);
      const card = ui().el('div', {
        className: 'card cloud-resume-card' + (isHidden ? ' is-hidden' : ''),
        role: 'button',
        tabindex: '0',
        onClick: event => {
          if (event.target.closest('button')) return;
          openItem();
        },
        onKeyDown: event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          openItem();
        }
      }, [
        ui().el('div', { className: 'cloud-resume-card-top' }, [
          ui().el('strong', null, item.propertyAddress || 'Address not entered'),
          ui().el('span', { className: 'badge ' + (isHidden ? 'completed' : (canContinue ? 'prepared' : 'completed')) }, isHidden ? 'Hidden' : (item.status || 'Prepared'))
        ]),
        ui().el('div', { className: 'cloud-resume-details' }, [
          ui().el('span', null, 'Client: ' + (item.clientName || '—')),
          ui().el('span', null, 'Inspector: ' + (item.inspectorName || '—')),
          ui().el('span', null, 'Date: ' + (item.inspectionDate || '—')),
          ui().el('span', null, 'ID: ' + (item.inspectionId || item.id || '—'))
        ]),
        continueBtn,
        hideBtn
      ]);
      list.appendChild(card);
    });
  }

  search.addEventListener('input', renderMatches);
  function loadCloudList() {
    status.innerHTML = '';
    status.appendChild(loadingSpinner);
    status.appendChild(ui().el('span', null, 'Loading active cloud inspections…'));
    list.innerHTML = '';
    return listCloudInspections().then(items => {
    inspections = items
      .filter(item => isContinuableCloudInspection(item) || isReviewableCloudInspection(item))
      .sort((a, b) => cloudInspectionSortTime(b) - cloudInspectionSortTime(a));
    renderMatches();
  }).catch(err => {
    status.textContent = 'Active cloud list unavailable. Use the inspection ID above, or retry.';
    list.appendChild(ui().el('div', { className: 'cloud-resume-error' }, [
      ui().el('strong', null, err?.message || String(err)),
      ui().el('span', null, 'A direct inspection ID lookup is the fastest backup path.'),
      ui().el('button', {
        className: 'btn btn-outline btn-full',
        onClick: () => loadCloudList()
      }, 'Retry Cloud List')
    ]));
  });
  }
  loadCloudList();
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
const OFFICE_PREP_FIELDS = [
  'pfasSetup', 'pfasKitNum', 'waterPanelPlanned', 'waterSampleId',
  'microplasticsStatus', 'microplasticsSampleId', 'pfasStatus',
  'pfasSampleId', 'waterSampleType', 'requiredTests', 'officePrepNotes', 'teamInspectorNames'
];

const ASSESSMENT_TYPE_OPTIONS = ['Home Health Assessment', 'Test / Training'];

function lockedAssessmentTypeForInspection(inspection) {
  if (!inspection) return '';
  const receipt = inspection._startInspectionShellReceipt ||
    inspection.startInspectionShell ||
    inspection.system?.startInspectionShell;
  if (!receipt) return '';
  const status = String(receipt.shellStatus || receipt.status || inspection._startInspectionShellStatus || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (status !== 'ready' && status !== 'skipped_test_training') return '';
  const trackerStatus = String(receipt.trackerStatus || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return receipt.isTestTraining === true || trackerStatus === 'skipped_test_training'
    ? 'Test / Training'
    : 'Home Health Assessment';
}

function applyLockedAssessmentType(target, assessmentType) {
  if (!target || !assessmentType) return;
  const isTestTraining = assessmentType === 'Test / Training';
  target.assessmentType = assessmentType;
  target.isTestTraining = isTestTraining;
  target.isTest = isTestTraining;
  target.is_test = isTestTraining;
  target.testTraining = isTestTraining;
}

function normalizeRequiredTests(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(value =>
    value === 'Water panel' ? 'Safe Home premium water test' : value
  ).filter(Boolean)));
}

function applyOfficePreparation(inspection, data) {
  ensureInspectionWorkspace(inspection);
  const pfasId = String(data.pfasSampleId || data.pfasKitNum || '').trim();
  inspection.requiredTests = normalizeRequiredTests(data.requiredTests);
  if (!inspection.stepData) inspection.stepData = {};
  inspection.stepData['device-setup'] = Object.assign({}, inspection.stepData['device-setup'] || {}, {
    pfasSetup: data.pfasSetup || '',
    pfasSampleId: pfasId,
    pfasKitNum: pfasId
  });
  inspection.stepData['water-sample'] = Object.assign({}, inspection.stepData['water-sample'] || {}, {
    waterPanelPlanned: data.waterPanelPlanned || '',
    waterSampleId: data.waterSampleId || '',
    waterSampleType: data.waterSampleType || '',
    microplasticsStatus: data.microplasticsStatus || '',
    microplasticsSampleId: data.microplasticsSampleId || '',
    pfasStatus: data.pfasStatus || '',
    pfasSampleId: pfasId,
    officePrepNotes: data.officePrepNotes || ''
  });
  String(data.teamInspectorNames || '').split(/\n|,/).map(name => name.trim()).filter(Boolean).forEach(name => {
    if (name.toLowerCase() !== String(inspection.inspectorName || '').trim().toLowerCase()) {
      addTeamMember(inspection, name, '', 'Inspector');
    }
  });
}

function intakeValuesOnly(data) {
  const clean = Object.assign({}, data);
  OFFICE_PREP_FIELDS.forEach(key => delete clean[key]);
  return clean;
}

export function renderIntake() {
  const isPrepare = _intakeMode === 'prepare';
  const isEdit = !!ctx.inspection;
  const lockedAssessmentType = isEdit ? lockedAssessmentTypeForInspection(ctx.inspection) : '';
  const existingDevice = ctx.inspection?.stepData?.['device-setup'] || {};
  const existingWater = ctx.inspection?.stepData?.['water-sample'] || {};
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
    inspectorEmail: ctx.inspection.inspectorEmail || '',
    assessmentType: ctx.inspection.assessmentType || '',
    pfasSetup: existingDevice.pfasSetup || '',
    pfasKitNum: existingDevice.pfasSampleId || existingWater.pfasSampleId || existingDevice.pfasKitNum || '',
    waterPanelPlanned: existingWater.waterPanelPlanned || '',
    waterSampleId: existingWater.waterSampleId || '',
    waterSampleType: existingWater.waterSampleType || '',
    requiredTests: normalizeRequiredTests(ctx.inspection.requiredTests),
    microplasticsStatus: existingWater.microplasticsStatus || '',
    microplasticsSampleId: existingWater.microplasticsSampleId || '',
    pfasStatus: existingWater.pfasStatus || '',
    pfasSampleId: existingWater.pfasSampleId || existingDevice.pfasSampleId || existingDevice.pfasKitNum || '',
    officePrepNotes: existingWater.officePrepNotes || '',
    teamInspectorNames: (ctx.inspection.collaboration?.members || []).slice(1).map(member => member.name).join('\n')
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
    blueprintNotes: '',
    assessmentType: '',
    pfasSetup: '',
    pfasKitNum: '',
    waterPanelPlanned: '',
    waterSampleId: '',
    waterSampleType: '',
    requiredTests: [],
    microplasticsStatus: '',
    microplasticsSampleId: '',
    pfasStatus: '',
    pfasSampleId: '',
    officePrepNotes: '',
    teamInspectorNames: ''
  };
  if (lockedAssessmentType) applyLockedAssessmentType(data, lockedAssessmentType);

  const c = ui().el('div', { className: 'screen' });
  c.appendChild(buildAppHeader(isPrepare ? 'Office Inspection Preparation' : (isEdit ? 'Edit Intake Details' : 'Customer & Property Intake')));
  c.appendChild(ui().renderStatusBar(getLastSaveText()));

  if (isPrepare) {
    c.appendChild(ui().el('div', { className: 'office-prep-intro' }, [
      ui().el('strong', null, 'Prepare everything the inspector needs before leaving the office.'),
      ui().el('span', null, 'The inspector will find this by address, client, inspector, or date under Continue Inspection.')
    ]));
  }

  const card = ui().el('div', { className: 'card' });
  const fields = [
    { ...text('inspectionId', 'Inspection ID'), disabled: true },
    sel('assessmentType', 'Assessment Type *', ASSESSMENT_TYPE_OPTIONS, { disabled: !!lockedAssessmentType }),
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
    ...(isPrepare ? [] : [
      text('wifiPassword', 'WiFi Password', { placeholder: 'For Airthings and device connectivity' }),
      { type: 'wifi-copy' }
    ]),
    textarea('clientConcerns', 'Client concerns / known problem areas', { placeholder: 'Tap \uD83C\uDF99 mic in your iPhone keyboard to dictate \u2014 read back and fix errors before saving.' }),
    textarea('blueprintNotes', 'Client blueprints / layout notes (optional)')
  ];

  if (isPrepare) {
    fields.push(
      divider(),
      heading('Inspection Team'),
      textarea('teamInspectorNames', 'Additional inspectors', { placeholder: 'One inspector name per line. Each person will select their name when opening the inspection.' }),
      divider(),
      heading('Water Test Kit Preparation'),
      chips('requiredTests', 'Required tests for this inspection', REQUIRED_TEST_OPTIONS),
      sel('waterPanelPlanned', 'Safe Home premium water test', ['Requested — collect on site', 'Not requested']),
      sel('waterSampleType', 'Safe Home water sample type', ['Unfiltered', 'Filtered', 'Both filtered and unfiltered', 'Not determined']),
      { type: 'sample-id-scanner', dataKey: 'waterSampleId', label: 'Safe Home Premium Water Kit / Sample ID' },
      sel('pfasSetup', 'PFAS water test', ['Yes', 'No', 'Not requested']),
      showIf({ type: 'sample-id-scanner', dataKey: 'pfasSampleId', label: 'PFAS Kit / Sample ID' }, 'pfasSetup', 'Yes'),
      sel('microplasticsStatus', 'Microplastics test', ['Requested — collect on site', 'Not requested']),
      { type: 'sample-id-scanner', dataKey: 'microplasticsSampleId', label: 'Microplastics sample ID (if pre-assigned)' },
      textarea('officePrepNotes', 'Office preparation notes', { placeholder: 'Kit locations, special customer instructions, labels prepared, or anything the inspector needs to know.' })
    );
  }

  const onIntakeChange = () => { ui().updateShowIf(card, data); };
  fields.forEach(f => {
    const rendered = ui().renderField(f, data, onIntakeChange, {}, () => {});
    if (rendered) card.appendChild(rendered);
  });
  ui().updateShowIf(card, data);
  c.appendChild(card);

  const nav = ui().el('div', { className: 'bottom-nav' });
  const backBtn = ui().el('button', { className: 'btn btn-outline btn-nav', onClick: () => {
    if (isPrepare) {
      ctx.inspection = null;
      setInspection(null);
      setScreen('home');
    } else if (isEdit) {
      setScreen('step');
    } else {
      setScreen('truck-check');
    }
    ctx.render();
  } }, isPrepare ? '\u2190 Home' : (isEdit ? '\u2190 Back to Steps' : '\u2190 Back'));

  const submitBtn = ui().el('button', { className: 'btn btn-primary btn-nav', onClick: async () => {
      if (lockedAssessmentType) applyLockedAssessmentType(data, lockedAssessmentType);
      const required = ['assessmentType', 'inspectorName', 'clientName', 'propertyAddress', 'numberOfLevels', 'numberOfBedrooms', 'numberOfBathrooms'];
      const missing = required.filter(k => !data[k] || !data[k].trim || !data[k].trim());
      if (!data.waterSource || (Array.isArray(data.waterSource) ? data.waterSource.length === 0 : !data.waterSource)) missing.push('waterSource');
      if (missing.length) { alert('Please fill in all required fields (marked with *).'); return; }

      if (!lockedAssessmentType) {
        const isTestTraining = data.assessmentType === 'Test / Training';
        const confirmed = confirm(isTestTraining
          ? 'Confirm TEST / TRAINING inspection.\n\nThis creates a folder under _Test Assessments. It will not reserve an assessment number or create a tracker row.'
          : 'Confirm REAL HOME ASSESSMENT.\n\nThis reserves the next assessment number, creates a folder in Assessments, and writes a tracker row.');
        if (!confirmed) return;
      }

      if (isPrepare) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving to Cloud…';
        const now = new Date().toISOString();
        if (isEdit) {
          Object.assign(ctx.inspection, intakeValuesOnly(data));
          ctx.inspection.status = 'prepared';
          ctx.inspection.reviewStatus = 'Prepared';
          ctx.inspection.preparedAt = ctx.inspection.preparedAt || now;
          ctx.inspection.updatedAt = now;
        } else {
          ctx.inspection = {
            ...intakeValuesOnly(data),
            inspectionId: data.inspectionId || ctx.genId(),
            startedAt: now,
            preparedAt: now,
            updatedAt: now,
            endedAt: null,
            status: 'prepared',
            reviewStatus: 'Prepared',
            stepData: {},
            timers: {},
            dynamicRooms: { lowest: [], additional: [{ name: 'Living Room' }, { name: 'Laundry Room' }] },
            _lastStepIdx: 0,
            truckCheck: {}
          };
          ensureInspectionWorkspace(ctx.inspection);
          setInspection(ctx.inspection);
        }
        applyOfficePreparation(ctx.inspection, data);
        setInspection(ctx.inspection);
        ctx.stepList = buildStepList(ctx.inspection);
        const localSaved = await saveNow();
        if (!localSaved) {
          submitBtn.disabled = false;
          submitBtn.textContent = isEdit ? 'Update for Inspector' : 'Save for Inspector';
          alert('This inspection could not be saved locally. If another InHaus Inspector tab is open, close it, then tap Save for Inspector again.');
          return;
        }
        const shellReady = await ensureStartInspectionShell(ctx.stepList, { force: !isEdit });
        if (!shellReady || shellReady.ok !== true) {
          submitBtn.disabled = false;
          submitBtn.textContent = isEdit ? 'Update for Inspector' : 'Save for Inspector';
          alert('Saved on this computer, but the assessment folder/tracker setup failed. Do not send this to the phone yet. Error: ' + (shellReady?.message || 'folder/tracker receipt missing'));
          return;
        }
        const cloudSaved = await checkpointToCloud(ctx.stepList);
        if (!cloudSaved) {
          submitBtn.disabled = false;
          submitBtn.textContent = isEdit ? 'Update for Inspector' : 'Save for Inspector';
          alert('Saved on this computer, but the cloud handoff failed. Keep this page open and tap Save for Inspector again.');
          return;
        }
        await saveNow();
        ui().showToast('Inspection prepared and available on the inspector’s phone');
        ctx.inspection = null;
        setInspection(null);
        setScreen('home');
        ctx.render();
        return;
      }

      if (isEdit) {
        Object.assign(ctx.inspection, data);
        ctx.stepList = buildStepList(ctx.inspection);
        setScreen('step');
        ctx.render();
        saveNow();
      } else {
        ctx.inspection = {
          ...data,
          inspectionId: ctx.genId(),
          startedAt: new Date().toISOString(),
          endedAt: null,
          status: 'in-progress',
          reviewStatus: 'Field Active',
          stepData: {},
          timers: {},
          dynamicRooms: { lowest: [], additional: [{ name: 'Living Room' }, { name: 'Laundry Room' }] },
          _lastStepIdx: 0,
          truckCheck: Object.assign({}, ctx._truckCheck)
        };
        ensureInspectionWorkspace(ctx.inspection);
        if (ctx.inspection.collaboration.members[0]) {
          setInspectorIdentity(ctx.inspection, ctx.inspection.collaboration.members[0].memberId);
        }
        setInspection(ctx.inspection);
        ctx.stepList = buildStepList(ctx.inspection);
        ctx.currentStepIdx = 0;
        setScreen('precheck');
        ctx.startAutoSave();
        ctx.render();
        saveNow().then(() => {
          if (window.runCloudPreflight) window.runCloudPreflight();
        });
      }
    }}, isPrepare ? (isEdit ? 'Update for Inspector' : 'Save for Inspector') : (isEdit ? 'Save Changes \u2713' : 'Start Inspection \u2192'));
  nav.appendChild(backBtn);
  nav.appendChild(submitBtn);
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
  const testsSummary = ui().el('div', { className: 'field-info' });
  const updateTestsSummary = () => {
    const tests = Array.isArray(ctx.inspection.requiredTests)
      ? ctx.inspection.requiredTests.filter(Boolean)
      : [];
    testsSummary.textContent = tests.length
      ? 'Tests planned for this inspection: ' + tests.join(' • ')
      : 'No tests are selected. Select any test the office missed or the customer requested on site.';
  };
  updateTestsSummary();
  card.appendChild(testsSummary);
  const testEditor = ui().renderField(
    chips('requiredTests', 'Select or unselect tests for this inspection', REQUIRED_TEST_OPTIONS),
    ctx.inspection,
    () => {
      updateTestsSummary();
      ctx.inspection._updatedAt = new Date().toISOString();
      scheduleSave();
    },
    ctx.inspection,
    () => scheduleSave()
  );
  if (testEditor) card.appendChild(testEditor);
  card.appendChild(ui().el('hr', { className: 'divider' }));
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

function roomDisplayName(step) {
  return String(ctx.inspection.stepData?.[step.id]?.roomName || step.name || '').trim();
}

function bedroomSteps() {
  return ctx.stepList.filter(step => step.type === 'bedroom');
}

function bathroomSteps() {
  return ctx.stepList.filter(step => step.type === 'bathroom');
}

function bathroomRelationship(stepId) {
  const relationships = ensureRoomRelationships(ctx.inspection);
  if (!relationships[stepId]) {
    relationships[stepId] = {
      bathroomType: 'standalone',
      linkedBedroomIds: [],
      autoName: true
    };
  }
  if (!Array.isArray(relationships[stepId].linkedBedroomIds)) {
    relationships[stepId].linkedBedroomIds = [];
  }
  return relationships[stepId];
}

function rebuildAtStep(stepId) {
  ctx.stepList = buildStepList(ctx.inspection);
  const nextIndex = ctx.stepList.findIndex(step => step.id === stepId);
  if (nextIndex >= 0) ctx.currentStepIdx = nextIndex;
}

function openStepById(stepId) {
  rebuildAtStep(stepId);
  setScreen('step');
  ctx.render();
  window.scrollTo(0, 0);
}

function linkPrivateBathroom(bedroomStep) {
  const relationships = ensureRoomRelationships(ctx.inspection);
  const alreadyLinked = bathroomSteps().find(bathroom =>
    relationships[bathroom.id]?.bathroomType === 'ensuite' &&
    Array.isArray(relationships[bathroom.id]?.linkedBedroomIds) &&
    relationships[bathroom.id].linkedBedroomIds.includes(bedroomStep.id)
  );
  if (alreadyLinked) {
    openStepById(alreadyLinked.id);
    return;
  }

  // Reuse an unopened bathroom entered during office preparation before adding
  // another bathroom. This keeps the property counts accurate and avoids a
  // duplicate when the office already entered the home's bathroom count.
  const available = bathroomSteps().find(bathroom => {
    const relationship = relationships[bathroom.id];
    const data = ctx.inspection.stepData?.[bathroom.id];
    const linked = relationship && Array.isArray(relationship.linkedBedroomIds) && relationship.linkedBedroomIds.length;
    return !linked && !(data && data._visited);
  });

  if (available) {
    relationships[available.id] = {
      bathroomType: 'ensuite',
      linkedBedroomIds: [bedroomStep.id],
      autoName: true,
      createdAt: relationships[available.id]?.createdAt || new Date().toISOString()
    };
    rebuildAtStep(available.id);
    scheduleSave();
    ctx.render();
    window.scrollTo(0, 0);
    return;
  }

  ctx.addDynamicRoom('bathrooms', null, {
    relationship: {
      bathroomType: 'ensuite',
      linkedBedroomIds: [bedroomStep.id],
      autoName: true
    }
  });
}

function buildBedroomBathroomLinkCard(step) {
  const card = ui().el('div', { className: 'card', style: 'border:2px solid var(--accent-light);margin-bottom:12px;' });
  card.appendChild(ui().el('h3', { className: 'section-heading', style: 'margin-top:0;' }, 'Bathroom'));
  const relationships = ensureRoomRelationships(ctx.inspection);
  const privateBathroom = bathroomSteps().find(bathroom =>
    relationships[bathroom.id]?.bathroomType === 'ensuite' &&
    Array.isArray(relationships[bathroom.id]?.linkedBedroomIds) &&
    relationships[bathroom.id].linkedBedroomIds.includes(step.id)
  );
  const sharedBathrooms = bathroomSteps().filter(bathroom =>
    relationships[bathroom.id]?.bathroomType === 'shared' &&
    Array.isArray(relationships[bathroom.id]?.linkedBedroomIds) &&
    relationships[bathroom.id].linkedBedroomIds.includes(step.id)
  );

  if (privateBathroom) {
    card.appendChild(ui().el('p', { className: 'text-muted', 'data-linked-bathroom-id': privateBathroom.id, 'data-link-kind': 'private-description' }, 'Private bathroom: ' + roomDisplayName(privateBathroom)));
    card.appendChild(ui().el('button', {
      type: 'button',
      className: 'btn btn-outline btn-full',
      'data-linked-bathroom-id': privateBathroom.id,
      'data-link-kind': 'private-button',
      onClick: () => openStepById(privateBathroom.id)
    }, 'Open ' + roomDisplayName(privateBathroom)));
  } else {
    card.appendChild(ui().el('p', { className: 'text-muted' }, 'Only add this if the bedroom has its own private bathroom. Shared and hall bathrooms stay in the Bathrooms section.'));
    card.appendChild(ui().el('button', {
      type: 'button',
      className: 'btn btn-primary btn-full',
      onClick: () => linkPrivateBathroom(step)
    }, '+ Add Private Bathroom'));
  }
  sharedBathrooms.forEach(bathroom => {
    card.appendChild(ui().el('button', {
      type: 'button',
      className: 'btn btn-outline btn-full',
      style: 'margin-top:8px;',
      'data-linked-bathroom-id': bathroom.id,
      'data-link-kind': 'shared-button',
      onClick: () => openStepById(bathroom.id)
    }, 'Open Shared Bathroom: ' + roomDisplayName(bathroom)));
  });
  return card;
}

function buildBathroomAssignmentCard(step) {
  const relationship = bathroomRelationship(step.id);
  const card = ui().el('div', { className: 'card', style: 'border:2px solid var(--accent-light);margin-bottom:12px;' });
  card.appendChild(ui().el('h3', { className: 'section-heading', style: 'margin-top:0;' }, 'Bathroom Assignment'));
  card.appendChild(ui().el('p', { className: 'text-muted' }, 'Keep this bathroom separate, then link it to a bedroom only when it is private or shared.'));

  const typeLabel = ui().el('label', { className: 'field-label' }, 'Bathroom Type');
  const typeSelect = ui().el('select', { className: 'field-select' });
  [
    { value: 'standalone', label: 'Hall / Guest / Standalone' },
    { value: 'ensuite', label: 'Private / Ensuite' },
    { value: 'shared', label: 'Shared by Bedrooms' }
  ].forEach(option => {
    const node = ui().el('option', { value: option.value }, option.label);
    if (relationship.bathroomType === option.value) node.selected = true;
    typeSelect.appendChild(node);
  });
  typeSelect.addEventListener('change', () => {
    relationship.bathroomType = typeSelect.value;
    if (relationship.bathroomType === 'standalone') relationship.linkedBedroomIds = [];
    if (relationship.bathroomType === 'ensuite' && relationship.linkedBedroomIds.length > 1) {
      relationship.linkedBedroomIds = relationship.linkedBedroomIds.slice(0, 1);
    }
    relationship.autoName = true;
    rebuildAtStep(step.id);
    scheduleSave();
    const savedScroll = window.scrollY;
    ctx.render();
    requestAnimationFrame(() => window.scrollTo(0, savedScroll));
  });
  card.appendChild(typeLabel);
  card.appendChild(typeSelect);

  if (relationship.bathroomType !== 'standalone') {
    card.appendChild(ui().el('div', { className: 'field-label', style: 'margin-top:14px;' }, relationship.bathroomType === 'shared' ? 'Bedrooms sharing this bathroom' : 'Bedroom with this private bathroom'));
    bedroomSteps().forEach(bedroom => {
      const checked = relationship.linkedBedroomIds.includes(bedroom.id);
      const row = ui().el('label', { style: 'display:flex;align-items:center;gap:10px;padding:10px 0;font-weight:600;' });
      const checkbox = ui().el('input', { type: relationship.bathroomType === 'ensuite' ? 'radio' : 'checkbox', name: relationship.bathroomType === 'ensuite' ? 'bathroom-bedroom-' + step.id : '' });
      checkbox.checked = checked;
      checkbox.addEventListener('change', () => {
        if (relationship.bathroomType === 'ensuite') {
          relationship.linkedBedroomIds = checkbox.checked ? [bedroom.id] : [];
        } else if (checkbox.checked) {
          if (!relationship.linkedBedroomIds.includes(bedroom.id)) relationship.linkedBedroomIds.push(bedroom.id);
        } else {
          relationship.linkedBedroomIds = relationship.linkedBedroomIds.filter(id => id !== bedroom.id);
        }
        relationship.autoName = true;
        rebuildAtStep(step.id);
        scheduleSave();
        const savedScroll = window.scrollY;
        ctx.render();
        requestAnimationFrame(() => window.scrollTo(0, savedScroll));
      });
      row.appendChild(checkbox);
      row.appendChild(document.createTextNode(roomDisplayName(bedroom)));
      card.appendChild(row);
    });
  }

  if (relationship.autoName === false && relationship.linkedBedroomIds.length) {
    card.appendChild(ui().el('button', {
      type: 'button',
      className: 'btn btn-outline btn-full',
      style: 'margin-top:10px;',
      onClick: () => {
        relationship.autoName = true;
        rebuildAtStep(step.id);
        scheduleSave();
        const savedScroll = window.scrollY;
        ctx.render();
        requestAnimationFrame(() => window.scrollTo(0, savedScroll));
      }
    }, 'Use Linked Bedroom Name'));
  }
  return card;
}

export function renderStep() {
  const renderJob = ++_stepRenderJob;
  if (ctx.currentStepIdx >= ctx.stepList.length || (ctx.stepList[ctx.currentStepIdx] && ctx.stepList[ctx.currentStepIdx].type === 'review')) {
    setScreen('review');
    renderReview();
    return;
  }
  const step = ctx.stepList[ctx.currentStepIdx];
  ensureInspectionWorkspace(ctx.inspection);
  setActiveStepPresence(ctx.inspection, step.id, step.name);

  const data = getStepData(step.id);
  if (!data._enteredAt) data._enteredAt = new Date().toISOString();
  data._roomName = step.name;
  // Auto-populate roomName from step name if blank
  if (!data.roomName && step.name) { data.roomName = step.name; }

  // PFAS uses one physical identifier. Preserve the legacy kit-number alias for
  // existing exports while carrying the same value through setup and collection.
  if (step.id === 'device-setup' || step.id === 'water-sample') {
    const deviceData = getStepData('device-setup');
    const waterData = getStepData('water-sample');
    const pfasId = String(
      data.pfasSampleId || waterData.pfasSampleId || deviceData.pfasSampleId || deviceData.pfasKitNum || ''
    ).trim();
    if (pfasId) {
      deviceData.pfasSampleId = pfasId;
      deviceData.pfasKitNum = pfasId;
      waterData.pfasSampleId = pfasId;
    }
  }

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

  const timersBar = ui().renderTimersBar(ctx.inspection, () => scheduleSave());
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

  const pendingFindings = ctx.inspection.findings.filter(item => item.status === 'needs_review').length;
  const identity = getInspectorIdentity(ctx.inspection);
  const assignment = getStepAssignment(ctx.inspection, step.id);
  const workspaceTools = ui().el('div', { className: 'field-workspace-tools' });
  workspaceTools.appendChild(ui().el('button', {
    type: 'button', className: 'btn btn-secondary',
    onClick: () => openInspectionWorkspace('rapid-capture', 'step', {
      roomName: data.roomName || data._roomName || step.name,
      stepName: step.name,
      stepId: step.id
    })
  }, '📸 Rapid Capture'));
  workspaceTools.appendChild(ui().el('button', {
    type: 'button', className: 'btn btn-outline',
    onClick: () => openInspectionWorkspace('my-work', 'step')
  }, '✅ My Work'));
  workspaceTools.appendChild(ui().el('button', {
    type: 'button', className: 'btn btn-outline',
    onClick: () => openInspectionWorkspace('findings', 'step')
  }, '📥 Findings' + (pendingFindings ? ' (' + pendingFindings + ')' : '')));
  workspaceTools.appendChild(ui().el('button', {
    type: 'button', className: 'btn btn-outline',
    onClick: () => openInspectionWorkspace('team', 'step')
  }, '👥 ' + (ctx.inspection.collaboration.enabled ? identity.name : 'Team')));
  c.appendChild(workspaceTools);
  if (assignment) {
    c.appendChild(ui().el('div', {
      className: 'step-assignment-banner' + (assignment.memberId === identity.memberId ? ' is-mine' : ' is-other')
    }, assignment.memberId === identity.memberId
      ? '✓ Assigned to you'
      : 'Assigned to ' + assignment.memberName + ' • You can still assist if needed'));
  }
  const otherEditors = getActivePresence(ctx.inspection).filter(item => item.stepId === step.id && item.memberId !== identity.memberId);
  if (otherEditors.length) {
    c.appendChild(ui().el('div', { className: 'step-presence-warning' },
      '⚠ ' + otherEditors.map(item => item.memberName).join(', ') + ' ' + (otherEditors.length === 1 ? 'is' : 'are') + ' also editing this section. Your individual field changes will merge, but coordinate before changing the same answer.'));
  }

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
    // Add Room as a + tab inline with supplementary room tabs
    if (currentPhase === 'supplementary') {
      const addBtn = ui().el('button', {
        type: 'button',
        className: 'sub-nav-btn',
        style: 'opacity:0.7;font-size:18px;padding:4px 12px;',
        onClick: () => { ctx.addDynamicRoom('additional'); window.scrollTo(0, 0); }
      }, '+');
      subNav.appendChild(addBtn);
    }
    c.appendChild(subNav);
    requestAnimationFrame(() => {
      const activeButton = subNav.querySelector('.sub-nav-btn.active');
      if (!activeButton) return;
      subNav.scrollLeft = Math.max(0,
        activeButton.offsetLeft - ((subNav.clientWidth - activeButton.offsetWidth) / 2));
    });
  }

  // Back to page 1 (edit intake) button
  const backToIntakeBtn = ui().el('button', {
    type: 'button',
    className: 'btn btn-outline btn-small',
    style: 'position:fixed;top:max(54px,calc(env(safe-area-inset-top) + 8px));right:10px;z-index:200;font-size:11px;padding:4px 10px;display:inline-flex;align-items:center;justify-content:center;background:#fff;color:#2C3F16;border-color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.22);',
    onClick: () => { setScreen('intake'); ctx.render(); }
  }, '\u270E Intake');
  c.appendChild(backToIntakeBtn);

  // Search button
  const searchBtn = ui().el('button', {
    type: 'button',
    'aria-label': 'Search inspection',
    style: 'position:fixed;top:max(54px,calc(env(safe-area-inset-top) + 8px));left:10px;z-index:200;background:#fff;color:#2C3F16;border:1px solid #fff;border-radius:8px;font-size:15px;padding:6px 12px;cursor:pointer;min-height:0;line-height:1.4;font-weight:700;touch-action:manipulation;box-shadow:0 2px 8px rgba(0,0,0,0.22);display:flex;align-items:center;justify-content:center;',
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
          const dataUrl = ui().compressImage
            ? await ui().compressImage(e.target.files[0])
            : await new Promise(r => { const fr = new FileReader(); fr.onload = ev => r(ev.target.result); fr.readAsDataURL(e.target.files[0]); });
          if (!ctx.inspection.sparePhotos) ctx.inspection.sparePhotos = [];
          const captureRoom = getStepData(step.id).roomName || step.name;
          const sp = {
            photoId: 'spare-' + Math.random().toString(36).substr(2,9),
            timestamp: new Date().toISOString(),
            caption: '',
            dataUrl,
            stepName: step.name,
            roomName: captureRoom,
            placementSource: 'capture_context',
            routingStatus: 'auto',
            assignedSlot: null
          };
          ctx.inspection.sparePhotos.push(sp);
          await saveNow();
          if (window.DB?.savePhoto) {
            try {
              await window.DB.savePhoto({
                ...sp,
                inspectionId: ctx.inspection.inspectionId,
                uploadState: 'local'
              });
              sp._vaultSaved = true;
            } catch (vaultErr) {
              console.warn('Spare photo vault save failed:', vaultErr);
            }
          }
          if (window.queuePhotoForBackgroundUpload) window.queuePhotoForBackgroundUpload(sp);
          if (window.savePhotoToDevice) window.savePhotoToDevice(dataUrl, sp.photoId);
          ui().showToast('📸 Saved to ' + formatPhotoDestination(captureRoom, step.name));
        } catch(err) { console.error(err); }
      };
      document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 2000);
    }
  }, '📸');
  c.appendChild(spareFab);

  const stepHeading = ui().el('h1', { className: 'screen-title' }, data.roomName || step.name);
  c.appendChild(stepHeading);
  if (step.type === 'bathroom') c.appendChild(buildBathroomAssignmentCard(step));

  const fields = getStepFields(step);
  const hasQtrakLocation = fields.some(field =>
    field?.key === 'qtrakLocation' ||
    (Array.isArray(field?.fields) && field.fields.some(inner => inner?.key === 'qtrakLocation'))
  );
  if (hasQtrakLocation && !String(data.qtrakLocation || '').trim()) {
    data.qtrakLocation = String(
      step.type === 'kitchen-air'
        ? 'Kitchen'
        : (data.roomName || data._roomName || step.name || '')
    ).trim();
    data._updatedAt = new Date().toISOString();
    scheduleSave();
  }
  let pendingFieldRender = null;
  if (fields.length) {
    const card = ui().el('div', { className: 'card' });
    const onFieldChange = fieldKey => {
      markStepUpdated(ctx.inspection, step.id, step.name, fieldKey);
      scheduleSave();
      ui().updateShowIf(card, data);
      if (fieldKey === 'heatingType' || fieldKey === 'acType') {
        card.querySelectorAll('.ai-hvac-scanner').forEach(scanner => {
          if (typeof scanner.refreshSelectedSystems === 'function') scanner.refreshSelectedSystems();
        });
      }
      // Update heading live when inspector types a room name
      if (fieldKey === 'roomName' && data.roomName) {
        stepHeading.textContent = data.roomName;
        // Sync the subnav tab label to match
        const activeTab = document.querySelector('.sub-nav-btn.active');
        if (activeTab) activeTab.textContent = data.roomName;
        // Also update step.name so it persists if re-rendered
        step.name = data.roomName;
        if (step.type === 'bathroom') {
          bathroomRelationship(step.id).autoName = false;
        }
        if (step.type === 'bedroom') {
          rebuildAtStep(step.id);
          c.querySelectorAll('[data-linked-bathroom-id]').forEach(node => {
            const linkedStep = ctx.stepList.find(candidate => candidate.id === node.getAttribute('data-linked-bathroom-id'));
            if (!linkedStep) return;
            const linkedName = roomDisplayName(linkedStep);
            const kind = node.getAttribute('data-link-kind');
            if (kind === 'private-description') node.textContent = 'Private bathroom: ' + linkedName;
            else if (kind === 'private-button') node.textContent = 'Open ' + linkedName;
            else if (kind === 'shared-button') node.textContent = 'Open Shared Bathroom: ' + linkedName;
          });
        }
      }
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

  if (step.type === 'bedroom') {
    const bedroomSteps = ctx.stepList.filter(s => s.type === 'bedroom');
    if (step.id === bedroomSteps[bedroomSteps.length - 1].id) {
      c.appendChild(ui().el('button', { className: 'btn btn-outline btn-full', style: 'margin-top:8px', onClick: () => { ctx.addDynamicRoom('bedrooms'); window.scrollTo(0, 0); } }, '+ Add Another Bedroom'));
    }
    c.appendChild(buildBedroomBathroomLinkCard(step));
  }
  if (step.type === 'bathroom') {
    const bathroomSteps = ctx.stepList.filter(s => s.type === 'bathroom');
    if (step.id === bathroomSteps[bathroomSteps.length - 1].id) {
      c.appendChild(ui().el('button', { className: 'btn btn-outline btn-full', style: 'margin-top:8px', onClick: () => { ctx.addDynamicRoom('bathrooms'); window.scrollTo(0, 0); } }, '+ Add Another Bathroom'));
    }
  }
  // Add Room button moved to sub-nav tab row for supplementary phase

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
        if (missing.length) {
          const message = missing.length === 1
            ? missing[0]
            : missing.length + ' required items missing. First: ' + missing[0];
          ui().showToast(message, 4500);
          ui().flashUncheckedItems(c);
          return;
        }
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
  const nav = ui().el('div', {
    className: 'bottom-nav' + (isDevMode() ? ' dev-bottom-nav' : '')
  }, navButtons);
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

function findingPhotoById(photoId) {
  const ref = collectInspectionPhotoRefs().find(item => item.photo.photoId === photoId);
  return ref ? ref.photo : null;
}

const RAPID_CAPTURE_UNASSIGNED_DESTINATION = {
  roomName: '',
  stepName: '',
  label: 'Unassigned — add room and details later'
};

export function rapidCapturePhotoRouting(roomName, stepName) {
  const normalizedRoom = String(roomName || '').trim();
  const normalizedStep = String(stepName || '').trim();
  const assigned = !!(normalizedRoom || normalizedStep);
  return {
    roomName: normalizedRoom,
    stepName: normalizedStep,
    placementSource: assigned ? 'rapid_capture_context' : 'rapid_capture_unassigned',
    routingStatus: assigned ? 'auto' : 'needs_placement'
  };
}

export function rapidCaptureCreatesFinding(comment) {
  return !!String(comment || '').trim();
}

function rapidCaptureDestinationOptions() {
  const options = [RAPID_CAPTURE_UNASSIGNED_DESTINATION, ...collectPhotoDestinations()];
  if (_rapidCaptureContext && (_rapidCaptureContext.roomName || _rapidCaptureContext.stepName)) {
    const key = String(_rapidCaptureContext.roomName || '').toLowerCase() + '|' + String(_rapidCaptureContext.stepName || '').toLowerCase();
    if (!options.some(item => String(item.roomName).toLowerCase() + '|' + String(item.stepName).toLowerCase() === key)) {
      options.unshift({
        roomName: _rapidCaptureContext.roomName || '',
        stepName: _rapidCaptureContext.stepName || '',
        label: formatPhotoDestination(_rapidCaptureContext.roomName, _rapidCaptureContext.stepName)
      });
    }
  }
  return options;
}

// ── RAPID CAPTURE ─────────────────────────────────────────
export function renderRapidCapture() {
  if (!ctx.inspection) { setScreen('home'); ctx.render(); return; }
  ensureInspectionWorkspace(ctx.inspection);
  requestCompanyLibraryRefresh();
  const destinations = rapidCaptureDestinationOptions();
  const rememberedDestination = destinations.find(item =>
    item.roomName === _rapidCaptureContext?.roomName && item.stepName === _rapidCaptureContext?.stepName
  );
  const defaultDestination = rememberedDestination || destinations[0] || {
    roomName: _rapidCaptureContext?.roomName || '',
    stepName: _rapidCaptureContext?.stepName || '',
    label: formatPhotoDestination(_rapidCaptureContext?.roomName, _rapidCaptureContext?.stepName)
  };
  if (!ctx.inspection.rapidCaptureDraft) {
    ctx.inspection.rapidCaptureDraft = {
      roomName: defaultDestination.roomName,
      stepName: defaultDestination.stepName,
      reportSection: defaultDestination.stepName,
      severity: 'Observation',
      rawComment: '',
      photos: [],
      startedAt: new Date().toISOString()
    };
  }
  const draft = ctx.inspection.rapidCaptureDraft;
  if (!Array.isArray(draft.photos)) draft.photos = [];

  const c = ui().el('div', { className: 'screen rapid-capture-screen' });
  c.appendChild(buildAppHeader('Rapid Capture'));
  c.appendChild(ui().renderStatusBar(getLastSaveText()));
  c.appendChild(ui().el('div', { className: 'rapid-capture-intro' }, [
    ui().el('strong', null, 'Stay in camera mode and capture everything.'),
    ui().el('span', null, 'Room, finding type, and comments are optional. Unassigned photos stay safely in Photo Organization until someone places them.')
  ]));

  const contextCard = ui().el('div', { className: 'card rapid-context-card' });
  const contextLabel = ui().el('label', { className: 'field-label' }, 'Room or step (optional)');
  const contextSelect = ui().el('select', { className: 'field-input' });
  destinations.forEach((destination, index) => {
    contextSelect.appendChild(ui().el('option', { value: String(index) }, destination.label));
  });
  const selectedDestinationIndex = destinations.findIndex(destination => destination.roomName === draft.roomName && destination.stepName === draft.stepName);
  if (selectedDestinationIndex >= 0) contextSelect.value = String(selectedDestinationIndex);
  contextSelect.addEventListener('change', () => {
    const destination = destinations[Number(contextSelect.value)];
    if (!destination) return;
    draft.roomName = destination.roomName;
    draft.stepName = destination.stepName;
    draft.reportSection = destination.stepName;
    const routing = rapidCapturePhotoRouting(destination.roomName, destination.stepName);
    draft.photos.forEach(photoItem => {
      Object.assign(photoItem, routing);
      if (window.DB?.updatePhoto) window.DB.updatePhoto(photoItem.photoId, {
        roomName: routing.roomName,
        stepName: routing.stepName,
        placementSource: routing.placementSource,
        routingStatus: routing.routingStatus
      });
    });
    scheduleSave();
  });
  contextCard.appendChild(contextLabel);
  contextCard.appendChild(contextSelect);

  const severityLabel = ui().el('label', { className: 'field-label' }, 'Finding type');
  const severitySelect = ui().el('select', { className: 'field-input' });
  ['Information', 'Observation', 'Maintenance', 'Concern', 'Urgent'].forEach(value => {
    severitySelect.appendChild(ui().el('option', { value }, value));
  });
  severitySelect.value = draft.severity || 'Observation';
  severitySelect.addEventListener('change', () => { draft.severity = severitySelect.value; scheduleSave(); });
  contextCard.appendChild(severityLabel);
  contextCard.appendChild(severitySelect);

  if (ctx.inspection.commentLibrary.length) {
    const libraryLabel = ui().el('label', { className: 'field-label' }, 'Use an approved comment');
    const librarySelect = ui().el('select', { className: 'field-input reusable-comment-select' });
    librarySelect.appendChild(ui().el('option', { value: '' }, '— Optional: choose approved wording —'));
    ctx.inspection.commentLibrary.forEach(entry => {
      librarySelect.appendChild(ui().el('option', { value: entry.commentId }, (entry.source === 'company_library' ? 'Company • ' : '') + entry.cleanedText));
    });
    librarySelect.addEventListener('change', () => {
      if (!librarySelect.value) return;
      const entry = useLibraryComment(ctx.inspection, librarySelect.value);
      if (!entry) return;
      draft.rawComment = entry.cleanedText;
      draft.severity = entry.severity || draft.severity;
      scheduleSave();
      ctx.render();
    });
    contextCard.appendChild(libraryLabel);
    contextCard.appendChild(librarySelect);
  }
  c.appendChild(contextCard);

  const commentCard = ui().el('div', { className: 'card rapid-comment-card' });
  commentCard.appendChild(ui().renderTextarea('rapidComment', 'What did you notice?', draft.rawComment, value => {
    draft.rawComment = value;
    scheduleSave();
  }, { placeholder: 'Dictate a quick field note. It will be cleaned in the Findings Inbox before reuse.' }));
  c.appendChild(commentCard);

  const photoCard = ui().el('div', { className: 'card rapid-photo-card' });
  const photoHost = ui().renderPhoto(
    draft.photos,
    () => {
      const routing = rapidCapturePhotoRouting(draft.roomName, draft.stepName);
      draft.photos.forEach(photoItem => {
        Object.assign(photoItem, routing);
        photoItem.capturedBy = getInspectorIdentity(ctx.inspection).name;
      });
      scheduleSave();
    },
    draft.roomName,
    draft.stepName,
    ctx.inspection.inspectionId,
    { label: 'Finding photos' }
  );
  photoCard.appendChild(photoHost);
  c.appendChild(photoCard);

  async function saveRapidFinding(captureAnother) {
    const comment = String(draft.rawComment || '').trim();
    if (!comment && !draft.photos.length) {
      ui().showToast('Add a photo or comment first');
      return false;
    }
    if (!ctx.inspection.sparePhotos) ctx.inspection.sparePhotos = [];
    const existingIds = new Set(ctx.inspection.sparePhotos.map(photoItem => photoItem.photoId));
    const routing = rapidCapturePhotoRouting(draft.roomName, draft.stepName);
    draft.photos.forEach((photoItem, index) => {
      Object.assign(photoItem, routing);
      photoItem.capturedBy = getInspectorIdentity(ctx.inspection).name;
      if (comment && !photoItem.caption && index === 0) photoItem.caption = comment;
      if (!existingIds.has(photoItem.photoId)) ctx.inspection.sparePhotos.push(photoItem);
    });
    let finding = null;
    if (rapidCaptureCreatesFinding(comment)) {
      finding = createFinding(ctx.inspection, {
        roomName: draft.roomName,
        stepName: draft.stepName,
        reportSection: draft.reportSection,
        severity: draft.severity,
        rawComment: comment,
        photoIds: draft.photos.map(photoItem => photoItem.photoId),
        source: 'rapid_capture'
      });
      draft.photos.forEach(photoItem => { photoItem.findingId = finding.findingId; });
    }
    const savedRoom = draft.roomName;
    ctx.inspection.rapidCaptureDraft = null;
    await saveNow();
    const cloudSaved = await checkpointToCloud(ctx.stepList);
    const savedLabel = finding
      ? 'Finding saved to ' + (savedRoom || 'Findings Inbox')
      : (routing.routingStatus === 'needs_placement'
        ? 'Photos saved — add room and details later'
        : 'Photos saved to ' + (savedRoom || draft.stepName));
    ui().showToast(
      cloudSaved
        ? savedLabel + ' and backed up'
        : savedLabel + ' locally — cloud backup will retry'
    );
    if (captureAnother) {
      _rapidCaptureContext = { roomName: draft.roomName, stepName: draft.stepName };
      ctx.render();
    } else {
      returnFromInspectionWorkspace();
    }
    return true;
  }

  const actions = ui().el('div', { className: 'rapid-capture-actions' });
  actions.appendChild(ui().el('button', {
    className: 'btn btn-outline', onClick: async () => {
      if (draft.photos.length || String(draft.rawComment || '').trim()) await saveRapidFinding(false);
      else returnFromInspectionWorkspace();
    }
  }, '← Finish'));
  actions.appendChild(ui().el('button', {
    className: 'btn btn-primary', onClick: () => saveRapidFinding(true)
  }, 'Save Photos & Capture Another'));
  c.appendChild(actions);
  ctx.root.appendChild(c);
  window.scrollTo(0, 0);
}

// ── SMART FINDINGS INBOX ──────────────────────────────────
export function renderFindingsInbox() {
  if (!ctx.inspection) { setScreen('home'); ctx.render(); return; }
  ensureInspectionWorkspace(ctx.inspection);
  requestCompanyLibraryRefresh();
  const created = syncPhotoCommentsToFindings(ctx.inspection);

  const c = ui().el('div', { className: 'screen findings-screen' });
  c.appendChild(buildAppHeader('Smart Findings Inbox'));
  c.appendChild(ui().renderStatusBar(getLastSaveText()));
  const top = ui().el('div', { className: 'findings-toolbar' });
  top.appendChild(ui().el('button', { className: 'btn btn-outline', onClick: returnFromInspectionWorkspace }, '← Back'));
  top.appendChild(ui().el('button', {
    className: 'btn btn-primary',
    onClick: () => openInspectionWorkspace('rapid-capture', 'findings', _rapidCaptureContext)
  }, '📸 Rapid Capture'));
  c.appendChild(top);

  let findingCloudSaveTimer = null;
  async function saveFindingChangesToCloud() {
    if (findingCloudSaveTimer) {
      clearTimeout(findingCloudSaveTimer);
      findingCloudSaveTimer = null;
    }
    const savedLocally = await saveNow();
    if (!savedLocally) {
      ui().showToast('Finding could not be saved on this device');
      return false;
    }
    const cloudSaved = await checkpointToCloud(ctx.stepList);
    if (!cloudSaved) ui().showToast('Finding saved locally — cloud backup will retry');
    return cloudSaved;
  }
  function scheduleFindingCloudSave(delay) {
    scheduleSave();
    if (findingCloudSaveTimer) clearTimeout(findingCloudSaveTimer);
    findingCloudSaveTimer = setTimeout(() => {
      findingCloudSaveTimer = null;
      saveFindingChangesToCloud();
    }, Number(delay || 900));
  }
  if (created) scheduleFindingCloudSave(100);

  const counts = {
    review: ctx.inspection.findings.filter(item => item.status === 'needs_review').length,
    approved: ctx.inspection.findings.filter(item => item.status === 'approved').length,
    excluded: ctx.inspection.findings.filter(item => item.status === 'excluded').length
  };
  const summary = ui().el('div', { className: 'findings-summary' }, [
    ui().el('div', null, [ui().el('strong', null, String(counts.review)), ui().el('span', null, 'Needs review')]),
    ui().el('div', null, [ui().el('strong', null, String(counts.approved)), ui().el('span', null, 'Report ready')]),
    ui().el('div', null, [ui().el('strong', null, String(ctx.inspection.commentLibrary.length)), ui().el('span', null, 'Reusable')])
  ]);
  c.appendChild(summary);

  let activeFilter = counts.review ? 'needs_review' : 'approved';
  const tabs = ui().el('div', { className: 'findings-tabs' });
  const list = ui().el('div', { className: 'findings-list' });
  const tabDefs = [
    ['needs_review', 'Needs Review'], ['approved', 'Report Ready'], ['excluded', 'Excluded']
  ];

  function renderList() {
    summary.children[0].querySelector('strong').textContent = String(ctx.inspection.findings.filter(item => item.status === 'needs_review').length);
    summary.children[1].querySelector('strong').textContent = String(ctx.inspection.findings.filter(item => item.status === 'approved').length);
    summary.children[2].querySelector('strong').textContent = String(ctx.inspection.commentLibrary.length);
    list.innerHTML = '';
    tabs.querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.filter === activeFilter));
    const findings = ctx.inspection.findings
      .filter(item => item.status === activeFilter)
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    if (!findings.length) {
      list.appendChild(ui().el('div', { className: 'photo-review-success' }, [
        ui().el('strong', null, activeFilter === 'needs_review' ? '✓ Findings inbox is clear' : 'No findings in this section'),
        ui().el('span', null, activeFilter === 'needs_review' ? 'New photo comments and rapid captures will appear here.' : '')
      ]));
      return;
    }

    findings.forEach(finding => {
      const card = ui().el('div', { className: 'card finding-card finding-' + finding.status });
      const head = ui().el('div', { className: 'finding-card-head' }, [
        ui().el('div', null, [
          ui().el('strong', null, finding.roomName || finding.stepName || 'Unplaced finding'),
          ui().el('span', null, [finding.reportSection || finding.stepName, finding.createdBy ? 'Captured by ' + finding.createdBy : ''].filter(Boolean).join(' • '))
        ]),
        ui().el('span', { className: 'finding-severity severity-' + String(finding.severity || '').toLowerCase() }, finding.severity || 'Observation')
      ]);
      card.appendChild(head);

      if (finding.photoIds?.length) {
        const photoStrip = ui().el('div', { className: 'finding-photo-strip' });
        finding.photoIds.forEach(photoId => {
          const photoItem = findingPhotoById(photoId);
          const src = getPhotoPreviewSrc(photoItem);
          if (src) photoStrip.appendChild(ui().el('img', { src, loading: 'lazy', alt: 'Finding photo' }));
        });
        if (photoStrip.childNodes.length) card.appendChild(photoStrip);
      }

      const original = ui().el('div', { className: 'finding-original' }, [
        ui().el('span', null, 'Original inspector comment'),
        ui().el('p', null, finding.rawComment || 'Photo-only finding — add a comment below.')
      ]);
      card.appendChild(original);

      const cleanLabel = ui().el('label', { className: 'field-label' }, 'Clean report comment');
      const cleaned = ui().el('textarea', {
        className: 'field-textarea', rows: 3,
        placeholder: 'Clean the dictation, preserve the facts, and remove property-specific details before approving.'
      });
      // Start with the inspector's existing words in the editable field. The
      // source comment remains displayed above and preserved separately.
      cleaned.value = finding.cleanedComment || finding.rawComment || '';
      cleaned.addEventListener('input', () => {
        updateFinding(ctx.inspection, finding.findingId, { cleanedComment: cleaned.value, status: finding.status === 'excluded' ? 'needs_review' : finding.status });
        scheduleFindingCloudSave();
      });
      card.appendChild(cleanLabel);
      card.appendChild(cleaned);

      const controls = ui().el('div', { className: 'finding-controls' });
      const severity = ui().el('select', { className: 'field-input' });
      ['Information', 'Observation', 'Maintenance', 'Concern', 'Urgent'].forEach(value => {
        severity.appendChild(ui().el('option', { value }, value));
      });
      severity.value = finding.severity || 'Observation';
      severity.addEventListener('change', () => { updateFinding(ctx.inspection, finding.findingId, { severity: severity.value }); scheduleFindingCloudSave(250); });
      controls.appendChild(severity);
      const destination = ui().el('select', { className: 'field-input' });
      destination.appendChild(ui().el('option', { value: '' }, 'Report section / location'));
      collectPhotoDestinations().forEach((item, index) => {
        destination.appendChild(ui().el('option', { value: String(index) }, item.label));
      });
      const currentDestinationIndex = collectPhotoDestinations().findIndex(item => item.roomName === finding.roomName && item.stepName === finding.stepName);
      if (currentDestinationIndex >= 0) destination.value = String(currentDestinationIndex);
      destination.addEventListener('change', () => {
        const item = collectPhotoDestinations()[Number(destination.value)];
        if (!item) return;
        updateFinding(ctx.inspection, finding.findingId, { roomName: item.roomName, stepName: item.stepName, reportSection: item.stepName });
        scheduleFindingCloudSave(250);
      });
      controls.appendChild(destination);
      card.appendChild(controls);

      const actions = ui().el('div', { className: 'finding-actions' });
      if (finding.status !== 'approved') {
        actions.appendChild(ui().el('button', { className: 'btn btn-primary', onClick: async () => {
          // Persist the visible draft even when the reviewer approves it
          // without typing first.
          updateFinding(ctx.inspection, finding.findingId, { cleanedComment: cleaned.value });
          if (!approveFinding(ctx.inspection, finding.findingId)) { ui().showToast('Add or clean the report comment first'); return; }
          renderList();
          const cloudSaved = await saveFindingChangesToCloud();
          if (cloudSaved) ui().showToast('Finding approved and backed up');
        } }, '✓ Approve for Report'));
      } else {
        const saveReuseButton = ui().el('button', {
          className: 'btn btn-secondary', onClick: async () => {
            const saved = saveFindingToLibrary(ctx.inspection, finding.findingId);
            if (!saved) { ui().showToast('Approve a cleaned comment first'); return; }
            saved.companyStatus = 'pending_upload';
            scheduleFindingCloudSave(250);
            try {
              await submitCompanyCommentCandidate(ctx.inspection, finding, saved);
              saved.companyStatus = 'pending_review';
              saved.companySubmittedAt = new Date().toISOString();
              ui().showToast('Saved locally and sent for company approval');
            } catch (err) {
              ui().showToast('Saved locally — company submission will retry');
            }
            scheduleFindingCloudSave(250);
            ctx.render();
          }
        }, finding.reusableStatus === 'saved' ? '✓ Saved for Reuse' : 'Save Clean Comment for Reuse');
        saveReuseButton.disabled = finding.reusableStatus === 'saved';
        actions.appendChild(saveReuseButton);
      }
      if (finding.status !== 'excluded') {
        actions.appendChild(ui().el('button', { className: 'btn btn-danger-outline', onClick: async () => {
          excludeFinding(ctx.inspection, finding.findingId);
          renderList();
          const cloudSaved = await saveFindingChangesToCloud();
          if (cloudSaved) ui().showToast('Finding excluded and backed up');
        } }, 'Exclude'));
      }
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  tabDefs.forEach(([filter, label]) => {
    const button = ui().el('button', { className: 'btn btn-outline', 'data-filter': filter, onClick: () => { activeFilter = filter; renderList(); } }, label);
    tabs.appendChild(button);
  });
  c.appendChild(tabs);
  c.appendChild(list);
  renderList();
  ctx.root.appendChild(c);
  window.scrollTo(0, 0);
}

// ── MULTI-INSPECTOR TEAM WORKSPACE ───────────────────────
export function renderTeamWorkspace() {
  if (!ctx.inspection) { setScreen('home'); ctx.render(); return; }
  ensureInspectionWorkspace(ctx.inspection);
  const collaboration = ctx.inspection.collaboration;
  const identity = getInspectorIdentity(ctx.inspection);
  const identityStored = hasConfirmedInspectorIdentity(ctx.inspection) || collaboration.members.length === 1;
  const c = ui().el('div', { className: 'screen team-screen' });
  c.appendChild(buildAppHeader('Inspection Team'));
  c.appendChild(ui().renderStatusBar(getLastSaveText()));
  c.appendChild(ui().el('div', { className: 'team-toolbar' }, [
    ui().el('button', { className: 'btn btn-outline', onClick: returnFromInspectionWorkspace }, '← Back'),
    ui().el('button', { className: 'btn btn-primary', onClick: async () => {
      await saveNow();
      const ok = await checkpointToCloud(ctx.stepList);
      ui().showToast(ok ? 'Team work synced' : 'Team sync will retry');
    } }, 'Sync Team Now')
  ]));

  const identityCard = ui().el('div', { className: 'card team-identity-card' });
  identityCard.appendChild(ui().el('h2', { className: 'section-heading' }, 'Who is using this device?'));
  identityCard.appendChild(ui().el('p', { className: 'text-muted' }, 'Choose your name so every section, finding, and photo shows who captured it.'));
  const identityChoices = ui().el('div', { className: 'team-identity-choices' });
  collaboration.members.forEach(member => {
    identityChoices.appendChild(ui().el('button', {
      className: 'team-identity-btn' + (identityStored && member.memberId === identity.memberId ? ' active' : ''),
      onClick: () => { setInspectorIdentity(ctx.inspection, member.memberId); scheduleSave(); ctx.render(); }
    }, [ui().el('strong', null, member.name), ui().el('span', null, member.role || 'Inspector')]));
  });
  identityCard.appendChild(identityChoices);
  c.appendChild(identityCard);

  const activePresence = getActivePresence(ctx.inspection);
  if (activePresence.length) {
    const presenceCard = ui().el('div', { className: 'card team-presence-card' });
    presenceCard.appendChild(ui().el('h2', { className: 'section-heading' }, 'Working Now'));
    activePresence.forEach(item => {
      presenceCard.appendChild(ui().el('div', { className: 'team-presence-row' }, [
        ui().el('strong', null, item.memberName || 'Inspector'),
        ui().el('span', null, item.stepName ? 'Editing ' + item.stepName : 'Active in inspection')
      ]));
    });
    c.appendChild(presenceCard);
  }

  const membersCard = ui().el('div', { className: 'card team-members-card' });
  membersCard.appendChild(ui().el('h2', { className: 'section-heading' }, 'Inspectors'));
  const nameInput = ui().el('input', { className: 'field-input', placeholder: 'Inspector name' });
  const emailInput = ui().el('input', { className: 'field-input', type: 'email', placeholder: 'Email (optional)' });
  const addRow = ui().el('div', { className: 'team-add-row' }, [nameInput, emailInput]);
  const addButton = ui().el('button', { className: 'btn btn-secondary', onClick: () => {
    const member = addTeamMember(ctx.inspection, nameInput.value, emailInput.value, 'Inspector');
    if (!member) { ui().showToast('Enter the inspector’s name'); return; }
    scheduleSave();
    ctx.render();
  } }, '+ Add Inspector');
  membersCard.appendChild(addRow);
  membersCard.appendChild(addButton);
  const memberList = ui().el('div', { className: 'team-member-list' });
  collaboration.members.forEach((member, index) => {
    memberList.appendChild(ui().el('div', { className: 'team-member-row' }, [
      ui().el('div', null, [ui().el('strong', null, member.name), ui().el('span', null, [member.role, member.email].filter(Boolean).join(' • '))]),
      index ? ui().el('button', { className: 'btn btn-small btn-danger-outline', onClick: () => {
        if (confirm('Remove ' + member.name + ' from this inspection team?')) { removeTeamMember(ctx.inspection, member.memberId); scheduleSave(); ctx.render(); }
      } }, 'Remove') : ui().el('span', { className: 'badge prepared' }, 'Lead')
    ]));
  });
  membersCard.appendChild(memberList);
  c.appendChild(membersCard);

  if (collaboration.members.length > 1) {
    collaboration.enabled = true;
    const assignmentsCard = ui().el('div', { className: 'card team-assignments-card' });
    assignmentsCard.appendChild(ui().el('h2', { className: 'section-heading' }, 'Assign Sections'));
    assignmentsCard.appendChild(ui().el('p', { className: 'text-muted' }, 'Unassigned sections can be claimed automatically when an inspector starts entering data.'));
    PHASES.forEach(phase => {
      const steps = (ctx.stepList || []).filter(step => step.phase === phase.id && step.type !== 'review');
      if (!steps.length) return;
      const details = ui().el('details', { className: 'team-phase-group' });
      details.appendChild(ui().el('summary', null, phase.label || phase.name || phase.id));
      steps.forEach(step => {
        const assignment = getStepAssignment(ctx.inspection, step.id);
        const select = ui().el('select', { className: 'field-input' });
        select.appendChild(ui().el('option', { value: '' }, 'Unassigned'));
        collaboration.members.forEach(member => {
          select.appendChild(ui().el('option', { value: member.memberId }, member.name));
        });
        select.value = assignment?.memberId || '';
        select.addEventListener('change', () => {
          setStepAssignment(ctx.inspection, step.id, select.value, step.name);
          scheduleSave();
        });
        details.appendChild(ui().el('label', { className: 'team-assignment-row' }, [ui().el('span', null, step.name), select]));
      });
      assignmentsCard.appendChild(details);
    });
    c.appendChild(assignmentsCard);
  }

  const myAssignments = (ctx.stepList || []).filter(step => getStepAssignment(ctx.inspection, step.id)?.memberId === identity.memberId);
  const startButton = ui().el('button', { className: 'btn btn-primary btn-full team-start-btn', onClick: async () => {
    setInspectorIdentity(ctx.inspection, identity.memberId);
    const target = myAssignments.find(step => !ctx.inspection.stepData?.[step.id]?._visited) || myAssignments[0];
    if (target) ctx.currentStepIdx = Math.max(0, ctx.stepList.findIndex(step => step.id === target.id));
    await saveNow();
    const joined = await checkpointToCloud(ctx.stepList);
    if (!joined) {
      ui().showToast('Team join was not confirmed in the cloud. Stay on this screen and retry Sync Team Now.');
      return;
    }
    setScreen(_workspaceReturnScreen === 'precheck' ? 'precheck' : 'step');
    ctx.render();
    ui().showToast('Joined as ' + identity.name + ' — team sync verified');
  } }, !identityStored ? 'Select Your Name Above' : (myAssignments.length ? 'Start My ' + myAssignments.length + ' Assigned Sections' : 'Continue Inspection as ' + identity.name));
  startButton.disabled = !identityStored;
  c.appendChild(startButton);

  if (collaboration.activity.length) {
    const activityCard = ui().el('div', { className: 'card team-activity-card' });
    activityCard.appendChild(ui().el('h2', { className: 'section-heading' }, 'Recent Team Activity'));
    collaboration.activity.slice(0, 12).forEach(item => {
      activityCard.appendChild(ui().el('div', { className: 'team-activity-row' }, [
        ui().el('span', null, item.message), ui().el('time', null, formatPhotoTime(item.createdAt))
      ]));
    });
    c.appendChild(activityCard);
  }

  ctx.root.appendChild(c);
  window.scrollTo(0, 0);
}

// ── MY WORK ───────────────────────────────────────────────
export function renderMyWork() {
  if (!ctx.inspection) { setScreen('home'); ctx.render(); return; }
  ensureInspectionWorkspace(ctx.inspection);
  const identity = getInspectorIdentity(ctx.inspection);
  const c = ui().el('div', { className: 'screen my-work-screen' });
  c.appendChild(buildAppHeader('My Work'));
  c.appendChild(ui().renderStatusBar(getLastSaveText()));

  const toolbar = ui().el('div', { className: 'my-work-toolbar' }, [
    ui().el('button', { className: 'btn btn-outline', onClick: returnFromInspectionWorkspace }, '← Back'),
    ui().el('button', { className: 'btn btn-outline', onClick: () => openInspectionWorkspace('team', 'my-work') }, '👥 Team'),
    ui().el('button', { className: 'btn btn-outline', onClick: () => openInspectionWorkspace('recovery', 'my-work') }, '↶ Recovery')
  ]);
  c.appendChild(toolbar);

  const teamMode = ctx.inspection.collaboration.enabled && ctx.inspection.collaboration.members.length > 1;
  const assignedSteps = (ctx.stepList || []).filter(step =>
    step.type !== 'review' && (!teamMode || getStepAssignment(ctx.inspection, step.id)?.memberId === identity.memberId)
  );
  const incompleteAssigned = assignedSteps.filter(step => !ctx.inspection.stepData?.[step.id]?._completedAt);
  const myFindings = ctx.inspection.findings.filter(item => item.createdById === identity.memberId || item.updatedById === identity.memberId);
  const pendingFindings = myFindings.filter(item => item.status === 'needs_review');
  const photoRefs = collectInspectionPhotoRefs();
  const myUnplacedPhotos = photoRefs.filter(ref => photoRefNeedsPlacement(ref) && (!ref.photo.capturedBy || ref.photo.capturedBy === identity.name));

  c.appendChild(ui().el('div', { className: 'card my-work-summary-card' }, [
    ui().el('h2', { className: 'section-heading' }, identity.name),
    ui().el('div', { className: 'my-work-summary' }, [
      ui().el('div', null, [ui().el('strong', null, String(incompleteAssigned.length)), ui().el('span', null, 'Assigned sections open')]),
      ui().el('div', null, [ui().el('strong', null, String(pendingFindings.length)), ui().el('span', null, 'Findings to review')]),
      ui().el('div', null, [ui().el('strong', null, String(myUnplacedPhotos.length)), ui().el('span', null, 'Photos to place')])
    ])
  ]));

  const sectionsCard = ui().el('div', { className: 'card my-work-sections-card' });
  sectionsCard.appendChild(ui().el('div', { className: 'my-work-card-head' }, [
    ui().el('h2', { className: 'section-heading' }, 'My Assigned Sections'),
    ui().el('button', { className: 'btn btn-small btn-outline', onClick: () => openInspectionWorkspace('team', 'my-work') }, 'Change assignments')
  ]));
  if (!assignedSteps.length) {
    sectionsCard.appendChild(ui().el('p', { className: 'text-muted' }, 'No sections are assigned to you yet. Open Team to assign work, or begin an unassigned section to claim it automatically.'));
  } else {
    assignedSteps.forEach(step => {
      const data = ctx.inspection.stepData?.[step.id] || {};
      const issues = getStepReviewIssues(step);
      const completed = !!data._completedAt;
      sectionsCard.appendChild(ui().el('button', {
        className: 'my-work-step' + (completed ? ' complete' : '') + (issues.length ? ' has-issues' : ''),
        onClick: () => {
          const index = ctx.stepList.findIndex(item => item.id === step.id);
          if (index >= 0) goToStep(index);
        }
      }, [
        ui().el('span', null, [ui().el('strong', null, step.name), ui().el('small', null, issues.length ? issues.length + ' required item' + (issues.length === 1 ? '' : 's') + ' open' : (completed ? 'Completed' : 'Ready to inspect'))]),
        ui().el('b', null, completed && !issues.length ? '✓' : '→')
      ]));
    });
  }
  c.appendChild(sectionsCard);

  const attentionCard = ui().el('div', { className: 'card my-work-attention-card' });
  attentionCard.appendChild(ui().el('h2', { className: 'section-heading' }, 'Needs My Attention'));
  const attentionItems = [
    pendingFindings.length ? ui().el('button', { className: 'my-work-attention', onClick: () => openInspectionWorkspace('findings', 'my-work') }, '📥 Review ' + pendingFindings.length + ' finding' + (pendingFindings.length === 1 ? '' : 's')) : null,
    myUnplacedPhotos.length ? ui().el('button', { className: 'my-work-attention', onClick: () => { _photosReturnScreen = 'my-work'; setScreen('photos'); ctx.render(); } }, '📷 Place ' + myUnplacedPhotos.length + ' photo' + (myUnplacedPhotos.length === 1 ? '' : 's')) : null
  ].filter(Boolean);
  if (!attentionItems.length) attentionCard.appendChild(ui().el('div', { className: 'photo-review-success' }, [ui().el('strong', null, '✓ Your work queue is clear'), ui().el('span', null, 'Continue with your assigned inspection sections.') ]));
  else attentionItems.forEach(item => attentionCard.appendChild(item));
  c.appendChild(attentionCard);

  ctx.root.appendChild(c);
  window.scrollTo(0, 0);
}

// ── RECOVERY & AUDIT ──────────────────────────────────────
export function renderRecoveryCenter() {
  if (!ctx.inspection) { setScreen('home'); ctx.render(); return; }
  ensureInspectionWorkspace(ctx.inspection);
  const c = ui().el('div', { className: 'screen recovery-screen' });
  c.appendChild(buildAppHeader('Recovery & History'));
  c.appendChild(ui().renderStatusBar(getLastSaveText()));
  c.appendChild(ui().el('div', { className: 'recovery-toolbar' }, [
    ui().el('button', { className: 'btn btn-outline', onClick: returnFromInspectionWorkspace }, '← Back'),
    ui().el('button', { className: 'btn btn-primary', onClick: async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        await createRestorePoint('Manual restore point');
        recordAuditEvent(ctx.inspection, 'restore_point_created', 'Manual restore point created');
        await saveNow();
        ui().showToast('Restore point created');
        ctx.render();
      } finally {
        button.disabled = false;
      }
    } }, 'Create Restore Point')
  ]));

  const snapshotsCard = ui().el('div', { className: 'card recovery-snapshots-card' });
  snapshotsCard.appendChild(ui().el('h2', { className: 'section-heading' }, 'Restore Points'));
  snapshotsCard.appendChild(ui().el('p', { className: 'text-muted' }, 'The app keeps up to 25 form and organization restore points. Photo pixels remain protected separately in the photo vault.'));
  const snapshotList = ui().el('div', { className: 'recovery-list' }, 'Loading restore points…');
  snapshotsCard.appendChild(snapshotList);
  c.appendChild(snapshotsCard);

  const vaultCard = ui().el('div', { className: 'card recovery-vault-card' });
  vaultCard.appendChild(ui().el('h2', { className: 'section-heading' }, 'Local Photo Backup'));
  vaultCard.appendChild(ui().el('p', { className: 'text-muted' },
    'This is the Rescue Vault: a protected copy of photos stored on this device. Photos already attached to the inspection are labeled below. Any detached photo can be restored to the Photos screen without deleting or replacing the backup.'
  ));
  const vaultActions = ui().el('div', { className: 'recovery-vault-actions' });
  vaultActions.appendChild(ui().el('button', {
    className: 'btn btn-outline',
    onClick: async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Preparing…';
      try {
        const ok = window.exportLocalPhotoBackup ? await window.exportLocalPhotoBackup() : false;
        ui().showToast(ok ? 'Local photo backup prepared' : 'No local photo backup was available');
      } finally {
        button.disabled = false;
        button.textContent = 'Download Photo Backup';
      }
    }
  }, 'Download Photo Backup'));
  vaultCard.appendChild(vaultActions);
  const vaultList = ui().el('div', { className: 'recovery-photo-list' }, 'Checking local photo backup…');
  vaultCard.appendChild(vaultList);
  c.appendChild(vaultCard);

  const deletedCard = ui().el('div', { className: 'card recovery-deleted-card' });
  deletedCard.appendChild(ui().el('h2', { className: 'section-heading' }, 'Recently Deleted Photos'));
  deletedCard.appendChild(ui().el('p', { className: 'text-muted' }, 'Deleted photos remain recoverable on this device for 30 days unless permanently removed.'));
  const deletedList = ui().el('div', { className: 'recovery-photo-list' }, 'Checking recently deleted photos…');
  deletedCard.appendChild(deletedList);
  c.appendChild(deletedCard);

  const auditCard = ui().el('div', { className: 'card recovery-audit-card' });
  auditCard.appendChild(ui().el('h2', { className: 'section-heading' }, 'Inspection History'));
  const events = (ctx.inspection.auditTrail || []).slice(0, 80);
  if (!events.length) auditCard.appendChild(ui().el('p', { className: 'text-muted' }, 'No significant changes recorded yet.'));
  events.forEach(event => {
    auditCard.appendChild(ui().el('div', { className: 'audit-row' }, [
      ui().el('div', null, [ui().el('strong', null, event.message), ui().el('span', null, event.memberName || 'Inspector')]),
      ui().el('time', null, formatPhotoTime(event.createdAt))
    ]));
  });
  c.appendChild(auditCard);

  ctx.root.appendChild(c);
  window.scrollTo(0, 0);

  if (window.DB?.getSnapshotsForInspection) {
    window.DB.getSnapshotsForInspection(ctx.inspection.inspectionId).then(records => {
      if (getScreen() !== 'recovery') return;
      snapshotList.innerHTML = '';
      if (!records.length) {
        snapshotList.appendChild(ui().el('p', { className: 'text-muted' }, 'No restore points yet. One will be created automatically as you work.'));
        return;
      }
      records.forEach(record => {
        snapshotList.appendChild(ui().el('div', { className: 'recovery-row' }, [
          ui().el('div', null, [ui().el('strong', null, record.reason || 'Restore point'), ui().el('span', null, formatPhotoTime(record.createdAt))]),
          ui().el('button', { className: 'btn btn-small btn-outline', onClick: async () => {
            if (!confirm('Restore this version? The current version will be saved first.')) return;
            await createRestorePoint('Before restoring ' + formatPhotoTime(record.createdAt));
            const restored = JSON.parse(JSON.stringify(record.data || {}));
            restored.inspectionId = ctx.inspection.inspectionId;
            ensureInspectionWorkspace(restored);
            recordAuditEvent(restored, 'inspection_restored', 'Inspection restored to ' + formatPhotoTime(record.createdAt), { snapshotId: record.snapshotId });
            ctx.inspection = restored;
            setInspection(restored);
            ctx.stepList = buildStepList(restored);
            if (window.hydrateInspectionPhotosFromVault) {
              await window.hydrateInspectionPhotosFromVault(restored);
            }
            await window.DB.save(restored);
            ui().showToast('Previous version restored');
            ctx.render();
          } }, 'Restore')
        ]));
      });
    }).catch(() => { snapshotList.textContent = 'Restore points unavailable on this device.'; });
  }

  if (window.DB?.getPhotosForInspection) {
    window.DB.getPhotosForInspection(ctx.inspection.inspectionId).then(records => {
      if (getScreen() !== 'recovery') return;
      vaultList.innerHTML = '';
      if (!records.length) {
        vaultList.appendChild(ui().el('p', { className: 'text-muted' }, 'No photos are stored in the local backup on this device.'));
        return;
      }

      const referencedIds = new Set(collectInspectionPhotoRefs().map(ref => ref.photo.photoId));
      records
        .slice()
        .sort((a, b) => String(b.timestamp || b.updatedAt || '').localeCompare(String(a.timestamp || a.updatedAt || '')))
        .forEach(photoItem => {
          const attached = referencedIds.has(photoItem.photoId);
          const row = ui().el('div', { className: 'recovery-photo-row' });
          const preview = getPhotoPreviewSrc(photoItem);
          row.appendChild(preview
            ? ui().el('img', { src: preview, alt: photoItem.caption || 'Local backup photo' })
            : ui().el('div', { className: 'photo-review-placeholder' }, 'Photo'));
          row.appendChild(ui().el('div', null, [
            ui().el('strong', null, formatPhotoDestination(photoItem.roomName, photoItem.stepName)),
            ui().el('span', null, photoItem.caption || 'No caption'),
            ui().el('span', { className: attached ? 'vault-status-attached' : 'vault-status-detached' },
              attached ? 'Attached to inspection' : 'Needs recovery'
            )
          ]));
          const actions = ui().el('div', { className: 'recovery-photo-actions' });
          if (attached) {
            actions.appendChild(ui().el('button', {
              className: 'btn btn-small btn-outline',
              onClick: () => {
                _photosReturnScreen = 'recovery';
                setScreen('photos');
                ctx.render();
              }
            }, 'Open Photos'));
          } else {
            actions.appendChild(ui().el('button', {
              className: 'btn btn-small btn-primary',
              onClick: async event => {
                const button = event.currentTarget;
                button.disabled = true;
                if (!Array.isArray(ctx.inspection.sparePhotos)) ctx.inspection.sparePhotos = [];
                const restored = {
                  ...photoItem,
                  _vaultSaved: true,
                  deletedAt: undefined
                };
                if (!ctx.inspection.sparePhotos.some(item => item.photoId === restored.photoId)) {
                  ctx.inspection.sparePhotos.push(restored);
                }
                recordAuditEvent(ctx.inspection, 'vault_photo_restored', 'Local backup photo restored to Photos', {
                  photoId: restored.photoId,
                  roomName: restored.roomName || '',
                  stepName: restored.stepName || ''
                });
                await saveNow();
                await checkpointToCloud(ctx.stepList);
                ui().showToast('Photo restored to the Photos screen and backed up');
                ctx.render();
              }
            }, 'Restore to Photos'));
          }
          row.appendChild(actions);
          vaultList.appendChild(row);
        });
    }).catch(() => {
      vaultList.textContent = 'The local photo backup is unavailable on this device.';
    });
  }

  if (window.DB?.getDeletedPhotos) {
    window.DB.getDeletedPhotos(ctx.inspection.inspectionId).then(records => {
      if (getScreen() !== 'recovery') return;
      deletedList.innerHTML = '';
      if (!records.length) {
        deletedList.appendChild(ui().el('p', { className: 'text-muted' }, 'No deleted photos.'));
        return;
      }
      records.forEach(photoItem => {
        const row = ui().el('div', { className: 'recovery-photo-row' });
        const preview = getPhotoPreviewSrc(photoItem);
        row.appendChild(preview
          ? ui().el('img', { src: preview, alt: 'Deleted inspection photo' })
          : ui().el('div', { className: 'photo-review-placeholder' }, 'Photo'));
        row.appendChild(ui().el('div', null, [
          ui().el('strong', null, formatPhotoDestination(photoItem.roomName, photoItem.stepName)),
          ui().el('span', null, 'Deleted ' + formatPhotoTime(photoItem.deletedAt))
        ]));
        row.appendChild(ui().el('div', { className: 'recovery-photo-actions' }, [
          ui().el('button', { className: 'btn btn-small btn-primary', onClick: async () => {
            const restored = await window.DB.restoreDeletedPhoto(photoItem.photoId);
            if (!restored) return;
            if (!Array.isArray(ctx.inspection.sparePhotos)) ctx.inspection.sparePhotos = [];
            if (!ctx.inspection.sparePhotos.some(item => item.photoId === restored.photoId)) ctx.inspection.sparePhotos.push(restored);
            if (!ctx.inspection.photoTombstones) ctx.inspection.photoTombstones = {};
            ctx.inspection.photoTombstones[restored.photoId] = { status: 'restored', updatedAt: new Date().toISOString() };
            recordAuditEvent(ctx.inspection, 'photo_restored', 'Deleted photo restored', { photoId: restored.photoId, roomName: restored.roomName, stepName: restored.stepName });
            await saveNow();
            ui().showToast('Photo restored');
            ctx.render();
          } }, 'Restore'),
          ui().el('button', { className: 'btn btn-small btn-danger-outline', onClick: async () => {
            if (!confirm('Permanently delete this photo from this device? This cannot be undone.')) return;
            await window.DB.permanentlyDeletePhoto(photoItem.photoId);
            recordAuditEvent(ctx.inspection, 'photo_permanently_deleted', 'Photo permanently deleted from device recovery', { photoId: photoItem.photoId });
            await saveNow();
            ctx.render();
          } }, 'Delete forever')
        ]));
        deletedList.appendChild(row);
      });
    }).catch(() => { deletedList.textContent = 'Recently deleted photos are unavailable on this device.'; });
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
    onClick: () => { setScreen(_photosReturnScreen || 'review'); ctx.render(); }
  }, _photosReturnScreen === 'my-work'
    ? 'Back to My Work'
    : _photosReturnScreen === 'recovery'
      ? 'Back to Recovery'
      : 'Back to Review'));
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
  summaryCard.appendChild(ui().el('h3', { className: 'section-heading' }, 'Photo Organization'));
  const summaryBody = ui().el('div', { className: 'photo-health-grid' }, 'Checking...');
  summaryCard.appendChild(summaryBody);
  c.appendChild(summaryCard);

  let showAllPhotos = false;
  let photoSummaryRun = 0;
  let photoCloudSaveTimer = null;
  let pendingPhotoMetadata = null;
  async function savePhotoChangesToCloud(photo) {
    if (photoCloudSaveTimer) {
      clearTimeout(photoCloudSaveTimer);
      photoCloudSaveTimer = null;
    }
    const savedLocally = await saveNow();
    if (!savedLocally) {
      ui().showToast('Photo change could not be saved on this device');
      return false;
    }
    let metadataSaved = true;
    if (photo && photo.photoId && (photo.storagePath || photo._storedConfirmed || photo._driveConfirmed)) {
      try {
        await updatePhotoMetadata(photo, ctx.inspection.inspectionId);
      } catch (metadataErr) {
        metadataSaved = false;
        console.warn('Photo metadata cloud update failed:', metadataErr);
      }
    }
    const cloudSaved = await checkpointToCloud(ctx.stepList);
    if (!cloudSaved || !metadataSaved) ui().showToast('Photo change saved locally — cloud backup will retry');
    return cloudSaved && metadataSaved;
  }
  function schedulePhotoCloudSave(photo) {
    scheduleSave();
    pendingPhotoMetadata = photo || pendingPhotoMetadata;
    if (photoCloudSaveTimer) clearTimeout(photoCloudSaveTimer);
    photoCloudSaveTimer = setTimeout(() => {
      photoCloudSaveTimer = null;
      const pendingPhoto = pendingPhotoMetadata;
      pendingPhotoMetadata = null;
      savePhotoChangesToCloud(pendingPhoto);
    }, 900);
  }
  const listHeader = ui().el('div', { className: 'photo-review-list-header' });
  const listHeadingText = ui().el('div');
  const listHeading = ui().el('h3', { className: 'section-heading' }, 'Photos Needing Attention');
  const listHelp = ui().el('p', { className: 'photo-review-help' }, 'Only photos without a room or task appear here.');
  listHeadingText.appendChild(listHeading);
  listHeadingText.appendChild(listHelp);
  const viewAllBtn = ui().el('button', { className: 'btn btn-small btn-outline', type: 'button' }, 'View all photos');
  viewAllBtn.addEventListener('click', () => {
    showAllPhotos = !showAllPhotos;
    renderPhotoList();
  });
  listHeader.appendChild(listHeadingText);
  listHeader.appendChild(viewAllBtn);
  c.appendChild(listHeader);

  const list = ui().el('div', { className: 'photo-review-list' });
  c.appendChild(list);

  function statusPill(label, tone) {
    return ui().el('span', { className: 'photo-status-pill photo-status-' + tone }, label);
  }

  function renderPhotoSummary() {
    const runId = ++photoSummaryRun;
    const refs = collectInspectionPhotoRefs();
    const needsPlacement = refs.filter(photoRefNeedsPlacement).length;
    const commented = refs.filter(ref => String(ref.photo.caption || '').trim()).length;
    const organized = refs.length - needsPlacement;
    const suggestions = buildPhotoRoutingSuggestions(refs, collectPhotoDestinations());
    const highConfidence = suggestions.filter(item => item.suggestion.confidence === 'high').length;
    summaryBody.innerHTML = '';
    summaryBody.appendChild(statusPill(organized + ' organized automatically', organized ? 'good' : 'neutral'));
    summaryBody.appendChild(statusPill(needsPlacement + ' need placement', needsPlacement ? 'wait' : 'good'));
    summaryBody.appendChild(statusPill(commented + ' comments added', commented ? 'neutral' : 'good'));
    if (suggestions.length) summaryBody.appendChild(statusPill(suggestions.length + ' routing suggestion' + (suggestions.length === 1 ? '' : 's'), highConfidence ? 'good' : 'neutral'));

    if (!window.getPhotoHealth) {
      summaryBody.appendChild(statusPill('Cloud check unavailable', 'wait'));
      return;
    }
    window.getPhotoHealth().then(h => {
      if (runId !== photoSummaryRun) return;
      if (h.pending > 0) summaryBody.appendChild(statusPill(h.pending + ' waiting for cloud', 'wait'));
      if (h.missing > 0) summaryBody.appendChild(statusPill(h.missing + ' missing', 'bad'));
      if (h.pending === 0 && h.missing === 0) summaryBody.appendChild(statusPill('Cloud backup verified', 'good'));
    }).catch(err => {
      if (runId !== photoSummaryRun) return;
      summaryBody.appendChild(statusPill('Cloud check failed', 'bad'));
    });
  }

  async function applyPhotoDestination(ref, destination, source) {
    if (!destination) return;
    ref.photo.roomName = destination.roomName;
    ref.photo.stepName = destination.stepName;
    ref.photo.placementSource = source || 'manual_exception';
    ref.photo.routingStatus = source === 'smart_suggestion' ? 'confirmed_suggestion' : 'manual';
    ref.photo.routingSuggestion = null;
    if (window.DB?.updatePhoto && ref.photo.photoId) {
      try {
        await window.DB.updatePhoto(ref.photo.photoId, {
          roomName: destination.roomName,
          stepName: destination.stepName,
          placementSource: ref.photo.placementSource,
          routingStatus: ref.photo.routingStatus,
          routingSuggestion: null,
          updatedAt: Date.now()
        });
      } catch (vaultErr) {
        console.warn('Photo vault placement update failed:', vaultErr);
      }
    }
    recordAuditEvent(ctx.inspection, 'photo_routed', 'Photo placed in ' + destination.label, {
      photoId: ref.photo.photoId,
      roomName: destination.roomName,
      stepName: destination.stepName,
      source: ref.photo.placementSource
    });
    const cloudSaved = await savePhotoChangesToCloud(ref.photo);
    ui().showToast(
      cloudSaved
        ? 'Photo moved to ' + destination.label + ' and backed up'
        : 'Photo moved locally — cloud backup will retry'
    );
    renderPhotoSummary();
    renderPhotoList();
  }

  function addPlacementControl(body, ref) {
    if (!photoRefNeedsPlacement(ref)) return;
    const destinations = collectPhotoDestinations();
    const wrap = ui().el('label', { className: 'photo-placement-control' });
    wrap.appendChild(ui().el('span', { className: 'photo-comment-label' }, 'Move photo to room/task'));
    const select = ui().el('select', { className: 'field-input' });
    select.appendChild(ui().el('option', { value: '' }, '— Select room or task —'));
    destinations.forEach((destination, destinationIndex) => {
      select.appendChild(ui().el('option', { value: String(destinationIndex) }, destination.label));
    });
    select.addEventListener('change', async () => {
      if (select.value === '') return;
      const destination = destinations[Number(select.value)];
      if (!destination) return;
      await applyPhotoDestination(ref, destination, 'manual_exception');
    });
    wrap.appendChild(select);
    body.appendChild(wrap);
  }

  function renderPhotoCard(ref, idx) {
    const p = ref.photo;
    const hasComment = !!String(p.caption || '').trim();
    const card = ui().el('div', { className: 'photo-review-card' + (hasComment ? ' has-comment' : '') });
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

    body.appendChild(ui().el('div', {
      className: 'photo-route-chip ' + (photoRefNeedsPlacement(ref) ? 'needs-placement' : 'is-organized')
    }, photoRefNeedsPlacement(ref) ? '⚠ Needs placement' : '✓ ' + ref.destination));
    if (photoRefNeedsPlacement(ref) && p.routingSuggestion) {
      const suggestion = p.routingSuggestion;
      const suggestionBox = ui().el('div', { className: 'photo-routing-suggestion confidence-' + suggestion.confidence }, [
        ui().el('div', null, [
          ui().el('strong', null, 'Suggested: ' + suggestion.label),
          ui().el('span', null, (suggestion.confidence === 'high' ? 'High confidence' : suggestion.confidence === 'medium' ? 'Possible match' : 'Best available match') + (suggestion.reason ? ' • ' + suggestion.reason : ''))
        ]),
        ui().el('button', { className: 'btn btn-small btn-primary', onClick: () => applyPhotoDestination(ref, suggestion, 'smart_suggestion') }, 'Confirm')
      ]);
      body.appendChild(suggestionBox);
    }
    addPlacementControl(body, ref);

    const status = getPhotoStatus(p);
    const statusRow = ui().el('div', { className: 'photo-status-row' });
    statusRow.appendChild(statusPill(status.label, status.tone));
    if (p._vaultSaved) statusRow.appendChild(statusPill('Vault', 'good'));
    if (p.driveUrl || p.driveId || p.storagePath || p._driveConfirmed) statusRow.appendChild(statusPill('Cloud confirmed', 'good'));
    if (p.dataUrl && p.dataUrl !== '__uploaded__') statusRow.appendChild(statusPill('Phone copy', 'good'));
    body.appendChild(statusRow);

    const commentLabel = ui().el('div', { className: 'photo-comment-label' }, hasComment ? 'Inspector comment' : 'Add an optional comment');
    body.appendChild(commentLabel);
    const cap = ui().el('textarea', {
      className: 'photo-caption-input',
      rows: 2,
      placeholder: 'Why does this photo matter?'
    });
    cap.value = p.caption || '';
    cap.addEventListener('input', () => {
      p.caption = cap.value;
      if (window.DB && window.DB.updatePhoto && p.photoId) {
        window.DB.updatePhoto(p.photoId, { caption: p.caption, updatedAt: Date.now() });
      }
      card.classList.toggle('has-comment', !!p.caption.trim());
      commentLabel.textContent = p.caption.trim() ? 'Inspector comment' : 'Add an optional comment';
      schedulePhotoCloudSave(p);
    });
    body.appendChild(cap);

    if (p.driveUrl) {
      body.appendChild(ui().el('button', {
        className: 'btn btn-small btn-outline photo-drive-btn',
        onClick: () => window.open(p.driveUrl, '_blank')
      }, 'Open Drive'));
    }

    // Delete button per photo
    const deleteBtn = ui().el('button', {
      type: 'button',
      className: 'btn btn-danger-outline btn-small',
      style: 'margin-top:8px;width:100%;'
    }, '🗑 Delete this photo');
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Delete this photo permanently?\n\nThis cannot be undone.')) return;
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting…';
      // Remove from retry queue
      if (ctx.inspection._photoRetryQueue) {
        ctx.inspection._photoRetryQueue = ctx.inspection._photoRetryQueue.filter(q => q.photoId !== p.photoId);
      }
      // Remove from stepData arrays
      function removeFromObj(obj) {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          const i = obj.findIndex(item => item && item.photoId === p.photoId);
          if (i >= 0) { obj.splice(i, 1); return; }
          obj.forEach(removeFromObj);
        } else {
          Object.values(obj).forEach(removeFromObj);
        }
      }
      removeFromObj(ctx.inspection.stepData);
      // Remove from IndexedDB vault
      if (p.photoId && window.DB && window.DB.removePhoto) {
        try { await window.DB.removePhoto(p.photoId); } catch (e) { console.warn('vault remove failed', e); }
      }
      if (p.photoId && window.deletePhotoFromSupabase) {
        try { await window.deletePhotoFromSupabase(ctx.inspection.inspectionId, p.photoId); }
        catch (e) { console.warn('cloud photo delete failed', e); ui().showToast('Removed locally; cloud cleanup needs retry'); }
      }
      await saveNow();
      ui().showToast('Photo deleted');
      renderPhotoSummary();
      renderPhotoList();
    });
    body.appendChild(deleteBtn);

    card.appendChild(body);
    return card;
  }

  function renderPhotoList() {
    const refs = collectInspectionPhotoRefs();
    const suggestionMap = new Map(buildPhotoRoutingSuggestions(refs, collectPhotoDestinations()).map(item => [item.photoId, item.suggestion]));
    refs.forEach(ref => {
      if (photoRefNeedsPlacement(ref)) ref.photo.routingSuggestion = suggestionMap.get(ref.photo.photoId) || null;
    });
    const needsPlacement = refs.filter(photoRefNeedsPlacement);
    const visibleRefs = showAllPhotos ? refs : needsPlacement;
    list.innerHTML = '';
    listHeading.textContent = showAllPhotos ? 'All Photos' : 'Photos Needing Attention';
    listHelp.textContent = showAllPhotos
      ? 'Every photo keeps its capture location and inspector comment.'
      : 'Only photos without a room or task appear here.';
    viewAllBtn.textContent = showAllPhotos ? 'Show only exceptions' : 'View all ' + refs.length + ' photos';
    if (!refs.length) {
      list.appendChild(ui().el('div', { className: 'empty-msg' }, 'No photos yet'));
      return;
    }
    if (!visibleRefs.length) {
      list.appendChild(ui().el('div', { className: 'photo-review-success' }, [
        ui().el('strong', null, '✓ All ' + refs.length + ' photos are organized'),
        ui().el('span', null, 'You only need to open all photos if you want to review comments or make a correction.')
      ]));
      return;
    }
    visibleRefs.forEach((ref, idx) => list.appendChild(renderPhotoCard(ref, idx)));
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
    ui().el('button', { className: 'btn btn-outline btn-nav', onClick: () => { setScreen(_photosReturnScreen || 'review'); ctx.render(); } }, _photosReturnScreen === 'my-work' ? 'Back to My Work' : 'Back to Review')
  ]));

  ctx.root.appendChild(c);
  window.scrollTo(0, 0);
}

// ── REVIEW SCREEN ──────────────────────────────────────────
export function renderReview() {
  ensureInspectionWorkspace(ctx.inspection);
  const recoveredDraft = ctx.inspection.rapidCaptureDraft;
  if (recoveredDraft && (String(recoveredDraft.rawComment || '').trim() || recoveredDraft.photos?.length)) {
    if (!ctx.inspection.sparePhotos) ctx.inspection.sparePhotos = [];
    const existingPhotoIds = new Set(ctx.inspection.sparePhotos.map(photoItem => photoItem.photoId));
    const routing = rapidCapturePhotoRouting(recoveredDraft.roomName, recoveredDraft.stepName);
    (recoveredDraft.photos || []).forEach(photoItem => {
      Object.assign(photoItem, routing);
      if (!existingPhotoIds.has(photoItem.photoId)) ctx.inspection.sparePhotos.push(photoItem);
    });
    if (rapidCaptureCreatesFinding(recoveredDraft.rawComment)) {
      const recoveredFinding = createFinding(ctx.inspection, {
        roomName: recoveredDraft.roomName,
        stepName: recoveredDraft.stepName,
        reportSection: recoveredDraft.reportSection,
        severity: recoveredDraft.severity,
        rawComment: recoveredDraft.rawComment,
        photoIds: (recoveredDraft.photos || []).map(photoItem => photoItem.photoId),
        source: 'rapid_capture_recovered'
      });
      (recoveredDraft.photos || []).forEach(photoItem => { photoItem.findingId = recoveredFinding.findingId; });
    }
    ctx.inspection.rapidCaptureDraft = null;
    scheduleSave();
  }
  const importedPhotoFindings = syncPhotoCommentsToFindings(ctx.inspection);
  if (importedPhotoFindings) scheduleSave();
  const pendingFindingCount = ctx.inspection.findings.filter(item => item.status === 'needs_review').length;
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
  let photoUploadRunning = false;
  const uploadNowBtn = ui().el('button', {
    className: 'btn btn-primary',
    style: 'display:none;',
    onClick: () => runPendingPhotoUpload()
  }, 'Upload Photos Now');
  const photosBtn = ui().el('button', {
    className: 'btn btn-primary',
    onClick: () => { _photosReturnScreen = 'review'; setScreen('photos'); ctx.render(); }
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
  leaveActions.appendChild(uploadNowBtn);
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

  async function runPendingPhotoUpload() {
    if (photoUploadRunning || !window.uploadPendingInspectionPhotos) return;
    photoUploadRunning = true;
    uploadNowBtn.style.display = '';
    uploadNowBtn.disabled = true;
    uploadNowBtn.textContent = 'Starting Upload...';
    leaveStatus.className = 'leave-status leave-wait';
    leaveStatus.textContent = 'Uploading photos';
    leaveDetail.textContent = 'Keep this screen open while the remaining photos are saved to the cloud.';
    try {
      const finalHealth = await window.uploadPendingInspectionPhotos(progress => {
        if (!leaveCard.isConnected) return;
        uploadNowBtn.textContent = 'Uploading ' + progress.completed + ' of ' + progress.total;
        leaveDetail.textContent = progress.completed + ' of ' + progress.total + ' photos processed. Keep this screen open.';
      });
      if (finalHealth.pending > 0) {
        uploadNowBtn.textContent = 'Retry ' + finalHealth.pending + ' Photo' + (finalHealth.pending === 1 ? '' : 's');
      } else {
        uploadNowBtn.textContent = 'Photos Saved';
      }
    } catch (err) {
      uploadNowBtn.textContent = 'Retry Photo Upload';
      leaveDetail.textContent = 'Photo upload stopped: ' + (err && err.message ? err.message : String(err));
    } finally {
      photoUploadRunning = false;
      uploadNowBtn.disabled = false;
      if (leaveCard.isConnected) refreshLeaveStatus({ skipAutomaticUpload: true });
    }
  }

  async function refreshLeaveStatus(options) {
    const opts = options || {};
    const departureDone = depItems.every(i => !!depData[i.key]);
    const lastCloud = getBestCloudSyncAt();
    const syncStatus = getSyncStatus();
    let health = { total: 0, local: 0, cloud: 0, pending: 0, missing: 0, vaultOnly: 0 };
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
    if (health.pending > 0) warnings.push(health.pending + ' photo' + (health.pending === 1 ? '' : 's') + ' safe on this phone and still uploading');
    if ((syncStatus === 'failed' || syncStatus === 'final-failed') && lastCloud) warnings.push('Cloud retry needed');

    let tone = 'go';
    let title = 'Safe to leave';
    if (blockers.length) {
      tone = 'stop';
      title = 'Not yet';
    } else if (warnings.length) {
      tone = 'wait';
      title = health.pending > 0 ? 'Uploading photos' : 'Almost ready';
    }

    leaveStatus.className = 'leave-status leave-' + tone;
    leaveStatus.textContent = title;
    const statusDetails = blockers.concat(warnings);
    leaveDetail.textContent = statusDetails.length
      ? statusDetails.join(' | ') + (health.pending > 0 ? '. Keep this screen open.' : '')
      : 'Photos, backup, checklist, and required fields are clear.';
    if (health.pending > 0) {
      uploadNowBtn.style.display = '';
      if (!photoUploadRunning) {
        uploadNowBtn.textContent = 'Upload ' + health.pending + ' Photo' + (health.pending === 1 ? '' : 's') + ' Now';
      }
    } else {
      uploadNowBtn.style.display = 'none';
    }
    function makeMetricTappable(el, onClick) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', onClick);
      return el;
    }
    function scrollToIssues() {
      const issueCard = document.querySelector('.review-issues-card');
      if (issueCard) issueCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    leaveMetrics.innerHTML = '';
    // Photos tile → open Photos screen
    leaveMetrics.appendChild(makeMetricTappable(
      leaveMetric('Photos', health.missing ? health.missing + ' missing' : (health.pending ? health.pending + ' waiting' : health.total + ' safe'), health.missing ? 'bad' : (health.pending ? 'wait' : 'good')),
      () => { _photosReturnScreen = 'review'; setScreen('photos'); ctx.render(); }
    ));
    // Cloud tile → trigger cloud check
    leaveMetrics.appendChild(makeMetricTappable(
      leaveMetric('Cloud', getCloudLabel(), lastCloud ? ((syncStatus === 'failed' || syncStatus === 'final-failed') ? 'wait' : 'good') : 'bad'),
      async () => { const result = window.runCloudPreflight ? await window.runCloudPreflight() : { ok: false }; refreshLeaveStatus(); if (!result.ok) ui().showToast('Cloud check: ' + (result.message || 'failed')); }
    ));
    // Required tile → scroll to issues list
    const requiredMetric = leaveMetric('Required', reviewIssues.length ? reviewIssues.length + ' open' : 'Clear', reviewIssues.length ? 'bad' : 'good');
    if (reviewIssues.length) makeMetricTappable(requiredMetric, scrollToIssues);
    leaveMetrics.appendChild(requiredMetric);
    // Finding approval belongs in the desktop review portal. Pending findings
    // remain in the export but never block the inspector from leaving/submitting.
    leaveMetrics.appendChild(leaveMetric(
      'Findings',
      pendingFindingCount ? pendingFindingCount + ' for portal' : 'Ready',
      'good'
    ));
    // Before Leaving tile → go to final-checks step
    const beforeLeavingMetric = leaveMetric('Before leaving', departureDone ? 'Done' : 'Open', departureDone ? 'good' : 'bad');
    if (!departureDone) makeMetricTappable(beforeLeavingMetric, () => {
      const fcIdx = ctx.stepList.findIndex(s => s.id === 'final-checks');
      if (fcIdx >= 0) goToStep(fcIdx);
    });
    leaveMetrics.appendChild(beforeLeavingMetric);
    // Local photo backup tile → open Recovery & History where detached vault
    // photos can be inspected and restored to the inspection.
    if (health.vaultOnly > 0) leaveMetrics.appendChild(makeMetricTappable(
      leaveMetric('Local photo backup', String(health.vaultOnly) + ' to recover', 'wait'),
      () => openInspectionWorkspace('recovery', 'review')
    ));
    // Not Yet / status title → scroll to issues
    if (reviewIssues.length) {
      leaveStatus.style.cursor = 'pointer';
      leaveStatus.onclick = scrollToIssues;
      leaveDetail.style.cursor = 'pointer';
      leaveDetail.onclick = scrollToIssues;
    }
    if (health.pending > 0 && navigator.onLine && !opts.skipAutomaticUpload && leaveCard.dataset.autoUploadStarted !== 'true') {
      leaveCard.dataset.autoUploadStarted = 'true';
      runPendingPhotoUpload();
    }
  }
  refreshLeaveStatus();

  const legendBar = ui().el('div', { className: 'review-guide' });
  legendBar.innerHTML = '<strong>Status guide:</strong> Visited = opened. Not visited = skipped. Cloud-confirmed photos are backed up.';
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

  const findingReviewCard = ui().el('div', { className: 'card review-findings-card' });
  findingReviewCard.appendChild(ui().el('div', { className: 'review-findings-head' }, [
    ui().el('div', null, [
      ui().el('h3', { className: 'section-heading' }, 'Smart Findings'),
      ui().el('p', { className: 'text-muted' }, pendingFindingCount
        ? pendingFindingCount + ' finding' + (pendingFindingCount === 1 ? '' : 's') + ' will be reviewed in the desktop review portal.'
        : ctx.inspection.findings.filter(item => item.status === 'approved').length + ' findings are ready for the report builder.')
    ]),
    ui().el('button', {
      className: pendingFindingCount ? 'btn btn-primary' : 'btn btn-outline',
      onClick: () => openInspectionWorkspace('findings', 'review')
    }, pendingFindingCount ? 'Review Here (Optional)' : 'Open Findings')
  ]));
  c.appendChild(findingReviewCard);

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
    const fields = getStepFields(step);
    if (fields.length && visited) {
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
          const photoComment = String(p.caption || '').trim();
          grid.appendChild(ui().el('div', { className: 'review-photo-item' + (photoComment ? ' has-comment' : '') }, [
            ui().el('img', { src: getPhotoPreviewSrc(p), className: 'review-photo-img', loading: 'lazy' }),
            photoComment ? ui().el('div', { className: 'review-photo-caption' }, [
              ui().el('strong', null, 'Inspector comment'),
              ui().el('span', null, photoComment)
            ]) : null
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
      ctx.inspection.reviewStatus = 'Synced';
      ctx.inspection.endedAt = new Date().toISOString();
      ctx.inspection.completedAt = ctx.inspection.endedAt;
      const completeData = buildExportJSON(ctx.stepList);
      saveNow().then(async () => {
        const ok = await submitInspection(completeData, ctx.stepList);
        if (!ok) {
          submitBtn.disabled = false;
          submitBtn.textContent = '\u2713 Submit Inspection';
          return;
        }
        clearActivePosition(ctx.inspection.inspectionId);
        setScreen('home'); ctx.inspection = null; setInspection(null); ctx.stopAutoSave(); ctx.render();
      });
    }}, '\u2713 Submit Inspection');
    actCard.appendChild(submitBtn);
  } else {
    const reuploadBtn = ui().el('button', { className: 'btn btn-outline btn-full', onClick: async () => {
      reuploadBtn.disabled = true;
      reuploadBtn.textContent = 'Syncing\u2026 \u23f3';
      try {
        const reuploadData = buildExportJSON(ctx.stepList);
        const allPhotos = extractAllPhotosFromExport(reuploadData);
        const ok = await submitInspection(reuploadData, ctx.stepList);
        if (!ok) {
          throw new Error(
            (ctx.inspection && ctx.inspection._lastFinalSyncError) ||
            'Cloud storage did not confirm every photo upload.'
          );
        }
        reuploadBtn.textContent = '\u2713 Sync Complete (' + allPhotos.length + ' photos safe)';
      } catch(e) {
        reuploadBtn.disabled = false;
        reuploadBtn.textContent = '\u21ba Retry cloud sync';
        alert('Upload failed: ' + e.message);
      }
    }}, '\u21ba Retry cloud sync');
    actCard.appendChild(ui().el('div', { className: 'completed-banner' }, [
      ui().el('strong', null, '\u2713 Inspection Complete'),
      ui().el('p', null, 'Completed: ' + ui().fmtDate(ctx.inspection.endedAt)),
      reuploadBtn
    ]));
    if (window.getPhotoHealth) {
      window.getPhotoHealth().then(function(health) {
        const allConfirmed = health.total === 0 || (
          health.cloud >= health.total && health.pending === 0 && health.missing === 0
        );
        if (allConfirmed) reuploadBtn.textContent = '\u21ba Retry inspection data sync';
      }).catch(function(err) {
        console.warn('Could not verify photo status for re-upload button:', err);
      });
    }
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


  // Spare photos are routed from their capture context. Report-section choices
  // belong in the reviewer portal, not in the inspector's final checklist.
  if (ctx.inspection.sparePhotos && ctx.inspection.sparePhotos.length) {
    const spareComments = ctx.inspection.sparePhotos.filter(photo => String(photo.caption || '').trim()).length;
    c.appendChild(ui().el('div', { className: 'card auto-routed-spare-summary' }, [
      ui().el('strong', null, '✓ ' + ctx.inspection.sparePhotos.length + ' additional photo' + (ctx.inspection.sparePhotos.length === 1 ? '' : 's') + ' organized automatically'),
      ui().el('p', null, formatPhotoDestination(
        ctx.inspection.sparePhotos[0].roomName,
        ctx.inspection.sparePhotos[0].stepName
      ) + (spareComments ? ' • ' + spareComments + ' comment' + (spareComments === 1 ? '' : 's') : '')),
      ui().el('p', { className: 'text-muted' }, 'Open Photos only if you want to review comments or correct a placement.')
    ]));
  }

  ctx.root.appendChild(c);
  window.scrollTo(0, 0);
}
