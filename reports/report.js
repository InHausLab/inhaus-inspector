const REPORT_REVIEW_API_URL = 'https://script.google.com/macros/s/AKfycbxh6xtKg3FKjoHzi6jbJ_8RmjIgihgvcgeG8jGrFWweGcD3iwjV9voLVj0cmy5VeczuPw/exec';
const REPORT_BRIDGE_API_URL = 'https://script.google.com/macros/s/AKfycbxmOMfSGaz9sDHxAKBjNXtJ44MLdusXRe-GOrV6nGH0Iw0tciFg1Wkw-02hB-dQglAbgQ/exec';
const ACCESS_TOKEN_STORAGE_KEY = 'inhaus-report-access-token';

const els = {};
let knownInspections = [];
let currentInspection = null;

document.addEventListener('DOMContentLoaded', () => {
  els.form = document.getElementById('report-search-form');
  els.input = document.getElementById('inspection-id-input');
  els.accessForm = document.getElementById('access-code-form');
  els.accessInput = document.getElementById('access-code-input');
  els.picker = document.getElementById('inspection-picker');
  els.status = document.getElementById('report-status');
  els.output = document.getElementById('report-output');
  els.printBtn = document.getElementById('print-btn');

  els.form.addEventListener('submit', event => {
    event.preventDefault();
    const id = normalizeId(els.input.value);
    if (id) loadAndRender(id);
  });

  els.accessForm.addEventListener('submit', event => {
    event.preventDefault();
    const token = String(els.accessInput.value || '').trim();
    if (!token) return;
    sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
    els.accessInput.value = '';
    renderAccessState();
    bootstrap();
  });

  els.picker.addEventListener('change', () => {
    if (els.picker.value) {
      els.input.value = els.picker.value;
      loadAndRender(els.picker.value);
    }
  });

  els.printBtn.addEventListener('click', () => window.print());

  bootstrap();
});

async function bootstrap() {
  renderAccessState();
  setStatus('Loading known inspections...');
  try {
    knownInspections = await loadInspectionList();
    populatePicker(knownInspections);
    setStatus(knownInspections.length ? `${knownInspections.length} inspections available.` : 'Enter an inspection ID to load a report.');
  } catch (err) {
    populatePicker([]);
    setStatus(`Inspection list unavailable. Enter an ID manually. ${err.message}`, true);
  }

  const params = new URLSearchParams(window.location.search);
  const id = normalizeId(params.get('id') || '');
  if (id) {
    els.input.value = id;
    loadAndRender(id);
  }
}

function normalizeId(value) {
  return String(value || '').trim().toUpperCase();
}

function getAccessToken() {
  return sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) || '';
}

function renderAccessState() {
  if (!els.accessInput) return;
  els.accessInput.placeholder = getAccessToken() ? 'Access code saved for this tab' : 'Portal code';
}

async function apiFetch(endpoint, params) {
  const url = new URL(endpoint);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url.toString(), { method: 'GET', mode: 'cors' });
  if (!response.ok) throw new Error(`API ${response.status}`);
  const data = await response.json();
  if (data.status === 'error') throw new Error(data.message || 'API error');
  return data;
}

async function loadInspectionList() {
  const token = getAccessToken();
  let liveError = null;
  if (token) {
    try {
      const live = await apiFetch(REPORT_REVIEW_API_URL, { action: 'list', token });
      if (live && Array.isArray(live.inspections)) return live.inspections;
    } catch (err) {
      liveError = err;
    }
  }

  try {
    const response = await fetch('./api/list.json?t=' + Date.now());
    if (!response.ok) throw new Error('Static inspection list not found');
    const data = await response.json();
    return data.inspections || [];
  } catch (err) {
    if (liveError) throw new Error(`Live inspection list unavailable. ${liveError.message}`);
    throw new Error('Enter the current access code to load live inspections.');
  }
}

