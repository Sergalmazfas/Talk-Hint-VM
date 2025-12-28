const UI = {
  sidebar: document.getElementById('sidebar'),
  toggleSidebarBtn: document.getElementById('toggleSidebarBtn'),
  closeSidebarBtn: document.getElementById('closeSidebarBtn'),
  phoneInput: document.getElementById('phoneInput'),
  callBtn: document.getElementById('callBtn'),
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  goalIndicator: document.getElementById('goalIndicator'),
  chatContainer: document.getElementById('chatContainer'),
  emptyState: document.getElementById('emptyState'),
  textInput: document.getElementById('textInput'),
  sendBtn: document.getElementById('sendBtn'),
  micBtn: document.getElementById('micBtn')
};

let hasGoal = false;
let currentFolder = null;
let currentLanguage = localStorage.getItem('talkhint_language') || 'ru';
let conversationContext = []; // Store conversation history for assistant chat
let currentGoal = ''; // Store call goal

const LANGUAGE_FLAGS = {
  ru: '🇷🇺',
  es: '🇪🇸'
};

const FOLDER_PROMPTS = {
  realtor: `You are a Realtor assistant.
User does NOT speak English fluently.
Always respond with ONE short, ready-to-say phrase.
No explanations. No teaching. No options.
Format: Just the phrase to say.
Help with: property viewings, price negotiations, contracts, scheduling.`,
  dispatcher: `You are a Dispatcher assistant.
User does NOT speak English fluently.
Always respond with ONE short, ready-to-say phrase.
No explanations. No teaching. No options.
Format: Just the phrase to say.
Help with: scheduling pickups, confirming addresses, delivery times, load details.`,
  handyman: `You are a Handyman assistant.
User does NOT speak English fluently.
Always respond with ONE short, ready-to-say phrase.
No explanations. No teaching. No options.
Format: Just the phrase to say.
Help with: repair quotes, scheduling service, describing problems, confirming work.`,
  doctor: `You are a Medical assistant.
User does NOT speak English fluently.
Always respond with ONE short, ready-to-say phrase.
No explanations. No teaching. No options.
Format: Just the phrase to say.
Help with: test results, appointments, prescriptions, insurance questions.`
};

let socket = null;
let reconnectTimeout = null;
let activeCall = null;
let device = null;
let lastMessageType = null;
let lastMessageTime = 0;
let lastMessageEl = null;
const GROUP_WINDOW_MS = 2000;

function log(msg) {
  console.log('[TalkHint] ' + msg);
}

function getWSUrl(path) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return protocol + '//' + window.location.host + path;
}

function setGoalActive(active) {
  hasGoal = active;
  if (active) {
    UI.goalIndicator.classList.add('active');
  } else {
    UI.goalIndicator.classList.remove('active');
  }
}

function addMessage(type, text, translation) {
  if (!text) return;
  UI.emptyState.style.display = 'none';
  
  if (type === 'you' && !hasGoal) {
    setGoalActive(true);
  }
  
  const now = Date.now();
  const shouldGroup = (type === lastMessageType) && 
                      (now - lastMessageTime < GROUP_WINDOW_MS) && 
                      lastMessageEl && 
                      (type === 'you' || type === 'guest');
  
  if (shouldGroup) {
    const bubble = lastMessageEl.querySelector('.message-bubble');
    if (bubble) {
      bubble.textContent += '\n' + text;
    }
    if (translation) {
      let transEl = lastMessageEl.querySelector('.message-translation');
      if (transEl) {
        transEl.textContent += '\n' + (LANGUAGE_FLAGS[currentLanguage] || '🇷🇺') + ' ' + translation;
      } else {
        const newTrans = document.createElement('div');
        newTrans.className = 'message-translation';
        newTrans.textContent = (LANGUAGE_FLAGS[currentLanguage] || '🇷🇺') + ' ' + translation;
        lastMessageEl.appendChild(newTrans);
      }
    }
    lastMessageTime = now;
  } else {
    const msg = document.createElement('div');
    msg.className = 'message ' + type;
    
    let label = type === 'you' ? 'You' : type === 'guest' ? 'Guest' : 'Assistant';
    
    var labelDiv = document.createElement('div');
    labelDiv.className = 'message-label';
    labelDiv.textContent = label;
    
    var bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = text;
    
    msg.appendChild(labelDiv);
    msg.appendChild(bubble);
    
    if (translation) {
      var transDiv = document.createElement('div');
      transDiv.className = 'message-translation';
      transDiv.textContent = (LANGUAGE_FLAGS[currentLanguage] || '🇷🇺') + ' ' + translation;
      msg.appendChild(transDiv);
    }
    UI.chatContainer.appendChild(msg);
    
    lastMessageType = type;
    lastMessageTime = now;
    lastMessageEl = msg;
  }
  
  UI.chatContainer.scrollTop = UI.chatContainer.scrollHeight;
}

