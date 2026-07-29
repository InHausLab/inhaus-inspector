// InHaus Inspector - Step Definitions & Step Logic
import { text, textarea, num, date, timeInput, dateTimeInput, sel, yesno, yesnona, radio, check, checklist, chips, reading, photo, timer, heading, collapsible, info, divider, link, showIf, flirFields, flirLogFields, bathroomLeakFields, breezeFields, qtrakSection, formaldehydeField, observationFields, followUpFields, bathroomCheckFields, equipmentFields } from './fields.js?v=212';
import { getInspection } from './state.js?v=212';

export const REQUIRED_TEST_OPTIONS = [
  'Breeze ET mold spore traps',
  'Boulder Blue allergen filter',
  'Water panel',
  'PFAS water test',
  'Microplastics water test',
  'Radon monitor',
  'ATP surface testing',
  'Mold swabs'
];

export function deriveRequiredTests(insp) {
  if (!insp || typeof insp !== 'object') return [];
  const required = new Set(Array.isArray(insp.requiredTests) ? insp.requiredTests.filter(Boolean) : []);
  const device = insp.stepData?.['device-setup'] || {};
  const water = insp.stepData?.['water-sample'] || {};

  if (device.pfasSetup === 'Yes' || water.pfasStatus === 'Requested — collect on site' || water.pfasStatus === 'Collected') {
    required.add('PFAS water test');
  }
  if (water.waterPanelPlanned === 'Requested — collect on site' || water.waterPanelCollected === 'Yes') {
    required.add('Water panel');
  }
  if (water.microplasticsStatus === 'Requested — collect on site' || water.microplasticsStatus === 'Collected') {
    required.add('Microplastics water test');
  }

  return REQUIRED_TEST_OPTIONS.filter(label => required.has(label));
}

export function getEquipmentFields() {
  return [
    info('Equipment was already verified at the truck. Complete these on-site steps before starting.'),
    link('\uD83D\uDCCB Open Technician Form', 'https://docs.google.com/forms/d/e/1FAIpQLSdHZK80pgunf4IwWNpH5qcFNRPJFyXw0yeSB4mUBbgyszP0qA/viewform?usp=header'),
    checklist('preAssessment', 'Before You Start', [
      { key: 'reviewConcerns', label: 'Review customer concerns from customer intake form' },
      { key: 'devicesCharged', label: 'All devices charged' },
      { key: 'reviewHome', label: 'Walk through home \u2014 note layout, levels, access points' },
      { key: 'corentiumRegistered', label: 'Airthings device registered to house' },
      { key: 'boulderBlueRegistered', label: 'Boulder Blue sample registered' },
      { key: 'waterTestsActivated', label: 'Water tests activated' },
      { key: 'radonPrepared', label: 'Radon test prepared' },
      { key: 'qtrakSetup', label: 'Q-Trak device set up (delete previous data, set up room templates)' }
    ])
  ];
}

// ── #3: Arrival & Setup (expanded) ─────────────────────────
export function getArrivalFields() {
  return [
    // ── DATA: always visible ────────────────────
    timeInput('assessmentStartTime', 'Assessment Start Time'),
    text('utilityRoomLevel', 'Utility Room Location \u2014 which level?'),
    divider(),

    // ── PROCESS: arrival setup ────────────────────────────
    { type: 'process-checklist', title: 'Arrival Setup', items: [
      { key: 'homeownerGreeted', label: 'Homeowner greeted (or entry instructions noted)' },
      { key: 'tarpPlaced', label: 'Tarp placed in entryway' },
      { key: 'equipmentUnloaded', label: 'Equipment unloaded from car to tarp' },
      { key: 'equipmentTidy', label: 'Equipment tidy, not blocking doorways' }
    ]},
    divider(),

    // ── PROCESS: homeowner engagement ────────────────────
    { type: 'process-checklist', title: 'Homeowner Engagement', items: [
      { key: 'reviewConcerns', label: 'Review customer concerns from intake form' },
      { key: 'askAdditional', label: 'Ask about any additional concerns or problem areas' },
      { key: 'testsExplained', label: 'Explain tests being performed today' },
      { key: 'durationExplained', label: 'Give estimate of testing duration' },
      { key: 'sedentaryAdvised', label: 'Ask homeowner to remain sedentary during testing' }
    ]},
    divider(),

    // ── WiFi quick-copy (entered at intake — no re-entry needed) ──
    { type: 'wifi-copy' },
    divider(),

    // ── PROCESS: Airthings setup ──────────────────────────
    { type: 'process-checklist', title: 'Airthings View Plus Setup', items: [
      { key: 'airthingsPaired', label: 'Paired to Airthings account' },
      { key: 'airthingsWifiConnected', label: 'Connected to home wifi' },
      { key: 'airthingsPlaced', label: 'Placed at breathing height - 3ft from vents, fans, windows, doors' }
    ]},
    divider(),

    // ── DATA + PROCESS: Boulder Blue ─────────────────────
    heading('Boulder Blue Fan'),
    { type: 'process-checklist', title: 'Boulder Blue Setup', items: [
      { key: 'filterInserted', label: 'Filter inserted into fan' },
      { key: 'fanPluggedIn', label: 'Fan plugged in at main living space with access to airflow' },
      { key: 'allergenPlacement', label: 'If allergen concerns: placed in client-requested location' }
    ]},
    text('boulderBlueSampleId', 'Boulder Blue Sample ID', { placeholder: 'e.g. B2BJC43G' }),
    { key: 'boulderBlueTestLocation', type: 'inspection-room-select', label: 'Boulder Blue Test Location' },
    timeInput('boulderBlueStartTime', 'Boulder Blue Start Time (2 hrs needed)'),
    timer('boulderBlueTimer', 'Boulder Blue Timer (2 hours)', 7200),
    divider(),

    // ── PROCESS: Q-Trak sensor test ───────────────────────
    { type: 'process-checklist', title: 'Q-Trak Sensor Test', items: [
      { key: 'qtrakSensorTest', label: 'Hold Q-Trak to alcohol wipe - confirm VOC + formaldehyde spike before starting' }
    ]},
    divider(),

    textarea('arrivalNotes', 'Notes'),
    photo('Arrival Setup')
  ];
}

