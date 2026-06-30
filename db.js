// InHaus Inspector - IndexedDB Storage Layer
(function () {
  const DB_NAME = 'InHausInspector';
  const DB_VERSION = 3;
  const STORE = 'inspections';
  const QUEUE_STORE = 'uploadQueue';
  const PHOTO_STORE = 'photoVault';
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
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
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror = e => reject(e.target.error);
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

  window.DB = {
    save, get, getAll, remove, queueUpload, getQueue, removeFromQueue,
    savePhoto, getPhoto, getPhotosForInspection, updatePhoto, removePhoto
  };
})();
