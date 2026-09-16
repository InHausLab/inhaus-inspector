(function exposeMissionControlData(root) {
  'use strict';

  function validDate(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function selectLatestPhotos(photos, limit = 12) {
    return (Array.isArray(photos) ? photos : [])
      .map((photo, index) => ({ photo, index, date: validDate(photo && photo.timestamp) }))
      .sort((a, b) => {
        const difference = (b.date?.getTime() || 0) - (a.date?.getTime() || 0);
        return difference || b.index - a.index;
      })
      .slice(0, limit)
      .map(item => item.photo);
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function inspectionRoot(inspection) {
    if (!isPlainObject(inspection)) return {};
    return isPlainObject(inspection.resumeData) ? inspection.resumeData : inspection;
  }

  function photoId(value) {
    if (isPlainObject(value)) return String(value.photoId || value.id || value.photo_id || '').trim();
    return String(value || '').trim();
  }

  function displayRoom(stepId, step) {
    const explicit = String(step.roomName || step._roomName || step.stepName || '').trim();
    if (explicit) return explicit;
    return String(stepId || 'Unknown area')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, character => character.toUpperCase());
  }

  function recordedAt(step, photoRefs) {
    const candidates = [];
    const updates = isPlainObject(step._fieldUpdates) ? step._fieldUpdates : {};
    for (const key of ['followUpNeeded', 'followUpTimeframe', 'followUpNote', 'photo']) {
      const update = isPlainObject(updates[key]) ? updates[key] : {};
      candidates.push(update.updatedAt, update.timestamp);
    }
    for (const ref of photoRefs) {
      if (isPlainObject(ref)) candidates.push(ref.timestamp, ref.createdAt, ref.capturedAt, ref._vaultSavedAt);
    }
    const dates = candidates.map(validDate).filter(Boolean).sort((a, b) => b - a);
    if (dates.length) return dates[0].toISOString();
    const fallbackDates = [step._updatedAt, step.updatedAt].map(validDate).filter(Boolean).sort((a, b) => b - a);
    return fallbackDates.length ? fallbackDates[0].toISOString() : '';
  }

  function extractFollowUps(inspection, photos) {
    const rootInspection = inspectionRoot(inspection);
    const stepData = isPlainObject(rootInspection.stepData) ? rootInspection.stepData : {};
    const photosById = new Map(
      (Array.isArray(photos) ? photos : [])
        .map(photo => [photoId(photo), photo])
        .filter(([id]) => id)
    );

    return Object.entries(stepData)
      .map(([stepId, step]) => {
        if (!isPlainObject(step)) return null;
        const text = String(step.followUpNote || step.watchFor || step.followUpPlan || '').trim();
        const timeframe = String(step.followUpTimeframe || step.recheckIn || '').trim();
        const refs = Array.isArray(step._followUpPhotos) ? step._followUpPhotos : [];
        const needed = /^(yes|true|1)$/i.test(String(step.followUpNeeded || '').trim());
        const ids = [...new Set(refs.map(photoId).filter(Boolean))];
        if (!needed && !text && !timeframe && !ids.length) return null;
        const associatedPhotos = ids
          .map(id => photosById.get(id) || refs.find(ref => photoId(ref) === id))
          .filter(photo => photo && photo.url);
        return {
          stepId,
          room: displayRoom(stepId, step),
          text: text || 'Follow-up recommended.',
          timeframe,
          recordedAt: recordedAt(step, refs),
          associatedPhotos
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const difference = (validDate(b.recordedAt)?.getTime() || 0) - (validDate(a.recordedAt)?.getTime() || 0);
        return difference || a.room.localeCompare(b.room);
      });
  }

  function wait(milliseconds) {
    if (!milliseconds) return Promise.resolve();
    return new Promise(resolve => root.setTimeout(resolve, milliseconds));
  }

  async function fetchJsonWithRetry(url, options = {}, retryOptions = {}) {
    const attempts = Math.max(1, Number(retryOptions.attempts) || 5);
    const baseDelayMs = Math.max(0, Number(retryOptions.baseDelayMs) || 0);
    const timeoutMs = Math.max(1, Number(retryOptions.timeoutMs) || 15000);
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new root.AbortController();
      const timeoutId = root.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await root.fetch(url, { ...options, signal: controller.signal });
        if (!response.ok) {
          const error = new Error(`Request failed (${response.status})`);
          error.status = response.status;
          throw error;
        }
        const data = await response.json();
        if (data.status && data.status !== 'ok') {
          const error = new Error(data.message || `Service returned ${data.status}`);
          error.retryable = false;
          throw error;
        }
        return data;
      } catch (error) {
        if (error && error.name === 'AbortError') error = new Error('Request timed out');
        lastError = error;
        const status = Number(error && error.status);
        const retryableStatus = !status || status === 408 || status === 425 || status === 429 || status >= 500;
        if (attempt >= attempts || error.retryable === false || !retryableStatus) throw error;
        await wait(baseDelayMs * (2 ** (attempt - 1)));
      } finally {
        root.clearTimeout(timeoutId);
      }
    }

    throw lastError;
  }

  async function mapWithConcurrency(items, mapper, limit = 3) {
    const values = Array.isArray(items) ? items : [];
    const results = new Array(values.length);
    const workerCount = Math.min(values.length, Math.max(1, Number(limit) || 1));
    let nextIndex = 0;

    async function work() {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index], index);
      }
    }

    await Promise.all(Array.from({ length: workerCount }, work));
    return results;
  }

  const api = {
    selectLatestPhotos,
    extractFollowUps,
    fetchJsonWithRetry,
    mapWithConcurrency
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MissionControlData = api;
}(typeof window !== 'undefined' ? window : globalThis));
