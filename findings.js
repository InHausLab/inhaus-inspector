// InHaus Inspector - findings, approved comment library, and team collaboration

const COMMENT_LIBRARY_KEY = 'inhaus_approved_comment_library_v1';
const DEVICE_ID_KEY = 'inhaus_device_id_v1';

function isoNow() { return new Date().toISOString(); }
function makeId(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 10); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function timeValue(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeCommentText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function safeStorageGet(key) {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null; }
  catch (err) { return null; }
}

function safeStorageSet(key, value) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value); }
  catch (err) { /* local library is a convenience; inspection data remains authoritative */ }
}

export function getDeviceId() {
  let id = safeStorageGet(DEVICE_ID_KEY);
  if (!id) {
    id = makeId('device');
    safeStorageSet(DEVICE_ID_KEY, id);
  }
  return id;
}

function readLocalLibrary() {
  try {
    const parsed = JSON.parse(safeStorageGet(COMMENT_LIBRARY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function writeLocalLibrary(entries) {
  safeStorageSet(COMMENT_LIBRARY_KEY, JSON.stringify(entries.slice(0, 500)));
}

function mergeLibraryEntries(first, second) {
  const byText = new Map();
  [...(first || []), ...(second || [])].forEach(entry => {
    const key = normalizeCommentText(entry?.cleanedText || entry?.text);
    if (!key) return;
    const current = byText.get(key);
    if (!current || timeValue(entry.updatedAt || entry.approvedAt) >= timeValue(current.updatedAt || current.approvedAt)) {
      byText.set(key, clone(entry));
    }
  });
  return Array.from(byText.values()).sort((a, b) =>
    timeValue(b.lastUsedAt || b.updatedAt || b.approvedAt) - timeValue(a.lastUsedAt || a.updatedAt || a.approvedAt)
  );
}

export function ensureInspectionWorkspace(inspection) {
  if (!inspection) return inspection;
  if (!Array.isArray(inspection.findings)) inspection.findings = [];
  if (!Array.isArray(inspection.commentLibrary)) inspection.commentLibrary = [];
  if (!Array.isArray(inspection.auditTrail)) inspection.auditTrail = [];
  if (!inspection.photoTombstones || typeof inspection.photoTombstones !== 'object') inspection.photoTombstones = {};
  inspection.commentLibrary = mergeLibraryEntries(inspection.commentLibrary, readLocalLibrary());
  writeLocalLibrary(inspection.commentLibrary);

  if (!inspection.collaboration || typeof inspection.collaboration !== 'object') {
    inspection.collaboration = { enabled: false, members: [], assignments: {}, activity: [] };
  }
  const collaboration = inspection.collaboration;
  if (!Array.isArray(collaboration.members)) collaboration.members = [];
  if (!collaboration.assignments || typeof collaboration.assignments !== 'object') collaboration.assignments = {};
  if (!Array.isArray(collaboration.activity)) collaboration.activity = [];
  if (!collaboration.presence || typeof collaboration.presence !== 'object') collaboration.presence = {};

  const primaryName = String(inspection.inspectorName || '').trim();
  if (primaryName && !collaboration.members.some(member => normalizeCommentText(member.name) === normalizeCommentText(primaryName))) {
    collaboration.members.unshift({
      memberId: makeId('inspector'),
      name: primaryName,
      email: inspection.inspectorEmail || '',
      role: 'Lead',
      addedAt: inspection.startedAt || isoNow(),
      updatedAt: isoNow()
    });
  }
  return inspection;
}

function identityStorageKey(inspectionId) {
  return 'inhaus_team_identity_' + String(inspectionId || 'unknown');
}

function identitySessionKey(inspectionId) {
  return 'inhaus_team_identity_confirmed_' + String(inspectionId || 'unknown');
}

export function hasStoredInspectorIdentity(inspection) {
  return !!safeStorageGet(identityStorageKey(inspection?.inspectionId));
}

export function hasConfirmedInspectorIdentity(inspection) {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    const confirmedId = sessionStorage.getItem(identitySessionKey(inspection?.inspectionId));
    return !!confirmedId && inspection?.collaboration?.members?.some(member => member.memberId === confirmedId);
  } catch (err) {
    return false;
  }
}

export function getInspectorIdentity(inspection) {
  ensureInspectionWorkspace(inspection);
  const storedId = safeStorageGet(identityStorageKey(inspection?.inspectionId));
  const storedMember = inspection?.collaboration?.members?.find(member => member.memberId === storedId);
  if (storedMember) return storedMember;
  return inspection?.collaboration?.members?.[0] || {
    memberId: getDeviceId(),
    name: inspection?.inspectorName || 'Inspector',
    role: 'Inspector'
  };
}

export function setInspectorIdentity(inspection, memberId) {
  ensureInspectionWorkspace(inspection);
  const member = inspection.collaboration.members.find(item => item.memberId === memberId);
  if (!member) return null;
  safeStorageSet(identityStorageKey(inspection.inspectionId), memberId);
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(identitySessionKey(inspection.inspectionId), memberId);
    }
  } catch (err) { /* session confirmation is a safety prompt, not inspection data */ }
  recordTeamActivity(inspection, 'joined', member.name + ' opened the inspection', member);
  return member;
}

export function addTeamMember(inspection, name, email, role) {
  ensureInspectionWorkspace(inspection);
  const cleanName = String(name || '').trim();
  if (!cleanName) return null;
  const existing = inspection.collaboration.members.find(member => normalizeCommentText(member.name) === normalizeCommentText(cleanName));
  if (existing) return existing;
  const now = isoNow();
  const member = {
    memberId: makeId('inspector'),
    name: cleanName,
    email: String(email || '').trim(),
    role: role || 'Inspector',
    addedAt: now,
    updatedAt: now
  };
  inspection.collaboration.members.push(member);
  inspection.collaboration.enabled = inspection.collaboration.members.length > 1;
  inspection.collaboration.updatedAt = now;
  recordTeamActivity(inspection, 'member_added', cleanName + ' added to the inspection team');
  recordAuditEvent(inspection, 'team_member_added', cleanName + ' added to the inspection team', { memberId: member.memberId, role: member.role });
  return member;
}

export function removeTeamMember(inspection, memberId) {
  ensureInspectionWorkspace(inspection);
  if (inspection.collaboration.members.length <= 1) return false;
  const removed = inspection.collaboration.members.find(member => member.memberId === memberId);
  inspection.collaboration.members = inspection.collaboration.members.filter(member => member.memberId !== memberId);
  Object.keys(inspection.collaboration.assignments).forEach(stepId => {
    if (inspection.collaboration.assignments[stepId]?.memberId === memberId) delete inspection.collaboration.assignments[stepId];
  });
  inspection.collaboration.enabled = inspection.collaboration.members.length > 1;
  inspection.collaboration.updatedAt = isoNow();
  if (removed) recordAuditEvent(inspection, 'team_member_removed', removed.name + ' removed from the inspection team', { memberId });
  return true;
}

export function setStepAssignment(inspection, stepId, memberId, stepName) {
  ensureInspectionWorkspace(inspection);
  const member = inspection.collaboration.members.find(item => item.memberId === memberId);
  if (!memberId) {
    delete inspection.collaboration.assignments[stepId];
  } else if (member) {
    inspection.collaboration.assignments[stepId] = {
      stepId,
      stepName: stepName || stepId,
      memberId,
      memberName: member.name,
      updatedAt: isoNow()
    };
  }
  inspection.collaboration.updatedAt = isoNow();
  recordAuditEvent(
    inspection,
    'section_assignment',
    (stepName || stepId) + (member ? ' assigned to ' + member.name : ' marked unassigned'),
    { stepId, stepName: stepName || stepId, memberId: member?.memberId || '', memberName: member?.name || '' }
  );
}

export function getStepAssignment(inspection, stepId) {
  return inspection?.collaboration?.assignments?.[stepId] || null;
}

export function recordTeamActivity(inspection, type, message, memberOverride) {
  ensureInspectionWorkspace(inspection);
  const member = memberOverride || getInspectorIdentity(inspection);
  inspection.collaboration.activity.unshift({
    activityId: makeId('activity'),
    type,
    message,
    memberId: member?.memberId || '',
    memberName: member?.name || '',
    deviceId: getDeviceId(),
    createdAt: isoNow()
  });
  inspection.collaboration.activity = inspection.collaboration.activity.slice(0, 100);
}

export function recordAuditEvent(inspection, type, message, details, memberOverride) {
  ensureInspectionWorkspace(inspection);
  const member = memberOverride || getInspectorIdentity(inspection);
  const event = {
    auditId: makeId('audit'),
    type: String(type || 'change'),
    message: String(message || 'Inspection updated'),
    details: details && typeof details === 'object' ? clone(details) : {},
    memberId: member?.memberId || '',
    memberName: member?.name || '',
    deviceId: getDeviceId(),
    createdAt: isoNow()
  };
  inspection.auditTrail.unshift(event);
  inspection.auditTrail = inspection.auditTrail.slice(0, 500);
  return event;
}

export function setActiveStepPresence(inspection, stepId, stepName) {
  ensureInspectionWorkspace(inspection);
  const member = getInspectorIdentity(inspection);
  const deviceId = getDeviceId();
  inspection.collaboration.presence[deviceId] = {
    deviceId,
    memberId: member.memberId,
    memberName: member.name,
    stepId: stepId || '',
    stepName: stepName || '',
    updatedAt: isoNow()
  };
  return inspection.collaboration.presence[deviceId];
}

export function getActivePresence(inspection, maxAgeMs) {
  ensureInspectionWorkspace(inspection);
  const cutoff = Date.now() - Number(maxAgeMs || 120000);
  return Object.values(inspection.collaboration.presence || {})
    .filter(item => timeValue(item.updatedAt) >= cutoff)
    .sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt));
}

