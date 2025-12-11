const UI = {
  hon: document.getElementById('hon'),
  gst: document.getElementById('gst'),
  hints: document.getElementById('hints'),
  debug: document.getElementById('debug'),
  startBtn: document.getElementById('startBtn'),
  uiStatus: document.getElementById('uiStatus'),
  uiStatusText: document.getElementById('uiStatusText'),
  micStatus: document.getElementById('micStatus'),
  micStatusText: document.getElementById('micStatusText'),
  modeSelect: document.getElementById('modeSelect')
};

let uiSocket = null;
let currentMode = 'universal';
let honorSocket = null;
let mediaStream = null;
let audioContext = null;
let processor = null;
let isRecording = false;

function log(message, type = 'info') {
  const line = document.createElement('div');
  line.className = `debug-line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  UI.debug.appendChild(line);
  UI.debug.scrollTop = UI.debug.scrollHeight;
  console.log(message);
}

function getWSUrl(path) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

function connectUI() {
  const url = getWSUrl('/ui');
  log(`Connecting to UI WebSocket: ${url}`);
  
  uiSocket = new WebSocket(url);

  uiSocket.onopen = () => {
    log('UI WebSocket connected', 'success');
    UI.uiStatus.classList.add('connected');
    UI.uiStatusText.textContent = 'Connected';
    UI.startBtn.disabled = false;
    
    sendMode(currentMode);
  };

  uiSocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleUIMessage(data);
    } catch (err) {
      log(`UI message parse error: ${err.message}`, 'error');
    }
  };

  uiSocket.onclose = () => {
    log('UI WebSocket disconnected', 'error');
    UI.uiStatus.classList.remove('connected');
    UI.uiStatusText.textContent = 'Disconnected';
    UI.startBtn.disabled = true;
    setTimeout(connectUI, 3000);
  };

  uiSocket.onerror = (err) => {
    log('UI WebSocket error', 'error');
  };
}

function handleUIMessage(data) {
  log(`UI event: ${data.type}`);
  
  switch (data.type) {
    case 'connected':
      log('Server confirmed connection', 'success');
      break;

    case 'transcript':
    case 'hon_transcript':
      addTranscript('hon', data.text, data.role);
      break;

    case 'gst_transcript':
      addTranscript('gst', data.text, data.role);
      break;

    case 'response':
    case 'hon_response':
      if (data.text) {
        UI.hints.textContent = data.text;
      }
      break;

    case 'call_started':
      log(`Call started: ${data.callSid}`, 'success');
      break;

    case 'call_ended':
      log(`Call ended: ${data.callSid}`);
      break;

    case 'error':
      log(`Error: ${data.error}`, 'error');
      break;

    case 'mode_changed':
      log(`Mode changed to: ${data.mode}`, 'success');
      break;
  }
}

function sendMode(mode) {
  if (uiSocket && uiSocket.readyState === WebSocket.OPEN) {
    uiSocket.send(JSON.stringify({
      type: 'set_mode',
      mode: mode
    }));
    log(`Mode set to: ${mode}`);
  }
}

function addTranscript(panel, text, role) {
  if (!text) return;
  
  const container = panel === 'hon' ? UI.hon : UI.gst;
  const p = document.createElement('p');
  p.textContent = role === 'assistant' ? `AI: ${text}` : text;
  container.appendChild(p);
  container.scrollTop = container.scrollHeight;
}

async function startRecording() {
  try {
    log('Starting recording...');
    
    const url = getWSUrl('/honor-stream');
    honorSocket = new WebSocket(url);

    honorSocket.onopen = async () => {
      log('Honor WebSocket connected', 'success');
      
      honorSocket.send(JSON.stringify({ type: 'start' }));

      mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(mediaStream);
      
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (e) => {
        if (!isRecording || honorSocket.readyState !== WebSocket.OPEN) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = float32ToPCM16(inputData);
        const base64 = arrayBufferToBase64(pcm16.buffer);
        
        honorSocket.send(JSON.stringify({
          type: 'audio',
          audio: base64
        }));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      isRecording = true;
      UI.startBtn.textContent = 'Stop Recording';
      UI.startBtn.classList.add('recording');
      UI.micStatus.classList.add('recording');
      UI.micStatusText.textContent = 'Recording...';
      
      log('Recording started', 'success');
    };

    honorSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleHonorMessage(data);
      } catch (err) {
        log(`Honor message error: ${err.message}`, 'error');
      }
    };

    honorSocket.onclose = () => {
      log('Honor WebSocket closed');
      stopRecording();
    };

    honorSocket.onerror = (err) => {
      log('Honor WebSocket error', 'error');
    };

  } catch (err) {
    log(`Recording error: ${err.message}`, 'error');
  }
}

function handleHonorMessage(data) {
  switch (data.type) {
    case 'ready':
      log(`Session ready: ${data.sessionId}`, 'success');
      break;

    case 'transcript':
      addTranscript('hon', data.text, data.role);
      break;

    case 'response':
      if (data.text) {
        UI.hints.textContent = data.text;
      }
      break;

    case 'audio':
      playAudio(data.audio);
      break;

    case 'error':
      log(`Honor error: ${data.error}`, 'error');
      break;
  }
}

function stopRecording() {
  isRecording = false;

  if (processor) {
    processor.disconnect();
    processor = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  if (honorSocket && honorSocket.readyState === WebSocket.OPEN) {
    honorSocket.send(JSON.stringify({ type: 'stop' }));
    honorSocket.close();
  }
  honorSocket = null;

  UI.startBtn.textContent = 'Start Recording';
  UI.startBtn.classList.remove('recording');
  UI.micStatus.classList.remove('recording');
  UI.micStatusText.textContent = 'Mic off';
  
  log('Recording stopped');
}

function float32ToPCM16(float32Array) {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return pcm16;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function playAudio(base64PCM16) {
  try {
    const binaryString = atob(base64PCM16);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7FFF);
    }
    
    const ctx = new AudioContext({ sampleRate: 16000 });
    const buffer = ctx.createBuffer(1, float32.length, 16000);
    buffer.copyToChannel(float32, 0);
    
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
  } catch (err) {
    log(`Audio playback error: ${err.message}`, 'error');
  }
}

UI.startBtn.addEventListener('click', () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

UI.modeSelect.addEventListener('change', (e) => {
  currentMode = e.target.value;
  sendMode(currentMode);
});

connectUI();
