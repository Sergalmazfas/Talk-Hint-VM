const UI = {
  ownerMessages: document.getElementById('ownerMessages'),
  guestMessages: document.getElementById('guestMessages'),
  hintsGrid: document.getElementById('hintsGrid'),
  debug: document.getElementById('debug'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  modeSelect: document.getElementById('modeSelect'),
  phoneInput: document.getElementById('phoneInput'),
  callBtn: document.getElementById('callBtn')
};

const hints = [
  { en: 'Could you explain that in more detail?', ru: 'Не могли бы вы объяснить это более подробно?' },
  { en: 'I understand your concern. Let me check that for you.', ru: 'Я понимаю вашу озабоченность. Позвольте мне проверить это для вас.' },
  { en: 'Thank you for your patience. I\'ll resolve this issue shortly.', ru: 'Спасибо за ваше терпение. Я скоро решу эту проблему.' }
];

let socket = null;
let currentMode = 'universal';
let reconnectTimeout = null;
let activeCall = null;
let device = null;
let isSpeaking = false;

function log(message, type = 'info') {
  const line = document.createElement('div');
  line.className = `debug-line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  UI.debug.appendChild(line);
  UI.debug.scrollTop = UI.debug.scrollHeight;
  console.log(`[TalkHint] ${message}`);
}

function getWSUrl(path) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

async function initTwilioDevice() {
  if (typeof TwilioDevice === 'undefined') {
    log('Waiting for Twilio SDK...');
    setTimeout(initTwilioDevice, 500);
    return;
  }

  try {
    log('Getting Twilio token...');
    const response = await fetch('/api/token');
    const data = await response.json();
    
    if (data.error) {
      log(`Token error: ${data.error}`, 'error');
      UI.statusText.textContent = 'Token error';
      return;
    }

    log(`Token received for: ${data.identity}`, 'success');
    
    device = new TwilioDevice(data.token, {
      logLevel: 1
    });

    device.on('registered', () => {
      log('Device registered', 'success');
      UI.statusDot.classList.add('connected');
      UI.statusText.textContent = 'Ready to call';
      UI.callBtn.disabled = false;
    });

    device.on('error', (twilioError) => {
      log(`Device error: ${twilioError.message}`, 'error');
      UI.statusText.textContent = `Error: ${twilioError.message}`;
    });

    device.on('incoming', (call) => {
      log(`Incoming call from: ${call.parameters.From}`);
    });

    await device.register();
    log('Device registered successfully', 'success');

  } catch (err) {
    log(`Init error: ${err.message}`, 'error');
    UI.statusText.textContent = 'Failed to initialize';
  }
}

function connectWebSocket() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  const url = getWSUrl('/ui');
  log(`Connecting WebSocket: ${url}`);
  
  socket = new WebSocket(url);

  socket.onopen = () => {
    log('WebSocket connected', 'success');
    sendMode(currentMode);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch (err) {
      log(`Parse error: ${err.message}`, 'error');
    }
  };

  socket.onclose = () => {
    log('WebSocket disconnected', 'error');
    reconnectTimeout = setTimeout(connectWebSocket, 3000);
  };

  socket.onerror = () => {
    log('WebSocket error', 'error');
  };
}

function handleMessage(data) {
  switch (data.type) {
    case 'connected':
      log('Server confirmed connection', 'success');
      if (data.mode) {
        currentMode = data.mode;
        UI.modeSelect.value = currentMode;
      }
      break;

    case 'owner_transcript':
    case 'hon_transcript':
      addMessage('owner', data.text, data.streaming);
      break;

    case 'guest_transcript':
    case 'gst_transcript':
      addMessage('guest', data.text, data.streaming);
      break;

    case 'hints':
      if (data.hints && Array.isArray(data.hints)) {
        updateHints(data.hints);
      }
      break;

    case 'ai_hint':
    case 'response':
      if (data.hints) {
        updateHints(data.hints);
      }
      break;

    case 'mode_changed':
      currentMode = data.mode;
      UI.modeSelect.value = currentMode;
      log(`Mode: ${data.mode}`, 'success');
      break;

    case 'error':
      log(`Error: ${data.error}`, 'error');
      break;
  }
}

function sendMode(mode) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'set_mode', mode }));
  }
}

function addMessage(panel, text, isStreaming = false) {
  if (!text) return;
  const container = panel === 'owner' ? UI.ownerMessages : UI.guestMessages;
  
  if (isStreaming) {
    let streamingEl = container.querySelector('.streaming');
    if (!streamingEl) {
      streamingEl = document.createElement('p');
      streamingEl.className = 'streaming';
      container.appendChild(streamingEl);
    }
    streamingEl.textContent = text;
  } else {
    const streamingEl = container.querySelector('.streaming');
    if (streamingEl) {
      streamingEl.classList.remove('streaming');
    }
    const p = document.createElement('p');
    p.textContent = text;
    container.appendChild(p);
  }
  container.scrollTop = container.scrollHeight;
}

function updateHints(newHints) {
  for (let i = 0; i < 3; i++) {
    const hint = newHints[i] || hints[i];
    document.getElementById(`hint${i}en`).textContent = hint.en || hint.english || hints[i].en;
    document.getElementById(`hint${i}ru`).textContent = hint.ru || hint.russian || hints[i].ru;
  }
}

async function speakHint(index) {
  if (isSpeaking) return;
  
  const hintText = document.getElementById(`hint${index}en`).textContent;
  const btn = document.querySelectorAll('.mic-btn')[index];
  
  isSpeaking = true;
  btn.classList.add('speaking');
  
  try {
    const response = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: hintText })
    });
    
    if (response.ok) {
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.onended = () => {
        isSpeaking = false;
        btn.classList.remove('speaking');
        URL.revokeObjectURL(audioUrl);
      };
      
      audio.onerror = () => {
        isSpeaking = false;
        btn.classList.remove('speaking');
        log('Audio playback error', 'error');
      };
      
      await audio.play();
    } else {
      throw new Error('TTS request failed');
    }
  } catch (err) {
    log(`Speak error: ${err.message}`, 'error');
    isSpeaking = false;
    btn.classList.remove('speaking');
    
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(hintText);
      utterance.lang = 'en-US';
      utterance.onend = () => {
        isSpeaking = false;
        btn.classList.remove('speaking');
      };
      speechSynthesis.speak(utterance);
    }
  }
}

async function makeCall() {
  const phoneNumber = UI.phoneInput.value.trim();
  
  if (!phoneNumber) {
    log('Enter a phone number', 'error');
    UI.statusText.textContent = 'Enter a phone number';
    return;
  }

  if (!device) {
    log('Device not ready', 'error');
    UI.statusText.textContent = 'Device not ready';
    return;
  }

  log(`Calling: ${phoneNumber}`);
  UI.statusDot.classList.add('calling');
  UI.statusText.textContent = 'Calling...';
  UI.callBtn.disabled = true;

  try {
    const params = { To: phoneNumber };
    activeCall = await device.connect({ params });
    
    activeCall.on('accept', () => {
      log('Call connected', 'success');
      UI.statusDot.classList.remove('calling');
      UI.statusDot.classList.add('active');
      UI.statusText.textContent = 'In Call';
      UI.callBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>';
      UI.callBtn.classList.remove('start');
      UI.callBtn.classList.add('end');
      UI.callBtn.disabled = false;
    });

    activeCall.on('disconnect', () => {
      log('Call disconnected');
      resetCallUI();
    });

    activeCall.on('cancel', () => {
      log('Call cancelled');
      resetCallUI();
    });

    activeCall.on('reject', () => {
      log('Call rejected');
      resetCallUI();
    });

    activeCall.on('error', (error) => {
      log(`Call error: ${error.message}`, 'error');
      UI.statusText.textContent = `Error: ${error.message}`;
      resetCallUI();
    });

  } catch (err) {
    log(`Call failed: ${err.message}`, 'error');
    UI.statusText.textContent = `Failed: ${err.message}`;
    resetCallUI();
  }
}

function resetCallUI() {
  activeCall = null;
  UI.statusDot.classList.remove('active', 'calling');
  UI.statusDot.classList.add('connected');
  UI.statusText.textContent = 'Ready to call';
  UI.callBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>';
  UI.callBtn.classList.remove('end');
  UI.callBtn.classList.add('start');
  UI.callBtn.disabled = false;
}

function endCall() {
  if (activeCall) {
    activeCall.disconnect();
    log('Call ended by user');
  }
}

UI.callBtn.addEventListener('click', () => {
  if (activeCall) {
    endCall();
  } else {
    makeCall();
  }
});

UI.modeSelect.addEventListener('change', (e) => {
  currentMode = e.target.value;
  sendMode(currentMode);
});

UI.phoneInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !activeCall) {
    makeCall();
  }
});

window.speakHint = speakHint;

log('TalkHint WebRTC Mode');
connectWebSocket();
initTwilioDevice();