export function markStepUpdated(inspection, stepId, stepName, fieldKey) {
  ensureInspectionWorkspace(inspection);
  if (!inspection.stepData) inspection.stepData = {};
  if (!inspection.stepData[stepId]) inspection.stepData[stepId] = {};
  const member = getInspectorIdentity(inspection);
  const now = isoNow();
  inspection.stepData[stepId]._updatedAt = now;
  inspection.stepData[stepId]._updatedBy = member.name;
  inspection.stepData[stepId]._updatedById = member.memberId;
  if (!inspection.stepData[stepId]._fieldUpdates || typeof inspection.stepData[stepId]._fieldUpdates !== 'object') {
    inspection.stepData[stepId]._fieldUpdates = {};
  }
  if (fieldKey) {
    inspection.stepData[stepId]._fieldUpdates[fieldKey] = {
      updatedAt: now,
      updatedBy: member.name,
      updatedById: member.memberId,
      deviceId: getDeviceId()
    };
  }
  inspection.collaboration.lastActiveAt = now;
  inspection.collaboration.lastActiveBy = member.name;
  setActiveStepPresence(inspection, stepId, stepName);
  const assignment = getStepAssignment(inspection, stepId);
  if (!assignment && inspection.collaboration.enabled) setStepAssignment(inspection, stepId, member.memberId, stepName);
}