export function getDeviceSetupFields() {
  return [
    heading('PFAS Water Test'),
    radio('pfasSetup', 'PFAS water test at kitchen faucet', ['Yes', 'No', 'Not requested']),
    showIf({ type: 'sample-id-scanner', dataKey: 'pfasKitNum', label: 'PFAS Kit #' }, 'pfasSetup', 'Yes'),
    showIf(photo('PFAS Kit Registration Card', '_pfasKitPhotos'), 'pfasSetup', 'Yes'),
    showIf(timer('pfasTimer', 'PFAS Drain Timer', 3600), 'pfasSetup', 'Yes'),
    showIf(info('Note: needs ~1 hour to drain'), 'pfasSetup', 'Yes'),
    { type: 'process-checklist', title: 'Device Setup Steps', items: [
      { key: 'pfasKitchenFaucet', label: 'Start draining kitchen faucet now if PFAS test requested' }
    ]},
    textarea('notes', 'Notes'),
    photo('Device Setup')
  ];
}

// ── #2: Exterior Assessment (new) ──────────────────────────
export function getExteriorFields() {
  return [
    { type: 'process-checklist', title: 'Equipment Needed', items: [
      { key: 'breezeOutdoor', label: 'Breeze ET pump + tripod' },
      { key: 'qtrakOut', label: 'Q-Trak 7585' },
      { key: 'flirExt', label: 'FLIR MR277' }
    ]},
    divider(),
    heading('Breeze ET Outdoor Control'),
    { type: 'process-checklist', title: 'Breeze ET Setup', items: [
      { key: 'pumpSetUp', label: 'Set up pump' },
      { key: 'placement', label: 'Place 6-10 ft from main entrance' },
      { key: 'tripodHeight', label: 'Set to full tripod height (60′′)' }
    ]},
    timer('breezeOutdoorTimer', 'Breeze ET Outdoor Timer (10 min)', 600),
    photo('Outdoor Spore Trap Setup', '_outdoorSporePhotos'),
    divider(),
    heading('Q-Trak Outdoor Measurement'),
    check('qtrakOutdoorDone', 'Take 1-min outdoor measurement using outdoor room template (Q-Trak has built-in timer)'),
    divider(),
    collapsible('🔍 What to Look For', [
      checklist('exteriorGuidance', null, [
        { key: 'visualInspection', label: 'Conduct visual inspection of exterior - look for signs that might indicate further investigation inside' },
        { key: 'leaksStains', label: 'Visible leaks or water stains on exterior walls' },
        { key: 'poolingWater', label: 'Pooling water or poor drainage near foundation' },
        { key: 'foundationCracks', label: 'Cracks in foundation or walls' },
        { key: 'roofDamage', label: 'Damaged or missing roof elements' },
        { key: 'gapsSeals', label: 'Gaps around windows, doors, or utility penetrations' }
      ])
    ], { defaultOpen: false }),
    divider(),
    heading('Visual Exterior Inspection'),
    info('Run during mold sample time'),
    chips('sidingTypes', 'Siding Type(s)', ['Wood', 'Brick', 'Stucco', 'Vinyl', 'Fiber Cement', 'Stone', 'Metal', 'Other (specify)']),
    text('moldTestLocations', 'Mold test locations identified'),
    collapsible('📋 Photo Checklist', [
      checklist('exteriorPhotos', null, [
        { key: 'insulationPlumbing', label: 'Insulation around plumbing lines' },
        { key: 'caulkingFlashing', label: 'Caulking and flashing' },
        { key: 'lotGrading', label: 'Lot grading' },
        { key: 'sidingType', label: 'Type of siding' },
        { key: 'ventsCondition', label: 'Vents condition' },
        { key: 'iceDamsGutters', label: 'Ice dams / gutters' },
        { key: 'roofCondition', label: 'Roof condition' },
        { key: 'weatherScreenshot', label: 'Weather app screenshot' }
      ])
    ], { defaultOpen: false }),
    textarea('exteriorNotes', 'Observations & Notes'),
    photo('Exterior Assessment')
  ];
}

// ── Radon setup (expanded for #4) ──────────────────────────
export function getRadonFields() {
  return [
    { type: 'process-checklist', title: 'Radon Monitor Placement', items: [
      { key: 'radonTripod', label: 'On tripod - 3 ft from exterior wall, 20"+ above floor, central/low-traffic area' },
      { key: 'radonWindowsClosed', label: 'Windows and doors closed' }
    ]},
    divider(),
    { type: 'process-checklist', title: 'Radon App Setup', items: [
      { key: 'radonInitialMeasurement', label: 'Select "Initial measurement" + "48-hour test with 4-hour calibration"' }
    ]},
    divider(),
    check('radonMultipleMonitors', 'Set up multiple monitors if >2,000 sq ft or different foundations'),
    text('radonLocation', 'Radon Monitor Location'),
    showIf(text('secondMonitorLocation', 'Second monitor location'), 'radonMultipleMonitors', true),
    photo('Radon Setup')
  ];
}

// ── Room test (with FLIR log + bathroom leak for #4) ───────
export function getRoomTestFields() {
  return [
    { type: 'process-checklist', title: 'Room Setup', items: [
      { key: 'labelRooms', label: 'Label rooms using Q-Trak naming convention (e.g. Bedroom 1, Bedroom 2)' }
    ]},
    text('roomName', 'Room Name', { required: true }),
    radio('roomType', 'Room Type', ['Bedroom', 'Bathroom', 'Office', 'Storage', 'Kitchen', 'Living Room', 'Other']),
    ...flirFields(),
    ...breezeFields(),
    ...qtrakSection(),
    ...formaldehydeField(),
    ...bathroomLeakFields().map(f => showIf(f, 'roomType', 'Bathroom')),
    ...observationFields(),
    ...followUpFields(),
    { type: 'ai-room-summary' }
  ];
}