function clearChat() {
  UI.chatContainer.innerHTML = '';
  UI.emptyState.style.display = 'block';
  UI.chatContainer.appendChild(UI.emptyState);
  lastMessageType = null;
  lastMessageTime = 0;
  lastMessageEl = null;
  setGoalActive(false);
  // Clear conversation context for new call
  conversationContext = [];
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function addHint(english, translationText) {
  if (!english) return;
  UI.emptyState.style.display = 'none';
  
  var hint = document.createElement('div');
  hint.className = 'hint';
  
  var header = document.createElement('div');
  header.className = 'hint-header';
  header.textContent = '💡 Say this';
  
  var card = document.createElement('div');
  card.className = 'hint-card';
  
  var phrase = document.createElement('div');
  phrase.className = 'hint-phrase';
  phrase.textContent = english;
  card.appendChild(phrase);
  
  if (translationText) {
    var transDiv = document.createElement('div');
    transDiv.className = 'hint-translation';
    transDiv.textContent = (LANGUAGE_FLAGS[currentLanguage] || '🇷🇺') + ' ' + translationText;
    card.appendChild(transDiv);
  }
  
  var actions = document.createElement('div');
  actions.className = 'hint-actions';
  
  var sayBtn = document.createElement('button');
  sayBtn.className = 'hint-btn say';
  sayBtn.setAttribute('data-testid', 'button-hint-say');
  sayBtn.textContent = '▶️ Say';
  sayBtn.addEventListener('click', function() {
    log('Say: ' + english);
  });
  
  var copyBtn = document.createElement('button');
  copyBtn.className = 'hint-btn copy';
  copyBtn.setAttribute('data-testid', 'button-hint-copy');
  copyBtn.textContent = '📋 Copy';
  copyBtn.addEventListener('click', function() {
    navigator.clipboard.writeText(english).then(function() {
      log('Copied to clipboard');
    });
  });
  
  actions.appendChild(sayBtn);
  actions.appendChild(copyBtn);
  card.appendChild(actions);
  
  hint.appendChild(header);
  hint.appendChild(card);
  UI.chatContainer.appendChild(hint);
  
  UI.chatContainer.scrollTop = UI.chatContainer.scrollHeight;
  
  lastMessageType = 'hint';
  lastMessageTime = Date.now();
  lastMessageEl = null;
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
      log('Token error: ' + data.error);
      UI.statusText.textContent = 'Token error';
      return;
    }

    log('Token received for: ' + data.identity);
    
    device = new TwilioDevice(data.token, { logLevel: 1 });

    device.on('registered', function() {
      log('Device registered');
      UI.statusDot.classList.add('connected');
      UI.statusText.textContent = 'Ready';
      UI.callBtn.disabled = false;
    });

    device.on('error', function(err) {
      log('Device error: ' + err.message);
      UI.statusText.textContent = 'Error';
    });

    await device.register();
    log('Device registered successfully');

  } catch (err) {
    log('Init error: ' + err.message);
    UI.statusText.textContent = 'Failed';
  }
}

