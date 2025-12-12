const UI = {
  phoneInput: document.getElementById('phoneInput'),
  callBtn: document.getElementById('callBtn'),
  ownerTranscripts: document.getElementById('ownerTranscripts'),
  ownerEmpty: document.getElementById('ownerEmpty'),
  guestTranscripts: document.getElementById('guestTranscripts'),
  guestEmpty: document.getElementById('guestEmpty'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText')
};

let socket = null;
let reconnectTimeout = null;
let activeCall = null;
let device = null;

function log(message) {
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
      log(`Token error: ${data.error}`);
      UI.statusText.textContent = 'Token error';
      return;
    }

    log(`Token received for: ${data.identity}`);
    
    device = new TwilioDevice(data.token, { logLevel: 1 });

    device.on('registered', () => {
      log('Device registered');
      UI.statusDot.classList.add('connected');
      UI.statusText.textContent = 'Ready';
      UI.callBtn.disabled = false;
    });

    device.on('error', (twilioError) => {
      log(`Device error: ${twilioError.message}`);
      UI.statusText.textContent = `Error: ${twilioError.message}`;
    });

    await device.register();
    log('Device registered successfully');

  } catch (err) {
    log(`Init error: ${err.message}`);
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
    log('WebSocket connected');
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch (err) {
      log(`Parse error: ${err.message}`);
    }
  };

  socket.onclose = () => {
    log('WebSocket disconnected');
    reconnectTimeout = setTimeout(connectWebSocket, 3000);
  };

  socket.onerror = () => {
    log('WebSocket error');
  };
}

function handleMessage(data) {
  switch (data.type) {
    case 'connected':
      log('Server confirmed connection');
      break;

    case 'guest_transcript':
      addGuestTranscript(data.text);
      break;

    case 'owner_transcript':
      addOwnerTranscript(data.text);
      break;

    case 'error':
      log(`Error: ${data.error}`);
      break;
  }
}

function addOwnerTranscript(text) {
  if (!text) return;
  
  UI.ownerEmpty.style.display = 'none';
  
  const item = document.createElement('div');
  item.className = 'transcript-item';
  item.innerHTML = `<div class="transcript-en">${text}</div>`;
  UI.ownerTranscripts.appendChild(item);
  UI.ownerTranscripts.scrollTop = UI.ownerTranscripts.scrollHeight;
}

function addGuestTranscript(text) {
  if (!text) return;
  
  UI.guestEmpty.style.display = 'none';
  
  const item = document.createElement('div');
  item.className = 'transcript-item';
  item.innerHTML = `<div class="transcript-en">${text}</div>`;
  UI.guestTranscripts.appendChild(item);
  UI.guestTranscripts.scrollTop = UI.guestTranscripts.scrollHeight;
}

function clearTranscripts() {
  UI.ownerTranscripts.innerHTML = '';
  UI.ownerEmpty.style.display = 'block';
  UI.ownerTranscripts.appendChild(UI.ownerEmpty);
  
  UI.guestTranscripts.innerHTML = '';
  UI.guestEmpty.style.display = 'block';
  UI.guestTranscripts.appendChild(UI.guestEmpty);
}

async function makeCall() {
  const phoneNumber = UI.phoneInput.value.trim();
  
  if (!phoneNumber) {
    UI.statusText.textContent = 'Enter phone number';
    return;
  }

  if (!device) {
    UI.statusText.textContent = 'Device not ready';
    return;
  }

  log(`Calling: ${phoneNumber}`);
  UI.statusDot.classList.add('calling');
  UI.statusText.textContent = 'Calling...';
  UI.callBtn.disabled = true;
  
  clearTranscripts();

  try {
    const params = { To: phoneNumber };
    activeCall = await device.connect({ params });
    
    activeCall.on('accept', () => {
      log('Call connected');
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
      log(`Call error: ${error.message}`);
      UI.statusText.textContent = `Error: ${error.message}`;
      resetCallUI();
    });

  } catch (err) {
    log(`Call failed: ${err.message}`);
    UI.statusText.textContent = `Failed: ${err.message}`;
    resetCallUI();
  }
}

function resetCallUI() {
  activeCall = null;
  UI.statusDot.classList.remove('active', 'calling');
  UI.statusDot.classList.add('connected');
  UI.statusText.textContent = 'Ready';
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

UI.phoneInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !activeCall) {
    makeCall();
  }
});

log('TalkHint UI Cleanup Mode');
connectWebSocket();
initTwilioDevice();
