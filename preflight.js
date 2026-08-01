#!/usr/bin/env node
// InHaus Inspector — Pre-flight check
// Run before every deploy: node preflight.js
// Checks every external dependency. All must pass before shipping.

const https = require('https');
const fs = require('fs');

// Load config values directly from config.js
const configRaw = fs.readFileSync('./config.js', 'utf8');
const get = (key) => { const m = configRaw.match(new RegExp(`export const ${key} = '([^']+)'`)); return m ? m[1] : null; };

const WORKER_URL = get('PHOTO_WORKER_URL');
const UPLOAD_SECRET = get('PHOTO_UPLOAD_SECRET');
const FIELD_TOKEN = get('FIELD_RESUME_TOKEN');

// Load Supabase creds
const supaPath = process.env.HOME + '/.openclaw/credentials/supabase_inhaus.json';
const supaCreds = fs.existsSync(supaPath) ? JSON.parse(fs.readFileSync(supaPath, 'utf8')) : {};
const SUPA_URL = supaCreds.url || 'https://kvpaqvieacccojkkxqul.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY || supaCreds.service_role_key || '';

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

  // ── 2. Worker health and required cloud routes ───────────
  console.log('\n[2] Cloud Worker health...');
  if (!WORKER_URL) { fail('Cloud Worker URL', 'not set in config.js'); }
  else {
    try {
      const r = await fetch(WORKER_URL + '/health');
      const d = JSON.parse(r.body);
      const requiredRoutes = [
        'POST /start-inspection-shell',
        'POST /inspections/save',
        'POST /inspections/team-merge',
        'GET /inspections/active',
        'GET /inspections/:inspectionId',
        'POST /handoff-jobs'
      ];
      const missing = requiredRoutes.filter(route => !Array.isArray(d.routes) || !d.routes.includes(route));
      if (r.status === 200 && d.status === 'ok' && missing.length === 0 && d.capabilities?.inspectionCloudApi === true) {
        pass('Cloud Worker health', d.version || 'ok');
      } else {
        fail('Cloud Worker health', missing.length ? 'missing routes: ' + missing.join(', ') : JSON.stringify(d).slice(0, 160));
      }
    } catch(e) { fail('Cloud Worker health', e.message); }
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
  if (!SUPA_KEY) {
    fail('Supabase credentials', 'set SUPABASE_SERVICE_KEY or install the local credentials file');
  } else try {
    const r = await fetch(SUPA_URL + '/rest/v1/inspector_photo_uploads?limit=1&select=photo_id', {
      headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY }
    });
    if (r.status === 200) {
      const d = JSON.parse(r.body);
      pass('Supabase API', 'reachable, ' + d.length + ' row(s) returned');
    } else fail('Supabase API', 'status ' + r.status + ': ' + r.body.slice(0, 100));
  } catch(e) { fail('Supabase', e.message); }

  // ── 5. Worker active inspection list ────────────────────
  console.log('\n[5] Cloud active inspection list...');
  if (WORKER_URL && FIELD_TOKEN) {
    try {
      const r = await fetch(WORKER_URL + '/inspections/active?token=' + encodeURIComponent(FIELD_TOKEN));
      const d = JSON.parse(r.body);
      if (r.status === 200 && d.status === 'ok' && Array.isArray(d.inspections)) {
        pass('Cloud active inspection list', d.count + ' active inspection(s)');
      } else fail('Cloud active inspection list', JSON.stringify(d).slice(0, 160));
    } catch(e) { fail('Cloud active inspection list', e.message); }
  } else fail('Cloud active inspection list', 'Worker URL or field token missing');

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