function connectWebSocket() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  const url = getWSUrl('/ui');
  log('Connecting WebSocket: ' + url);
  
  socket = new WebSocket(url);

  socket.onopen = function() {
    log('WebSocket connected');
    var savedLang = localStorage.getItem('talkhint_language') || 'ru';
    socket.send(JSON.stringify({
      type: 'set_language',
      language: savedLang
    }));
    log('Sent initial language: ' + savedLang);
  };

  socket.onmessage = function(event) {
    try {
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch (err) {
      log('Parse error: ' + err.message);
    }
  };

  socket.onclose = function() {
    log('WebSocket disconnected');
    reconnectTimeout = setTimeout(connectWebSocket, 3000);
  };

  socket.onerror = function() {
    log('WebSocket error');
  };
}

function handleMessage(data) {
  switch (data.type) {
    case 'connected':
      log('Server confirmed connection');
      break;

    case 'owner_transcript':
    case 'hon_transcript':
      if (data.text) {
        addMessage('you', data.text);
        // Add to conversation context for assistant chat
        conversationContext.push({ role: 'honor', text: data.text });
        if (conversationContext.length > 20) conversationContext.shift();
      }
      break;

    case 'guest_transcript':
    case 'gst_transcript':
      if (data.text) {
        addMessage('guest', data.text, data.translation);
        // Add to conversation context for assistant chat
        conversationContext.push({ role: 'guest', text: data.text });
        if (conversationContext.length > 20) conversationContext.shift();
      }
      break;

    case 'suggestion':
    case 'ai_hint':
    case 'hint':
      if (data.en || data.english) {
        addHint(data.en || data.english, data.translation || data.ru || data.russian);
      }
      break;

    case 'error':
      log('Error: ' + data.error);
      break;
  }
}

async function makeCall() {
  const phoneNumber = UI.phoneInput.value.trim();
  
  if (!phoneNumber) {
    UI.statusText.textContent = 'Enter number';
    return;
  }

  if (!device) {
    UI.statusText.textContent = 'Not ready';
    return;
  }

  log('Calling: ' + phoneNumber);
  UI.statusDot.classList.add('calling');
  UI.statusText.textContent = 'Calling...';
  UI.callBtn.disabled = true;
  
  clearChat();

  try {
    activeCall = await device.connect({ params: { To: phoneNumber } });
    
    activeCall.on('accept', function() {
      log('Call connected');
      UI.statusDot.classList.remove('calling');
      UI.statusDot.classList.add('active');
      UI.statusText.textContent = 'In Call';
      UI.callBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>';
      UI.callBtn.classList.remove('start');
      UI.callBtn.classList.add('end');
      UI.callBtn.disabled = false;
    });

    activeCall.on('disconnect', function() {
      log('Call disconnected');
      resetCallUI();
    });

    activeCall.on('cancel', function() {
      log('Call cancelled');
      resetCallUI();
    });

    activeCall.on('reject', function() {
      log('Call rejected');
      resetCallUI();
    });

    activeCall.on('error', function(err) {
      log('Call error: ' + err.message);
      resetCallUI();
    });

  } catch (err) {
    log('Call failed: ' + err.message);
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
    log('Call ended');
  }
}

UI.callBtn.addEventListener('click', function() {
  if (activeCall) {
    endCall();
  } else {
    makeCall();
  }
});

UI.phoneInput.addEventListener('keypress', function(e) {
  if (e.key === 'Enter' && !activeCall) {
    makeCall();
  }
});

// Send message to Assistant Chat API
async function sendToAssistant(text) {
  if (!text) return;
  
  // Show user's message immediately
  addAssistantChatMessage('user', text);
  UI.textInput.value = '';
  UI.sendBtn.disabled = true;
  
  // Add Honor's chat message to context so AI knows what was asked
  conversationContext.push({ role: 'honor_chat', text: text });
  if (conversationContext.length > 20) conversationContext.shift();
  
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        language: currentLanguage,
        isLiveCall: !!activeCall,
        goal: currentGoal,
        conversationContext: conversationContext
      })
    });
    
    if (!response.ok) {
      throw new Error('Chat API error');
    }
    
    const data = await response.json();
    if (data.reply) {
      addAssistantChatMessage('assistant', data.reply);
    }
  } catch (err) {
    log('Assistant error: ' + err.message);
    addAssistantChatMessage('assistant', '⚠️ Error connecting to assistant');
  } finally {
    UI.sendBtn.disabled = false;
  }
}

