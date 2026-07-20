// InHaus Inspector - Field Definition Helpers & Reusable Field Groups

// ── Field Definition Helpers ───────────────────────────────
export function text(key, label, opts) { return { key, type: 'text', label, ...opts }; }
export function textarea(key, label, opts) { return { key, type: 'textarea', label, ...opts }; }
export function num(key, label, opts) { return { key, type: 'number', label, ...opts }; }
export function date(key, label) { return { key, type: 'date', label }; }
export function timeInput(key, label) { return { key, type: 'text', label, inputType: 'time' }; }
export function dateTimeInput(key, label) { return { key, type: 'text', label, inputType: 'datetime-local' }; }
export function sel(key, label, choices, opts) { return { key, type: 'select', label, choices, ...opts }; }
export function yesno(key, label) { return { key, type: 'yesno', label }; }
export function yesnona(key, label) { return { key, type: 'yesnona', label }; }
export function radio(key, label, choices) { return { key, type: 'radio', label, choices }; }
export function check(key, label) { return { key, type: 'check', label }; }
export function checklist(key, label, items, opts) { return { key, type: 'checklist', label, items, ...opts }; }
export function chips(key, label, options) { return { key, type: 'chips', label, options }; }
export function reading(key, label, unit) { return { key, type: 'reading', label, unit }; }
export function photo(stepName, photoKey, options) {
  return { type: 'photo', stepName, photoKey, ...(options || {}) };
}
export function timer(key, label, duration, opts) { return { key, type: 'timer', label, duration, ...opts }; }
export function heading(label) { return { type: 'heading', label }; }
export function collapsible(title, fields, opts) { return { type: 'collapsible-section', title, fields, defaultOpen: opts && opts.defaultOpen !== false }; }
export function info(label) { return { type: 'info', label }; }
export function divider() { return { type: 'divider' }; }
export function link(label, url) { return { type: 'link', label, url }; }
export function showIf(field, key, value) { return { ...field, showIf: { key, value } }; }

// ── Reusable Field Groups ──────────────────────────────────
export const OBS_TAGS = [
  'Visible mold', 'Poor ventilation', 'Water staining', 'Condensation',
  'Musty odor', 'Active leak', 'Plumbing issue', 'HVAC concern',
  'Moisture concern (FLIR)', 'Other'
];

export function flirFields() {
  return [
    collapsible('FLIR Thermal Scan', [
    link('📲 Open Meterlink app', 'meterlink://'),
    link('🌡 Get FLIR photos via Meterlink', 'https://apps.apple.com/us/app/flir-one/id970376330'),
    checklist('flirGuidance', null, [
      { key: 'flirScanStains', label: 'Scan for water stains, moisture intrusion, plumbing issues' },
      { key: 'flirStartExterior', label: 'Start with areas identified during exterior inspection' },
      { key: 'flirPhotoAll', label: 'Photograph ALL areas of concern' },
      { key: 'flirPhotoNoConcern', label: 'If no concerns: photograph area where mold test conducted' }
    ]),
    yesno('flirDone', 'FLIR scan completed'),
    showIf(yesno('flirConcerns', 'Areas of concern found'), 'flirDone', 'Yes'),
    showIf(num('flirMoisture', 'Moisture reading', { unit: '%', note: 'Flag if >20%' }), 'flirDone', 'Yes'),
    showIf(info('Import FLIR photos from your photo library. Each photo is assigned to this room automatically; add a comment if needed.'), 'flirDone', 'Yes'),
    showIf({ type: 'flir-photo-log' }, 'flirDone', 'Yes')
  ], { defaultOpen: false })
  ];
}

export function flirLogFields() {
  return [
    collapsible('FLIR Thermal Scan & Photo Log', [
      checklist('flirGuidance', null, [
        { key: 'flirScanStains', label: 'Scan for water stains, moisture intrusion, plumbing issues' },
        { key: 'flirStartExterior', label: 'Start with areas identified during exterior inspection' },
        { key: 'flirPhotoAll', label: 'Photograph ALL areas of concern' },
        { key: 'flirPhotoNoConcern', label: 'If no concerns: photograph area where mold test conducted' }
      ]),
      check('flirScanned', 'Scan rooms for water stains, moisture intrusion, plumbing'),
      heading('FLIR Photos'),
      info('Import FLIR photos from your photo library. Add a comment and confirm the room for each photo.'),
      { type: 'flir-photo-log' }
    ], { defaultOpen: false })
  ];
}

