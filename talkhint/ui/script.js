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
let activeCallSid = null;
let isCallActive = false;

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

function connect() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  const url = getWSUrl('/ui');
  log(`Connecting to server: ${url}`);
  
  socket = new WebSocket(url);

  socket.onopen = () => {
    log('Connected to server', 'success');
    UI.statusDot.classList.add('connected');
    UI.statusText.textContent = 'Connected - Ready';
    UI.callBtn.disabled = false;
    
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
    log('Disconnected from server', 'error');
    UI.statusDot.classList.remove('connected', 'active', 'calling');
    UI.statusText.textContent = 'Disconnected';
    UI.callBtn.disabled = true;
    
    reconnectTimeout = setTimeout(connect, 3000);
  };

  socket.onerror = (err) => {
    log('Connection error', 'error');
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

    case 'status':
      log(`Status: ${data.text}`, 'success');
      UI.callStatus.textContent = data.text;
      break;

    case 'hon_transcript':
      addTranscript('hon', data.text);
      break;

    case 'gst_transcript':
      addTranscript('gst', data.text);
      break;

    case 'transcript':
      if (data.role === 'user') {
        addTranscript('hon', data.text);
      } else if (data.role === 'assistant') {
        addTranscript('gst', data.text);
      }
      break;

    case 'ai_hint':
    case 'response':
    case 'hon_response':
      if (data.text) {
        UI.hints.textContent = data.text;
        UI.hints.classList.remove('empty');
      }
      break;

    case 'call_started':
      activeCallSid = data.callSid;
      isCallActive = true;
      log(`Call started: ${data.callSid}`, 'success');
      UI.statusDot.classList.remove('calling');
      UI.statusDot.classList.add('active');
      UI.statusText.textContent = 'Active Call - Streaming';
      UI.callStatus.textContent = `Active call: ${data.callSid}`;
      UI.callBtn.textContent = 'End Call';
      UI.callBtn.classList.remove('start');
      UI.callBtn.classList.add('end');
      // Show streaming status in panels
      UI.hon.innerHTML = '<p class="streaming">Streaming... Listening for your voice</p>';
      UI.gst.innerHTML = '<p class="streaming">Streaming... Listening for caller</p>';
      UI.hints.textContent = 'Waiting for conversation...';
      break;

    case 'call_ended':
      log(`Call ended: ${data.callSid}`);
      UI.statusDot.classList.remove('active', 'calling');
      UI.statusText.textContent = 'Connected - Ready';
      UI.callStatus.textContent = 'Call ended';
      UI.callBtn.textContent = 'Call';
      UI.callBtn.classList.remove('end');
      UI.callBtn.classList.add('start');
      activeCallSid = null;
      isCallActive = false;
      break;

    case 'mode_changed':
      currentMode = data.mode;
      UI.modeSelect.value = currentMode;
      log(`Mode changed to: ${data.mode}`, 'success');
      break;

    case 'error':
      log(`Error: ${data.error}`, 'error');
      UI.callStatus.textContent = `Error: ${data.error}`;
      UI.statusDot.classList.remove('calling');
      UI.callBtn.disabled = false;
      break;

    default:
      log(`Event: ${data.type}`);
  }
}

function sendMode(mode) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'set_mode',
      mode: mode
    }));
    log(`Mode set to: ${mode}`);
  }
}

function addTranscript(panel, text) {
  if (!text) return;
  
  const container = panel === 'hon' ? UI.hon : UI.gst;
  
  const emptyMsg = container.querySelector('.empty');
  if (emptyMsg) {
    emptyMsg.remove();
  }
  
  const p = document.createElement('p');
  p.textContent = text;
  container.appendChild(p);
  container.scrollTop = container.scrollHeight;
}

function clearTranscripts() {
  UI.hon.innerHTML = '<p class="empty">Listening...</p>';
  UI.gst.innerHTML = '<p class="empty">Listening...</p>';
  UI.hints.textContent = 'Waiting for conversation...';
}

async function startCall() {
  const phoneNumber = UI.phoneInput.value.trim();
  
  if (!phoneNumber) {
    log('Please enter a phone number', 'error');
    UI.callStatus.textContent = 'Enter a phone number';
    return;
  }
  
  log(`Starting direct call to: ${phoneNumber}`);
  UI.statusDot.classList.add('calling');
  UI.statusText.textContent = 'Calling...';
  UI.callStatus.textContent = `Calling ${phoneNumber}...`;
  UI.callBtn.disabled = true;
  
  try {
    const response = await fetch('/start-call', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target: phoneNumber }),
    });
    
    const data = await response.json();
    
    if (data.success) {
      log(`Call initiated: ${data.callSid}`, 'success');
      activeCallSid = data.callSid;
      UI.callStatus.textContent = `Ringing ${phoneNumber}...`;
      UI.callBtn.disabled = false;
    } else {
      log(`Call failed: ${data.error}`, 'error');
      UI.statusDot.classList.remove('calling');
      UI.statusText.textContent = 'Connected - Ready';
      UI.callStatus.textContent = `Failed: ${data.error}`;
      UI.callBtn.disabled = false;
    }
  } catch (err) {
    log(`Call error: ${err.message}`, 'error');
    UI.statusDot.classList.remove('calling');
    UI.statusText.textContent = 'Connected - Ready';
    UI.callStatus.textContent = `Error: ${err.message}`;
    UI.callBtn.disabled = false;
  }
}

UI.callBtn.addEventListener('click', () => {
  if (isCallActive) {
    log('Call end not implemented yet');
  } else {
    startCall();
  }
});

UI.modeSelect.addEventListener('change', (e) => {
  currentMode = e.target.value;
  sendMode(currentMode);
});

UI.phoneInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !isCallActive) {
    startCall();
  }
});

log('TalkHint Phone Mode initialized');
connect();