// Add assistant chat message (different from call transcript)
function addAssistantChatMessage(role, text) {
  if (!text) return;
  UI.emptyState.style.display = 'none';
  
  const msg = document.createElement('div');
  msg.className = 'message ' + (role === 'user' ? 'you' : 'assistant');
  
  const labelDiv = document.createElement('div');
  labelDiv.className = 'message-label';
  labelDiv.textContent = role === 'user' ? '💬 You' : '🤖 Assistant';
  
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  if (role === 'assistant') {
    bubble.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    bubble.style.color = '#fff';
  }
  bubble.textContent = text;
  
  msg.appendChild(labelDiv);
  msg.appendChild(bubble);
  
  // Add copy button for assistant messages
  if (role === 'assistant') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'hint-btn copy';
    copyBtn.style.marginTop = '8px';
    copyBtn.textContent = '📋 Copy';
    copyBtn.onclick = function() {
      navigator.clipboard.writeText(text);
      copyBtn.textContent = '✓ Copied';
      setTimeout(() => copyBtn.textContent = '📋 Copy', 1500);
    };
    msg.appendChild(copyBtn);
  }
  
  UI.chatContainer.appendChild(msg);
  UI.chatContainer.scrollTop = UI.chatContainer.scrollHeight;
  
  lastMessageType = role === 'user' ? 'you' : 'assistant';
  lastMessageTime = Date.now();
  lastMessageEl = msg;
}

UI.textInput.addEventListener('keypress', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = UI.textInput.value.trim();
    if (text) {
      sendToAssistant(text);
    }
  }
});

UI.micBtn.addEventListener('click', function() {
  UI.micBtn.classList.toggle('active');
});

UI.sendBtn.addEventListener('click', function() {
  const text = UI.textInput.value.trim();
  if (text) {
    sendToAssistant(text);
  }
});

UI.toggleSidebarBtn.addEventListener('click', function() {
  UI.sidebar.classList.toggle('collapsed');
});

UI.closeSidebarBtn.addEventListener('click', function() {
  UI.sidebar.classList.add('collapsed');
});

function selectFolder(folderId) {
  if (currentFolder === folderId) return;
  
  currentFolder = folderId;
  log('Selected folder: ' + folderId);
  
  document.querySelectorAll('.folder-item').forEach(function(item) {
    item.classList.remove('active');
  });
  
  var selectedItem = document.querySelector('[data-folder="' + folderId + '"]');
  if (selectedItem) {
    selectedItem.classList.add('active');
  }
  
  clearChat();
  
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'set_context',
      folder: folderId,
      systemPrompt: FOLDER_PROMPTS[folderId] || ''
    }));
  }
}

document.querySelectorAll('.folder-item').forEach(function(item) {
  item.addEventListener('click', function() {
    var folderId = this.getAttribute('data-folder');
    if (folderId) {
      selectFolder(folderId);
    }
  });
});

function selectLanguage(langCode) {
  if (currentLanguage === langCode) return;
  
  currentLanguage = langCode;
  localStorage.setItem('talkhint_language', langCode);
  log('Selected language: ' + langCode);
  
  document.querySelectorAll('.language-item').forEach(function(item) {
    item.classList.remove('active');
  });
  
  var selectedItem = document.querySelector('[data-lang="' + langCode + '"]');
  if (selectedItem) {
    selectedItem.classList.add('active');
  }
  
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'set_language',
      language: langCode
    }));
  }
}

document.querySelectorAll('.language-item').forEach(function(item) {
  item.addEventListener('click', function() {
    var langCode = this.getAttribute('data-lang');
    if (langCode) {
      selectLanguage(langCode);
    }
  });
});

(function initLanguage() {
  var savedLang = localStorage.getItem('talkhint_language') || 'ru';
  var langItem = document.querySelector('[data-lang="' + savedLang + '"]');
  if (langItem) {
    langItem.classList.add('active');
  }
})();

log('TalkHint Chat UI');
connectWebSocket();
initTwilioDevice();
