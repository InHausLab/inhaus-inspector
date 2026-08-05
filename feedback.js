// InHaus Inspector - App improvement feedback capture and durable retry queue
import { getInspection, getScreen } from './state.js?v=236';
import { cloudFetch } from './sync.js?v=236';
import { PHOTO_WORKER_URL } from './config.js?v=236';

let initialized = false;
let retryInProgress = false;
let activeRecorder = null;
let activeStream = null;
let recordingTimer = null;
let feedbackCapabilityConfirmed = false;

function feedbackId() {
  return 'APP-FEEDBACK-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function stopMediaTracks() {
  if (activeStream) activeStream.getTracks().forEach(track => track.stop());
  activeStream = null;
}

function currentContext() {
  const inspection = getInspection();
  const stepIdx = Number(inspection && inspection._lastStepIdx);
  const badge = document.getElementById('version-badge');
  return {
    inspectionId: inspection?.inspectionId || '',
    propertyAddress: inspection?.propertyAddress || '',
    inspectorName: inspection?.inspectorName || '',
    screen: getScreen() || '',
    stepIndex: Number.isFinite(stepIdx) ? stepIdx : '',
    appVersion: badge ? badge.textContent.trim() : '',
    pageUrl: location.href,
    userAgent: navigator.userAgent,
    online: navigator.onLine
  };
}

async function sendFeedback(feedback) {
  if (!feedbackCapabilityConfirmed) {
    const url = new URL(PHOTO_WORKER_URL + '/health');
    const response = await fetch(url.toString(), { cache: 'no-store' });
    if (!response.ok) throw new Error('Feedback cloud check failed.');
    const capabilities = await response.json();
    if (!capabilities || capabilities.capabilities?.appFeedback !== true) {
      throw new Error('App feedback cloud storage is not deployed yet.');
    }
    feedbackCapabilityConfirmed = true;
  }
  const result = await cloudFetch({ action: 'appFeedback', feedback });
  if (!result || result.saved !== true) throw new Error('Cloud did not confirm the feedback save.');
  if (result.trackerMirrored !== true) throw new Error('Cloud saved the suggestion but Tanner\'s tracker is not updated yet.');
  if (window.DB?.removeAppFeedback) await window.DB.removeAppFeedback(feedback.feedbackId);
  return result;
}

async function queueFeedback(feedback) {
  if (!window.DB?.saveAppFeedback) throw new Error('Offline feedback storage is unavailable.');
  await window.DB.saveAppFeedback(feedback);
}

export async function retryQueuedAppFeedback() {
  if (retryInProgress || !navigator.onLine || !window.DB?.getAppFeedbackQueue) return 0;
  retryInProgress = true;
  let sent = 0;
  try {
    const queue = await window.DB.getAppFeedbackQueue();
    for (const feedback of queue) {
      try {
        await sendFeedback(feedback);
        sent += 1;
      } catch (err) {
        console.warn('Queued app feedback retry paused:', err);
        break;
      }
    }
  } finally {
    retryInProgress = false;
  }
  return sent;
}

function closeFeedbackOverlay() {
  if (activeRecorder && activeRecorder.state === 'recording') activeRecorder.stop();
  activeRecorder = null;
  stopMediaTracks();
  if (recordingTimer) clearInterval(recordingTimer);
  recordingTimer = null;
  const overlay = document.getElementById('app-feedback-overlay');
  if (overlay) overlay.remove();
}

function preferredAudioMimeType() {
  if (!window.MediaRecorder) return '';
  const choices = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  return choices.find(type => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) || '';
}