async function loadInspectionById(id) {
  const list = knownInspections.length ? knownInspections : await loadInspectionList();
  const summary = list.find(item => normalizeId(item.id || item.inspectionId) === id);
  const token = (summary && summary.reviewToken) || getAccessToken();

  if (token) {
    try {
      const live = await apiFetch(REPORT_REVIEW_API_URL, { action: 'get', id, token });
      const liveInspection = live.inspection || live;
      if (liveInspection && liveInspection.inspectionId) return liveInspection;
    } catch (err) {
      // Try the current bridge review-overlay endpoint, then static fallback below.
    }

    try {
      const review = await apiFetch(REPORT_BRIDGE_API_URL, {
        action: 'getReview',
        id,
        'x-sync-secret': token
      });
      const staticInspection = await loadStaticInspectionById(id);
      return {
        ...staticInspection,
        reviewedData: {
          ...(staticInspection.reviewedData || {}),
          ...(review.reviewedData || {})
        }
      };
    } catch (err) {
      // Static fallback below.
    }
  }

  return loadStaticInspectionById(id);
}

async function loadStaticInspectionById(id) {
  const response = await fetch(`./api/inspections/${encodeURIComponent(id)}.json?t=` + Date.now());
  if (!response.ok) throw new Error(`No inspection found for ${id}`);
  const data = await response.json();
  return data.inspection || data;
}

function populatePicker(inspections) {
  els.picker.innerHTML = '';
  if (!inspections.length) {
    els.picker.appendChild(option('', 'No static inspections found'));
    return;
  }
  els.picker.appendChild(option('', 'Select inspection...'));
  inspections.forEach(insp => {
    const id = insp.id || insp.inspectionId;
    els.picker.appendChild(option(id, `${id} - ${insp.propertyAddress || insp.clientName || 'Untitled'}`));
  });
}

function option(value, label) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  return opt;
}

async function loadAndRender(id) {
  setStatus(`Loading ${id}...`);
  els.output.innerHTML = `<div class="empty-report"><div class="loading-spinner"></div><div class="empty-report-copy">Building report...</div></div>`;
  try {
    const inspection = await loadInspectionById(id);
    currentInspection = normalizeInspection(inspection);
    renderReport(currentInspection);
    setStatus(`Loaded ${currentInspection.inspectionId}.`);
    history.replaceState(null, '', `report.html?id=${encodeURIComponent(currentInspection.inspectionId)}`);
  } catch (err) {
    currentInspection = null;
    els.output.innerHTML = `<div class="empty-report"><div class="empty-report-title">Report unavailable</div><div class="empty-report-copy">${escapeHTML(err.message)}</div></div>`;
    setStatus(err.message, true);
  }
}

function normalizeInspection(raw) {
  const insp = JSON.parse(JSON.stringify(raw || {}));
  insp.inspectionId = insp.inspectionId || insp.id || 'Unknown';
  insp.clientName = readReviewed(insp, 'clientName') || insp.clientName || '';
  insp.propertyAddress = readReviewed(insp, 'propertyAddress') || insp.propertyAddress || '';
  insp.inspectionDate = readReviewed(insp, 'inspectionDate') || insp.inspectionDate || '';
  insp.reportBuilderNotes = readReviewed(insp, 'reportBuilderNotes') || insp.reportBuilderNotes || '';
  insp.rooms = Array.isArray(insp.rooms) ? insp.rooms : [];
  insp.stepData = insp.stepData || {};
  insp.photos = Array.isArray(insp.photos) ? insp.photos : collectNestedPhotos(insp);
  return insp;
}

function readReviewed(insp, key) {
  const rd = insp.reviewedData || {};
  if (rd.summary && rd.summary[key] != null) return rd.summary[key];
  if (rd[key] != null) return rd[key];
  return '';
}

