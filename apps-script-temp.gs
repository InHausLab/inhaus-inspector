/**
 * InHaus Lab — Inspector App → Google Sheets Bridge
 * ===================================================
 * 
 * HOW TO SET UP:
 * 1. Go to https://script.google.com
 * 2. Create a new project, name it "InHaus Inspector Bridge"
 * 3. Paste this entire file into Code.gs (replace everything)
 * 4. Click Deploy → New Deployment
 * 5. Type: Web app
 * 6. Execute as: Me
 * 7. Who has access: Anyone
 * 8. Click Deploy
 * 9. Copy the web app URL
 * 10. Paste that URL into the GOOGLE_SCRIPT_URL constant in app.js
 * 11. Commit and push to GitHub
 *
 * WHAT IT DOES:
 * When the inspector taps "Submit Inspection" in the app,
 * this script receives the JSON data and:
 * - Creates a Google Drive folder named "ClientName — Address"
 * - Creates a Google Sheet inside that folder with all inspection data
 * - Uploads all photos from the inspection into the same folder
 * - Creates a Photo Log tab in the sheet linking to each photo
 * - Returns a link to the folder and sheet
 */

// ── CONFIG ────────────────────────────────────────────────
// Set this to the ID of a Google Drive folder where inspection folders should be created
// (Get folder ID from the URL: https://drive.google.com/drive/folders/FOLDER_ID_HERE)
const DRIVE_FOLDER_ID = '11K48iY7zAB6IbXHOmLi9XVEAXih_3qeA'; // InHaus Lab — Inspection Data

// Set this to an existing spreadsheet ID to append all inspections as rows
// Leave empty to create a new spreadsheet per inspection
const MASTER_SHEET_ID = '';

// Vision proxy for AI photo captions (Phase 1: silent comparison)
// Set to empty string to disable AI captions
const VISION_PROXY_URL = 'https://inhaus-vision-proxy.mjordanjay.workers.dev';

// ── AUTH ─────────────────────────────────────────────────
// Shared secret stored in Script Properties as SYNC_SECRET.
// Set via: Extensions → Apps Script → Project Settings → Script Properties.
// The PWA sends it as the X-Sync-Secret request header.

function checkAuth(e) {
  var secret = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET');
  if (!secret) return; // Secret not configured — allow (setup mode)
  var provided = (e.parameter && e.parameter['x-sync-secret']) ||
                 (e.postData && e.postData.contents && (function() {
                   try { return JSON.parse(e.postData.contents)['x-sync-secret']; } catch(_) { return null; }
                 })());
  if (provided !== secret) {
    throw new Error('Unauthorized');
  }
}

// ── WEB APP ENTRY POINTS ─────────────────────────────────

function doPost(e) {
  try {
    checkAuth(e);
    const data = JSON.parse(e.postData.contents);
    var result;
    if (data.action === 'saveReview') {
      result = saveReviewData(data);
    } else if (data.photoUploadOnly) {
      result = processPhotoUpload(data);
    } else {
      result = processInspection(data);
    }
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', ...result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  var params = e ? e.parameter : {};
  try { checkAuth(e); } catch(_) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (params.action === 'getReview' && params.id) {
    try {
      var result = getReviewData(params.id, params.token);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ok', ...result }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'InHaus Inspector Bridge is running' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── REVIEW DATA SAVE/LOAD ─────────────────────────────────
// Stores reviewer edits (captions, observations, notes) in a
// 'Review Data' sheet: one row per inspection, columns = inspectionId + JSON blob

var REVIEW_SHEET_NAME = 'Review Data';

function getOrCreateReviewSheet() {
  var ss;
  if (MASTER_SHEET_ID) {
    ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  } else {
    // Use a dedicated review data spreadsheet stored in the inspection data folder
    var folder = DRIVE_FOLDER_ID ? DriveApp.getFolderById(DRIVE_FOLDER_ID) : DriveApp.getRootFolder();
    var files = folder.getFilesByName('InHaus Review Data');
    var ssFile;
    if (files.hasNext()) {
      ssFile = files.next();
      ss = SpreadsheetApp.openById(ssFile.getId());
    } else {
      ss = SpreadsheetApp.create('InHaus Review Data');
      var newFile = DriveApp.getFileById(ss.getId());
      folder.addFile(newFile);
      DriveApp.getRootFolder().removeFile(newFile);
    }
  }
  var sheet = ss.getSheetByName(REVIEW_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(REVIEW_SHEET_NAME);
    sheet.appendRow(['inspectionId', 'reviewedData', 'lastUpdated']);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
  return sheet;
}

function saveReviewData(data) {
  var id = data.id;
  var token = data.token;
  var field = data.field; // { stepId, key, value }
  if (!id || !field) throw new Error('Missing id or field');

  var sheet = getOrCreateReviewSheet();
  var rows = sheet.getDataRange().getValues();
  var rowIndex = -1;
  var existing = {};

  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      rowIndex = i + 1; // 1-indexed
      try { existing = JSON.parse(rows[i][1] || '{}'); } catch(e) { existing = {}; }
      break;
    }
  }

  // Merge the new field value into existing data
  var stepId = field.stepId;
  var key = field.key;
  var value = field.value;

  if (stepId === 'summary' || stepId === 'photo' || stepId.startsWith('photo_')) {
    existing[key] = value;
  } else {
    if (!existing[stepId]) existing[stepId] = {};
    existing[stepId][key] = value;
  }

  var now = new Date().toISOString();
  var json = JSON.stringify(existing);

  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 2).setValue(json);
    sheet.getRange(rowIndex, 3).setValue(now);
  } else {
    sheet.appendRow([id, json, now]);
  }

  return { saved: true, id: id };
}

function getReviewData(id, token) {
  var sheet = getOrCreateReviewSheet();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      var reviewedData = {};
      try { reviewedData = JSON.parse(rows[i][1] || '{}'); } catch(e) {}
      return { reviewedData: reviewedData, lastUpdated: rows[i][2] };
    }
  }
  return { reviewedData: {}, lastUpdated: null };
}

