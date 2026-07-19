// InHaus Inspector - IndexedDB Storage Layer
(function () {
  const DB_NAME = 'InHausInspector';
  const DB_VERSION = 4;
  const STORE = 'inspections';
  const QUEUE_STORE = 'uploadQueue';
  const PHOTO_STORE = 'photoVault';
  const HISTORY_STORE = 'inspectionHistory';
  const PHOTO_TRASH_STORE = 'photoTrash';
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      let settled = false;
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'inspectionId' });
          s.createIndex('status', 'status');
          s.createIndex('startedAt', 'startedAt');
        }
        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          db.createObjectStore(QUEUE_STORE, { keyPath: 'inspectionId' });
        }
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          const ps = db.createObjectStore(PHOTO_STORE, { keyPath: 'photoId' });
          ps.createIndex('inspectionId', 'inspectionId');
          ps.createIndex('createdAt', 'createdAt');
          ps.createIndex('uploadState', 'uploadState');
        }
        if (!db.objectStoreNames.contains(HISTORY_STORE)) {
          const hs = db.createObjectStore(HISTORY_STORE, { keyPath: 'snapshotId' });
          hs.createIndex('inspectionId', 'inspectionId');
          hs.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains(PHOTO_TRASH_STORE)) {
          const ts = db.createObjectStore(PHOTO_TRASH_STORE, { keyPath: 'photoId' });
          ts.createIndex('inspectionId', 'inspectionId');
          ts.createIndex('deletedAt', 'deletedAt');
        }
      };
      req.onblocked = () => {
        if (settled) return;
        settled = true;
        const err = new Error('Another InHaus Inspector tab is blocking a local database update. Close the other app tabs, then try again.');
        err.name = 'DatabaseUpgradeBlockedError';
        reject(err);
      };
      req.onsuccess = e => {
        if (settled) {
          e.target.result.close();
          return;
        }
        settled = true;
        _db = e.target.result;
        _db.onversionchange = () => {
          _db.close();
          _db = null;
        };
        resolve(_db);
      };
      req.onerror = e => {
        if (settled) return;
        settled = true;
        reject(e.target.error);
      };
    });
  }

  async function save(data) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data);
      tx.oncomplete = resolve;
      tx.onerror = e => reject(e.target.error);
    });
  }

  async function get(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function getAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function remove(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = e => reject(e.target.error);
    });
  }

  // ── Upload Queue ────────────────────────────────────────────
  async function queueUpload(data) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      tx.objectStore(QUEUE_STORE).put(data);
      tx.oncomplete = resolve;
      tx.onerror = e => reject(e.target.error);
    });
  }

  async function getQueue() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readonly');
      const req = tx.objectStore(QUEUE_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function removeFromQueue(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QUEUE_STORE, 'readwrite');
      tx.objectStore(QUEUE_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = e => reject(e.target.error);
    });
  }

  // ── Photo Vault ───────────────────────────────────────────
  // Stores each image independently from the inspection form so photos have
  // their own local rescue copy if form sync or rendering fails.
  async function savePhoto(record) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readwrite');
      const now = new Date().toISOString();
      const clean = Object.assign({}, record, {
        updatedAt: now,
        createdAt: record.createdAt || record.timestamp || now,
        uploadState: record.uploadState || (record.driveUrl ? 'uploaded' : 'local')
      });
      tx.objectStore(PHOTO_STORE).put(clean);
      tx.oncomplete = () => resolve(clean);
      tx.onerror = e => reject(e.target.error);
    });
  }

  async function getPhoto(photoId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readonly');
      const req = tx.objectStore(PHOTO_STORE).get(photoId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function getPhotosForInspection(inspectionId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readonly');
      const idx = tx.objectStore(PHOTO_STORE).index('inspectionId');
      const req = idx.getAll(inspectionId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function updatePhoto(photoId, changes) {
    const existing = await getPhoto(photoId);
    if (!existing) return null;
    return savePhoto(Object.assign({}, existing, changes || {}));
  }

  async function removePhoto(photoId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_STORE, 'readwrite');
      tx.objectStore(PHOTO_STORE).delete(photoId);
      tx.oncomplete = resolve;
      tx.onerror = e => reject(e.target.error);
    });
  }

  function snapshotData(inspection) {
    return JSON.parse(JSON.stringify(inspection, function(key, value) {
      if (key === 'dataUrl' || key === 'thumbnailDataUrl' || key === 'originalDataUrl' || key === 'imageData') return undefined;
      if (key === '_photoRetryQueue') return undefined;
      return value;
    }));
  }

  async function saveSnapshot(inspection, reason) {
    if (!inspection || !inspection.inspectionId) return null;
    const db = await open();
    const now = new Date().toISOString();
    const record = {
      snapshotId: inspection.inspectionId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      inspectionId: inspection.inspectionId,
      createdAt: now,
      reason: reason || 'Automatic restore point',
      data: snapshotData(inspection)
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE, 'readwrite');
      tx.objectStore(HISTORY_STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = e => reject(e.target.error);
    });
    const records = await getSnapshotsForInspection(inspection.inspectionId);
    const expired = records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(25);
    if (expired.length) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_STORE, 'readwrite');
        expired.forEach(item => tx.objectStore(HISTORY_STORE).delete(item.snapshotId));
        tx.oncomplete = resolve;
        tx.onerror = e => reject(e.target.error);
      });
    }
    return record;
  }

  async function getSnapshotsForInspection(inspectionId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE, 'readonly');
      const req = tx.objectStore(HISTORY_STORE).index('inspectionId').getAll(inspectionId);
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
      req.onerror = e => reject(e.target.error);
    });
  }

  async function trashPhoto(record, inspectionId, reason) {
    if (!record || !record.photoId) return null;
    const db = await open();
    const now = new Date();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([PHOTO_TRASH_STORE, PHOTO_STORE], 'readwrite');
      const vaultStore = tx.objectStore(PHOTO_STORE);
      const getReq = vaultStore.get(record.photoId);
      let trashed = null;
      getReq.onsuccess = () => {
        // Prefer the vault copy for pixels, then overlay current placement and
        // caption metadata from the form reference being deleted.
        trashed = Object.assign({}, getReq.result || {}, record, {
          inspectionId: inspectionId || record.inspectionId || getReq.result?.inspectionId || '',
          deletedAt: now.toISOString(),
          purgeAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          deleteReason: reason || 'Deleted by inspector'
        });
        tx.objectStore(PHOTO_TRASH_STORE).put(trashed);
        vaultStore.delete(record.photoId);
      };
      tx.oncomplete = () => resolve(trashed);
      tx.onerror = e => reject(e.target.error);
    });
  }

  async function getDeletedPhotos(inspectionId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_TRASH_STORE, 'readonly');
      const req = tx.objectStore(PHOTO_TRASH_STORE).index('inspectionId').getAll(inspectionId);
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))));
      req.onerror = e => reject(e.target.error);
    });
  }

  async function restoreDeletedPhoto(photoId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([PHOTO_TRASH_STORE, PHOTO_STORE], 'readwrite');
      const getReq = tx.objectStore(PHOTO_TRASH_STORE).get(photoId);
      let restored = null;
      getReq.onsuccess = () => {
        if (!getReq.result) return;
        restored = Object.assign({}, getReq.result);
        delete restored.deletedAt;
        delete restored.purgeAfter;
        delete restored.deleteReason;
        tx.objectStore(PHOTO_STORE).put(restored);
        tx.objectStore(PHOTO_TRASH_STORE).delete(photoId);
      };
      tx.oncomplete = () => resolve(restored);
      tx.onerror = e => reject(e.target.error);
    });
  }

  async function permanentlyDeletePhoto(photoId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PHOTO_TRASH_STORE, 'readwrite');
      tx.objectStore(PHOTO_TRASH_STORE).delete(photoId);
      tx.oncomplete = resolve;
      tx.onerror = e => reject(e.target.error);
    });
  }

  window.DB = {
    save, get, getAll, remove, queueUpload, getQueue, removeFromQueue,
    savePhoto, getPhoto, getPhotosForInspection, updatePhoto, removePhoto,
    saveSnapshot, getSnapshotsForInspection,
    trashPhoto, getDeletedPhotos, restoreDeletedPhoto, permanentlyDeletePhoto
  };
})();