function collectNestedPhotos(insp) {
  const photos = [];
  const visit = (value, context) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, context));
      return;
    }
    if (Array.isArray(value.photos)) {
      value.photos.forEach((photo, index) => {
        photos.push({
          ...photo,
          photoId: photo.photoId || `${context || 'photo'}-${index + 1}`,
          roomName: photo.roomName || value.roomName || value.name || context || '',
          stepName: photo.stepName || value.stepName || ''
        });
      });
    }
    Object.keys(value).forEach(key => {
      if (key !== 'photos' && typeof value[key] === 'object') visit(value[key], key);
    });
  };
  visit(insp, '');
  return photos;
}

function renderReport(insp) {
  generatedSectionNumber = 5;
  const score = calculateReportScore(insp);
  const findings = buildFindings(insp);
  const actions = buildSlotItems(insp, 'actionTaken', 6, 'desc');
  const observations = buildSlotItems(insp, 'obs', 6, 'note');
  const followUps = buildSlotItems(insp, 'followUp', 5, 'note');
  const photos = getReportPhotos(insp);

  els.output.innerHTML = '';
  const doc = div('report-document');
  doc.appendChild(renderCover(insp, score));
  doc.appendChild(renderExecutiveSummary(insp, score, findings, actions, followUps));
  doc.appendChild(renderPropertySnapshot(insp));
  doc.appendChild(renderEnvironmentSection(insp));
  doc.appendChild(renderRoomFindings(insp, findings));
  doc.appendChild(renderTestingSection(insp));
  doc.appendChild(renderListSection('Actions Taken During Assessment', 'What was physically completed on-site.', actions));
  doc.appendChild(renderListSection('Assessment Observations', 'Notable conditions for report building.', observations));
  doc.appendChild(renderListSection('Recommended Follow-Up', 'Suggested client re-checks or next steps.', followUps));
  doc.appendChild(renderPhotoAppendix(photos));
  els.output.appendChild(doc);
}

function renderCover(insp, score) {
  const cover = div('report-cover');
  const left = div('');
  left.appendChild(textEl('div', 'report-kicker', 'Residential Health Assessment'));
  left.appendChild(textEl('h2', '', insp.propertyAddress || 'Untitled Property'));
  const meta = div('report-meta-grid');
  [
    ['Inspection ID', insp.inspectionId],
    ['Client', insp.clientName],
    ['Date', formatDate(insp.inspectionDate)],
    ['Inspector', insp.inspectorName],
    ['Status', insp.status || insp.reviewStatus || 'Draft'],
    ['Photos', String((insp.photos || []).length)]
  ].forEach(([label, value]) => meta.appendChild(metaItem(label, value)));
  left.appendChild(meta);
  cover.appendChild(left);

  const scoreBox = div('report-score');
  scoreBox.appendChild(textEl('div', 'score-value', String(score.value)));
  scoreBox.appendChild(textEl('div', 'score-label', 'Report Readiness'));
  scoreBox.appendChild(textEl('div', 'score-sub', score.label));
  cover.appendChild(scoreBox);
  return cover;
}

function renderExecutiveSummary(insp, score, findings, actions, followUps) {
  const section = reportSection('Executive Summary', '01');
  const grid = div('summary-grid');
  grid.appendChild(summaryTile('Client Concerns', insp.clientConcerns || 'No client concerns recorded.'));
  grid.appendChild(summaryTile('Primary Findings', summarizeFindings(findings)));
  grid.appendChild(summaryTile('Report Notes', insp.reportBuilderNotes || 'No report builder notes entered yet.'));
  section.appendChild(grid);

  const quick = div('two-column-section');
  quick.appendChild(renderMiniList('On-Site Actions', actions, 'No curated actions entered yet.'));
  quick.appendChild(renderMiniList('Follow-Up', followUps, 'No follow-up recommendations entered yet.'));
  section.appendChild(quick);
  return section;
}