// ── MAIN PROCESSING ──────────────────────────────────────

function processInspection(data) {
  // Option A: Append to master sheet as a row
  if (MASTER_SHEET_ID) {
    return appendToMasterSheet(data);
  }
  // Option B: Create individual sheet per inspection
  return createInspectionSheet(data);
}

// ── OPTION A: MASTER SHEET (all inspections as rows) ─────

function appendToMasterSheet(data) {
  const ss = SpreadsheetApp.openById(MASTER_SHEET_ID);
  let sheet = ss.getSheetByName('Inspections');
  
  if (!sheet) {
    sheet = ss.insertSheet('Inspections');
    sheet.appendRow(getCSVHeaders());
  }
  
  sheet.appendRow(getCSVValues(data));
  
  return {
    spreadsheetUrl: ss.getUrl(),
    inspectionId: data.inspectionId
  };
}

// ── OPTION B: INDIVIDUAL SHEET PER INSPECTION ────────────

function getClientLastName(fullName) {
  if (!fullName) return 'Unknown';
  var parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1];
}

function createInspectionSheet(data) {
  var lastName = getClientLastName(data.clientName);
  var address = data.propertyAddress || data.inspectionId;
  var inspId = data.inspectionId || '';
  const folderName = lastName + ' \u2014 ' + address + (inspId ? ' \u2014 ' + inspId : '');
  const parentFolder = DRIVE_FOLDER_ID ? DriveApp.getFolderById(DRIVE_FOLDER_ID) : DriveApp.getRootFolder();

  // Deduplicate: search for existing folder/sheet with this inspectionId
  var inspFolder = null;
  var ss = null;
  if (inspId) {
    var folders = parentFolder.getFolders();
    while (folders.hasNext()) {
      var f = folders.next();
      if (f.getName().indexOf(inspId) > -1) {
        inspFolder = f;
        var files = f.getFiles();
        while (files.hasNext()) {
          var existingFile = files.next();
          if (existingFile.getMimeType() === MimeType.GOOGLE_SHEETS) {
            ss = SpreadsheetApp.openById(existingFile.getId());
            break;
          }
        }
        break;
      }
    }
  }

  if (!inspFolder) {
    inspFolder = parentFolder.createFolder(folderName);
  }

  if (!ss) {
    const sheetName = 'InHaus Inspection \u2014 ' + (data.inspectionId || 'Unknown');
    ss = SpreadsheetApp.create(sheetName);
    const file = DriveApp.getFileById(ss.getId());
    inspFolder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
  } else {
    // Clear all sheets for rewrite; keep at least one sheet to avoid errors
    var existingSheets = ss.getSheets();
    for (var i = existingSheets.length - 1; i > 0; i--) {
      ss.deleteSheet(existingSheets[i]);
    }
    existingSheets[0].clearContents();
    existingSheets[0].setName('Summary');
  }
  
  const summary = ss.getActiveSheet();
  summary.setName('Summary');
  writeSummary(summary, data);
  
  const air = ss.insertSheet('Air Data');
  writeAirData(air, data);
  
  const rooms = ss.insertSheet('Room Details');
  writeRoomDetails(rooms, data);
  
  const csv = ss.insertSheet('CSV Output');
  writeCSVOutput(csv, data);
  
  const photoResults = uploadPhotosToFolder(inspFolder, data);

  const followUpRooms = (data.rooms || []).filter(r => r.followUpNeeded === 'Yes');
  if (followUpRooms.length > 0) {
    const followUp = ss.insertSheet('Follow-Up Items');
    writeFollowUpTab(followUp, data, photoResults);
  }

  if (photoResults.length > 0) {
    const photoLog = ss.insertSheet('Photo Log');
    writePhotoLog(photoLog, photoResults);
  }
  
  return {
    spreadsheetUrl: ss.getUrl(),
    spreadsheetId: ss.getId(),
    folderUrl: inspFolder.getUrl(),
    folderId: inspFolder.getId(),
    inspectionId: data.inspectionId,
    photosUploaded: photoResults.length
  };
}

