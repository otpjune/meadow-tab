'use strict';
// Plays the chime 4 times, then tells the background script it is done.
let audio = null, plays = 0;
chrome.runtime.onMessage.addListener(m => {
  if (m.target !== 'offscreen') return;
  if (m.type === 'play') {
    audio?.pause();
    plays = 0;
    audio = new Audio('chime.wav');
    audio.onended = () => {
      if (++plays < 4) { audio.currentTime = 0; audio.play(); }
      else chrome.runtime.sendMessage({ type: 'sound-ended' });
    };
    audio.play();
  } else if (m.type === 'stop') {
    audio?.pause();
    audio = null;
  }
});
