// InHaus Inspector - company-wide approved comment library bridge
import { GOOGLE_SCRIPT_URL, FIELD_RESUME_TOKEN } from './config.js?v=165';
import { scriptFetch } from './sync.js?v=165';

const CACHE_KEY = 'inhaus_company_comment_library_v1';
let memoryCache = null;
let serverReady = false;

function normalize(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function readCache() {
  if (memoryCache) return memoryCache;
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    memoryCache = {
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      loadedAt: parsed.loadedAt || ''
    };
  } catch (err) {
    memoryCache = { comments: [], loadedAt: '' };
  }
  return memoryCache;
}

function writeCache(comments) {
  memoryCache = { comments: Array.isArray(comments) ? comments : [], loadedAt: new Date().toISOString() };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(memoryCache)); } catch (err) {}
  return memoryCache.comments;
}

async function fetchJson(url, context) {
  const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch (err) { throw new Error(context + ' returned invalid JSON'); }
  if (!response.ok || data?.status !== 'ok') throw new Error(data?.message || context + ' failed');
  return data;
}

export async function loadCompanyCommentLibrary(force) {
  const cached = readCache();
  if (!force && cached.loadedAt && Date.now() - Date.parse(cached.loadedAt) < 5 * 60 * 1000) return cached.comments;
  if (!GOOGLE_SCRIPT_URL) return cached.comments;
  try {
    const url = new URL(GOOGLE_SCRIPT_URL);
    url.searchParams.set('action', 'commentLibrary');
    url.searchParams.set('token', FIELD_RESUME_TOKEN);
    const data = await fetchJson(url.toString(), 'Company comment library');
    serverReady = data.libraryVersion === 1 && Array.isArray(data.comments);
    if (!serverReady) return cached.comments;
    return writeCache((data.comments || []).filter(item => item && item.status === 'approved' && item.cleanedText));
  } catch (err) {
    console.warn('Company comment library unavailable:', err);
    return cached.comments;
  }
}

export function mergeCompanyCommentsIntoInspection(inspection, comments) {
  if (!inspection) return 0;
  if (!Array.isArray(inspection.commentLibrary)) inspection.commentLibrary = [];
  const byText = new Map(inspection.commentLibrary.map(item => [normalize(item.cleanedText), item]));
  let added = 0;
  (comments || []).forEach(item => {
    const key = normalize(item.cleanedText);
    if (!key) return;
    const companyEntry = Object.assign({}, item, {
      commentId: item.commentId || item.libraryId,
      source: 'company_library',
      companyStatus: 'approved',
      reusableStatus: 'approved'
    });
    if (!byText.has(key)) {
      inspection.commentLibrary.push(companyEntry);
      byText.set(key, companyEntry);
      added++;
    } else if (byText.get(key).source === 'company_library') {
      Object.assign(byText.get(key), companyEntry);
    }
  });
  return added;
}

export async function refreshCompanyComments(inspection, force) {
  const comments = await loadCompanyCommentLibrary(force);
  return mergeCompanyCommentsIntoInspection(inspection, comments);
}

export async function submitCompanyCommentCandidate(inspection, finding, entry) {
  if (!entry?.cleanedText) throw new Error('Missing cleaned comment');
  if (!serverReady) {
    await loadCompanyCommentLibrary(true);
    if (!serverReady) throw new Error('Company library backend is not deployed yet');
  }
  const result = await scriptFetch({
    action: 'commentLibraryCandidate',
    token: FIELD_RESUME_TOKEN,
    inspectionId: inspection?.inspectionId || '',
    comment: {
      commentId: entry.commentId,
      cleanedText: entry.cleanedText,
      severity: entry.severity || finding?.severity || 'Observation',
      reportSection: entry.reportSection || finding?.reportSection || '',
      submittedBy: finding?.approvedBy || finding?.updatedBy || '',
      submittedAt: new Date().toISOString(),
      sourceFindingId: finding?.findingId || ''
    }
  });
  return result.comment || result;
}

export async function flushPendingCompanyCommentCandidates(inspection) {
  if (!inspection?.commentLibrary) return 0;
  let submitted = 0;
  for (const entry of inspection.commentLibrary.filter(item => item.companyStatus === 'pending_upload')) {
    const finding = inspection.findings?.find(item => item.findingId === entry.sourceFindingId);
    try {
      await submitCompanyCommentCandidate(inspection, finding, entry);
      entry.companyStatus = 'pending_review';
      entry.companySubmittedAt = new Date().toISOString();
      submitted++;
    } catch (err) {
      break;
    }
  }
  return submitted;
}