// ── FOLLOW-UP PHOTO UPLOAD ───────────────────────────────

function processPhotoUpload(data) {
  var inspectionId = data.inspectionId;
  if (!inspectionId) throw new Error('No inspectionId in photo upload payload');

  var parentFolder = DRIVE_FOLDER_ID ? DriveApp.getFolderById(DRIVE_FOLDER_ID) : DriveApp.getRootFolder();
  var targetFolder = null;
  var targetSheet = null;

  // Find existing folder by inspectionId in name
  var folders = parentFolder.getFolders();
  while (folders.hasNext()) {
    var f = folders.next();
    if (f.getName().indexOf(inspectionId) > -1) {
      targetFolder = f;
      break;
    }
  }

  if (!targetFolder) throw new Error('Inspection folder not found for ' + inspectionId);

  // Find spreadsheet in folder
  var files = targetFolder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
      targetSheet = SpreadsheetApp.openById(file.getId());
      break;
    }
  }

  // Upload photos using the photos array at the top level
  var syntheticData = { rooms: [], photos: data.photos || [] };
  var syntheticSection = { name: 'Photos', data: syntheticData };

  var photoResults = [];
  var photos = data.photos || [];
  photos.forEach(function(photo, idx) {
    try {
      if (!photo.imageData) return;
      var base64Data = photo.imageData;
      if (base64Data.indexOf(',') > -1) base64Data = base64Data.split(',')[1];
      var ext = photo.imageData.indexOf('image/png') > -1 ? 'png' : 'jpg';
      var roomLabel = (photo.roomName || 'Photo').replace(/[^a-zA-Z0-9 \-]/g, '').trim();
      var captionLabel = (photo.caption || '').replace(/[^a-zA-Z0-9 \-]/g, '').trim();
      var filename = captionLabel
        ? roomLabel + ' - ' + captionLabel + '.' + ext
        : roomLabel + ' - Photo ' + String(idx + 1).padStart(2, '0') + '.' + ext;
      var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/' + ext, filename);
      var driveFile = targetFolder.createFile(blob);
      if (photo.caption || photo.timestamp) {
        var desc = [photo.caption, photo.timestamp ? 'Taken: ' + photo.timestamp : ''].filter(Boolean).join(' | ');
        driveFile.setDescription(desc);
      }
      // Make file viewable by anyone with the link so portal can render it
      driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      var fileId = driveFile.getId();
      // Use direct embeddable URL (renders in <img> tags without auth)
      var embedUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1600';
      photoResults.push({
        filename: filename,
        room: photo.roomName || '',
        step: photo.stepName || '',
        caption: photo.caption || '',
        timestamp: photo.timestamp || '',
        driveUrl: embedUrl,
        driveId: fileId
      });
    } catch (err) {
      photoResults.push({ filename: 'ERROR', room: '', step: '', caption: 'Upload failed: ' + err.message, driveUrl: '' });
    }
  });

  // Append to or create Photo Log sheet
  if (targetSheet && photoResults.length > 0) {
    var photoLog = targetSheet.getSheetByName('Photo Log');
    if (!photoLog) {
      photoLog = targetSheet.insertSheet('Photo Log');
      writePhotoLog(photoLog, photoResults);
    } else {
      photoResults.forEach(function(p) {
        var aiCaption = generateAiCaption(p.driveUrl, p.room, p.step);
        photoLog.appendRow([p.room || '', p.step || '', p.caption || '', aiCaption, p.driveUrl || '', p.timestamp || '']);
      });
    }
  }

  return { photosUploaded: photoResults.length, inspectionId: inspectionId, photos: photoResults };
}

