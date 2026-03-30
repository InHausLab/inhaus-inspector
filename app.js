// InHaus Inspector - Main Application
(function () {
  'use strict';

  // ── Google Drive Export Config ─────────────────────────────
  // Set this to your Google Apps Script web app URL
  const GOOGLE_SCRIPT_URL = '';

  const { el, renderField, renderProgressBar, renderStatusBar, renderTimersBar, fmtDate } = UI;

  // ── Field Definition Helpers ───────────────────────────────
  function text(key, label, opts) { return { key, type: 'text', label, ...opts }; }
  function textarea(key, label, opts) { return { key, type: 'textarea', label, ...opts }; }
  function num(key, label, opts) { return { key, type: 'number', label, ...opts }; }
  function date(key, label) { return { key, type: 'date', label }; }
  function sel(key, label, choices, opts) { return { key, type: 'select', label, choices, ...opts }; }
  function yesno(key, label) { return { key, type: 'yesno', label }; }
  function yesnona(key, label) { return { key, type: 'yesnona', label }; }
  function radio(key, label, choices) { return { key, type: 'radio', label, choices }; }
  function check(key, label) { return { key, type: 'check', label }; }
  function checklist(key, label, items, opts) { return { key, type: 'checklist', label, items, ...opts }; }
  function chips(key, label, options) { return { key, type: 'chips', label, options }; }
  function reading(key, label, unit) { return { key, type: 'reading', label, unit }; }
  function photo(stepName) { return { type: 'photo', stepName }; }
  function timer(key, label, duration, opts) { return { key, type: 'timer', label, duration, ...opts }; }
  function heading(label) { return { type: 'heading', label }; }
  function info(label) { return { type: 'info', label }; }
  function divider() { return { type: 'divider' }; }
  function showIf(field, key, value) { return { ...field, showIf: { key, value } }; }

  // ── Reusable Field Groups ──────────────────────────────────
  const OBS_TAGS = [
    'Visible mold', 'Poor ventilation', 'Water staining', 'Condensation',
    'Musty odor', 'Active leak', 'Plumbing issue', 'HVAC concern',
    'Moisture concern (FLIR)', 'Other'
  ];

  function qTrakReadings() {
    return [
      reading('co2', 'CO2', 'ppm'),
      reading('voc', 'VOC/TVOC', '\u00b5g/m\u00b3'),
      reading('pm25', 'PM2.5', '\u00b5g/m\u00b3'),
      reading('pm10', 'PM10', '\u00b5g/m\u00b3'),
      reading('co', 'CO', 'ppm'),
      reading('no2', 'NO2', 'ppm'),
      reading('ozone', 'Ozone', 'ppm'),
      reading('chlorine_air', 'Chlorine', 'ppm'),
      reading('temperature', 'Temperature', '\u00b0F'),
      reading('humidity', 'Humidity', '%')
    ];
  }

  function flirFields() {
    return [
      heading('FLIR Thermal Scan'),
      yesno('flirDone', 'FLIR scan completed'),
      showIf(yesno('flirConcerns', 'Areas of concern found'), 'flirDone', 'Yes'),
      showIf(text('flirPhotoNum', 'FLIR photo number noted'), 'flirDone', 'Yes'),
      showIf(num('flirMoisture', 'Moisture reading', { unit: '%', note: 'Flag if >20%' }), 'flirDone', 'Yes')
    ];
  }

  function breezeFields(timerKey) {
    return [
      heading('Breeze ET Mold Test'),
      yesno('breezeDone', 'Breeze ET test performed'),
      showIf(timer(timerKey || 'breezeTimer', 'Breeze ET Timer (10 min)', 600), 'breezeDone', 'Yes'),
      showIf(text('sporeTrapId', 'Spore Trap ID'), 'breezeDone', 'Yes')
    ];
  }

  function qtrakSection() {
    return [
      heading('Q-Trak Readings'),
      timer('qtrakTimer', 'Q-Trak Sampling Timer (1 min)', 60),
      ...qTrakReadings()
    ];
  }

  function formaldehydeField() {
    return [reading('formaldehyde', 'Formaldehyde (Extech)', 'ppm')];
  }

  function observationFields() {
    return [
      chips('observations', 'Observations', OBS_TAGS),
      textarea('notes', 'Notes', { placeholder: 'Enter observations, notes, or comments...' }),
      photo('Room Inspection')
    ];
  }

  function bathroomCheckFields() {
    return [
      heading('Bathroom Inspection'),
      check('bathUnderSink', 'Under sink checked'),
      check('bathToilet', 'Around toilet checked'),
      check('bathShower', 'Baseboard around shower/tub checked'),
      check('bathGrout', 'Caulking/grout in tile checked'),
      yesno('bathLeak', 'Leak found')
    ];
  }

  function equipmentFields(key, label, withPhoto) {
    const fields = [
      heading(label),
      text(key + 'Type', 'Type'),
      text(key + 'Model', 'Model #'),
      text(key + 'Serial', 'Serial #')
    ];
    if (withPhoto !== false) fields.push(photo(label));
    return fields;
  }

  // ── Step Definitions ───────────────────────────────────────

  function getEquipmentFields() {
    return [
      checklist('airEquip', 'Air Testing Equipment', [
        { key: 'qtrak', label: 'Q-Trak 7585 \u2014 charged, previous data deleted, rooms configured' },
        { key: 'extech', label: 'Extech Formaldehyde monitor (VFM200)' },
        { key: 'flir', label: 'FLIR MR277' },
        { key: 'airthings', label: 'Airthings device + charging cube' },
        { key: 'breezeET', label: 'Breeze ET pump + tripod' },
        { key: 'breezeST', label: 'Breeze ST spore traps (6)' },
        { key: 'breezeSwabs', label: 'Breeze mold swabs (2)' },
        { key: 'boulderBlue', label: 'Boulder Blue fan + filter \u2014 registered' }
      ]),
      checklist('radonEquip', 'Radon', [
        { key: 'corentium', label: 'Airthings Corentium Pro radon monitor + tripod' }
      ]),
      checklist('waterEquip', 'Water Testing', [
        { key: 'waterKit', label: 'Full panel water test kit (EnviroTest)' },
        { key: 'pfasKit', label: 'PFAS test kit (Cyclopure)', optional: true },
        { key: 'microKit', label: 'Microplastics test kit (Brooks Applied Labs)', optional: true }
      ]),
      checklist('surfaceEquip', 'Surface Testing', [
        { key: 'atpDevice', label: 'ATP device (SystemSURE Plus)' },
        { key: 'atpSwabs', label: 'ATP swabs (2) \u2014 refrigerated, bring ice pack' }
      ]),
      checklist('otherEquip', 'Other Equipment', [
        { key: 'vacuum', label: 'Dewalt vacuum + attachments + bendy light' },
        { key: 'endoscope', label: 'Endoscope' },
        { key: 'tape', label: 'Measuring tape' },
        { key: 'cleaning', label: 'Cleaning supplies' }
      ]),
      checklist('safetyEquip', 'Personal / Safety', [
        { key: 'shoeCovers', label: 'Shoe covers' },
        { key: 'n95', label: 'N95 masks' },
        { key: 'gloves', label: 'Nitrile gloves' },
        { key: 'sanitizer', label: 'Hand sanitizer' }
      ]),
      checklist('techEquip', 'Technology', [
        { key: 'ipad', label: 'iPad \u2014 fully charged, all apps downloaded' },
        { key: 'airthingsApp', label: 'Airthings app' },
        { key: 'viewPlusApp', label: 'Airthings View Plus app' }
      ]),
      checklist('shippingEquip', 'Shipping Supplies', [
        { key: 'fedex', label: 'FedEx prepaid label (Breeze STs)' },
        { key: 'ups', label: 'UPS label (Boulder Blue)' },
        { key: 'safeHome', label: 'Safe Home water panel \u2014 prepaid label + package' },
        { key: 'cyclopure', label: 'Cyclopure \u2014 prepaid label + package', optional: true }
      ])
    ];
  }

  function getArrivalFields() {
    return [
      check('homeownerGreeted', 'Homeowner greeted (or entry instructions noted)'),
      text('securityCode', 'Security code (if needed)'),
      check('tarpPlaced', 'Tarp placed in entryway'),
      check('equipmentUnloaded', 'Equipment unloaded from car to tarp'),
      check('equipmentTidy', 'Equipment tidy, not blocking doorways'),
      check('concernsReviewed', 'Customer concerns reviewed'),
      heading('Expectations Set with Homeowner'),
      check('testsExplained', 'Tests being performed explained'),
      check('durationExplained', 'Duration explained'),
      check('sedentaryAdvised', 'Homeowner advised to be relatively sedentary during testing'),
      textarea('notes', 'Notes'),
      photo('Arrival Setup')
    ];
  }

  function getDeviceSetupFields() {
    return [
      heading('Airthings Setup'),
      yesnona('airthingsConnected', 'Airthings connected to wifi'),
      showIf(text('airthingsWifi', 'Wifi network used'), 'airthingsConnected', 'Yes'),
      showIf(text('airthingsPlacement', 'Placement location'), 'airthingsConnected', 'Yes'),
      divider(),
      heading('Boulder Blue Fan'),
      yesno('boulderBluePlugged', 'Boulder Blue fan plugged in'),
      showIf(text('boulderBluePlacement', 'Placement location'), 'boulderBluePlugged', 'Yes'),
      showIf(timer('boulderBlueTimer', 'Boulder Blue Fan Timer (2 hours)', 7200), 'boulderBluePlugged', 'Yes'),
      showIf(info('Note: fan must run 2 hours'), 'boulderBluePlugged', 'Yes'),
      divider(),
      heading('PFAS Water Test'),
      radio('pfasSetup', 'PFAS water test at kitchen faucet', ['Yes', 'No', 'Not requested']),
      showIf(timer('pfasTimer', 'PFAS Drain Timer', 3600), 'pfasSetup', 'Yes'),
      showIf(info('Note: needs ~1 hour to drain'), 'pfasSetup', 'Yes'),
      textarea('notes', 'Notes'),
      photo('Device Setup')
    ];
  }

  function getOutsideFields() {
    return [
      heading('Breeze ET Control'),
      yesno('breezeOutdoor', 'Breeze ET set up outdoors'),
      showIf(info('Placement: 6\u201310 feet from main entrance, full tripod height (60\u2033)'), 'breezeOutdoor', 'Yes'),
      showIf(timer('breezeOutdoorTimer', 'Breeze ET Outdoor Timer (10 min)', 600), 'breezeOutdoor', 'Yes'),
      divider(),
      heading('Q-Trak Outdoor Control'),
      yesno('qtrakOutdoor', 'Q-Trak outdoor control measurement taken'),
      showIf(info('Room: Outdoor / Front \u2014 Duration: 1 minute'), 'qtrakOutdoor', 'Yes'),
      showIf(timer('qtrakOutdoorTimer', 'Q-Trak Outdoor Timer (1 min)', 60), 'qtrakOutdoor', 'Yes'),
      divider(),
      heading('Exterior Visual Inspection'),
      check('insulationPlumbing', 'Insulation around plumbing lines checked'),
      check('caulkingFlashing', 'Caulking/flashing condition checked'),
      check('lotGrading', 'Lot grading (water flow) checked'),
      text('sidingType', 'Type of siding'),
      text('ventsCondition', 'Vents \u2014 condition'),
      check('iceDamsGutters', 'Ice dams / gutters checked'),
      text('roofCondition', 'Overall roof condition'),
      divider(),
      yesno('weatherScreenshot', 'Weather screenshot noted'),
      textarea('notes', 'General exterior notes'),
      photo('Outside Inspection')
    ];
  }

  function getRadonFields() {
    return [
      text('radonLocation', 'Location in lowest livable space'),
      heading('Placement Confirmed'),
      check('radon3ft', '3 feet from exterior wall'),
      check('radon20in', '20 inches or above floor'),
      check('radonCentralized', 'Centralized, not in trafficked area'),
      check('radonWindowsClosed', 'Windows and doors closed'),
      yesno('radonAppStarted', 'App started'),
      info('Test type: 48-hour test with 4-hour calibration'),
      yesno('multipleMonitors', 'Multiple monitors needed (>2,000 sq ft or different foundations)'),
      showIf(text('secondMonitorLocation', 'Second monitor location'), 'multipleMonitors', 'Yes'),
      photo('Radon Setup')
    ];
  }

  function getRoomTestFields() {
    return [
      text('roomName', 'Room Name', { required: true }),
      ...flirFields(),
      ...breezeFields(),
      ...qtrakSection(),
      ...formaldehydeField(),
      ...observationFields()
    ];
  }

  function getUtilityFields() {
    return [
      text('levelLocation', 'Level location'),
      ...equipmentFields('heating', 'Heating Source'),
      ...equipmentFields('ac', 'Air Conditioning Source'),
      ...equipmentFields('ventilation', 'Ventilation / Fresh Air System'),
      divider(),
      heading('HVAC Filter'),
      text('filterSize', 'Filter size'),
      text('filterRating', 'MERV / HEPA rating'),
      radio('filterCondition', 'Filter condition', ['Good', 'Fair', 'Poor']),
      photo('HVAC Filter'),
      divider(),
      heading('HVAC Inspection'),
      check('servicePanelRemoved', 'Service panel removed'),
      check('filtersChecked', 'Filters checked'),
      yesno('hvacCondensation', 'Condensation noted'),
      yesno('hvacLeaks', 'Leaks noted'),
      text('hvacDetails', 'Notable details'),
      photo('HVAC Inspection'),
      divider(),
      yesno('radonMitigationPresent', 'Radon mitigation system present'),
      showIf(text('radonMitType', 'Type / Model / Serial'), 'radonMitigationPresent', 'Yes'),
      showIf(photo('Radon Mitigation'), 'radonMitigationPresent', 'Yes'),
      yesno('airFiltrationPresent', 'Air filtration system present'),
      showIf(text('airFiltType', 'Type / Model / Serial'), 'airFiltrationPresent', 'Yes'),
      showIf(photo('Air Filtration'), 'airFiltrationPresent', 'Yes'),
      yesno('waterFiltrationPresent', 'Water filtration system present'),
      showIf(text('waterFiltType', 'Type / Model / Serial'), 'waterFiltrationPresent', 'Yes'),
      showIf(photo('Water Filtration'), 'waterFiltrationPresent', 'Yes'),
      textarea('notes', 'General notes'),
      photo('Utility Room')
    ];
  }

  function getBedroomFields() {
    return [
      text('roomName', 'Room Name', { required: true }),
      ...flirFields(),
      ...breezeFields(),
      ...qtrakSection(),
      ...formaldehydeField(),
      divider(),
      yesno('hasEnsuite', 'Ensuite bathroom present'),
      ...bathroomCheckFields().map(f => f.type === 'heading' ? showIf(f, 'hasEnsuite', 'Yes') : showIf(f, 'hasEnsuite', 'Yes')),
      ...observationFields()
    ];
  }

  function getBathroomFields() {
    return [
      text('roomName', 'Room Name', { required: true }),
      ...breezeFields(),
      ...qtrakSection(),
      ...formaldehydeField(),
      ...bathroomCheckFields(),
      ...observationFields()
    ];
  }

  function getLivingAreaFields() {
    return [
      text('roomNames', 'Room(s) tested (e.g., Living Room, Dining Room)', { required: true }),
      ...flirFields(),
      ...breezeFields(),
      ...qtrakSection(),
      ...formaldehydeField(),
      ...observationFields()
    ];
  }

  function getKitchenApplianceFields() {
    return [
      heading('Kitchen Water Flush'),
      yesno('waterFlushed', 'Water flushed 5 minutes before sampling'),
      showIf(timer('flushTimer', 'Kitchen Water Flush Timer (5 min)', 300), 'waterFlushed', 'Yes'),
      divider(),
      heading('Appliance Inspection'),
      checklist('appliances', null, [
        { key: 'fridge', label: 'Under refrigerator \u2014 checked, cleaned', subFields: [{ key: 'fridgeFindings', label: 'Notable findings' }] },
        { key: 'dishwasher', label: 'Under dishwasher \u2014 checked, cleaned', subFields: [{ key: 'dishwasherFindings', label: 'Notable findings' }] },
        { key: 'dishwasherFilter', label: 'Dishwasher filter \u2014 checked, cleaned', subFields: [{ key: 'dishFilterFindings', label: 'Notable findings' }] },
        { key: 'underSink', label: 'Under sink \u2014 checked, cleaned', subFields: [{ key: 'sinkFindings', label: 'Notable findings' }] },
        { key: 'iceMaker', label: 'Under ice maker \u2014 checked, cleaned', subFields: [{ key: 'iceMakerFindings', label: 'Notable findings' }] },
        { key: 'backsplash', label: 'Grout/caulking on backsplash \u2014 checked', subFields: [{ key: 'backsplashFindings', label: 'Notable findings' }] },
        { key: 'stoveVent', label: 'Above stove vent \u2014 checked, cleaned', subFields: [{ key: 'stoveVentFindings', label: 'Notable findings' }] }
      ]),
      photo('Appliance Inspection'),
      divider(),
      yesnona('moldSwabCollected', 'Mold swab collected under sink (if warranted)'),
      showIf(text('moldSwabId', 'Swab ID'), 'moldSwabCollected', 'Yes'),
      textarea('notes', 'Notes')
    ];
  }

  function getWaterSampleFields() {
    return [
      heading('Water Panel'),
      yesno('waterPanelCollected', 'Water panel collected'),
      showIf(text('waterSampleId', 'Sample ID / label'), 'waterPanelCollected', 'Yes'),
      showIf(text('waterFaucetLocation', 'Faucet location'), 'waterPanelCollected', 'Yes'),
      showIf(photo('Water Panel'), 'waterPanelCollected', 'Yes'),
      divider(),
      heading('Microplastics Test'),
      radio('microplasticsStatus', 'Microplastics test', ['Collected', 'Not requested']),
      showIf(text('microplasticsSampleId', 'Sample ID'), 'microplasticsStatus', 'Collected'),
      divider(),
      heading('PFAS Test'),
      radio('pfasStatus', 'PFAS test', ['Collected', 'Not requested', 'Already set up']),
      showIf(text('pfasSampleId', 'Sample ID'), 'pfasStatus', 'Collected'),
      textarea('notes', 'Notes')
    ];
  }

  function getAtpKitchenFields() {
    return [
      text('atpSurface', 'Surface tested', { required: true }),
      num('atpPreRLU', 'Pre-test RLU reading', { unit: 'RLU' }),
      radio('atpPreStatus', 'Pre-test status', ['Pass', 'Fail']),
      yesno('atpCleaned', 'Surface cleaned with soap and water'),
      num('atpPostRLU', 'Post-test RLU reading', { unit: 'RLU' }),
      radio('atpPostStatus', 'Post-test status', ['Pass', 'Fail']),
      photo('ATP Testing'),
      textarea('notes', 'Notes')
    ];
  }

  function getKitchenAirFields() {
    return [
      ...flirFields(),
      ...breezeFields('kitchenBreezeTimer'),
      ...qtrakSection(),
      ...formaldehydeField(),
      ...observationFields()
    ];
  }

  function getAdditionalRoomFields() {
    return [
      text('roomName', 'Room Name', { required: true }),
      textarea('reasonForInclusion', 'Reason for inclusion'),
      ...flirFields(),
      ...breezeFields(),
      ...qtrakSection(),
      ...formaldehydeField(),
      ...observationFields()
    ];
  }

  function getFinalChecksFields() {
    return [
      checklist('finalChecks', 'Final Checks Before Leaving', [
        { key: 'breezeCollected', label: 'All Breeze ET tests collected and spore traps packed' },
        { key: 'boulderBlueDone', label: 'Boulder Blue fan run for 2 hours \u2014 filter collected and packed' },
        { key: 'pfasCollected', label: 'PFAS test collected from sink' },
        { key: 'waterLabeled', label: 'Water samples labeled and ready to ship' },
        { key: 'appliancesRestored', label: 'All appliances returned to original state' },
        { key: 'doorsLightsRestored', label: 'All doors/lights returned to original state' },
        { key: 'radonLeftInPlace', label: 'Radon monitor left in place \u2014 homeowner reminded about pickup date' },
        { key: 'formComplete', label: 'Technician form fully completed' },
        { key: 'photosUploaded', label: 'All photos uploaded/captured' }
      ])
    ];
  }

  function getDebriefFields() {
    return [
      yesno('debriefCompleted', 'Debrief completed'),
      yesno('radonPickupReminder', 'Homeowner reminded about radon pickup'),
      yesno('reportDateCommunicated', 'Expected report date communicated'),
      textarea('debriefNotes', 'Notes from debrief')
    ];
  }

  function getShippingFields() {
    return [
      checklist('shipping', 'Post-Assessment Shipping', [
        { key: 'breezeST', label: 'Breeze ST spore traps \u2014 packed for FedEx overnight', subFields: [{ key: 'breezeTracking', label: 'Tracking number' }] },
        { key: 'boulderBlueShip', label: 'Boulder Blue filter \u2014 packed for UPS to Jonah Ventures, 5485 Conestoga Ct #210, Boulder CO 80301', subFields: [{ key: 'boulderBlueTracking', label: 'Tracking number' }] },
        { key: 'waterPanelShip', label: 'Water panel \u2014 prepaid label + package sent', subFields: [{ key: 'waterTracking', label: 'Tracking number' }] },
        { key: 'pfasShip', label: 'PFAS (Cyclopure) \u2014 prepaid label + package sent', subFields: [{ key: 'pfasTracking', label: 'Tracking number' }] },
        { key: 'microplasticsShip', label: 'Microplastics (Brooks Applied Labs) \u2014 packaged and shipped', subFields: [{ key: 'microTracking', label: 'Tracking number' }] },
        { key: 'qtrakDownloaded', label: 'Q-Trak data downloaded and exported to spreadsheet' },
        { key: 'photosGDrive', label: 'Photos uploaded to Google Drive folder' }
      ])
    ];
  }

  // ── Step Type → Fields Mapping ─────────────────────────────
  const STEP_FIELDS = {
    'equipment': getEquipmentFields,
    'arrival': getArrivalFields,
    'device-setup': getDeviceSetupFields,
    'outside': getOutsideFields,
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
    'shipping': getShippingFields
  };

  // ── Phases ─────────────────────────────────────────────────
  const PHASES = [
    { id: 'setup', name: 'Setup', icon: '1' },
    { id: 'arrival', name: 'Arrival', icon: '2' },
    { id: 'outside', name: 'Outside', icon: '3' },
    { id: 'lowest', name: 'Lower', icon: '4' },
    { id: 'utility', name: 'Utility', icon: '5' },
    { id: 'upper', name: 'Upper', icon: '6' },
    { id: 'main', name: 'Kitchen', icon: '7' },
    { id: 'supplementary', name: 'Other', icon: '8' },
    { id: 'wrapup', name: 'Wrap Up', icon: '9' },
    { id: 'review', name: 'Review', icon: '\u2713' }
  ];

  // ── State ──────────────────────────────────────────────────
  let inspection = null;
  let stepList = [];
  let currentStepIdx = 0;
  let screen = 'home'; // home | intake | step | review
  let saveTimeout = null;
  let lastSaveText = '';

  const root = document.getElementById('app');

  // ── ID Generator ───────────────────────────────────────────
  function genId() {
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return 'INH-' + d + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // ── Build Step List ────────────────────────────────────────
  function buildStepList(insp) {
    const steps = [];

    // Setup
    steps.push({ id: 'equipment', type: 'equipment', phase: 'setup', name: 'Pre-Assessment Checklist' });

    // Arrival
    steps.push({ id: 'arrival', type: 'arrival', phase: 'arrival', name: 'Arrival Setup' });
    steps.push({ id: 'device-setup', type: 'device-setup', phase: 'arrival', name: 'Device Setup' });

    // Outside
    steps.push({ id: 'outside', type: 'outside', phase: 'outside', name: 'Outside Inspection' });

    // Lowest Level
    steps.push({ id: 'radon', type: 'radon', phase: 'lowest', name: 'Radon Monitor Setup' });
    const lowestRooms = (insp.dynamicRooms && insp.dynamicRooms.lowest) || [{ name: 'Lowest Level \u2014 Room 1' }];
    lowestRooms.forEach((r, i) => {
      steps.push({ id: 'lowest-room-' + i, type: 'room-test', phase: 'lowest', name: r.name, dynamic: 'lowest', index: i });
    });

    // Utility
    steps.push({ id: 'utility', type: 'utility', phase: 'utility', name: 'Utility Room' });

    // Upper Level
    const numBed = parseInt(insp.numberOfBedrooms) || 1;
    for (let i = 0; i < numBed; i++) {
      const defaultName = 'Bedroom ' + (i + 1);
      steps.push({ id: 'bedroom-' + i, type: 'bedroom', phase: 'upper', name: defaultName, index: i });
    }
    const numBath = parseInt(insp.numberOfBathrooms) || 1;
    for (let i = 0; i < numBath; i++) {
      const defaultName = 'Bathroom ' + (i + 1);
      steps.push({ id: 'bathroom-' + i, type: 'bathroom', phase: 'upper', name: defaultName, index: i });
    }

    // Main Level / Kitchen
    steps.push({ id: 'living-area', type: 'living-area', phase: 'main', name: 'Main Living Area' });
    steps.push({ id: 'kitchen-appliance', type: 'kitchen-appliance', phase: 'main', name: 'Kitchen Inspection' });
    steps.push({ id: 'water-sample', type: 'water-sample', phase: 'main', name: 'Water Samples' });
    steps.push({ id: 'atp-kitchen', type: 'atp-kitchen', phase: 'main', name: 'ATP Testing' });
    steps.push({ id: 'kitchen-air', type: 'kitchen-air', phase: 'main', name: 'Kitchen Air Testing' });

    // Supplementary
    const additionalRooms = (insp.dynamicRooms && insp.dynamicRooms.additional) || [];
    additionalRooms.forEach((r, i) => {
      steps.push({ id: 'additional-' + i, type: 'additional-room', phase: 'supplementary', name: r.name, dynamic: 'additional', index: i });
    });

    // Wrap Up
    steps.push({ id: 'final-checks', type: 'final-checks', phase: 'wrapup', name: 'Final Checks' });
    steps.push({ id: 'debrief', type: 'debrief', phase: 'wrapup', name: 'Customer Debrief' });
    steps.push({ id: 'shipping', type: 'shipping', phase: 'wrapup', name: 'Shipping Checklist' });

    // Review
    steps.push({ id: 'review', type: 'review', phase: 'review', name: 'Final Review' });

    return steps;
  }

  // ── Save ───────────────────────────────────────────────────
  function showSave(msg) {
    lastSaveText = msg;
    const el = document.getElementById('save-status');
    if (el) el.textContent = msg;
  }

  async function saveNow() {
    if (!inspection) return;
    showSave('Saving...');
    try {
      await DB.save(inspection);
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      showSave('Saved \u2713 ' + t);
    } catch (e) {
      console.error('Save failed:', e);
      showSave('Save failed!');
    }
  }

  function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveNow, 300);
  }

  // ── Validation ─────────────────────────────────────────────
  function validateEquipment(data) {
    const groups = ['airEquip', 'radonEquip', 'waterEquip', 'surfaceEquip', 'otherEquip', 'safetyEquip', 'techEquip', 'shippingEquip'];
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

  function validateStep(stepDef) {
    // For now, only equipment has strict validation
    // Other steps allow proceeding freely (inspector decides completeness)
    if (stepDef.type === 'equipment') {
      const data = getStepData(stepDef.id);
      return validateEquipment(data);
    }
    return [];
  }

  // ── Step Data Access ───────────────────────────────────────
  function getStepData(stepId) {
    if (!inspection.stepData) inspection.stepData = {};
    if (!inspection.stepData[stepId]) inspection.stepData[stepId] = { _stepId: stepId };
    return inspection.stepData[stepId];
  }

  // ── Add Dynamic Room ───────────────────────────────────────
  function addDynamicRoom(section) {
    if (!inspection.dynamicRooms) inspection.dynamicRooms = {};
    if (!inspection.dynamicRooms[section]) inspection.dynamicRooms[section] = [];

    const arr = inspection.dynamicRooms[section];
    const idx = arr.length;
    const prefix = section === 'lowest' ? 'Lowest Level \u2014 Room ' : 'Additional Room ';
    arr.push({ name: prefix + (idx + 1) });

    stepList = buildStepList(inspection);
    // Navigate to the new step
    const newStepId = section === 'lowest' ? 'lowest-room-' + idx : 'additional-' + idx;
    const newIdx = stepList.findIndex(s => s.id === newStepId);
    if (newIdx >= 0) currentStepIdx = newIdx;

    saveNow().then(() => render());
  }

  // ── Google Drive Upload ─────────────────────────────────────
  function showUploadBanner(type, msg) {
    // Remove existing banner
    const old = document.getElementById('upload-banner');
    if (old) old.remove();
    const banner = el('div', { id: 'upload-banner', className: 'upload-banner upload-' + type });
    banner.textContent = msg;
    document.body.appendChild(banner);
    if (type === 'success') setTimeout(() => { if (banner.parentNode) banner.remove(); }, 5000);
  }

  async function uploadToGoogleDrive(exportData) {
    if (!GOOGLE_SCRIPT_URL) return;

    try {
      const resp = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportData)
      });
      // no-cors means we can't read the response, but if fetch didn't throw, the request was sent
      await DB.removeFromQueue(exportData.inspectionId);
      showUploadBanner('success', '\u2713 Saved to Google Drive');
      return true;
    } catch (e) {
      console.log('Upload failed, queuing for retry:', e);
      await DB.queueUpload(exportData);
      showUploadBanner('pending', 'Saved locally \u2014 will upload when online');
      return false;
    }
  }

  async function retryQueuedUploads() {
    if (!GOOGLE_SCRIPT_URL || !navigator.onLine) return;
    const queue = await DB.getQueue();
    for (const item of queue) {
      try {
        await fetch(GOOGLE_SCRIPT_URL, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });
        await DB.removeFromQueue(item.inspectionId);
        console.log('Retry succeeded for', item.inspectionId);
      } catch (e) {
        console.log('Retry still failing for', item.inspectionId);
        break; // stop retrying if still offline
      }
    }
  }

  // Retry queued uploads when coming back online
  window.addEventListener('online', () => {
    retryQueuedUploads();
  });

  // ── Render ─────────────────────────────────────────────────
  function render() {
    root.innerHTML = '';
    switch (screen) {
      case 'home': renderHome(); break;
      case 'intake': renderIntake(); break;
      case 'step': renderStep(); break;
      case 'review': renderReview(); break;
    }
  }

  // ── HOME SCREEN ────────────────────────────────────────────
  function renderHome() {
    const c = el('div', { className: 'screen home-screen' });
    const header = el('div', { className: 'app-header' });
    const logo = el('div', { className: 'app-logo' });
    // House icon SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '36');
    svg.setAttribute('height', '36');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', '#ffffff');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path1.setAttribute('d', 'M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z');
    const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path2.setAttribute('d', 'M9 21V12h6v9');
    svg.appendChild(path1);
    svg.appendChild(path2);
    logo.appendChild(svg);
    logo.appendChild(el('h1', { className: 'app-title' }, 'InHaus Lab'));
    header.appendChild(logo);
    header.appendChild(el('p', { className: 'app-subtitle' }, 'Field Inspector'));
    c.appendChild(header);

    c.appendChild(el('button', {
      className: 'btn btn-primary btn-full',
      onClick: () => { screen = 'intake'; render(); }
    }, 'New Inspection'));

    const list = el('div', { className: 'inspection-list' });
    c.appendChild(list);

    DB.getAll().then(all => {
      all.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
      const inProg = all.filter(x => x.status === 'in-progress');
      const done = all.filter(x => x.status === 'completed');

      if (inProg.length) {
        list.appendChild(el('h2', { className: 'list-heading' }, 'In Progress'));
        inProg.forEach(x => list.appendChild(renderInspCard(x, true)));
      }
      if (done.length) {
        list.appendChild(el('h2', { className: 'list-heading' }, 'Completed'));
        done.forEach(x => list.appendChild(renderInspCard(x, false)));
      }
      if (!all.length) {
        list.appendChild(el('p', { className: 'empty-msg' }, 'No inspections yet. Tap "New Inspection" to begin.'));
      }
    });

    root.appendChild(c);
  }

  function renderInspCard(insp, canResume) {
    return el('div', { className: 'card insp-card' }, [
      el('div', { className: 'card-top' }, [
        el('strong', null, insp.inspectionId),
        el('span', { className: 'badge ' + insp.status }, insp.status === 'completed' ? 'Complete' : 'In Progress')
      ]),
      el('p', null, insp.propertyAddress || 'No address'),
      el('p', { className: 'text-sm' }, (insp.inspectorName || '') + ' \u2022 ' + fmtDate(insp.startedAt)),
      el('div', { className: 'card-actions' }, [
        canResume ? el('button', { className: 'btn btn-primary', onClick: () => resumeInsp(insp.inspectionId) }, 'Resume') : null,
        el('button', { className: 'btn btn-outline', onClick: () => viewInsp(insp.inspectionId) }, 'View'),
        el('button', { className: 'btn btn-danger-outline btn-small', onClick: () => {
          if (confirm('Delete this inspection permanently?')) DB.remove(insp.inspectionId).then(() => render());
        }}, 'Delete')
      ])
    ]);
  }

  async function resumeInsp(id) {
    inspection = await DB.get(id);
    if (!inspection) return;
    stepList = buildStepList(inspection);
    // Find last visited step
    const lastVisited = inspection._lastStepIdx || 0;
    currentStepIdx = Math.min(lastVisited, stepList.length - 1);
    screen = 'step';
    render();
  }

  async function viewInsp(id) {
    inspection = await DB.get(id);
    if (!inspection) return;
    stepList = buildStepList(inspection);
    screen = 'review';
    render();
  }

  // ── INTAKE SCREEN ──────────────────────────────────────────
  function renderIntake() {
    const data = {
      inspectionId: genId(),
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
      clientConcerns: '',
      cleaningFrequency: '',
      occupancyDuringInspection: '',
      weatherConditions: '',
      knownProblemAreas: '',
      blueprintNotes: ''
    };

    const c = el('div', { className: 'screen' });
    c.appendChild(renderStatusBar(lastSaveText));
    c.appendChild(el('h1', { className: 'screen-title' }, 'Customer & Property Intake'));

    const card = el('div', { className: 'card' });
    const fields = [
      { ...text('inspectionId', 'Inspection ID'), disabled: true },
      text('inspectorName', 'Inspector Name *'),
      date('inspectionDate', 'Inspection Date'),
      text('clientName', 'Client Name *'),
      text('propertyAddress', 'Property Address *'),
      sel('numberOfLevels', 'Number of Levels *', ['1', '2', '3+']),
      sel('numberOfBedrooms', 'Number of Bedrooms *', ['1', '2', '3', '4', '5', '6', '7']),
      sel('numberOfBathrooms', 'Number of Bathrooms *', ['1', '2', '3', '4', '5', '6']),
      sel('waterSource', 'Water Source *', ['Municipal', 'Well', 'Other']),
      showIf(text('waterSourceDescription', 'Water source description'), 'waterSource', 'Other'),
      text('wifiNetwork', 'Home wifi network name'),
      textarea('clientConcerns', 'Client specific concerns'),
      sel('cleaningFrequency', 'Cleaning frequency', ['Daily', 'Weekly', 'Bi-weekly', 'Monthly', 'Rarely']),
      radio('occupancyDuringInspection', 'Home occupancy during inspection', ['Yes', 'No', 'Partial']),
      text('weatherConditions', 'Weather conditions'),
      textarea('knownProblemAreas', 'Any known problem areas'),
      textarea('blueprintNotes', 'Client blueprints / layout notes (optional)')
    ];

    fields.forEach(f => {
      const rendered = renderField(f, data, () => {}, {}, () => {});
      if (rendered) card.appendChild(rendered);
    });
    c.appendChild(card);

    // Bottom nav
    const nav = el('div', { className: 'bottom-nav' }, [
      el('button', { className: 'btn btn-outline btn-nav', onClick: () => { screen = 'home'; render(); } }, 'Cancel'),
      el('button', { className: 'btn btn-primary btn-nav', onClick: () => {
        // Validate required fields
        const required = ['inspectorName', 'clientName', 'propertyAddress', 'numberOfLevels', 'numberOfBedrooms', 'numberOfBathrooms', 'waterSource'];
        const missing = required.filter(k => !data[k] || !data[k].trim || !data[k].trim());
        if (missing.length) {
          alert('Please fill in all required fields (marked with *).');
          return;
        }
        // Create inspection
        inspection = {
          ...data,
          startedAt: new Date().toISOString(),
          endedAt: null,
          status: 'in-progress',
          stepData: {},
          timers: {},
          dynamicRooms: { lowest: [{ name: 'Lowest Level \u2014 Room 1' }], additional: [] },
          _lastStepIdx: 0
        };
        stepList = buildStepList(inspection);
        currentStepIdx = 0;
        screen = 'step';
        saveNow().then(() => render());
      }}, 'Start Inspection \u2192')
    ]);
    c.appendChild(nav);
    root.appendChild(c);
  }

  // ── STEP SCREEN ────────────────────────────────────────────
  function renderStep() {
    if (currentStepIdx >= stepList.length) { screen = 'review'; render(); return; }
    const step = stepList[currentStepIdx];

    // If review step, go to review screen
    if (step.type === 'review') { screen = 'review'; render(); return; }

    const data = getStepData(step.id);
    if (!data._enteredAt) data._enteredAt = new Date().toISOString();
    data._roomName = step.name;

    // Set default room name for dynamic steps
    if ((step.type === 'room-test' || step.type === 'bedroom' || step.type === 'bathroom' || step.type === 'additional-room') && !data.roomName) {
      data.roomName = step.name;
    }

    inspection._lastStepIdx = currentStepIdx;

    const c = el('div', { className: 'screen step-screen' });
    c.appendChild(renderStatusBar(lastSaveText));

    // Active timers bar
    const timersBar = renderTimersBar(inspection);
    if (timersBar) c.appendChild(timersBar);

    // Progress bar
    const currentPhase = step.phase;
    const phasesWithState = PHASES.map(p => {
      const phaseSteps = stepList.filter(s => s.phase === p.id && s.type !== 'review');
      const allDone = phaseSteps.length > 0 && phaseSteps.every(s => {
        const d = inspection.stepData && inspection.stepData[s.id];
        return d && d._visited;
      });
      return { ...p, done: allDone };
    });
    c.appendChild(renderProgressBar(phasesWithState, currentPhase, step.name, phaseId => {
      const idx = stepList.findIndex(s => s.phase === phaseId);
      if (idx >= 0 && idx <= currentStepIdx) { currentStepIdx = idx; render(); }
    }));

    // Step content
    c.appendChild(el('h1', { className: 'screen-title' }, step.name));

    const fieldGen = STEP_FIELDS[step.type];
    if (fieldGen) {
      const fields = fieldGen();
      const card = el('div', { className: 'card' });
      fields.forEach(f => {
        const rendered = renderField(f, data, () => { data._updatedAt = new Date().toISOString(); scheduleSave(); }, inspection, () => { scheduleSave(); });
        if (rendered) card.appendChild(rendered);
      });
      c.appendChild(card);
    }

    // Add Room buttons for dynamic sections
    if (step.dynamic === 'lowest') {
      const lowestSteps = stepList.filter(s => s.dynamic === 'lowest');
      if (step.id === lowestSteps[lowestSteps.length - 1].id) {
        c.appendChild(el('button', {
          className: 'btn btn-outline btn-full', onClick: () => addDynamicRoom('lowest')
        }, '+ Add Another Room (Lowest Level)'));
      }
    }
    if (step.phase === 'supplementary' || (step.phase === 'main' && step.id === 'kitchen-air')) {
      // Show add additional room after kitchen air or in supplementary
      if (step.id === 'kitchen-air' || (step.dynamic === 'additional' && step.id === stepList.filter(s => s.dynamic === 'additional').pop()?.id)) {
        c.appendChild(el('button', {
          className: 'btn btn-outline btn-full', onClick: () => addDynamicRoom('additional')
        }, '+ Add Additional Room'));
      }
    }

    data._visited = true;

    // Bottom nav
    const nav = el('div', { className: 'bottom-nav' }, [
      currentStepIdx > 0
        ? el('button', { className: 'btn btn-outline btn-nav', onClick: () => { currentStepIdx--; render(); window.scrollTo(0, 0); } }, '\u2190 Back')
        : el('div'),
      el('button', { className: 'btn btn-primary btn-nav', onClick: () => {
        const missing = validateStep(step);
        if (missing.length) {
          alert('Please complete these required items:\n\n' + missing.join('\n'));
          return;
        }
        data._completedAt = new Date().toISOString();
        currentStepIdx++;
        saveNow().then(() => { render(); window.scrollTo(0, 0); });
      }}, currentStepIdx < stepList.length - 2 ? 'Next \u2192' : 'Review \u2192')
    ]);
    c.appendChild(nav);
    root.appendChild(c);
  }

  // ── REVIEW SCREEN ──────────────────────────────────────────
  function renderReview() {
    const c = el('div', { className: 'screen review-screen' });
    c.appendChild(renderStatusBar(lastSaveText));
    c.appendChild(el('h1', { className: 'screen-title' }, 'Final Review'));

    // Reminder banner
    c.appendChild(el('div', { className: 'reminder-banner' }, [
      el('strong', null, 'Before you leave:'),
      el('span', null, ' Upload photos to Google Drive | Download Q-Trak data to computer | Ship all lab samples')
    ]));

    // Header info
    const hCard = el('div', { className: 'card' });
    hCard.appendChild(el('h3', { className: 'section-heading' }, 'Inspection Details'));
    const infoFields = [
      ['ID', inspection.inspectionId],
      ['Inspector', inspection.inspectorName],
      ['Client', inspection.clientName],
      ['Address', inspection.propertyAddress],
      ['Date', inspection.inspectionDate],
      ['Levels', inspection.numberOfLevels],
      ['Bedrooms', inspection.numberOfBedrooms],
      ['Bathrooms', inspection.numberOfBathrooms],
      ['Water Source', inspection.waterSource + (inspection.waterSourceDescription ? ' (' + inspection.waterSourceDescription + ')' : '')],
      ['Wifi', inspection.wifiNetwork],
      ['Cleaning Freq.', inspection.cleaningFrequency],
      ['Occupancy', inspection.occupancyDuringInspection],
      ['Weather', inspection.weatherConditions],
      ['Started', fmtDate(inspection.startedAt)],
      ['Status', inspection.status]
    ];
    infoFields.forEach(([l, v]) => {
      hCard.appendChild(el('div', { className: 'info-row' }, [
        el('span', { className: 'info-label' }, l),
        el('span', { className: 'info-value' }, v || '--')
      ]));
    });
    if (inspection.clientConcerns) {
      hCard.appendChild(el('div', { className: 'info-block' }, [el('strong', null, 'Client Concerns: '), document.createTextNode(inspection.clientConcerns)]));
    }
    if (inspection.knownProblemAreas) {
      hCard.appendChild(el('div', { className: 'info-block' }, [el('strong', null, 'Known Problem Areas: '), document.createTextNode(inspection.knownProblemAreas)]));
    }
    c.appendChild(hCard);

    // Step summaries
    stepList.forEach((step, idx) => {
      if (step.type === 'review') return;
      const data = (inspection.stepData && inspection.stepData[step.id]) || {};
      const visited = !!data._visited;

      const sCard = el('div', { className: 'card' + (!visited ? ' card-incomplete' : '') });
      sCard.appendChild(el('div', { className: 'review-step-header' }, [
        el('h3', { className: 'section-heading' }, [
          document.createTextNode(step.name + ' '),
          el('span', { className: 'badge ' + (visited ? 'completed' : 'in-progress') }, visited ? 'Visited' : 'Not visited')
        ]),
        el('button', { className: 'btn btn-small btn-outline', onClick: () => {
          currentStepIdx = idx; screen = 'step'; render();
        }}, 'Edit')
      ]));

      // Show data summary
      const summary = el('div', { className: 'review-summary' });
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
            const checked = Object.entries(val).filter(([k, v]) => v === true).length;
            const total = f.items ? f.items.length : 0;
            display = checked + '/' + total + ' checked';
          } else if (f.type === 'chips' && Array.isArray(val)) {
            if (!val.length) return;
            display = val.join(', ');
          } else if (typeof val === 'boolean') {
            display = val ? 'Yes' : 'No';
          } else {
            display = String(val);
          }
          summary.appendChild(el('div', { className: 'review-item' }, [
            el('span', { className: 'review-item-label' }, (f.label || f.key) + ': '),
            el('span', null, display)
          ]));
        });

        // Photos
        if (data._photos && data._photos.length) {
          summary.appendChild(el('div', { className: 'review-photos-section' }, [
            el('strong', null, data._photos.length + ' photo(s):'),
          ]));
          const grid = el('div', { className: 'review-photo-grid' });
          data._photos.forEach(p => {
            const thumb = el('div', { className: 'review-photo-item' }, [
              el('img', { src: p.dataUrl, className: 'review-photo-img' }),
              p.caption ? el('div', { className: 'review-photo-caption' }, p.caption) : null
            ]);
            grid.appendChild(thumb);
          });
          summary.appendChild(grid);
        }
      }

      sCard.appendChild(summary);
      c.appendChild(sCard);
    });

    // JSON preview
    const jsonCard = el('div', { className: 'card' });
    jsonCard.appendChild(el('h3', { className: 'section-heading' }, 'JSON Export'));
    const exportData = buildExportJSON();
    const pre = el('pre', { className: 'json-preview' });
    pre.textContent = JSON.stringify(exportData, null, 2);
    jsonCard.appendChild(pre);
    c.appendChild(jsonCard);

    // Actions
    const actCard = el('div', { className: 'card actions-card' });

    // Export to Google Drive button
    if (GOOGLE_SCRIPT_URL) {
      actCard.appendChild(el('button', { className: 'btn btn-primary btn-full', onClick: () => {
        uploadToGoogleDrive(exportData);
      }}, '\u2601 Export to Google Drive'));
    }

    actCard.appendChild(el('button', { className: 'btn btn-outline btn-full', onClick: () => {
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = inspection.inspectionId + '.json'; a.click();
      URL.revokeObjectURL(url);
    }}, 'Download JSON'));

    actCard.appendChild(el('button', { className: 'btn btn-outline btn-full', onClick: () => {
      const json = JSON.stringify(exportData, null, 2);
      navigator.clipboard.writeText(json).then(() => alert('JSON copied to clipboard!')).catch(() => {
        const ta = document.createElement('textarea'); ta.value = json;
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta); alert('JSON copied!');
      });
    }}, 'Copy JSON'));

    if (inspection.status !== 'completed') {
      actCard.appendChild(el('button', { className: 'btn btn-primary btn-full', onClick: () => {
        inspection.status = 'completed';
        inspection.endedAt = new Date().toISOString();
        inspection.completedAt = inspection.endedAt;
        const completeData = buildExportJSON();
        saveNow().then(() => {
          uploadToGoogleDrive(completeData);
          render();
        });
      }}, 'Mark Complete'));
    } else {
      actCard.appendChild(el('div', { className: 'completed-banner' }, [
        el('strong', null, '\u2713 Inspection Complete'),
        el('p', null, 'Completed: ' + fmtDate(inspection.endedAt))
      ]));
    }
    c.appendChild(actCard);

    // Bottom nav
    c.appendChild(el('div', { className: 'bottom-nav' }, [
      el('button', { className: 'btn btn-outline btn-nav', onClick: () => {
        if (inspection.status !== 'completed') {
          currentStepIdx = stepList.length - 2; // last step before review
          screen = 'step';
        } else {
          screen = 'home'; inspection = null;
        }
        render();
      }}, inspection.status !== 'completed' ? '\u2190 Back to Steps' : '\u2190 Home'),
      el('button', { className: 'btn btn-outline btn-nav', onClick: () => { screen = 'home'; inspection = null; render(); } }, 'All Inspections')
    ]));

    root.appendChild(c);
    window.scrollTo(0, 0);
  }

  // ── Export JSON Builder ────────────────────────────────────
  function buildExportJSON() {
    const exp = {
      inspectionId: inspection.inspectionId,
      propertyAddress: inspection.propertyAddress,
      inspectorName: inspection.inspectorName,
      inspectionDate: inspection.inspectionDate,
      clientName: inspection.clientName,
      numberOfLevels: inspection.numberOfLevels,
      numberOfBedrooms: inspection.numberOfBedrooms,
      numberOfBathrooms: inspection.numberOfBathrooms,
      waterSource: inspection.waterSource,
      waterSourceDescription: inspection.waterSourceDescription || '',
      wifiNetwork: inspection.wifiNetwork || '',
      clientConcerns: inspection.clientConcerns || '',
      cleaningFrequency: inspection.cleaningFrequency || '',
      occupancyDuringInspection: inspection.occupancyDuringInspection || '',
      weatherConditions: inspection.weatherConditions || '',
      knownProblemAreas: inspection.knownProblemAreas || '',
      startedAt: inspection.startedAt,
      endedAt: inspection.endedAt,
      status: inspection.status,
      preAssessmentChecklist: cleanStepData(inspection.stepData?.equipment),
      arrivalSetup: cleanStepData(inspection.stepData?.arrival),
      deviceSetup: cleanStepData(inspection.stepData?.['device-setup']),
      outside: cleanStepData(inspection.stepData?.outside),
      radonSetup: cleanStepData(inspection.stepData?.radon),
      rooms: [],
      utilityRoom: cleanStepData(inspection.stepData?.utility),
      wrapUp: cleanStepData(inspection.stepData?.['final-checks']),
      customerDebrief: cleanStepData(inspection.stepData?.debrief),
      shippingChecklist: cleanStepData(inspection.stepData?.shipping),
      completedAt: inspection.completedAt || null
    };

    // Build rooms array from all room-type steps
    const roomTypes = ['room-test', 'bedroom', 'bathroom', 'living-area', 'kitchen-appliance', 'water-sample', 'atp-kitchen', 'kitchen-air', 'additional-room'];
    stepList.forEach(step => {
      if (roomTypes.includes(step.type)) {
        const d = inspection.stepData?.[step.id];
        if (d) {
          exp.rooms.push({
            roomName: d.roomName || step.name,
            type: step.type,
            level: step.phase,
            stepId: step.id,
            ...cleanStepData(d)
          });
        }
      }
    });

    return exp;
  }

  function cleanStepData(data) {
    if (!data) return {};
    const clean = {};
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('_')) continue; // skip internal keys except _photos
      clean[k] = v;
    }
    // Handle photos - include with metadata
    if (data._photos && data._photos.length) {
      clean.photos = data._photos.map(p => ({
        photoId: p.photoId,
        roomName: p.roomName,
        stepName: p.stepName,
        timestamp: p.timestamp,
        caption: p.caption,
        imageData: p.dataUrl
      }));
    }
    return clean;
  }

  // ── Init ───────────────────────────────────────────────────
  window.addEventListener('online', () => {
    const badge = document.querySelector('.online-badge');
    if (badge) { badge.textContent = 'Online'; badge.className = 'online-badge online'; }
  });
  window.addEventListener('offline', () => {
    const badge = document.querySelector('.online-badge');
    if (badge) { badge.textContent = 'Offline'; badge.className = 'online-badge offline'; }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(e => console.log('SW failed:', e));
  }

  // Retry any queued uploads on startup
  retryQueuedUploads();

  render();
})();
