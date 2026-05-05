// InHaus Inspector - Main Application
(function () {
  'use strict';

  // ── Google Drive Export Config ─────────────────────────────
  // Set this to your Google Apps Script web app URL
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzZoRaJtJs9Nvb3H1aLToccUazpqtij3pWNHl0tX3okFw9E47BewY7arvRJlp2XXsGYOw/exec';

  const { el, renderField, renderProgressBar, renderStatusBar, renderTimersBar, renderCheck, fmtDate, showToast, flashUncheckedItems, updateShowIf } = UI;

  // ── Field Definition Helpers ───────────────────────────────
  function text(key, label, opts) { return { key, type: 'text', label, ...opts }; }
  function textarea(key, label, opts) { return { key, type: 'textarea', label, ...opts }; }
  function num(key, label, opts) { return { key, type: 'number', label, ...opts }; }
  function date(key, label) { return { key, type: 'date', label }; }
  function timeInput(key, label) { return { key, type: 'text', label, inputType: 'time' }; }
  function dateTimeInput(key, label) { return { key, type: 'text', label, inputType: 'datetime-local' }; }
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
  function link(label, url) { return { type: 'link', label, url }; }
  function showIf(field, key, value) { return { ...field, showIf: { key, value } }; }

  // ── Reusable Field Groups ──────────────────────────────────
  const OBS_TAGS = [
    'Visible mold', 'Poor ventilation', 'Water staining', 'Condensation',
    'Musty odor', 'Active leak', 'Plumbing issue', 'HVAC concern',
    'Moisture concern (FLIR)', 'Other'
  ];

  function flirFields() {
    return [
      heading('FLIR Thermal Scan'),
      checklist('flirGuidance', null, [
        { key: 'flirScanStains', label: 'Scan for water stains, moisture intrusion, plumbing issues' },
        { key: 'flirStartExterior', label: 'Start with areas identified during exterior inspection' },
        { key: 'flirPhotoAll', label: 'Photograph ALL areas of concern' },
        { key: 'flirPhotoNoConcern', label: 'If no concerns: photograph area where mold test conducted' }
      ]),
      yesno('flirDone', 'FLIR scan completed'),
      showIf(yesno('flirConcerns', 'Areas of concern found'), 'flirDone', 'Yes'),
      showIf(text('flirImageLabel', 'FLIR Image Label', { placeholder: 'e.g. Bedroom 1 — Image #0023' }), 'flirDone', 'Yes'),
      showIf(text('flirPhotoNum', 'FLIR photo number noted'), 'flirDone', 'Yes'),
      showIf(num('flirMoisture', 'Moisture reading', { unit: '%', note: 'Flag if >20%' }), 'flirDone', 'Yes')
    ];
  }

  function flirLogFields() {
    return [
      heading('FLIR Thermal Scan'),
      checklist('flirGuidance', null, [
        { key: 'flirScanStains', label: 'Scan for water stains, moisture intrusion, plumbing issues' },
        { key: 'flirStartExterior', label: 'Start with areas identified during exterior inspection' },
        { key: 'flirPhotoAll', label: 'Photograph ALL areas of concern' },
        { key: 'flirPhotoNoConcern', label: 'If no concerns: photograph area where mold test conducted' }
      ]),
      check('flirScanned', 'Scan rooms for water stains, moisture intrusion, plumbing'),
      heading('FLIR Photo Log'),
      info('Add each room scanned with its FLIR image number'),
      text('flirImageLabel1', 'FLIR Image Label', { placeholder: 'e.g. Living Room — Image #0023' }),
      text('flirRoom1', 'Room name'),
      text('flirImg1', 'FLIR Image #'),
      text('flirImageLabel2', 'FLIR Image Label', { placeholder: 'e.g. Dining Room — Image #0024' }),
      text('flirRoom2', 'Room name'),
      text('flirImg2', 'FLIR Image #'),
      text('flirImageLabel3', 'FLIR Image Label', { placeholder: 'e.g. Hallway — Image #0025' }),
      text('flirRoom3', 'Room name'),
      text('flirImg3', 'FLIR Image #'),
      text('flirImageLabel4', 'FLIR Image Label', { placeholder: 'e.g. Room — Image #0026' }),
      text('flirRoom4', 'Room name (if needed)'),
      text('flirImg4', 'FLIR Image #'),
      text('flirImageLabel5', 'FLIR Image Label', { placeholder: 'e.g. Room — Image #0027' }),
      text('flirRoom5', 'Room name (if needed)'),
      text('flirImg5', 'FLIR Image #')
    ];
  }

  function bathroomLeakFields() {
    return [
      heading('Moisture Check'),
      check('leakUnderSink', 'Under sink checked'),
      check('leakToilet', 'Around toilet checked'),
      check('leakShowerTub', 'Baseboard around shower/tub checked'),
      check('leakGrout', 'Caulking/grout in tile checked')
    ];
  }

  function breezeFields(timerKey) {
    return [
      heading('Breeze ET Mold Test'),
      yesno('breezeDone', 'Breeze ET test performed'),
      showIf(timer(timerKey || 'breezeTimer', 'Breeze ET Timer (10 min)', 600), 'breezeDone', 'Yes')
    ];
  }

  function qtrakSection() {
    return [
      heading('Q-Trak 7585'),
      yesno('qtrakDownloaded', 'Q-Trak data downloaded from device?'),
      text('qtrakExportFilename', 'Q-Trak export filename or notes', { placeholder: 'e.g. QTRAK_2026-04-06_123MainSt.xlsx' })
    ];
  }

  function formaldehydeField() {
    return [];
  }

  function observationFields() {
    return [
      chips('observations', 'Observations', OBS_TAGS),
      textarea('notes', 'Notes', { placeholder: 'Enter observations, notes, or comments...' }),
      divider(),
      heading('Photos'),
      photo('Before'),
      photo('After')
    ];
  }

  function followUpFields() {
    return [
      divider(),
      heading('Follow-Up'),
      yesno('followUpNeeded', 'Follow-up recommended?'),
      showIf(sel('followUpTimeframe', 'Re-check in', ['3 months', '6 months', '12 months']), 'followUpNeeded', 'Yes'),
      showIf(textarea('followUpNote', 'What to watch for', { placeholder: 'e.g. Previous leak under sink, monitor for moisture return...' }), 'followUpNeeded', 'Yes'),
      showIf(photo('Follow-Up'), 'followUpNeeded', 'Yes')
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
      checklist('preAssessment', 'Pre-Assessment', [
        { key: 'reviewConcerns', label: 'Review customer concerns from customer intake form' },
        { key: 'reviewTechForm', label: 'Review and complete pre-assessment section of the technician form' },
        { key: 'reviewHome', label: 'Review home for general details (layout, etc.)' },
        { key: 'devicesCharged', label: 'All devices charged' },
        { key: 'corentiumRegistered', label: 'Airthings Corentium Pro registered to house (radon monitor)' },
        { key: 'waterTestsActivated', label: 'Water tests activated' },
        { key: 'radonPrepared', label: 'Radon test prepared' },
        { key: 'qtrakSetup', label: 'Q-Trak device set up (previous data deleted, room templates configured)' }
      ]),
      link('\uD83D\uDCCB Open Technician Form', 'https://docs.google.com/forms/d/e/1FAIpQLSdHZK80pgunf4IwWNpH5qcFNRPJFyXw0yeSB4mUBbgyszP0qA/viewform?usp=header'),
      checklist('airEquip', 'Air Testing Equipment', [
        { key: 'qtrak', label: 'Q-Trak 7585 \u2014 charged, previous data deleted, rooms configured' },

        { key: 'flir', label: 'FLIR MR277' },
        { key: 'airthings', label: 'Airthings Corentium Pro (radon monitor app) device + charging cube' },
        { key: 'breezeET', label: 'Breeze ET pump + tripod' },
        { key: 'breezeST', label: 'Breeze ST spore traps (6)' },
        { key: 'breezeSwabs', label: 'Breeze mold swabs (2)' },
        { key: 'boulderBlue', label: 'Boulder Blue fan + filter' }
      ]),
      checklist('radonEquip', 'Radon', [
        { key: 'corentium', label: 'Airthings Corentium Pro radon monitor + tripod' }
      ]),
      checklist('waterEquip', 'Water Testing', [
        { key: 'waterKit', label: 'Full panel water test kit (SafeHome)' },
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

  // ── #3: Arrival & Setup (expanded) ─────────────────────────
  function getArrivalFields() {
    return [
      timeInput('assessmentStartTime', 'Assessment Start Time'),
      check('homeownerGreeted', 'Homeowner greeted (or entry instructions noted)'),

      check('tarpPlaced', 'Tarp placed in entryway'),
      check('equipmentUnloaded', 'Equipment unloaded from car to tarp'),
      check('equipmentTidy', 'Equipment tidy, not blocking doorways'),
      divider(),
      heading('Homeowner Engagement'),
      check('reviewConcerns', 'Review customer concerns from intake form'),
      check('askAdditional', 'Ask about additional concerns / problem areas'),
      check('testsExplained', 'Explain tests being performed'),
      check('durationExplained', 'Estimate testing duration'),
      check('sedentaryAdvised', 'Ask homeowner to remain sedentary during testing'),
      divider(),
      heading('Airthings View Plus Setup'),
      check('airthingsPaired', 'Pair to Airthings account'),
      check('airthingsWifiConnected', 'Connect to home wifi'),
      check('airthingsPlaced', 'Place at breathing height, away from vents/fans/windows/doors'),
      info('Keep 3ft from vents, fans, windows, doors'),
      divider(),
      heading('Boulder Blue Fan'),
      checklist('boulderBlueSetup', 'Boulder Blue Setup', [
        { key: 'filterInserted', label: 'Filter inserted into fan' },
        { key: 'fanPluggedIn', label: 'Fan plugged in at main living space with access to airflow' },
        { key: 'allergenPlacement', label: 'If client has specific allergen concerns: placed in desired location' }
      ]),
      text('boulderBlueSampleId', 'Boulder Blue Sample ID', { placeholder: 'e.g. B2BJC43G' }),
      text('boulderBlueTestLocation', 'Boulder Blue Test Location', { placeholder: 'e.g. Living Room' }),
      timeInput('boulderBlueStartTime', 'Boulder Blue Start Time (need 2 hours)'),
      timer('boulderBlueTimer', 'Boulder Blue Fan Timer (2 hours)', 7200),
      divider(),
      heading('Q-Trak Sensor Test'),
      check('qtrakSensorTest', 'Hold Q-Trak to alcohol wipe \u2014 confirm elevated reading before starting'),
      info('During sensor test, you should see Formaldehyde and VOC readings spike.'),
      divider(),
      text('utilityRoomLevel', 'Utility Room Location \u2014 which level is it on?'),
      divider(),
      textarea('arrivalNotes', 'Notes'),
      photo('Arrival Setup')
    ];
  }

  function getDeviceSetupFields() {
    return [
      heading('PFAS Water Test'),
      radio('pfasSetup', 'PFAS water test at kitchen faucet', ['Yes', 'No', 'Not requested']),
      showIf(text('pfasKitBarcode', 'PFAS Test Kit # / Barcode', { placeholder: 'e.g. WTK_PFAS_27099' }), 'pfasSetup', 'Yes'),
      showIf(timer('pfasTimer', 'PFAS Drain Timer', 3600), 'pfasSetup', 'Yes'),
      showIf(info('Note: needs ~1 hour to drain'), 'pfasSetup', 'Yes'),
      textarea('notes', 'Notes'),
      photo('Device Setup')
    ];
  }

  // ── #2: Exterior Assessment (new) ──────────────────────────
  function getExteriorFields() {
    return [
      checklist('equipNeededExterior', 'Equipment Needed', [
        { key: 'breezeOutdoor', label: 'Breeze ET pump + tripod' },
        { key: 'qtrakOut', label: 'Q-Trak 7585' },
        { key: 'flirExt', label: 'FLIR MR277' }
      ]),
      divider(),
      heading('Breeze ET Outdoor Control'),
      checklist('breezeOutdoorSetup', 'Setup Checklist', [
        { key: 'pumpSetUp', label: 'Set up pump' },
        { key: 'placement', label: 'Place 6\u201310 ft from main entrance' },
        { key: 'tripodHeight', label: 'Set to full tripod height (60\u2033)' }
      ]),
      timer('breezeOutdoorTimer', 'Breeze ET Outdoor Timer (10 min)', 600),
      divider(),
      heading('Q-Trak Outdoor Measurement'),
      check('qtrakOutdoorDone', 'Take 1-min outdoor measurement using outdoor room template'),
      timer('qtrakOutdoorTimer', 'Q-Trak Outdoor Timer (1 min)', 60),
      divider(),
      heading('What to Look For'),
      checklist('exteriorGuidance', null, [
        { key: 'visualInspection', label: 'Conduct visual inspection of exterior — look for signs that might indicate further investigation inside' },
        { key: 'leaksStains', label: 'Visible leaks or water stains on exterior walls' },
        { key: 'poolingWater', label: 'Pooling water or poor drainage near foundation' },
        { key: 'foundationCracks', label: 'Cracks in foundation or walls' },
        { key: 'roofDamage', label: 'Damaged or missing roof elements' },
        { key: 'gapsSeals', label: 'Gaps around windows, doors, or utility penetrations' }
      ]),
      divider(),
      heading('Visual Exterior Inspection'),
      info('Run during mold sample time'),
      chips('sidingTypes', 'Siding Type(s)', ['Wood', 'Brick', 'Stucco', 'Vinyl', 'Fiber Cement', 'Stone', 'Metal', 'Other (specify)']),
      text('moldTestLocations', 'Mold test locations identified'),
      checklist('exteriorPhotos', 'Photo Checklist', [
        { key: 'insulationPlumbing', label: 'Insulation around plumbing lines' },
        { key: 'caulkingFlashing', label: 'Caulking and flashing' },
        { key: 'lotGrading', label: 'Lot grading' },
        { key: 'sidingType', label: 'Type of siding' },
        { key: 'ventsCondition', label: 'Vents condition' },
        { key: 'iceDamsGutters', label: 'Ice dams / gutters' },
        { key: 'roofCondition', label: 'Roof condition' },
        { key: 'weatherScreenshot', label: 'Weather app screenshot' }
      ]),
      textarea('exteriorNotes', 'Observations & Notes'),
      photo('Exterior Assessment')
    ];
  }

  // ── Radon setup (expanded for #4) ──────────────────────────
  function getRadonFields() {
    return [
      checklist('equipNeededLowest', 'Equipment Needed', [
        { key: 'radonMonitor', label: 'Airthings Corentium Pro (radon monitor)' },
        { key: 'breezeLowest', label: 'Breeze ET pump + tripod' },
        { key: 'qtrakLowest', label: 'Q-Trak 7585' },
        { key: 'flirLowest', label: 'FLIR MR277' }
      ]),
      divider(),
      heading('Radon Monitor Placement'),
      check('radonTripod', 'Place on tripod'),
      check('radon3ft', '3 feet from exterior wall'),
      check('radon20in', '20+ inches above floor'),
      check('radonCentralized', 'Central location, not high-traffic'),
      check('radonWindowsClosed', 'Windows and doors closed'),
      divider(),
      heading('Radon App Setup'),
      check('radonInitialMeasurement', 'Select "Initial measurement"'),
      check('radon48hr', 'Select "48-hour test with 4-hour calibration"'),
      divider(),
      check('radonMultipleMonitors', 'Set up multiple monitors if >2,000 sq ft or different foundations'),
      text('radonLocation', 'Radon Monitor Location'),
      showIf(text('secondMonitorLocation', 'Second monitor location'), 'radonMultipleMonitors', true),
      photo('Radon Setup')
    ];
  }

  // ── Room test (with FLIR log + bathroom leak for #4) ───────
  function getRoomTestFields() {
    return [
      info('Complete this section for each room in the lower/basement level. Add additional rooms using the button at the bottom of the page.'),
      heading('Room Setup'),
      checklist('roomSetup', null, [
        { key: 'qtrakFloorplan', label: 'Open Q-Trak floorplan room template and draw in rooms or correct floorplan if needed' },
        { key: 'labelRooms', label: 'Label rooms using Q-Trak room template naming convention (e.g. Bedroom 1, Bedroom 2)' }
      ]),
      text('roomName', 'Room Name', { required: true }),
      radio('roomType', 'Room Type', ['Bedroom', 'Bathroom', 'Office', 'Storage', 'Other']),
      ...flirFields(),
      ...breezeFields(),
      ...qtrakSection(),
      ...formaldehydeField(),
      ...bathroomLeakFields().map(f => showIf(f, 'roomType', 'Bathroom')),
      ...followUpFields(),
      ...observationFields()
    ];
  }

  // ── Utility Room (expanded for #8) ─────────────────────────
  function getUtilityFields() {
    return [
      checklist('equipNeededUtility', 'Equipment Needed', [
        { key: 'flirUtil', label: 'FLIR MR277' },
        { key: 'qtrakUtil', label: 'Q-Trak 7585' }
      ]),
      divider(),
      text('levelLocation', 'Level location'),
      divider(),
      heading('HVAC System'),
      yesno('forcedHVAC', 'Forced HVAC System present?'),
      sel('heatingType', 'Heating Source Type', ['Natural Gas Furnace', 'Electric Furnace', 'Electric Baseboard', 'Heat Pump', 'Radiant Floor Heating', 'Boiler', 'Wood Stove / Pellet Stove', 'Propane', 'Other (specify)']),
      sel('acType', 'Air Conditioning Source Type', ['Central AC', 'Ductless Mini-Split System', 'Window AC Unit(s)', 'Portable AC Unit(s)', 'Heat Pump (Cooling Mode)', 'No Air Conditioning', 'Other (specify)']),
      checklist('ventilationType', 'Ventilation Type', [
        { key: 'bathExhaust', label: 'Bathroom Exhaust Fan(s)' },
        { key: 'hrv', label: 'HRV (Heat Recovery Ventilator)' },
        { key: 'erv', label: 'ERV (Energy Recovery Ventilator)' },
        { key: 'ventNone', label: 'None' },
        { key: 'ventNotSure', label: 'Not sure' }
      ]),
      divider(),
      heading('HVAC Filter'),
      text('filterSize', 'Filter size'),
      text('filterMakeModel', 'Filter make / model / brand'),
      text('filterRating', 'MERV / HEPA rating'),
      radio('filterCondition', 'Filter condition', ['Good', 'Fair', 'Poor']),
      check('filterCleaned', 'Filters checked and cleaned if needed'),
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
      showIf(radio('radonMitActive', 'Radon system type', ['Active', 'Passive']), 'radonMitigationPresent', 'Yes'),
      showIf(text('radonMitType', 'Type / Model / Serial'), 'radonMitigationPresent', 'Yes'),
      showIf(photo('Radon Mitigation'), 'radonMitigationPresent', 'Yes'),
      yesno('uvSystemPresent', 'UV or water disinfection system present'),
      showIf(text('uvSystemType', 'Type / Model / Serial'), 'uvSystemPresent', 'Yes'),
      showIf(photo('UV System'), 'uvSystemPresent', 'Yes'),
      yesno('otherAirPurifierPresent', 'Other air purifiers or enhanced filtration (e.g. portable units)?'),
      showIf(text('otherAirPurifierType', 'Type / Model / Serial'), 'otherAirPurifierPresent', 'Yes'),
      showIf(photo('Other Air Purifier'), 'otherAirPurifierPresent', 'Yes'),
      yesno('airFiltrationPresent', 'Air filtration and/or HVAC air cleansing system present'),
      showIf(text('airFiltType', 'Type / Model / Serial'), 'airFiltrationPresent', 'Yes'),
      showIf(photo('Air Filtration'), 'airFiltrationPresent', 'Yes'),
      yesno('waterFiltrationPresent', 'Water filtration system present'),
      showIf(text('waterFiltType', 'Type / Model / Serial'), 'waterFiltrationPresent', 'Yes'),
      showIf(photo('Water Filtration'), 'waterFiltrationPresent', 'Yes'),
      yesno('waterSofteningPresent', 'Water softening system present'),
      showIf(text('waterSoftType', 'Type / Model / Serial'), 'waterSofteningPresent', 'Yes'),
      showIf(photo('Water Softening'), 'waterSofteningPresent', 'Yes'),
      textarea('notes', 'General notes'),
      photo('Utility Room')
    ];
  }

  function getBedroomFields() {
    return [
      info('Complete this section for each bedroom.'),
      checklist('equipNeededBedroom', 'Equipment Needed', [
        { key: 'breezeRooms', label: 'Breeze ET pump + tripod + spore traps' },
        { key: 'flirRooms', label: 'FLIR MR277' },
        { key: 'qtrakRooms', label: 'Q-Trak 7585' }
      ]),
      divider(),
      heading('Room Setup'),
      checklist('roomSetup', null, [
        { key: 'qtrakFloorplan', label: 'Open Q-Trak floorplan room template and draw in rooms or correct floorplan if needed' },
        { key: 'labelRooms', label: 'Label rooms using Q-Trak room template naming convention (e.g. Bedroom 1, Bedroom 2)' }
      ]),
      text('roomName', 'Room Name', { required: true }),
      ...flirFields(),
      ...breezeFields(),
      ...qtrakSection(),
      ...formaldehydeField(),
      divider(),
      ...followUpFields(),
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
      ...followUpFields(),
      ...observationFields()
    ];
  }

  // ── Living area (with FLIR log + bathroom leak for #4) ─────
  function getLivingAreaFields() {
    return [
      checklist('equipNeededMain', 'Equipment Needed', [
        { key: 'breezeMain', label: 'Breeze ET pump + tripod + spore traps' },
        { key: 'flirMain', label: 'FLIR MR277' },
        { key: 'qtrakMain', label: 'Q-Trak 7585' }
      ]),
      divider(),
      heading('Room Setup'),
      checklist('roomSetup', null, [
        { key: 'qtrakFloorplan', label: 'Open Q-Trak floorplan room template and draw in rooms or correct floorplan if needed' },
        { key: 'labelRooms', label: 'Label rooms using Q-Trak room template naming convention (e.g. Bedroom 1, Bedroom 2)' }
      ]),
      text('roomNames', 'Room(s) tested (e.g., Living Room, Dining Room)', { required: true }),
      ...flirLogFields(),
      ...breezeFields(),
      ...qtrakSection(),
      ...formaldehydeField(),
      ...followUpFields(),
      ...observationFields()
    ];
  }

  // ── Kitchen appliance (expanded for #5) ────────────────────
  function getKitchenApplianceFields() {
    return [
      checklist('equipNeededKitchen', 'Equipment Needed', [
        { key: 'breezeKitchen', label: 'Breeze ET pump + tripod + spore traps' },
        { key: 'flirKitchen', label: 'FLIR MR277' },
        { key: 'qtrakKitchen', label: 'Q-Trak 7585' },
        { key: 'atpKitchen', label: 'ATP device + swabs' }
      ]),
      divider(),
      heading('Stove / Range'),
      sel('stoveType', 'Stove/Range Type', ['Gas', 'Electric (Radiant)', 'Induction', 'Dual-Fuel', 'Other (specify)']),
      sel('exhaustHoodType', 'Type of cooking exhaust hood or vent', ['Under cabinet range hood', 'Over the range microwave with vent', 'Wall mount range hood', 'Ceiling mount range hood', 'Downdraft range hood', 'None', 'Other (specify)']),
      sel('exhaustVented', 'Is cooking exhaust vented to outdoors?', ['Ducted (to outside)', 'Ductless (recirculating)', 'Unknown']),
      divider(),
      heading('Kitchen Water Flush'),
      yesno('waterFlushed', 'Water flushed 5 minutes before sampling'),
      showIf(timer('flushTimer', 'Kitchen Water Flush Timer (5 min)', 300), 'waterFlushed', 'Yes'),
      divider(),
      heading('Appliance Inspection'),
      info('Check and clean each area. Take before/after photos where applicable.'),
      checklist('appliances', null, [
        { key: 'fridge', label: 'Under refrigerator \u2014 checked, cleaned', subFields: [{ key: 'fridgeFindings', label: 'Notable findings' }] },
        { key: 'dishwasher', label: 'Under dishwasher \u2014 checked, cleaned', subFields: [{ key: 'dishwasherFindings', label: 'Notable findings' }] },
        { key: 'dishwasherFilter', label: 'Dishwasher filter \u2014 checked, cleaned', subFields: [{ key: 'dishFilterFindings', label: 'Notable findings' }] },
        { key: 'underSink', label: 'Under sink \u2014 checked, cleaned', subFields: [{ key: 'sinkFindings', label: 'Notable findings' }] },
        { key: 'iceMaker', label: 'Under ice maker \u2014 checked, cleaned', subFields: [{ key: 'iceMakerFindings', label: 'Notable findings' }] },
        { key: 'backsplash', label: 'Grout/caulking on backsplash \u2014 checked', subFields: [{ key: 'backsplashFindings', label: 'Notable findings' }] },
        { key: 'stoveVent', label: 'Above stove vent \u2014 checked, cleaned (before/after photos)', subFields: [{ key: 'stoveVentFindings', label: 'Notable findings' }] }
      ]),
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

  function getWaterSampleFields() {
    return [
      info('Label bottles with customer last name and address. Ensure chain of custody forms are filled out.'),
      heading('Sample Labeling'),
      checklist('sampleLabeling', null, [
        { key: 'bottlesLabeled', label: 'Bottles labeled with client last name and property address' },
        { key: 'preMadeLabels', label: 'Pre-made labels applied (if available)' },
        { key: 'chainOfCustody', label: 'Chain of custody forms completed for each sample' }
      ]),
      divider(),
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
      info('Reminder: Collect PFAS sample from kitchen faucet (should have been draining since Device Setup)'),
      radio('pfasStatus', 'PFAS test', ['Collected', 'Not requested']),
      showIf(text('pfasSampleId', 'Sample ID'), 'pfasStatus', 'Collected'),
      textarea('notes', 'Notes')
    ];
  }

  function getAtpKitchenFields() {
    return [
      text('atpSurface', 'Surface tested', { required: true }),
      info('\u26a0\ufe0f Both a Before photo and After photo are required for each ATP test.'),
      num('atpPreRLU', 'Pre-test RLU reading', { unit: 'RLU' }),
      radio('atpPreStatus', 'Pre-test status (Pass if below 100 RLU, Fail if 100 or above)', ['Pass', 'Fail']),
      heading('Before Photo'),
      { type: 'photo', stepName: 'ATP Before', photoKey: '_atpBeforePhotos' },
      divider(),
      yesno('atpCleaned', 'Surface cleaned with soap and water'),
      num('atpPostRLU', 'Post-test RLU reading', { unit: 'RLU' }),
      radio('atpPostStatus', 'Post-test status (Pass if below 100 RLU, Fail if 100 or more)', ['Pass', 'Fail']),
      heading('After Photo'),
      { type: 'photo', stepName: 'ATP After', photoKey: '_atpAfterPhotos' },
      textarea('notes', 'Notes')
    ];
  }

  function getKitchenAirFields() {
    return [
      ...flirFields(),
      ...breezeFields('kitchenBreezeTimer'),
      ...qtrakSection(),
      ...formaldehydeField(),
      ...followUpFields(),
      ...observationFields()
    ];
  }

  function getAdditionalRoomFields() {
    return [
      text('roomName', 'Room Name'),
      textarea('reasonForInclusion', 'Reason for inclusion'),
      ...flirFields(),
      ...breezeFields(),
      ...qtrakSection(),
      ...formaldehydeField(),
      ...followUpFields(),
      ...observationFields()
    ];
  }

  // ── Property Details (moved near end) ─────────────────────
  function getPropertyDetailsFields() {
    return [
      heading('Property Details'),
      sel('residenceType', 'Residence Type', ['Single-Family Home', 'Townhome', 'Condo', 'Duplex', 'Apartment', 'Other']),
      num('yearBuilt', 'Year Home Was Built'),
      text('squareFootage', 'Approximate Square Footage'),
      sel('basement', 'Basement', ['Yes - Finished', 'Yes - Unfinished', 'No', 'Partial']),
      divider(),
      heading('Property Details (Observed)'),
      sel('carpetedRooms', 'Number of Carpeted Rooms', ['0', '1', '2', '3', '4', '5', '6+']),
      yesno('fireplacePresent', 'Fireplace(s) in home?'),
      showIf(chips('fireplace', 'Fireplace type(s)', ['Wood Burning', 'Gas', 'Electric']), 'fireplacePresent', 'Yes'),
      showIf(num('fireplaceCount', 'How many fireplaces?'), 'fireplacePresent', 'Yes'),
      sel('pets', 'Pets in Home', ['No', 'Yes - Dog', 'Yes - Cat', 'Yes - Dog and Cat', 'Yes - Other']),
      sel('smokingVaping', 'Smoking or Vaping in Home', ['No', 'Yes - Indoors', 'Yes - Outdoors Only']),
      divider(),
      heading('Assessment Conditions'),
      sel('windowsOpen', 'Windows open during assessment', ['No', 'Yes', 'Some']),
      radio('occupancyDuringInspection', 'Home occupancy during inspection', ['Occupied - Active', 'Occupied - Passive', 'Unoccupied']),
      showIf(textarea('occupancyActivities', 'Describe occupant activities (e.g. cooking, cleaning, watching TV)', { placeholder: 'e.g. Owner was cooking in kitchen during assessment' }), 'occupancyDuringInspection', 'Occupied - Active'),
      showIf(textarea('occupancyActivities', 'Describe occupant activities', { placeholder: 'e.g. Owner present but resting in bedroom' }), 'occupancyDuringInspection', 'Occupied - Passive'),
      text('weatherConditions', 'Weather conditions')
    ];
  }

  // ── #6: Before Leaving (expanded) ──────────────────────────
  function getFinalChecksFields() {
    return [
      heading('Boulder Blue Completion'),
      timeInput('boulderBlueEndTime', 'Boulder Blue End Time'),
      text('boulderBlueTestDuration', 'Boulder Blue Test Duration', { placeholder: 'e.g. 2 hours 15 minutes' }),
      info('Compare to start time captured in Arrival & Setup. Must be 2+ hours.'),
      divider(),
      checklist('finalChecks', 'Final Checks Before Leaving', [
        { key: 'breezeCollected', label: 'All Breeze ET tests collected and spore traps packed' },
        { key: 'boulderBlueDone', label: 'Boulder Blue fan run for 2 hours \u2014 filter collected and packed' },
        { key: 'pfasCollected', label: 'PFAS test collected from sink' },
        { key: 'waterLabeled', label: 'Water samples labeled and ready to ship' },
        { key: 'appliancesRestored', label: 'All appliances returned to original state' },
        { key: 'doorsLightsRestored', label: 'All doors/lights returned to original state' },
        { key: 'radonLeftInPlace', label: 'Radon monitor left in place' },
        { key: 'formComplete', label: 'Technician form fully completed' },
        { key: 'photosUploaded', label: 'All photos uploaded/captured' },
        { key: 'boulderBlueRegistered', label: 'Boulder Blue filter sample registered (Jonah Ventures portal)' }
      ]),
    ];
  }

  function getDebriefFields() {
    return [
      timeInput('assessmentEndTime', 'Assessment End Time'),
      divider(),
      info('Perform the customer debrief before completing the final departure checks.'),
      check('informComplete', 'Inform customer assessment is complete'),
      check('adviseReport', 'Advise report in approximately 3 weeks'),
      check('remindRadon', 'Remind about radon monitor in basement'),
      info('Radon pickup auto-set to 54 hrs after inspection start \u2014 override below if needed'),
      dateTimeInput('radonPickupTime', 'Radon Pickup Date/Time'),
      divider(),
      yesno('debriefCompleted', 'Debrief completed'),
      yesno('radonPickupReminder', 'Homeowner reminded about radon pickup'),
      yesno('reportDateCommunicated', 'Expected report date communicated'),
      textarea('debriefNotes', 'Notes from debrief')
    ];
  }

  // ── #7: Post-Assessment (new) ──────────────────────────────
  function getPostAssessmentFields() {
    return [
      heading('Sample Shipping'),
      checklist('shipping', 'Shipping Checklist', [
        { key: 'breezeST', label: 'Breeze ST spore traps \u2014 packed for FedEx overnight', subFields: [{ key: 'breezeTracking', label: 'Tracking number' }] },
        { key: 'boulderBlueShip', label: 'Boulder Blue filter \u2014 packed for UPS to Jonah Ventures, 5485 Conestoga Ct #210, Boulder CO 80301', subFields: [{ key: 'boulderBlueTracking', label: 'Tracking number' }] },
        { key: 'waterPanelShip', label: 'Water panel \u2014 prepaid label + package sent', subFields: [{ key: 'waterTracking', label: 'Tracking number' }] },
        { key: 'pfasShip', label: 'PFAS (Cyclopure) \u2014 prepaid label + package sent', subFields: [{ key: 'pfasTracking', label: 'Tracking number' }] },
        { key: 'microplasticsShip', label: 'Microplastics (Brooks Applied Labs) \u2014 packaged and shipped', subFields: [{ key: 'microTracking', label: 'Tracking number' }] },
        { key: 'chainOfCustody', label: 'Chain of custody forms completed (SafeHome, Cyclopure, Brooks Applied Labs, Priority Lab)' }
      ]),
      divider(),
      heading('Data Management'),
      checklist('dataManagement', null, [
        { key: 'qtrakExported', label: 'Q-Trak data downloaded locally and exported to spreadsheet' }
      ]),
      divider(),
      heading('Final Check'),
      checklist('finalCheck', null, [
        { key: 'allSectionsComplete', label: 'All form sections completed' },
        { key: 'allPhotosUploaded', label: 'All photos uploaded' },
        { key: 'allSamplesShipped', label: 'All samples shipped' },
        { key: 'assessmentComplete', label: 'Assessment marked Complete' }
      ])
    ];
  }

  // ── Step Type → Fields Mapping ─────────────────────────────
  const STEP_FIELDS = {
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

  // ── Phases ─────────────────────────────────────────────────
  const PHASES = [
    { id: 'setup', name: 'Setup', icon: '1' },
    { id: 'arrival', name: 'Arrival', icon: '2' },
    { id: 'exterior', name: 'Exterior', icon: '3' },
    { id: 'lowest', name: 'Lowest Livable Level (e.g. Basement)', icon: '4' },
    { id: 'utility', name: 'Utility', icon: '5' },
    { id: 'rooms', name: 'Bedrooms & Bathrooms', icon: '6' },
    { id: 'main', name: 'Kitchen', icon: '7' },
    { id: 'supplementary', name: 'Additional Rooms', icon: '8' },
    { id: 'wrapup', name: 'Customer Debrief', icon: '9' },
    { id: 'propdetails', name: 'Property Details', icon: '10' },
    { id: 'post', name: 'Post', icon: '11' },
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
    steps.push({ id: 'arrival', type: 'arrival', phase: 'arrival', name: 'Arrival & Setup' });
    steps.push({ id: 'device-setup', type: 'device-setup', phase: 'arrival', name: 'Device Setup' });

    // Exterior Assessment (#2)
    steps.push({ id: 'exterior', type: 'exterior', phase: 'exterior', name: 'Exterior Assessment' });

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
      steps.push({ id: 'bedroom-' + i, type: 'bedroom', phase: 'rooms', name: 'Bedroom ' + (i + 1), index: i });
    }
    const numBath = parseInt(insp.numberOfBathrooms) || 1;
    for (let i = 0; i < numBath; i++) {
      steps.push({ id: 'bathroom-' + i, type: 'bathroom', phase: 'rooms', name: 'Bathroom ' + (i + 1), index: i });
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

    // Wrap Up — Debrief first, then final departure checks
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
    if (stepDef.type === 'equipment') {
      const data = getStepData(stepDef.id);
      return validateEquipment(data);
    }
    return [];
  }

  // Returns non-blocking warnings (shown as toast but navigation still allowed)
  function warnStep(stepDef) {
    if (stepDef.type === 'atp-kitchen') {
      const data = getStepData(stepDef.id);
      const warnings = [];
      const beforePhotos = data._atpBeforePhotos || [];
      const afterPhotos = data._atpAfterPhotos || [];
      if (!beforePhotos.length) warnings.push('ATP Before photo missing');
      if (!afterPhotos.length) warnings.push('ATP After photo missing');
      return warnings;
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
    const newStepId = section === 'lowest' ? 'lowest-room-' + idx : 'additional-' + idx;
    const newIdx = stepList.findIndex(s => s.id === newStepId);
    if (newIdx >= 0) currentStepIdx = newIdx;

    saveNow().then(() => { render(); window.scrollTo(0, 0); });
  }

  // ── Google Drive Upload ─────────────────────────────────────
  function showUploadBanner(type, msg) {
    const old = document.getElementById('upload-banner');
    if (old) old.remove();
    const banner = el('div', { id: 'upload-banner', className: 'upload-banner upload-' + type });
    banner.textContent = msg;
    document.body.appendChild(banner);
    if (type === 'success') setTimeout(() => { if (banner.parentNode) banner.remove(); }, 5000);
  }

  function extractAllPhotosFromExport(exportData) {
    const photos = [];
    function pickPhoto(p, fallbackRoomName) {
      return {
        photoId: p.photoId || '',
        imageData: p.imageData || '',
        caption: p.caption || '',
        roomName: p.roomName || fallbackRoomName || '',
        stepName: p.stepName || '',
        timestamp: p.timestamp || ''
      };
    }
    const sectionKeys = ['preAssessmentChecklist', 'arrivalSetup', 'deviceSetup', 'exteriorAssessment',
                         'radonSetup', 'utilityRoom', 'wrapUp', 'customerDebrief', 'postAssessment'];
    sectionKeys.forEach(key => {
      const s = exportData[key];
      if (s && s.photos) photos.push(...s.photos.map(p => pickPhoto(p)));
    });
    (exportData.rooms || []).forEach(room => {
      if (room.photos) photos.push(...room.photos.map(p => pickPhoto(p, room.roomName)));
      if (room.atpBeforePhotos) photos.push(...room.atpBeforePhotos.map(p => pickPhoto(p, room.roomName)));
      if (room.atpAfterPhotos) photos.push(...room.atpAfterPhotos.map(p => pickPhoto(p, room.roomName)));
    });
    return photos;
  }

  function stripPhotosFromExport(exportData) {
    const stripped = JSON.parse(JSON.stringify(exportData));
    const sectionKeys = ['preAssessmentChecklist', 'arrivalSetup', 'deviceSetup', 'exteriorAssessment',
                         'radonSetup', 'utilityRoom', 'wrapUp', 'customerDebrief', 'postAssessment'];
    sectionKeys.forEach(key => { if (stripped[key]) delete stripped[key].photos; });
    (stripped.rooms || []).forEach(room => {
      delete room.photos;
      delete room.atpBeforePhotos;
      delete room.atpAfterPhotos;
    });
    return stripped;
  }

  // ── Real-time single-photo upload ─────────────────────────
  async function uploadPhotoImmediate(photo, inspectionId, clientName, propertyAddress) {
    if (!GOOGLE_SCRIPT_URL || !inspectionId) return;
    try {
      const payload = {
        photoUploadOnly: true,
        inspectionId: inspectionId,
        clientName: clientName || '',
        propertyAddress: propertyAddress || '',
        photos: [{
          photoId: photo.photoId || '',
          roomName: photo.roomName || '',
          stepName: photo.stepName || '',
          imageData: photo.dataUrl || '',
          caption: photo.caption || ''
        }]
      };
      await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      photo._uploaded = true;
    } catch(e) {
      console.warn('Real-time photo upload failed, will retry on export:', e);
    }
  }
  window.uploadPhotoImmediate = uploadPhotoImmediate;

  async function sendToGoogleScript(exportData) {
    // Always strip photos from main payload — send data first, then photos separately
    const mainPayload = stripPhotosFromExport(exportData);
    const allPhotos = extractAllPhotosFromExport(exportData);

    await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mainPayload)
    });

    if (allPhotos.length > 0) {
      const photoPayload = {
        photoUploadOnly: true,
        inspectionId: exportData.inspectionId,
        clientName: exportData.clientName,
        propertyAddress: exportData.propertyAddress,
        photos: allPhotos
      };
      showUploadBanner('pending', 'Uploading photos\u2026');
      await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(photoPayload)
      });
    }
  }

  async function submitInspection(exportData) {
    if (!GOOGLE_SCRIPT_URL) return true;
    showUploadBanner('pending', 'Uploading to Google Drive\u2026');
    try {
      await sendToGoogleScript(exportData);
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
        await sendToGoogleScript(item);
        await DB.removeFromQueue(item.inspectionId);
      } catch (e) { break; }
    }
  }

  window.addEventListener('online', () => { retryQueuedUploads(); });

  // ── Room Navigation Drawer ─────────────────────────────────
  function buildRoomDrawer() {
    const DRAWER_GROUPS = [
      { label: 'SETUP', phases: ['setup', 'arrival', 'exterior'] },
      { label: 'LOWER LEVEL', phases: ['lowest', 'utility'] },
      { label: 'UPPER LEVEL', phases: ['rooms'] },
      { label: 'MAIN LEVEL', phases: ['main'] },
      { label: 'ADDITIONAL ROOMS', phases: ['supplementary'] },
      { label: 'WRAP-UP', phases: ['wrapup', 'propdetails', 'post'] }
    ];

    const overlay = el('div', { id: 'room-drawer-overlay', className: 'room-drawer-overlay' });
    const drawer = el('div', { className: 'room-drawer' });

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    drawer.addEventListener('click', e => e.stopPropagation());

    drawer.appendChild(el('div', { className: 'room-drawer-handle' }));
    drawer.appendChild(el('div', { className: 'room-drawer-title' }, '\uD83D\uDCCD Navigate'));

    const scrollArea = el('div', { className: 'room-drawer-scroll' });

    DRAWER_GROUPS.forEach(group => {
      const groupSteps = stepList.filter(s => group.phases.includes(s.phase) && s.type !== 'review');
      if (!groupSteps.length) return;

      scrollArea.appendChild(el('div', { className: 'room-drawer-group-label' }, group.label));

      groupSteps.forEach(s => {
        const sData = (inspection.stepData && inspection.stepData[s.id]) || {};
        const completed = !!sData._completedAt;
        const visited = !!sData._visited;
        const sIdx = stepList.indexOf(s);
        const isCurrent = sIdx === currentStepIdx;

        const statusText = completed ? '\u2713' : (visited ? '\u25cf' : '');
        const cls = 'room-drawer-item' +
          (isCurrent ? ' room-item-current' : '') +
          (completed ? ' room-item-done' : '') +
          (visited && !completed ? ' room-item-partial' : '');

        scrollArea.appendChild(el('div', {
          className: cls,
          onClick: () => {
            currentStepIdx = sIdx;
            overlay.remove();
            render();
            window.scrollTo(0, 0);
          }
        }, [
          el('span', { className: 'room-item-name' }, s.name),
          statusText ? el('span', { className: 'room-item-status' + (completed ? ' status-done' : ' status-partial') }, statusText) : null
        ]));
      });
    });

    scrollArea.appendChild(el('button', {
      type: 'button',
      className: 'btn btn-outline btn-full room-drawer-add-btn',
      onClick: () => { overlay.remove(); addDynamicRoom('additional'); }
    }, '+ Add Room'));

    drawer.appendChild(scrollArea);
    overlay.appendChild(drawer);
    return overlay;
  }

  // ── Search ─────────────────────────────────────────────────
  function openSearch() {
    const existing = document.getElementById('search-overlay');
    if (existing) { existing.remove(); return; }

    const searchIndex = [];
    stepList.forEach(s => {
      if (s.type === 'review') return;
      const sIdx = stepList.indexOf(s);
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

    const overlay = el('div', { id: 'search-overlay', className: 'search-overlay' });
    const panel = el('div', { className: 'search-panel' });

    const inputRow = el('div', { className: 'search-input-row' });
    const inp = el('input', {
      type: 'search', className: 'search-input',
      placeholder: 'Search sections, fields, rooms\u2026',
      autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off'
    });
    const closeBtn = el('button', {
      type: 'button', className: 'search-close-btn',
      onClick: () => overlay.remove()
    }, '\u00d7');
    inputRow.appendChild(el('span', { className: 'search-icon-prefix' }, '\uD83D\uDD0D'));
    inputRow.appendChild(inp);
    inputRow.appendChild(closeBtn);
    panel.appendChild(inputRow);

    const resultsList = el('div', { className: 'search-results-list' });
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
        resultsList.appendChild(el('div', { className: 'search-no-results' }, 'No results found'));
        return;
      }

      allMatches.slice(0, 25).forEach(item => {
        resultsList.appendChild(el('div', {
          className: 'search-result-item',
          onClick: () => {
            currentStepIdx = item.stepIdx;
            overlay.remove();
            render();
            window.scrollTo(0, 0);
          }
        }, [
          el('div', { className: 'search-result-label' }, item.label),
          item.context ? el('div', { className: 'search-result-context' }, 'In: ' + item.context) : null
        ]));
      });

      if (allMatches.length > 1) {
        resultsList.appendChild(el('button', {
          type: 'button', className: 'btn btn-primary btn-full search-next-btn',
          onClick: () => {
            matchCursor = (matchCursor + 1) % allMatches.length;
            currentStepIdx = allMatches[matchCursor].stepIdx;
            overlay.remove();
            render();
            window.scrollTo(0, 0);
          }
        }, 'Next \u203a (' + allMatches.length + ' matches)'));
      }
    }

    inp.addEventListener('input', () => renderResults(inp.value));
  }

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

  // ── App Header (reused on all screens) ─────────────────────
  let _devTapCount = 0, _devTapTimer = null;
  function isDevMode() { return localStorage.getItem('inhausDevMode') === 'true'; }
  function toggleDevMode() {
    const next = !isDevMode();
    localStorage.setItem('inhausDevMode', next ? 'true' : 'false');
    const msg = next ? '\u26a0\ufe0f Dev Mode ON \u2014 Skip buttons active' : 'Dev Mode OFF';
    showToast(msg);
    render();
  }

  function buildAppHeader(subtitle) {
    const header = el('div', { className: 'app-header' });
    const logo = el('div', { className: 'app-logo', style: 'cursor:pointer;', onClick: () => {
      _devTapCount++;
      if (_devTapTimer) clearTimeout(_devTapTimer);
      _devTapTimer = setTimeout(() => { _devTapCount = 0; }, 2000);
      if (_devTapCount >= 5) { _devTapCount = 0; toggleDevMode(); }
    }});
    logo.appendChild(el('img', { src: 'icons/logo.png', alt: 'InHaus Lab' }));
    header.appendChild(logo);
    if (isDevMode()) {
      const banner = el('div', { style: 'background:#ff9900;color:#000;font-size:11px;font-weight:bold;padding:2px 8px;border-radius:4px;' }, '\u26a0\ufe0f DEV');
      header.appendChild(banner);
    }
    header.appendChild(el('p', { className: 'app-subtitle' }, subtitle || 'Field Inspector'));
    return header;
  }

  // ── HOME SCREEN ────────────────────────────────────────────
  function renderHome() {
    const c = el('div', { className: 'screen home-screen' });
    c.appendChild(buildAppHeader());

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
          if (confirm('⚠️ Delete this inspection permanently?\n\nAll photos and data will be removed from this device.\n\nOnly delete after confirming your photos have been uploaded to Google Drive.\n\nThis cannot be undone.')) {
            DB.remove(insp.inspectionId).then(() => render());
          }
        }}, 'Delete')
      ])
    ]);
  }

  async function resumeInsp(id) {
    inspection = await DB.get(id);
    if (!inspection) return;
    stepList = buildStepList(inspection);
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
    const isEdit = !!inspection;
    const data = isEdit ? {
      inspectionId: inspection.inspectionId,
      inspectorName: inspection.inspectorName || '',
      inspectionDate: inspection.inspectionDate || new Date().toISOString().slice(0, 10),
      clientName: inspection.clientName || '',
      propertyAddress: inspection.propertyAddress || '',
      numberOfLevels: inspection.numberOfLevels || '',
      numberOfBedrooms: inspection.numberOfBedrooms || '',
      numberOfBathrooms: inspection.numberOfBathrooms || '',
      waterSource: inspection.waterSource || '',
      waterSourceDescription: inspection.waterSourceDescription || '',
      wifiNetwork: inspection.wifiNetwork || '',
      wifiPassword: inspection.wifiPassword || '',
      clientConcerns: inspection.clientConcerns || '',
      blueprintNotes: inspection.blueprintNotes || ''
    } : {
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
      wifiPassword: '',
      clientConcerns: '',
      blueprintNotes: ''
    };

    const c = el('div', { className: 'screen' });
    c.appendChild(buildAppHeader(isEdit ? 'Edit Intake Details' : 'Customer & Property Intake'));
    c.appendChild(renderStatusBar(lastSaveText));

    const card = el('div', { className: 'card' });
    const fields = [
      { ...text('inspectionId', 'Inspection ID'), disabled: true },
      text('inspectorName', 'Inspector Name *'),
      text('inspectorEmail', 'Inspector Email'),
      date('inspectionDate', 'Inspection Date'),
      text('clientName', 'Client Name *'),
      text('propertyAddress', 'Property Address *'),
      photo('Title Page'),
      sel('numberOfLevels', 'Number of Levels *', ['1', '2', '3+']),
      sel('numberOfBedrooms', 'Number of Bedrooms *', ['1', '2', '3', '4', '5', '6', '7+']),
      sel('numberOfBathrooms', 'Number of Bathrooms *', ['1', '2', '3', '4', '5', '6+']),
      sel('waterSource', 'Water Source *', ['Municipal', 'Well', 'Other']),
      showIf(text('waterSourceDescription', 'Water source description'), 'waterSource', 'Other'),
      divider(),
      text('wifiNetwork', 'Home wifi network name'),
      text('wifiPassword', 'WiFi Password', { placeholder: 'For Airthings and device connectivity' }),
      textarea('clientConcerns', 'Client concerns / known problem areas'),
      textarea('blueprintNotes', 'Client blueprints / layout notes (optional)')
    ];

    const onIntakeChange = () => { updateShowIf(card, data); };
    fields.forEach(f => {
      const rendered = renderField(f, data, onIntakeChange, {}, () => {});
      if (rendered) card.appendChild(rendered);
    });
    updateShowIf(card, data);
    c.appendChild(card);

    const nav = el('div', { className: 'bottom-nav' }, [
      el('button', { className: 'btn btn-outline btn-nav', onClick: () => {
        if (isEdit) { screen = 'step'; render(); } else { screen = 'home'; render(); }
      } }, isEdit ? '\u2190 Back to Steps' : 'Cancel'),
      el('button', { className: 'btn btn-primary btn-nav', onClick: () => {
        const required = ['inspectorName', 'clientName', 'propertyAddress', 'numberOfLevels', 'numberOfBedrooms', 'numberOfBathrooms', 'waterSource'];
        const missing = required.filter(k => !data[k] || !data[k].trim || !data[k].trim());
        if (missing.length) { alert('Please fill in all required fields (marked with *).'); return; }
        if (isEdit) {
          Object.assign(inspection, data);
          stepList = buildStepList(inspection);
          screen = 'step';
          saveNow().then(() => render());
        } else {
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
        }
      }}, isEdit ? 'Save Changes \u2713' : 'Start Inspection \u2192')
    ]);
    c.appendChild(nav);
    root.appendChild(c);
  }

  // ── STEP SCREEN ────────────────────────────────────────────
  function renderStep() {
    if (currentStepIdx >= stepList.length) { screen = 'review'; render(); return; }
    const step = stepList[currentStepIdx];
    if (step.type === 'review') { screen = 'review'; render(); return; }

    const data = getStepData(step.id);
    if (!data._enteredAt) data._enteredAt = new Date().toISOString();
    data._roomName = step.name;

    if (step.type === 'debrief' && !data.radonPickupTime && inspection.startedAt) {
      const pickupMs = new Date(inspection.startedAt).getTime() + 54 * 60 * 60 * 1000;
      const d = new Date(pickupMs);
      const pad = n => String(n).padStart(2, '0');
      data.radonPickupTime = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    if ((step.type === 'room-test' || step.type === 'bedroom' || step.type === 'bathroom' || step.type === 'additional-room') && !data.roomName) {
      data.roomName = step.name;
    }

    inspection._lastStepIdx = currentStepIdx;
    if (inspection._furthestStepIdx === undefined || currentStepIdx > inspection._furthestStepIdx) {
      inspection._furthestStepIdx = currentStepIdx;
    }

    const c = el('div', { className: 'screen step-screen' });
    c.appendChild(buildAppHeader(step.name));
    c.appendChild(renderStatusBar(lastSaveText));

    const timersBar = renderTimersBar(inspection);
    if (timersBar) c.appendChild(timersBar);

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
    }, currentStepIdx + 1, stepList.length));

    const phaseSteps = stepList.filter(s => s.phase === currentPhase && s.type !== 'review');
    const alwaysShowSubNav = ['lowest', 'rooms', 'supplementary', 'wrapup'].includes(currentPhase);
    if (phaseSteps.length > 1 || alwaysShowSubNav) {
      const subNav = el('div', { className: 'sub-nav' });
      phaseSteps.forEach((s, i) => {
        const sIdx = stepList.indexOf(s);
        const isCurr = sIdx === currentStepIdx;
        const isDone = inspection.stepData && inspection.stepData[s.id] && inspection.stepData[s.id]._visited;
        const btn = el('button', {
          type: 'button',
          className: 'sub-nav-btn' + (isCurr ? ' active' : '') + (isDone ? ' done' : ''),
          onClick: () => { currentStepIdx = sIdx; render(); window.scrollTo(0, 0); }
        }, s.name);
        subNav.appendChild(btn);
      });
      c.appendChild(subNav);
    }

    // Back to page 1 (edit intake) button
    const backToIntakeBtn = el('button', {
      type: 'button',
      className: 'btn btn-outline btn-small',
      style: 'position:fixed;top:8px;right:10px;z-index:200;font-size:11px;padding:4px 10px;',
      onClick: () => { screen = 'intake'; render(); }
    }, '\u270E Intake');
    c.appendChild(backToIntakeBtn);

    // Search button
    const searchBtn = el('button', {
      type: 'button',
      style: 'position:fixed;top:8px;right:88px;z-index:200;background:#fff;border:2px solid var(--border);border-radius:8px;font-size:13px;padding:4px 10px;cursor:pointer;min-height:0;line-height:1.4;font-weight:700;touch-action:manipulation;',
      onClick: () => openSearch()
    }, '\uD83D\uDD0D');
    c.appendChild(searchBtn);

    // Room navigation FAB
    const roomNavFab = el('button', {
      type: 'button',
      className: 'room-nav-fab',
      onClick: () => {
        const existing = document.getElementById('room-drawer-overlay');
        if (existing) { existing.remove(); return; }
        document.body.appendChild(buildRoomDrawer());
      }
    }, '\uD83D\uDCCD');
    c.appendChild(roomNavFab);

    c.appendChild(el('h1', { className: 'screen-title' }, step.name));

    const fieldGen = STEP_FIELDS[step.type];
    if (fieldGen) {
      const fields = fieldGen();
      const card = el('div', { className: 'card' });
      const onFieldChange = () => {
        data._updatedAt = new Date().toISOString();
        scheduleSave();
        updateShowIf(card, data);
      };
      fields.forEach(f => {
        const rendered = renderField(f, data, onFieldChange, inspection, () => { scheduleSave(); });
        if (rendered) card.appendChild(rendered);
      });
      updateShowIf(card, data);
      c.appendChild(card);
    }

    if (step.dynamic === 'lowest') {
      const lowestSteps = stepList.filter(s => s.dynamic === 'lowest');
      if (step.id === lowestSteps[lowestSteps.length - 1].id) {
        c.appendChild(el('button', { className: 'btn btn-outline btn-full', onClick: () => { addDynamicRoom('lowest'); window.scrollTo(0, 0); } }, '+ Add Another Room (Lowest Level)'));
      }
    }
    if (step.phase === 'supplementary' || (step.phase === 'main' && step.id === 'kitchen-air')) {
      if (step.id === 'kitchen-air' || (step.dynamic === 'additional' && step.id === stepList.filter(s => s.dynamic === 'additional').pop()?.id)) {
        c.appendChild(el('button', { className: 'btn btn-outline btn-full', onClick: () => { addDynamicRoom('additional'); window.scrollTo(0, 0); } }, '+ Add Additional Room'));
      }
    }

    data._visited = true;

    const navButtons = [
      currentStepIdx > 0
        ? el('button', { className: 'btn btn-outline btn-nav', onClick: () => { currentStepIdx--; render(); window.scrollTo(0, 0); } }, '\u2190 Back')
        : el('div'),
      el('button', { className: 'btn btn-primary btn-nav', onClick: () => {
        const missing = validateStep(step);
        if (missing.length) { showToast(missing.length + ' item' + (missing.length > 1 ? 's' : '') + ' still required'); flashUncheckedItems(c); return; }
        const warnings = warnStep(step);
        if (warnings.length) { showToast('\u26a0\ufe0f ' + warnings.join(', '), 3500); }
        data._completedAt = new Date().toISOString();
        currentStepIdx++;
        saveNow().then(() => { render(); window.scrollTo(0, 0); });
      }}, currentStepIdx < stepList.length - 2 ? 'Next \u2192' : 'Review \u2192')
    ];
    if (isDevMode()) {
      navButtons.push(el('button', { className: 'btn btn-nav', style: 'background:#ff9900;color:#000;font-size:12px;padding:6px 10px;', onClick: () => {
        data._completedAt = new Date().toISOString();
        data._visited = true;
        currentStepIdx++;
        saveNow().then(() => { render(); window.scrollTo(0, 0); });
      }}, 'Skip \u23e9'));
    }
    const nav = el('div', { className: 'bottom-nav' }, navButtons);
    c.appendChild(nav);
    root.appendChild(c);
  }

  // ── REVIEW SCREEN ──────────────────────────────────────────
  function renderReview() {
    const c = el('div', { className: 'screen review-screen' });
    c.appendChild(buildAppHeader('Final Review'));
    c.appendChild(renderStatusBar(lastSaveText));

    // ── 6a: Departure Checklist ──
    if (!inspection._departureChecklist) inspection._departureChecklist = {};
    const depData = inspection._departureChecklist;
    const depItems = [
      { key: 'downloadQtrak', label: 'Download Q-Trak data to computer' },
      { key: 'shipSamples', label: 'Ship all lab samples' }
    ];
    const depCard = el('div', { className: 'card' });
    depCard.appendChild(el('h3', { className: 'section-heading' }, 'Before You Leave'));
    const allInspBtn = el('button', {
      className: 'btn btn-outline btn-full',
      onClick: () => { screen = 'home'; inspection = null; render(); }
    }, 'All Inspections');

    function updateDepState() {
      const allDone = depItems.every(i => !!depData[i.key]);
      allInspBtn.disabled = !allDone;
      allInspBtn.style.opacity = allDone ? '1' : '0.4';
      allInspBtn.style.pointerEvents = allDone ? 'auto' : 'none';
      scheduleSave();
    }

    depItems.forEach(item => {
      depCard.appendChild(renderCheck(item.key, item.label, !!depData[item.key], v => {
        depData[item.key] = v;
        updateDepState();
      }));
    });
    c.appendChild(depCard);

    const hCard = el('div', { className: 'card' });
    hCard.appendChild(el('h3', { className: 'section-heading' }, 'Inspection Details'));
    const infoFields = [
      ['ID', inspection.inspectionId], ['Inspector', inspection.inspectorName],
      ['Client', inspection.clientName], ['Address', inspection.propertyAddress],
      ['Date', inspection.inspectionDate], ['Levels', inspection.numberOfLevels],
      ['Bedrooms', inspection.numberOfBedrooms], ['Bathrooms', inspection.numberOfBathrooms],
      ['Water Source', inspection.waterSource + (inspection.waterSourceDescription ? ' (' + inspection.waterSourceDescription + ')' : '')],
      ['Wifi', inspection.wifiNetwork],
      ['Occupancy', inspection.occupancyDuringInspection], ['Weather', inspection.weatherConditions],
      ['Started', fmtDate(inspection.startedAt)], ['Status', inspection.status]
    ];
    infoFields.forEach(([l, v]) => {
      hCard.appendChild(el('div', { className: 'info-row' }, [
        el('span', { className: 'info-label' }, l),
        el('span', { className: 'info-value' }, v || '--')
      ]));
    });
    if (inspection.clientConcerns) hCard.appendChild(el('div', { className: 'info-block' }, [el('strong', null, 'Client Concerns: '), document.createTextNode(inspection.clientConcerns)]));
    if (inspection.knownProblemAreas) hCard.appendChild(el('div', { className: 'info-block' }, [el('strong', null, 'Known Problem Areas: '), document.createTextNode(inspection.knownProblemAreas)]));
    c.appendChild(hCard);

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
        el('button', { className: 'btn btn-small btn-outline', onClick: () => { currentStepIdx = idx; screen = 'step'; render(); } }, 'Edit')
      ]));

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
          summary.appendChild(el('div', { className: 'review-item' }, [
            el('span', { className: 'review-item-label' }, (f.label || f.key) + ': '),
            el('span', null, display)
          ]));
        });
        if (data._photos && data._photos.length) {
          summary.appendChild(el('div', { className: 'review-photos-section' }, [el('strong', null, data._photos.length + ' photo(s):')]));
          const grid = el('div', { className: 'review-photo-grid' });
          data._photos.forEach(p => {
            grid.appendChild(el('div', { className: 'review-photo-item' }, [
              el('img', { src: p.dataUrl, className: 'review-photo-img' }),
              p.caption ? el('div', { className: 'review-photo-caption' }, p.caption) : null
            ]));
          });
          summary.appendChild(grid);
        }
      }
      sCard.appendChild(summary);
      c.appendChild(sCard);
    });

    const exportData = buildExportJSON();

    const actCard = el('div', { className: 'card actions-card' });

    if (inspection.status !== 'completed') {
      const submitBtn = el('button', { className: 'btn btn-primary btn-full', onClick: () => {
        const unvisited = stepList.filter(s => s.type !== 'review' && !(inspection.stepData && inspection.stepData[s.id] && inspection.stepData[s.id]._visited));
        const atpData = (inspection.stepData && inspection.stepData['atp-kitchen']) || {};
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
        inspection.status = 'completed';
        inspection.endedAt = new Date().toISOString();
        inspection.completedAt = inspection.endedAt;
        const completeData = buildExportJSON();
        saveNow().then(() => {
          submitInspection(completeData).then(ok => {
            if (!ok) { submitBtn.disabled = false; submitBtn.textContent = '\u2713 Submit Inspection'; }
          });
          screen = 'home'; inspection = null; render();
        });
      }}, '\u2713 Submit Inspection');
      actCard.appendChild(submitBtn);
    } else {
      const reuploadBtn = el('button', { className: 'btn btn-outline btn-full', onClick: async () => {
        reuploadBtn.disabled = true;
        reuploadBtn.textContent = 'Uploading\u2026 \u23f3';
        try {
          const reuploadData = buildExportJSON();
          // Send main data first (no photos)
          const mainPayload = stripPhotosFromExport(reuploadData);
          await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST', mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mainPayload)
          });
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
      actCard.appendChild(el('div', { className: 'completed-banner' }, [
        el('strong', null, '\u2713 Inspection Complete'),
        el('p', null, 'Completed: ' + fmtDate(inspection.endedAt)),
        reuploadBtn
      ]));
    }
    c.appendChild(actCard);

    // Initial departure checklist state
    updateDepState();

    c.appendChild(el('div', { className: 'bottom-nav' }, [
      el('button', { className: 'btn btn-outline btn-nav', onClick: () => {
        if (inspection.status !== 'completed') { currentStepIdx = stepList.length - 2; screen = 'step'; }
        else { screen = 'home'; inspection = null; }
        render();
      }}, inspection.status !== 'completed' ? '\u2190 Back to Steps' : '\u2190 Home'),
      allInspBtn
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
      residenceType: (inspection.stepData?.['property-details']?.residenceType) || '',
      yearBuilt: (inspection.stepData?.['property-details']?.yearBuilt) || '',
      squareFootage: (inspection.stepData?.['property-details']?.squareFootage) || '',
      basement: (inspection.stepData?.['property-details']?.basement) || '',
      carpetedRooms: (inspection.stepData?.['property-details']?.carpetedRooms) || '',
      fireplace: (inspection.stepData?.['property-details']?.fireplace) || '',
      pets: (inspection.stepData?.['property-details']?.pets) || '',
      smokingVaping: (inspection.stepData?.['property-details']?.smokingVaping) || '',
      stoveType: (inspection.stepData?.['kitchen-appliance']?.stoveType) || (inspection.stepData?.['property-details']?.stoveType) || '',
      wifiNetwork: inspection.wifiNetwork || '',
      clientConcerns: inspection.clientConcerns || '',

      occupancyDuringInspection: inspection.occupancyDuringInspection || '',
      weatherConditions: inspection.weatherConditions || '',
      knownProblemAreas: inspection.knownProblemAreas || '',
      startedAt: inspection.startedAt,
      endedAt: inspection.endedAt,
      status: inspection.status,
      preAssessmentChecklist: cleanStepData(inspection.stepData?.equipment),
      arrivalSetup: cleanStepData(inspection.stepData?.arrival),
      deviceSetup: cleanStepData(inspection.stepData?.['device-setup']),
      exteriorAssessment: cleanStepData(inspection.stepData?.exterior),
      radonSetup: cleanStepData(inspection.stepData?.radon),
      rooms: [],
      utilityRoom: cleanStepData(inspection.stepData?.utility),
      wrapUp: cleanStepData(inspection.stepData?.['final-checks']),
      customerDebrief: cleanStepData(inspection.stepData?.debrief),
      postAssessment: cleanStepData(inspection.stepData?.['post-assessment']),
      completedAt: inspection.completedAt || null
    };

    const ventType = inspection.stepData?.utility?.ventilationType || {};
    const ventLabels = { hrv: 'HRV', erv: 'ERV', bathExhaust: 'Bathroom Exhaust Fan(s)', none: 'None', notSure: 'Not Sure' };
    exp.ventilationReadable = Object.entries(ventType).filter(([, v]) => v === true).map(([k]) => ventLabels[k] || k).join(', ');

    const roomTypes = ['room-test', 'bedroom', 'bathroom', 'living-area', 'kitchen-appliance', 'water-sample', 'atp-kitchen', 'kitchen-air', 'additional-room'];
    stepList.forEach(step => {
      if (roomTypes.includes(step.type)) {
        const d = inspection.stepData?.[step.id];
        if (d) {
          exp.rooms.push({ roomName: d.roomName || step.name, type: step.type, level: step.phase, stepId: step.id, ...cleanStepData(d) });
        }
      }
    });

    const arrivalData = inspection.stepData?.arrival || {};
    exp.windowsOpen = arrivalData.windowsOpen || '';
    const kitchenData = inspection.stepData?.['kitchen-appliance'] || {};
    exp.appliancesCondition = kitchenData.appliancesCondition || '';
    let dampnessCount = 0;
    let mustyCount = 0;
    exp.rooms.forEach(room => {
      const obs = room.observations || [];
      if (obs.includes('Visible mold') || obs.includes('Water staining') || obs.includes('Condensation') || obs.includes('Active leak')) dampnessCount++;
      if (obs.includes('Musty odor')) mustyCount++;
    });
    exp.roomsWithDampness = dampnessCount;
    exp.roomsWithMustySmell = mustyCount;
    return exp;
  }

  function cleanStepData(data) {
    if (!data) return {};
    const clean = {};
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('_')) continue;
      clean[k] = v;
    }
    function exportPhotos(arr) {
      return arr.map(p => ({
        photoId: p.photoId, roomName: p.roomName, stepName: p.stepName,
        timestamp: p.timestamp, caption: p.caption, imageData: p.dataUrl
      }));
    }
    if (data._photos && data._photos.length) {
      clean.photos = exportPhotos(data._photos);
    }
    if (data._atpBeforePhotos && data._atpBeforePhotos.length) {
      clean.atpBeforePhotos = exportPhotos(data._atpBeforePhotos);
    }
    if (data._atpAfterPhotos && data._atpAfterPhotos.length) {
      clean.atpAfterPhotos = exportPhotos(data._atpAfterPhotos);
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

  retryQueuedUploads();
  render();
})();