export function createFinding(inspection, values) {
  ensureInspectionWorkspace(inspection);
  const member = getInspectorIdentity(inspection);
  const now = isoNow();
  const finding = {
    findingId: values?.findingId || makeId('finding'),
    roomName: String(values?.roomName || '').trim(),
    stepName: String(values?.stepName || '').trim(),
    reportSection: String(values?.reportSection || values?.stepName || '').trim(),
    severity: values?.severity || 'Observation',
    rawComment: String(values?.rawComment || '').trim(),
    cleanedComment: String(values?.cleanedComment || '').trim(),
    photoIds: Array.isArray(values?.photoIds) ? Array.from(new Set(values.photoIds.filter(Boolean))) : [],
    status: values?.status || 'needs_review',
    reusableStatus: 'not_saved',
    source: values?.source || 'inspector',
    sourcePhotoId: values?.sourcePhotoId || '',
    createdBy: member.name,
    createdById: member.memberId,
    createdAt: now,
    updatedBy: member.name,
    updatedById: member.memberId,
    updatedAt: now
  };
  inspection.findings.push(finding);
  recordTeamActivity(inspection, 'finding_created', member.name + ' added a finding in ' + (finding.roomName || finding.stepName || 'the inspection'), member);
  recordAuditEvent(inspection, 'finding_created', member.name + ' added a finding in ' + (finding.roomName || finding.stepName || 'the inspection'), {
    findingId: finding.findingId,
    roomName: finding.roomName,
    stepName: finding.stepName,
    photoCount: finding.photoIds.length
  }, member);
  return finding;
}

function walkPhotos(value, callback, seen) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length && value[0] && typeof value[0].photoId === 'string') value.forEach(callback);
    else value.forEach(item => walkPhotos(item, callback, seen));
    return;
  }
  Object.keys(value).forEach(key => {
    if (key !== '_photoRetryQueue' && key !== 'rapidCaptureDraft') walkPhotos(value[key], callback, seen);
  });
}

