// InHaus Inspector - Inspection Export Logic
import { getInspection } from './state.js?v=160';
import { SHARED_DRIVE_FOLDER_ID } from './config.js?v=160';

export function extractAllPhotosFromExport(exportData) {
  const photos = [];
  function pickPhoto(p, fallbackRoomName) {
    // Include already-uploaded photos (they have driveUrl but dataUrl cleared)
    const imageData = p.imageData || p.dataUrl || '';
    const hasData = imageData && imageData !== '__uploaded__';
    const hasDrive = p.driveUrl || p.driveId;
    if (!hasData && !hasDrive) return null;
    return {
      photoId: p.photoId || '',
      imageData: hasData ? imageData : '',
      caption: p.caption || '',
      roomName: p.roomName || fallbackRoomName || '',
      stepName: p.stepName || '',
      timestamp: p.timestamp || '',
      placementSource: p.placementSource || '',
      routingStatus: p.routingStatus || '',
      driveUrl: p.driveUrl || null,
      driveId: p.driveId || null
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
  if (Array.isArray(exportData.sparePhotos)) {
    exportData.sparePhotos.forEach(photo => {
      const picked = pickPhoto(photo, photo.roomName || photo.stepName || '');
      if (picked) photos.push(picked);
    });
  }
  return photos;
}

export function stripPhotosFromExport(exportData) {
  const stripped = JSON.parse(JSON.stringify(exportData));
  // Strip sensitive fields — WiFi password must not be in Drive/Sheets export
  if (stripped.wifiPassword) delete stripped.wifiPassword;
  if (stripped.intake && stripped.intake.wifiPassword) delete stripped.intake.wifiPassword;
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

  // Defense in depth: photo fields can be introduced by new steps or legacy
  // saved data outside the fixed section list above. Never allow image bytes
  // into the assessment JSON, regardless of nesting depth.
  function stripEmbeddedImageData(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(stripEmbeddedImageData);
      return;
    }
    Object.keys(value).forEach(key => {
      if ((key === 'imageData' || key === 'dataUrl') && typeof value[key] === 'string') {
        delete value[key];
        return;
      }
      if (key === 'wifiPassword') {
        delete value[key];
        return;
      }
      stripEmbeddedImageData(value[key]);
    });
  }
  stripEmbeddedImageData(stripped);
  return stripped;
}

function exportPhotoArray(arr) {
  return arr.map(p => ({
    photoId: p.photoId,
    roomName: p.roomName,
    stepName: p.stepName,
    timestamp: p.timestamp,
    caption: p.caption,
    placementSource: p.placementSource || '',
    routingStatus: p.routingStatus || '',
    assignedSlot: p.assignedSlot || null,
    imageData: p.dataUrl,
    driveUrl: p.driveUrl || null,
    driveId: p.driveId || null
  }));
}

function cleanStepData(data) {
  if (!data) return {};
  const clean = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('_')) continue;
    clean[k] = v;
  }
  // Export all photo arrays (any _-prefixed key holding photo objects)
  for (const [k, v] of Object.entries(data)) {
    if (!k.startsWith('_')) continue;
    if (!Array.isArray(v) || !v.length) continue;
    if (v[0] && typeof v[0].photoId === 'string') {
      clean[k.slice(1)] = exportPhotoArray(v); // strip leading _ for export key
    }
  }
  return clean;
}

// ── Export JSON Builder ────────────────────────────────────
export function buildExportJSON(stepList) {
  const inspection = getInspection();
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
    // NOTE: pets + stoveType are now chips (arrays) — normalize to string immediately so
    // Apps Script receives a plain string regardless of old vs new format.
    pets: (() => { const v = (inspection.stepData?.['property-details']?.pets) || ''; return Array.isArray(v) ? v.join(', ') : v; })(),
    petsOther: (inspection.stepData?.['property-details']?.petsOther) || '',
    smokingVaping: (inspection.stepData?.['property-details']?.smokingVaping) || '',
    stoveType: (() => { const v = (inspection.stepData?.['kitchen-appliance']?.stoveType) || (inspection.stepData?.['property-details']?.stoveType) || ''; return Array.isArray(v) ? v.join(', ') : v; })(),
    stoveTypeOther: (inspection.stepData?.['kitchen-appliance']?.stoveTypeOther) || (inspection.stepData?.['property-details']?.stoveTypeOther) || '',
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
    sparePhotos: exportPhotoArray(inspection.sparePhotos || []),
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
    // Legacy single FLIR fields (old saved data compat)
    if (d.flirImageLabel || d.flirPhotoNum) {
      flirLog.push({ room: d.roomName || step.name, label: d.flirImageLabel || '', imgNum: d.flirPhotoNum || '' });
    }
    // Numbered FLIR log entries (all steps now use this format; up to 20)
    for (let i = 1; i <= 20; i++) {
      if (d['flirImageLabel' + i] || d['flirImg' + i] || d['flirRoom' + i]) {
        flirLog.push({ room: d['flirRoom' + i] || step.name, label: d['flirImageLabel' + i] || '', imgNum: d['flirImg' + i] || '' });
      }
    }
  });
  if (flirLog.length) exp.flirImageLog = flirLog;

  // ── Water source as readable string ──────────────────────
  exp.waterSourceReadable = Array.isArray(exp.waterSource)
    ? exp.waterSource.join(', ') + (exp.waterSourceDescription ? ' (' + exp.waterSourceDescription + ')' : '')
    : ((exp.waterSource || '') + (exp.waterSourceDescription ? ' (' + exp.waterSourceDescription + ')' : ''));

  // ── Pets as readable string ───────────────────────────────
  exp.petsReadable = Array.isArray(exp.pets)
    ? exp.pets.join(', ') + (exp.petsOther ? ' (' + exp.petsOther + ')' : '')
    : ((exp.pets || '') + (exp.petsOther ? ' (' + exp.petsOther + ')' : ''));

  // ── Stove type as readable string ─────────────────────────
  exp.stoveTypeReadable = Array.isArray(exp.stoveType)
    ? exp.stoveType.join(', ') + (exp.stoveTypeOther ? ' (' + exp.stoveTypeOther + ')' : '')
    : ((exp.stoveType || '') + (exp.stoveTypeOther ? ' (' + exp.stoveTypeOther + ')' : ''));

  return exp;
}
