const UI = {
  hon: document.getElementById('hon'),
  gst: document.getElementById('gst'),
  hints: document.getElementById('hints'),
  debug: document.getElementById('debug'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  modeBadge: document.getElementById('modeBadge'),
  modeSelect: document.getElementById('modeSelect'),
  callStatus: document.getElementById('callStatus')
};

let socket = null;
let currentMode = 'universal';
let reconnectTimeout = null;
let activeCallSid = null;

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
    UI.statusText.textContent = 'Connected - Phone Mode';
    
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
    UI.statusDot.classList.remove('connected', 'active');
    UI.statusText.textContent = 'Disconnected';
    
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
      log(`Call started: ${data.callSid}`, 'success');
      UI.statusDot.classList.add('active');
      UI.statusText.textContent = 'Active Call';
      UI.callStatus.textContent = `Active call: ${data.callSid}`;
      clearTranscripts();
      break;

    case 'call_ended':
      log(`Call ended: ${data.callSid}`);
      UI.statusDot.classList.remove('active');
      UI.statusText.textContent = 'Connected - Phone Mode';
      UI.callStatus.textContent = 'Call ended';
      activeCallSid = null;
      break;

    case 'mode_changed':
      currentMode = data.mode;
      UI.modeSelect.value = currentMode;
      log(`Mode changed to: ${data.mode}`, 'success');
      break;

    case 'error':
      log(`Error: ${data.error}`, 'error');
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

UI.modeSelect.addEventListener('change', (e) => {
  currentMode = e.target.value;
  sendMode(currentMode);
});

log('TalkHint Phone Mode initialized');
connect();