// ── PHOTO UPLOAD ─────────────────────────────────────────

function uploadPhotosToFolder(folder, data) {
  const results = [];
  
  const sections = [
    { name: 'Arrival', data: data.arrivalSetup },
    { name: 'Device Setup', data: data.deviceSetup },
    { name: 'Exterior', data: data.exteriorAssessment },
    { name: 'Radon Setup', data: data.radonSetup },
    { name: 'Utility Room', data: data.utilityRoom },
    { name: 'Wrap Up', data: data.wrapUp },
    { name: 'Shipping', data: data.shippingChecklist },
    { name: 'Post Assessment', data: data.postAssessment }
  ];
  
  (data.rooms || []).forEach(function(room) {
    sections.push({ name: room.roomName || room.type || 'Room', data: room });
  });
  
  sections.forEach(function(section) {
    if (!section.data || !section.data.photos) return;
    
    section.data.photos.forEach(function(photo, idx) {
      try {
        if (!photo.imageData) return;
        
        var base64Data = photo.imageData;
        if (base64Data.indexOf(',') > -1) {
          base64Data = base64Data.split(',')[1];
        }
        
        var ext = 'jpg';
        if (photo.imageData.indexOf('image/png') > -1) ext = 'png';

        var roomLabel = (photo.roomName || section.name || 'Photo').replace(/[^a-zA-Z0-9 \-]/g, '').trim();
        var captionLabel = (photo.caption || '').replace(/[^a-zA-Z0-9 \-]/g, '').trim();
        var filename = captionLabel
          ? roomLabel + ' - ' + captionLabel + '.' + ext
          : roomLabel + ' - Photo ' + String(idx + 1).padStart(2, '0') + '.' + ext;
        
        var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/' + ext, filename);
        var driveFile = folder.createFile(blob);
        
        var description = '';
        if (photo.caption) description += photo.caption;
        if (photo.timestamp) description += (description ? ' | ' : '') + 'Taken: ' + photo.timestamp;
        if (description) driveFile.setDescription(description);
        
        driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        var fileId = driveFile.getId();
        var embedUrl = 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1600';
        results.push({
          filename: filename,
          room: photo.roomName || section.name,
          step: photo.stepName || '',
          caption: photo.caption || '',
          timestamp: photo.timestamp || '',
          driveUrl: embedUrl,
          driveId: fileId
        });
      } catch (err) {
        results.push({
          filename: 'ERROR',
          room: section.name,
          step: '',
          caption: 'Upload failed: ' + err.message,
          driveUrl: ''
        });
      }
    });
  });
  
  return results;
}

// ── AI CAPTION GENERATION ───────────────────────────────
// Calls the vision proxy to generate an AI caption for a photo.
// Returns the caption string, or empty string on failure.
// Silent — never throws, never blocks the main sync.

function generateAiCaption(driveUrl, roomName, stepName) {
  if (!VISION_PROXY_URL || !driveUrl) return '';
  try {
    var prompt = 'You are a professional home health inspector reviewing a photo taken during a residential inspection.' +
      (roomName ? ' Room: ' + roomName + '.' : '') +
      (stepName ? ' Context: ' + stepName + '.' : '') +
      ' Write one clear, factual sentence describing what is visible in this photo and its condition.' +
      ' Focus on anything relevant to home health: moisture, mold, damage, equipment condition, test setup.' +
      ' If nothing of concern: briefly describe what the photo shows.' +
      ' Plain sentence only — no bullet points, no markdown, no preamble.';

    var payload = JSON.stringify({ imageUrl: driveUrl, prompt: prompt });
    var options = {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      muteHttpExceptions: true
    };
    var resp = UrlFetchApp.fetch(VISION_PROXY_URL, options);
    if (resp.getResponseCode() !== 200) return '';
    var result = JSON.parse(resp.getContentText());
    var text = result.content && result.content[0] && result.content[0].text;
    return text ? text.trim() : '';
  } catch (e) {
    return '';
  }
}

// ── PHOTO LOG TAB ────────────────────────────────────────

