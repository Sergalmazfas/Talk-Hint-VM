const UI = {
  hon: document.getElementById('hon'),
  gst: document.getElementById('gst'),
  hints: document.getElementById('hints'),
  debug: document.getElementById('debug'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  modeBadge: document.getElementById('modeBadge'),
  modeSelect: document.getElementById('modeSelect'),
  callStatus: document.getElementById('callStatus'),
  phoneInput: document.getElementById('phoneInput'),
  callBtn: document.getElementById('callBtn')
};

let socket = null;
let currentMode = 'universal';
let reconnectTimeout = null;
let activeCall = null;
let device = null;

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
      UI.callStatus.textContent = 'Token error';
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
      UI.callStatus.textContent = `Error: ${twilioError.message}`;
    });

    device.on('incoming', (call) => {
      log(`Incoming call from: ${call.parameters.From}`);
    });

    await device.register();
    log('Device registered successfully', 'success');

  } catch (err) {
    log(`Init error: ${err.message}`, 'error');
    UI.callStatus.textContent = 'Failed to initialize';
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

    case 'hon_transcript':
      addTranscript('hon', data.text);
      break;

    case 'gst_transcript':
      addTranscript('gst', data.text);
      break;

    case 'ai_hint':
    case 'response':
      if (data.text) {
        UI.hints.textContent = data.text;
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

function addTranscript(panel, text) {
  if (!text) return;
  const container = panel === 'hon' ? UI.hon : UI.gst;
  const emptyMsg = container.querySelector('.empty');
  if (emptyMsg) emptyMsg.remove();
  
  const p = document.createElement('p');
  p.textContent = text;
  container.appendChild(p);
  container.scrollTop = container.scrollHeight;
}

async function makeCall() {
  const phoneNumber = UI.phoneInput.value.trim();
  
  if (!phoneNumber) {
    log('Enter a phone number', 'error');
    UI.callStatus.textContent = 'Enter a phone number';
    return;
  }

  if (!device) {
    log('Device not ready', 'error');
    UI.callStatus.textContent = 'Device not ready';
    return;
  }

  log(`Calling: ${phoneNumber}`);
  UI.statusDot.classList.add('calling');
  UI.statusText.textContent = 'Calling...';
  UI.callStatus.textContent = `Calling ${phoneNumber}...`;
  UI.callBtn.disabled = true;

  try {
    const params = { To: phoneNumber };
    activeCall = await device.connect({ params });
    
    activeCall.on('accept', () => {
      log('Call connected', 'success');
      UI.statusDot.classList.remove('calling');
      UI.statusDot.classList.add('active');
      UI.statusText.textContent = 'In Call';
      UI.callStatus.textContent = 'Connected';
      UI.callBtn.textContent = 'End Call';
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
      UI.callStatus.textContent = `Error: ${error.message}`;
      resetCallUI();
    });

  } catch (err) {
    log(`Call failed: ${err.message}`, 'error');
    UI.callStatus.textContent = `Failed: ${err.message}`;
    resetCallUI();
  }
}

function resetCallUI() {
  activeCall = null;
  UI.statusDot.classList.remove('active', 'calling');
  UI.statusDot.classList.add('connected');
  UI.statusText.textContent = 'Ready to call';
  UI.callBtn.textContent = 'Call';
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

log('TalkHint WebRTC Mode');
connectWebSocket();
initTwilioDevice();