function openFeedbackOverlay() {
  if (document.getElementById('app-feedback-overlay')) return;
  const context = currentContext();
  let screenshotDataUrl = '';
  let screenshotName = '';
  let voiceDataUrl = '';
  let voiceMimeType = '';
  let recordingStartedAt = 0;

  const overlay = UI.el('div', { id: 'app-feedback-overlay', className: 'app-feedback-overlay', role: 'dialog', 'aria-modal': 'true' });
  const panel = UI.el('div', { className: 'app-feedback-panel' });
  const heading = UI.el('div', { className: 'app-feedback-heading' }, [
    UI.el('div', null, [
      UI.el('h2', null, 'Suggest an App Fix'),
      UI.el('p', null, 'Show us what happened and tell us what should change.')
    ]),
    UI.el('button', { type: 'button', className: 'app-feedback-close', onClick: closeFeedbackOverlay, 'aria-label': 'Close feedback' }, '\u00d7')
  ]);
  panel.appendChild(heading);

  const note = UI.el('textarea', {
    className: 'field-input field-textarea app-feedback-note',
    rows: '4',
    placeholder: 'Optional typed note — what should we fix?'
  });
  panel.appendChild(UI.el('label', { className: 'field-label' }, 'What should we fix?'));
  panel.appendChild(note);

  const screenshotStatus = UI.el('div', { className: 'app-feedback-media-status' }, 'No screenshot attached');
  const screenshotPreview = UI.el('div', { className: 'app-feedback-preview' });
  const screenshotInput = UI.el('input', { type: 'file', accept: 'image/*', className: 'hidden', id: 'app-feedback-screenshot' });
  screenshotInput.addEventListener('change', async () => {
    const file = screenshotInput.files && screenshotInput.files[0];
    if (!file) return;
    screenshotStatus.textContent = 'Preparing screenshot...';
    try {
      screenshotDataUrl = await UI.compressImage(file);
      screenshotName = file.name || 'screenshot.jpg';
      screenshotPreview.innerHTML = '';
      screenshotPreview.appendChild(UI.el('img', { src: screenshotDataUrl, alt: 'Attached screenshot' }));
      screenshotStatus.textContent = '\u2713 Screenshot attached';
    } catch (err) {
      screenshotDataUrl = '';
      screenshotStatus.textContent = 'Could not read that screenshot. Please choose it again.';
    }
  });
  const screenshotButton = UI.el('button', {
    type: 'button', className: 'btn btn-outline btn-full',
    onClick: () => screenshotInput.click()
  }, '\ud83d\udcf7 Attach Screenshot');
  panel.appendChild(UI.el('div', { className: 'app-feedback-section' }, [
    UI.el('label', { className: 'field-label' }, 'Screenshot or photo'),
    UI.el('p', { className: 'app-feedback-help' }, 'Take an iPhone screenshot first, then choose it from Photos.'),
    screenshotButton, screenshotInput, screenshotStatus, screenshotPreview
  ]));

  const voiceStatus = UI.el('div', { className: 'app-feedback-media-status' }, 'No voice note recorded');
  const audioPreview = UI.el('div', { className: 'app-feedback-audio-preview' });
  const recordButton = UI.el('button', { type: 'button', className: 'btn btn-outline btn-full' }, '\ud83c\udf99\ufe0f Record Voice Note');

  async function stopRecording() {
    if (activeRecorder && activeRecorder.state === 'recording') activeRecorder.stop();
  }

  recordButton.addEventListener('click', async () => {
    if (activeRecorder && activeRecorder.state === 'recording') {
      stopRecording();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      voiceStatus.textContent = 'Voice recording is not supported in this browser. Type the note instead.';
      return;
    }
    try {
      activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredAudioMimeType();
      const chunks = [];
      activeRecorder = mimeType ? new MediaRecorder(activeStream, { mimeType }) : new MediaRecorder(activeStream);
      const recorder = activeRecorder;
      recorder.addEventListener('dataavailable', event => { if (event.data && event.data.size) chunks.push(event.data); });
      recorder.addEventListener('stop', async () => {
        if (recordingTimer) clearInterval(recordingTimer);
        recordingTimer = null;
        stopMediaTracks();
        recordButton.textContent = '\ud83c\udf99\ufe0f Record Again';
        recordButton.classList.remove('recording');
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
          voiceMimeType = blob.type || 'audio/webm';
          voiceDataUrl = await blobToDataUrl(blob);
          audioPreview.innerHTML = '';
          audioPreview.appendChild(UI.el('audio', { controls: 'controls', src: voiceDataUrl }));
          voiceStatus.textContent = '\u2713 Voice note ready';
        } catch (err) {
          voiceDataUrl = '';
          voiceStatus.textContent = 'Could not save the recording. Please record it again.';
        }
      }, { once: true });
      activeRecorder.start(1000);
      recordingStartedAt = Date.now();
      recordButton.textContent = '\u23f9 Stop Recording';
      recordButton.classList.add('recording');
      recordingTimer = setInterval(() => {
        const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
        voiceStatus.textContent = 'Recording ' + seconds + ' sec (60 sec maximum)';
        if (seconds >= 60) stopRecording();
      }, 500);
    } catch (err) {
      stopMediaTracks();
      voiceStatus.textContent = 'Microphone permission was not granted. Type the note instead.';
    }
  });
  panel.appendChild(UI.el('div', { className: 'app-feedback-section' }, [
    UI.el('label', { className: 'field-label' }, 'Voice note'),
    recordButton, voiceStatus, audioPreview
  ]));
  panel.appendChild(UI.el('p', { className: 'app-feedback-help' },
    'Suggestions are saved in the shared Things to Fix tracker that Tanner monitors.'
  ));

  const sendStatus = UI.el('div', { className: 'app-feedback-send-status', role: 'status' });
  const sendButton = UI.el('button', { type: 'button', className: 'btn btn-primary btn-full' }, 'Send Suggestion');
  sendButton.addEventListener('click', async () => {
    if (activeRecorder && activeRecorder.state === 'recording') {
      sendStatus.textContent = 'Stop the voice recording before sending.';
      return;
    }
    const typedNote = note.value.trim();
    if (!typedNote && !screenshotDataUrl && !voiceDataUrl) {
      sendStatus.textContent = 'Add a screenshot, voice note, or typed note first.';
      return;
    }
    const feedback = {
      feedbackId: feedbackId(),
      submittedAt: new Date().toISOString(),
      note: typedNote,
      screenshotDataUrl,
      screenshotName,
      voiceDataUrl,
      voiceMimeType,
      context
    };
    sendButton.disabled = true;
    sendButton.textContent = 'Sending...';
    sendStatus.textContent = '';
    try {
      await sendFeedback(feedback);
      sendStatus.textContent = '\u2713 Saved in the shared Things to Fix tracker for Tanner';
      sendButton.textContent = 'Sent';
      setTimeout(closeFeedbackOverlay, 900);
    } catch (err) {
      try {
        await queueFeedback(feedback);
        sendStatus.textContent = '\u2713 Saved on this phone. It will send automatically when the cloud is available.';
        sendButton.textContent = 'Saved for Retry';
        setTimeout(closeFeedbackOverlay, 1600);
      } catch (queueErr) {
        sendStatus.textContent = 'Could not save this suggestion. Keep this screen open and try again.';
        sendButton.disabled = false;
        sendButton.textContent = 'Try Again';
      }
    }
  });
  panel.appendChild(sendStatus);
  panel.appendChild(sendButton);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function mountFeedbackButton() {
  if (document.getElementById('app-feedback-button')) return;
  const button = UI.el('button', {
    id: 'app-feedback-button',
    type: 'button',
    className: 'app-feedback-button',
    onClick: openFeedbackOverlay,
    'aria-label': 'Suggest an app fix'
  }, '\ud83d\udca1');
  document.body.appendChild(button);
}

export function initAppFeedback() {
  if (initialized) return;
  initialized = true;
  mountFeedbackButton();
  window.addEventListener('online', retryQueuedAppFeedback);
  setTimeout(retryQueuedAppFeedback, 1500);
}