// ── Utility Room (expanded for #8) ─────────────────────────
export function getUtilityFields() {
  return [
    { type: 'process-checklist', title: 'Equipment Needed', items: [
      { key: 'flirUtil', label: 'FLIR MR277' },
      { key: 'qtrakUtil', label: 'Q-Trak 7585' }
    ]},
    divider(),
    text('levelLocation', 'Level location'),
    ...flirFields(),
    divider(),
    heading('HVAC System'),
    yesno('forcedHVAC', 'Forced HVAC System present?'),
    showIf(sel('heatingType', 'Heating Source Type', ['Natural Gas Furnace', 'Electric Furnace', 'Electric Baseboard', 'Heat Pump', 'Radiant Floor Heating', 'Boiler', 'Wood Stove / Pellet Stove', 'Propane', 'Other (specify)']), 'forcedHVAC', 'Yes'),
    showIf(sel('acType', 'Air Conditioning Source Type', ['Central AC', 'Ductless Mini-Split System', 'Window AC Unit(s)', 'Portable AC Unit(s)', 'Heat Pump (Cooling Mode)', 'No Air Conditioning', 'Other (specify)']), 'forcedHVAC', 'Yes'),
    showIf(checklist('ventilationType', 'Ventilation Type', [
      { key: 'bathExhaust', label: 'Bathroom Exhaust Fan(s)' },
      { key: 'hrv', label: 'HRV (Heat Recovery Ventilator)' },
      { key: 'erv', label: 'ERV (Energy Recovery Ventilator)' },
      { key: 'ventNone', label: 'None' },
      { key: 'ventNotSure', label: 'Not sure' }
    ]), 'forcedHVAC', 'Yes'),
    showIf(divider(), 'forcedHVAC', 'Yes'),
    showIf(heading('HVAC Filter & Unit Scan'), 'forcedHVAC', 'Yes'),
    showIf({ type: 'ai-hvac-scanner' }, 'forcedHVAC', 'Yes'),
    showIf(photo('HVAC Filter', '_hvacFilterPhotos'), 'forcedHVAC', 'Yes'),
    showIf(divider(), 'forcedHVAC', 'Yes'),
    showIf(heading('HVAC Inspection'), 'forcedHVAC', 'Yes'),
    showIf({ type: 'process-checklist', title: 'HVAC Inspection Steps', items: [
      { key: 'servicePanelRemoved', label: 'Service panel removed' },
      { key: 'filtersChecked', label: 'Filters checked' }
    ]}, 'forcedHVAC', 'Yes'),
    showIf(yesno('hvacCondensation', 'Condensation noted'), 'forcedHVAC', 'Yes'),
    showIf(yesno('hvacLeaks', 'Leaks noted'), 'forcedHVAC', 'Yes'),
    showIf(text('hvacDetails', 'Notable details'), 'forcedHVAC', 'Yes'),
    showIf(photo('HVAC Inspection', '_hvacInspPhotos'), 'forcedHVAC', 'Yes'),
    divider(),
    radio('radonMitigationPresent', 'Radon mitigation system present', ['Yes - Active', 'Yes - Passive', 'No', 'Unknown', 'Other']),
    showIf(text('radonMitigationOther', 'Please specify'), 'radonMitigationPresent', 'Other'),
    showIf(text('radonMitType', 'Type / Model / Serial'), 'radonMitigationPresent', ['Yes - Active', 'Yes - Passive']),
    showIf(photo('Radon Mitigation', '_radonMitPhotos'), 'radonMitigationPresent', ['Yes - Active', 'Yes - Passive']),
    yesno('uvSystemPresent', 'UV or water disinfection system present'),
    showIf(text('uvSystemType', 'Type / Model / Serial'), 'uvSystemPresent', 'Yes'),
    showIf(photo('UV System', '_uvSystemPhotos'), 'uvSystemPresent', 'Yes'),
    yesno('otherAirPurifierPresent', 'Other air purifiers or enhanced filtration (e.g. portable units)?'),
    showIf(text('otherAirPurifierType', 'Type / Model / Serial'), 'otherAirPurifierPresent', 'Yes'),
    showIf(photo('Other Air Purifier', '_otherAirPhotos'), 'otherAirPurifierPresent', 'Yes'),
    yesno('airFiltrationPresent', 'Air filtration and/or HVAC air cleansing system present'),
    showIf(text('airFiltType', 'Type / Model / Serial'), 'airFiltrationPresent', 'Yes'),
    showIf(photo('Air Filtration', '_airFiltPhotos'), 'airFiltrationPresent', 'Yes'),
    yesno('waterFiltrationPresent', 'Water filtration system present'),
    showIf(text('waterFiltType', 'Type / Model / Serial'), 'waterFiltrationPresent', 'Yes'),
    showIf(photo('Water Filtration', '_waterFiltPhotos'), 'waterFiltrationPresent', 'Yes'),
    yesno('waterSofteningPresent', 'Water softening system present'),
    showIf(text('waterSoftType', 'Type / Model / Serial'), 'waterSofteningPresent', 'Yes'),
    showIf(photo('Water Softening', '_waterSoftPhotos'), 'waterSofteningPresent', 'Yes'),
    textarea('notes', 'General notes'),
    photo('Utility Room', '_utilityRoomPhotos'),
    ...followUpFields('Utility Room'),
    { type: 'ai-room-summary' }
  ];
}

export function getBedroomFields() {
  return [
    { type: 'process-checklist', title: 'Room Setup', items: [
      { key: 'breezeRooms', label: 'Breeze ET pump + tripod + spore traps ready' }
    ]},
    text('roomName', 'Room Name', { required: true }),
    ...flirFields(),
    ...breezeFields(),
    ...qtrakSection(),
    ...formaldehydeField(),
    divider(),
    ...observationFields(),
    ...followUpFields(),
    { type: 'ai-room-summary' }
  ];
}

export function getBathroomFields() {
  return [
    text('roomName', 'Room Name', { required: true }),
    ...flirFields(),
    ...breezeFields(),
    ...qtrakSection(),
    ...formaldehydeField(),
    ...bathroomCheckFields(),
    ...observationFields(),
    ...followUpFields(),
    { type: 'ai-room-summary' }
  ];
}