function renderPropertySnapshot(insp) {
  const section = reportSection('Property Snapshot', '02');
  const grid = div('kv-grid');
  [
    ['Residence Type', insp.residenceType],
    ['Year Built', insp.yearBuilt],
    ['Square Footage', insp.squareFootage],
    ['Bedrooms', insp.numberOfBedrooms],
    ['Bathrooms', insp.numberOfBathrooms],
    ['Levels', insp.numberOfLevels],
    ['Basement', insp.basement],
    ['Carpeted Rooms', insp.carpetedRooms],
    ['Water Source', waterSource(insp)],
    ['Occupancy', insp.occupancyDuringInspection],
    ['Weather', insp.weatherConditions],
    ['Windows Open', insp.windowsOpen]
  ].forEach(([label, value]) => grid.appendChild(kvItem(label, value || 'Not recorded')));
  section.appendChild(grid);
  return section;
}

function renderEnvironmentSection(insp) {
  const section = reportSection('Systems & Environmental Conditions', '03');
  const grid = div('kv-grid');
  [
    ['Heating', insp.heating || getNested(insp, 'utilityRoom', 'heatingType')],
    ['Cooling', insp.ac || getNested(insp, 'utilityRoom', 'acType')],
    ['Ventilation', insp.ventilation || insp.ventilationReadable || getNested(insp, 'utilityRoom', 'ventilationType')],
    ['Filter Size', insp.filterSize || getNested(insp, 'utilityRoom', 'filterSize')],
    ['Filter Rating', insp.filterRating || getNested(insp, 'utilityRoom', 'filterRating')],
    ['Radon Mitigation', insp.radonMitigation || getNested(insp, 'utilityRoom', 'radonMitigationPresent')],
    ['Water Filtration', insp.waterFiltration || getNested(insp, 'utilityRoom', 'waterFiltrationPresent')],
    ['Air Filtration', insp.airFiltration || getNested(insp, 'utilityRoom', 'airFiltrationPresent')]
  ].forEach(([label, value]) => grid.appendChild(kvItem(label, value || 'Not recorded')));
  section.appendChild(grid);

  const metrics = aggregateAirMetrics(insp);
  if (metrics.length) {
    const table = tableEl(['Metric', 'Average', 'Rooms With Reading'], metrics.map(m => [m.label, m.value, m.count]));
    section.appendChild(table);
  }
  return section;
}

function renderRoomFindings(insp, findings) {
  const section = reportSection('Room-by-Room Findings', '04');
  const rooms = buildRooms(insp);
  if (!rooms.length) {
    section.appendChild(emptySection('No rooms were found in this inspection payload.'));
    return section;
  }
  const wrap = div('room-grid');
  rooms.forEach(room => {
    const card = div('room-card');
    const header = div('room-card-header');
    const titleWrap = div('');
    titleWrap.appendChild(textEl('div', 'room-title', room.name));
    titleWrap.appendChild(textEl('div', 'room-sub', [room.type, room.level].filter(Boolean).join(' / ') || 'Room'));
    header.appendChild(titleWrap);
    const badges = div('room-badges');
    if (room.flirDone) badges.appendChild(textEl('span', 'mini-badge', `FLIR ${room.flirDone}`));
    if (room.breezeDone) badges.appendChild(textEl('span', 'mini-badge', `Breeze ${room.breezeDone}`));
    if (room.flirConcerns === 'Yes' || hasConcernText(room)) badges.appendChild(textEl('span', 'mini-badge warn', 'Concern'));
    header.appendChild(badges);
    card.appendChild(header);

    const body = div('room-body');
    body.appendChild(textEl('p', '', room.notes || room.observations || room.aiSummary || 'No narrative notes recorded for this room.'));
    const metrics = roomMetricPills(room);
    if (metrics.length) {
      const strip = div('metric-strip');
      metrics.forEach(metric => strip.appendChild(textEl('span', 'metric-pill', metric)));
      body.appendChild(strip);
    }
    card.appendChild(body);
    wrap.appendChild(card);
  });
  section.appendChild(wrap);
  return section;
}