function writePhotoLog(sheet, photoResults) {
  var headers = ['Room', 'Step', 'Inspector Caption', 'AI Caption', 'Photo URL', 'Timestamp'];
  sheet.appendRow(headers);

  photoResults.forEach(function(p) {
    var aiCaption = generateAiCaption(p.driveUrl, p.room, p.step);
    sheet.appendRow([
      p.room || '',
      p.step || '',
      p.caption || '',
      aiCaption,
      p.driveUrl || '',
      p.timestamp || ''
    ]);
  });

  // Style headers
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // Highlight AI Caption column in light blue so it stands out
  sheet.getRange(1, 4, sheet.getLastRow(), 1).setBackground('#e8f0fe');
  sheet.getRange(1, 4, 1, 1).setBackground('#c9daf8').setFontWeight('bold');

  sheet.setColumnWidth(1, 160);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 300);
  sheet.setColumnWidth(4, 300);
  sheet.setColumnWidth(5, 380);
  sheet.setColumnWidth(6, 160);
}

// ── FOLLOW-UP TAB ──────────────────────────────────────────

function writeFollowUpTab(sheet, data, photoResults) {
  const headers = ['Room', 'Re-check In', 'What to Watch For', 'Photo Link'];
  sheet.appendRow(headers);

  const photoMap = {};
  photoResults.forEach(function(p) {
    if (p.step === 'Follow-Up') {
      photoMap[p.room] = p.driveUrl || '';
    }
  });

  const rooms = data.rooms || [];
  rooms.forEach(function(room) {
    if (room.followUpNeeded === 'Yes') {
      const roomLabel = room.roomName || room.type || '';
      sheet.appendRow([
        roomLabel,
        room.followUpTimeframe || '',
        room.followUpNote || '',
        photoMap[roomLabel] || ''
      ]);
    }
  });

  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 350);
  sheet.setColumnWidth(4, 400);

  // Highlight header row in yellow to draw attention
  sheet.getRange(1, 1, 1, headers.length).setBackground('#fff2cc');
}

// ── SUMMARY TAB ──────────────────────────────────────────

function writeSummary(sheet, data) {
  const rows = [
    ['INHAUS LAB — INSPECTION DATA'],
    [''],
    ['BASIC INFORMATION'],
    ['Inspection ID', data.inspectionId || ''],
    ['Inspector', data.inspectorName || ''],
    ['Date', data.inspectionDate || ''],
    ['Client', data.clientName || ''],
    ['Address', data.propertyAddress || ''],
    [''],
    ['PROPERTY DETAILS'],
    ['Residence Type', data.residenceType || ''],
    ['Year Built', data.yearBuilt || ''],
    ['Square Footage', data.squareFootage || ''],
    ['Bedrooms', data.numberOfBedrooms || ''],
    ['Bathrooms', data.numberOfBathrooms || ''],
    ['Levels', data.numberOfLevels || ''],
    ['Basement', data.basement || ''],
    ['Carpeted Rooms', data.carpetedRooms || ''],
    ['Water Source', data.waterSource || ''],
    [''],
    ['SYSTEMS'],
    ['Stove Type', data.stoveType || ''],
    ['Fireplace', data.fireplace || ''],
    ['Pets', data.pets || ''],
    ['Smoking/Vaping', data.smokingVaping || ''],
    [''],
    ['HVAC (from Utility Room)'],
    ['Heating', getNestedValue(data, 'utilityRoom', 'heatingType')],
    ['AC', getNestedValue(data, 'utilityRoom', 'acType')],
    ['Ventilation', data.ventilationReadable || getNestedValue(data, 'utilityRoom', 'ventilationType')],
    ['Filter Size', getNestedValue(data, 'utilityRoom', 'filterSize')],
    ['Filter Rating', getNestedValue(data, 'utilityRoom', 'filterRating')],
    ['Radon Mitigation', getNestedValue(data, 'utilityRoom', 'radonMitigationPresent')],
    ['Water Filtration', getNestedValue(data, 'utilityRoom', 'waterFiltrationPresent')],
    ['Water Softener', getNestedValue(data, 'utilityRoom', 'waterSofteningPresent')],
    ['Water Soft Type', getNestedValue(data, 'utilityRoom', 'waterSoftType')],
    ['Air Filtration', getNestedValue(data, 'utilityRoom', 'airFiltrationPresent')],
    ['Air Filt Type', getNestedValue(data, 'utilityRoom', 'airFiltType')],
    [''],
    ['ASSESSMENT CONDITIONS'],
    ['Weather', data.weatherConditions || ''],
    ['Occupancy', data.occupancyDuringInspection || ''],
    ['Windows Open', data.windowsOpen || ''],
    ['Cleaning Frequency', data.cleaningFrequency || ''],
    ['Appliances Condition', data.appliancesCondition || ''],
    ['Rooms w/ Dampness', data.roomsWithDampness || 0],
    ['Rooms w/ Musty Smell', data.roomsWithMustySmell || 0],
    [''],
    ['CUSTOMER'],
    ['Concerns', data.clientConcerns || ''],
    ['Known Problem Areas', data.knownProblemAreas || ''],
    [''],
    ['ATP RESULTS'],
    ['Before Cleaning (RLU)', getAtpValue(data, 'atpPreRLU')],
    ['After Cleaning (RLU)', getAtpValue(data, 'atpPostRLU')],
    [''],
    ['TIMESTAMPS'],
    ['Started', data.startedAt || ''],
    ['Ended', data.endedAt || ''],
    ['Status', data.status || '']
  ];
  
  // Pad all rows to 2 columns so setValues works correctly
  const paddedRows = rows.map(r => r.length === 1 ? [r[0], ''] : r);
  sheet.getRange(1, 1, paddedRows.length, 2).setValues(paddedRows);
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 400);
  
  [1, 3, 10, 21, 26, 39, 49, 53, 57].forEach(r => {
    sheet.getRange(r, 1).setFontWeight('bold');
  });
}