// ── Living area (with FLIR log + bathroom leak for #4) ─────
export function getLivingAreaFields() {
  return [
    { type: 'process-checklist', title: 'Room Setup', items: [
      { key: 'breezeMain', label: 'Breeze ET pump + tripod + spore traps ready' }
    ]},
    text('roomNames', 'Which specific rooms are in this Main Living Area? (e.g. Living Room, Dining Room, Office - list all rooms you tested here)', { required: true }),
    ...flirLogFields(),
    ...breezeFields(),
    ...qtrakSection(),
    ...formaldehydeField(),
    ...followUpFields(),
    ...observationFields(),
    { type: 'ai-room-summary' }
  ];
}

// ── Kitchen appliance (expanded for #5) ────────────────────
export function getKitchenApplianceFields() {
  return [
    { type: 'process-checklist', title: 'Equipment Needed', items: [
      { key: 'breezeKitchen', label: 'Breeze ET pump + tripod + spore traps' },
      { key: 'flirKitchen', label: 'FLIR MR277' },
      { key: 'qtrakKitchen', label: 'Q-Trak 7585' },
      { key: 'atpKitchen', label: 'ATP device + swabs' }
    ]},
    divider(),
    heading('Stove / Range'),
    chips('stoveType', 'Stove/Range Type (select all that apply)', ['Gas', 'Electric (Radiant)', 'Induction', 'Dual-Fuel', 'Other']),
    showIf(text('stoveTypeOther', 'Stove/Range — describe', { placeholder: 'e.g. Wood stove, pellet stove' }), 'stoveType', 'Other'),
    sel('exhaustHoodType', 'Type of cooking exhaust hood or vent', ['Under cabinet range hood', 'Over the range microwave with vent', 'Wall mount range hood', 'Ceiling mount range hood', 'Downdraft range hood', 'None', 'Other (specify)']),
    sel('exhaustVented', 'Is cooking exhaust vented to outdoors?', ['Ducted (to outside)', 'Ductless (recirculating)', 'Unknown']),
    divider(),
    heading('Kitchen Water Flush'),
    yesno('waterFlushed', 'Water flushed 5 minutes before sampling'),
    showIf(timer('flushTimer', 'Kitchen Water Flush Timer (5 min)', 300), 'waterFlushed', 'Yes'),
    divider(),
    heading('Appliance Inspection'),
    info('Take Before/After photos for each area. Mark both Checked and Cleaned separately.'),
    heading('Under Refrigerator'),
    check('fridgeChecked', 'Checked'),
    check('fridgeCleaned', 'Cleaned'),
    { type: 'remediation-photo-pair', key: 'fridge', label: 'Under Refrigerator' },
    heading('Under Dishwasher'),
    check('dishwasherChecked', 'Checked'),
    check('dishwasherCleaned', 'Cleaned'),
    { type: 'remediation-photo-pair', key: 'dishwasher', label: 'Under Dishwasher' },
    heading('Dishwasher Filter'),
    check('dishwasherFilterChecked', 'Checked'),
    check('dishwasherFilterCleaned', 'Cleaned'),
    { type: 'remediation-photo-pair', key: 'dishwasherFilter', label: 'Dishwasher Filter' },
    heading('Under Sink'),
    check('underSinkChecked', 'Checked'),
    check('underSinkCleaned', 'Cleaned'),
    yesnona('iceMakerPresent', 'Ice maker present?'),
    showIf(check('iceMakerChecked', 'Checked'), 'iceMakerPresent', 'Yes'),
    showIf(check('iceMakerCleaned', 'Cleaned'), 'iceMakerPresent', 'Yes'),
    heading('Grout / Caulking on Backsplash'),
    check('backsplashChecked', 'Checked'),
    heading('Above Stove Vent'),
    check('stoveVentChecked', 'Checked'),
    check('stoveVentCleaned', 'Cleaned'),
    { type: 'remediation-photo-pair', key: 'stoveVent', label: 'Above Stove Vent' },
    textarea('applianceFindings', 'Notable findings'),
    photo('Appliance Inspection'),
    divider(),
    heading('Overall Assessment'),
    sel('appliancesCondition', 'Overall Appliances Condition', ['Excellent - New or Recently Replaced (0-3 years)', 'Good (3-10 years)', 'Fair (10-20 years)', 'Poor (20+ years or needs replacement)']),
    divider(),
    heading('Mold Swabs'),
    yesno('moldVisible', 'Visible mold or high mold potential identified?'),
    showIf(text('moldSwabLocation1', 'Swab Sample 1 Location'), 'moldVisible', 'Yes'),
    showIf(text('moldSwabLocation2', 'Swab Sample 2 Location'), 'moldVisible', 'Yes'),
    textarea('notes', 'Notes')
  ];
}

export function getWaterSampleFields() {
  return [
    info('Label each bottle with customer last name and property address. Ensure chain of custody forms are completed for each test.'),
    textarea('officePrepNotes', 'Office preparation notes', { placeholder: 'Kit locations, pre-assigned sample IDs, and special instructions from the office.' }),
    sel('waterPanelPlanned', 'Water panel test plan', ['Requested — collect on site', 'Not requested']),
    { type: 'process-checklist', title: 'Sample Labeling', items: [
      { key: 'bottlesLabeled', label: 'Bottles labeled with client last name and property address' },
      { key: 'preMadeLabels', label: 'Pre-made labels applied (if available)' },
      { key: 'chainOfCustody', label: 'Chain of custody forms completed for each sample' }
    ]},
    divider(),
    heading('Water Panel'),
    yesno('waterPanelCollected', 'Water panel collected'),
    showIf(sel('waterSampleType', 'Water test sample type', ['Unfiltered', 'Filtered', 'Both filtered and unfiltered']), 'waterPanelCollected', 'Yes'),
    showIf({ type: 'sample-id-scanner', dataKey: 'waterSampleId', label: 'Water Panel Sample ID' }, 'waterPanelCollected', 'Yes'),
    showIf(text('waterFaucetLocation', 'Faucet location'), 'waterPanelCollected', 'Yes'),
    showIf(photo('Water Panel'), 'waterPanelCollected', 'Yes'),
    divider(),
    heading('Microplastics Test'),
    radio('microplasticsStatus', 'Microplastics test', ['Requested — collect on site', 'Collected', 'Not requested']),
    showIf({ type: 'sample-id-scanner', dataKey: 'microplasticsSampleId', label: 'Microplastics Sample ID' }, 'microplasticsStatus', 'Collected'),
    divider(),
    heading('PFAS Test'),
    info('Reminder: Collect PFAS sample from kitchen faucet (should have been draining since Device Setup)'),
    radio('pfasStatus', 'PFAS test', ['Requested — collect on site', 'Collected', 'Not requested']),
    showIf({ type: 'sample-id-scanner', dataKey: 'pfasSampleId', label: 'PFAS Sample ID' }, 'pfasStatus', 'Collected'),
    textarea('notes', 'Notes')
  ];
}