function renderTestingSection(insp) {
  const section = reportSection('Testing & Samples', '05');
  const rows = [];
  const tests = insp.testsConfirmed || {};
  [
    ['Q-Trak / Air Data', hasAirData(insp) ? 'Recorded' : 'Not recorded', 'See environmental conditions'],
    ['Breeze', tests.testBreeze ? 'Conducted' : inferTestFromRooms(insp, 'breezeDone'), insp.breezeSampleCount || ''],
    ['Radon', tests.testRadon ? 'Conducted' : valueOrNo(insp.radonSetup), getNested(insp, 'radonSetup', 'radonSerialNumber')],
    ['ATP', tests.testATP ? 'Conducted' : valueOrNo(insp.atpBefore || insp.atpAfter), [insp.atpBefore, insp.atpAfter].filter(Boolean).join(' / ')],
    ['Water Panel', tests.testWaterPanel ? 'Conducted' : valueOrNo(insp.waterSampleId), insp.waterSampleId || ''],
    ['Boulder Blue', tests.testBoulderBlue ? 'Conducted' : valueOrNo(insp.boulderBlueSampleId), insp.boulderBlueSampleId || ''],
    ['Mold Swabs', tests.testMoldSwabs ? 'Conducted' : 'Not confirmed', '']
  ].forEach(row => rows.push(row));
  section.appendChild(tableEl(['Test', 'Status', 'Sample / Notes'], rows));
  if (insp.testsNotConducted) section.appendChild(summaryTile('Tests Not Conducted', insp.testsNotConducted));
  return section;
}

function renderListSection(title, subtitle, items) {
  const section = reportSection(title, nextSectionNumber());
  section.appendChild(textEl('p', 'section-subtitle', subtitle));
  if (!items.length) {
    section.appendChild(emptySection('No curated entries have been added yet.'));
    return section;
  }
  const list = div('finding-list');
  items.forEach(item => {
    const row = div('finding-item');
    row.appendChild(textEl('div', 'finding-title', item.title));
    if (item.meta) row.appendChild(textEl('div', 'finding-meta', item.meta));
    row.appendChild(textEl('div', 'finding-copy', item.copy));
    list.appendChild(row);
  });
  section.appendChild(list);
  return section;
}

let generatedSectionNumber = 5;
function nextSectionNumber() {
  generatedSectionNumber += 1;
  return String(generatedSectionNumber).padStart(2, '0');
}

function renderPhotoAppendix(photos) {
  const section = reportSection('Photo Appendix', '09');
  if (!photos.length) {
    section.appendChild(emptySection('No report photos are available in this payload.'));
    return section;
  }
  const grid = div('photo-grid');
  photos.forEach(photo => {
    const fig = document.createElement('figure');
    fig.className = 'photo-card';
    const img = document.createElement('img');
    const candidates = photoUrls(photo);
    img.src = candidates[0];
    img.alt = photo.caption || photo.roomName || photo.photoId || 'Inspection photo';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer-when-downgrade';
    img.onerror = () => {
      const nextIndex = Number(img.dataset.candidateIndex || 0) + 1;
      if (nextIndex < candidates.length) {
        img.dataset.candidateIndex = String(nextIndex);
        img.src = candidates[nextIndex];
      } else {
        const placeholder = div('photo-placeholder');
        placeholder.textContent = 'Photo unavailable';
        img.replaceWith(placeholder);
      }
    };
    fig.appendChild(img);
    fig.appendChild(textEl('figcaption', '', [photo.roomName, photo.caption || photo.stepName].filter(Boolean).join(' - ') || photo.photoId || 'Photo'));
    grid.appendChild(fig);
  });
  section.appendChild(grid);
  return section;
}

function reportSection(title, number) {
  const section = document.createElement('section');
  section.className = 'report-section';
  const heading = div('section-heading');
  heading.appendChild(textEl('h3', '', title));
  heading.appendChild(textEl('span', '', number));
  section.appendChild(heading);
  return section;
}

function metaItem(label, value) {
  const item = div('report-meta-item');
  item.appendChild(textEl('span', '', label));
  item.appendChild(textEl('strong', '', value || 'Not recorded'));
  return item;
}

