const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzwyXsEmFCBkkRYIA0VXBCd89WWt4n2YqSAlJXRU477g7ws7_JitbZpvr4GopEQ2UqlXQ/exec';

exports.handler = async function handler() {
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        syncSecret: 'ihl-sync-2026',
        _checkpoint: true,
        inspectionId: 'INH-READINESS-PROBE',
        status: 'prepared'
      }),
      redirect: 'follow'
    });
    const text = await response.text();
    let bridge;
    try {
      bridge = JSON.parse(text);
    } catch (err) {
      bridge = null;
    }
    const ok = response.ok && bridge && bridge.status === 'ok';
    return {
      statusCode: ok ? 200 : 502,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({
        status: ok ? 'ok' : 'error',
        upstreamStatus: response.status,
        checkpointed: Boolean(bridge && bridge.checkpointed),
        message: ok ? 'Apps Script POST verified' : (bridge && bridge.message) || text.slice(0, 160)
      })
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ status: 'error', message: err.message || 'Apps Script POST check failed' })
    };
  }
};