// ── AIR DATA TAB ─────────────────────────────────────────

function writeAirData(sheet, data) {
  const rooms = data.rooms || [];
  
  const headers = ['Room', 'PM2.5 (µg/m³)', 'PM10 (µg/m³)', 'TVOCs (µg/m³)', 
    'Formaldehyde (ppm)', 'CO (ppm)', 'CO2 (ppm)', 'Ozone (ppm)', 
    'Chlorine (ppm)', 'NO2 (ppm)', 'Temp (°F)', 'Humidity (%)'];
  sheet.appendRow(headers);
  
  rooms.forEach(room => {
    if (room.qtrak_co2 || room.qtrak_pm25) {
      sheet.appendRow([
        room.roomName || room.type || '',
        room.qtrak_pm25 || '',
        room.qtrak_pm10 || '',
        room.qtrak_voc || '',
        room.formaldehyde || '',
        room.qtrak_co || '',
        room.qtrak_co2 || '',
        room.qtrak_ozone || '',
        room.qtrak_chlorine || '',
        room.qtrak_no2 || '',
        room.qtrak_temp || '',
        room.qtrak_humidity || ''
      ]);
    }
  });
  
  const dataRooms = rooms.filter(r => r.qtrak_co2 || r.qtrak_pm25);
  if (dataRooms.length > 0) {
    const lastRow = dataRooms.length + 1;
    sheet.appendRow([]);
    const avgRow = lastRow + 2;
    sheet.getRange(avgRow, 1).setValue('AVERAGES');
    sheet.getRange(avgRow, 1).setFontWeight('bold');
    for (let col = 2; col <= 12; col++) {
      const colLetter = String.fromCharCode(64 + col);
      sheet.getRange(avgRow, col).setFormula('=AVERAGE(' + colLetter + '2:' + colLetter + lastRow + ')');
    }
  }
  
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// ── ROOM DETAILS TAB ─────────────────────────────────────

function writeRoomDetails(sheet, data) {
  const rooms = data.rooms || [];
  
  const headers = ['Room', 'Type', 'Level', 'Observations', 'Notes', 
    'Breeze Done', 'Spore Trap ID', 'FLIR Done', 'FLIR Concerns'];
  sheet.appendRow(headers);
  
  rooms.forEach(room => {
    const obs = (room.observations || []).join(', ');
    sheet.appendRow([
      room.roomName || '',
      room.type || '',
      room.level || '',
      obs,
      room.notes || '',
      room.breezeDone || '',
      room.sporeTrapId || '',
      room.flirDone || '',
      room.flirConcerns || ''
    ]);
  });
  
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// ── CSV OUTPUT TAB ───────────────────────────────────────

function writeCSVOutput(sheet, data) {
  const headers = getCSVHeaders();
  const values = getCSVValues(data);
  
  sheet.appendRow(headers);
  sheet.appendRow(values);
  
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// ── CSV FIELD MAPPING ────────────────────────────────────

function getCSVHeaders() {
  return [
    'Assessed By', 'Phone', 'Email', 'Address', 'Sample Date',
    'Overall Home Health Score', 'Percentile', 'Score Summary', 'Customer Concerns',
    'Air Quality Score', 'Air Quality Description',
    'Water Quality Score', 'Water Quality Description',
    'Radon Score', 'Radon Description',
    'Mold Score', 'Mold Description',
    'Surface Contaminants Score', 'Surface Contaminants Description',
    'Allergens Score', 'Allergens Description',
    'Action Item 1 Title', 'Action Item 1 Description', 'Action Item 1 Priority', 'Action Item 1 Timeframe',
    'Action Item 2 Title', 'Action Item 2 Description', 'Action Item 2 Priority', 'Action Item 2 Timeframe',
    'Action Item 3 Title', 'Action Item 3 Description', 'Action Item 3 Priority', 'Action Item 3 Timeframe',
    'Residence Type', 'Year Built', 'Liveable Space', 'Bedrooms', 'Bathrooms',
    'Basement', 'Carpeted Rooms', 'Primary Residence', 'Water Source',
    'Forced Air HVAC', 'Heating Source', 'AC Type', 'Ventilation Type',
    'Water Filter', 'Water Softener', 'HVAC Air Cleaning', 'Other Air Cleaning',
    'Radon Mitigation', 'Stove Type', 'Fireplace',
    'Cleaning Frequency', 'Windows Open Frequency',
    'Temperature', 'Temperature Range', 'Relative Humidity', 'Humidity Range',
    'Weather Conditions', 'Testing Duration', 'Home Occupancy',
    'Windows Open', 'Dampness or Mold', 'Musty Smell',
    'Appliances Condition', 'Pets', 'Technician Comments'
  ];
}

function getCSVValues(data) {
  const util = data.utilityRoom || {};
  const qtrakAvg = computeQtrakAverages(data);
  
  const techNotes = [];
  const arrivalNotes = getNestedValue(data, 'arrivalSetup', 'arrivalNotes');
  if (arrivalNotes) techNotes.push('Arrival: ' + arrivalNotes);
  const exteriorNotes = getNestedValue(data, 'exteriorAssessment', 'exteriorNotes');
  if (exteriorNotes) techNotes.push('Exterior: ' + exteriorNotes);
  (data.rooms || []).forEach(room => {
    if (room.notes) techNotes.push((room.roomName || room.type) + ': ' + room.notes);
  });
  const utilNotes = util.notes;
  if (utilNotes) techNotes.push('Utility: ' + utilNotes);
  
  let duration = '';
  if (data.startedAt && data.endedAt) {
    const ms = new Date(data.endedAt) - new Date(data.startedAt);
    duration = Math.round(ms / 3600000 * 100) / 100 + ' hours';
  }
  
  let waterSource = data.waterSource || '';
  if (waterSource === 'Municipal') waterSource = 'City / Municipal';
  if (waterSource === 'Other' && data.waterSourceDescription) waterSource = data.waterSourceDescription;
  
  const filterParts = [util.filterSize, util.filterRating].filter(Boolean);
  
  return [
    data.inspectorName || '',
    '',
    '',
    data.propertyAddress || '',
    data.inspectionDate || '',
    '', '', '',
    data.clientConcerns || '',
    '', '',
    '', '',
    '', '',
    '', '',
    '', '',
    '', '',
    '', '', '', '',
    '', '', '', '',
    '', '', '', '',
    data.residenceType || '',
    data.yearBuilt || '',
    data.squareFootage || '',
    data.numberOfBedrooms || '',
    data.numberOfBathrooms || '',
    data.basement || '',
    data.carpetedRooms || '',
    '',
    waterSource,
    '',
    util.heatingType || '',
    util.acType || '',
    data.ventilationReadable || util.ventilationType || '',
    util.waterFiltType || '',
    util.waterSoftType || '',
    filterParts.join(' - '),
    util.airFiltType || '',
    util.radonMitigationPresent === 'Yes' ? 'Yes' : 'No',
    data.stoveType || '',
    data.fireplace || '',
    data.cleaningFrequency || '',
    '',
    qtrakAvg.temp || '',
    '',
    qtrakAvg.humidity || '',
    '',
    data.weatherConditions || '',
    duration,
    data.occupancyDuringInspection || '',
    data.windowsOpen || '',
    data.roomsWithDampness || 0,
    data.roomsWithMustySmell || 0,
    data.appliancesCondition || '',
    data.pets || '',
    techNotes.join('\n')
  ];
}

// ── HELPER FUNCTIONS ─────────────────────────────────────

function getNestedValue(obj, key1, key2) {
  return (obj && obj[key1] && obj[key1][key2]) || '';
}

function getAtpValue(data, field) {
  const rooms = data.rooms || [];
  for (let i = 0; i < rooms.length; i++) {
    if (rooms[i].type === 'atp-kitchen' && rooms[i][field]) {
      return rooms[i][field];
    }
  }
  return '';
}

function computeQtrakAverages(data) {
  const rooms = data.rooms || [];
  const params = { pm25: [], pm10: [], voc: [], co: [], co2: [], ozone: [], chlorine: [], no2: [], temp: [], humidity: [] };
  
  rooms.forEach(room => {
    Object.keys(params).forEach(p => {
      const key = 'qtrak_' + p;
      const val = parseFloat(room[key]);
      if (!isNaN(val)) params[p].push(val);
    });
    const fVal = parseFloat(room.formaldehyde);
    if (!isNaN(fVal)) {
      if (!params.formaldehyde) params.formaldehyde = [];
      params.formaldehyde.push(fVal);
    }
  });
  
  const avg = {};
  Object.keys(params).forEach(p => {
    if (params[p] && params[p].length > 0) {
      const sum = params[p].reduce((a, b) => a + b, 0);
      avg[p] = Math.round(sum / params[p].length * 10000) / 10000;
    }
  });
  
  return avg;
}

// ── TEST FUNCTION ────────────────────────────────────────

function testWithSampleData() {
  const sampleData = {
    inspectionId: 'INH-20260403-TEST',
    inspectorName: 'David Kline',
    inspectionDate: '2026-04-03',
    clientName: 'Test Client',
    propertyAddress: '123 Test St, Minneapolis, MN 55401',
    numberOfBedrooms: '3',
    numberOfBathrooms: '2',
    numberOfLevels: '2',
    waterSource: 'Municipal',
    residenceType: 'Single-Family Home',
    yearBuilt: '1978',
    squareFootage: '1636',
    basement: 'Yes - Finished',
    carpetedRooms: '2',
    pets: 'Yes - Dog',
    smokingVaping: 'No',
    stoveType: 'Gas',
    fireplace: 'Yes - Wood Burning',
    clientConcerns: 'Concerned about mold',
    weatherConditions: '45F and sunny',
    cleaningFrequency: 'Weekly',
    occupancyDuringInspection: 'Yes',
    windowsOpen: 'No',
    appliancesCondition: 'Good (3-10 years)',
    roomsWithDampness: 0,
    roomsWithMustySmell: 0,
    startedAt: '2026-04-03T10:00:00',
    endedAt: '2026-04-03T13:00:00',
    status: 'complete',
    utilityRoom: {
      heatingType: 'Natural Gas Furnace',
      acType: 'Central AC',
      ventilationType: 'Bathroom Exhaust Fan(s)',
      filterSize: '16x20x1',
      filterRating: 'MERV 8',
      radonMitigationPresent: 'No',
      waterFiltrationPresent: 'No',
      waterSofteningPresent: 'Yes',
      waterSoftType: 'Culligan',
      airFiltrationPresent: 'Yes',
      airFiltType: 'HEPA purifier'
    },
    arrivalSetup: { arrivalNotes: 'Home in good condition' },
    exteriorAssessment: { exteriorNotes: 'Gutters need cleaning' },
    rooms: [
      {
        roomName: 'Living Room', type: 'living-area',
        qtrak_pm25: '1.5', qtrak_pm10: '2.2', qtrak_voc: '0.3',
        qtrak_co: '0.9', qtrak_co2: '920', qtrak_ozone: '0.05',
        qtrak_chlorine: '0.009', qtrak_no2: '0.04',
        qtrak_temp: '68', qtrak_humidity: '35',
        formaldehyde: '0.024',
        observations: [], notes: ''
      },
      {
        roomName: 'Kitchen Counter', type: 'atp-kitchen',
        atpPreRLU: '800', atpPostRLU: '45'
      }
    ]
  };
  
  const result = createInspectionSheet(sampleData);
  Logger.log('Sheet: ' + result.spreadsheetUrl);
  Logger.log('Folder: ' + result.folderUrl);
  Logger.log('Photos uploaded: ' + result.photosUploaded);
}
