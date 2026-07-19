// InHaus Inspector - local photo destination suggestions

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'area', 'assessment', 'at', 'for', 'in', 'inspection',
  'level', 'of', 'on', 'room', 'section', 'setup', 'the', 'to', 'with'
]);

const CONCEPTS = {
  kitchen: ['kitchen', 'sink', 'stove', 'oven', 'range', 'cooktop', 'dishwasher', 'refrigerator', 'countertop', 'cabinet', 'pantry'],
  bathroom: ['bathroom', 'toilet', 'shower', 'bathtub', 'tub', 'vanity', 'lavatory', 'tile', 'grout'],
  bedroom: ['bedroom', 'bed', 'closet', 'mattress'],
  exterior: ['exterior', 'outside', 'siding', 'foundation', 'gutter', 'downspout', 'roof', 'deck', 'porch', 'driveway', 'grading', 'landscape'],
  utility: ['utility', 'furnace', 'boiler', 'water heater', 'water softener', 'softener', 'electrical panel', 'breaker', 'hvac', 'air handler', 'filter'],
  basement: ['basement', 'lowest', 'crawlspace', 'crawl space', 'sump', 'foundation wall'],
  living: ['living', 'family room', 'fireplace', 'main living'],
  water: ['water sample', 'sample bottle', 'sample id', 'water testing', 'faucet', 'tap water', 'pfas', 'microplastic'],
  air: ['q-trak', 'qtrak', 'airthings', 'air test', 'air testing', 'voc', 'formaldehyde', 'radon', 'co2'],
  arrival: ['arrival', 'equipment', 'tarp', 'entryway'],
  debrief: ['debrief', 'homeowner', 'customer'],
  property: ['property details', 'address', 'blueprint', 'floor plan']
};

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function words(value) {
  return normalize(value).split(' ').filter(word => word.length > 2 && !STOP_WORDS.has(word));
}

function destinationKey(destination) {
  return normalize(destination?.roomName) + '|' + normalize(destination?.stepName);
}

function conceptNamesFor(value) {
  const text = normalize(value);
  return Object.entries(CONCEPTS)
    .filter(([, phrases]) => phrases.some(phrase => text.includes(normalize(phrase))))
    .map(([name]) => name);
}

function timeValue(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function proximityScores(photo, routedPhotos) {
  const timestamp = timeValue(photo?.timestamp || photo?.createdAt);
  if (!timestamp) return new Map();
  const sorted = (routedPhotos || [])
    .filter(item => item && (item.roomName || item.stepName) && timeValue(item.timestamp || item.createdAt))
    .map(item => ({ item, delta: timeValue(item.timestamp || item.createdAt) - timestamp }))
    .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
  const scores = new Map();
  sorted.slice(0, 4).forEach(({ item, delta }) => {
    const distance = Math.abs(delta);
    const points = distance <= 90_000 ? 42 : distance <= 300_000 ? 28 : distance <= 900_000 ? 12 : 0;
    if (!points) return;
    const key = destinationKey(item);
    scores.set(key, Math.max(scores.get(key) || 0, points));
  });

  const before = sorted.filter(entry => entry.delta < 0)[0];
  const after = sorted.filter(entry => entry.delta > 0)[0];
  if (before && after && destinationKey(before.item) === destinationKey(after.item) &&
      Math.abs(before.delta) <= 600_000 && Math.abs(after.delta) <= 600_000) {
    const key = destinationKey(before.item);
    scores.set(key, Math.max(scores.get(key) || 0, 58));
  }
  return scores;
}

export function suggestPhotoDestination(photo, destinations, routedPhotos) {
  const candidates = Array.isArray(destinations) ? destinations : [];
  if (!photo || !candidates.length) return null;
  const photoText = [photo.caption, photo.fileName, photo.originalName, photo.aiCaption].filter(Boolean).join(' ');
  const photoWords = new Set(words(photoText));
  const photoConcepts = new Set(conceptNamesFor(photoText));
  const nearby = proximityScores(photo, routedPhotos);

  const ranked = candidates.map(destination => {
    const key = destinationKey(destination);
    const label = [destination.roomName, destination.stepName, destination.label].filter(Boolean).join(' ');
    const labelWords = new Set(words(label));
    const labelConcepts = new Set(conceptNamesFor(label));
    let score = nearby.get(key) || 0;
    const reasons = [];
    let directMatches = 0;
    photoWords.forEach(word => { if (labelWords.has(word)) directMatches++; });
    if (directMatches) {
      score += Math.min(52, directMatches * 22);
      reasons.push('comment matches ' + (destination.label || destination.stepName || destination.roomName));
    }
    const conceptMatches = Array.from(photoConcepts).filter(name => labelConcepts.has(name));
    if (conceptMatches.length) {
      score += Math.min(56, conceptMatches.length * 34);
      reasons.push(conceptMatches.join(', ') + ' context');
    }
    if (nearby.get(key)) reasons.push('near photos already placed here');
    return { destination, score, reasons };
  }).sort((a, b) => b.score - a.score || String(a.destination.label).localeCompare(String(b.destination.label)));

  const best = ranked[0];
  const second = ranked[1];
  if (!best || best.score < 20) return null;
  const margin = best.score - (second?.score || 0);
  const confidence = best.score >= 70 && margin >= 18 ? 'high' : best.score >= 42 && margin >= 10 ? 'medium' : 'low';
  return {
    roomName: best.destination.roomName || '',
    stepName: best.destination.stepName || '',
    label: best.destination.label || [best.destination.roomName, best.destination.stepName].filter(Boolean).join(' → '),
    confidence,
    score: best.score,
    reason: best.reasons.join(' + ') || 'nearby capture context',
    suggestedAt: new Date().toISOString()
  };
}

export function buildPhotoRoutingSuggestions(photoRefs, destinations) {
  const refs = Array.isArray(photoRefs) ? photoRefs : [];
  const routed = refs.filter(ref => ref && !ref.needsPlacement && (ref.roomName || ref.stepName)).map(ref => ({
    roomName: ref.roomName,
    stepName: ref.stepName,
    timestamp: ref.photo?.timestamp,
    caption: ref.photo?.caption
  }));
  return refs.filter(ref => ref?.needsPlacement).map(ref => ({
    photoId: ref.photo?.photoId,
    suggestion: suggestPhotoDestination(ref.photo, destinations, routed)
  })).filter(item => item.photoId && item.suggestion);
}
