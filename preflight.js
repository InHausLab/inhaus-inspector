#!/usr/bin/env node
// InHaus Inspector — Pre-flight check
// Run before every deploy: node preflight.js
// Checks every external dependency. All must pass before shipping.

const https = require('https');
const fs = require('fs');

// Load config values directly from config.js
const configRaw = fs.readFileSync('./config.js', 'utf8');
const get = (key) => { const m = configRaw.match(new RegExp(`export const ${key} = '([^']+)'`)); return m ? m[1] : null; };

const SCRIPT_URL = get('GOOGLE_SCRIPT_URL');
const WORKER_URL = get('PHOTO_WORKER_URL');
const UPLOAD_SECRET = get('PHOTO_UPLOAD_SECRET');

// Load Supabase creds
const supaCreds = JSON.parse(fs.readFileSync(process.env.HOME + '/.openclaw/credentials/supabase_inhaus.json', 'utf8'));
const SUPA_URL = supaCreds.url || 'https://kvpaqvieacccojkkxqul.supabase.co';
const SUPA_KEY = supaCreds.service_role_key;

let passed = 0, failed = 0;
const results = [];

function pass(name, detail) {
  console.log('  ✅ ' + name + (detail ? ' — ' + detail : ''));
  results.push({ name, ok: true });
  passed++;
}
function fail(name, detail) {
  console.log('  ❌ ' + name + (detail ? ' — ' + detail : ''));
  results.push({ name, ok: false, detail });
  failed++;
}

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      timeout: 10000
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function run() {
  console.log('\n' + '═'.repeat(55));
  console.log('  InHaus Inspector Pre-flight Check');
  console.log('  ' + new Date().toISOString());
  console.log('═'.repeat(55));

  // ── 1. Netlify app live ──────────────────────────────────
  console.log('\n[1] Netlify app...');
  try {
    const r = await fetch('https://inhaus-inspector.netlify.app/service-worker.js');
    const version = (r.body.match(/CACHE_NAME = '(inhaus-v\d+)'/) || [])[1];
    if (r.status === 200 && version) pass('Netlify live', version);
    else fail('Netlify', 'status ' + r.status + ', version: ' + version);
  } catch(e) { fail('Netlify', e.message); }

  // ── 2. Apps Script ping ──────────────────────────────────
  console.log('\n[2] Apps Script...');
  if (!SCRIPT_URL) { fail('Apps Script URL', 'not set in config.js'); }
  else {
    try {
      const r = await fetch(SCRIPT_URL + '?action=ping');
      // Follow redirect
      if (r.status === 302 || r.status === 301) {
        const loc = r.headers.location;
        const r2 = await fetch(loc);
        try {
          const d = JSON.parse(r2.body);
          if (d.status === 'ok') pass('Apps Script ping', d.message || 'ok');
          else fail('Apps Script ping', JSON.stringify(d));
        } catch(e) { fail('Apps Script ping', 'HTML response — deployment dead'); }
      } else {
        try {
          const d = JSON.parse(r.body);
          if (d.status === 'ok') pass('Apps Script ping', d.message || 'ok');
          else fail('Apps Script ping', JSON.stringify(d));
        } catch(e) { fail('Apps Script ping', 'Non-JSON response — deployment dead. Body: ' + r.body.slice(0,100)); }
      }
    } catch(e) { fail('Apps Script', e.message); }
  }

  // ── 3. CF Worker /sign ───────────────────────────────────
  console.log('\n[3] CF Worker...');
  if (!WORKER_URL || !UPLOAD_SECRET) { fail('CF Worker config', 'WORKER_URL or UPLOAD_SECRET missing'); }
  else {
    try {
      const r = await fetch(WORKER_URL + '/sign', {
        method: 'POST',
        body: JSON.stringify({ inspectionId: 'preflight-test', photoId: 'preflight-photo', contentType: 'image/jpeg', sharedSecret: UPLOAD_SECRET })
      });
      const d = JSON.parse(r.body);
      if (d.signedUrl) pass('CF Worker /sign', 'signed URL returned');
      else fail('CF Worker /sign', JSON.stringify(d).slice(0, 100));
    } catch(e) { fail('CF Worker /sign', e.message); }

    // /confirmed endpoint
    try {
      const r = await fetch(WORKER_URL + '/confirmed', {
        method: 'POST',
        body: JSON.stringify({ inspectionId: 'preflight-test', sharedSecret: UPLOAD_SECRET })
      });
      const d = JSON.parse(r.body);
      if (Array.isArray(d.photoIds)) pass('CF Worker /confirmed', 'endpoint ok');
      else fail('CF Worker /confirmed', JSON.stringify(d).slice(0, 100));
    } catch(e) { fail('CF Worker /confirmed', e.message); }
  }

  // ── 4. Supabase ──────────────────────────────────────────
  console.log('\n[4] Supabase...');
  try {
    const r = await fetch(SUPA_URL + '/rest/v1/inspector_photo_uploads?limit=1&select=photo_id', {
      headers: { 'apikey': SUPA_KEY, 'Authorization': '***' + SUPA_KEY }
    });
    if (r.status === 200) {
      const d = JSON.parse(r.body);
      pass('Supabase API', 'reachable, ' + d.length + ' row(s) returned');
    } else fail('Supabase API', 'status ' + r.status + ': ' + r.body.slice(0, 100));
  } catch(e) { fail('Supabase', e.message); }

  // ── 5. Apps Script list (data endpoint) ─────────────────
  console.log('\n[5] Apps Script list endpoint...');
  if (SCRIPT_URL) {
    try {
      // Try common tokens
      const tokens = ['***', '***', '***'];
      let found = false;
      for (const token of tokens) {
        const r = await fetch(SCRIPT_URL + '?action=list&token=' + token);
        try {
          const d = JSON.parse(r.body);
          if (d.status === 'ok') {
            pass('Apps Script list', token + ' — ' + (d.count || 0) + ' inspections');
            found = true;
            break;
          }
        } catch(e) {}
      }
      if (!found) fail('Apps Script list', 'all tokens rejected — check REVIEW_ACCESS_TOKEN in Script Properties');
    } catch(e) { fail('Apps Script list', e.message); }
  }

  // ── 6. Version consistency ───────────────────────────────
  console.log('\n[6] Version consistency...');
  try {
    const sw = fs.readFileSync('./service-worker.js', 'utf8');
    const html = fs.readFileSync('./index.html', 'utf8');
    const swVer = (sw.match(/CACHE_NAME = 'inhaus-v(\d+)'/) || [])[1];
    const htmlVer = (html.match(/id="version-badge">v(\d+)/) || [])[1];
    const configVers = [...configRaw.matchAll(/\?v=(\d+)/g)].map(m => m[1]);
    const allMatch = swVer && htmlVer && swVer === htmlVer && configVers.every(v => v === swVer);
    if (allMatch) pass('Version consistent', 'v' + swVer + ' everywhere');
    else fail('Version mismatch', 'SW:' + swVer + ' HTML:' + htmlVer + ' config stale versions:' + [...new Set(configVers.filter(v=>v!==swVer))].join(','));
  } catch(e) { fail('Version check', e.message); }

  // ── Summary ──────────────────────────────────────────────
  console.log('\n' + '═'.repeat(55));
  if (failed === 0) {
    console.log('  ✅ ALL CHECKS PASSED (' + passed + '/' + (passed+failed) + ') — OK TO DEPLOY');
  } else {
    console.log('  ❌ ' + failed + ' CHECK(S) FAILED — DO NOT DEPLOY');
    console.log('\n  Fix before shipping:');
    results.filter(r => !r.ok).forEach(r => console.log('  • ' + r.name + ': ' + (r.detail || '')));
  }
  console.log('═'.repeat(55) + '\n');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('Preflight crashed:', e); process.exit(1); });
