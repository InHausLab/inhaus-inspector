import { cloudFetch } from './sync.js?v=228';

const tokenInput = document.getElementById('admin-token');
const loadButton = document.getElementById('load-library');
const statusEl = document.getElementById('library-status');
const content = document.getElementById('library-content');
const summary = document.getElementById('library-summary');
const candidateList = document.getElementById('candidate-list');
const approvedList = document.getElementById('approved-list');
let library = { comments: [], candidates: [] };

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (key === 'className') node.className = value;
    else if (key === 'onClick') node.addEventListener('click', value);
    else node.setAttribute(key, value);
  });
  (Array.isArray(children) ? children : [children]).filter(item => item !== undefined && item !== null).forEach(item => {
    node.appendChild(item instanceof Node ? item : document.createTextNode(String(item)));
  });
  return node;
}

function setStatus(message, error) {
  statusEl.textContent = message;
  statusEl.style.color = error ? '#b42318' : '';
}

async function loadLibrary() {
  const token = tokenInput.value.trim();
  if (!token) { setStatus('Enter the admin token.', true); return; }
  loadButton.disabled = true;
  setStatus('Loading…');
  try {
    const data = await cloudFetch({ action: 'commentLibraryAdmin', command: 'list', adminToken: token });
    if (data.libraryVersion !== 1 || !data.library) throw new Error(data.message || 'Company library backend is not deployed yet');
    library = data.library || { comments: [], candidates: [] };
    sessionStorage.setItem('inhaus_comment_admin_token', token);
    content.hidden = false;
    render();
    setStatus('Library loaded. Changes are available to inspectors after approval.');
  } catch (err) {
    setStatus(err.message || 'Could not load library.', true);
  } finally {
    loadButton.disabled = false;
  }
}

function field(label, control) {
  return el('label', { className: 'library-admin-field' }, [el('span', null, label), control]);
}

function editor(item, pending) {
  const text = el('textarea', { className: 'field-textarea', rows: '3' });
  text.value = item.cleanedText || '';
  const severity = el('select', { className: 'field-input' });
  ['Information', 'Observation', 'Maintenance', 'Concern', 'Urgent'].forEach(value => {
    const option = el('option', { value }, value);
    if (value === item.severity) option.selected = true;
    severity.appendChild(option);
  });
  const section = el('input', { className: 'field-input', value: item.reportSection || '', placeholder: 'Report section or component' });
  const card = el('article', { className: 'library-admin-comment' });
  card.appendChild(el('div', { className: 'library-admin-comment-meta' }, [
    el('strong', null, pending ? 'Submitted by ' + (item.submittedBy || 'Inspector') : (item.approvedBy || 'InHaus Admin')),
    el('span', null, new Date(item.submittedAt || item.approvedAt || item.updatedAt || Date.now()).toLocaleString())
  ]));
  card.appendChild(field('Approved wording', text));
  card.appendChild(el('div', { className: 'library-admin-fields' }, [field('Finding type', severity), field('Report section', section)]));
  const actions = el('div', { className: 'library-admin-actions' });
  actions.appendChild(el('button', { className: 'btn btn-primary', onClick: async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await updateLibrary(pending ? 'approve' : 'update', item.commentId, text.value, severity.value, section.value);
      await loadLibrary();
    } catch (err) { setStatus(err.message, true); }
    finally { button.disabled = false; }
  } }, pending ? 'Approve for Inspectors' : 'Save Changes'));
  actions.appendChild(el('button', { className: 'btn btn-danger-outline', onClick: async () => {
    if (!confirm('Archive this comment so inspectors can no longer select it?')) return;
    await updateLibrary('archive', item.commentId, text.value, severity.value, section.value);
    await loadLibrary();
  } }, pending ? 'Reject' : 'Archive'));
  card.appendChild(actions);
  return card;
}

async function updateLibrary(command, commentId, cleanedText, severity, reportSection) {
  const result = await cloudFetch({
    action: 'commentLibraryAdmin',
    adminToken: tokenInput.value.trim(),
    command,
    commentId,
    cleanedText,
    severity,
    reportSection,
    approvedBy: 'InHaus Admin'
  });
  return result;
}

function render() {
  const candidates = Array.isArray(library.candidates) ? library.candidates : [];
  const comments = (Array.isArray(library.comments) ? library.comments : []).filter(item => item.status === 'approved');
  summary.innerHTML = '';
  summary.appendChild(el('div', null, [el('strong', null, candidates.length), el('span', null, 'Waiting') ]));
  summary.appendChild(el('div', null, [el('strong', null, comments.length), el('span', null, 'Approved') ]));
  candidateList.innerHTML = '';
  approvedList.innerHTML = '';
  if (!candidates.length) candidateList.appendChild(el('p', { className: 'text-muted' }, 'No comments are waiting for approval.'));
  else candidates.forEach(item => candidateList.appendChild(editor(item, true)));
  if (!comments.length) approvedList.appendChild(el('p', { className: 'text-muted' }, 'No company comments have been approved yet.'));
  else comments.forEach(item => approvedList.appendChild(editor(item, false)));
}

tokenInput.value = sessionStorage.getItem('inhaus_comment_admin_token') || '';
loadButton.addEventListener('click', loadLibrary);
tokenInput.addEventListener('keydown', event => { if (event.key === 'Enter') loadLibrary(); });