export function bathroomLeakFields() {
  return [
    heading('Moisture Check'),
    check('leakUnderSink', 'Under sink checked'),
    check('leakToilet', 'Around toilet checked'),
    check('leakShowerTub', 'Baseboard around shower/tub checked'),
    check('leakGrout', 'Caulking/grout in tile checked')
  ];
}

export function breezeFields(timerKey) {
  return [
    heading('Breeze ET Mold Test'),
    link('📋 Open Priority Lab app', 'https://app.prioritylaboratory.com'),
    link('🔬 Priority Lab order portal', 'https://prioritylaboratory.com/inhaus'),
    yesno('breezeDone', 'Breeze ET test performed'),
    showIf(timer(timerKey || 'breezeTimer', 'Breeze ET Timer (10 min)', 600), 'breezeDone', 'Yes'),
    showIf(text('breezeLocation', 'Spore trap location in this room', { placeholder: 'e.g. Center of room, tripod at 60", north corner' }), 'breezeDone', 'Yes')
  ];
}

export function qtrakSection() {
  return [
    heading('Q-Trak 7585'),
    text('qtrakLocation', 'Q-Trak room / reading location', { placeholder: 'e.g. TV room (match the Q-Trak device room name)' }),
    yesno('qtrakCaptured', 'Q-Trak reading captured?')
  ];
}

export function formaldehydeField() {
  return [];
}

export function observationFields() {
  return [
    chips('observations', 'Observations', OBS_TAGS),
    textarea('notes', 'Notes', { placeholder: 'Enter observations, notes, or comments... (tap \uD83C\uDF99 mic in your iPhone keyboard, then read back and fix errors)' }),
    check('voiceReviewed', '\u2713 Voice-dictated notes reviewed and corrected'),
    divider(),
    photo('Photos', '_photos', { mergePhotoKeys: ['_beforePhotos', '_afterPhotos'] })
  ];
}

export function followUpFields(staticLabel) {
  // staticLabel: pass a string for fixed-name steps (e.g. 'Kitchen', 'Utility Room')
  // omit/null for dynamic room steps — a live label reads data.roomName instead
  const labelField = staticLabel
    ? info('\uD83D\uDCCD Follow-up for: ' + staticLabel)
    : { type: 'dynamic-room-label' };
  return [
    divider(),
    heading('Follow-Up'),
    labelField,
    yesno('followUpNeeded', 'Follow-up recommended?'),
    showIf(sel('followUpTimeframe', 'Re-check in', ['3 months', '6 months', '12 months']), 'followUpNeeded', 'Yes'),
    showIf(textarea('followUpNote', 'What to watch for', { placeholder: 'e.g. Previous leak under sink, monitor for moisture return... (tap \uD83C\uDF99 mic in keyboard, read back before saving)' }), 'followUpNeeded', 'Yes'),
    showIf(photo('Follow-Up', '_followUpPhotos'), 'followUpNeeded', 'Yes')
  ];
}

export function bathroomCheckFields() {
  return [
    heading('Bathroom Inspection'),
    check('bathUnderSink', 'Under sink checked'),
    check('bathToilet', 'Around toilet checked'),
    check('bathShower', 'Baseboard around shower/tub checked'),
    check('bathGrout', 'Caulking/grout in tile checked'),
    yesno('bathLeak', 'Leak found')
  ];
}

export function equipmentFields(key, label, withPhoto) {
  const fields = [
    heading(label),
    text(key + 'Type', 'Type'),
    text(key + 'Model', 'Model #'),
    text(key + 'Serial', 'Serial #')
  ];
  if (withPhoto !== false) fields.push(photo(label));
  return fields;
}
