'use strict';
// Handles the timer finishing: notification + sound, even when no Meadow Tab page is open.

async function hasOffscreen() {
  const c = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return c.length > 0;
}
async function ring() {
  if (!(await hasOffscreen())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play the timer sound when time is up'
    });
  }
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'play' });
}
async function stopSound() {
  chrome.notifications.clear('timer-done');
  if (await hasOffscreen()) {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' });
    await chrome.offscreen.closeDocument();
  }
}

let finishing = false;
async function finish() {
  if (finishing) return;
  finishing = true;
  try {
    const { timer } = await chrome.storage.local.get('timer');
    if (!timer || timer.status !== 'running') return;
    await chrome.storage.local.set({ timer: { status: 'done' } });
    chrome.notifications.create('timer-done', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: "Time's up",
      message: 'Your timer has finished.',
      priority: 2,
      requireInteraction: true,
      buttons: [{ title: 'Stop sound' }]
    });
    await ring();
  } finally {
    setTimeout(() => { finishing = false; }, 2000);
  }
}

chrome.alarms.onAlarm.addListener(a => { if (a.name === 'timer') finish(); });
chrome.runtime.onMessage.addListener(m => {
  if (m.target === 'offscreen') return;
  if (m.type === 'ring') finish();
  else if (m.type === 'stop-sound' || m.type === 'sound-ended') stopSound();
});
chrome.notifications.onClicked.addListener(id => { if (id === 'timer-done') stopSound(); });
chrome.notifications.onButtonClicked.addListener(id => { if (id === 'timer-done') stopSound(); });
