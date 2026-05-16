// InHaus Inspector - UI Rendering Components
(function () {
  'use strict';

  // ── DOM Helper ─────────────────────────────────────────────
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null) continue;
      if (k === 'className') node.className = v;
      else if (k === 'onClick' && typeof v === 'function') {
        // iOS Safari requires onclick attribute on non-button elements for click events
        node.onclick = v;
      }
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    }
    if (children != null) {
      if (typeof children === 'string') node.textContent = children;
      else if (Array.isArray(children)) children.forEach(c => {
        if (c != null) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
      else node.appendChild(children);
    }
    return node;
  }

  function frag(children) {
    const f = document.createDocumentFragment();
    children.forEach(c => { if (c) f.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return f;
  }

  // ── Voice Dictation ────────────────────────────────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hasSpeech = !!SR;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function micBtn(onResult) {
    if (!hasSpeech) {
      if (isIOS) return el('button', {
        type: 'button', className: 'mic-hint-btn', 'aria-label': 'Use keyboard dictation',
        onClick: (e) => {
          e.preventDefault();
          const inp = e.target.closest('.input-row, .textarea-row');
          if (inp) {
            const field = inp.querySelector('input, textarea');
            if (field) field.focus();
          }
        }
      }, '\u2328\uFE0F');
      return null;
    }
    let rec = null, active = false;
    const btn = el('button', { type: 'button', className: 'mic-btn', 'aria-label': 'Voice input' }, '\uD83C\uDF99');
    btn.addEventListener('click', () => {
      if (active && rec) { rec.stop(); return; }
      rec = new SR();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';
      rec.onresult = e => { onResult(e.results[0][0].transcript); };
      rec.onend = () => { active = false; btn.classList.remove('recording'); };
      rec.onerror = () => { active = false; btn.classList.remove('recording'); };
      rec.start();
      active = true;
      btn.classList.add('recording');
    });
    return btn;
  }

  // ── Image Compression ─────────────────────────────────────
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const MAX = 1200;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; }
          }
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          let q = 0.65;
          let url = c.toDataURL('image/jpeg', q);
          while (url.length > 680000 && q > 0.25) { q -= 0.1; url = c.toDataURL('image/jpeg', q); }
          resolve(url);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Audio Alert ────────────────────────────────────────────
  function playAlert(prominent) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      function beep(freq, start, dur) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = freq; g.gain.value = prominent ? 0.5 : 0.25;
        o.start(ctx.currentTime + start);
        o.stop(ctx.currentTime + start + dur);
      }
      if (prominent) {
        // Prominent repeating alarm for 10-minute timers
        beep(880, 0, 0.2); beep(880, 0.3, 0.2); beep(1100, 0.6, 0.25);
        beep(880, 1.1, 0.2); beep(880, 1.4, 0.2); beep(1100, 1.7, 0.25);
        beep(880, 2.2, 0.2); beep(880, 2.5, 0.2); beep(1100, 2.8, 0.4);
      } else {
        beep(880, 0, 0.15); beep(880, 0.25, 0.15); beep(1100, 0.5, 0.3);
      }
    } catch (e) { /* no audio */ }
  }

  // ── Format helpers ─────────────────────────────────────────
  function fmtDate(iso) {
    if (!iso) return '--';
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDuration(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // ── Timer Component ────────────────────────────────────────
  function renderTimer(timerId, label, durationSec, inspection, onSave) {
    const container = el('div', { className: 'timer-box' });
    function build() {
      container.innerHTML = '';
      container.appendChild(el('div', { className: 'timer-label' }, label));
      if (!inspection.timers) inspection.timers = {};
      const t = inspection.timers[timerId];

      if (t && t.startedAt) {
        const endMs = new Date(t.startedAt).getTime() + t.durationMs;
        const display = el('div', { className: 'timer-display' });
        container.appendChild(display);

        function tick() {
          const rem = endMs - Date.now();
          if (rem <= 0) {
            display.textContent = '00:00 — COMPLETE';
            display.classList.add('timer-done');
            if (!t.alerted) { playAlert(durationSec === 600); if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]); t.alerted = true; onSave(); }
            return false;
          }
          const m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000);
          const h = Math.floor(rem / 3600000);
          if (h > 0) display.textContent = `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
          else display.textContent = `${m}:${String(s).padStart(2, '0')}`;
          return true;
        }
        tick();
        const iv = setInterval(() => { if (!tick() || !document.body.contains(display)) clearInterval(iv); }, 1000);

        container.appendChild(el('button', {
          type: 'button', className: 'btn btn-small btn-outline',
          onClick: () => { t.startedAt = new Date().toISOString(); t.alerted = false; onSave(); clearInterval(iv); build(); }
        }, 'Restart'));
      } else {
        container.appendChild(el('div', { className: 'timer-display timer-idle' }, fmtDuration(durationSec)));
        container.appendChild(el('button', {
          type: 'button', className: 'btn btn-primary',
          onClick: () => {
            inspection.timers[timerId] = { startedAt: new Date().toISOString(), durationMs: durationSec * 1000, label: label, alerted: false };
            onSave(); build();
          }
        }, 'Start Timer'));
      }
    }
    build();
    return container;
  }

  // ── Active Timers Bar (floating) ───────────────────────────
  function renderTimersBar(inspection) {
    if (!inspection || !inspection.timers) return null;
    const entries = Object.entries(inspection.timers).filter(([, t]) => t.startedAt);
    if (!entries.length) return null;

    const bar = el('div', { className: 'timers-bar' });
    entries.forEach(([id, t]) => {
      const endMs = new Date(t.startedAt).getTime() + (t.durationMs || 0);
      const pill = el('div', { className: 'timer-pill' });
      pill.appendChild(el('span', { className: 'timer-pill-label' }, t.label || id));
      const span = el('span', { className: 'timer-pill-time' });
      pill.appendChild(span);

      function tick() {
        const rem = endMs - Date.now();
        if (rem <= 0) { span.textContent = ' DONE'; pill.classList.add('timer-pill-done'); return false; }
        const m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000);
        const h = Math.floor(rem / 3600000);
        if (h > 0) span.textContent = ` ${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        else span.textContent = ` ${m}:${String(s).padStart(2, '0')}`;
        return true;
      }
      tick();
      const iv = setInterval(() => { if (!tick() || !document.body.contains(span)) clearInterval(iv); }, 1000);
      bar.appendChild(pill);
    });
    return bar;
  }

  // ── Field: Text Input ──────────────────────────────────────
  function renderText(key, label, value, onChange, opts) {
    opts = opts || {};
    const g = el('div', { className: 'field-group' });
    if (label) g.appendChild(el('label', { className: 'field-label' }, label));
    const row = el('div', { className: 'input-row' });
    const inp = el('input', {
      className: 'field-input', type: opts.inputType || 'text',
      value: value || '', placeholder: opts.placeholder || '',
      'data-field-key': key
    });
    if (opts.disabled) inp.disabled = true;
    inp.addEventListener('input', () => onChange(inp.value));
    row.appendChild(inp);
    const m = micBtn(txt => { inp.value = (inp.value ? inp.value + ' ' : '') + txt; onChange(inp.value); });
    if (m && !opts.disabled) row.appendChild(m);
    g.appendChild(row);
    if (opts.note) g.appendChild(el('div', { className: 'field-note' }, opts.note));
    return g;
  }

  // ── Field: Textarea ────────────────────────────────────────
  function renderTextarea(key, label, value, onChange, opts) {
    opts = opts || {};
    const g = el('div', { className: 'field-group' });
    if (label) g.appendChild(el('label', { className: 'field-label' }, label));
    const row = el('div', { className: 'input-row textarea-row' });
    const ta = el('textarea', {
      className: 'field-textarea', rows: opts.rows || '3',
      placeholder: opts.placeholder || '',
      'data-field-key': key
    });
    ta.value = value || '';
    ta.addEventListener('input', () => onChange(ta.value));
    row.appendChild(ta);
    const m = micBtn(txt => { ta.value = (ta.value ? ta.value + ' ' : '') + txt; onChange(ta.value); });
    if (m) row.appendChild(m);
    g.appendChild(row);
    return g;
  }

  // ── Field: Number ──────────────────────────────────────────
  function renderNumber(key, label, value, onChange, opts) {
    opts = opts || {};
    const g = el('div', { className: 'field-group' });
    if (label) g.appendChild(el('label', { className: 'field-label' }, label + (opts.unit ? ` (${opts.unit})` : '')));
    const row = el('div', { className: 'input-row' });
    const inp = el('input', {
      className: 'field-input', type: 'number', step: 'any', inputmode: 'decimal',
      value: value != null ? value : '', placeholder: opts.placeholder || 'Enter value',
      'data-field-key': key
    });
    inp.addEventListener('input', () => onChange(inp.value === '' ? null : parseFloat(inp.value)));
    row.appendChild(inp);
    g.appendChild(row);
    if (opts.note) g.appendChild(el('div', { className: 'field-note' }, opts.note));
    return g;
  }

  // ── Field: Date ────────────────────────────────────────────
  function renderDate(key, label, value, onChange) {
    const g = el('div', { className: 'field-group' });
    g.appendChild(el('label', { className: 'field-label' }, label));
    const inp = el('input', { className: 'field-input', type: 'date', value: value || '' });
    inp.addEventListener('change', () => onChange(inp.value));
    g.appendChild(inp);
    return g;
  }

  // ── Field: Select ──────────────────────────────────────────
  function renderSelect(key, label, value, onChange, choices) {
    const g = el('div', { className: 'field-group' });
    g.appendChild(el('label', { className: 'field-label' }, label));
    const sel = el('select', { className: 'field-select', 'data-field-key': key });
    sel.appendChild(el('option', { value: '' }, '-- Select --'));
    choices.forEach(c => {
      const opt = el('option', { value: typeof c === 'string' ? c : c.value }, typeof c === 'string' ? c : c.label);
      if ((typeof c === 'string' ? c : c.value) === value) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    g.appendChild(sel);
    return g;
  }

  // ── Field: Yes/No/NA Radio ─────────────────────────────────
  function renderYesNo(key, label, value, onChange, type) {
    const g = el('div', { className: 'field-group', 'data-yesno-key': key });
    g.appendChild(el('label', { className: 'field-label' }, label));
    const row = el('div', { className: 'radio-row' });
    let choices = [{ v: 'Yes', cls: 'radio-yes' }, { v: 'No', cls: 'radio-no' }];
    if (type === 'yesnona') choices.push({ v: 'N/A', cls: 'radio-na' });
    const btns = [];
    choices.forEach(c => {
      const btn = el('button', {
        type: 'button',
        className: 'radio-btn ' + c.cls + (value === c.v ? ' active' : ''),
        'data-yesno-val': c.v,
        onClick: () => {
          btns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          onChange(c.v);
        }
      }, c.v);
      btns.push(btn);
      row.appendChild(btn);
    });
    g.appendChild(row);
    return g;
  }

  // ── Field: Custom Radio ────────────────────────────────────
  function renderRadio(key, label, value, onChange, choices) {
    const g = el('div', { className: 'field-group' });
    g.appendChild(el('label', { className: 'field-label' }, label));
    const row = el('div', { className: 'radio-row' });
    const btns = [];
    choices.forEach(c => {
      const v = typeof c === 'string' ? c : c.value;
      const lbl = typeof c === 'string' ? c : c.label;
      const btn = el('button', {
        type: 'button',
        className: 'radio-btn' + (value === v ? ' active' : ''),
        onClick: () => {
          btns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          onChange(v);
        }
      }, lbl);
      btns.push(btn);
      row.appendChild(btn);
    });
    g.appendChild(row);
    return g;
  }

  // ── Field: Checkbox ────────────────────────────────────────
  function renderCheck(key, label, checked, onChange) {
    const box = el('div', { className: 'check-box' + (checked ? ' checked' : '') }, checked ? '\u2713' : '');
    let state = !!checked;
    const g = el('div', { className: 'check-item', onClick: () => {
      state = !state;
      box.className = 'check-box' + (state ? ' checked' : '');
      box.textContent = state ? '\u2713' : '';
      onChange(state);
    }});
    g.appendChild(box);
    g.appendChild(el('div', { className: 'check-label' }, label));
    return g;
  }

  // ── Field: Checklist ───────────────────────────────────────
  function renderChecklist(key, label, items, data, onChange, opts) {
    opts = opts || {};
    const g = el('div', { className: 'field-group checklist-group' });
    if (!data) data = {};

    function build() {
      g.innerHTML = '';
      if (label) {
        const headerRow = el('div', { className: 'checklist-header' });
        headerRow.appendChild(el('label', { className: 'field-label' }, label));
        const allChecked = items.every(item => {
          const ik = typeof item === 'string' ? item : item.key;
          return !!data[ik];
        });
        const toggleBtn = el('button', {
          type: 'button',
          className: 'btn-check-all' + (allChecked ? ' all-checked' : ''),
          onClick: (e) => {
            e.stopPropagation();
            const newState = !allChecked;
            items.forEach(item => {
              const ik = typeof item === 'string' ? item : item.key;
              data[ik] = newState;
            });
            onChange(data);
            build();
          }
        }, allChecked ? 'Uncheck all' : 'All packed \u2713');
        headerRow.appendChild(toggleBtn);
        g.appendChild(headerRow);
      }

      items.forEach(item => {
        const ik = typeof item === 'string' ? item : item.key;
        const il = typeof item === 'string' ? item : item.label;
        const optional = item.optional;
        const box = el('div', { className: 'check-box' + (data[ik] ? ' checked' : '') }, data[ik] ? '\u2713' : '');
        const row = el('div', {
          className: 'check-item' + (optional ? ' optional-item' : ''),
          onClick: () => {
            data[ik] = !data[ik];
            box.className = 'check-box' + (data[ik] ? ' checked' : '');
            box.textContent = data[ik] ? '\u2713' : '';
            onChange(data);
            // Update toggle button text
            const btn = g.querySelector('.btn-check-all');
            if (btn) {
              const nowAllChecked = items.every(it => {
                const k = typeof it === 'string' ? it : it.key;
                return !!data[k];
              });
              btn.textContent = nowAllChecked ? 'Uncheck all' : 'All packed \u2713';
              btn.classList.toggle('all-checked', nowAllChecked);
            }
          }
        });
        row.appendChild(box);
        row.appendChild(el('div', { className: 'check-label' }, il + (optional ? ' (if applicable)' : '')));
        g.appendChild(row);

        // Sub-fields for checklist items
        if (item.subFields && data[ik]) {
          item.subFields.forEach(sf => {
            const subVal = data[sf.key] || '';
            const sub = renderText(sf.key, sf.label, subVal, v => { data[sf.key] = v; onChange(data); }, sf);
            sub.classList.add('sub-field');
            g.appendChild(sub);
          });
        }
      });
    }
    build();
    return g;
  }

  // ── Field: Chips (multi-select tags) ───────────────────────
  function renderChips(key, label, options, selected, onChange) {
    selected = selected || [];
    const g = el('div', { className: 'field-group' });
    g.appendChild(el('label', { className: 'field-label' }, label));
    const row = el('div', { className: 'chips-row' });
    options.forEach(opt => {
      const btn = el('button', {
        type: 'button', className: 'chip' + (selected.includes(opt) ? ' active' : ''),
        onClick: () => {
          const idx = selected.indexOf(opt);
          if (idx >= 0) { selected.splice(idx, 1); btn.classList.remove('active'); }
          else { selected.push(opt); btn.classList.add('active'); }
          onChange(selected);
        }
      }, opt);
      row.appendChild(btn);
    });
    g.appendChild(row);
    return g;
  }

  // ── Field: Reading (value + status toggle) ─────────────────
  function renderReading(key, label, data, onChange, opts) {
    opts = opts || {};
    if (!data) data = { value: null, status: '', unit: opts.unit || '', timestamp: null };
    const g = el('div', { className: 'field-group reading-group' });

    function build() {
      g.innerHTML = '';
      g.appendChild(el('label', { className: 'field-label' }, label + (opts.unit ? ` (${opts.unit})` : '')));

      const toggle = el('div', { className: 'status-toggle' });
      [
        { s: 'measured', l: 'Measured' },
        { s: 'not_tested', l: 'Not Tested' },
        { s: 'not_applicable', l: 'N/A' }
      ].forEach(({ s, l }) => {
        toggle.appendChild(el('button', {
          type: 'button', className: 'status-btn ' + s + (data.status === s ? ' active' : ''),
          onClick: () => {
            data.status = s;
            if (s !== 'measured') data.value = null;
            data.timestamp = new Date().toISOString();
            data.unit = opts.unit || '';
            onChange(data);
            build();
          }
        }, l));
      });
      g.appendChild(toggle);

      if (data.status !== 'not_tested' && data.status !== 'not_applicable') {
        const row = el('div', { className: 'input-row' });
        const inp = el('input', {
          className: 'field-input reading-input', type: 'number', step: 'any', inputmode: 'decimal',
          value: data.value != null ? data.value : '', placeholder: 'Enter value'
        });
        inp.addEventListener('input', () => {
          data.value = inp.value === '' ? null : parseFloat(inp.value);
          data.status = 'measured';
          data.timestamp = new Date().toISOString();
          data.unit = opts.unit || '';
          onChange(data);
        });
        row.appendChild(inp);
        g.appendChild(row);
      }
    }
    build();
    return g;
  }

  // ── Field: Photo Capture ───────────────────────────────────
  function renderPhoto(photos, onUpdate, roomName, stepName) {
    if (!photos) photos = [];
    const section = el('div', { className: 'field-group photo-section' });
    section.appendChild(el('label', { className: 'field-label' }, 'Photos'));

    if (photos.length) {
      const grid = el('div', { className: 'photo-grid' });
      photos.forEach((p, idx) => {
        const card = el('div', { className: 'photo-card' });
        card.appendChild(el('img', { src: p.dataUrl, className: 'photo-img', alt: 'Photo ' + (idx + 1) }));
        card.appendChild(el('div', { className: 'photo-time' }, fmtDate(p.timestamp)));

        const capRow = el('div', { className: 'input-row' });
        const capInp = el('textarea', {
          className: 'field-input photo-caption-input', rows: '2',
          placeholder: 'Add caption...'
        });
        capInp.value = p.caption || '';
        capInp.style.cssText = 'resize:none;min-height:54px;font-size:0.9rem;line-height:1.4;padding:8px;';
        capInp.addEventListener('input', () => { p.caption = capInp.value; onUpdate(); });
        capRow.appendChild(capInp);
        const m = micBtn(txt => { capInp.value = (capInp.value ? capInp.value + ' ' : '') + txt; p.caption = capInp.value; onUpdate(); });
        if (m) capRow.appendChild(m);
        card.appendChild(capRow);

        card.appendChild(el('button', {
          type: 'button', className: 'photo-del-btn',
          onClick: () => {
            if (confirm('Delete this photo?')) {
              photos.splice(idx, 1);
              onUpdate();
              const newSection = renderPhoto(photos, onUpdate, roomName, stepName);
              section.replaceWith(newSection);
            }
          }
        }, '\u00d7'));
        grid.appendChild(card);
      });
      section.appendChild(grid);
    }

    async function handleFiles(files) {
      for (const file of Array.from(files)) {
        try {
          const dataUrl = await compressImage(file);
          const newPhoto = {
            photoId: 'p-' + Math.random().toString(36).substr(2, 9),
            roomName: roomName || '', stepName: stepName || '',
            timestamp: new Date().toISOString(), caption: '', dataUrl,
            _uploaded: false
          };
          photos.push(newPhoto);
          onUpdate();
          section.replaceWith(renderPhoto(photos, onUpdate, roomName, stepName));
          // ⚡ Upload immediately to Drive — don’t wait for export
          if (window.uploadPhotoImmediate && window.inspection && window.inspection.inspectionId) {
            window.uploadPhotoImmediate(
              newPhoto,
              window.inspection.inspectionId,
              window.inspection.clientName || '',
              window.inspection.propertyAddress || ''
            );
          }
        } catch (err) { console.error('Photo error:', err); }
      }
    }

    const fileInp = el('input', { type: 'file', accept: 'image/*', capture: 'environment', className: 'hidden' });
    fileInp.addEventListener('change', async e => { await handleFiles(e.target.files); });

    const libInp = el('input', { type: 'file', accept: 'image/*', multiple: 'true', className: 'hidden' });
    libInp.addEventListener('change', async e => { await handleFiles(e.target.files); });

    section.appendChild(fileInp);
    section.appendChild(libInp);
    const photoBtnRow = el('div', { className: 'photo-btn-row' });
    photoBtnRow.appendChild(el('button', { type: 'button', className: 'btn btn-secondary photo-add-btn', onClick: () => fileInp.click() }, '\uD83D\uDCF7 Add Photos'));
    photoBtnRow.appendChild(el('button', { type: 'button', className: 'btn btn-secondary photo-add-btn', onClick: () => libInp.click() }, '\uD83D\uDCC1 From Library'));
    section.appendChild(photoBtnRow);
    return section;
  }

  // ── Heading / Info ─────────────────────────────────────────
  function renderHeading(label) {
    const h = document.createElement('h3');
    h.className = 'section-heading collapsible-heading';
    h.innerHTML = label + ' <span class="collapse-arrow">&#9660;</span>';
    h.style = 'cursor:pointer;user-select:none;display:flex;justify-content:space-between;align-items:center;';
    h.onclick = () => {
      const isOpen = !h.classList.contains('collapsed');
      h.classList.toggle('collapsed', isOpen);
      let sib = h.nextElementSibling;
      while (sib && !sib.classList.contains('section-heading') && !sib.classList.contains('collapsible-heading')) {
        sib.style.display = isOpen ? 'none' : '';
        sib = sib.nextElementSibling;
      }
      const arrow = h.querySelector('.collapse-arrow');
      if (arrow) arrow.style.transform = isOpen ? 'rotate(-90deg)' : '';
    };
    return h;
  }
  function renderInfo(text) { return el('div', { className: 'field-info' }, text); }
  function renderDivider() { return el('hr', { className: 'divider' }); }

  // ── Field Dispatcher ───────────────────────────────────────
  function renderField(f, data, onChange, inspection, onSave) {
    if (f.showIf) {
      const dv = data[f.showIf.key];
      const target = f.showIf.value;
      const visible = Array.isArray(target) ? target.includes(dv) : dv === target;
      const fCopy = Object.assign({}, f);
      delete fCopy.showIf;
      const inner = renderField(fCopy, data, onChange, inspection, onSave);
      if (!inner) return null;
      const wrapper = document.createElement('div');
      wrapper.className = 'showif-wrapper' + (visible ? '' : ' showif-hidden');
      wrapper.setAttribute('data-showif-key', f.showIf.key);
      wrapper.setAttribute('data-showif-value', JSON.stringify(f.showIf.value));
      wrapper.appendChild(inner);
      return wrapper;
    }

    const changed = () => onChange();

    switch (f.type) {
      case 'weather-link': {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style = 'background:var(--primary);color:#fff;border:none;border-radius:8px;padding:10px 16px;font-size:0.95rem;cursor:pointer;font-family:inherit;font-weight:600;width:100%;margin:4px 0;touch-action:manipulation;';
        btn.textContent = '🌤 Open weather for current location';
        btn.onclick = () => {
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(pos => {
              const lat = pos.coords.latitude.toFixed(4);
              const lon = pos.coords.longitude.toFixed(4);
              window.open('https://forecast.weather.gov/MapClick.php?lat=' + lat + '&lon=' + lon, '_blank');
            }, () => {
              window.open('https://weather.com/weather/today', '_blank');
            });
          } else {
            window.open('https://weather.com/weather/today', '_blank');
          }
        };
        return btn;
      }
      case 'wifi-copy': {
        const panel = document.createElement('div');
        panel.style = 'background:#f0f7ff;border-radius:8px;padding:10px 12px;margin:4px 0 8px;';
        const wh2 = document.createElement('div');
        wh2.style = 'font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px;';
        wh2.textContent = 'QUICK COPY';
        panel.appendChild(wh2);
        const mkCopy = (lbl, val) => {
          if (!val) return;
          const row = document.createElement('div');
          row.style = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
          const sp = document.createElement('span');
          sp.style = 'font-size:13px;color:#1a1a1a;';
          sp.textContent = lbl + ': ' + val;
          const b = document.createElement('button');
          b.type = 'button';
          b.style = 'font-size:11px;padding:3px 10px;border:1px solid #bcd;border-radius:6px;background:#fff;cursor:pointer;';
          b.textContent = 'Copy';
          b.onclick = () => { navigator.clipboard.writeText(val).then(()=>{b.textContent='Copied!';setTimeout(()=>b.textContent='Copy',1500);}); };
          row.appendChild(sp); row.appendChild(b); panel.appendChild(row);
        };
        mkCopy('Network', data.wifiNetwork || (inspection && inspection.wifiNetwork));
        mkCopy('Password', data.wifiPassword || (inspection && inspection.wifiPassword));
        return panel;
      }
      case 'ai-hvac-scanner': {
        const apiKey = f.anthropicKey || '';
        const wrap = document.createElement('div');
        wrap.className = 'ai-hvac-scanner';

        // ── Anthropic API call ──────────────────────────────────
        async function callAnthropic(imageDataUrl, promptText) {
          if (!apiKey) throw new Error('NO_KEY');
          const base64 = imageDataUrl.split(',')[1];
          const mimeType = (imageDataUrl.split(';')[0].split(':')[1]) || 'image/jpeg';
          const resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
              'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
              model: 'claude-opus-4-5',
              max_tokens: 200,
              messages: [{ role: 'user', content: [
                { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
                { type: 'text', text: promptText }
              ]}]
            })
          });
          if (!resp.ok) throw new Error('API_ERROR ' + resp.status);
          const result = await resp.json();
          const text = result.content && result.content[0] && result.content[0].text;
          if (!text) throw new Error('EMPTY_RESPONSE');
          return JSON.parse(text);
        }

        // ── Field updater ───────────────────────────────────────
        function setFieldValue(key, value, card) {
          if (value === null || value === undefined) return;
          data[key] = value;
          if (!card) return;
          const inp = card.querySelector('[data-field-key="' + key + '"]');
          if (inp) {
            if (inp.tagName === 'SELECT') {
              const opts = Array.from(inp.options);
              const strVal = String(value).toLowerCase();
              const match = opts.find(o => o.value.toLowerCase() === strVal) ||
                            opts.find(o => o.value.toLowerCase().includes(strVal) || strVal.includes(o.value.toLowerCase()));
              if (match) { inp.value = match.value; inp.dispatchEvent(new Event('change', { bubbles: true })); }
            } else {
              inp.value = String(value);
              inp.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
          const yesnoGroup = card.querySelector('[data-yesno-key="' + key + '"]');
          if (yesnoGroup) {
            const strVal = String(value).toLowerCase();
            const target = (strVal === 'true' || strVal === 'yes') ? 'Yes' : 'No';
            const btn = yesnoGroup.querySelector('[data-yesno-val="' + target + '"]');
            if (btn) btn.click();
          }
        }

        // ── Recall warning banner ───────────────────────────────
        const recallBanner = document.createElement('div');
        recallBanner.className = 'ai-recall-banner';
        recallBanner.style.display = 'none';
        recallBanner.textContent = '⚠️ Possible recall notice visible — verify with manufacturer';

        // ── DATA TAG scanner ────────────────────────────────────
        const tagSection = document.createElement('div');
        tagSection.className = 'ai-scan-section';

        const tagInp = document.createElement('input');
        tagInp.type = 'file'; tagInp.accept = 'image/*'; tagInp.capture = 'environment'; tagInp.style = 'display:none;';

        const tagBtn = document.createElement('button');
        tagBtn.type = 'button';
        tagBtn.className = 'ai-scan-btn ai-scan-tag-btn';
        tagBtn.innerHTML = '📷 Scan HVAC Data Tag';

        const tagStatus = document.createElement('div');
        tagStatus.className = 'ai-scan-status';

        let tagPreview = null;

        tagInp.onchange = async e => {
          const file = e.target.files[0]; if (!file) return;
          tagInp.value = '';
          try {
            const dataUrl = await compressImage(file);
            data.hvacTagPhoto = { dataUrl, timestamp: new Date().toISOString() };
            onChange();
            if (!tagPreview) {
              tagPreview = document.createElement('img');
              tagPreview.className = 'ai-scan-preview';
              tagSection.insertBefore(tagPreview, tagBtn);
            }
            tagPreview.src = dataUrl;
            tagBtn.disabled = true;
            tagStatus.textContent = '⏳ Analyzing data tag…';
            tagStatus.className = 'ai-scan-status ai-scan-loading';
            const prompt = 'Analyze this HVAC equipment data tag. Extract and return JSON with: filterSize (e.g. "16x25x1"), mervRating (number or null), manufacturer (string or null), modelNumber (string or null), serialNumber (string or null). If any field is not visible or readable, use null. Return ONLY the JSON object, no other text.';
            const result = await callAnthropic(dataUrl, prompt);
            const card = wrap.closest('.card');
            if (result.filterSize) setFieldValue('filterSize', result.filterSize, card);
            if (result.mervRating != null) setFieldValue('mervRating', result.mervRating, card);
            if (result.manufacturer) setFieldValue('hvacManufacturer', result.manufacturer, card);
            if (result.modelNumber) setFieldValue('hvacModel', result.modelNumber, card);
            if (result.serialNumber) setFieldValue('hvacSerial', result.serialNumber, card);
            onChange();
            tagStatus.textContent = '✓ Data tag scanned';
            tagStatus.className = 'ai-scan-status ai-scan-success';
          } catch (err) {
            const isNoKey = err.message === 'NO_KEY';
            tagStatus.textContent = isNoKey
              ? 'AI scanning unavailable — please enter manually'
              : 'Could not read tag — please enter manually';
            tagStatus.className = 'ai-scan-status ai-scan-error';
          } finally {
            tagBtn.disabled = false;
          }
        };
        tagBtn.onclick = () => tagInp.click();
        tagSection.appendChild(tagInp);
        tagSection.appendChild(tagBtn);
        tagSection.appendChild(tagStatus);

        // ── FILTER scanner ──────────────────────────────────────
        const filterSection = document.createElement('div');
        filterSection.className = 'ai-scan-section';

        const filterInp = document.createElement('input');
        filterInp.type = 'file'; filterInp.accept = 'image/*'; filterInp.capture = 'environment'; filterInp.style = 'display:none;';

        const filterBtn = document.createElement('button');
        filterBtn.type = 'button';
        filterBtn.className = 'ai-scan-btn ai-scan-filter-btn';
        filterBtn.innerHTML = '📷 Scan Filter';

        const filterStatus = document.createElement('div');
        filterStatus.className = 'ai-scan-status';

        let filterPreview = null;

        filterInp.onchange = async e => {
          const file = e.target.files[0]; if (!file) return;
          filterInp.value = '';
          try {
            const dataUrl = await compressImage(file);
            data.hvacFilterPhoto = { dataUrl, timestamp: new Date().toISOString() };
            onChange();
            if (!filterPreview) {
              filterPreview = document.createElement('img');
              filterPreview.className = 'ai-scan-preview';
              filterSection.insertBefore(filterPreview, filterBtn);
            }
            filterPreview.src = dataUrl;
            filterBtn.disabled = true;
            filterStatus.textContent = '⏳ Analyzing filter…';
            filterStatus.className = 'ai-scan-status ai-scan-loading';
            const prompt = 'Analyze this HVAC filter photo. Extract and return JSON with: filterSize (e.g. "16x25x1" or null), mervRating (number or null), filterCondition (one of: "Clean", "Dirty", "Very Dirty", "Damaged"), estimatedAge (one of: "New", "Less than 6 months", "6-12 months", "Over 1 year"), visibleRecallNotice (true or false), notes (any relevant text visible on filter, or null). Return ONLY the JSON object, no other text.';
            const result = await callAnthropic(dataUrl, prompt);
            const card = wrap.closest('.card');
            if (result.filterSize) setFieldValue('filterSize', result.filterSize, card);
            if (result.mervRating != null) setFieldValue('mervRating', result.mervRating, card);
            if (result.filterCondition) setFieldValue('filterCondition', result.filterCondition, card);
            if (result.estimatedAge) setFieldValue('filterEstimatedAge', result.estimatedAge, card);
            if (result.notes) setFieldValue('filterNotes', result.notes, card);
            if (result.visibleRecallNotice) {
              setFieldValue('filterRecallFlag', 'Yes', card);
              recallBanner.style.display = 'block';
            }
            onChange();
            filterStatus.textContent = '✓ Filter scanned';
            filterStatus.className = 'ai-scan-status ai-scan-success';
          } catch (err) {
            const isNoKey = err.message === 'NO_KEY';
            filterStatus.textContent = isNoKey
              ? 'AI scanning unavailable — please enter manually'
              : 'Could not read filter — please enter manually';
            filterStatus.className = 'ai-scan-status ai-scan-error';
          } finally {
            filterBtn.disabled = false;
          }
        };
        filterBtn.onclick = () => filterInp.click();
        filterSection.appendChild(filterInp);
        filterSection.appendChild(filterBtn);
        filterSection.appendChild(filterStatus);

        wrap.appendChild(tagSection);
        wrap.appendChild(filterSection);
        wrap.appendChild(recallBanner);
        return wrap;
      }
      case 'collapsible-section': {
        const details = document.createElement('details');
        details.style = 'margin: 8px 0;';
        if (f.defaultOpen !== false) details.setAttribute('open', '');
        const summary = document.createElement('summary');
        summary.style = 'font-weight:700;font-size:1rem;color:var(--primary);cursor:pointer;padding:10px 0;list-style:none;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid var(--accent-light);';
        summary.innerHTML = f.title + ' <span style="font-size:0.8rem;color:var(--text-muted)">▾</span>';
        details.appendChild(summary);
        const inner = document.createElement('div');
        inner.style = 'padding-top:8px;';
        (f.fields || []).forEach(sf => {
          const rendered = renderField(sf, data, onChange, inspection, onSave);
          if (rendered) inner.appendChild(rendered);
        });
        details.appendChild(inner);
        return details;
      }
      case 'heading': return renderHeading(f.label);
      case 'info': return renderInfo(f.label);
      case 'divider': return renderDivider();
      case 'link': {
        const div = el('div', { className: 'field-row', style: 'padding:8px 0' });
        div.innerHTML = `<a href="${f.url}" target="_blank" rel="noopener" style="color:#1a73e8;text-decoration:underline;font-size:1rem;">${f.label}</a>`;
        return div;
      }
      case 'text': return renderText(f.key, f.label, data[f.key], v => { data[f.key] = v; changed(); }, f);
      case 'textarea': return renderTextarea(f.key, f.label, data[f.key], v => { data[f.key] = v; changed(); }, f);
      case 'number': return renderNumber(f.key, f.label, data[f.key], v => { data[f.key] = v; changed(); }, f);
      case 'date': return renderDate(f.key, f.label, data[f.key], v => { data[f.key] = v; changed(); });
      case 'select': return renderSelect(f.key, f.label, data[f.key], v => { data[f.key] = v; changed(); }, f.choices);
      case 'yesno': return renderYesNo(f.key, f.label, data[f.key], v => { data[f.key] = v; changed(); }, 'yesno');
      case 'yesnona': return renderYesNo(f.key, f.label, data[f.key], v => { data[f.key] = v; changed(); }, 'yesnona');
      case 'radio': return renderRadio(f.key, f.label, data[f.key], v => { data[f.key] = v; changed(); }, f.choices);
      case 'check': return renderCheck(f.key, f.label, !!data[f.key], v => { data[f.key] = v; changed(); });
      case 'checklist':
        if (!data[f.key]) data[f.key] = {};
        return renderChecklist(f.key, f.label, f.items, data[f.key], v => { data[f.key] = v; changed(); }, f);
      case 'chips':
        return renderChips(f.key, f.label, f.options, data[f.key] || [], v => { data[f.key] = v; changed(); });
      case 'reading':
        if (!data[f.key]) data[f.key] = { value: null, status: '', unit: f.unit || '', timestamp: null };
        return renderReading(f.key, f.label, data[f.key], v => { data[f.key] = v; changed(); }, f);
      case 'photo': {
        const pk = f.photoKey || '_photos';
        if (!data[pk]) data[pk] = [];
        return renderPhoto(data[pk], () => { changed(); }, data.roomName || data._roomName || '', f.stepName || '');
      }
      case 'timer':
        return renderTimer(f.timerId || (f.key + '-' + (data._stepId || '')), f.label, f.duration, inspection, onSave);
      case 'qtrak-upload': {
        const qWrap = document.createElement('div');
        qWrap.className = 'field-group';
        const qFileId = 'qtrak-upload-' + Math.random().toString(36).substr(2, 6);
        const qFileInp = document.createElement('input');
        qFileInp.type = 'file';
        qFileInp.accept = '.csv,.xlsx';
        qFileInp.id = qFileId;
        qFileInp.style = 'display:none;';
        const qExisting = inspection && inspection.qtrakUpload;
        const qLabel = document.createElement('label');
        qLabel.htmlFor = qFileId;
        qLabel.style = [
          'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
          'border:2px dashed #2C3F16', 'border-radius:12px', 'padding:24px 16px',
          'cursor:pointer', 'background:#f0f7ee', 'gap:8px', 'text-align:center',
          'width:100%', 'box-sizing:border-box', 'margin:4px 0'
        ].join(';');
        function qUpdateLabel(filename) {
          if (filename) {
            qLabel.innerHTML = '<span style="font-size:1.8rem">\u2705</span>' +
              '<span style="font-weight:700;color:#166534;font-size:0.95rem">' +
              '\u2713 ' + filename + ' loaded</span>' +
              '<span style="font-size:11px;color:#64748b">Tap to replace</span>';
          } else {
            qLabel.innerHTML = '<span style="font-size:1.8rem">\u2601\uFE0F</span>' +
              '<span style="font-weight:700;color:#2C3F16;font-size:0.95rem">Tap to upload Q-Trak file</span>' +
              '<span style="font-size:11px;color:#64748b">.csv or .xlsx accepted</span>';
          }
        }
        qUpdateLabel(qExisting && qExisting.filename);
        qFileInp.onchange = function(e) {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function(ev) {
            if (inspection) {
              inspection.qtrakUpload = {
                filename: file.name,
                content: ev.target.result,
                uploadedAt: new Date().toISOString()
              };
            }
            qUpdateLabel(file.name);
            onChange();
          };
          if (file.name.toLowerCase().endsWith('.csv')) {
            reader.readAsText(file);
          } else {
            reader.readAsDataURL(file);
          }
        };
        qWrap.appendChild(qFileInp);
        qWrap.appendChild(qLabel);
        return qWrap;
      }
      default: return null;
    }
  }

  // ── Progress Bar ───────────────────────────────────────────
  function renderProgressBar(phases, currentPhaseId, stepName, onPhaseClick, stepNumber, totalSteps) {
    const bar = el('div', { className: 'progress-bar' });
    phases.forEach(p => {
      const isCurrent = p.id === currentPhaseId;
      // Free navigation — all phases are tappable (v60)
      const dot = el('div', {
        className: 'phase-dot' + (isCurrent ? ' active' : '') + (p.done ? ' done' : ''),
        onClick: () => onPhaseClick(p.id)
      }, [
        el('div', { className: 'phase-circle' }, p.done ? '\u2713' : p.icon || ''),
        el('div', { className: 'phase-name' }, p.name)
      ]);
      bar.appendChild(dot);
    });
    const nameBarChildren = [];
    if (stepNumber != null && totalSteps != null) {
      nameBarChildren.push(el('div', { className: 'step-counter' }, 'Step ' + stepNumber + ' of ' + totalSteps));
    }
    nameBarChildren.push(el('span', null, stepName || ''));
    const nameBar = el('div', { className: 'step-name-bar' }, nameBarChildren);
    const wrapper = el('div', { className: 'progress-wrapper' }, [bar, nameBar]);
    return wrapper;
  }

  // ── Status Bar (save + online + clock) ──────────────────────
  function renderStatusBar(saveText) {
    function fmtClock() {
      const n = new Date();
      let h = n.getHours(), m = n.getMinutes();
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return h + ':' + String(m).padStart(2, '0') + ' ' + ampm;
    }
    const clockEl = el('span', { className: 'status-clock', id: 'step-clock' }, fmtClock());
    const iv = setInterval(() => {
      if (!document.body.contains(clockEl)) { clearInterval(iv); return; }
      clockEl.textContent = fmtClock();
    }, 60000);
    return el('div', { className: 'status-bar' }, [
      el('span', { className: 'save-status', id: 'save-status' }, saveText || ''),
      clockEl,
      el('span', { className: 'online-badge ' + (navigator.onLine ? 'online' : 'offline') }, navigator.onLine ? '' : '● Offline')
    ]);
  }

  // ── Toast ──────────────────────────────────────────────────
  function showToast(msg, durationMs) {
    const existing = document.getElementById('ui-toast');
    if (existing) existing.remove();
    const toast = el('div', { id: 'ui-toast', className: 'toast' }, msg);
    document.body.appendChild(toast);
    setTimeout(() => { toast.classList.add('toast-visible'); }, 10);
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 300);
    }, durationMs || 2500);
  }

  // ── Validation Flash ──────────────────────────────────────
  function flashUncheckedItems(container) {
    const items = container.querySelectorAll('.check-item:not(.optional-item)');
    items.forEach(row => {
      const box = row.querySelector('.check-box');
      if (box && !box.classList.contains('checked')) {
        row.classList.add('validation-flash');
        setTimeout(() => row.classList.remove('validation-flash'), 1500);
      }
    });
  }

  // ── ShowIf Real-time Update ───────────────────────────────
  function updateShowIf(container, data) {
    container.querySelectorAll('.showif-wrapper').forEach(function(w) {
      const key = w.getAttribute('data-showif-key');
      const rawValue = w.getAttribute('data-showif-value');
      var target;
      try { target = JSON.parse(rawValue); } catch(e) { target = rawValue; }
      const dv = data[key];
      const visible = Array.isArray(target) ? target.includes(dv) : dv === target;
      w.classList.toggle('showif-hidden', !visible);
    });
  }

  // ── Export ─────────────────────────────────────────────────
  window.UI = {
    el, frag, renderField, renderProgressBar, renderStatusBar, renderTimersBar,
    renderText, renderTextarea, renderNumber, renderSelect, renderYesNo, renderRadio,
    renderCheck, renderChecklist, renderChips, renderReading, renderPhoto, renderTimer,
    renderHeading, renderInfo, renderDivider, compressImage, playAlert, fmtDate, fmtDuration,
    micBtn, showToast, flashUncheckedItems, updateShowIf
  };
})();