export function getAtpKitchenFields() {
  return [
    sel('atpSurface', 'Surface tested *', ['Kitchen counter', 'Kitchen sink', 'Bathroom counter', 'Bathroom sink', 'Other']),
    showIf(text('atpSurfaceOther', 'Describe surface', { placeholder: 'e.g. Laundry room sink', required: true }), 'atpSurface', 'Other'),
    { type: 'number-scanner', dataKey: 'atpPreRLU', label: 'Pre-test RLU reading', unit: 'RLU' },
    radio('atpPreStatus', 'Pre-test status (Pass if below 100 RLU, Fail if 100 or above)', ['Pass', 'Fail']),
    divider(),
    yesno('atpCleaned', 'Surface cleaned with soap and water'),
    { type: 'number-scanner', dataKey: 'atpPostRLU', label: 'Post-test RLU reading', unit: 'RLU' },
    radio('atpPostStatus', 'Post-test status (Pass if below 100 RLU, Fail if 100 or more)', ['Pass', 'Fail']),
    textarea('notes', 'Notes')
  ];
}

export function getKitchenAirFields() {
  return [
    ...flirFields(),
    ...breezeFields('kitchenBreezeTimer'),
    ...qtrakSection(),
    ...formaldehydeField(),
    ...observationFields(),
    ...followUpFields('Kitchen'),
    { type: 'ai-room-summary' }
  ];
}

export function getAdditionalRoomFields() {
  return [
    text('roomName', 'Room Name', { required: true }),
    ...flirFields(),
    ...breezeFields(),
    ...qtrakSection(),
    ...formaldehydeField(),
    ...observationFields(),
    ...followUpFields(),
    { type: 'ai-room-summary' }
  ];
}

// ── Property Details (moved near end) ─────────────────────
export function getPropertyDetailsFields() {
  return [
    heading('Property Details'),
    sel('residenceType', 'Residence Type', ['Single-Family Home', 'Townhome', 'Condo', 'Duplex', 'Apartment', 'Other']),
    showIf(text('residenceTypeOther', 'Residence Type — describe', { placeholder: 'e.g. Multi-family home, mobile home' }), 'residenceType', 'Other'),
    num('yearBuilt', 'Year Home Was Built'),
    text('squareFootage', 'Approximate Square Footage'),
    sel('basement', 'Basement', ['Yes - Finished', 'Yes - Unfinished', 'No', 'Partial']),
    divider(),
    heading('Property Details (Observed)'),
    sel('carpetedRooms', 'Number of Carpeted Rooms', ['0', '1', '2', '3', '4', '5', '6+']),
    yesno('fireplacePresent', 'Fireplace(s) in home?'),
    showIf(chips('fireplace', 'Fireplace type(s)', ['Wood Burning', 'Gas', 'Electric']), 'fireplacePresent', 'Yes'),
    showIf(num('fireplaceCount', 'How many fireplaces?'), 'fireplacePresent', 'Yes'),
    chips('pets', 'Pets in Home (select all that apply)', ['No pets', 'Dog', 'Cat', 'Bird(s)', 'Fish', 'Reptile(s)', 'Other']),
    showIf(text('petsOther', 'Pet type — describe', { placeholder: 'e.g. guinea pig, rabbit, hamster' }), 'pets', 'Other'),
    sel('smokingVaping', 'Smoking or Vaping in Home', ['No', 'Yes - Indoors', 'Yes - Outdoors Only']),
    divider(),
    heading('Assessment Conditions'),
    sel('windowsOpen', 'Windows open during assessment', ['No', 'Yes', 'Some']),
    radio('occupancyDuringInspection', 'Home occupancy during inspection', ['Occupied - Active', 'Occupied - Passive', 'Unoccupied']),
    showIf(textarea('occupancyActivities', 'Describe occupant activities (e.g. cooking, cleaning, watching TV)', { placeholder: 'e.g. Owner was cooking in kitchen during assessment' }), 'occupancyDuringInspection', 'Occupied - Active'),
    showIf(textarea('occupancyActivities', 'Describe occupant activities', { placeholder: 'e.g. Owner present but resting in bedroom' }), 'occupancyDuringInspection', 'Occupied - Passive'),
    text('weatherConditions', 'Weather conditions'),
    text('particulateMatter', 'Particulate matter (PM2.5 / PM10)'),
    { type: 'weather-link' }
  ];
}

// ── #6: Before Leaving (expanded) ──────────────────────────
export function getFinalChecksFields() {
  return [
    { type: 'process-checklist', title: 'Final Checks Before Leaving', items: [
      { key: 'breezeCollected', label: 'All Breeze ET tests collected and spore traps packed' },
      { key: 'boulderBlueDone', label: 'Boulder Blue fan run 2+ hours - filter collected and packed' },
      { key: 'pfasCollected', label: 'PFAS test collected from kitchen sink' },
      { key: 'waterLabeled', label: 'Water samples labeled and ready to ship' },
      { key: 'appliancesRestored', label: 'All appliances returned to original state' },
      { key: 'doorsLightsRestored', label: 'All doors/lights returned to original state' },
      { key: 'radonLeftInPlace', label: 'Radon monitor left in place' },
      { key: 'formComplete', label: 'Technician form fully completed' },
      { key: 'photosUploaded', label: 'All photos uploaded/captured' },
      { key: 'boulderBlueRegistered', label: 'Boulder Blue filter registered on Jonah Ventures portal' }
    ]},
  ];
}