export function syncPhotoCommentsToFindings(inspection) {
  ensureInspectionWorkspace(inspection);
  let created = 0;
  walkPhotos(inspection, photo => {
    const comment = String(photo?.caption || '').trim();
    if (!photo?.photoId || !comment) return;
    let finding = photo.findingId
      ? inspection.findings.find(item => item.findingId === photo.findingId)
      : inspection.findings.find(item => item.sourcePhotoId === photo.photoId);
    if (!finding) {
      finding = createFinding(inspection, {
        roomName: photo.roomName,
        stepName: photo.stepName,
        reportSection: photo.stepName,
        severity: 'Observation',
        rawComment: comment,
        photoIds: [photo.photoId],
        source: 'photo_comment',
        sourcePhotoId: photo.photoId
      });
      photo.findingId = finding.findingId;
      created++;
    } else if (finding.status === 'needs_review' && comment !== finding.rawComment) {
      finding.rawComment = comment;
      finding.updatedAt = isoNow();
    }
  }, new Set());
  return created;
}

export function updateFinding(inspection, findingId, changes) {
  ensureInspectionWorkspace(inspection);
  const finding = inspection.findings.find(item => item.findingId === findingId);
  if (!finding) return null;
  const member = getInspectorIdentity(inspection);
  Object.assign(finding, changes || {}, {
    updatedAt: isoNow(),
    updatedBy: member.name,
    updatedById: member.memberId
  });
  return finding;
}

export function approveFinding(inspection, findingId) {
  const finding = inspection.findings.find(item => item.findingId === findingId);
  if (!finding) return null;
  const cleaned = String(finding.cleanedComment || '').trim();
  if (!cleaned) return null;
  const member = getInspectorIdentity(inspection);
  const approved = updateFinding(inspection, findingId, {
    cleanedComment: cleaned,
    status: 'approved',
    approvedAt: isoNow(),
    approvedBy: member.name,
    approvedById: member.memberId
  });
  recordAuditEvent(inspection, 'finding_approved', 'Finding approved for the report', { findingId, roomName: finding.roomName, stepName: finding.stepName }, member);
  return approved;
}

export function excludeFinding(inspection, findingId) {
  const finding = updateFinding(inspection, findingId, { status: 'excluded', excludedAt: isoNow() });
  if (finding) recordAuditEvent(inspection, 'finding_excluded', 'Finding excluded from the report', { findingId, roomName: finding.roomName, stepName: finding.stepName });
  return finding;
}

export function saveFindingToLibrary(inspection, findingId) {
  ensureInspectionWorkspace(inspection);
  const finding = inspection.findings.find(item => item.findingId === findingId);
  if (!finding || finding.status !== 'approved') return null;
  const cleanedText = String(finding.cleanedComment || '').trim();
  if (!cleanedText) return null;
  const key = normalizeCommentText(cleanedText);
  let entry = inspection.commentLibrary.find(item => normalizeCommentText(item.cleanedText) === key);
  const now = isoNow();
  if (!entry) {
    entry = {
      commentId: makeId('comment'),
      cleanedText,
      severity: finding.severity,
      reportSection: finding.reportSection,
      sourceFindingId: finding.findingId,
      approvedBy: finding.approvedBy || finding.updatedBy,
      approvedAt: finding.approvedAt || now,
      createdAt: now,
      updatedAt: now,
      reuseCount: 0
    };
    inspection.commentLibrary.unshift(entry);
  }
  finding.reusableStatus = 'saved';
  finding.reusableCommentId = entry.commentId;
  finding.updatedAt = now;
  inspection.commentLibrary = mergeLibraryEntries(inspection.commentLibrary, readLocalLibrary());
  writeLocalLibrary(inspection.commentLibrary);
  recordAuditEvent(inspection, 'comment_saved_for_reuse', 'Approved comment saved for reuse', { commentId: entry.commentId, findingId });
  return entry;
}

export function useLibraryComment(inspection, commentId) {
  ensureInspectionWorkspace(inspection);
  const entry = inspection.commentLibrary.find(item => item.commentId === commentId);
  if (!entry) return null;
  entry.reuseCount = Number(entry.reuseCount || 0) + 1;
  entry.lastUsedAt = isoNow();
  entry.updatedAt = entry.lastUsedAt;
  writeLocalLibrary(inspection.commentLibrary);
  return entry;
}

