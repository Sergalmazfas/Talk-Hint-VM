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
let activeConnection = null;
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

// Initialize Twilio Device
async function initTwilioDevice() {
  try {
    log('Getting Twilio token...');
    const response = await fetch('/api/token');
    const data = await response.json();
    
    if (data.error) {
      log(`Token error: ${data.error}`, 'error');
      UI.callStatus.textContent = 'Token error - check console';
      return;
    }

    log(`Token received for: ${data.identity}`, 'success');
    
    // Initialize Twilio Device
    device = new Twilio.Device(data.token, {
      codecPreferences: ['opus', 'pcmu'],
      enableRingingState: true,
    });

    device.on('ready', () => {
      log('Twilio Device ready', 'success');
      UI.statusDot.classList.add('connected');
      UI.statusText.textContent = 'Ready to call';
      UI.callBtn.disabled = false;
    });

    device.on('error', (error) => {
      log(`Device error: ${error.message}`, 'error');
      UI.callStatus.textContent = `Error: ${error.message}`;
    });

    device.on('connect', (conn) => {
      log('Call connected', 'success');
      activeConnection = conn;
      UI.statusDot.classList.remove('calling');
      UI.statusDot.classList.add('active');
      UI.statusText.textContent = 'In Call';
      UI.callStatus.textContent = 'Connected';
      UI.callBtn.textContent = 'End Call';
      UI.callBtn.classList.remove('start');
      UI.callBtn.classList.add('end');
    });

    device.on('disconnect', () => {
      log('Call disconnected');
      activeConnection = null;
      UI.statusDot.classList.remove('active', 'calling');
      UI.statusDot.classList.add('connected');
      UI.statusText.textContent = 'Ready to call';
      UI.callStatus.textContent = 'Call ended';
      UI.callBtn.textContent = 'Call';
      UI.callBtn.classList.remove('end');
      UI.callBtn.classList.add('start');
    });

    device.on('incoming', (conn) => {
      log(`Incoming call from: ${conn.parameters.From}`);
    });

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

  socket.onerror = (err) => {
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

function makeCall() {
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

  // Make the call via Twilio Device
  const params = { To: phoneNumber };
  activeConnection = device.connect(params);
  
  activeConnection.on('accept', () => {
    log('Call accepted', 'success');
    UI.callBtn.disabled = false;
  });
  
  activeConnection.on('reject', () => {
    log('Call rejected');
    UI.statusDot.classList.remove('calling');
    UI.statusText.textContent = 'Ready to call';
    UI.callStatus.textContent = 'Call rejected';
    UI.callBtn.disabled = false;
  });

  activeConnection.on('cancel', () => {
    log('Call cancelled');
    UI.statusDot.classList.remove('calling');
    UI.callBtn.disabled = false;
  });

  activeConnection.on('error', (error) => {
    log(`Call error: ${error.message}`, 'error');
    UI.statusDot.classList.remove('calling');
    UI.callStatus.textContent = `Error: ${error.message}`;
    UI.callBtn.disabled = false;
  });
}

function endCall() {
  if (activeConnection) {
    activeConnection.disconnect();
    log('Call ended by user');
  }
}

UI.callBtn.addEventListener('click', () => {
  if (activeConnection) {
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
  if (e.key === 'Enter' && !activeConnection) {
    makeCall();
  }
});

// Initialize
log('TalkHint WebRTC Mode');
connectWebSocket();
initTwilioDevice();