export function getDebriefFields() {
  return [
    heading('Boulder Blue Completion'),
    info('Confirm Boulder Blue fan has run 2+ hours before stopping it.'),
    timeInput('boulderBlueEndTime', 'Boulder Blue End Time'),
    { type: 'boulder-blue-duration' },
    divider(),
    timeInput('assessmentEndTime', 'Assessment End Time'),
    divider(),
    { type: 'process-checklist', title: 'Customer Debrief Steps', items: [
      { key: 'informComplete', label: 'Inform customer assessment is complete' },
      { key: 'adviseReport', label: 'Advise report in approximately 3 weeks' },
      { key: 'remindRadon', label: 'Remind homeowner about radon monitor pickup' }
    ]},
    info('Radon pickup auto-set to 54 hrs after inspection start \u2014 override below if needed'),
    dateTimeInput('radonPickupTime', 'Radon Pickup Date/Time'),

    divider(),
    link('📋 Open Technician Form', 'https://docs.google.com/forms/d/e/1FAIpQLSdHZK80pgunf4IwWNpH5qcFNRPJFyXw0yeSB4mUBbgyszP0qA/viewform?usp=header'),
    divider(),
    yesno('debriefCompleted', 'Debrief completed'),
    yesno('radonPickupReminder', 'Homeowner reminded about radon pickup'),
    yesno('reportDateCommunicated', 'Expected report date communicated'),
    textarea('debriefNotes', 'Notes from debrief')
  ];
}

function trackingNumberScanner(dataKey) {
  return {
    type: 'sample-id-scanner',
    dataKey,
    label: 'Tracking number',
    scanLabel: 'Scan tracking label',
    confirmLabel: 'Confirm tracking number \u2014 correct if needed',
    placeholder: 'Enter tracking number',
    prompt: 'Read the shipping tracking number printed on this label. Preserve every letter and digit exactly. Return JSON with one key: sampleId (string). Return ONLY the JSON object. If unreadable, return {"sampleId": null}.'
  };
}

// ── #7: Post-Assessment (new) ──────────────────────────────
export function getPostAssessmentFields() {
  return [
    heading('Sample Shipping'),
    checklist('shipping', 'Shipping Checklist', [
      { key: 'breezeST', label: 'Breeze ST spore traps \u2014 packed for FedEx overnight', subFields: [trackingNumberScanner('breezeTracking')] },
      { key: 'boulderBlueShip', label: 'Boulder Blue filter \u2014 packed for UPS to Jonah Ventures, 5485 Conestoga Ct #210, Boulder CO 80301', subFields: [trackingNumberScanner('boulderBlueTracking')] },
      { key: 'waterPanelShip', label: 'Water panel \u2014 prepaid label + package sent', subFields: [trackingNumberScanner('waterTracking')] },
      { key: 'pfasShip', label: 'PFAS (Cyclopure) \u2014 prepaid label + package sent', subFields: [trackingNumberScanner('pfasTracking')] },
      { key: 'microplasticsShip', label: 'Microplastics (Brooks Applied Labs) \u2014 packaged and shipped', subFields: [trackingNumberScanner('microTracking')] },
      { key: 'chainOfCustody', label: 'Chain of custody forms completed (SafeHome, Cyclopure, Brooks Applied Labs, Priority Lab)' }
    ]),
    divider(),
    heading('Data Management'),
    checklist('dataManagement', null, [
      { key: 'qtrakExported', label: 'Q-Trak data downloaded locally and exported to spreadsheet' }
    ]),
    divider(),
    heading('Q-Trak Data'),
    info('Upload the CSV exported from the Q-Trak device after the inspection'),
    { type: 'qtrak-upload' },
    divider(),
    heading('Final Check'),
    checklist('finalCheck', null, [
      { key: 'allSectionsComplete', label: 'All form sections completed' },
      { key: 'allPhotosUploaded', label: 'All photos uploaded' },
      { key: 'allSamplesShipped', label: 'All samples shipped' },
      { key: 'assessmentComplete', label: 'Assessment marked Complete' }
    ]),
    divider(),
    heading('Test Locations Summary'),
    info('Confirm exactly where each test was taken - this context appears in lab submissions and the report.'),
    text('postTestLocWater', 'Water tap location (water panel)', { placeholder: 'e.g. Kitchen faucet - cold side, first floor' }),
    text('postTestLocPFAS', 'PFAS water test tap location', { placeholder: 'e.g. Kitchen faucet (same as water panel)' }),
    text('postTestLocBoulderBlue', 'Boulder Blue allergen filter location', { placeholder: 'e.g. Main living room, center of room on tripod' }),
    text('postTestLocBreeze', 'Breeze ET spore trap locations (all rooms tested)', { placeholder: 'e.g. Bedroom 1 center, Basement NW corner, Living Room center' }),
    text('postTestLocRadon', 'Radon monitor location', { placeholder: 'e.g. Basement, 3ft from exterior wall, tripod at 24", center area' }),
    text('postTestLocQtrak', 'Q-Trak rooms measured', { placeholder: 'e.g. Outdoor control + all indoor rooms, desk height' }),
    text('postTestLocMold', 'Mold swab locations (if any)', { placeholder: 'e.g. N/A - no visible mold, or: Basement wall corner, Under kitchen sink' }),
    text('postTestLocAllergen', 'Allergen swab locations (if any)', { placeholder: 'e.g. N/A, or: Master bedroom mattress edge' })
  ];
}

// ── Step Type → Fields Mapping ─────────────────────────────
export const STEP_FIELDS = {
  'equipment': getEquipmentFields,
  'arrival': getArrivalFields,
  'device-setup': getDeviceSetupFields,
  'exterior': getExteriorFields,
  'radon': getRadonFields,
  'room-test': getRoomTestFields,
  'utility': getUtilityFields,
  'bedroom': getBedroomFields,
  'bathroom': getBathroomFields,
  'living-area': getLivingAreaFields,
  'kitchen-appliance': getKitchenApplianceFields,
  'water-sample': getWaterSampleFields,
  'atp-kitchen': getAtpKitchenFields,
  'kitchen-air': getKitchenAirFields,
  'additional-room': getAdditionalRoomFields,
  'final-checks': getFinalChecksFields,
  'debrief': getDebriefFields,
  'property-details': getPropertyDetailsFields,
  'post-assessment': getPostAssessmentFields
};

