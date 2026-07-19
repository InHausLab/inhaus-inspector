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

  function lazyImage(src, className, alt) {
    const img = el('img', {
      className: className || '',
      alt: alt || '',
      loading: 'lazy',
      decoding: 'async'
    });
    img.dataset.src = src;

    const load = () => {
      if (img.dataset.loaded) return;
      img.dataset.loaded = 'true';
      requestAnimationFrame(() => {
        fetch(src)
          .then(r => r.blob())
          .then(blob => {
            const objectUrl = URL.createObjectURL(blob);
            img.src = objectUrl;
            img.onload = () => URL.revokeObjectURL(objectUrl);
          })
          .catch(() => { img.src = src; });
      });
    };

    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          io.unobserve(img);
          load();
        });
      }, { rootMargin: '250px 0px' });
      io.observe(img);
    } else {
      requestAnimationFrame(load);
    }

    return img;
  }

  // ── Voice Dictation ────────────────────────────────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const hasSpeech = !!SR;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // ── Voice dictation confirmation overlay ────────────────────────
  function showDictationConfirm(transcript, onAccept, onRedo) {
    const existing = document.getElementById('dictation-confirm');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'dictation-confirm';
    overlay.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#1a2710;color:#fff;z-index:9999;padding:16px 16px calc(env(safe-area-inset-bottom)+16px);box-shadow:0 -4px 20px rgba(0,0,0,0.4);';
    const label = document.createElement('div');
    label.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;color:#9cc47a;margin-bottom:8px;letter-spacing:0.05em;';
    label.textContent = '\ud83c\udf99 Voice result — review before saving';
    const text = document.createElement('div');
    text.style.cssText = 'font-size:1rem;line-height:1.5;background:#2c3f16;padding:10px 12px;border-radius:8px;margin-bottom:12px;word-break:break-word;';
    text.textContent = transcript;
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;';
    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.style.cssText = 'flex:1;background:#4a7c28;color:#fff;border:none;border-radius:8px;padding:12px;font-size:1rem;font-weight:700;cursor:pointer;touch-action:manipulation;';
    useBtn.textContent = '\u2713 Use This';
    useBtn.onclick = () => { overlay.remove(); onAccept(transcript); };
    const redoBtn = document.createElement('button');
    redoBtn.type = 'button';
    redoBtn.style.cssText = 'flex:1;background:#5a1d1d;color:#fff;border:none;border-radius:8px;padding:12px;font-size:1rem;font-weight:700;cursor:pointer;touch-action:manipulation;';
    redoBtn.textContent = '\u21ba Redo';
    redoBtn.onclick = () => { overlay.remove(); if (onRedo) onRedo(); };
    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.style.cssText = 'background:transparent;color:#9ca3af;border:1px solid #4b5563;border-radius:8px;padding:12px 16px;font-size:0.9rem;cursor:pointer;touch-action:manipulation;';
    discardBtn.textContent = '\u00d7';
    discardBtn.onclick = () => overlay.remove();
    btnRow.appendChild(useBtn);
    btnRow.appendChild(redoBtn);
    btnRow.appendChild(discardBtn);
    overlay.appendChild(label);
    overlay.appendChild(text);
    overlay.appendChild(btnRow);
    document.body.appendChild(overlay);
  }

  function micBtn(onResult) {
    if (!hasSpeech) {
      if (isIOS) {
        // On iOS: no native SR — prompt to use keyboard mic
        const wrap = document.createElement('span');
        const hint = el('button', {
          type: 'button', className: 'mic-hint-btn', 'aria-label': 'Voice input: use mic in your keyboard',
          title: 'Tap the 🎙 mic key in your iPhone keyboard for voice input',
          onClick: (e) => {
            e.preventDefault();
            showToast('Tap the \ud83c\udf99 mic in your iPhone keyboard to dictate \u2014 read back and fix before saving', 4000);
            const inp = e.target.closest('.input-row, .textarea-row');
            if (inp) { const field = inp.querySelector('input, textarea'); if (field) field.focus(); }
          }
        }, '\ud83c\udf99');
        wrap.appendChild(hint);
        return wrap;
      }
      return null;
    }
    let rec = null, active = false;
    const btn = el('button', { type: 'button', className: 'mic-btn', 'aria-label': 'Voice input' }, '\uD83C\uDF99');
    function startRecording() {
      rec = new SR();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';
      rec.onresult = e => {
        const transcript = e.results[0][0].transcript;
        active = false;
        btn.classList.remove('recording');
        // Show confirmation before committing
        showDictationConfirm(
          transcript,
          (accepted) => { onResult(accepted); },
          () => { startRecording(); } // redo: restart recording
        );
      };
      rec.onend = () => { active = false; btn.classList.remove('recording'); };
      rec.onerror = () => { active = false; btn.classList.remove('recording'); };
      rec.start();
      active = true;
      btn.classList.add('recording');
    }
    btn.addEventListener('click', () => {
      if (active && rec) { rec.stop(); return; }
      startRecording();
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

  function imageVariant(dataUrl, maxSize, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', quality || 0.65));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  function getInspectionIdForPhoto(fallbackId) {
    return fallbackId || (window.inspection && window.inspection.inspectionId) || '';
  }

  async function savePhotoRecordToVault(photo, inspectionId) {
    if (!photo || !photo.photoId || !photo.dataUrl || photo.dataUrl === '__uploaded__') return false;
    if (!window.DB || !window.DB.savePhoto) return false;
    const targetInspectionId = getInspectionIdForPhoto(inspectionId);
    if (!targetInspectionId) return false;
    try {
      const thumbnailDataUrl = photo.thumbnailDataUrl || await imageVariant(photo.dataUrl, 420, 0.62);
      photo.thumbnailDataUrl = thumbnailDataUrl;
      await window.DB.savePhoto({
        photoId: photo.photoId,
        inspectionId: targetInspectionId,
        roomName: photo.roomName || '',
        stepName: photo.stepName || '',
        caption: photo.caption || '',
        placementSource: photo.placementSource || '',
        routingStatus: photo.routingStatus || '',
        timestamp: photo.timestamp || new Date().toISOString(),
        dataUrl: photo.dataUrl,
        thumbnailDataUrl: thumbnailDataUrl,
        driveUrl: photo.driveUrl || '',
        driveId: photo.driveId || '',
        uploadState: photo.driveUrl || photo.driveId ? 'uploaded' : 'local'
      });
      photo._vaultSaved = true;
      photo._vaultSavedAt = new Date().toISOString();
      return true;
    } catch (err) {
      console.warn('Photo vault save failed:', err);
      photo._vaultSaved = false;
      photo._vaultError = err && err.message ? err.message : String(err);
      return false;
    }
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
  function fmtDateOnly(iso) {
    if (!iso) return '--';
    const d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
  }

  function fmtTimeOnly(iso) {
    if (!iso) return '--';
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver', timeZoneName: 'short' });
  }

  function fmtDate(iso) {
    if (!iso) return '--';
    return fmtDateOnly(iso) + ' ' + fmtTimeOnly(iso);
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
            display.textContent = '00:00 - COMPLETE';
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

  // ── Photo Annotation Editor ────────────────────────────────
  function openAnnotationEditor(photo, onSave) {
    var COLORS = { red: '#FF3B30', yellow: '#FFCC00', white: '#FFFFFF', black: '#000000' };
    var srcUrl = photo.originalDataUrl || photo.dataUrl;
    var annotations = (photo.annotations && photo.annotations.length)
      ? JSON.parse(JSON.stringify(photo.annotations))
      : [];
    var activeTool = 'circle';
    var activeColor = 'red';
    var selectedId = null;
    var dragState = null;
    var svgW = 1, svgH = 1;

    // ── Build DOM ──────────────────────────────────────────────
    var overlay = document.createElement('div');
    overlay.className = 'annot-overlay';
    overlay.id = 'annotation-overlay';

    var header = document.createElement('div');
    header.className = 'annot-header';
    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'annot-btn annot-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = function() { document.removeEventListener('keydown', keyHandler); overlay.remove(); };
    var titleEl = document.createElement('span');
    titleEl.className = 'annot-title';
    titleEl.textContent = 'Annotate Photo';
    var doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'annot-btn annot-done';
    doneBtn.textContent = 'Done';
    doneBtn.onclick = function() { saveAnnotation(); };
    header.appendChild(cancelBtn);
    header.appendChild(titleEl);
    header.appendChild(doneBtn);

    var toolbar = document.createElement('div');
    toolbar.className = 'annot-toolbar';
    var toolsRow = document.createElement('div');
    toolsRow.className = 'annot-tools';
    var circleBtn = document.createElement('button');
    circleBtn.type = 'button';
    circleBtn.className = 'annot-tool active';
    circleBtn.textContent = '\u25cb  Circle';
    circleBtn.onclick = function() { activeTool = 'circle'; circleBtn.classList.add('active'); arrowBtn.classList.remove('active'); };
    var arrowBtn = document.createElement('button');
    arrowBtn.type = 'button';
    arrowBtn.className = 'annot-tool';
    arrowBtn.textContent = '\u2192  Arrow';
    arrowBtn.onclick = function() { activeTool = 'arrow'; arrowBtn.classList.add('active'); circleBtn.classList.remove('active'); };
    toolsRow.appendChild(circleBtn);
    toolsRow.appendChild(arrowBtn);
    var colorRow = document.createElement('div');
    colorRow.className = 'annot-colors';
    ['red','yellow','white','black'].forEach(function(name) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'annot-color' + (name === 'red' ? ' selected' : '');
      dot.style.background = COLORS[name];
      if (name === 'white') dot.style.border = '2px solid #999';
      dot.title = name;
      dot.onclick = function() {
        activeColor = name;
        colorRow.querySelectorAll('.annot-color').forEach(function(d) { d.classList.remove('selected'); });
        dot.classList.add('selected');
      };
      colorRow.appendChild(dot);
    });
    toolbar.appendChild(toolsRow);
    toolbar.appendChild(colorRow);

    var canvasArea = document.createElement('div');
    canvasArea.className = 'annot-canvas-area';
    var photoImg = document.createElement('img');
    photoImg.className = 'annot-photo';
    photoImg.src = srcUrl;
    photoImg.draggable = false;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.style.cssText = 'position:absolute;cursor:crosshair;touch-action:none;';
    canvasArea.appendChild(photoImg);
    canvasArea.appendChild(svg);

    var bottomBar = document.createElement('div');
    bottomBar.className = 'annot-bottom';
    var undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'annot-action-btn';
    undoBtn.textContent = '\u21a9 Undo';
    undoBtn.onclick = function() {
      if (annotations.length) { annotations.pop(); selectedId = null; renderAnnot(); }
    };
    var instrEl = document.createElement('span');
    instrEl.className = 'annot-instructions';
    instrEl.textContent = 'Tap to place \u2022 Drag handles to resize';
    var clearAllBtn = document.createElement('button');
    clearAllBtn.type = 'button';
    clearAllBtn.className = 'annot-action-btn';
    clearAllBtn.textContent = '\u2715 Clear All';
    clearAllBtn.onclick = function() {
      if (!annotations.length) return;
      if (confirm('Remove all annotations?')) { annotations = []; selectedId = null; renderAnnot(); }
    };
    bottomBar.appendChild(undoBtn);
    bottomBar.appendChild(instrEl);
    bottomBar.appendChild(clearAllBtn);

    overlay.appendChild(header);
    overlay.appendChild(toolbar);
    overlay.appendChild(canvasArea);
    overlay.appendChild(bottomBar);
    document.body.appendChild(overlay);

    // ── SVG Layout ─────────────────────────────────────────────
    function layoutSvg() {
      if (!svgW || !svgH) return;
      var r = canvasArea.getBoundingClientRect();
      var aW = r.width, aH = r.height;
      if (!aW || !aH) return;
      var imgAR = svgW / svgH, areaAR = aW / aH;
      var dW, dH;
      if (imgAR > areaAR) { dW = aW; dH = aW / imgAR; }
      else { dH = aH; dW = aH * imgAR; }
      var oX = (aW - dW) / 2, oY = (aH - dH) / 2;
      svg.style.width = dW + 'px';
      svg.style.height = dH + 'px';
      svg.style.left = oX + 'px';
      svg.style.top = oY + 'px';
    }

    function init() {
      svgW = photoImg.naturalWidth || 1200;
      svgH = photoImg.naturalHeight || 900;
      svg.setAttribute('viewBox', '0 0 ' + svgW + ' ' + svgH);
      requestAnimationFrame(function() { layoutSvg(); renderAnnot(); });
    }

    photoImg.onload = init;
    if (photoImg.complete && photoImg.naturalWidth) init();

    // ── Coordinate Conversion ─────────────────────────────────
    function svgPt(clientX, clientY) {
      var r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return { x: 0, y: 0 };
      return { x: (clientX - r.left) / r.width * svgW, y: (clientY - r.top) / r.height * svgH };
    }

    function genId() { return 'a' + Math.random().toString(36).substr(2, 8); }

    function getHandles(a) {
      if (a.type === 'circle') return [
        {x: a.cx, y: a.cy - a.r}, {x: a.cx, y: a.cy + a.r},
        {x: a.cx - a.r, y: a.cy}, {x: a.cx + a.r, y: a.cy}
      ];
      if (a.type === 'arrow') return [{x: a.x1, y: a.y1}, {x: a.x2, y: a.y2}];
      return [];
    }

    var HANDLE_HIT = 28;

    function findHandle(pt) {
      if (!selectedId) return null;
      var a = null;
      for (var i = 0; i < annotations.length; i++) { if (annotations[i].id === selectedId) { a = annotations[i]; break; } }
      if (!a) return null;
      var handles = getHandles(a);
      for (var j = 0; j < handles.length; j++) {
        if (Math.hypot(pt.x - handles[j].x, pt.y - handles[j].y) < HANDLE_HIT) return j;
      }
      return null;
    }

    function findAnnot(pt) {
      for (var i = annotations.length - 1; i >= 0; i--) {
        var a = annotations[i];
        if (a.type === 'circle') {
          if (Math.hypot(pt.x - a.cx, pt.y - a.cy) <= a.r + 20) return a;
        } else if (a.type === 'arrow') {
          var dx = a.x2 - a.x1, dy = a.y2 - a.y1;
          var len = Math.hypot(dx, dy);
          if (len < 1) continue;
          var t = Math.max(0, Math.min(1, ((pt.x - a.x1) * dx + (pt.y - a.y1) * dy) / (len * len)));
          var cx = a.x1 + t * dx, cy = a.y1 + t * dy;
          if (Math.hypot(pt.x - cx, pt.y - cy) < 20) return a;
        }
      }
      return null;
    }

    // ── Render Annotations ────────────────────────────────────
    function appendDeleteBtn(x, y, annotId) {
      var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-delete-id', annotId);
      g.style.cursor = 'pointer';
      var circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circ.setAttribute('cx', x); circ.setAttribute('cy', y); circ.setAttribute('r', 20);
      circ.setAttribute('fill', '#dc2626');
      var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txt.setAttribute('x', x); txt.setAttribute('y', String(parseFloat(y) + 7));
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('fill', 'white'); txt.setAttribute('font-size', '22');
      txt.setAttribute('font-weight', 'bold'); txt.setAttribute('pointer-events', 'none');
      txt.textContent = '\u00d7';
      g.appendChild(circ); g.appendChild(txt);
      svg.appendChild(g);
    }

    function renderAnnot() {
      svg.innerHTML = '';
      annotations.forEach(function(a) {
        var isSel = a.id === selectedId;
        var color = COLORS[a.color] || '#FF3B30';
        var sw = isSel ? 4 : 3;

        if (a.type === 'circle') {
          var circ = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circ.setAttribute('cx', a.cx); circ.setAttribute('cy', a.cy); circ.setAttribute('r', a.r);
          circ.setAttribute('fill', 'none'); circ.setAttribute('stroke', color); circ.setAttribute('stroke-width', sw);
          svg.appendChild(circ);
          if (isSel) {
            getHandles(a).forEach(function(h) {
              var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
              rect.setAttribute('x', h.x - 12); rect.setAttribute('y', h.y - 12);
              rect.setAttribute('width', 24); rect.setAttribute('height', 24);
              rect.setAttribute('fill', 'white'); rect.setAttribute('stroke', '#333'); rect.setAttribute('stroke-width', 2);
              rect.setAttribute('rx', 3);
              svg.appendChild(rect);
            });
            var dAngle = -Math.PI / 4;
            appendDeleteBtn(
              a.cx + (a.r + 22) * Math.cos(dAngle),
              a.cy + (a.r + 22) * Math.sin(dAngle),
              a.id
            );
          }

        } else if (a.type === 'arrow') {
          var dx = a.x2 - a.x1, dy = a.y2 - a.y1;
          var len = Math.hypot(dx, dy);
          var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', a.x1); line.setAttribute('y1', a.y1);
          line.setAttribute('x2', a.x2); line.setAttribute('y2', a.y2);
          line.setAttribute('stroke', color); line.setAttribute('stroke-width', sw);
          svg.appendChild(line);
          if (len > 1) {
            var arrowSz = Math.max(20, Math.min(30, svgW * 0.025));
            var ux = dx / len, uy = dy / len;
            var px = -uy, py = ux;
            var pts = [
              a.x2 + ',' + a.y2,
              (a.x2 - ux * arrowSz + px * arrowSz * 0.4) + ',' + (a.y2 - uy * arrowSz + py * arrowSz * 0.4),
              (a.x2 - ux * arrowSz - px * arrowSz * 0.4) + ',' + (a.y2 - uy * arrowSz - py * arrowSz * 0.4)
            ].join(' ');
            var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', pts); poly.setAttribute('fill', color);
            svg.appendChild(poly);
          }
          if (isSel) {
            getHandles(a).forEach(function(h) {
              var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
              rect.setAttribute('x', h.x - 12); rect.setAttribute('y', h.y - 12);
              rect.setAttribute('width', 24); rect.setAttribute('height', 24);
              rect.setAttribute('fill', 'white'); rect.setAttribute('stroke', '#333'); rect.setAttribute('stroke-width', 2);
              rect.setAttribute('rx', 3);
              svg.appendChild(rect);
            });
            appendDeleteBtn(a.x2 + 28, a.y2 - 28, a.id);
          }
        }
      });
    }

    // ── Pointer Events ────────────────────────────────────────
    svg.addEventListener('pointerdown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      svg.setPointerCapture(e.pointerId);
      var pt = svgPt(e.clientX, e.clientY);

      // Check delete button
      var el2 = e.target;
      while (el2 && el2 !== svg) {
        var delId = el2.getAttribute('data-delete-id');
        if (delId) {
          annotations = annotations.filter(function(a) { return a.id !== delId; });
          selectedId = null; renderAnnot(); return;
        }
        el2 = el2.parentElement;
      }

      // Check handle on selected annotation
      var handleIdx = findHandle(pt);
      if (handleIdx !== null) {
        var selAnnot = null;
        for (var i = 0; i < annotations.length; i++) { if (annotations[i].id === selectedId) { selAnnot = annotations[i]; break; } }
        if (selAnnot) {
          dragState = { type: 'handle', annotId: selectedId, hi: handleIdx, sx: pt.x, sy: pt.y, orig: JSON.parse(JSON.stringify(selAnnot)) };
          return;
        }
      }

      // Check body hit
      var hit = findAnnot(pt);
      if (hit) {
        selectedId = hit.id;
        dragState = { type: 'body', annotId: hit.id, sx: pt.x, sy: pt.y, orig: JSON.parse(JSON.stringify(hit)) };
        renderAnnot(); return;
      }

      // Place new annotation
      selectedId = null;
      var color = activeColor;
      if (activeTool === 'circle') {
        var defR = Math.max(30, Math.min(80, svgW * 0.04));
        var newA = { type: 'circle', id: genId(), cx: pt.x, cy: pt.y, r: defR, color: color };
        annotations.push(newA); selectedId = newA.id;
      } else {
        var cX = svgW / 2, cY = svgH / 2;
        var ddx = cX - pt.x, ddy = cY - pt.y;
        var dist = Math.hypot(ddx, ddy) || 1;
        var arrowLen = Math.max(60, Math.min(svgW * 0.12, 150));
        var newArr = { type: 'arrow', id: genId(), x1: pt.x, y1: pt.y, x2: pt.x + ddx / dist * arrowLen, y2: pt.y + ddy / dist * arrowLen, color: color };
        annotations.push(newArr); selectedId = newArr.id;
      }
      renderAnnot();
    });

    svg.addEventListener('pointermove', function(e) {
      if (!dragState) return;
      e.preventDefault();
      var pt = svgPt(e.clientX, e.clientY);
      var a = null;
      for (var i = 0; i < annotations.length; i++) { if (annotations[i].id === dragState.annotId) { a = annotations[i]; break; } }
      if (!a) return;
      var o = dragState.orig;
      var dx = pt.x - dragState.sx, dy = pt.y - dragState.sy;

      if (dragState.type === 'body') {
        if (a.type === 'circle') { a.cx = o.cx + dx; a.cy = o.cy + dy; }
        else if (a.type === 'arrow') { a.x1 = o.x1 + dx; a.y1 = o.y1 + dy; a.x2 = o.x2 + dx; a.y2 = o.y2 + dy; }
      } else if (dragState.type === 'handle') {
        if (a.type === 'circle') {
          var hi = dragState.hi;
          if (hi === 0) a.r = Math.max(10, o.cy - pt.y);
          else if (hi === 1) a.r = Math.max(10, pt.y - o.cy);
          else if (hi === 2) a.r = Math.max(10, o.cx - pt.x);
          else if (hi === 3) a.r = Math.max(10, pt.x - o.cx);
        } else if (a.type === 'arrow') {
          if (dragState.hi === 0) { a.x1 = pt.x; a.y1 = pt.y; }
          else { a.x2 = pt.x; a.y2 = pt.y; }
        }
      }
      renderAnnot();
    });

    svg.addEventListener('pointerup', function() { dragState = null; });
    svg.addEventListener('pointercancel', function() { dragState = null; });

    var keyHandler = function(e) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && document.getElementById('annotation-overlay')) {
        annotations = annotations.filter(function(a) { return a.id !== selectedId; });
        selectedId = null; renderAnnot();
      }
    };
    document.addEventListener('keydown', keyHandler);

    // ── Save ──────────────────────────────────────────────────
    function saveAnnotation() {
      document.removeEventListener('keydown', keyHandler);
      if (!annotations.length) { overlay.remove(); return; }
      var canv = document.createElement('canvas');
      var baseImg = new Image();
      baseImg.onload = async function() {
        canv.width = baseImg.naturalWidth;
        canv.height = baseImg.naturalHeight;
        var ctx = canv.getContext('2d');
        ctx.drawImage(baseImg, 0, 0);
        var scX = canv.width / svgW, scY = canv.height / svgH;
        annotations.forEach(function(a) {
          var color = COLORS[a.color] || '#FF3B30';
          ctx.strokeStyle = color; ctx.fillStyle = color;
          ctx.lineWidth = 3 * Math.max(scX, scY);
          if (a.type === 'circle') {
            ctx.beginPath();
            ctx.arc(a.cx * scX, a.cy * scY, a.r * scX, 0, Math.PI * 2);
            ctx.stroke();
          } else if (a.type === 'arrow') {
            var dx = a.x2 - a.x1, dy = a.y2 - a.y1;
            var len = Math.hypot(dx, dy);
            if (len < 1) return;
            var ux = dx / len, uy = dy / len, ppx = -uy, ppy = ux;
            var arrowSz = Math.max(20, Math.min(30, svgW * 0.025)) * Math.max(scX, scY);
            var x1 = a.x1 * scX, y1 = a.y1 * scY, x2 = a.x2 * scX, y2 = a.y2 * scY;
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 - ux * arrowSz + ppx * arrowSz * 0.4, y2 - uy * arrowSz + ppy * arrowSz * 0.4);
            ctx.lineTo(x2 - ux * arrowSz - ppx * arrowSz * 0.4, y2 - uy * arrowSz - ppy * arrowSz * 0.4);
            ctx.closePath(); ctx.fill();
          }
        });
        if (!photo.originalDataUrl) photo.originalDataUrl = photo.dataUrl;
        photo.dataUrl = canv.toDataURL('image/jpeg', 0.85);
        try {
          photo.thumbnailDataUrl = await imageVariant(photo.dataUrl, 420, 0.62);
        } catch (thumbErr) {
          console.warn('Annotation thumbnail failed:', thumbErr);
        }
        photo.annotations = JSON.parse(JSON.stringify(annotations));
        savePhotoRecordToVault(photo);
        onSave();
        overlay.remove();
      };
      baseImg.src = srcUrl;
    }
  }

  // ── Field: Photo Capture ───────────────────────────────────
  function renderPhoto(photos, onUpdate, roomName, stepName, inspectionId, options) {
    if (!photos) photos = [];
    const photoOptions = options || {};
    const roomLabel = String(roomName || '').trim();
    const stepLabel = String(stepName || '').trim();
    const destinationLabel = roomLabel && stepLabel && roomLabel.toLowerCase() !== stepLabel.toLowerCase()
      ? roomLabel + ' → ' + stepLabel
      : roomLabel || stepLabel || 'Needs placement';
    const section = el('div', { className: 'field-group photo-section' });
    if (!photoOptions.hideLabel) {
      section.appendChild(el('label', { className: 'field-label' }, photoOptions.label || 'Photos'));
    }

    if (photos.length) {
      const grid = el('div', { className: 'photo-grid' });
      photos.forEach((p, idx) => {
        const card = el('div', { className: 'photo-card' });
        var displayUrl = p.thumbnailDataUrl || p.dataUrl;
        if (p.dataUrl === '__uploaded__' || !displayUrl) {
          const placeholder = el('div', { className: 'photo-img', style: 'display:flex;align-items:center;justify-content:center;background:#e8f5e9;color:#2e7d32;font-size:13px;font-weight:bold;min-height:120px;border-radius:6px;' }, '\u2601\ufe0f Uploaded to Drive');
          card.appendChild(placeholder);
        } else {
          card.appendChild(lazyImage(displayUrl, 'photo-img', 'Photo ' + (idx + 1)));
        }
        card.appendChild(el('div', { className: 'photo-time' }, fmtDate(p.timestamp)));
        const savedRoom = String(p.roomName || roomLabel || '').trim();
        const savedStep = String(p.stepName || stepLabel || '').trim();
        const savedDestination = savedRoom && savedStep && savedRoom.toLowerCase() !== savedStep.toLowerCase()
          ? savedRoom + ' → ' + savedStep
          : savedRoom || savedStep || 'Needs placement';
        card.appendChild(el('div', {
          className: 'photo-capture-route' + (savedRoom || savedStep ? '' : ' needs-placement')
        }, (savedRoom || savedStep ? '✓ Saved to ' : '⚠ ') + savedDestination));

        const capRow = el('div', { className: 'input-row' });
        const capInp = el('textarea', {
          className: 'field-input photo-caption-input', rows: '2',
          placeholder: 'Optional comment — why does this photo matter?'
        });
        capInp.value = p.caption || '';
        capInp.style.cssText = 'resize:none;min-height:54px;font-size:0.9rem;line-height:1.4;padding:8px;';
        capInp.addEventListener('input', () => {
          p.caption = capInp.value;
          if (window.DB && window.DB.updatePhoto && p.photoId) {
            window.DB.updatePhoto(p.photoId, { caption: p.caption });
          }
          onUpdate();
        });
        capRow.appendChild(capInp);
        card.appendChild(capRow);

        // ── AI Caption Suggestion ────────────────────────────────
        if (p.dataUrl && p.dataUrl !== '__uploaded__') {
          const aiCaptionBtn = document.createElement('button');
          aiCaptionBtn.type = 'button';
          aiCaptionBtn.className = 'ai-caption-btn';
          aiCaptionBtn.textContent = '✨ Suggest caption';
          aiCaptionBtn.style.cssText = 'display:block;width:100%;margin-top:4px;padding:6px 10px;background:#f0f4ff;border:1px solid #c7d4f8;border-radius:6px;color:#3a5ec5;font-size:0.82rem;font-weight:600;cursor:pointer;text-align:left;';
          aiCaptionBtn.onclick = async () => {
            aiCaptionBtn.disabled = true;
            aiCaptionBtn.textContent = '⏳ Analyzing photo...';
            try {
              const PROXY_URL = 'https://inhaus-vision-proxy.mjordanjay.workers.dev';
              const base64 = p.dataUrl.split(',')[1];
              const mimeType = (p.dataUrl.split(';')[0].split(':')[1]) || 'image/jpeg';
              const prompt = 'You are a home health inspector writing a caption for a photo taken during a residential inspection.' +
                ' The caption should be 1-2 sentences, written in plain, accessible language — not overly technical.' +
                ' Describe what is visible in the photo.' +
                ' If there is any issue present, briefly explain how it could affect the health or comfort of the home\'s occupants if left unaddressed (e.g. mold risk, air quality, water quality, structural safety).' +
                ' If the photo shows something that appears normal and fine, just describe it briefly.' +
                ' Do not use alarming language. Be matter-of-fact and helpful.' +
                (roomName ? ' Room: ' + roomName + '.' : '') +
                (stepName ? ' Section: ' + stepName + '.' : '') +
                ' Return ONLY the caption text, no quotes, no labels, no extra formatting.';
              const resp = await fetch(PROXY_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ imageBase64: base64, mimeType, prompt })
              });
              if (!resp.ok) throw new Error('API_ERROR ' + resp.status);
              const result = await resp.json();
              const text = result.content && result.content[0] && result.content[0].text;
              if (!text) throw new Error('EMPTY_RESPONSE');
              p.caption = text.trim();
              capInp.value = p.caption;
              onUpdate();
              aiCaptionBtn.textContent = '✓ Caption added — edit if needed';
              aiCaptionBtn.style.background = '#edfaf1';
              aiCaptionBtn.style.borderColor = '#a3d9b1';
              aiCaptionBtn.style.color = '#1e7e34';
              setTimeout(() => {
                aiCaptionBtn.textContent = '✨ Re-suggest caption';
                aiCaptionBtn.disabled = false;
                aiCaptionBtn.style.background = '#f0f4ff';
                aiCaptionBtn.style.borderColor = '#c7d4f8';
                aiCaptionBtn.style.color = '#3a5ec5';
              }, 3000);
            } catch (err) {
              aiCaptionBtn.disabled = false;
              aiCaptionBtn.textContent = '✨ Suggest caption';
              if (window.showToast) window.showToast('AI unavailable — add caption manually');
            }
          };
          card.appendChild(aiCaptionBtn);
        }

        card.appendChild(el('button', {
          type: 'button', className: 'photo-del-btn',
          onClick: async () => {
            if (confirm('Delete this photo?')) {
              if (window.DB && p.photoId) {
                if (window.DB.trashPhoto) await window.DB.trashPhoto(p, inspectionId, 'Deleted from photo card');
                else if (window.DB.removePhoto) await window.DB.removePhoto(p.photoId);
              }
              photos.splice(idx, 1);
              onUpdate();
              window.dispatchEvent(new CustomEvent('inhaus-photo-deleted', { detail: {
                photoId: p.photoId,
                roomName: p.roomName || roomName || '',
                stepName: p.stepName || stepName || ''
              } }));
              const newSection = renderPhoto(photos, onUpdate, roomName, stepName, inspectionId, photoOptions);
              section.replaceWith(newSection);
            }
          }
        }, '\u00d7'));
        card.appendChild(el('button', {
          type: 'button', className: 'photo-annotate-btn',
          title: 'Annotate',
          onClick: (e) => {
            e.stopPropagation();
            openAnnotationEditor(p, function() {
              onUpdate();
              const newSection = renderPhoto(photos, onUpdate, roomName, stepName, inspectionId, photoOptions);
              section.replaceWith(newSection);
            });
          }
        }, '\u270F\uFE0F'));
        grid.appendChild(card);
      });
      section.appendChild(grid);
    }

    // ── Save photo to device camera roll ────────
    async function saveToDevicePhotos(dataUrl, photoId) {
      // Method 1: auto-download (Android + desktop)
      try {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'inhaus-' + photoId + '.jpg';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => document.body.removeChild(a), 100);
      } catch(e) { console.warn('Auto-download failed:', e); }
      // Method 2: Web Share API (iOS — inspector taps Save Image)
      try {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const filename = 'inhaus-' + photoId + '.jpg';
        const file = new File([blob], filename, { type: 'image/jpeg' });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'InHaus Photo — tap Save Image to keep local copy' });
        }
      } catch (e) {
        if (e && e.name !== 'AbortError') console.warn('Share to photos failed:', e);
      }
    }
    async function handleFiles(files) {
      let savedCount = 0;
      for (const file of Array.from(files)) {
        try {
          const dataUrl = await compressImage(file);
          const thumbnailDataUrl = await imageVariant(dataUrl, 420, 0.62);
          const newPhoto = {
            photoId: 'p-' + Math.random().toString(36).substr(2, 9),
            roomName: roomName || '', stepName: stepName || '',
            timestamp: new Date().toISOString(), caption: '', dataUrl, thumbnailDataUrl,
            placementSource: roomName || stepName ? 'capture_context' : 'unassigned',
            routingStatus: roomName || stepName ? 'auto' : 'needs_review',
            _uploaded: false, _vaultSaved: false
          };
          await savePhotoRecordToVault(newPhoto, inspectionId);
          photos.push(newPhoto);
          onUpdate();
          section.replaceWith(renderPhoto(photos, onUpdate, roomName, stepName, inspectionId, photoOptions));
          if (window.queuePhotoForBackgroundUpload) {
            window.queuePhotoForBackgroundUpload(newPhoto);
          }
          savedCount++;
        } catch (err) { console.error('Photo error:', err); }
      }
      if (savedCount > 0 && window.showToast) {
        const countLabel = savedCount === 1 ? 'Photo' : savedCount + ' photos';
        window.showToast(countLabel + ' saved to ' + destinationLabel);
      }
    }

    const fileInp = el('input', { type: 'file', accept: 'image/*', capture: 'environment', className: 'hidden' });
    fileInp.addEventListener('change', async e => { await handleFiles(e.target.files); });

    const libInp = el('input', { type: 'file', accept: 'image/*', multiple: 'true', className: 'hidden' });
    libInp.addEventListener('change', async e => { await handleFiles(e.target.files); });

    section.appendChild(fileInp);
    section.appendChild(libInp);
    const photoBtnRow = el('div', { className: 'photo-btn-row' });
    photoBtnRow.appendChild(el('button', { type: 'button', className: 'btn btn-secondary photo-add-btn', onClick: () => fileInp.click() }, photos.length ? '\uD83D\uDCF7 Add Another' : '\uD83D\uDCF7 Add Photo'));
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
      // Support arrays in both data value (chips) and target (multiple allowed values)
      const visible = Array.isArray(target)
        ? (Array.isArray(dv) ? target.some(t => dv.includes(t)) : target.includes(dv))
        : (Array.isArray(dv) ? dv.includes(target) : dv === target);
      const fCopy = Object.assign({}, f);
      delete fCopy.showIf;
      const wrapper = document.createElement('div');
      wrapper.className = 'showif-wrapper' + (visible ? '' : ' showif-hidden');
      wrapper.setAttribute('data-showif-key', f.showIf.key);
      wrapper.setAttribute('data-showif-value', JSON.stringify(f.showIf.value));
      wrapper.setAttribute('data-showif-built', 'false');
      wrapper._buildShowIf = function() {
        if (wrapper.getAttribute('data-showif-built') === 'true') return;
        const inner = renderField(fCopy, data, onChange, inspection, onSave);
        if (inner) wrapper.appendChild(inner);
        wrapper.setAttribute('data-showif-built', 'true');
      };
      if (visible) wrapper._buildShowIf();
      return wrapper;
    }

    const changed = () => onChange(f.key || f.dataKey || f.type || 'field');

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
      case 'boulder-blue-duration': {
        // Auto-calculates duration from start time (arrival step) + end time (current data)
        // Updates whenever boulderBlueEndTime changes
        const wrap = document.createElement('div');
        wrap.style = 'background:#f0fdf4;border:2px solid #86efac;border-radius:12px;padding:14px;margin:4px 0 8px;';

        function calcDuration(startStr, endStr) {
          if (!startStr || !endStr) return null;
          const toMins = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
          let diff = toMins(endStr) - toMins(startStr);
          if (diff < 0) diff += 24 * 60; // crossed midnight
          const hrs = Math.floor(diff / 60);
          const mins = diff % 60;
          return hrs + ' hr' + (hrs !== 1 ? 's' : '') + (mins ? ' ' + mins + ' min' : '');
        }

        function getStartTime() {
          return (window.inspection &&
            window.inspection.stepData &&
            window.inspection.stepData.arrival &&
            window.inspection.stepData.arrival.boulderBlueStartTime) || '';
        }

        const hdr = document.createElement('div');
        hdr.style = 'font-size:12px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px;';
        hdr.textContent = 'Test Duration';

        const startRow = document.createElement('div');
        startRow.style = 'font-size:0.85rem;color:#6a7a60;margin-bottom:8px;';

        const durationDisplay = document.createElement('div');
        durationDisplay.style = 'font-size:1.6rem;font-weight:800;color:#15803d;margin-bottom:8px;min-height:2rem;';

        const warnBanner = document.createElement('div');
        warnBanner.style = 'font-size:0.82rem;font-weight:600;padding:6px 10px;border-radius:7px;margin-bottom:8px;display:none;';

        const confirmRow = document.createElement('div');
        confirmRow.style = 'margin-top:4px;';
        const confirmLbl = document.createElement('div');
        confirmLbl.style = 'font-size:11px;font-weight:600;color:#15803d;margin-bottom:3px;';
        confirmLbl.textContent = 'Confirm duration \u2014 edit if needed';
        const confirmInp = document.createElement('input');
        confirmInp.type = 'text';
        confirmInp.style = 'width:100%;padding:9px 12px;border:2px solid #86efac;border-radius:8px;font-size:1rem;font-weight:700;background:#fff;box-sizing:border-box;';
        confirmInp.value = data.boulderBlueTestDuration || '';
        confirmInp.placeholder = 'e.g. 2 hrs 15 min';
        confirmInp.addEventListener('input', () => { data.boulderBlueTestDuration = confirmInp.value; changed(); });
        confirmRow.appendChild(confirmLbl); confirmRow.appendChild(confirmInp);

        function refresh() {
          const start = getStartTime();
          const end = data.boulderBlueEndTime || '';
          startRow.textContent = start ? 'Start: ' + start + (end ? ' \u2192 End: ' + end : '') : 'Start time not set in Arrival step';
          if (start && end) {
            const dur = calcDuration(start, end);
            const mins = (() => { const [h,m] = start.split(':').map(Number); const [eh,em] = end.split(':').map(Number); let d=(eh*60+em)-(h*60+m); if(d<0)d+=1440; return d; })();
            durationDisplay.textContent = dur;
            data.boulderBlueTestDuration = dur;
            confirmInp.value = dur;
            confirmRow.style.display = '';
            if (mins < 120) {
              warnBanner.style.display = 'block';
              warnBanner.style.background = '#fef9c3';
              warnBanner.style.color = '#854d0e';
              warnBanner.textContent = '\u26a0\ufe0f Only ' + dur + ' \u2014 minimum is 2 hours';
            } else {
              warnBanner.style.display = 'block';
              warnBanner.style.background = '#dcfce7';
              warnBanner.style.color = '#15803d';
              warnBanner.textContent = '\u2713 Meets 2-hour minimum';
            }
          } else {
            durationDisplay.textContent = '\u2014';
            warnBanner.style.display = 'none';
            confirmRow.style.display = end ? '' : 'none';
          }
        }

        // Watch boulderBlueEndTime changes via MutationObserver on the end-time input
        // Use a small polling approach on the parent card's end-time field
        let lastEnd = data.boulderBlueEndTime || '';
        const pollInterval = setInterval(() => {
          const currentEnd = data.boulderBlueEndTime || '';
          if (currentEnd !== lastEnd) { lastEnd = currentEnd; refresh(); }
        }, 500);
        // Clean up on detach
        const observer = new MutationObserver(() => {
          if (!document.body.contains(wrap)) { clearInterval(pollInterval); observer.disconnect(); }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        refresh();
        wrap.appendChild(hdr);
        wrap.appendChild(startRow);
        wrap.appendChild(durationDisplay);
        wrap.appendChild(warnBanner);
        wrap.appendChild(confirmRow);
        return wrap;
      }
      case 'sample-id-scanner': {
        // Photo → AI reads sample ID → inspector confirms
        // f.dataKey: where to store the confirmed ID string
        // f.label: display label (e.g. 'Sample ID')
        const dataKey = f.dataKey || 'sampleId';
        const labelText = f.label || 'Sample ID';

        const PROXY_URL = 'https://inhaus-vision-proxy.mjordanjay.workers.dev';
        const wrap = document.createElement('div');
        wrap.style = 'background:#f0f7ff;border:2px solid #93c5fd;border-radius:12px;padding:14px;margin:4px 0 8px;';

        // Header
        const hdr = document.createElement('div');
        hdr.style = 'font-size:12px;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px;';
        hdr.textContent = labelText;

        // File input (hidden)
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment'; inp.style = 'display:none;';

        // Preview
        const previewWrap = document.createElement('div');
        previewWrap.style = 'position:relative;margin-bottom:10px;display:none;';
        const preview = document.createElement('img');
        preview.style = 'width:100%;border-radius:8px;border:1.5px solid #93c5fd;max-height:140px;object-fit:cover;';
        const retakeBtn = document.createElement('button');
        retakeBtn.type = 'button';
        retakeBtn.style = 'position:absolute;top:6px;right:6px;background:rgba(0,0,0,.55);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;';
        retakeBtn.textContent = '\u21a9 Retake';
        retakeBtn.onclick = () => inp.click();
        previewWrap.appendChild(preview); previewWrap.appendChild(retakeBtn);

        // Shoot button
        const shootBtn = document.createElement('button');
        shootBtn.type = 'button';
        shootBtn.style = 'width:100%;padding:10px;background:#1e40af;color:#fff;border:none;border-radius:9px;font-weight:700;font-size:0.9rem;cursor:pointer;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:8px;';
        shootBtn.innerHTML = '\uD83D\uDCF7 Scan Sample Label';

        // Status
        const status = document.createElement('div');
        status.style = 'font-size:0.82rem;margin-bottom:8px;min-height:18px;';
        if (data[dataKey]) {
          shootBtn.innerHTML = '\uD83D\uDCF7 Retake Photo';
          status.textContent = '\u2713 ID confirmed';
          status.style += 'color:#15803d;font-weight:600;';
        }

        // Confirm row (editable field)
        const confirmRow = document.createElement('div');
        confirmRow.style = 'margin-top:4px;' + (data[dataKey] ? '' : 'display:none;');
        const confirmLbl = document.createElement('div');
        confirmLbl.style = 'font-size:11px;font-weight:600;color:#1e40af;margin-bottom:3px;';
        confirmLbl.textContent = 'Confirm ID \u2014 correct if needed';
        const confirmInp = document.createElement('input');
        confirmInp.type = 'text';
        confirmInp.style = 'width:100%;padding:9px 12px;border:2px solid #93c5fd;border-radius:8px;font-size:1rem;font-weight:700;letter-spacing:.5px;background:#fff;box-sizing:border-box;';
        confirmInp.value = data[dataKey] || '';
        confirmInp.placeholder = 'e.g. WP-123456';
        confirmInp.addEventListener('input', () => { data[dataKey] = confirmInp.value; changed(); });
        confirmRow.appendChild(confirmLbl); confirmRow.appendChild(confirmInp);

        inp.onchange = async e => {
          const file = e.target.files[0]; if (!file) return;
          inp.value = '';
          shootBtn.disabled = true;
          status.textContent = '\u23f3 Reading label...';
          status.style.color = '#92400e';
          status.style.fontWeight = '600';
          try {
            const dataUrl = await compressImage(file);
            // store photo reference
            data[dataKey + '_photo'] = { dataUrl, timestamp: new Date().toISOString() };
            preview.src = dataUrl;
            previewWrap.style.display = '';
            shootBtn.innerHTML = '\uD83D\uDCF7 Retake Photo';
            const prompt = 'This is a water testing sample label or chain-of-custody form. Extract the sample ID, bottle number, or accession number. Return JSON with one key: sampleId (string). Return ONLY the JSON. If you cannot read a number, return {"sampleId": null}.';
            const resp = await fetch(PROXY_URL, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ imageBase64: dataUrl.split(',')[1], mimeType: 'image/jpeg', prompt })
            });
            const result = await resp.json();
            const txt = result.content && result.content[0] && result.content[0].text;
            const parsed = JSON.parse(txt);
            if (parsed.sampleId) {
              data[dataKey] = parsed.sampleId;
              confirmInp.value = parsed.sampleId;
              confirmRow.style.display = '';
              status.textContent = '\u2713 ID read \u2014 confirm below';
              status.style.color = '#15803d';
            } else {
              confirmRow.style.display = '';
              confirmInp.value = data[dataKey] || '';
              status.textContent = '\u26a0\ufe0f Could not read ID \u2014 type it below';
              status.style.color = '#b45309';
            }
            changed();
          } catch (err) {
            confirmRow.style.display = '';
            status.textContent = '\u26a0\ufe0f Scan failed \u2014 type ID below';
            status.style.color = '#b45309';
          } finally {
            shootBtn.disabled = false;
          }
        };
        shootBtn.onclick = () => inp.click();

        wrap.appendChild(hdr);
        wrap.appendChild(inp);
        wrap.appendChild(previewWrap);
        wrap.appendChild(shootBtn);
        wrap.appendChild(status);
        wrap.appendChild(confirmRow);
        return wrap;
      }
      case 'flir-photo-log': {
        // Dynamic FLIR log: starts with 1 entry, + Add button appends more
        // Stores data as flirRoom1/flirImg1/flirImageLabel1, flirRoom2... etc.
        // Compatible with existing export loop.
        const wrap = document.createElement('div');
        wrap.style = 'display:flex;flex-direction:column;gap:0;';

        function countEntries() {
          let n = 0;
          while (data['flirRoom' + (n + 1)] !== undefined ||
                 data['flirImg' + (n + 1)] !== undefined ||
                 data['flirImageLabel' + (n + 1)] !== undefined) n++;
          return Math.max(n, 1); // always at least 1
        }

        let entryCount = countEntries();
        const entriesWrap = document.createElement('div');
        entriesWrap.style = 'display:flex;flex-direction:column;gap:10px;';

        function buildEntry(i) {
          const entry = document.createElement('div');
          entry.style = 'background:#f4f8f0;border:1.5px solid #c8d8b0;border-radius:10px;padding:12px 14px;position:relative;';
          entry.setAttribute('data-flir-entry', i);

          // Entry header
          const hdr = document.createElement('div');
          hdr.style = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
          const hdrLabel = document.createElement('div');
          hdrLabel.style = 'font-size:12px;font-weight:700;color:#5a7a3a;text-transform:uppercase;letter-spacing:.4px;';
          hdrLabel.textContent = 'Image ' + i;
          hdr.appendChild(hdrLabel);

          // Remove button (only show if more than 1 entry)
          if (i > 1) {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.style = 'background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;padding:0 2px;line-height:1;';
            removeBtn.textContent = '\u00d7';
            removeBtn.title = 'Remove this entry';
            removeBtn.onclick = () => {
              // Shift data down from i+1 onward
              let j = i;
              while (data['flirRoom' + (j + 1)] !== undefined ||
                     data['flirImg' + (j + 1)] !== undefined ||
                     data['flirImageLabel' + (j + 1)] !== undefined) {
                data['flirRoom' + j] = data['flirRoom' + (j + 1)] || '';
                data['flirImg' + j] = data['flirImg' + (j + 1)] || '';
                data['flirImageLabel' + j] = data['flirImageLabel' + (j + 1)] || '';
                j++;
              }
              delete data['flirRoom' + j];
              delete data['flirImg' + j];
              delete data['flirImageLabel' + j];
              entryCount = Math.max(entryCount - 1, 1);
              rebuildEntries();
              changed();
            };
            hdr.appendChild(removeBtn);
          }
          entry.appendChild(hdr);

          function mkRow(labelTxt, key, placeholder) {
            const row = document.createElement('div');
            row.style = 'margin-bottom:8px;';
            const lbl = document.createElement('div');
            lbl.style = 'font-size:11px;font-weight:600;color:#6a7a60;margin-bottom:3px;';
            lbl.textContent = labelTxt;
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.placeholder = placeholder || '';
            inp.value = data[key] || '';
            inp.style = 'width:100%;padding:7px 10px;border:1.5px solid #d0dcc8;border-radius:7px;font-size:0.9rem;background:#fff;box-sizing:border-box;';
            inp.addEventListener('input', () => { data[key] = inp.value; changed(); });
            row.appendChild(lbl); row.appendChild(inp);
            return row;
          }

          entry.appendChild(mkRow('Room / Area', 'flirRoom' + i, 'e.g. Living Room'));
          entry.appendChild(mkRow('FLIR Image #', 'flirImg' + i, 'e.g. #0023'));
          entry.appendChild(mkRow('Label / Notes', 'flirImageLabel' + i, 'e.g. Moisture stain near window'));
          return entry;
        }

        function rebuildEntries() {
          entriesWrap.innerHTML = '';
          for (let i = 1; i <= entryCount; i++) {
            entriesWrap.appendChild(buildEntry(i));
          }
        }
        rebuildEntries();

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.style = 'margin-top:10px;padding:9px 16px;background:#fff;border:2px dashed #8aab5a;border-radius:9px;color:#5a7a3a;font-weight:700;font-size:0.9rem;cursor:pointer;width:100%;text-align:center;';
        addBtn.textContent = '+ Add another image';
        addBtn.onclick = () => {
          entryCount++;
          data['flirRoom' + entryCount] = '';
          data['flirImg' + entryCount] = '';
          data['flirImageLabel' + entryCount] = '';
          rebuildEntries();
          // scroll new entry into view
          const last = entriesWrap.lastElementChild;
          if (last) setTimeout(() => last.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
        };

        wrap.appendChild(entriesWrap);
        wrap.appendChild(addBtn);
        return wrap;
      }
      case 'dynamic-room-label': {
        // Renders a contextual label showing which room the follow-up is for
        const wrap = document.createElement('div');
        wrap.style = 'background:#fff8e1;border:1.5px solid #f59e0b;border-radius:8px;padding:9px 13px;margin:4px 0 2px;display:flex;align-items:center;gap:8px;';
        const icon = document.createElement('span');
        icon.textContent = '📍';
        icon.style = 'font-size:1.1rem;flex-shrink:0;';
        const lbl = document.createElement('span');
        lbl.style = 'font-size:0.9rem;font-weight:600;color:#92400e;';
        const roomName = data.roomName || data.roomNames || data.levelLocation || '';
        lbl.textContent = roomName
          ? 'Follow-up for: ' + roomName
          : 'Follow-up for this room / area';
        wrap.appendChild(icon); wrap.appendChild(lbl);
        return wrap;
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
        // ─────────────────────────────────────────────────────────
        // SCAN-FIRST, CONFIRM-SECOND HVAC flow
        // Step 1: Take photo of data tag  → AI fills unit specs
        // Step 2: Take photo of filter    → AI fills filter specs
        // Step 3: Confirm card appears    → tech edits + adds notes
        // ─────────────────────────────────────────────────────────
        const wrap = document.createElement('div');
        wrap.className = 'ai-hvac-scanner';
        wrap.style = 'display:flex;flex-direction:column;gap:0;';

        const PROXY_URL = 'https://inhaus-vision-proxy.mjordanjay.workers.dev';

        async function callAnthropic(imageDataUrl, promptText) {
          const base64 = imageDataUrl.split(',')[1];
          const mimeType = (imageDataUrl.split(';')[0].split(':')[1]) || 'image/jpeg';
          const resp = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64, mimeType, prompt: promptText })
          });
          if (!resp.ok) throw new Error('API_ERROR ' + resp.status);
          const result = await resp.json();
          const text = result.content && result.content[0] && result.content[0].text;
          if (!text) throw new Error('EMPTY_RESPONSE');
          return JSON.parse(text);
        }

        // ── helpers ─────────────────────────────────────────────
        function mkLabel(txt) {
          const l = document.createElement('div');
          l.style = 'font-size:11px;font-weight:700;color:#5a7a3a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;';
          l.textContent = txt;
          return l;
        }
        function mkInput(key, placeholder, type) {
          const inp = document.createElement(type === 'textarea' ? 'textarea' : 'input');
          if (type !== 'textarea') inp.type = type || 'text';
          inp.placeholder = placeholder || '';
          inp.value = data[key] || '';
          inp.style = 'width:100%;padding:8px 10px;border:1.5px solid #d0dcc8;border-radius:8px;font-size:0.95rem;background:#fff;box-sizing:border-box;' + (type === 'textarea' ? 'min-height:64px;resize:vertical;' : '');
          inp.addEventListener('input', () => { data[key] = inp.value; changed(); });
          return inp;
        }
        function mkSelect(key, options) {
          const sel = document.createElement('select');
          sel.style = 'width:100%;padding:8px 10px;border:1.5px solid #d0dcc8;border-radius:8px;font-size:0.95rem;background:#fff;box-sizing:border-box;';
          [{ value: '', label: '— select —' }, ...options.map(o => ({ value: o, label: o }))].forEach(o => {
            const opt = document.createElement('option');
            opt.value = o.value; opt.textContent = o.label;
            sel.appendChild(opt);
          });
          sel.value = data[key] || '';
          sel.addEventListener('change', () => { data[key] = sel.value; changed(); });
          return sel;
        }
        function setVal(key, value) {
          if (value === null || value === undefined || value === '') return;
          data[key] = value;
        }
        function syncConfirmCard() {
          // push data values into confirm card inputs
          confirmCard.querySelectorAll('[data-hvac-key]').forEach(el => {
            const k = el.getAttribute('data-hvac-key');
            if (el.tagName === 'SELECT') {
              if (data[k]) el.value = data[k];
            } else {
              el.value = data[k] || '';
            }
          });
        }

        // ── State tracking ──────────────────────────────────────
        let tagScanned = !!(data.hvacTagPhoto);
        let filterScanned = !!(data.hvacFilterPhoto);

        // ═══════════════════════════════════════════════════════
        // STEP 1 — Data Tag
        // ═══════════════════════════════════════════════════════
        const step1 = document.createElement('div');
        step1.className = 'hvac-scan-step';
        step1.style = 'background:#f4f8f0;border:2px solid #c8d8b0;border-radius:12px;padding:16px;margin-bottom:12px;';

        const step1Header = document.createElement('div');
        step1Header.style = 'display:flex;align-items:center;gap:10px;margin-bottom:10px;';
        const step1Num = document.createElement('div');
        step1Num.style = 'width:28px;height:28px;border-radius:50%;background:#2C3F16;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        step1Num.textContent = '1';
        const step1Title = document.createElement('div');
        step1Title.style = 'font-weight:700;font-size:1rem;color:#2C3F16;';
        step1Title.textContent = 'Photo: HVAC Unit Data Tag';
        step1Header.appendChild(step1Num); step1Header.appendChild(step1Title);

        const step1Hint = document.createElement('div');
        step1Hint.style = 'font-size:0.85rem;color:#6a7a60;margin-bottom:12px;';
        step1Hint.textContent = 'Take a clear photo of the data tag on the HVAC unit. AI will read the model, serial number, and specs.';

        const tagInp = document.createElement('input');
        tagInp.type = 'file'; tagInp.accept = 'image/*'; tagInp.capture = 'environment'; tagInp.style = 'display:none;';

        const tagPreviewWrap = document.createElement('div');
        tagPreviewWrap.style = 'position:relative;margin-bottom:10px;' + (tagScanned ? '' : 'display:none;');
        const tagPreview = document.createElement('img');
        tagPreview.className = 'ai-scan-preview';
        tagPreview.style = 'width:100%;border-radius:8px;border:1.5px solid #c8d8b0;';
        if (data.hvacTagPhoto) tagPreview.src = data.hvacTagPhoto.dataUrl || '';
        const tagRetake = document.createElement('button');
        tagRetake.type = 'button';
        tagRetake.style = 'position:absolute;top:6px;right:6px;background:rgba(0,0,0,.55);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;';
        tagRetake.textContent = '↩ Retake';
        tagRetake.onclick = () => tagInp.click();
        tagPreviewWrap.appendChild(tagPreview); tagPreviewWrap.appendChild(tagRetake);

        const tagBtn = document.createElement('button');
        tagBtn.type = 'button';
        tagBtn.className = 'ai-scan-btn ai-scan-tag-btn';
        tagBtn.innerHTML = '📷 Take Photo of Data Tag';
        if (tagScanned) tagBtn.style.display = 'none';

        const tagStatus = document.createElement('div');
        tagStatus.className = 'ai-scan-status';
        if (tagScanned) { tagStatus.textContent = '✓ Data tag scanned'; tagStatus.className = 'ai-scan-status ai-scan-success'; }

        tagInp.onchange = async e => {
          const file = e.target.files[0]; if (!file) return;
          tagInp.value = '';
          tagBtn.style.display = 'none';
          tagStatus.textContent = '⏳ Reading data tag...';
          tagStatus.className = 'ai-scan-status ai-scan-loading';
          try {
            const dataUrl = await compressImage(file);
            data.hvacTagPhoto = { dataUrl, timestamp: new Date().toISOString() };
            tagPreview.src = dataUrl;
            tagPreviewWrap.style.display = '';
            const prompt = 'Analyze this HVAC equipment data tag. Extract and return JSON with these exact keys: manufacturer (brand name, string or null), modelNumber (string or null), serialNumber (string or null), filterSize (e.g. "16x25x1", string or null), mervRating (number or null), brand (same as manufacturer or filter brand if different, string or null). If any field is not visible or readable, use null. Return ONLY valid JSON, no other text.';
            const result = await callAnthropic(dataUrl, prompt);
            if (result.manufacturer) setVal('hvacManufacturer', result.manufacturer);
            if (result.modelNumber)   setVal('hvacModel', result.modelNumber);
            if (result.serialNumber)  setVal('hvacSerial', result.serialNumber);
            if (result.filterSize)    setVal('filterSize', result.filterSize);
            if (result.mervRating != null) setVal('mervRating', String(result.mervRating));
            if (result.brand)         setVal('filterMakeModel', result.brand);
            tagScanned = true;
            tagStatus.textContent = '✓ Data tag read — check details below';
            tagStatus.className = 'ai-scan-status ai-scan-success';
            syncConfirmCard();
            revealConfirmIfReady();
            changed();
          } catch (err) {
            tagBtn.style.display = '';
            tagStatus.textContent = '⚠️ Could not read tag — fill in manually below';
            tagStatus.className = 'ai-scan-status ai-scan-error';
            tagScanned = true; // let them proceed
            revealConfirmIfReady();
          }
        };
        tagBtn.onclick = () => tagInp.click();

        step1.appendChild(step1Header);
        step1.appendChild(step1Hint);
        step1.appendChild(tagInp);
        step1.appendChild(tagPreviewWrap);
        step1.appendChild(tagBtn);
        step1.appendChild(tagStatus);

        // ═══════════════════════════════════════════════════════
        // STEP 2 — Filter
        // ═══════════════════════════════════════════════════════
        const step2 = document.createElement('div');
        step2.className = 'hvac-scan-step';
        step2.style = 'background:#f4f8f0;border:2px solid #c8d8b0;border-radius:12px;padding:16px;margin-bottom:12px;';

        const step2Header = document.createElement('div');
        step2Header.style = 'display:flex;align-items:center;gap:10px;margin-bottom:10px;';
        const step2Num = document.createElement('div');
        step2Num.style = 'width:28px;height:28px;border-radius:50%;background:#2C3F16;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        step2Num.textContent = '2';
        const step2Title = document.createElement('div');
        step2Title.style = 'font-weight:700;font-size:1rem;color:#2C3F16;';
        step2Title.textContent = 'Photo: HVAC Filter';
        step2Header.appendChild(step2Num); step2Header.appendChild(step2Title);

        const step2Hint = document.createElement('div');
        step2Hint.style = 'font-size:0.85rem;color:#6a7a60;margin-bottom:12px;';
        step2Hint.textContent = 'Take a photo of the filter. AI will read the size, MERV rating, brand, and assess condition.';

        const filterInp = document.createElement('input');
        filterInp.type = 'file'; filterInp.accept = 'image/*'; filterInp.capture = 'environment'; filterInp.style = 'display:none;';

        const filterPreviewWrap = document.createElement('div');
        filterPreviewWrap.style = 'position:relative;margin-bottom:10px;' + (filterScanned ? '' : 'display:none;');
        const filterPreview = document.createElement('img');
        filterPreview.className = 'ai-scan-preview';
        filterPreview.style = 'width:100%;border-radius:8px;border:1.5px solid #c8d8b0;';
        if (data.hvacFilterPhoto) filterPreview.src = data.hvacFilterPhoto.dataUrl || '';
        const filterRetake = document.createElement('button');
        filterRetake.type = 'button';
        filterRetake.style = 'position:absolute;top:6px;right:6px;background:rgba(0,0,0,.55);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;';
        filterRetake.textContent = '↩ Retake';
        filterRetake.onclick = () => filterInp.click();
        filterPreviewWrap.appendChild(filterPreview); filterPreviewWrap.appendChild(filterRetake);

        const filterBtn = document.createElement('button');
        filterBtn.type = 'button';
        filterBtn.className = 'ai-scan-btn ai-scan-filter-btn';
        filterBtn.innerHTML = '📷 Take Photo of Filter';
        if (filterScanned) filterBtn.style.display = 'none';

        const filterStatus = document.createElement('div');
        filterStatus.className = 'ai-scan-status';
        if (filterScanned) { filterStatus.textContent = '✓ Filter scanned'; filterStatus.className = 'ai-scan-status ai-scan-success'; }

        filterInp.onchange = async e => {
          const file = e.target.files[0]; if (!file) return;
          filterInp.value = '';
          filterBtn.style.display = 'none';
          filterStatus.textContent = '⏳ Reading filter...';
          filterStatus.className = 'ai-scan-status ai-scan-loading';
          try {
            const dataUrl = await compressImage(file);
            data.hvacFilterPhoto = { dataUrl, timestamp: new Date().toISOString() };
            filterPreview.src = dataUrl;
            filterPreviewWrap.style.display = '';
            const prompt = 'Analyze this HVAC filter photo. Extract and return JSON with these exact keys: filterSize (e.g. "16x25x1" or null), mervRating (number or null), filterBrand (brand name on filter, string or null), filterCondition (one of: "Clean", "Dirty", "Very Dirty", "Damaged"), estimatedAge (one of: "New", "Less than 6 months", "6-12 months", "Over 1 year"), visibleRecallNotice (true or false), notes (any relevant visible text or observations, string or null). Return ONLY valid JSON, no other text.';
            const result = await callAnthropic(dataUrl, prompt);
            if (result.filterSize)    setVal('filterSize', result.filterSize);
            if (result.mervRating != null) setVal('mervRating', String(result.mervRating));
            if (result.filterBrand)   setVal('filterMakeModel', result.filterBrand);
            if (result.filterCondition) setVal('filterCondition', result.filterCondition);
            if (result.estimatedAge)  setVal('filterEstimatedAge', result.estimatedAge);
            if (result.notes)         setVal('filterNotes', result.notes);
            if (result.visibleRecallNotice) {
              setVal('filterRecallFlag', 'Yes');
              recallBanner.style.display = 'block';
            }
            filterScanned = true;
            filterStatus.textContent = '✓ Filter read — check details below';
            filterStatus.className = 'ai-scan-status ai-scan-success';
            syncConfirmCard();
            revealConfirmIfReady();
            changed();
          } catch (err) {
            filterBtn.style.display = '';
            filterStatus.textContent = '⚠️ Could not read filter — fill in manually below';
            filterStatus.className = 'ai-scan-status ai-scan-error';
            filterScanned = true;
            revealConfirmIfReady();
          }
        };
        filterBtn.onclick = () => filterInp.click();

        step2.appendChild(step2Header);
        step2.appendChild(step2Hint);
        step2.appendChild(filterInp);
        step2.appendChild(filterPreviewWrap);
        step2.appendChild(filterBtn);
        step2.appendChild(filterStatus);

        // ═══════════════════════════════════════════════════════
        // STEP 3 — Confirm card (hidden until both photos taken)
        // ═══════════════════════════════════════════════════════
        const recallBanner = document.createElement('div');
        recallBanner.className = 'ai-recall-banner';
        recallBanner.style.display = (data.filterRecallFlag === 'Yes') ? 'block' : 'none';
        recallBanner.textContent = '⚠️ Possible recall notice visible — verify with manufacturer';

        const confirmCard = document.createElement('div');
        confirmCard.style = 'background:#fff;border:2px solid #2C3F16;border-radius:12px;padding:16px;margin-bottom:4px;' + ((tagScanned || filterScanned) ? '' : 'display:none;');

        const confirmHeader = document.createElement('div');
        confirmHeader.style = 'display:flex;align-items:center;gap:10px;margin-bottom:14px;';
        const confirmNum = document.createElement('div');
        confirmNum.style = 'width:28px;height:28px;border-radius:50%;background:#2C3F16;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        confirmNum.textContent = '3';
        const confirmTitle = document.createElement('div');
        confirmTitle.style = 'font-weight:700;font-size:1rem;color:#2C3F16;';
        confirmTitle.textContent = 'Confirm & Correct';
        const confirmSubtitle = document.createElement('div');
        confirmSubtitle.style = 'font-size:0.8rem;color:#6a7a60;margin-top:1px;';
        confirmSubtitle.textContent = 'AI pre-filled these — verify and fix anything wrong';
        const confirmTitleWrap = document.createElement('div');
        confirmTitleWrap.appendChild(confirmTitle); confirmTitleWrap.appendChild(confirmSubtitle);
        confirmHeader.appendChild(confirmNum); confirmHeader.appendChild(confirmTitleWrap);
        confirmCard.appendChild(confirmHeader);

        function addConfirmRow(label, key, type, options) {
          const row = document.createElement('div');
          row.style = 'margin-bottom:12px;';
          row.appendChild(mkLabel(label));
          let inp;
          if (type === 'select') {
            inp = mkSelect(key, options);
          } else if (type === 'textarea') {
            inp = mkInput(key, '', 'textarea');
          } else {
            inp = mkInput(key, '', type || 'text');
          }
          inp.setAttribute('data-hvac-key', key);
          row.appendChild(inp);
          confirmCard.appendChild(row);
        }

        // ── Unit identity ────────────────────────────────────
        const unitSection = document.createElement('div');
        unitSection.style = 'background:#f4f8f0;border-radius:8px;padding:12px;margin-bottom:12px;';
        const unitSectionTitle = document.createElement('div');
        unitSectionTitle.style = 'font-size:12px;font-weight:700;color:#2C3F16;margin-bottom:10px;text-transform:uppercase;letter-spacing:.4px;';
        unitSectionTitle.textContent = '🏠 Unit Location';
        unitSection.appendChild(unitSectionTitle);

        const locRow = document.createElement('div');
        locRow.style = 'margin-bottom:0;';
        locRow.appendChild(mkLabel('Which unit is this? (confirm location in home)'));
        const locInp = mkInput('hvacUnitLocation', 'e.g. Basement furnace, Attic air handler, Hall closet', 'text');
        locInp.setAttribute('data-hvac-key', 'hvacUnitLocation');
        locRow.appendChild(locInp);
        unitSection.appendChild(locRow);
        confirmCard.appendChild(unitSection);

        // ── Unit specs (from tag scan) ───────────────────────
        const unitSpecsSection = document.createElement('div');
        unitSpecsSection.style = 'background:#f4f8f0;border-radius:8px;padding:12px;margin-bottom:12px;';
        const unitSpecsTitle = document.createElement('div');
        unitSpecsTitle.style = 'font-size:12px;font-weight:700;color:#2C3F16;margin-bottom:10px;text-transform:uppercase;letter-spacing:.4px;';
        unitSpecsTitle.textContent = '🔧 Unit Specs (from data tag)';
        unitSpecsSection.appendChild(unitSpecsTitle);

        function addSpecRow(label, key, placeholder) {
          const row = document.createElement('div');
          row.style = 'margin-bottom:10px;';
          row.appendChild(mkLabel(label));
          const inp = mkInput(key, placeholder || '', 'text');
          inp.setAttribute('data-hvac-key', key);
          row.appendChild(inp);
          unitSpecsSection.appendChild(row);
        }
        addSpecRow('Manufacturer / Brand', 'hvacManufacturer', 'e.g. Carrier, Lennox, Trane');
        addSpecRow('Model Number', 'hvacModel', '');
        addSpecRow('Serial Number', 'hvacSerial', '');
        confirmCard.appendChild(unitSpecsSection);

        // ── Filter specs (from filter scan) ─────────────────
        const filterSpecsSection = document.createElement('div');
        filterSpecsSection.style = 'background:#f4f8f0;border-radius:8px;padding:12px;margin-bottom:12px;';
        const filterSpecsTitle = document.createElement('div');
        filterSpecsTitle.style = 'font-size:12px;font-weight:700;color:#2C3F16;margin-bottom:10px;text-transform:uppercase;letter-spacing:.4px;';
        filterSpecsTitle.textContent = '🌬️ Filter (from filter scan)';
        filterSpecsSection.appendChild(filterSpecsTitle);

        function addFilterSpecRow(label, key, type, options, placeholder) {
          const row = document.createElement('div');
          row.style = 'margin-bottom:10px;';
          row.appendChild(mkLabel(label));
          let inp;
          if (type === 'select') { inp = mkSelect(key, options); }
          else { inp = mkInput(key, placeholder || '', 'text'); }
          inp.setAttribute('data-hvac-key', key);
          row.appendChild(inp);
          filterSpecsSection.appendChild(row);
        }
        addFilterSpecRow('Filter Size', 'filterSize', 'text', null, 'e.g. 16x25x1');
        addFilterSpecRow('MERV Rating', 'mervRating', 'text', null, 'e.g. 11');
        addFilterSpecRow('Filter Brand / Model', 'filterMakeModel', 'text', null, '');
        addFilterSpecRow('Filter Condition', 'filterCondition', 'select', ['Clean', 'Dirty', 'Very Dirty', 'Damaged']);
        addFilterSpecRow('Estimated Filter Age', 'filterEstimatedAge', 'select', ['New', 'Less than 6 months', '6-12 months', 'Over 1 year']);
        confirmCard.appendChild(filterSpecsSection);
        confirmCard.appendChild(recallBanner);

        // ── Recall flag ──────────────────────────────────────
        const recallRow = document.createElement('div');
        recallRow.style = 'margin-bottom:12px;';
        recallRow.appendChild(mkLabel('Recall Notice Visible?'));
        const recallSel = mkSelect('filterRecallFlag', ['Yes', 'No']);
        recallSel.setAttribute('data-hvac-key', 'filterRecallFlag');
        recallRow.appendChild(recallSel);
        recallSel.addEventListener('change', () => {
          recallBanner.style.display = recallSel.value === 'Yes' ? 'block' : 'none';
        });
        confirmCard.appendChild(recallRow);

        // ── Filter cleaned checkbox ──────────────────────────
        const cleanedRow = document.createElement('label');
        cleanedRow.style = 'display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid #e4edd8;font-size:0.95rem;cursor:pointer;margin-bottom:12px;';
        const cleanedCb = document.createElement('input');
        cleanedCb.type = 'checkbox';
        cleanedCb.style = 'width:18px;height:18px;flex-shrink:0;accent-color:#2C3F16;';
        cleanedCb.checked = !!(data.filterCleaned);
        cleanedCb.addEventListener('change', () => { data.filterCleaned = cleanedCb.checked; changed(); });
        cleanedRow.appendChild(cleanedCb);
        cleanedRow.appendChild(document.createTextNode('Filters checked and cleaned if needed'));
        confirmCard.appendChild(cleanedRow);

        // ── Notes ────────────────────────────────────────────
        const notesRow = document.createElement('div');
        notesRow.style = 'margin-bottom:0;';
        notesRow.appendChild(mkLabel('Notes (add anything the AI missed)'));
        const notesInp = mkInput('filterNotes', '🎙 Speak or type any observations...', 'textarea');
        notesInp.setAttribute('data-hvac-key', 'filterNotes');
        notesRow.appendChild(notesInp);
        confirmCard.appendChild(notesRow);

        // ── Show confirm card once either photo is taken ─────
        function revealConfirmIfReady() {
          if (tagScanned || filterScanned) {
            confirmCard.style.display = '';
            syncConfirmCard();
          }
        }
        revealConfirmIfReady();

        wrap.appendChild(step1);
        wrap.appendChild(step2);
        wrap.appendChild(confirmCard);
        return wrap;
      }
      case 'collapsible-section': {
        const details = document.createElement('details');
        details.style = 'margin: 8px 0;';
        // Auto-open Room Registry if no rooms have been named yet
        let defaultOpen = f.defaultOpen !== false;
        if (f.title && f.title.includes('Room Registry') && inspection && !inspection.regRoom_1_name) {
          defaultOpen = true;
        }
        if (defaultOpen) details.setAttribute('open', '');
        const summary = document.createElement('summary');
        summary.style = 'font-weight:700;font-size:1rem;color:var(--primary);cursor:pointer;padding:10px 0;list-style:none;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid var(--accent-light);';
        summary.innerHTML = f.title + ' <span style="font-size:0.8rem;color:var(--text-muted)">▾</span>';
        details.appendChild(summary);
        const inner = document.createElement('div');
        inner.style = 'padding-top:8px;';
        let built = false;
        function buildInner() {
          if (built) return;
          built = true;
          (f.fields || []).forEach(sf => {
            const rendered = renderField(sf, data, onChange, inspection, onSave);
            if (rendered) inner.appendChild(rendered);
          });
        }
        if (defaultOpen) buildInner();
        else details.addEventListener('toggle', () => { if (details.open) buildInner(); }, { once: true });
        details.appendChild(inner);
        return details;
      }
      case 'process-checklist': {
        // Process steps - collapsible. Collapsed by default for experienced inspectors.
        const isExperienced = localStorage.getItem('inhaus_experienced') === 'true';
        const defaultOpen = !isExperienced;
        const details = document.createElement('details');
        details.className = 'process-checklist-details';
        details.style = 'margin:8px 0;background:#f8faf5;border:1.5px solid #c8d8b8;border-radius:10px;overflow:hidden;';
        if (defaultOpen) details.setAttribute('open', '');
        const summary = document.createElement('summary');
        summary.style = 'font-weight:600;font-size:0.9rem;color:#5a7a3a;cursor:pointer;padding:10px 14px;list-style:none;display:flex;justify-content:space-between;align-items:center;';
        summary.innerHTML = '\uD83D\uDCCB ' + (f.title || 'Process Steps') + ' <span style="font-size:0.75rem;opacity:0.7">tap to ' + (defaultOpen ? 'collapse' : 'expand') + '</span>';
        summary.addEventListener('click', () => {
          setTimeout(() => {
            const arrow = summary.querySelector('span');
            if (arrow) arrow.textContent = details.hasAttribute('open') ? 'tap to collapse' : 'tap to expand';
          }, 10);
        });
        details.appendChild(summary);
        const inner = document.createElement('div');
        inner.style = 'padding:8px 14px 12px;';
        (f.items || []).forEach(item => {
          const row = document.createElement('label');
          row.style = 'display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid #e4edd8;cursor:pointer;font-size:0.95rem;';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.style = 'margin-top:2px;width:18px;height:18px;flex-shrink:0;accent-color:#2C3F16;';
          cb.checked = !!(data[item.key]);
          cb.addEventListener('change', () => { data[item.key] = cb.checked; changed(); });
          const lbl = document.createElement('span');
          lbl.textContent = item.label;
          lbl.style = 'line-height:1.4;';
          row.appendChild(cb);
          row.appendChild(lbl);
          inner.appendChild(row);
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
        if (Array.isArray(f.mergePhotoKeys)) {
          let migrated = false;
          const existingIds = new Set(data[pk].map(p => p && p.photoId).filter(Boolean));
          f.mergePhotoKeys.forEach(aliasKey => {
            const oldPhotos = Array.isArray(data[aliasKey]) ? data[aliasKey] : [];
            oldPhotos.forEach(photo => {
              if (!photo || !photo.photoId || existingIds.has(photo.photoId)) return;
              data[pk].push(photo);
              existingIds.add(photo.photoId);
              migrated = true;
            });
            if (oldPhotos.length) {
              data[aliasKey] = [];
              migrated = true;
            }
          });
          if (migrated) changed();
        }
        return renderPhoto(
          data[pk],
          () => { changed(); },
          data.roomName || data._roomName || '',
          f.stepName || '',
          data.inspectionId || (window.inspection && window.inspection.inspectionId) || '',
          { label: f.label || f.photoLabel || 'Photos', hideLabel: !!f.hideLabel }
        );
      }
      case 'timer':
        return renderTimer(f.timerId || (f.key + '-' + (data._stepId || '')), f.label, f.duration, inspection, onSave);
      case 'ai-room-summary': {
        const PROXY_URL = 'https://inhaus-vision-proxy.mjordanjay.workers.dev';
        const wrap = document.createElement('div');
        wrap.className = 'field-group ai-room-summary-wrap';

        function buildSummaryUI() {
          wrap.innerHTML = '';

          const genBtn = document.createElement('button');
          genBtn.type = 'button';
          genBtn.className = 'btn btn-outline btn-full ai-room-summary-btn';
          genBtn.textContent = '\uD83D\uDCDD Generate Room Summary';

          const ta = document.createElement('textarea');
          ta.className = 'field-textarea ai-room-summary-textarea';
          ta.placeholder = 'Tap to generate, then review and edit\u2026';
          ta.value = data.aiSummary || '';
          ta.addEventListener('input', () => { data.aiSummary = ta.value; changed(); });

          const hint = document.createElement('div');
          hint.className = 'ai-room-summary-hint';
          hint.textContent = 'Generated by AI \u2014 review and edit as needed';

          async function doGenerate() {
            genBtn.disabled = true;
            genBtn.textContent = '\u23F3 Generating\u2026';

            // Collect all step data (skip private/internal keys)
            const summaryData = {};
            for (const [k, v] of Object.entries(data)) {
              if (!k.startsWith('_')) summaryData[k] = v;
            }

            // Filter to meaningful fields only - skip photo arrays, internal keys, empty values
            const meaningful = {};
            const skipKeys = new Set(['roomName','aiSummary','aiSummaryGeneratedAt','_roomName','_stepId']);
            for (const [k, v] of Object.entries(summaryData)) {
              if (skipKeys.has(k)) continue;
              if (v === null || v === undefined || v === '' || v === false) continue;
              if (Array.isArray(v) && v.length === 0) continue;
              meaningful[k] = v;
            }

            const prompt = 'You are writing brief internal notes for a home health inspection report.' +
              ' Room: ' + (summaryData.roomName || 'Unknown') +
              '. Data: ' + JSON.stringify(meaningful) +
              '\n\nWrite 1-3 plain sentences. Rules:' +
              '\n- Use calm, factual language. Never use words like "concerning", "alarming", "dangerous", or "significant".' +
              '\n- Only mention things that need follow-up or re-testing. Skip anything that is normal.' +
              '\n- If something needs re-checking, say when: "recommend re-test in 6 months" or "follow up after lab results".' +
              '\n- Include actual values when relevant (e.g. "humidity at 68%").' +
              '\n- Write in plain prose - no bullet points, no headers, no markdown.' +
              '\n- If nothing needs follow-up, write only: No items flagged.' +
              '\n- Maximum 3 sentences. Be brief.';

            try {
              const resp = await fetch(PROXY_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ prompt })
              });
              if (!resp.ok) throw new Error('API_ERROR ' + resp.status);
              const result = await resp.json();
              const text = result.content && result.content[0] && result.content[0].text;
              if (!text) throw new Error('EMPTY_RESPONSE');
              data.aiSummary = text;
              data.aiSummaryGeneratedAt = new Date().toISOString();
              ta.value = text;
              changed();
              genBtn.textContent = '\u2713 Summary Generated';
              setTimeout(() => {
                genBtn.disabled = false;
                genBtn.textContent = '\u21BA Regenerate';
              }, 2000);
            } catch (err) {
              genBtn.disabled = false;
              genBtn.textContent = '\uD83D\uDCDD Generate Room Summary';
              showToast('AI unavailable - please write summary manually');
            }
          }

          genBtn.onclick = doGenerate;
          wrap.appendChild(genBtn);
          wrap.appendChild(ta);
          wrap.appendChild(hint);

          if (data.aiSummary) {
            const regenLink = document.createElement('a');
            regenLink.href = '#';
            regenLink.className = 'ai-room-summary-regen';
            regenLink.textContent = 'Regenerate';
            regenLink.onclick = (e) => { e.preventDefault(); doGenerate(); };
            wrap.appendChild(regenLink);
          }
        }

        buildSummaryUI();
        return wrap;
      }

      case 'ai-followup-plan': {
        const PROXY_URL = 'https://inhaus-vision-proxy.mjordanjay.workers.dev';
        const wrap = document.createElement('div');
        wrap.className = 'field-group ai-room-summary-wrap';

        function buildPlanUI() {
          wrap.innerHTML = '';

          const genBtn = document.createElement('button');
          genBtn.type = 'button';
          genBtn.className = 'btn btn-primary btn-full ai-room-summary-btn';
          genBtn.textContent = '\uD83D\uDCCB Generate Follow-Up Plan';

          const ta = document.createElement('textarea');
          ta.className = 'field-textarea ai-room-summary-textarea';
          ta.rows = 10;
          ta.placeholder = 'Tap to generate the follow-up inspection plan\u2026';
          ta.value = data.aiFollowUpPlan || '';
          ta.addEventListener('input', () => { data.aiFollowUpPlan = ta.value; changed(); });

          const hint = document.createElement('div');
          hint.className = 'ai-room-summary-hint';
          hint.textContent = 'AI-generated follow-up plan \u2014 review and edit before client handoff';

          async function doGenerate() {
            genBtn.disabled = true;
            genBtn.textContent = '\u23F3 Generating plan\u2026';

            // Collect all room findings flagged during inspection
            const roomFindings = [];
            if (window.inspection && window.inspection.stepData) {
              const sd = window.inspection.stepData;
              for (const [stepId, stepData] of Object.entries(sd)) {
                if (stepData && stepData.aiSummary && stepData.aiSummary.trim() !== 'No concerns identified.') {
                  roomFindings.push({ room: stepData.roomName || stepId, findings: stepData.aiSummary });
                }
              }
            }

            const insp = window.inspection || {};
            const facts = {
              address: insp.propertyAddress || '',
              waterSource: insp.waterSource || '',
              yearBuilt: (insp.stepData && insp.stepData['property-details'] && insp.stepData['property-details'].yearBuilt) || '',
              radonReading: (insp.stepData && insp.stepData.radon && insp.stepData.radon.radonReading) || '',
              hvacFilterCondition: (insp.stepData && insp.stepData.utility && insp.stepData.utility.filterCondition) || '',
              hvacFilterAge: (insp.stepData && insp.stepData.utility && insp.stepData.utility.filterEstimatedAge) || '',
            };

            const findingsText = roomFindings.length
              ? roomFindings.map(r => '- ' + r.room + ': ' + r.findings).join('\n')
              : 'No specific room concerns flagged.';

            const prompt = 'You are a professional home health inspector writing a follow-up plan for a client. Write in plain, natural prose — no bullet points, no asterisks, no markdown, no bold, no headers with pound signs or dashes. Write like a professional writing a note, not like an AI generating a report.\n\n'
              + 'Property: ' + facts.address + '\n'
              + 'Year Built: ' + (facts.yearBuilt || 'Unknown') + '\n'
              + 'Water Source: ' + (facts.waterSource || 'Unknown') + '\n'
              + 'Radon Reading: ' + (facts.radonReading || 'Not recorded') + '\n'
              + 'HVAC Filter Condition: ' + (facts.hvacFilterCondition || 'Not recorded') + '\n\n'
              + 'Concerns flagged during this inspection:\n' + findingsText + '\n\n'
              + 'Instructions:\n'
              + '- Write in plain paragraphs grouped by timeframe: Immediate (within 30 days), 3 to 6 months, 12 months, and annually.\n'
              + '- Only include timeframes that have actual items based on the findings above. Skip empty timeframes.\n'
              + '- For each item explain what to check, why it matters, and what action is needed.\n'
              + '- End with one sentence summarizing the overall home health status.\n'
              + '- Do not use bullet points, asterisks, dashes as list markers, markdown formatting, or any special characters for emphasis. Plain text only.\n'
              + '- Write each timeframe as a short label followed by a colon, then the items in sentence form. Example: Immediate: The kitchen faucet showed elevated lead levels and should be retested within 30 days using a certified lab.\n'
              + '- Be direct and specific. No generic filler sentences.';

            try {
              const resp = await fetch(PROXY_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ prompt })
              });
              if (!resp.ok) throw new Error('API_ERROR ' + resp.status);
              const result = await resp.json();
              const text = result.content && result.content[0] && result.content[0].text;
              if (!text) throw new Error('EMPTY_RESPONSE');
              data.aiFollowUpPlan = text;
              data.aiFollowUpPlanGeneratedAt = new Date().toISOString();
              ta.value = text;
              changed();
              genBtn.textContent = '\u2713 Plan Generated';
              setTimeout(() => { genBtn.disabled = false; genBtn.textContent = '\u21BA Regenerate Plan'; }, 2000);
            } catch (err) {
              genBtn.disabled = false;
              genBtn.textContent = '\uD83D\uDCCB Generate Follow-Up Plan';
              showToast('Could not generate plan \u2014 please write manually');
            }
          }

          genBtn.onclick = doGenerate;
          wrap.appendChild(genBtn);
          wrap.appendChild(ta);
          wrap.appendChild(hint);
        }

        buildPlanUI();
        return wrap;
      }

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
            changed();
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
      // Free navigation - all phases are tappable (v60)
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
      // Support arrays in both data value (chips) and target (multiple allowed values)
      const visible = Array.isArray(target)
        ? (Array.isArray(dv) ? target.some(t => dv.includes(t)) : target.includes(dv))
        : (Array.isArray(dv) ? dv.includes(target) : dv === target);
      if (visible && w.getAttribute('data-showif-built') !== 'true' && typeof w._buildShowIf === 'function') {
        w._buildShowIf();
      }
      w.classList.toggle('showif-hidden', !visible);
    });
  }

  // ── Export ─────────────────────────────────────────────────
  // ── Global: save a photo to device camera roll ─────────────────
  window.savePhotoToDevice = async function(dataUrl, photoId) {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const filename = 'inhaus-' + (photoId || 'photo') + '.jpg';
      const file = new File([blob], filename, { type: 'image/jpeg' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'InHaus Photo' });
      }
    } catch (e) {
      if (e && e.name !== 'AbortError') console.warn('savePhotoToDevice failed:', e);
    }
  };

  window.UI = {
    el, frag, lazyImage, renderField, renderProgressBar, renderStatusBar, renderTimersBar,
    renderText, renderTextarea, renderNumber, renderSelect, renderYesNo, renderRadio,
    renderCheck, renderChecklist, renderChips, renderReading, renderPhoto, renderTimer,
    renderHeading, renderInfo, renderDivider, compressImage, playAlert, fmtDate, fmtDuration,
    micBtn, showToast, flashUncheckedItems, updateShowIf, openAnnotationEditor
  };
})();