function mergeById(localItems, remoteItems, idKey) {
  const merged = new Map();
  [...(remoteItems || []), ...(localItems || [])].forEach(item => {
    const id = item?.[idKey];
    if (!id) return;
    const current = merged.get(id);
    if (!current || timeValue(item.updatedAt || item.createdAt) >= timeValue(current.updatedAt || current.createdAt)) {
      merged.set(id, clone(item));
    }
  });
  return Array.from(merged.values());
}

function mergePhotos(localPhotos, remotePhotos) {
  const byId = new Map();
  [...(remotePhotos || []), ...(localPhotos || [])].forEach(photo => {
    if (!photo?.photoId) return;
    const current = byId.get(photo.photoId);
    if (!current) {
      byId.set(photo.photoId, clone(photo));
      return;
    }
    const newer = timeValue(photo.updatedAt || photo.timestamp) >= timeValue(current.updatedAt || current.timestamp) ? photo : current;
    const older = newer === photo ? current : photo;
    byId.set(photo.photoId, Object.assign({}, clone(older), clone(newer), {
      dataUrl: newer.dataUrl || older.dataUrl,
      thumbnailDataUrl: newer.thumbnailDataUrl || older.thumbnailDataUrl,
      originalDataUrl: newer.originalDataUrl || older.originalDataUrl
    }));
  });
  return Array.from(byId.values());
}

function looksLikePhotoArray(value) {
  return Array.isArray(value) && value.length && value[0] && typeof value[0].photoId === 'string';
}

function mergeStepData(localStep, remoteStep) {
  const localIsNewer = timeValue(localStep?._updatedAt) >= timeValue(remoteStep?._updatedAt);
  const newer = localIsNewer ? localStep : remoteStep;
  const older = localIsNewer ? remoteStep : localStep;
  const merged = Object.assign({}, clone(older || {}), clone(newer || {}));
  const keys = new Set([...Object.keys(older || {}), ...Object.keys(newer || {})]);
  const mergedFieldUpdates = Object.assign({}, clone(remoteStep?._fieldUpdates || {}));
  keys.forEach(key => {
    if (key === '_fieldUpdates') return;
    const localValue = localStep?.[key];
    const remoteValue = remoteStep?.[key];
    if (looksLikePhotoArray(localValue) || looksLikePhotoArray(remoteValue)) {
      merged[key] = mergePhotos(localValue, remoteValue);
      return;
    }
    const localField = localStep?._fieldUpdates?.[key];
    const remoteField = remoteStep?._fieldUpdates?.[key];
    if (localField || remoteField) {
      const localFieldIsNewer = timeValue(localField?.updatedAt) >= timeValue(remoteField?.updatedAt);
      if (localFieldIsNewer) {
        if (localValue === undefined) delete merged[key];
        else merged[key] = clone(localValue);
        if (localField) mergedFieldUpdates[key] = clone(localField);
      } else {
        if (remoteValue === undefined) delete merged[key];
        else merged[key] = clone(remoteValue);
        if (remoteField) mergedFieldUpdates[key] = clone(remoteField);
      }
    }
  });
  merged._fieldUpdates = mergedFieldUpdates;
  return merged;
}