// Return the fields that actually belong to this specific step instance.
// The first Radon/lower-level room uses its stable default name, so its old required
// Room Name field must stay absent everywhere: entry, search, review, and
// validation. Saved legacy roomName data remains untouched.
export function getStepFields(stepDef) {
  const fieldGen = STEP_FIELDS[stepDef?.type];
  if (!fieldGen) return [];
  const fields = fieldGen();
  if (stepDef?.dynamic === 'lowest' && stepDef?.index === 0) {
    return fields.filter(field => !(field && field.key === 'roomName'));
  }
  return fields;
}

// ── Phases ─────────────────────────────────────────────────
export const PHASES = [
  { id: 'setup', name: 'Setup', icon: '1' },
  { id: 'arrival', name: 'Arrival', icon: '2' },
  { id: 'exterior', name: 'Exterior', icon: '3' },
  { id: 'lowest', name: 'Radon', icon: '4' },
  { id: 'utility', name: 'Utility', icon: '5' },
  { id: 'upper', name: 'Bed Rm', icon: '6' },
  { id: 'rooms', name: 'Bath Rm', icon: '6.5' },
  { id: 'main', name: 'Kitchen', icon: '7' },
  { id: 'supplementary', name: 'Additional Rooms', icon: '8' },
  { id: 'wrapup', name: 'Customer Debrief', icon: '9' },
  { id: 'propdetails', name: 'Property Details', icon: '10' },
  { id: 'post', name: 'Post', icon: '11' },
  { id: 'review', name: 'Review', icon: '\u2713' }
];

// ── Bedroom / Bathroom Relationships ───────────────────────
// Bathroom relationships live outside stepData so room answers and photos keep
// their long-standing step IDs. This lets old inspections load unchanged while
// new inspections can describe ensuite, shared, and standalone bathrooms.
export function ensureRoomRelationships(insp) {
  if (!insp || typeof insp !== 'object') return {};
  if (!insp.roomRelationships || typeof insp.roomRelationships !== 'object') {
    insp.roomRelationships = {};
  }
  if (!insp.roomRelationships.bathrooms || typeof insp.roomRelationships.bathrooms !== 'object') {
    insp.roomRelationships.bathrooms = {};
  }
  return insp.roomRelationships.bathrooms;
}

function legacyAdditionalKind(room, data) {
  const explicit = String(room?.roomType || room?.kind || '').toLowerCase();
  if (explicit === 'bedroom' || explicit === 'bathroom') return explicit;
  const name = String(data?.roomName || room?.name || '').trim();
  if (/^bed\s*room\b/i.test(name)) return 'bedroom';
  if (/^bath\s*room\b/i.test(name)) return 'bathroom';
  return 'additional';
}

function linkedBathroomName(relationship, bedroomSteps, insp) {
  const linkedIds = Array.isArray(relationship?.linkedBedroomIds)
    ? relationship.linkedBedroomIds.filter(Boolean)
    : [];
  const names = linkedIds.map(id => {
    const bedroom = bedroomSteps.find(step => step.id === id);
    if (!bedroom) return '';
    return String(insp.stepData?.[id]?.roomName || bedroom.name || '').trim();
  }).filter(Boolean);
  if (!names.length) return '';
  if (relationship.bathroomType === 'shared' || names.length > 1) {
    return names.join(' + ') + ' \u2014 Shared Bathroom';
  }
  return names[0] + ' \u2014 Bathroom';
}

function applyBathroomName(insp, step, bedroomSteps, relationships) {
  const relationship = relationships[step.id];
  if (!relationship || relationship.autoName === false) {
    return insp.stepData?.[step.id]?.roomName || step.name;
  }
  const automaticName = linkedBathroomName(relationship, bedroomSteps, insp);
  if (!automaticName) return insp.stepData?.[step.id]?.roomName || step.name;
  if (!insp.stepData) insp.stepData = {};
  if (!insp.stepData[step.id]) insp.stepData[step.id] = { _stepId: step.id };
  insp.stepData[step.id].roomName = automaticName;
  relationship.lastAutoName = automaticName;
  return automaticName;
}