function summaryTile(label, copy) {
  const tile = div('summary-tile');
  tile.appendChild(textEl('span', '', label));
  if (String(copy || '').length < 42) tile.appendChild(textEl('strong', '', copy || 'Not recorded'));
  else tile.appendChild(textEl('p', '', copy));
  return tile;
}

function kvItem(label, value) {
  const item = div('kv-item');
  item.appendChild(textEl('span', '', label));
  item.appendChild(textEl('strong', '', value || 'Not recorded'));
  return item;
}

function renderMiniList(title, items, emptyText) {
  const wrap = div('');
  wrap.appendChild(summaryTile(title, items.length ? `${items.length} item${items.length === 1 ? '' : 's'} ready` : emptyText));
  if (items.length) {
    const list = document.createElement('ul');
    list.className = 'plain-list';
    items.slice(0, 3).forEach(item => list.appendChild(textEl('li', '', item.copy)));
    wrap.appendChild(list);
  }
  return wrap;
}

function emptySection(copy) {
  return textEl('div', 'empty-section', copy);
}

function tableEl(headers, rows) {
  const table = document.createElement('table');
  table.className = 'report-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headers.forEach(header => headRow.appendChild(textEl('th', '', header)));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');
    row.forEach(cell => tr.appendChild(textEl('td', '', cell || 'Not recorded')));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function buildRooms(insp) {
  if (insp.stepData && Object.keys(insp.stepData).length) {
    return Object.values(insp.stepData).map(step => ({
      name: step.roomName || step.name || step.stepName || step.stepId || 'Room',
      type: step.type || step.stepId || '',
      level: step.level || '',
      notes: step.notes || step.aiSummary || step.observations || '',
      observations: step.observations || '',
      flirDone: step.flirDone,
      flirConcerns: step.flirConcerns,
      breezeDone: step.breezeDone,
      raw: step
    }));
  }
  return (insp.rooms || []).map(room => ({
    name: room.roomName || room.name || room.type || 'Room',
    type: room.type || '',
    level: room.level || '',
    notes: room.notes || room.aiSummary || room.observations || room.actionsTaken || '',
    observations: room.observations || '',
    flirDone: room.flirDone,
    flirConcerns: room.flirConcerns,
    breezeDone: room.breezeDone,
    raw: room
  }));
}

function buildFindings(insp) {
  const rooms = buildRooms(insp);
  return rooms
    .filter(room => hasConcernText(room) || room.flirConcerns === 'Yes' || room.notes)
    .map(room => ({
      title: room.name,
      meta: [room.type, room.level].filter(Boolean).join(' / '),
      copy: room.notes || room.observations || 'Condition noted for review.'
    }));
}

