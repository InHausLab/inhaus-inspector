// InHaus Inspector - Main Application
(function () {
  'use strict';

  // ── Google Drive Export Config ─────────────────────────────
  // Set this to your Google Apps Script web app URL
  const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzZoRaJtJs9Nvb3H1aLToccUazpqtij3pWNHl0tX3okFw9E47BewY7arvRJlp2XXsGYOw/exec';

  // ── Google Shared Drive Config ──────────────────────────────
  // Set this to the Shared Drive folder ID where per-assessment subfolders should be created.
  // Find it in the URL when browsing the Shared Drive in Google Drive:
  //   https://drive.google.com/drive/u/0/folders/[FOLDER_ID_HERE]
  // Pass this value to your Apps Script via the payload's sharedDriveFolderId field.
  const SHARED_DRIVE_FOLDER_ID = ''; // e.g. '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms'

  // ── AI Vision Config ──────────────────────────────────────
  // Set this to your Anthropic API key for AI HVAC scanning
  // Leave blank to disable AI scanning (fields can still be filled manually)
  // Contact Matt to set this API key - needed for AI HVAC scanner and room summaries

  const { el, renderField, renderProgressBar, renderStatusBar, renderTimersBar, renderCheck, fmtDate, showToast, flashUncheckedItems, updateShowIf } = UI;

  // ── Auto-sync version badge from service worker ────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then(reg => {
      const swURL = reg.active && reg.active.scriptURL;
      if (swURL) {
        fetch(swURL).then(r => r.text()).then(txt => {
          const m = txt.match(/CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
          if (m) {
            const v = m[1].replace('inhaus-', '');
            const badge = document.getElementById('version-badge');
            if (badge) badge.textContent = v;
          }
        }).catch(() => {});
      }
    });
  }

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
  function photo(stepName, photoKey) { return { type: 'photo', stepName, photoKey }; }
  function timer(key, label, duration, opts) { return { key, type: 'timer', label, duration, ...opts }; }
  function heading(label) { return { type: 'heading', label }; }
  function collapsible(title, fields, opts) { return { type: 'collapsible-section', title, fields, defaultOpen: opts && opts.defaultOpen !== false }; }
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
      collapsible('FLIR Thermal Scan', [
      link('📲 Open Meterlink app', 'meterlink://'),
      link('🌡 Get FLIR photos via Meterlink', 'https://www.flir.com/products/meterlink/'),
      checklist('flirGuidance', null, [
        { key: 'flirScanStains', label: 'Scan for water stains, moisture intrusion, plumbing issues' },
        { key: 'flirStartExterior', label: 'Start with areas identified during exterior inspection' },
        { key: 'flirPhotoAll', label: 'Photograph ALL areas of concern' },
        { key: 'flirPhotoNoConcern', label: 'If no concerns: photograph area where mold test conducted' }
      ]),
      yesno('flirDone', 'FLIR scan completed'),
      showIf(yesno('flirConcerns', 'Areas of concern found'), 'flirDone', 'Yes'),
      showIf(text('flirImageLabel', 'FLIR Image Label', { placeholder: 'e.g. Bedroom 1 - Image #0023' }), 'flirDone', 'Yes'),
      showIf(text('flirPhotoNum', 'FLIR photo number noted'), 'flirDone', 'Yes'),
      showIf(num('flirMoisture', 'Moisture reading', { unit: '%', note: 'Flag if >20%' }), 'flirDone', 'Yes')
    ], { defaultOpen: false })
    ];
  }

  function flirLogFields() {
    return [
      collapsible('FLIR Thermal Scan & Photo Log', [
        checklist('flirGuidance', null, [
          { key: 'flirScanStains', label: 'Scan for water stains, moisture intrusion, plumbing issues' },
          { key: 'flirStartExterior', label: 'Start with areas identified during exterior inspection' },
          { key: 'flirPhotoAll', label: 'Photograph ALL areas of concern' },
          { key: 'flirPhotoNoConcern', label: 'If no concerns: photograph area where mold test conducted' }
        ]),
        check('flirScanned', 'Scan rooms for water stains, moisture intrusion, plumbing'),
        heading('FLIR Photo Log'),
        info('Add each room scanned with its FLIR image number'),
        text('flirImageLabel1', 'FLIR Image Label', { placeholder: 'e.g. Living Room - Image #0023' }),
        text('flirRoom1', 'Room name'),
        text('flirImg1', 'FLIR Image #'),
        text('flirImageLabel2', 'FLIR Image Label', { placeholder: 'e.g. Dining Room - Image #0024' }),
        text('flirRoom2', 'Room name'),
        text('flirImg2', 'FLIR Image #'),
        text('flirImageLabel3', 'FLIR Image Label', { placeholder: 'e.g. Hallway - Image #0025' }),
        text('flirRoom3', 'Room name'),
        text('flirImg3', 'FLIR Image #'),
        text('flirImageLabel4', 'FLIR Image Label', { placeholder: 'e.g. Room - Image #0026' }),
        text('flirRoom4', 'Room name (if needed)'),
        text('flirImg4', 'FLIR Image #'),
        text('flirImageLabel5', 'FLIR Image Label', { placeholder: 'e.g. Room - Image #0027' }),
        text('flirRoom5', 'Room name (if needed)'),
        text('flirImg5', 'FLIR Image #')
      ], { defaultOpen: false })
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
      link('📋 Open Priority Lab app', 'https://app.prioritylaboratory.com'),
      link('🔬 Priority Lab order portal', 'https://prioritylaboratory.com/inhaus'),
      yesno('breezeDone', 'Breeze ET test performed'),
      showIf(timer(timerKey || 'breezeTimer', 'Breeze ET Timer (10 min)', 600), 'breezeDone', 'Yes'),
      showIf(text('breezeLocation', 'Spore trap location in this room', { placeholder: 'e.g. Center of room, tripod at 60", north corner' }), 'breezeDone', 'Yes')
    ];
  }

  function qtrakSection() {
    return [
      heading('Q-Trak 7585'),
      text('qtrakLocation', 'Q-Trak reading location', { placeholder: 'e.g. Center of room, desk height, 3ft from window' }),
      yesno('qtrakCaptured', 'Q-Trak reading captured?'),
      showIf(text('qtrakRoomName', 'Q-Trak room name (as entered in device)', { placeholder: 'e.g. Bedroom 1 (match exactly what you typed on device)' }), 'qtrakCaptured', 'Yes')
    ];
  }

  function formaldehydeField() {
    return [];
  }

  function observationFields() {
    return [
      chips('observations', 'Observations', OBS_TAGS),
      info('\uD83D\uDCA1 Tip: Use Whispr app for more accurate voice dictation'),
      textarea('notes', 'Notes', { placeholder: 'Enter observations, notes, or comments... (\uD83C\uDF99 Voice dictation: read back and fix errors before moving on)' }),
      check('voiceReviewed', '\u2713 Voice-dictated notes reviewed and corrected'),
      divider(),
      heading('Photos'),
      photo('Before', '_beforePhotos'),
      photo('After', '_afterPhotos')
    ];
  }

  function followUpFields() {
    return [
      divider(),
      heading('Follow-Up'),
      yesno('followUpNeeded', 'Follow-up recommended?'),
      showIf(sel('followUpTimeframe', 'Re-check in', ['3 months', '6 months', '12 months']), 'followUpNeeded', 'Yes'),
      showIf(textarea('followUpNote', 'What to watch for', { placeholder: 'e.g. Previous leak under sink, monitor for moisture return... (\uD83C\uDF99 Voice dictation: read back and fix errors)' }), 'followUpNeeded', 'Yes'),
      showIf(photo('Follow-Up', '_followUpPhotos'), 'followUpNeeded', 'Yes')
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
  function getArrivalFields() {
    return [
      // ── ROOM REGISTRY ────────────────────────────────────────
      collapsible('\ud83c\udfe0 Room Registry', [
        info('Name every room ONCE here. These names will be referenced for test locations, photo labels, Q-Trak rooms, and the report throughout the inspection.'),
        text('regRoom_1_name', 'Room 1 Name', { placeholder: 'e.g. Primary Bedroom' }),
        sel('regRoom_1_level', 'Room 1 Level', ['Basement / Lowest Level', 'Ground Floor / Main', '2nd Floor', '3rd Floor', '4th Floor', 'Attic / Other']),
        text('regRoom_1_desc', 'Room 1 Description', { placeholder: 'e.g. NW corner \u2014 master suite' }),
        divider(),
        text('regRoom_2_name', 'Room 2 Name', { placeholder: 'e.g. Guest Bedroom' }),
        sel('regRoom_2_level', 'Room 2 Level', ['Basement / Lowest Level', 'Ground Floor / Main', '2nd Floor', '3rd Floor', '4th Floor', 'Attic / Other']),
        text('regRoom_2_desc', 'Room 2 Description', { placeholder: 'e.g. NE corner' }),
        divider(),
        text('regRoom_3_name', 'Room 3 Name', { placeholder: 'e.g. Living Room' }),
        sel('regRoom_3_level', 'Room 3 Level', ['Basement / Lowest Level', 'Ground Floor / Main', '2nd Floor', '3rd Floor', '4th Floor', 'Attic / Other']),
        text('regRoom_3_desc', 'Room 3 Description', { placeholder: 'e.g. Open plan, front of house' }),
        divider(),
        text('regRoom_4_name', 'Room 4 Name', { placeholder: 'e.g. Dining Room' }),
        sel('regRoom_4_level', 'Room 4 Level', ['Basement / Lowest Level', 'Ground Floor / Main', '2nd Floor', '3rd Floor', '4th Floor', 'Attic / Other']),
        text('regRoom_4_desc', 'Room 4 Description', { placeholder: 'e.g. Adjacent to kitchen' }),
        divider(),
        text('regRoom_5_name', 'Room 5 Name', { placeholder: 'e.g. Office' }),
        sel('regRoom_5_level', 'Room 5 Level', ['Basement / Lowest Level', 'Ground Floor / Main', '2nd Floor', '3rd Floor', '4th Floor', 'Attic / Other']),
        text('regRoom_5_desc', 'Room 5 Description', { placeholder: 'e.g. SE corner, second floor' }),
        divider(),
        text('regRoom_6_name', 'Room 6 Name (if needed)', { placeholder: 'e.g. Basement Rec Room' }),
        sel('regRoom_6_level', 'Room 6 Level', ['Basement / Lowest Level', 'Ground Floor / Main', '2nd Floor', '3rd Floor', '4th Floor', 'Attic / Other']),
        text('regRoom_6_desc', 'Room 6 Description', { placeholder: 'e.g. Finished, west side' }),
        divider(),
        text('regRoom_7_name', 'Room 7 Name (if needed)', { placeholder: 'e.g. Laundry Room' }),
        sel('regRoom_7_level', 'Room 7 Level', ['Basement / Lowest Level', 'Ground Floor / Main', '2nd Floor', '3rd Floor', '4th Floor', 'Attic / Other']),
        text('regRoom_7_desc', 'Room 7 Description', { placeholder: 'e.g. Basement' }),
        divider(),
        text('regRoom_8_name', 'Room 8 Name (if needed)', { placeholder: 'e.g. Sunroom' }),
        sel('regRoom_8_level', 'Room 8 Level', ['Basement / Lowest Level', 'Ground Floor / Main', '2nd Floor', '3rd Floor', '4th Floor', 'Attic / Other']),
        text('regRoom_8_desc', 'Room 8 Description', { placeholder: 'e.g. Addition, south side' })
      ], { defaultOpen: false }),
      divider(),
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

      // ── DATA: WiFi password (for Airthings + device connectivity) ──
      text('wifiPassword', 'Home WiFi Password', { placeholder: 'e.g. MyWiFi2024! (for device connectivity during inspection)' }),
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
      text('boulderBlueTestLocation', 'Boulder Blue Test Location', { placeholder: 'e.g. Living Room' }),
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

  function getDeviceSetupFields() {
    return [
      heading('PFAS Water Test'),
      radio('pfasSetup', 'PFAS water test at kitchen faucet', ['Yes', 'No', 'Not requested']),
      showIf(text('pfasKitNum', 'PFAS Kit #', { placeholder: 'e.g. WTK_PFAS_27099 (from registration card)' }), 'pfasSetup', 'Yes'),
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
  function getExteriorFields() {
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
      check('qtrakOutdoorDone', 'Take 1-min outdoor measurement using outdoor room template'),
      timer('qtrakOutdoorTimer', 'Q-Trak Outdoor Timer (1 min)', 60),
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
  function getRadonFields() {
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
  function getRoomTestFields() {
    return [
      { type: 'process-checklist', title: 'Room Setup', items: [
        { key: 'qtrakFloorplan', label: 'Open Q-Trak floorplan template - draw in rooms or correct layout' },
        { key: 'labelRooms', label: 'Label rooms using Q-Trak naming convention (e.g. Bedroom 1, Bedroom 2)' }
      ]},
      text('roomName', 'Room Name', { required: true }),
      radio('roomType', 'Room Type', ['Bedroom', 'Bathroom', 'Office', 'Storage', 'Other']),
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
  function getUtilityFields() {
    return [
      { type: 'process-checklist', title: 'Equipment Needed', items: [
        { key: 'flirUtil', label: 'FLIR MR277' },
        { key: 'qtrakUtil', label: 'Q-Trak 7585' }
      ]},
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
      { type: 'ai-hvac-scanner' },
      text('hvacManufacturer', 'Manufacturer'),
      text('hvacModel', 'Model number'),
      text('hvacSerial', 'Serial number'),
      text('filterSize', 'Filter size'),
      num('mervRating', 'MERV rating'),
      text('filterMakeModel', 'Filter make / model / brand'),
      sel('filterCondition', 'Filter condition', ['Clean', 'Dirty', 'Very Dirty', 'Damaged']),
      sel('filterEstimatedAge', 'Estimated filter age', ['New', 'Less than 6 months', '6-12 months', 'Over 1 year']),
      yesno('filterRecallFlag', 'Recall notice visible?'),
      textarea('filterNotes', 'Filter notes'),
      check('filterCleaned', 'Filters checked and cleaned if needed'),
      photo('HVAC Filter', '_hvacFilterPhotos'),
      divider(),
      heading('HVAC Inspection'),
      { type: 'process-checklist', title: 'HVAC Inspection Steps', items: [
        { key: 'servicePanelRemoved', label: 'Service panel removed' },
        { key: 'filtersChecked', label: 'Filters checked' }
      ]},
      yesno('hvacCondensation', 'Condensation noted'),
      yesno('hvacLeaks', 'Leaks noted'),
      text('hvacDetails', 'Notable details'),
      photo('HVAC Inspection', '_hvacInspPhotos'),
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
      { type: 'ai-room-summary' }
    ];
  }

  function getBedroomFields() {
    return [
      { type: 'process-checklist', title: 'Room Setup', items: [
        { key: 'breezeRooms', label: 'Breeze ET pump + tripod + spore traps ready' },
        { key: 'qtrakFloorplan', label: 'Q-Trak floorplan template open - rooms labelled correctly' }
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

  function getBathroomFields() {
    return [
      text('roomName', 'Room Name', { required: true }),
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
  function getLivingAreaFields() {
    return [
      { type: 'process-checklist', title: 'Room Setup', items: [
        { key: 'breezeMain', label: 'Breeze ET pump + tripod + spore traps ready' },
        { key: 'qtrakFloorplan', label: 'Q-Trak floorplan template open - rooms labelled correctly' }
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
  function getKitchenApplianceFields() {
    return [
      { type: 'process-checklist', title: 'Equipment Needed', items: [
        { key: 'breezeKitchen', label: 'Breeze ET pump + tripod + spore traps' },
        { key: 'flirKitchen', label: 'FLIR MR277' },
        { key: 'qtrakKitchen', label: 'Q-Trak 7585' },
        { key: 'atpKitchen', label: 'ATP device + swabs' }
      ]},
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
      info('Take Before/After photos for each area. Mark both Checked and Cleaned separately.'),
      heading('Under Refrigerator'),
      check('fridgeChecked', 'Checked'),
      check('fridgeCleaned', 'Cleaned'),
      heading('Under Dishwasher'),
      check('dishwasherChecked', 'Checked'),
      check('dishwasherCleaned', 'Cleaned'),
      heading('Dishwasher Filter'),
      check('dishwasherFilterChecked', 'Checked'),
      check('dishwasherFilterCleaned', 'Cleaned'),
      heading('Under Sink'),
      check('underSinkChecked', 'Checked'),
      check('underSinkCleaned', 'Cleaned'),
      heading('Under Ice Maker'),
      check('iceMakerChecked', 'Checked'),
      check('iceMakerCleaned', 'Cleaned'),
      heading('Grout / Caulking on Backsplash'),
      check('backsplashChecked', 'Checked'),
      heading('Above Stove Vent'),
      check('stoveVentChecked', 'Checked'),
      check('stoveVentCleaned', 'Cleaned'),
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

  function getWaterSampleFields() {
    return [
      info('Label each bottle with customer last name and property address. Ensure chain of custody forms are completed for each test.'),
      { type: 'process-checklist', title: 'Sample Labeling', items: [
        { key: 'bottlesLabeled', label: 'Bottles labeled with client last name and property address' },
        { key: 'preMadeLabels', label: 'Pre-made labels applied (if available)' },
        { key: 'chainOfCustody', label: 'Chain of custody forms completed for each sample' }
      ]},
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
      ...observationFields(),
      ...followUpFields(),
      { type: 'ai-room-summary' }
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
      ...observationFields(),
      ...followUpFields(),
      { type: 'ai-room-summary' }
    ];
  }

  // ── Property Details (moved near end) ─────────────────────
  function getPropertyDetailsFields() {
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
      sel('pets', 'Pets in Home', ['No', 'Yes - Dog', 'Yes - Cat', 'Yes - Dog and Cat', 'Yes - Other']),
      showIf(text('petsOther', 'Pet type — describe', { placeholder: 'e.g. Birds, rabbits, reptiles' }), 'pets', 'Yes - Other'),
      sel('smokingVaping', 'Smoking or Vaping in Home', ['No', 'Yes - Indoors', 'Yes - Outdoors Only']),
      divider(),
      heading('Assessment Conditions'),
      sel('windowsOpen', 'Windows open during assessment', ['No', 'Yes', 'Some']),
      radio('occupancyDuringInspection', 'Home occupancy during inspection', ['Occupied - Active', 'Occupied - Passive', 'Unoccupied']),
      showIf(textarea('occupancyActivities', 'Describe occupant activities (e.g. cooking, cleaning, watching TV)', { placeholder: 'e.g. Owner was cooking in kitchen during assessment' }), 'occupancyDuringInspection', 'Occupied - Active'),
      showIf(textarea('occupancyActivities', 'Describe occupant activities', { placeholder: 'e.g. Owner present but resting in bedroom' }), 'occupancyDuringInspection', 'Occupied - Passive'),
      text('weatherConditions', 'Weather conditions'),
      { type: 'weather-link' }
    ];
  }

  // ── #6: Before Leaving (expanded) ──────────────────────────
  function getFinalChecksFields() {
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
      divider(),
      heading('Tests Conducted - Confirm for Tanner'),
      info('Check every test actually performed so Tanner knows exactly what lab results to expect.'),
      checklist('testsConfirmed', null, [
        { key: 'testBreeze', label: 'Breeze ET mold spore traps - collected' },
        { key: 'testBoulderBlue', label: 'Boulder Blue allergen filter - collected' },
        { key: 'testWaterPanel', label: 'Water panel - collected' },
        { key: 'testPFAS', label: 'PFAS test - collected' },
        { key: 'testMicroplastics', label: 'Microplastics test - collected' },
        { key: 'testRadon', label: 'Radon monitor - placed (48hr test running)' },
        { key: 'testATP', label: 'ATP surface test - performed' },
        { key: 'testMoldSwabs', label: 'Mold swab samples - collected' }
      ]),
      text('breezeSampleCount', 'Number of Breeze ET spore traps collected', { placeholder: 'e.g. 4' }),
      text('moldSwabSampleCount', 'Number of mold swab samples collected', { placeholder: 'e.g. 2 (only if visible mold found)' }),
      text('atpTestCount', 'Number of ATP tests performed', { placeholder: 'e.g. 3 - kitchen sink, dishwasher, ice maker' }),
      textarea('testsNotConducted', 'Tests NOT performed - note reason', { placeholder: 'e.g. PFAS not requested by client. Microplastics kit not in truck.' }),
    ];
  }

  function getDebriefFields() {
    return [
      heading('Boulder Blue Completion'),
      info('Confirm Boulder Blue fan has run 2+ hours before stopping it.'),
      timeInput('boulderBlueEndTime', 'Boulder Blue End Time'),
      text('boulderBlueTestDuration', 'Boulder Blue Test Duration', { placeholder: 'e.g. 2 hours 15 minutes' }),
      info('Compare to start time in Arrival & Setup. Must be 2+ hours.'),
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
      dateTimeInput('radonPickupTime2', 'Radon Pickup 2 Date/Time (if second monitor)'),
      divider(),
      link('📋 Open Technician Form', 'https://docs.google.com/forms/d/e/1FAIpQLSdHZK80pgunf4IwWNpH5qcFNRPJFyXw0yeSB4mUBbgyszP0qA/viewform?usp=header'),
      divider(),
      yesno('debriefCompleted', 'Debrief completed'),
      yesno('radonPickupReminder', 'Homeowner reminded about radon pickup'),
      yesno('reportDateCommunicated', 'Expected report date communicated'),
      textarea('debriefNotes', 'Notes from debrief'),
      divider(),
      { type: 'ai-followup-plan' }
    ];
  }

  // ── Follow-Up Actions Needed helper ─────────────────────────
  function postFollowUpFields() {
    const items = [];
    for (let i = 1; i <= 5; i++) {
      if (i > 1) items.push(divider());
      items.push(heading(`Follow-Up Action ${i}`));
      items.push(text(`followUp_${i}_room`, 'Room', { placeholder: 'e.g. Primary Bedroom' }));
      items.push(sel(`followUp_${i}_timeframe`, 'Re-check timeframe', ['1 month', '3 months', '6 months', '1 year', 'As needed']));
      items.push(text(`followUp_${i}_whatToWatch`, 'What to watch for', { placeholder: 'e.g. Moisture return under sink, condensation on windows (\uD83C\uDF99 speak then review)' }));
      items.push(text(`followUp_${i}_photoRef`, 'Photo reference', { placeholder: 'e.g. Photo #023' }));
    }
    return items;
  }

  // ── Actions Taken / Assessment Observations helpers ────────
  function postActionsTakenFields() {
    const items = [];
    for (let i = 1; i <= 6; i++) {
      if (i > 1) items.push(divider());
      items.push(text(`actionTaken_${i}_desc`, `Action ${i}`, {
        placeholder: 'e.g. Replaced HVAC filter - 20x20x1 MERV 11, installed new (\uD83C\uDF99 speak then review)'
      }));
      items.push(text(`actionTaken_${i}_photoRef`, 'Photo reference', { placeholder: 'e.g. Photo #045' }));
      items.push(photo(`Actions Taken ${i}`, `_actionPhoto_${i}`));
    }
    return items;
  }

  function postObservationFields() {
    const items = [];
    for (let i = 1; i <= 6; i++) {
      if (i > 1) items.push(divider());
      items.push(text(`obs_${i}_location`, `Observation ${i} - Room`, {
        placeholder: 'e.g. Primary Bathroom'
      }));
      items.push(textarea(`obs_${i}_note`, 'Observation', {
        placeholder: 'e.g. Active moisture staining on drywall below showerhead - no active drip at time of inspection. (\uD83C\uDF99 speak then review)'
      }));
      items.push(text(`obs_${i}_photoRef`, 'Photo reference', { placeholder: 'e.g. Photo #023' }));
      items.push(photo(`Observation ${i}`, `_obsPhoto_${i}`));
    }
    return items;
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
      heading('Tests Conducted \u2014 Confirm Each Test'),
      info('Confirm each test run during this assessment and record how many samples were taken.'),
      yesno('testRunBreeze', 'Breeze ET (mold) \u2014 conducted?'),
      showIf(num('testRunBreezeCount', 'How many samples?'), 'testRunBreeze', 'Yes'),
      yesno('testRunBoulderBlue', 'Boulder Blue (allergen) \u2014 conducted?'),
      showIf(num('testRunBoulderBlueCount', 'How many?'), 'testRunBoulderBlue', 'Yes'),
      yesno('testRunWaterPanel', 'Water Panel (SafeHome) \u2014 conducted?'),
      showIf(num('testRunWaterPanelCount', 'How many?'), 'testRunWaterPanel', 'Yes'),
      yesno('testRunPFAS', 'PFAS (Cyclopure) \u2014 conducted?'),
      showIf(num('testRunPFASCount', 'How many?'), 'testRunPFAS', 'Yes'),
      yesno('testRunMicroplastics', 'Microplastics (IEH) \u2014 conducted?'),
      showIf(num('testRunMicroplasticsCount', 'How many?'), 'testRunMicroplastics', 'Yes'),
      yesno('testRunRadon', 'Radon (Airthings) \u2014 conducted?'),
      showIf(num('testRunRadonCount', 'How many?'), 'testRunRadon', 'Yes'),
      yesno('testRunATP', 'ATP \u2014 conducted?'),
      showIf(num('testRunATPCount', 'How many?'), 'testRunATP', 'Yes'),
      divider(),
      heading('Follow-Up Actions Needed'),
      info('Document recommended follow-up actions for Tanner and the client report. Fill as many as apply - leave unused entries blank.'),
      ...postFollowUpFields(),
      divider(),
      heading('Actions Taken During Assessment'),
      info('Document what you physically did on-site (replaced filter, cleaned under sink, etc.). Each entry appears in the report. Specify the photo number for each callout.'),
      ...postActionsTakenFields(),
      divider(),
      heading('Assessment Observations'),
      info('Notable findings for the report - include location, what you saw, and a photo for each. Specify photo number for each callout. Leave unused entries blank.'),
      ...postObservationFields(),
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
    { id: 'upper', name: 'Upper Level', icon: '6' },
    { id: 'rooms', name: 'Bedrooms & Bathrooms', icon: '6.5' },
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
  let screen = 'home'; // home | truck-check | intake | precheck | step | review
  let _truckCheck = {};
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
      steps.push({ id: 'bedroom-' + i, type: 'bedroom', phase: 'upper', name: 'Bedroom ' + (i + 1), index: i });
    }
    const numBath = parseInt(insp.numberOfBathrooms) || 1;
    for (let i = 0; i < numBath; i++) {
      steps.push({ id: 'bathroom-' + i, type: 'bathroom', phase: 'upper', name: 'Bathroom ' + (i + 1), index: i });
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

  // ── Save ───────────────────────────────────────────────────
  function showSave(msg) {
    lastSaveText = msg;
    const el = document.getElementById('save-status');
    if (el) el.textContent = msg;
  }

  function showSaveError(msg) {
    showSave(msg);
    // Big visible banner so Dave notices immediately
    let banner = document.getElementById('save-error-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'save-error-banner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#c0392b;color:#fff;font-size:15px;font-weight:bold;text-align:center;padding:12px;z-index:99999;cursor:pointer;';
      banner.addEventListener('click', () => banner.remove());
      document.body.appendChild(banner);
    }
    banner.textContent = msg + ' - Tap to dismiss';
  }

  async function saveNow() {
    if (!inspection) return;
    showSave('Saving...');
    try {
      await DB.save(inspection);
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      showSave('Saved \u2713 ' + t);
      backupToLocalStorage(); // mirror to localStorage as secondary safety net
      // Clear any previous save error banner
      const b = document.getElementById('save-error-banner');
      if (b) b.remove();
    } catch (e) {
      console.error('Save failed:', e);
      if (e && (e.name === 'QuotaExceededError' || (e.message && e.message.includes('quota')))) {
        showSaveError('\u26a0\ufe0f Storage full \u2014 SCREENSHOT THIS SCREEN NOW then tap Sync to Drive');
      } else {
        showSaveError('\u26a0\ufe0f Save failed \u2014 data may be lost on reload. Tap Sync to Drive now.');
      }
    }
  }

  function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveNow, 300);
  }

  // ── localStorage Shadow Backup ────────────────────────────
  // Secondary safety net: stores inspection JSON (no photo data) in localStorage.
  // Survives IndexedDB failures, quota issues, and accidental clears.
  function backupToLocalStorage() {
    if (!inspection || !inspection.inspectionId) return;
    try {
      const bak = JSON.parse(JSON.stringify(inspection));
      // Strip photo dataUrls - keep metadata only, not pixel data
      if (bak.stepData) {
        Object.values(bak.stepData).forEach(step => {
          Object.keys(step).forEach(k => {
            if (Array.isArray(step[k]) && step[k].length && step[k][0] && typeof step[k][0].photoId === 'string') {
              step[k] = step[k].map(p => ({
                photoId: p.photoId, stepName: p.stepName, roomName: p.roomName,
                caption: p.caption, timestamp: p.timestamp,
                uploaded: p.dataUrl === '__uploaded__'
              }));
            }
          });
        });
      }
      const key = 'inhaus_bak_' + inspection.inspectionId;
      localStorage.setItem(key, JSON.stringify({ data: bak, savedAt: new Date().toISOString() }));
      cleanOldLocalStorageBackups();
    } catch(e) { /* localStorage full or unavailable - not critical */ }
  }

  function cleanOldLocalStorageBackups() {
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('inhaus_bak_'));
      if (keys.length <= 5) return;
      const withTime = keys.map(k => {
        try { return { k, t: JSON.parse(localStorage.getItem(k)).savedAt }; } catch(e) { return { k, t: '' }; }
      }).sort((a, b) => (a.t < b.t ? -1 : 1));
      withTime.slice(0, withTime.length - 5).forEach(({ k }) => localStorage.removeItem(k));
    } catch(e) {}
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
    // ATP completion warning removed per Matt's request
    return [];
  }

  // ── Step Data Access ───────────────────────────────────────
  function getStepData(stepId) {
    if (!inspection.stepData) inspection.stepData = {};
    if (!inspection.stepData[stepId]) inspection.stepData[stepId] = { _stepId: stepId };
    return inspection.stepData[stepId];
  }

  // ── Add Dynamic Room ───────────────────────────────────────
  function addDynamicRoom(section, namePrefix) {
    if (!inspection.dynamicRooms) inspection.dynamicRooms = {};
    if (!inspection.dynamicRooms[section]) inspection.dynamicRooms[section] = [];

    const arr = inspection.dynamicRooms[section];
    const idx = arr.length;
    const defaultPrefix = section === 'lowest' ? 'Lowest Level - Room ' : 'Additional Room ';
    const prefix = namePrefix || defaultPrefix;
    const count = namePrefix ? arr.filter(r => r.name && r.name.startsWith(namePrefix)).length + 1 : idx + 1;
    arr.push({ name: prefix + ' ' + count });

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
      // Skip photos already uploaded (dataUrl cleared to '__uploaded__')
      if (!p.imageData || p.imageData === '__uploaded__') return null;
      return {
        photoId: p.photoId || '',
        imageData: p.imageData || '',
        caption: p.caption || '',
        roomName: p.roomName || fallbackRoomName || '',
        stepName: p.stepName || '',
        timestamp: p.timestamp || ''
      };
    }
    function extractFromSection(s, fallbackRoomName) {
      if (!s) return;
      for (const v of Object.values(s)) {
        if (Array.isArray(v) && v.length && v[0] && typeof v[0].photoId === 'string') {
          const picked = v.map(p => pickPhoto(p, fallbackRoomName)).filter(Boolean);
          photos.push(...picked);
        }
      }
    }
    const sectionKeys = ['preAssessmentChecklist', 'arrivalSetup', 'deviceSetup', 'exteriorAssessment',
                         'radonSetup', 'utilityRoom', 'wrapUp', 'customerDebrief', 'postAssessment'];
    sectionKeys.forEach(key => extractFromSection(exportData[key]));
    (exportData.rooms || []).forEach(room => extractFromSection(room, room.roomName));
    return photos;
  }

  function stripPhotosFromExport(exportData) {
    const stripped = JSON.parse(JSON.stringify(exportData));
    function stripFromSection(s) {
      if (!s) return;
      for (const k of Object.keys(s)) {
        if (Array.isArray(s[k]) && s[k].length && s[k][0] && typeof s[k][0].photoId === 'string') {
          delete s[k];
        }
      }
    }
    const sectionKeys = ['preAssessmentChecklist', 'arrivalSetup', 'deviceSetup', 'exteriorAssessment',
                         'radonSetup', 'utilityRoom', 'wrapUp', 'customerDebrief', 'postAssessment'];
    sectionKeys.forEach(key => stripFromSection(stripped[key]));
    (stripped.rooms || []).forEach(room => stripFromSection(room));
    return stripped;
  }

  // ── Real-time single-photo upload ─────────────────────────
  async function uploadPhotoImmediate(photo, inspectionId, clientName, propertyAddress) {
    if (!GOOGLE_SCRIPT_URL || !inspectionId) return;
    if (!photo.dataUrl || photo.dataUrl === '__uploaded__') return;
    const originalDataUrl = photo.dataUrl;

    const payload = {
      photoUploadOnly: true,
      inspectionId: inspectionId,
      clientName: clientName || '',
      propertyAddress: propertyAddress || '',
      photos: [{
        photoId: photo.photoId || '',
        roomName: photo.roomName || '',
        stepName: photo.stepName || '',
        imageData: originalDataUrl || '',
        caption: photo.caption || ''
      }]
    };

    async function doUpload() {
      return fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    try {
      // ── First upload attempt ──────────────────────────────────────────
      await doUpload();
      photo._uploadAttempts = 1;
      // Keep dataUrl in IndexedDB for now - schedule a second attempt before clearing.
      // no-cors means we cannot confirm server receipt. Uploading twice dramatically
      // reduces the chance of silent loss before we clear the local copy.
      setTimeout(async () => {
        if (!photo.dataUrl || photo.dataUrl === '__uploaded__') return; // cleared by manual sync
        try {
          await doUpload();
          photo._uploadAttempts = 2;
        } catch(e) {
          console.warn('Photo second-attempt failed, keeping in IndexedDB:', e);
          // Don't clear - keep original so manual Sync to Drive can retry
          return;
        }
        photo._uploaded = true;
        photo.dataUrl = '__uploaded__';
        scheduleSave();
      }, 12000); // 12-second gap before second attempt
    } catch(e) {
      console.warn('Photo upload failed, keeping in IndexedDB for retry on export:', e);
      photo.dataUrl = originalDataUrl;
    }
  }
  window.uploadPhotoImmediate = uploadPhotoImmediate;

  async function sendToGoogleScript(exportData) {
    // Always strip photos from main payload - send data first, then photos separately
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

  // ── Step Checkpoint Sync ──────────────────────────────────
  // Fire-and-forget backup after each step completes.
  // Silent on failure - close-out export is still the authoritative save.
  async function checkpointToCloud() {
    if (!inspection || !GOOGLE_SCRIPT_URL || !navigator.onLine) return;
    try {
      const exportData = buildExportJSON();
      const payload = stripPhotosFromExport(exportData);
      payload._checkpoint = true;
      fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.log('Checkpoint sync skipped:', e);
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

    const overlay = el('div', { id: 'room-drawer-overlay', className: 'room-drawer-overlay' });
    const drawer = el('div', { className: 'room-drawer' });

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    drawer.addEventListener('click', e => e.stopPropagation());

    drawer.appendChild(el('div', { className: 'room-drawer-handle' }));
    drawer.appendChild(el('div', { className: 'room-drawer-title' }, '\uD83D\uDCCD Navigate'));

    const scrollArea = el('div', { className: 'room-drawer-scroll' });

    DRAWER_GROUPS.forEach(group => {
      // All steps in this group's phases - no type restrictions (review included in Wrap-Up)
      const groupSteps = stepList.filter(s => group.phases.includes(s.phase));
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

        const ROOM_NAMED_TYPES = ['bedroom', 'bathroom', 'room-test', 'additional-room'];
        const stepRoomName = ROOM_NAMED_TYPES.includes(s.type) &&
          inspection.stepData && inspection.stepData[s.id] && inspection.stepData[s.id].roomName;
        const displayName = stepRoomName || s.name;

        scrollArea.appendChild(el('div', {
          className: cls,
          onClick: () => {
            currentStepIdx = sIdx;
            overlay.remove();
            render();
            window.scrollTo(0, 0);
          }
        }, [
          el('span', { className: 'room-item-name' }, displayName),
          statusText ? el('span', { className: 'room-item-status' + (completed ? ' status-done' : ' status-partial') }, statusText) : null
        ]));
      });

      // Per-section add-room buttons (Lowest Level, Upper Level, Additional Rooms)
      if (group.addRooms && group.addRooms.length) {
        const addRow = el('div', { className: 'room-drawer-section-add' });
        group.addRooms.forEach(addDef => {
          addRow.appendChild(el('button', {
            type: 'button',
            className: 'room-drawer-add-item-btn',
            onClick: () => {
              overlay.remove();
              addDynamicRoom(addDef.section, addDef.prefix);
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
    window.inspection = inspection; // expose for real-time photo upload in ui.js
    root.innerHTML = ''
    switch (screen) {
      case 'home': renderHome(); break;
      case 'truck-check': renderTruckCheck(); break;
      case 'intake': renderIntake(); break;
      case 'precheck': renderPrecheck(); break;
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
      onClick: () => { screen = 'truck-check'; render(); }
    }, 'New Inspection'));

    // ── Inspector mode toggle ─────────────────────────────────
    const isExp = localStorage.getItem('inhaus_experienced') === 'true';
    const modeBtn = el('button', {
      className: 'btn btn-outline btn-full',
      style: 'margin-top:8px;font-size:0.85rem;color:#5a7a3a;border-color:#c8d8b8;',
      onClick: () => {
        const nowExp = localStorage.getItem('inhaus_experienced') === 'true';
        localStorage.setItem('inhaus_experienced', nowExp ? 'false' : 'true');
        render();
      }
    }, isExp
      ? '\uD83D\uDCCB Process steps collapsed (experienced mode) - tap to show all'
      : '\u2705 Process steps expanded (guided mode) - tap to collapse for experienced inspectors'
    );
    c.appendChild(modeBtn);

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

  // ── TRUCK CHECK SCREEN ────────────────────────────────────
  function renderTruckCheck() {
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
      return SECTIONS.flatMap(s => s.items).filter(i => !!_truckCheck[i.key]).length;
    }
    function totalItems() {
      return SECTIONS.flatMap(s => s.items).length;
    }
    function allRequiredChecked() {
      return allRequired.every(i => !!_truckCheck[i.key]);
    }

    const c = el('div', { className: 'screen' });
    c.appendChild(buildAppHeader());

    // Reset / back link
    const resetBar = el('div', { className: 'truck-check-reset-bar' });
    const resetLink = el('button', {
      className: 'btn-link',
      onClick: () => { screen = 'home'; render(); }
    }, '← Back to Home');
    resetBar.appendChild(resetLink);
    c.appendChild(resetBar);

    const card = el('div', { className: 'card' });

    // Header
    card.appendChild(el('h2', { className: 'screen-title' }, '🚛 Loading Truck Checklist'));
    card.appendChild(el('p', { className: 'truck-check-subtitle' }, 'Check off every item before leaving'));

    // Progress counter
    const progressEl = el('div', { className: 'truck-check-progress' }, countChecked() + ' of ' + totalItems() + ' items checked');
    card.appendChild(progressEl);

    // Sections
    SECTIONS.forEach(section => {
      card.appendChild(el('div', { className: 'section-heading' }, section.title));
      section.items.forEach(item => {
        const box = el('div', {
          className: 'check-box' + (_truckCheck[item.key] ? ' checked' : '')
        }, _truckCheck[item.key] ? '\u2713' : '');
        const labelText = item.label + (item.asNeeded ? ' (as needed)' : !item.required ? ' (optional)' : '');
        const row = el('div', {
          className: 'check-item' + (!item.required ? ' optional-item' : ''),
          onClick: () => {
            _truckCheck[item.key] = !_truckCheck[item.key];
            box.className = 'check-box' + (_truckCheck[item.key] ? ' checked' : '');
            box.textContent = _truckCheck[item.key] ? '\u2713' : '';
            const checked = countChecked();
            progressEl.textContent = checked + ' of ' + totalItems() + ' items checked';
            continueBtn.className = 'btn btn-full ' + (allRequiredChecked() ? 'btn-primary' : 'btn-disabled');
            continueBtn.disabled = !allRequiredChecked();
          }
        });
        row.appendChild(box);
        row.appendChild(el('div', { className: 'check-label' }, labelText));
        card.appendChild(row);
      });
    });

    // Continue button
    const ready = allRequiredChecked();
    const continueBtn = el('button', {
      className: 'btn btn-full ' + (ready ? 'btn-primary' : 'btn-disabled'),
      disabled: !ready,
      onClick: () => {
        if (!allRequiredChecked()) return;
        screen = 'intake';
        render();
      }
    }, 'Continue \u2192');

    card.appendChild(el('div', { style: 'margin-top: 1.5rem;' }, [continueBtn]));
    c.appendChild(card);
    root.appendChild(c);
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
      blueprintNotes: inspection.blueprintNotes || '',
      inspectorEmail: inspection.inspectorEmail || ''
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
      sel('numberOfLevels', 'Number of Levels *', ['1', '2', '3', '4', '5']),
      sel('numberOfBedrooms', 'Number of Bedrooms *', ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15']),
      sel('numberOfBathrooms', 'Number of Bathrooms *', ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19','20']),
      chips('waterSource', 'Water Source * (select all that apply)', ['Municipal', 'Well', 'Spring', 'Cistern', 'Other']),
      showIf(text('waterSourceDescription', 'If "Other": describe water source', { placeholder: 'e.g. Private spring on property' }), 'waterSource', 'Other'),
      divider(),
      text('wifiNetwork', 'Home wifi network name'),
      text('wifiPassword', 'WiFi Password', { placeholder: 'For Airthings and device connectivity' }),
      { type: 'wifi-copy' },
      textarea('clientConcerns', 'Client concerns / known problem areas', { placeholder: '\uD83C\uDF99 Using voice dictation? Read it back and fix errors before saving.' }),
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
        if (isEdit) { screen = 'step'; render(); } else { screen = 'truck-check'; render(); }
      } }, isEdit ? '\u2190 Back to Steps' : '\u2190 Back'),
      el('button', { className: 'btn btn-primary btn-nav', onClick: () => {
        const required = ['inspectorName', 'clientName', 'propertyAddress', 'numberOfLevels', 'numberOfBedrooms', 'numberOfBathrooms'];
        const missing = required.filter(k => !data[k] || !data[k].trim || !data[k].trim());
        if (!data.waterSource || (Array.isArray(data.waterSource) ? data.waterSource.length === 0 : !data.waterSource)) missing.push('waterSource');
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
            _lastStepIdx: 0,
            truckCheck: Object.assign({}, _truckCheck)
          };
          stepList = buildStepList(inspection);
          currentStepIdx = 0;
          screen = 'precheck';
          saveNow().then(() => render());
        }
      }}, isEdit ? 'Save Changes \u2713' : 'Start Inspection \u2192')
    ]);
    c.appendChild(nav);
    root.appendChild(c);
  }

  // ── STEP SCREEN ────────────────────────────────────────────
  function renderPrecheck() {
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
      const onFieldChange = () => { data._updatedAt = new Date().toISOString(); scheduleSave(); UI.updateShowIf(card, data); };
      fields.forEach(f => {
        const rendered = UI.renderField(f, data, onFieldChange, inspection, () => scheduleSave());
        if (rendered) card.appendChild(rendered);
      });
      UI.updateShowIf(card, data);
    }
    c.appendChild(card);

    const nav = document.createElement('div');
    nav.className = 'bottom-nav';

    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-outline btn-nav';
    backBtn.textContent = '← Back';
    backBtn.onclick = () => { screen = 'home'; render(); };

    const startBtn = document.createElement('button');
    startBtn.className = 'btn btn-primary btn-nav';
    startBtn.textContent = 'Begin Inspection →';
    startBtn.style = 'background:#2C3F16;';
    startBtn.onclick = () => {
      data._visited = true;
      data._completedAt = new Date().toISOString();
      currentStepIdx = 1; // skip equipment step - already done here
      screen = 'step';
      saveNow().then(() => { render(); window.scrollTo(0, 0); });
    };

    nav.appendChild(backBtn);
    nav.appendChild(startBtn);
    c.appendChild(nav);
    root.innerHTML = '';
    root.appendChild(c);
  }

  function renderStep() {
    if (currentStepIdx >= stepList.length) { screen = 'review'; render(); return; }
    const step = stepList[currentStepIdx];
    if (step.type === 'review') { screen = 'review'; render(); return; }

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
            const addr = (inspection.propertyAddress || 'Inspection address').replace(/,/g, '\\,');
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
    if (step.type === 'debrief' && !data.radonPickupTime && inspection.startedAt) {
      const pickupMs = new Date(inspection.startedAt).getTime() + 54 * 60 * 60 * 1000;
      const d = new Date(pickupMs);
      const pad = n => String(n).padStart(2, '0');
      data.radonPickupTime = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    // Room name left blank intentionally - Dave types the actual room name

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
      if (idx >= 0) { currentStepIdx = idx; render(); }
    }, currentStepIdx + 1, stepList.length));

    const phaseSteps = stepList.filter(s => s.phase === currentPhase && s.type !== 'review');
    const alwaysShowSubNav = ['lowest', 'upper', 'rooms', 'supplementary', 'wrapup'].includes(currentPhase);
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
      style: 'position:fixed;top:max(54px,calc(env(safe-area-inset-top) + 8px));right:10px;z-index:200;font-size:11px;padding:4px 10px;display:inline-flex;align-items:center;justify-content:center;',
      onClick: () => { screen = 'intake'; render(); }
    }, '\u270E Intake');
    c.appendChild(backToIntakeBtn);

    // Search button
    const searchBtn = el('button', {
      type: 'button',
      style: 'position:fixed;top:max(54px,calc(env(safe-area-inset-top) + 8px));right:82px;z-index:200;background:#2C3F16;color:#fff;border:none;border-radius:8px;font-size:15px;padding:6px 12px;cursor:pointer;min-height:0;line-height:1.4;font-weight:700;touch-action:manipulation;box-shadow:0 2px 8px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;',
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

    // Spare photos FAB
    const spareFab = el('button', {
      type: 'button',
      style: 'position:fixed;bottom:160px;right:16px;width:48px;height:48px;background:#f59e0b;color:#fff;border:none;border-radius:50%;font-size:1.3rem;cursor:pointer;z-index:95;box-shadow:0 4px 14px rgba(0,0,0,0.25);touch-action:manipulation;display:flex;align-items:center;justify-content:center;',
      'aria-label': 'Add spare photo',
      onClick: () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
        inp.onchange = async e => {
          if (!e.target.files[0]) return;
          try {
            const dataUrl = await UI.compressImage ? UI.compressImage(e.target.files[0]) : new Promise(r => { const fr = new FileReader(); fr.onload = ev => r(ev.target.result); fr.readAsDataURL(e.target.files[0]); });
            if (!inspection.sparePhotos) inspection.sparePhotos = [];
            const sp = { photoId: 'spare-' + Math.random().toString(36).substr(2,9), timestamp: new Date().toISOString(), caption: '', dataUrl, stepName: step.name, roomName: (getStepData(step.id).roomName || step.name) };
            inspection.sparePhotos.push(sp);
            saveNow();
            showToast('\uD83D\uDCF8 Spare photo saved - sort it later in Review');
            // Save to device camera roll
            if (window.savePhotoToDevice) window.savePhotoToDevice(dataUrl, sp.photoId);
          } catch(err) { console.error(err); }
        };
        document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 2000);
      }
    }, '📸');
    c.appendChild(spareFab);

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
    if (step.type === 'bedroom') {
      const bedroomSteps = stepList.filter(s => s.type === 'bedroom');
      if (step.id === bedroomSteps[bedroomSteps.length - 1].id) {
        c.appendChild(el('button', { className: 'btn btn-outline btn-full', style: 'margin-top:8px', onClick: () => { addDynamicRoom('additional', 'Bedroom'); window.scrollTo(0, 0); } }, '+ Add Another Bedroom'));
      }
    }
    if (step.type === 'bathroom') {
      const bathroomSteps = stepList.filter(s => s.type === 'bathroom');
      if (step.id === bathroomSteps[bathroomSteps.length - 1].id) {
        c.appendChild(el('button', { className: 'btn btn-outline btn-full', style: 'margin-top:8px', onClick: () => { addDynamicRoom('additional', 'Bathroom'); window.scrollTo(0, 0); } }, '+ Add Another Bathroom'));
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
      el('button', {
        type: 'button',
        className: 'btn btn-outline btn-home',
        onClick: () => {
          if (confirm('Return to home? Your progress is saved.')) {
            screen = 'home';
            render();
          }
        }
      }, '\uD83C\uDFE0'),
      el('button', { className: 'btn btn-primary btn-nav', onClick: () => {
        const missing = validateStep(step);
        if (missing.length) { showToast(missing.length + ' item' + (missing.length > 1 ? 's' : '') + ' still required'); flashUncheckedItems(c); return; }
        const warnings = warnStep(step);
        if (warnings.length) { showToast('\u26a0\ufe0f ' + warnings.join(', '), 3500); }
        data._completedAt = new Date().toISOString();
        currentStepIdx++;
        saveNow().then(() => { render(); window.scrollTo(0, 0); });
        checkpointToCloud(); // fire-and-forget backup - silent on failure
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

    // Status legend bar
    const legendBar = el('div', { style: 'background:#f0f7ee;border-radius:8px;padding:10px 14px;margin:0 0 8px;font-size:0.8rem;color:#4a5568;line-height:1.6;' });
    legendBar.innerHTML = '<strong style="color:#2C3F16">Status guide:</strong>' +
      ' <span style="background:#e8f5e9;padding:2px 6px;border-radius:4px;">Visited</span> = section opened during inspection.' +
      ' <span style="background:#fef3c7;padding:2px 6px;border-radius:4px;">Not visited</span> = section was skipped.' +
      ' Photos showing <strong>\u2601\ufe0f Uploaded to Drive</strong> have been synced to Google Drive - their local copy has been cleared to save storage.' +
      ' A photo marked <strong>?</strong> or <em>Unreviewed</em> in a report means no caption was added - tap the photo here to add one.';
    c.appendChild(legendBar);

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
      ['Water Source', (Array.isArray(inspection.waterSource) ? inspection.waterSource.join(', ') : (inspection.waterSource || '--')) + (inspection.waterSourceDescription ? ' (' + inspection.waterSourceDescription + ')' : '')],
      ['Wifi', inspection.wifiNetwork],
      ['Occupancy', inspection.stepData?.['property-details']?.occupancyDuringInspection], ['Weather', inspection.stepData?.['property-details']?.weatherConditions],
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

    // ── Room Summaries ──
    const summariesCard = el('div', { className: 'card' });
    summariesCard.appendChild(el('h3', { className: 'section-heading' }, 'Room Findings'));

    // Collect all rooms that have raw notes OR an AI summary
    const roomStepTypes = ['room-test','bedroom','bathroom','living-area','kitchen-appliance','water-sample','atp-kitchen','kitchen-air','additional-room','utility'];
    const roomSteps = stepList.filter(s => {
      if (!roomStepTypes.includes(s.type)) return false;
      const d = inspection.stepData && inspection.stepData[s.id];
      return d && (d.aiSummary || d.notes || (d.observations && d.observations.length) || d.followUpNote);
    });

    if (roomSteps.length === 0) {
      summariesCard.appendChild(el('p', { style: 'color:var(--text-muted);font-size:0.9rem;padding:8px 0;' }, 'No room findings yet'));
    } else {
      roomSteps.forEach(s => {
        const d = inspection.stepData[s.id];
        const roomBlock = el('div', { style: 'margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--accent-light);' });

        // Room name
        roomBlock.appendChild(el('div', { style: 'font-weight:700;font-size:1rem;color:var(--primary);margin-bottom:8px;' }, d.roomName || s.name));

        // Raw notes side
        const hasObs = d.observations && d.observations.length > 0;
        const hasNotes = d.notes && d.notes.trim();
        const hasFollowUp = d.followUpNote && d.followUpNote.trim();
        const hasRaw = hasObs || hasNotes || hasFollowUp;

        if (hasRaw) {
          const rawBlock = el('div', { style: 'background:#f8f9fa;border-left:3px solid #aaa;border-radius:0 6px 6px 0;padding:8px 10px;margin-bottom:8px;font-size:0.85rem;' });
          rawBlock.appendChild(el('div', { style: 'font-size:0.75rem;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;' }, 'Inspector Notes'));
          if (hasObs) rawBlock.appendChild(el('div', { style: 'margin-bottom:4px;' }, 'Observations: ' + d.observations.join(', ')));
          if (hasNotes) rawBlock.appendChild(el('div', { style: 'margin-bottom:4px;' }, d.notes.trim()));
          if (hasFollowUp) rawBlock.appendChild(el('div', { style: 'color:#b45309;' }, '⚠️ Follow-up: ' + d.followUpNote.trim()));
          roomBlock.appendChild(rawBlock);
        }

        // AI summary side
        if (d.aiSummary) {
          const aiBlock = el('div', { style: 'background:#f0f7ee;border-left:3px solid var(--primary);border-radius:0 6px 6px 0;padding:8px 10px;font-size:0.85rem;' });
          aiBlock.appendChild(el('div', { style: 'font-size:0.75rem;font-weight:600;color:var(--primary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;' }, 'AI Summary'));
          aiBlock.appendChild(el('div', null, d.aiSummary));
          roomBlock.appendChild(aiBlock);
        }

        summariesCard.appendChild(roomBlock);
      });
    }
    c.appendChild(summariesCard);

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
        // Show all photo arrays (handles _photos, _beforePhotos, _afterPhotos, ATP photos, etc.)
        const photoArrayKeys = Object.keys(data).filter(k =>
          k.startsWith('_') && Array.isArray(data[k]) && data[k].length &&
          data[k][0] && typeof data[k][0].photoId === 'string'
        );
        photoArrayKeys.forEach(pk => {
          const arr = data[pk];
          const labelRaw = pk.slice(1).replace(/Photos$/, '').replace(/([A-Z])/g, ' $1').trim();
          const label = (labelRaw || 'All') + ' Photos';
          summary.appendChild(el('div', { className: 'review-photos-section' }, [el('strong', null, arr.length + ' ' + label + ':')]));
          const grid = el('div', { className: 'review-photo-grid' });
          arr.forEach(p => {
            grid.appendChild(el('div', { className: 'review-photo-item' }, [
              el('img', { src: p.dataUrl, className: 'review-photo-img' }),
              p.caption ? el('div', { className: 'review-photo-caption' }, p.caption) : null
            ]));
          });
          summary.appendChild(grid);
        });
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


    // Spare Photos section in Review
    if (inspection.sparePhotos && inspection.sparePhotos.length) {
      const spHead = document.createElement('div');
      spHead.style = 'background:#fff8e1;border-left:4px solid #f59e0b;padding:12px 16px;margin:16px 0 8px;border-radius:4px;';
      spHead.innerHTML = '<span style="font-weight:800;color:#92400e;">📸 Spare Photos (' + inspection.sparePhotos.length + ')</span><span style="font-size:11px;color:#64748b;margin-left:8px;">Add captions to assign them</span>';
      c.appendChild(spHead);
      inspection.sparePhotos.forEach((sp, i) => {
        const spCard = document.createElement('div');
        spCard.className = 'photo-card';
        spCard.style = 'margin-bottom:10px;';
        const spImg = document.createElement('img');
        spImg.src = sp.dataUrl; spImg.className = 'photo-img'; spImg.alt = 'Spare ' + (i+1);
        const spMeta = document.createElement('div');
        spMeta.style = 'padding:4px 10px;font-size:11px;color:#64748b;';
        spMeta.textContent = 'Captured during: ' + (sp.roomName || sp.stepName || 'inspection') + ' • ' + new Date(sp.timestamp).toLocaleTimeString();
        const spCap = document.createElement('input');
        spCap.type = 'text'; spCap.placeholder = 'Caption or room assignment...';
        spCap.value = sp.caption || '';
        spCap.style = 'width:100%;border:none;border-top:1px solid #e5e7eb;padding:10px;font-size:13px;font-family:inherit;';
        spCap.oninput = () => { sp.caption = spCap.value; scheduleSave(); };
        spCard.appendChild(spImg); spCard.appendChild(spMeta); spCard.appendChild(spCap);
        c.appendChild(spCard);
      });
    }

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

      occupancyDuringInspection: (inspection.stepData?.['property-details']?.occupancyDuringInspection) || '',
      weatherConditions: (inspection.stepData?.['property-details']?.weatherConditions) || '',
      knownProblemAreas: inspection.knownProblemAreas || '',
      startedAt: inspection.startedAt,
      endedAt: inspection.endedAt,
      status: inspection.status,
      sharedDriveFolderId: SHARED_DRIVE_FOLDER_ID || '',

      // ── Key test identifiers & locations ────────────────────────
      boulderBlueSampleId: (inspection.stepData?.arrival?.boulderBlueSampleId) || '',
      boulderBlueTestLocation: (inspection.stepData?.arrival?.boulderBlueTestLocation) || '',
      boulderBlueStartTime: (inspection.stepData?.arrival?.boulderBlueStartTime) || '',
      boulderBlueEndTime: (inspection.stepData?.debrief?.boulderBlueEndTime) || '',
      boulderBlueTestDuration: (inspection.stepData?.debrief?.boulderBlueTestDuration) || '',
      radonMonitorLocation: (inspection.stepData?.radon?.radonLocation) || '',
      secondRadonMonitorLocation: (inspection.stepData?.radon?.secondMonitorLocation) || '',
      pfasKitNum: (inspection.stepData?.['device-setup']?.pfasKitNum) || '',
      exhaustHoodType: (inspection.stepData?.['kitchen-appliance']?.exhaustHoodType) || '',
      exhaustVented: (inspection.stepData?.['kitchen-appliance']?.exhaustVented) || '',

      // ── Test confirmation (from Before Leaving step) ────────────
      testsConfirmed: (inspection.stepData?.['final-checks']?.testsConfirmed) || {},
      breezeSampleCount: (inspection.stepData?.['final-checks']?.breezeSampleCount) || '',
      moldSwabSampleCount: (inspection.stepData?.['final-checks']?.moldSwabSampleCount) || '',
      atpTestCount: (inspection.stepData?.['final-checks']?.atpTestCount) || '',
      testsNotConducted: (inspection.stepData?.['final-checks']?.testsNotConducted) || '',

      // ── Post-assessment test location summary ──────────────
      postTestLocWater: (inspection.stepData?.['post-assessment']?.postTestLocWater) || '',
      postTestLocPFAS: (inspection.stepData?.['post-assessment']?.postTestLocPFAS) || '',
      postTestLocBoulderBlue: (inspection.stepData?.['post-assessment']?.postTestLocBoulderBlue) || '',
      postTestLocBreeze: (inspection.stepData?.['post-assessment']?.postTestLocBreeze) || '',
      postTestLocRadon: (inspection.stepData?.['post-assessment']?.postTestLocRadon) || '',
      postTestLocQtrak: (inspection.stepData?.['post-assessment']?.postTestLocQtrak) || '',
      postTestLocMold: (inspection.stepData?.['post-assessment']?.postTestLocMold) || '',
      postTestLocAllergen: (inspection.stepData?.['post-assessment']?.postTestLocAllergen) || '',

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

    const propDetailsData = inspection.stepData?.['property-details'] || {};
    exp.windowsOpen = propDetailsData.windowsOpen || '';
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

    // Room summaries
    const roomSummaries = {};
    stepList.forEach(step => {
      const d = inspection.stepData && inspection.stepData[step.id];
      if (d && d.aiSummary) {
        roomSummaries[step.id] = {
          roomName: d.roomName || step.name,
          summary: d.aiSummary,
          generatedAt: d.aiSummaryGeneratedAt || null
        };
      }
    });
    exp.roomSummaries = roomSummaries;

    // Follow-up plan
    const debriefData = inspection.stepData && inspection.stepData.debrief;
    if (debriefData && debriefData.aiFollowUpPlan) {
      exp.aiFollowUpPlan = debriefData.aiFollowUpPlan;
      exp.aiFollowUpPlanGeneratedAt = debriefData.aiFollowUpPlanGeneratedAt || null;
    }

    // ── FLIR image log ─────────────────────────────────────────
    const flirLog = [];
    stepList.forEach(step => {
      const d = inspection.stepData && inspection.stepData[step.id];
      if (!d) return;
      // Single FLIR fields (bedroom/room-test)
      if (d.flirImageLabel || d.flirPhotoNum) {
        flirLog.push({ room: d.roomName || step.name, label: d.flirImageLabel || '', imgNum: d.flirPhotoNum || '' });
      }
      // FLIR log fields (living-area uses numbered fields)
      for (let i = 1; i <= 5; i++) {
        if (d['flirImageLabel' + i] || d['flirImg' + i]) {
          flirLog.push({ room: d['flirRoom' + i] || step.name + ' (' + i + ')', label: d['flirImageLabel' + i] || '', imgNum: d['flirImg' + i] || '' });
        }
      }
    });
    if (flirLog.length) exp.flirImageLog = flirLog;

    // ── Water source as readable string ──────────────────────
    exp.waterSourceReadable = Array.isArray(exp.waterSource)
      ? exp.waterSource.join(', ') + (exp.waterSourceDescription ? ' (' + exp.waterSourceDescription + ')' : '')
      : ((exp.waterSource || '') + (exp.waterSourceDescription ? ' (' + exp.waterSourceDescription + ')' : ''));

    return exp;
  }

  function cleanStepData(data) {
    if (!data) return {};
    const clean = {};
    function exportPhotos(arr) {
      return arr.map(p => ({
        photoId: p.photoId, roomName: p.roomName, stepName: p.stepName,
        timestamp: p.timestamp, caption: p.caption, imageData: p.dataUrl
      }));
    }
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('_')) continue;
      clean[k] = v;
    }
    // Export all photo arrays (any _-prefixed key holding photo objects)
    for (const [k, v] of Object.entries(data)) {
      if (!k.startsWith('_')) continue;
      if (!Array.isArray(v) || !v.length) continue;
      if (v[0] && typeof v[0].photoId === 'string') {
        clean[k.slice(1)] = exportPhotos(v); // strip leading _ for export key
      }
    }
    return clean;
  }

  // ── Init ───────────────────────────────────────────────────
  window.addEventListener('online', () => {
    const badge = document.querySelector('.online-badge');
    if (badge) { badge.textContent = ''; badge.className = 'online-badge online'; }
  });
  window.addEventListener('offline', () => {
    const badge = document.querySelector('.online-badge');
    if (badge) { badge.textContent = '\u25cf Offline'; badge.className = 'online-badge offline'; }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(e => console.log('SW failed:', e));
  }

  retryQueuedUploads();
  render();

  // ── Storage quota monitor ──────────────────────────────────
  async function checkStorageQuota() {
    if (!navigator.storage || !navigator.storage.estimate) return;
    try {
      const { usage, quota } = await navigator.storage.estimate();
      const pct = quota > 0 ? (usage / quota) * 100 : 0;
      if (pct > 80) {
        let banner = document.getElementById('save-error-banner');
        if (!banner) {
          banner = document.createElement('div');
          banner.id = 'save-error-banner';
          banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#e67e22;color:#fff;font-size:15px;font-weight:bold;text-align:center;padding:12px;z-index:99999;cursor:pointer;';
          banner.addEventListener('click', () => banner.remove());
          document.body.appendChild(banner);
        }
        banner.textContent = '\u26a0\ufe0f Storage ' + Math.round(pct) + '% full \u2014 go to Review and tap Sync to Drive now';
      }
    } catch(e) { /* quota check not critical */ }
  }
  checkStorageQuota();
  setInterval(checkStorageQuota, 60000); // check every minute

  // ── Periodic auto-save every 30s (safety net) ───────────────
  setInterval(() => {
    if (inspection && screen === 'step') {
      saveNow();
    }
  }, 30000);

  // ── 5-minute auto-checkpoint + localStorage backup ────────────
  // Pushes full data JSON to Drive every 5 minutes during active inspection.
  // Also refreshes localStorage mirror. Belt-and-suspenders against data loss.
  setInterval(() => {
    if (inspection && screen === 'step') {
      checkpointToCloud();
      backupToLocalStorage();
    }
  }, 5 * 60 * 1000);

})();