// ── Build Step List ────────────────────────────────────────
export function buildStepList(insp) {
  const steps = [];
  const relationships = ensureRoomRelationships(insp);
  const additionalRooms = (insp.dynamicRooms && insp.dynamicRooms.additional) || [];
  const legacyBedrooms = [];
  const legacyBathrooms = [];
  const supplementaryRooms = [];
  additionalRooms.forEach((room, index) => {
    const id = 'additional-' + index;
    const kind = legacyAdditionalKind(room, insp.stepData && insp.stepData[id]);
    const entry = { room, index, id };
    if (kind === 'bedroom') legacyBedrooms.push(entry);
    else if (kind === 'bathroom') legacyBathrooms.push(entry);
    else supplementaryRooms.push(entry);
  });

  // Setup
  steps.push({ id: 'equipment', type: 'equipment', phase: 'setup', name: 'Pre-Assessment Checklist' });

  // Arrival
  steps.push({ id: 'arrival', type: 'arrival', phase: 'arrival', name: 'Arrival & Setup' });
  steps.push({ id: 'device-setup', type: 'device-setup', phase: 'arrival', name: 'Device Setup' });

  // Exterior Assessment (#2)
  steps.push({ id: 'exterior', type: 'exterior', phase: 'exterior', name: 'Exterior Assessment' });

  // Radon / lower-level room context
  steps.push({ id: 'radon', type: 'radon', phase: 'lowest', name: 'Radon Monitor Setup' });
  const lowestRooms = (insp.dynamicRooms && insp.dynamicRooms.lowest) || [{ name: 'Radon - Room 1' }];
  lowestRooms.forEach((r, i) => {
    steps.push({ id: 'lowest-room-' + i, type: 'room-test', phase: 'lowest', name: r.name, dynamic: 'lowest', index: i });
  });

  // Bedrooms are their own report/navigation group. Existing fixed bedroom IDs
  // are deliberately unchanged for backwards compatibility.
  const numBed = parseInt(insp.numberOfBedrooms) || 1;
  for (let i = 0; i < numBed; i++) {
    const id = 'bedroom-' + i;
    steps.push({ id, type: 'bedroom', phase: 'upper', name: insp.stepData?.[id]?.roomName || 'Bedroom ' + (i + 1), index: i, roomCategory: 'bedroom' });
  }
  legacyBedrooms.forEach(({ room, index, id }) => {
    steps.push({ id, type: 'bedroom', phase: 'upper', name: insp.stepData?.[id]?.roomName || room.name, dynamic: 'additional', index, roomCategory: 'bedroom', legacyAdditional: true });
  });

  const bedroomSteps = steps.filter(step => step.type === 'bedroom');

  // Bathrooms are independent records. They can optionally link back to one or
  // more bedrooms, but are never embedded inside the bedroom record.
  const numBath = parseInt(insp.numberOfBathrooms) || 1;
  for (let i = 0; i < numBath; i++) {
    const id = 'bathroom-' + i;
    const defaultBathroomName = i === 2 ? 'Primary Bathroom' : 'Bathroom ' + (i + 1);
    const bathroom = { id, type: 'bathroom', phase: 'rooms', name: defaultBathroomName, index: i, roomCategory: 'bathroom' };
    bathroom.name = applyBathroomName(insp, bathroom, bedroomSteps, relationships);
    steps.push(bathroom);
  }
  legacyBathrooms.forEach(({ room, index, id }) => {
    const bathroom = { id, type: 'bathroom', phase: 'rooms', name: insp.stepData?.[id]?.roomName || room.name, dynamic: 'additional', index, roomCategory: 'bathroom', legacyAdditional: true };
    bathroom.name = applyBathroomName(insp, bathroom, bedroomSteps, relationships);
    steps.push(bathroom);
  });

  // Main Level / Kitchen
  steps.push({ id: 'kitchen-appliance', type: 'kitchen-appliance', phase: 'main', name: 'Kitchen Inspection' });
  steps.push({ id: 'water-sample', type: 'water-sample', phase: 'main', name: 'Water Samples' });
  steps.push({ id: 'atp-kitchen', type: 'atp-kitchen', phase: 'main', name: 'ATP Testing' });
  steps.push({ id: 'kitchen-air', type: 'kitchen-air', phase: 'main', name: 'Kitchen Air Testing' });

  // Supplementary
  supplementaryRooms.forEach(({ room, index, id }) => {
    steps.push({ id, type: 'additional-room', phase: 'supplementary', name: room.name, dynamic: 'additional', index, roomCategory: 'additional' });
  });

  // Utility equipment questions are easiest to complete after the inspector
  // has walked the home and has the room/system context needed to answer them.
  // Keep the stable `utility` step ID so existing answers and photos remain
  // attached when an in-progress inspection receives this reordered workflow.
  steps.push({ id: 'utility', type: 'utility', phase: 'utility', name: 'Utility Room' });

  // Wrap Up - Debrief first, then final departure checks
  steps.push({ id: 'debrief', type: 'debrief', phase: 'wrapup', name: 'Customer Debrief' });
  steps.push({ id: 'final-checks', type: 'final-checks', phase: 'wrapup', name: 'Before Leaving' });

  // Property Details (near end)
  steps.push({ id: 'property-details', type: 'property-details', phase: 'propdetails', name: 'Property Details' });

  // Post-Assessment (#7)
  steps.push({ id: 'post-assessment', type: 'post-assessment', phase: 'post', name: 'Post-Assessment' });

  // Review
  steps.push({ id: 'review', type: 'review', phase: 'review', name: 'Final Review' });

  return steps;
}

// ── Step Data Access ───────────────────────────────────────
export function getStepData(stepId) {
  const inspection = getInspection();
  if (!inspection.stepData) inspection.stepData = {};
  if (!inspection.stepData[stepId]) inspection.stepData[stepId] = { _stepId: stepId };
  return inspection.stepData[stepId];
}

// ── Validation ─────────────────────────────────────────────
export function validateEquipment(data) {
  const fieldGen = getEquipmentFields();
  const missing = [];
  for (const f of fieldGen) {
    if (f.type !== 'checklist') continue;
    const d = data[f.key] || {};
    for (const item of f.items) {
      if (item.optional) continue;
      if (!d[item.key]) missing.push(item.label);
    }
  }
  return missing;
}

function showIfMatches(field, data) {
  if (!field.showIf) return true;
  const dv = data[field.showIf.key];
  const target = field.showIf.value;
  return Array.isArray(target)
    ? (Array.isArray(dv) ? target.some(t => dv.includes(t)) : target.includes(dv))
    : (Array.isArray(dv) ? dv.includes(target) : dv === target);
}

function isBlank(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function hasPhoto(data, key) {
  const arr = data[key || '_photos'];
  return Array.isArray(arr) && arr.length > 0;
}

function requiredLabel(field) {
  return (field.label || field.stepName || field.key || 'Required field') + ' is required';
}

function collectRequiredIssues(fields, data, missing) {
  for (const field of fields) {
    if (!field || !showIfMatches(field, data)) continue;

    if (field.type === 'collapsible-section') {
      collectRequiredIssues(field.fields || [], data, missing);
      continue;
    }

    if (!field.required) continue;

    if (field.type === 'sample-id-scanner' || field.type === 'number-scanner') {
      if (isBlank(data[field.dataKey || field.key])) missing.push(requiredLabel(field));
    } else if (field.type === 'photo') {
      if (!hasPhoto(data, field.photoKey)) missing.push(requiredLabel(field));
    } else if (isBlank(data[field.key])) {
      missing.push(requiredLabel(field));
    }
  }
}

export function validateStep(stepDef, existingData) {
  const data = existingData || getStepData(stepDef.id);
  if (stepDef.type === 'equipment') {
    return validateEquipment(data);
  }

  const missing = [];
  collectRequiredIssues(getStepFields(stepDef), data, missing);

  return missing;
}

// Returns non-blocking warnings (shown as toast but navigation still allowed)
export function warnStep(stepDef) {
  // ATP completion warning removed per Matt's request
  return [];
}