function buildSlotItems(insp, prefix, count, copyKey) {
  const rd = insp.reviewedData || {};
  const items = [];
  for (let i = 1; i <= count; i++) {
    const title = rd[`${prefix}_${i}_title`] || labelFromPrefix(prefix, i);
    const copy = rd[`${prefix}_${i}_${copyKey}`] || rd[`${prefix}_${i}_desc`] || rd[`${prefix}_${i}_note`] || '';
    const location = rd[`${prefix}_${i}_location`] || '';
    const ids = parseIds(rd[`${prefix}_${i}_photoIds`]);
    if (copy || location || ids.length) {
      items.push({
        title,
        meta: [location, ids.length ? `${ids.length} photo${ids.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' / '),
        copy: copy || 'Photo-only entry.'
      });
    }
  }
  return items;
}

function labelFromPrefix(prefix, index) {
  if (prefix === 'actionTaken') return `Action ${index}`;
  if (prefix === 'followUp') return `Follow-up ${index}`;
  return `Observation ${index}`;
}

function parseIds(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function summarizeFindings(findings) {
  if (!findings.length) return 'No findings have been curated yet.';
  return findings.slice(0, 3).map(item => `${item.title}: ${item.copy}`).join(' ');
}

function getReportPhotos(insp) {
  const photos = insp.photos || [];
  const included = photos.filter(photo => photo.included === true);
  return (included.length ? included : photos).filter(photo => photoUrls(photo).length).slice(0, 80);
}

function photoUrls(photo) {
  const id = photo.driveId || photo.fileId;
  const urls = [];
  if (id) urls.push(`photos/${encodeURIComponent(id)}.jpg`);
  [photo.thumbnailUrl, photo.driveUrl, photo.url, photo.src].forEach(url => {
    if (url) urls.push(url);
  });
  return [...new Set(urls)];
}

function calculateReportScore(insp) {
  let value = 45;
  if (insp.propertyAddress) value += 8;
  if (insp.clientName) value += 6;
  if ((insp.rooms || []).length || (insp.stepData && Object.keys(insp.stepData).length)) value += 15;
  if ((insp.photos || []).length) value += 12;
  if (insp.reportBuilderNotes) value += 8;
  if (buildSlotItems(insp, 'obs', 6, 'note').length) value += 6;
  value = Math.min(100, value);
  const label = value >= 85 ? 'Ready for report build' : value >= 70 ? 'Usable draft' : 'Needs review data';
  return { value, label };
}

function aggregateAirMetrics(insp) {
  const fields = [
    ['qtrak_pm25', 'PM2.5'],
    ['qtrak_pm10', 'PM10'],
    ['qtrak_voc', 'TVOC'],
    ['qtrak_co', 'CO'],
    ['qtrak_co2', 'CO2'],
    ['qtrak_temp', 'Temperature'],
    ['qtrak_humidity', 'Humidity']
  ];
  const rooms = insp.rooms || [];
  return fields.map(([key, label]) => {
    const nums = rooms.map(room => parseFloat(room[key])).filter(num => !Number.isNaN(num));
    if (!nums.length) return null;
    const avg = nums.reduce((sum, num) => sum + num, 0) / nums.length;
    return { label, value: round(avg), count: String(nums.length) };
  }).filter(Boolean);
}

function roomMetricPills(room) {
  const raw = room.raw || room;
  return [
    ['PM2.5', raw.qtrak_pm25],
    ['PM10', raw.qtrak_pm10],
    ['TVOC', raw.qtrak_voc],
    ['CO2', raw.qtrak_co2],
    ['Temp', raw.qtrak_temp],
    ['Humidity', raw.qtrak_humidity],
    ['ATP Before', raw.atpPreRLU],
    ['ATP After', raw.atpPostRLU]
  ].filter(([, value]) => value != null && value !== '').map(([label, value]) => `${label}: ${value}`);
}

function hasAirData(insp) {
  return (insp.rooms || []).some(room => room.qtrak_pm25 || room.qtrak_co2 || room.qtrak_voc);
}

function inferTestFromRooms(insp, key) {
  const values = (insp.rooms || []).map(room => room[key]).filter(Boolean);
  if (values.some(value => value === 'Yes')) return 'Conducted';
  if (values.length) return 'Not confirmed';
  return 'Not recorded';
}

function valueOrNo(value) {
  return value ? 'Recorded' : 'Not recorded';
}

function hasConcernText(room) {
  const text = `${room.notes || ''} ${room.observations || ''}`.toLowerCase();
  return /(water|stain|moisture|mold|musty|concern|damage|leak|follow|hvac)/.test(text);
}

function waterSource(insp) {
  if (insp.waterSource === 'Other' && insp.waterSourceDescription) return insp.waterSourceDescription;
  return insp.waterSource;
}

function getNested(obj, key1, key2) {
  return obj && obj[key1] && obj[key1][key2];
}

function round(num) {
  return String(Math.round(num * 100) / 100);
}

function formatDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(String(value).includes('T') ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function setStatus(message, isError) {
  els.status.textContent = message || '';
  els.status.classList.toggle('error', !!isError);
}

function div(className) {
  const el = document.createElement('div');
  if (className) el.className = className;
  return el;
}

function textEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text == null || text === '' ? 'Not recorded' : String(text);
  return el;
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