function mergeDynamicRooms(localRooms, remoteRooms) {
  const result = {};
  const keys = new Set([...Object.keys(remoteRooms || {}), ...Object.keys(localRooms || {})]);
  keys.forEach(key => {
    const seen = new Set();
    result[key] = [...(remoteRooms?.[key] || []), ...(localRooms?.[key] || [])].filter(room => {
      const id = room.id || normalizeCommentText(room.name);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map(clone);
  });
  return result;
}

function mergeCheckpointValue(base, incoming) {
  if (incoming === undefined || incoming === null || incoming === '') return base;
  if (Array.isArray(incoming)) {
    if (!incoming.length && Array.isArray(base) && base.length) return clone(base);
    return incoming.map(item => mergeCheckpointValue(undefined, item));
  }
  if (incoming && typeof incoming === 'object') {
    const prior = base && typeof base === 'object' && !Array.isArray(base) ? base : {};
    const merged = Object.assign({}, clone(prior));
    Object.entries(incoming).forEach(([key, value]) => {
      if (key === 'resumeData') return;
      merged[key] = mergeCheckpointValue(prior[key], value);
    });
    return merged;
  }
  return incoming;
}

export function flattenInspectionCheckpoints(inspection) {
  if (!inspection || typeof inspection !== 'object') return inspection;
  const checkpoints = [];
  const seen = new Set();
  let current = inspection.resumeData;
  let depth = 1;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (current.stepData && typeof current.stepData === 'object') {
      checkpoints.push({
        data: current,
        depth,
        timestamp: Number(current._lastCheckpointSucceededAt || current._lastCheckpointAttemptAt || 0)
      });
    }
    current = current.resumeData;
    depth += 1;
  }
  checkpoints.sort((a, b) => {
    if (a.timestamp && b.timestamp && a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return b.depth - a.depth;
  });
  let merged = mergeCheckpointValue({}, inspection);
  checkpoints.forEach(checkpoint => { merged = mergeCheckpointValue(merged, checkpoint.data); });
  delete merged.resumeData;
  return merged;
}

export function mergeRemoteInspection(localInspection, remoteInspection) {
  ensureInspectionWorkspace(localInspection);
  if (!remoteInspection) return localInspection;
  remoteInspection = flattenInspectionCheckpoints(remoteInspection);
  ensureInspectionWorkspace(remoteInspection);

  const coreFillKeys = ['propertyAddress', 'clientName', 'inspectionDate', 'inspectorName', 'inspectorEmail',
    'numberOfLevels', 'numberOfBedrooms', 'numberOfBathrooms', 'waterSource', 'wifiNetwork', 'clientConcerns', 'blueprintNotes'];
  coreFillKeys.forEach(key => {
    if ((localInspection[key] === undefined || localInspection[key] === null || localInspection[key] === '') && remoteInspection[key] !== undefined) {
      localInspection[key] = clone(remoteInspection[key]);
    }
  });

  const stepIds = new Set([...Object.keys(remoteInspection.stepData || {}), ...Object.keys(localInspection.stepData || {})]);
  if (!localInspection.stepData) localInspection.stepData = {};
  stepIds.forEach(stepId => {
    const localStep = localInspection.stepData[stepId];
    const remoteStep = remoteInspection.stepData?.[stepId];
    if (!localStep && remoteStep) localInspection.stepData[stepId] = clone(remoteStep);
    else if (localStep && remoteStep) localInspection.stepData[stepId] = mergeStepData(localStep, remoteStep);
  });

  localInspection.findings = mergeById(localInspection.findings, remoteInspection.findings, 'findingId');
  localInspection.sparePhotos = mergePhotos(localInspection.sparePhotos, remoteInspection.sparePhotos);
  localInspection.commentLibrary = mergeLibraryEntries(localInspection.commentLibrary, remoteInspection.commentLibrary);
  localInspection.auditTrail = mergeById(localInspection.auditTrail, remoteInspection.auditTrail, 'auditId')
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt)).slice(0, 500);
  writeLocalLibrary(localInspection.commentLibrary);
  localInspection.dynamicRooms = mergeDynamicRooms(localInspection.dynamicRooms, remoteInspection.dynamicRooms);
  const tombstones = Object.assign({}, remoteInspection.photoTombstones || {});
  Object.entries(localInspection.photoTombstones || {}).forEach(([photoId, item]) => {
    if (!tombstones[photoId] || timeValue(item.updatedAt) >= timeValue(tombstones[photoId].updatedAt)) tombstones[photoId] = clone(item);
  });
  localInspection.photoTombstones = tombstones;

  const localCollab = localInspection.collaboration;
  const remoteCollab = remoteInspection.collaboration;
  localCollab.enabled = !!(localCollab.enabled || remoteCollab.enabled);
  localCollab.members = mergeById(localCollab.members, remoteCollab.members, 'memberId');
  localCollab.activity = mergeById(localCollab.activity, remoteCollab.activity, 'activityId')
    .sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt)).slice(0, 100);
  const assignments = Object.assign({}, remoteCollab.assignments || {});
  Object.entries(localCollab.assignments || {}).forEach(([stepId, assignment]) => {
    if (!assignments[stepId] || timeValue(assignment.updatedAt) >= timeValue(assignments[stepId].updatedAt)) assignments[stepId] = clone(assignment);
  });
  localCollab.assignments = assignments;
  const presence = Object.assign({}, remoteCollab.presence || {});
  Object.entries(localCollab.presence || {}).forEach(([deviceId, item]) => {
    if (!presence[deviceId] || timeValue(item.updatedAt) >= timeValue(presence[deviceId].updatedAt)) presence[deviceId] = clone(item);
  });
  localCollab.presence = presence;
  localCollab.lastMergedAt = isoNow();
  return localInspection;
}
