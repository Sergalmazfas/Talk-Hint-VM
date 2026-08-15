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
  micBtn: document.getElementById('micBtn'),
  numbersList: document.getElementById('numbersList'),
  foldersList: document.getElementById('foldersList'),
  foldersEmpty: document.getElementById('foldersEmpty'),
  newFolderBtn: document.getElementById('newFolderBtn'),
  folderModal: document.getElementById('folderModal'),
  modalTitle: document.getElementById('modalTitle'),
  modalClose: document.getElementById('modalClose'),
  modalCancel: document.getElementById('modalCancel'),
  modalSave: document.getElementById('modalSave'),
  modalFooter: document.getElementById('modalFooter'),
  folderName: document.getElementById('folderName'),
  folderPrompt: document.getElementById('folderPrompt'),
  planBadge: document.getElementById('planBadge'),
  upgradeBtn: document.getElementById('upgradeBtn'),
  manageBtn: document.getElementById('manageBtn'),
  dtmfToggleBtn: document.getElementById('dtmfToggleBtn'),
  dtmfKeypad: document.getElementById('dtmfKeypad')
};

let hasGoal = false;
let currentFolder = null;
let currentLanguage = localStorage.getItem('talkhint_language') || 'ru';
let callGoal = '';
let isInCall = false;
let userPrompts = [];
let userNumbers = [];
let currentNumber = null;
let editingPromptId = null;
let callMode = localStorage.getItem('talkhint_call_mode') || 'live';
let trainingSessionId = null;
let isTrainingActive = false;

// TTS settings for Training Mode
let ttsAutoplayGST = localStorage.getItem('talkhint_tts_autoplay') !== 'false'; // default ON
let currentAudio = null; // Currently playing audio

const LANGUAGE_FLAGS = {
  ru: '🇷🇺',
  es: '🇪🇸'
};

let socket = null;
let reconnectTimeout = null;
let activeCall = null;
let incomingCall = null;
let pendingCallSid = null;  // For push notification based calls
let device = null;
let isOnCall = false;
let lastMessageType = null;
let lastMessageTime = 0;
let lastMessageEl = null;
const GROUP_WINDOW_MS = 2000;

// Incoming call notification functions - for Twilio Device incoming calls
function showIncomingCallNotification(fromNumber, call) {
  incomingCall = call;
  pendingCallSid = null;  // This is a Twilio Device call, not push-based
  
  // Remove existing notification if any
  hideIncomingCallNotification();
  
  const notification = document.createElement('div');
  notification.id = 'incomingCallNotification';
  notification.className = 'incoming-call-notification';
  notification.innerHTML = `
    <div class="incoming-call-content">
      <div class="incoming-call-icon">📞</div>
      <div class="incoming-call-text">
        <div class="incoming-call-label">INCOMING CALL</div>
        <div class="incoming-call-from">${fromNumber}</div>
      </div>
    </div>
    <div class="incoming-call-buttons">
      <button id="acceptCallBtn" class="accept-call-btn">Accept</button>
      <button id="rejectCallBtn" class="reject-call-btn">Reject</button>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // Add button handlers for Twilio Device calls
  document.getElementById('acceptCallBtn').onclick = function() {
    log('Accepting Twilio Device call...');
    call.accept();
  };
  
  document.getElementById('rejectCallBtn').onclick = function() {
    log('Rejecting Twilio Device call...');
    call.reject();
    hideIncomingCallNotification();
  };
  
  // Play ring sound (optional)
  playRingTone();
}

// Show incoming call UI for PUSH NOTIFICATION based calls
function showPushIncomingCall(fromNumber, callSid) {
  pendingCallSid = callSid;
  incomingCall = null;  // This is push-based, not Twilio Device
  
  log('Showing push incoming call UI: ' + fromNumber + ' (callSid: ' + callSid + ')');
  
  // Remove existing notification if any
  hideIncomingCallNotification();
  
  var notification = document.createElement('div');
  notification.id = 'incomingCallNotification';
  notification.className = 'incoming-call-notification';
  notification.innerHTML = `
    <div class="incoming-call-content">
      <div class="incoming-call-icon">📞</div>
      <div class="incoming-call-text">
        <div class="incoming-call-label">INCOMING CALL</div>
        <div class="incoming-call-from">${fromNumber}</div>
      </div>
    </div>
    <div class="incoming-call-buttons">
      <button id="acceptCallBtn" class="accept-call-btn">Accept</button>
      <button id="rejectCallBtn" class="reject-call-btn">Reject</button>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // Add button handlers that call our API
  document.getElementById('acceptCallBtn').onclick = function() {
    acceptPushCall(callSid);
  };
  
  document.getElementById('rejectCallBtn').onclick = function() {
    rejectPushCall(callSid);
  };
  
  playRingTone();
}

// Accept call via API (for push-based calls)
async function acceptPushCall(callSid) {
  log('Accepting push call: ' + callSid);
  try {
    var response = await fetch('/api/call/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ callSid: callSid })
    });
    var data = await response.json();
    log('Accept response: ' + JSON.stringify(data));
    
    if (response.ok) {
      hideIncomingCallNotification();
      UI.statusText.textContent = 'Connecting...';
      // The hold loop will connect the call to our browser client
    } else {
      log('Accept failed: ' + data.error);
      alert('Failed to accept call: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    log('Accept error: ' + error.message);
    alert('Failed to accept call: ' + error.message);
  }
}

// Reject call via API (for push-based calls)
async function rejectPushCall(callSid) {
  log('Rejecting push call: ' + callSid);
  try {
    var response = await fetch('/api/call/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ callSid: callSid })
    });
    var data = await response.json();
    log('Reject response: ' + JSON.stringify(data));
    
    hideIncomingCallNotification();
  } catch (error) {
    log('Reject error: ' + error.message);
    hideIncomingCallNotification();
  }
}

// Check for pending calls when app opens (from push notification)
async function checkPendingCalls() {
  // First check URL params (from push notification click)
  var urlParams = new URLSearchParams(window.location.search);
  var callSidFromUrl = urlParams.get('callSid');
  var fromNumberFromUrl = urlParams.get('from');
  
  if (callSidFromUrl) {
    log('Found callSid in URL: ' + callSidFromUrl);
    showPushIncomingCall(fromNumberFromUrl || 'Unknown', callSidFromUrl);
    // Clean up URL without refresh
    if (window.history.replaceState) {
      window.history.replaceState({}, document.title, '/app');
    }
    return;
  }
  
  // Otherwise check pending calls API
  try {
    var response = await fetch('/api/call/pending', { credentials: 'include' });
    if (!response.ok) return;
    
    var data = await response.json();
    log('Pending calls check: ' + JSON.stringify(data));
    
    if (data.hasPendingCall && data.call) {
      showPushIncomingCall(data.call.fromNumber, data.call.callSid);
    }
  } catch (error) {
    log('Check pending calls error: ' + error.message);
  }
}

function hideIncomingCallNotification() {
  const notification = document.getElementById('incomingCallNotification');
  if (notification) {
    notification.remove();
  }
  incomingCall = null;
  stopRingTone();
}

let ringAudio = null;
function playRingTone() {
  // Simple visual/audio indication
  document.title = '📞 Incoming Call - TalkHint';
}

function stopRingTone() {
  document.title = 'TalkHint';
}

function log(msg) {
  console.log('[TalkHint] ' + msg);
}

function getWSUrl(path) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  let url = protocol + '//' + window.location.host + path;
  // The /ui (and /honor-stream) channels now require an authenticated token so
  // each user only receives their own call's transcripts and hints.
  const token = getAuthToken();
  if (token) {
    url += (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
  }
  return url;
}

function getAuthToken() {
  return localStorage.getItem('token') || localStorage.getItem('talkhint_token') || '';
}

function setGoalActive(active) {
  hasGoal = active;
  if (active) {
    UI.goalIndicator.classList.add('active');
  } else {
    UI.goalIndicator.classList.remove('active');
  }
}

async function loadUserNumbers() {
  try {
    const token = getAuthToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    const res = await fetch('/api/numbers', {
      credentials: 'include',
      headers: headers
    });
    if (res.ok) {
      const data = await res.json();
      userNumbers = data.numbers || [];
      renderNumbers(userNumbers);
      log('Loaded ' + userNumbers.length + ' numbers');
    } else {
      log('Failed to load numbers: ' + res.status);
      renderNumbers([]);
    }
  } catch (err) {
    log('Error loading numbers: ' + err.message);
    renderNumbers([]);
  }
}

function renderNumbers(numbers) {
  if (!UI.numbersList) return;
  UI.numbersList.innerHTML = '';
  
  // FROZEN: Filter out WORK numbers - only show personal for Basic plan
  var personalNumbers = numbers.filter(function(num) {
    return num.type !== 'work';
  });
  
  if (personalNumbers.length === 0) {
    UI.numbersList.innerHTML = '<div class="folders-empty">No numbers yet</div>';
    return;
  }

  personalNumbers.forEach(function(num) {
    var item = document.createElement('div');
    item.className = 'number-item';
    item.setAttribute('data-number-id', num.id);
    if (currentNumber === num.id) {
      item.classList.add('active');
    }
    
    // FROZEN: Always use personal icon, no WORK badge needed
    var icon = '📱';
    
    var iconSpan = document.createElement('span');
    iconSpan.className = 'number-icon';
    iconSpan.textContent = icon;
    
    var infoDiv = document.createElement('div');
    infoDiv.className = 'number-info';
    
    var nameDiv = document.createElement('div');
    nameDiv.className = 'number-name';
    nameDiv.textContent = num.name || 'My Number';
    
    var valueDiv = document.createElement('div');
    valueDiv.className = 'number-value';
    valueDiv.textContent = num.twilioNumber;
    
    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(valueDiv);
    
    // FROZEN: No badge - all numbers are personal now
    
    item.appendChild(iconSpan);
    item.appendChild(infoDiv);
    
    item.addEventListener('click', function() {
      selectNumber(num.id, num.twilioNumber);
    });
    
    UI.numbersList.appendChild(item);
  });
}

function selectNumber(numberId, twilioNumber) {
  currentNumber = numberId;
  log('Selected number: ' + twilioNumber);
  
  document.querySelectorAll('.number-item').forEach(function(item) {
    item.classList.remove('active');
    if (item.getAttribute('data-number-id') === numberId) {
      item.classList.add('active');
    }
  });
}

async function loadUserPrompts() {
  try {
    const token = getAuthToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    const res = await fetch('/api/prompts', {
      credentials: 'include',
      headers: headers
    });
    if (res.ok) {
      const data = await res.json();
      userPrompts = data.prompts || [];
      renderFolders(userPrompts);
      log('Loaded ' + userPrompts.length + ' prompts');
    } else {
      log('Failed to load prompts: ' + res.status);
      renderFolders([]);
    }
  } catch (err) {
    log('Error loading prompts: ' + err.message);
    renderFolders([]);
  }
}

function renderFolders(prompts) {
  UI.foldersList.innerHTML = '';
  
  if (prompts.length === 0) {
    UI.foldersList.innerHTML = '<div class="folders-empty">No prompts yet</div>';
    return;
  }

  prompts.forEach(function(prompt) {
    var item = document.createElement('div');
    item.className = 'folder-item';
    item.setAttribute('data-prompt-id', prompt.id);
    if (currentFolder === prompt.id) {
      item.classList.add('active');
    }
    
    var iconSpan = document.createElement('span');
    iconSpan.className = 'folder-icon';
    iconSpan.textContent = '📁';
    
    var nameSpan = document.createElement('span');
    nameSpan.className = 'folder-name';
    nameSpan.textContent = prompt.name;
    
    var actionsDiv = document.createElement('div');
    actionsDiv.className = 'folder-actions';
    
    var editBtn = document.createElement('button');
    editBtn.className = 'folder-action-btn edit-btn';
    editBtn.setAttribute('data-testid', 'button-edit-' + prompt.id);
    editBtn.textContent = '✏️';
    editBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      openEditModal(prompt);
    });
    
    var deleteBtn = document.createElement('button');
    deleteBtn.className = 'folder-action-btn delete-btn';
    deleteBtn.setAttribute('data-testid', 'button-delete-' + prompt.id);
    deleteBtn.textContent = '🗑️';
    deleteBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      deletePrompt(prompt.id);
    });
    
    actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(deleteBtn);
    
    item.appendChild(iconSpan);
    item.appendChild(nameSpan);
    item.appendChild(actionsDiv);
    
    item.addEventListener('click', function(e) {
      if (e.target.closest('.folder-action-btn')) return;
      selectPrompt(prompt.id, prompt.content);
    });
    
    UI.foldersList.appendChild(item);
  });
}

function selectPrompt(promptId, promptContent) {
  currentFolder = promptId;
  log('Selected prompt: ' + promptId);
  
  document.querySelectorAll('.folder-item').forEach(function(item) {
    item.classList.remove('active');
  });
  
  var selectedItem = document.querySelector('[data-prompt-id="' + promptId + '"]');
  if (selectedItem) {
    selectedItem.classList.add('active');
  }
  
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'set_context',
      folder: promptId,
      systemPrompt: promptContent || ''
    }));
  }
}

function openNewModal() {
  editingPromptId = null;
  UI.modalTitle.textContent = 'New Prompt';
  UI.folderName.value = '';
  UI.folderPrompt.value = '';
  
  var deleteBtn = document.getElementById('modalDelete');
  if (deleteBtn) deleteBtn.remove();
  
  UI.modalSave.textContent = 'Create';
  UI.folderModal.classList.add('active');
}

function openEditModal(prompt) {
  editingPromptId = prompt.id;
  UI.modalTitle.textContent = 'Edit Prompt';
  UI.folderName.value = prompt.name;
  UI.folderPrompt.value = prompt.content;
  
  var existingDelete = document.getElementById('modalDelete');
  if (existingDelete) existingDelete.remove();
  
  var deleteBtn = document.createElement('button');
  deleteBtn.id = 'modalDelete';
  deleteBtn.className = 'btn btn-danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.setAttribute('data-testid', 'button-modal-delete');
  deleteBtn.addEventListener('click', function() {
    deletePrompt(prompt.id);
    closeModal();
  });
  UI.modalFooter.insertBefore(deleteBtn, UI.modalCancel);
  
  UI.modalSave.textContent = 'Save';
  UI.folderModal.classList.add('active');
}

function closeModal() {
  UI.folderModal.classList.remove('active');
  editingPromptId = null;
}

async function savePrompt() {
  const name = UI.folderName.value.trim();
  const content = UI.folderPrompt.value.trim();
  
  if (!name) {
    alert('Please enter a name');
    return;
  }
  if (!content) {
    alert('Please enter a prompt');
    return;
  }
  
  const token = getAuthToken();
  if (!token) {
    alert('Please log in first');
    return;
  }
  
  try {
    let res;
    if (editingPromptId) {
      res = await fetch('/api/prompts/' + editingPromptId, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ name, content })
      });
    } else {
      res = await fetch('/api/prompts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ name, content })
      });
    }
    
    if (res.ok) {
      log('Prompt saved');
      closeModal();
      loadUserPrompts();
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to save');
    }
  } catch (err) {
    log('Save error: ' + err.message);
    alert('Failed to save prompt');
  }
}

async function deletePrompt(promptId) {
  if (!confirm('Delete this prompt?')) return;
  
  const token = getAuthToken();
  if (!token) return;
  
  try {
    const res = await fetch('/api/prompts/' + promptId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    
    if (res.ok) {
      log('Prompt deleted');
      if (currentFolder === promptId) {
        currentFolder = null;
      }
      loadUserPrompts();
    }
  } catch (err) {
    log('Delete error: ' + err.message);
  }
}

UI.newFolderBtn.addEventListener('click', openNewModal);
UI.modalClose.addEventListener('click', closeModal);
UI.modalCancel.addEventListener('click', closeModal);
UI.modalSave.addEventListener('click', savePrompt);
UI.folderModal.addEventListener('click', function(e) {
  if (e.target === UI.folderModal) closeModal();
});

function getSentimentEmoji(sentiment) {
  if (!sentiment) return '';
  switch (sentiment.sentiment) {
    case 'positive': return sentiment.score > 0.7 ? '😊' : '🙂';
    case 'negative': return sentiment.score > 0.7 ? '😠' : '😟';
    default: return '😐';
  }
}

function getSentimentClass(sentiment) {
  if (!sentiment) return '';
  return 'sentiment-' + sentiment.sentiment;
}

function updateLastSentiment(speaker, sentiment) {
  if (!sentiment) return;
  var targetType = speaker === 'owner' ? 'you' : 'guest';
  var messages = UI.chatContainer.querySelectorAll('.message.' + targetType);
  if (messages.length === 0) return;
  var lastMsg = messages[messages.length - 1];
  lastMsg.classList.remove('sentiment-positive', 'sentiment-negative', 'sentiment-neutral');
  lastMsg.classList.add(getSentimentClass(sentiment));
  var labelDiv = lastMsg.querySelector('.message-label');
  if (labelDiv) {
    var existingSentiment = labelDiv.querySelector('.message-sentiment');
    if (existingSentiment) {
      existingSentiment.textContent = ' ' + getSentimentEmoji(sentiment);
      existingSentiment.title = sentiment.sentiment + ' (' + Math.round(sentiment.score * 100) + '%)';
    } else {
      var sentimentSpan = document.createElement('span');
      sentimentSpan.className = 'message-sentiment';
      sentimentSpan.textContent = ' ' + getSentimentEmoji(sentiment);
      sentimentSpan.title = sentiment.sentiment + ' (' + Math.round(sentiment.score * 100) + '%)';
      labelDiv.appendChild(sentimentSpan);
    }
  }
}

// Track interim message elements per speaker type
var interimMessages = {};

// Update last interim message (replace text, don't accumulate)
function updateLastInterim(type, text) {
  if (!text) return;
  UI.emptyState.style.display = 'none';
  
  // PREPARE context: user messages are preparation chat, NOT a goal — the
  // indicator activates only on the server's goal_set after confirmation.
  if ((type === 'you' || type === 'honor') && !hasGoal && !isPrepareContext()) {
    setGoalActive(true);
  }
  
  // Check if we have an active interim message for this type
  if (interimMessages[type]) {
    var bubble = interimMessages[type].querySelector('.message-bubble');
    if (bubble) {
      bubble.textContent = text; // Replace, don't append
    }
  } else {
    // Create new interim message
    var msg = document.createElement('div');
    msg.className = 'message ' + type + ' interim';
    
    var label = (type === 'you' || type === 'honor') ? '🎙️ You' : '👤 Guest';
    var labelDiv = document.createElement('div');
    labelDiv.className = 'message-label';
    labelDiv.textContent = label;
    
    var bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = text;
    bubble.style.opacity = '0.7'; // Interim style
    
    msg.appendChild(labelDiv);
    msg.appendChild(bubble);
    UI.chatContainer.appendChild(msg);
    
    interimMessages[type] = msg;
  }
  
  UI.chatContainer.scrollTop = UI.chatContainer.scrollHeight;
}

// Finalize message (convert interim to final or add new final)
function finalizeMessage(type, text, translation, sentiment) {
  if (!text) return;
  
  // If we have an interim message, finalize it
  if (interimMessages[type]) {
    var msg = interimMessages[type];
    var bubble = msg.querySelector('.message-bubble');
    if (bubble) {
      bubble.textContent = text;
      bubble.style.opacity = '1'; // Full opacity for final
    }
    msg.classList.remove('interim');
    
    if (translation) {
      var transDiv = document.createElement('div');
      transDiv.className = 'message-translation';
      transDiv.textContent = (LANGUAGE_FLAGS[currentLanguage] || '🇷🇺') + ' ' + translation;
      msg.appendChild(transDiv);
    }
    
    if (sentiment) {
      msg.classList.add(getSentimentClass(sentiment));
    }
    
    // Update tracking
    lastMessageType = type;
    lastMessageTime = Date.now();
    lastMessageEl = msg;
    
    // Clear interim reference
    delete interimMessages[type];
  } else {
    // No interim exists, create fresh final message
    addMessage(type, text, translation, sentiment);
  }
  
  UI.chatContainer.scrollTop = UI.chatContainer.scrollHeight;
}

function filterJsonFromText(text) {
  if (!text) return text;
  
  // Remove JSON blocks like {...} or [{...}]
  var filtered = text.replace(/\{[\s\S]*?\}/g, '').replace(/\[[\s\S]*?\]/g, '');
  
  // Clean up leftover formatting
  filtered = filtered.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  filtered = filtered.trim();
  
  // If nothing left after filtering, try to extract useful fields
  if (!filtered && text.indexOf('{') !== -1) {
    try {
      var jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        var parsed = JSON.parse(jsonMatch[0]);
        var parts = [];
        if (parsed.suggestion) parts.push(parsed.suggestion);
        if (parsed.en || parsed.english) parts.push(parsed.en || parsed.english);
        if (parsed.translation || parsed.ru) parts.push(parsed.translation || parsed.ru);
        if (parsed.text) parts.push(parsed.text);
        filtered = parts.join('\n\n') || text;
      }
    } catch (e) {}
  }
  
  return filtered || text;
}

function addMessage(type, text, translation, sentiment) {
  if (!text) return;
  
  // Filter out JSON from text - never show raw JSON to users
  text = filterJsonFromText(text);
  if (translation) translation = filterJsonFromText(translation);
  
  UI.emptyState.style.display = 'none';
  
  // PREPARE context: user messages are preparation chat, NOT a goal — the
  // indicator activates only on the server's goal_set after confirmation.
  if ((type === 'you' || type === 'honor') && !hasGoal && !isPrepareContext()) {
    setGoalActive(true);
  }
  
  const now = Date.now();
  const shouldGroup = (type === lastMessageType) && 
                      (now - lastMessageTime < GROUP_WINDOW_MS) && 
                      lastMessageEl && 
                      (type === 'you' || type === 'honor' || type === 'guest');
  
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
    if (sentiment) {
      lastMessageEl.className = 'message ' + type + ' ' + getSentimentClass(sentiment);
      var existingSentiment = lastMessageEl.querySelector('.message-sentiment');
      if (existingSentiment) {
        existingSentiment.textContent = getSentimentEmoji(sentiment);
      }
    }
    lastMessageTime = now;
  } else {
    const msg = document.createElement('div');
    msg.className = 'message ' + type + (sentiment ? ' ' + getSentimentClass(sentiment) : '');
    
    let label = 'Assistant';
    if (type === 'you' || type === 'honor' || type === 'HON') label = '🎙️ You';
    else if (type === 'guest' || type === 'GST') label = '👤 Guest';
    else if (type === 'ai') label = '💡 AI';
    
    var labelDiv = document.createElement('div');
    labelDiv.className = 'message-label';
    labelDiv.textContent = label;
    
    if (sentiment) {
      var sentimentSpan = document.createElement('span');
      sentimentSpan.className = 'message-sentiment';
      sentimentSpan.textContent = ' ' + getSentimentEmoji(sentiment);
      sentimentSpan.title = sentiment.sentiment + ' (' + Math.round(sentiment.score * 100) + '%)';
      labelDiv.appendChild(sentimentSpan);
    }
    
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
  hideGoalBadge();
}

// Goal as a compact conversation-feed event (never a persistent banner).
// Deduped: the server re-echoes goal_set on reconnect / repeated set_goal.
var lastGoalFeedText = null;
function addGoalFeedEvent(text) {
  if (text === lastGoalFeedText) return;
  lastGoalFeedText = text;
  addMessage('ai', text);
}

// Goal badge in header (legacy — no longer shown during calls; kept for safety)
function showGoalBadge(goalText) {
  var existing = document.getElementById('goalBadge');
  if (existing) existing.remove();
  
  var badge = document.createElement('div');
  badge.id = 'goalBadge';
  badge.className = 'goal-badge';
  badge.innerHTML = '🎯 <span class="goal-text">' + escapeHtml(goalText) + '</span>';
  
  // Insert after status section
  var statusSection = document.querySelector('.status-section');
  if (statusSection && statusSection.parentNode) {
    statusSection.parentNode.insertBefore(badge, statusSection.nextSibling);
  }
}

function hideGoalBadge() {
  var badge = document.getElementById('goalBadge');
  if (badge) badge.remove();
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function addHint(english, translationText) {
  if (!english) return;
  UI.emptyState.style.display = 'none';
  
  // Reset message tracking to break grouping with guest messages
  lastMessageType = null;
  lastMessageEl = null;
  
  var hint = document.createElement('div');
  hint.className = 'hint hon-suggestion';  // Mark as HON suggestion
  hint.setAttribute('data-target', 'HON');  // Explicit target attribute
  
  var header = document.createElement('div');
  header.className = 'hint-header';
  header.textContent = '🎙️ Say this';  // Use mic emoji to indicate it's for owner
  
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

function addFastPhrase(text, translation, category) {
  if (!text) return;
  UI.emptyState.style.display = 'none';
  
  var fastPhrase = document.createElement('div');
  fastPhrase.className = 'fast-phrase';
  
  var categoryLabel = category === 'steer' ? '⚡ Quick tip' : '⏳ One sec';
  
  var header = document.createElement('div');
  header.className = 'fast-phrase-header';
  header.textContent = categoryLabel;
  
  var card = document.createElement('div');
  card.className = 'fast-phrase-card';
  
  var phrase = document.createElement('div');
  phrase.className = 'fast-phrase-text';
  phrase.textContent = text;
  card.appendChild(phrase);
  
  if (translation) {
    var transDiv = document.createElement('div');
    transDiv.className = 'fast-phrase-translation';
    transDiv.textContent = (LANGUAGE_FLAGS[currentLanguage] || '🇷🇺') + ' ' + translation;
    card.appendChild(transDiv);
  }
  
  fastPhrase.appendChild(header);
  fastPhrase.appendChild(card);
  UI.chatContainer.appendChild(fastPhrase);
  
  UI.chatContainer.scrollTop = UI.chatContainer.scrollHeight;
  
  setTimeout(function() {
    fastPhrase.classList.add('fade-out');
    setTimeout(function() {
      if (fastPhrase.parentNode) {
        fastPhrase.parentNode.removeChild(fastPhrase);
      }
    }, 500);
  }, 5000);
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
    
    device = new TwilioDevice(data.token, { 
      logLevel: 1,
      codecPreferences: ['opus', 'pcmu'],
      edge: 'ashburn',
      enableImprovedSignalingErrorPrecision: true,
      sounds: {
        incoming: false,
        outgoing: false,
        disconnect: false
      }
    });

    device.on('registered', async function() {
      log('Device registered');
      UI.statusDot.classList.add('connected');
      UI.statusText.textContent = 'Ready';
      UI.callBtn.disabled = false;
      
      // Setup audio devices
      try {
        await device.audio.setInputDevice('default');
        log('[Audio] Input device set to default');
        
        // List available input devices
        var inputDevices = await navigator.mediaDevices.enumerateDevices();
        var mics = inputDevices.filter(function(d) { return d.kind === 'audioinput'; });
        log('[Audio] Available microphones: ' + mics.length);
        mics.forEach(function(mic, i) {
          log('[Audio] Mic ' + i + ': ' + (mic.label || 'Unnamed') + ' (' + mic.deviceId.substring(0,8) + ')');
        });
      } catch (e) {
        log('[Audio] Device setup error: ' + e.message);
      }
    });

    device.on('error', function(err) {
      log('Device error: ' + err.message);
      UI.statusText.textContent = 'Error';
    });

    // Handle incoming calls
    device.on('incoming', function(call) {
      log('INCOMING CALL from: ' + call.parameters.From);
      
      // Show incoming call UI
      UI.statusText.textContent = 'Incoming...';
      UI.statusDot.classList.add('ringing');
      
      // Show notification
      const fromNumber = call.parameters.From || 'Unknown';
      showIncomingCallNotification(fromNumber, call);
      
      // Auto-answer for now (can change to manual later)
      // call.accept();
      
      call.on('accept', function() {
        log('Call accepted');
        activeCall = call;
        isOnCall = true;
        UI.statusText.textContent = 'On Call';
        UI.statusDot.classList.remove('ringing');
        UI.statusDot.classList.add('on-call');
        UI.callBtn.classList.add('on-call');
        UI.callBtn.textContent = 'End Call';
        hideIncomingCallNotification();
        showDtmfKeypad();
      });
      
      call.on('disconnect', function() {
        log('Incoming call ended');
        activeCall = null;
        isOnCall = false;
        UI.statusText.textContent = 'Ready';
        UI.statusDot.classList.remove('on-call', 'ringing');
        UI.callBtn.classList.remove('on-call');
        UI.callBtn.textContent = 'Start Call';
        hideIncomingCallNotification();
        hideDtmfKeypad();
      });
      
      call.on('cancel', function() {
        log('Incoming call cancelled');
        UI.statusText.textContent = 'Ready';
        UI.statusDot.classList.remove('ringing');
        hideIncomingCallNotification();
      });
    });

    await device.register();
    log('Device registered successfully');

  } catch (err) {
    var errorMsg = err && err.message ? err.message : (err ? String(err) : 'Unknown error');
    log('Init error: ' + errorMsg);
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
    var savedModel = localStorage.getItem('talkhint_model') || 'gpt-4.1-mini';
    socket.send(JSON.stringify({
      type: 'set_model',
      model: savedModel
    }));
    log('Sent initial model: ' + savedModel);
    // If a prepare_message was lost while the socket was down (onclose already
    // restored it to the input field), notify the user that they can resend.
    // At this point pendingPrepareText is null (cleared by onclose), and the
    // text is already in the input — just surface a prompt to send it.
    if (UI.textInput && UI.textInput.value.trim() && isPrepareContext()) {
      addMessage('ai', '🔄 Соединение восстановлено. Нажмите «Отправить», чтобы отправить сохранённое сообщение.');
    }
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
    // If we sent a prepare_message that the server has not yet acknowledged,
    // restore the text to the input field so the user can resend once the
    // connection is re-established — the long dictation must never be silently lost.
    if (pendingPrepareText) {
      var savedText = pendingPrepareText;
      pendingPrepareText = null;
      hidePrepareThinking();
      if (UI.textInput) UI.textInput.value = savedText;
      addMessage('ai', '⚠️ Связь прервана. Ваше сообщение сохранено в поле ввода — нажмите «Отправить» после восстановления соединения.');
    }
    reconnectTimeout = setTimeout(connectWebSocket, 3000);
  };

  socket.onerror = function() {
    log('WebSocket error');
  };
}

// STT garbage filter - ignore low-quality/incomplete phrases
function isGarbageSTT(text, confidence) {
  if (!text) return true;
  
  var trimmed = text.trim();
  
  // Too short - likely garbage
  var words = trimmed.split(/\s+/).filter(function(w) { return w.length > 0; });
  if (words.length < 3) return true;
  
  // Low confidence
  if (confidence !== undefined && confidence < 0.65) return true;
  
  // Common garbage patterns
  var garbagePatterns = [
    /^(so|the|and|but|or|um|uh|like)\s*$/i,
    /^(does it|so the|stairs|I'm stay|I stay)\.?$/i,
    /^\w{1,3}\.?$/  // Single short word
  ];
  
  for (var i = 0; i < garbagePatterns.length; i++) {
    if (garbagePatterns[i].test(trimmed)) return true;
  }
  
  return false;
}

// Safe Start fallback tracking
var safeStartRepliesWithoutGoal = 0;
var safeStartFallbackShown = false;

function handleMessage(data) {
  switch (data.type) {
    case 'connected':
      log('Server confirmed connection');
      // Don't sync model from `connected` — it reflects the server's pre-set_model
      // state and would clobber the user's saved choice on first connect. The
      // server confirms the adopted model via `model_changed` (handled below).
      break;

    case 'model_changed':
      if (data.model) syncModelFromServer(data.model);
      break;

    case 'owner_transcript':
    case 'hon_transcript':
      if (data.text) {
        // STT garbage filter for HON
        if (data.isFinal && isGarbageSTT(data.text, data.confidence)) {
          log('Filtered garbage HON STT: ' + data.text);
          break;
        }
        
        // For interim results, update last message instead of adding new
        if (data.isFinal === false) {
          updateLastInterim('you', data.text);
        } else {
          finalizeMessage('you', data.text);
        }
      }
      break;

    case 'sentiment_update':
      updateLastSentiment(data.speaker, data.sentiment);
      break;

    case 'guest_transcript':
    case 'gst_transcript':
      if (data.text) {
        // STT garbage filter for GST/CALLER
        if (data.isFinal && isGarbageSTT(data.text, data.confidence)) {
          log('Filtered garbage GST STT: ' + data.text);
          break;
        }

        // For interim results, update last message instead of adding new
        if (data.isFinal === false) {
          updateLastInterim('guest', data.text);
        } else {
          finalizeMessage('guest', data.text, data.translation, data.sentiment);
          
          // Safe Start fallback: if no goal after 3 GST replies, show steer hint
          if (!callGoal && isInCall && data.isFinal) {
            safeStartRepliesWithoutGoal++;
            if (safeStartRepliesWithoutGoal >= 3 && !safeStartFallbackShown) {
              safeStartFallbackShown = true;
              addHint(
                'Just to check — are you calling to meet, ask a question, or schedule something?',
                'Уточню — вы звоните чтобы встретиться, задать вопрос или что-то запланировать?'
              );
            }
          }
        }
      }
      break;

    case 'suggestion':
    case 'ai_hint':
    case 'hint':
      if (data.en || data.english) {
        addHint(data.en || data.english, data.translation || data.ru || data.russian);
        // Delivery ack: confirms the device rendered the hint (final stage of
        // the speech→hint latency chain measured server-side).
        if (typeof data.utteranceId === 'number' && data.callSid && socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'suggestion_ack', utteranceId: data.utteranceId, callSid: data.callSid }));
        }
      }
      break;

    case 'fast_phrase':
      if (data.text) {
        addFastPhrase(data.text, data.translation, data.category);
      }
      break;

    case 'ai_response':
      if (data.text) {
        addMessage('ai', data.text, data.translation);
      }
      break;

    case 'error':
      log('Error: ' + data.error);
      break;

    case 'goal_state_update':
      // Auto-detect goal from conversation. Goal is a compact event in the
      // conversation feed (scrolls away with history), not a persistent banner.
      if (data.goalType && data.goalType !== 'other') {
        var goalLabel = getGoalLabel(data.goalType);
        if (!callGoal) {
          callGoal = goalLabel;
          setGoalActive(true);
          addGoalFeedEvent('🎯 Цель: ' + goalLabel);
        }
      }
      break;

    case 'prepare_reply':
      pendingPrepareText = null; // server acknowledged the prepare_message
      hidePrepareThinking();
      if (data.text) addMessage('ai', data.text);
      if (data.proposedGoal) addGoalProposal(data.proposedGoal);
      break;

    case 'prepare_opening':
      pendingPrepareText = null; // server acknowledged (goal-confirm flow)
      hidePrepareThinking();
      if (data.phraseEn) {
        addHint(data.phraseEn, data.translation || '');
        addMessage('ai', '📞 Цель подтверждена. Начинайте звонок с этой фразы — я буду подсказывать дальше.');
      }
      break;

    case 'prepare_error':
      pendingPrepareText = null; // server acknowledged (error path)
      hidePrepareThinking();
      addMessage('ai', '⚠️ ' + (data.text || 'Ошибка подготовки.'));
      break;

    case 'goal_set':
      if (data.goal) {
        callGoal = data.goal;
        setGoalActive(true);
        addGoalFeedEvent('🎯 Цель: ' + data.goal);
      }
      break;

    case 'goal_updated':
      // The user redefined the goal mid-call via the assistant input; Brain now
      // uses the new goal. Old goal stays in history, new one joins the feed.
      if (data.goal) {
        callGoal = data.goal;
        setGoalActive(true);
        addGoalFeedEvent('🎯 Цель обновлена: ' + data.goal);
      }
      break;

    case 'goal_achieved':
      if (data.goalType) {
        addMessage('ai', '✅ Цель достигнута: ' + getGoalLabel(data.goalType));
      }
      break;
  }
}

function getGoalLabel(goalType) {
  var labels = {
    'booking': 'Запись/Бронирование',
    'pricing': 'Узнать цены',
    'support': 'Техподдержка',
    'info': 'Информация',
    'negotiation': 'Переговоры'
  };
  return labels[goalType] || goalType;
}

async function makeCall() {
  const phoneNumber = UI.phoneInput.value.trim();
  
  log('[makeCall] Starting... phoneNumber=' + phoneNumber);
  
  if (!phoneNumber) {
    log('[makeCall] ERROR: No phone number entered');
    UI.statusText.textContent = 'Enter number';
    return;
  }

  if (!device) {
    log('[makeCall] ERROR: Twilio device not initialized');
    UI.statusText.textContent = 'Not ready';
    return;
  }

  log('[makeCall] Device state: ' + device.state);
  log('[makeCall] Calling: ' + phoneNumber);
  UI.statusDot.classList.add('calling');
  UI.statusText.textContent = 'Calling...';
  UI.callBtn.disabled = true;
  
  clearChat();
  
  if (callGoal) {
    setGoalActive(true);
  }

  try {
    // Get the selected Twilio number to use as callerId
    var selectedNum = userNumbers.find(function(n) { return n.id === currentNumber; });
    var fromNumber = selectedNum ? selectedNum.twilioNumber : null;
    
    log('[makeCall] Selected number ID: ' + currentNumber);
    log('[makeCall] User numbers available: ' + userNumbers.length);
    log('[makeCall] Using callerId: ' + (fromNumber || 'default'));
    
    log('[makeCall] Calling device.connect()...');
    activeCall = await device.connect({ 
      params: { 
        To: phoneNumber,
        CallerId: fromNumber || '' // Custom param for callerId (From is overwritten by Twilio)
      } 
    });
    
    activeCall.on('accept', function() {
      log('Call connected');
      isInCall = true;
      // Leaving PREPARE context: stop any active prepare recording and hide the mic.
      if (isPrepareRecording && prepareRecorder && prepareRecorder.state !== 'inactive') { prepareRecorder.stop(); isPrepareRecording = false; }
      updateMicButtonVisibility();
      UI.statusDot.classList.remove('calling');
      UI.statusDot.classList.add('active');
      UI.statusText.textContent = 'In Call';
      UI.textInput.placeholder = 'Задайте вопрос ассистенту...';
      UI.callBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>';
      UI.callBtn.classList.remove('start');
      UI.callBtn.classList.add('end');
      UI.callBtn.disabled = false;
      
      // Log audio track info for debugging
      try {
        var localStream = activeCall.getLocalStream && activeCall.getLocalStream();
        var remoteStream = activeCall.getRemoteStream && activeCall.getRemoteStream();
        log('[Audio] Local stream: ' + (localStream ? 'OK (' + localStream.getAudioTracks().length + ' tracks)' : 'NONE'));
        log('[Audio] Remote stream: ' + (remoteStream ? 'OK (' + remoteStream.getAudioTracks().length + ' tracks)' : 'NONE'));
        
        if (localStream) {
          var localTracks = localStream.getAudioTracks();
          localTracks.forEach(function(track, i) {
            log('[Audio] Local track ' + i + ': enabled=' + track.enabled + ' muted=' + track.muted + ' label=' + track.label);
            // Ensure track is enabled
            if (!track.enabled) {
              track.enabled = true;
              log('[Audio] Enabled local track ' + i);
            }
          });
        }
        
        // Check if call is muted and unmute
        if (activeCall.isMuted && activeCall.isMuted()) {
          log('[Audio] Call was muted, unmuting...');
          activeCall.mute(false);
        }
        log('[Audio] Call muted status: ' + (activeCall.isMuted ? activeCall.isMuted() : 'unknown'));
      } catch (e) {
        log('[Audio] Stream check error: ' + e.message);
      }
      
      if (callGoal) {
        addGoalFeedEvent('🎯 Цель: ' + callGoal);
      } else {
        // Safe Start: no goal set, AI will help discover it
        addMessage('ai', '👋 Звонок начался! Я слушаю и буду подсказывать.');
        addHint('What brings you to call today?', 'Что привело вас сегодня?');
      }
      
      // Start quality monitoring for debugging audio issues
      startQualityMonitoring(activeCall);
      
      // Show DTMF keypad for IVR navigation
      showDtmfKeypad();
    });

    activeCall.on('disconnect', function() {
      log('Call disconnected');
      hideDtmfKeypad();
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
    var errorMsg = err && err.message ? err.message : (err ? String(err) : 'Unknown error');
    log('Call failed: ' + errorMsg);
    UI.statusText.textContent = 'Call failed';
    resetCallUI();
  }
}

function resetCallUI() {
  activeCall = null;
  isInCall = false;
  callGoal = '';  // Reset goal for next call
  lastGoalFeedText = null;  // Next call may legitimately reuse the same goal text
  // Clear the goal server-side too, so a rejected/failed call can't leave a
  // stale goal grounding the next call's hints. Also reset any abandoned
  // PREPARE conversation — the next call starts from a clean slate.
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'set_goal', goal: '' }));
    socket.send(JSON.stringify({ type: 'prepare_reset' }));
  }
  // Call started — any unacknowledged PREPARE message is now stale.
  pendingPrepareText = null;
  pendingPrepareAudio = null;
  hideDtmfKeypad();  // Hide DTMF keypad
  
  // Reset Safe Start fallback tracking
  safeStartRepliesWithoutGoal = 0;
  safeStartFallbackShown = false;
  
  UI.statusDot.classList.remove('active', 'calling');
  UI.statusDot.classList.add('connected');
  UI.statusText.textContent = 'Ready';
  UI.textInput.placeholder = 'Напишите цель звонка...';
  UI.callBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>';
  UI.callBtn.classList.remove('end');
  UI.callBtn.classList.add('start');
  UI.callBtn.disabled = false;
  
  // Hide goal badge and reset goal state
  hideGoalBadge();
  setGoalActive(false);
  
  // Stop quality monitoring
  if (qualityMonitorInterval) {
    clearInterval(qualityMonitorInterval);
    qualityMonitorInterval = null;
  }

  // Back in PREPARE context — the mic reappears for the next preparation.
  updateMicButtonVisibility();
}

var qualityMonitorInterval = null;

function startQualityMonitoring(call) {
  if (qualityMonitorInterval) {
    clearInterval(qualityMonitorInterval);
  }
  
  log('[Quality] Starting quality monitoring...');
  
  // Monitor call quality every 5 seconds
  qualityMonitorInterval = setInterval(async function() {
    try {
      if (!call || call.status() !== 'open') {
        log('[Quality] Call not active, stopping monitor');
        clearInterval(qualityMonitorInterval);
        qualityMonitorInterval = null;
        return;
      }
      
      // Get RTC stats if available
      var stats = await call.getStats();
      if (stats && stats.length > 0) {
        var report = stats[0];
        if (report) {
          var mos = report.mos ? report.mos.toFixed(2) : 'N/A';
          var jitter = report.jitter ? Math.round(report.jitter) : 'N/A';
          var rtt = report.rtt ? Math.round(report.rtt) : 'N/A';
          var packetsLost = report.packetsLost || 0;
          var packetsSent = report.packetsSent || 0;
          var packetsReceived = report.packetsReceived || 0;
          var lossRate = packetsSent > 0 ? ((packetsLost / packetsSent) * 100).toFixed(2) : '0';
          
          log('[Quality] MOS=' + mos + ' jitter=' + jitter + 'ms RTT=' + rtt + 'ms loss=' + lossRate + '% (lost:' + packetsLost + ')');
          
          // Alert if quality is degrading
          if (report.mos && report.mos < 3.0) {
            log('[Quality] WARNING: Poor call quality detected (MOS < 3.0)');
          }
          if (packetsLost > 10) {
            log('[Quality] WARNING: Packet loss detected (' + packetsLost + ' packets)');
          }
        }
      }
    } catch (err) {
      log('[Quality] Stats error: ' + err.message);
    }
  }, 5000);
  
  // Also listen for quality warnings from Twilio
  call.on('warning', function(name) {
    log('[Quality] WARNING event: ' + name);
  });
  
  call.on('warning-cleared', function(name) {
    log('[Quality] Warning cleared: ' + name);
  });
}

function stopQualityMonitoring() {
  if (qualityMonitorInterval) {
    clearInterval(qualityMonitorInterval);
    qualityMonitorInterval = null;
    log('[Quality] Monitoring stopped');
  }
}

function endCall() {
  stopQualityMonitoring();
  if (activeCall) {
    activeCall.disconnect();
    log('Call ended');
  }
  hideDtmfKeypad();
}

function sendDtmf(digit) {
  if (!activeCall) {
    log('[DTMF] No active call');
    return false;
  }
  
  try {
    activeCall.sendDigits(digit);
    log('[DTMF] Sent: ' + digit);
    
    addMessage('system', 'Pressed: ' + digit, { isDtmf: true });
    
    return true;
  } catch (err) {
    log('[DTMF] Error: ' + err.message);
    return false;
  }
}

function showDtmfKeypad() {
  if (UI.dtmfToggleBtn) {
    UI.dtmfToggleBtn.classList.add('visible');
  }
}

function hideDtmfKeypad() {
  if (UI.dtmfToggleBtn) {
    UI.dtmfToggleBtn.classList.remove('visible', 'active');
  }
  if (UI.dtmfKeypad) {
    UI.dtmfKeypad.classList.remove('visible');
  }
}

function toggleDtmfKeypad() {
  if (UI.dtmfKeypad && UI.dtmfToggleBtn) {
    var isVisible = UI.dtmfKeypad.classList.contains('visible');
    if (isVisible) {
      UI.dtmfKeypad.classList.remove('visible');
      UI.dtmfToggleBtn.classList.remove('active');
    } else {
      UI.dtmfKeypad.classList.add('visible');
      UI.dtmfToggleBtn.classList.add('active');
    }
  }
}

if (UI.dtmfToggleBtn) {
  UI.dtmfToggleBtn.addEventListener('click', toggleDtmfKeypad);
}

if (UI.dtmfKeypad) {
  UI.dtmfKeypad.querySelectorAll('.dtmf-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var digit = this.getAttribute('data-digit');
      if (digit) {
        sendDtmf(digit);
      }
    });
  });
}

document.addEventListener('click', function(e) {
  if (UI.dtmfKeypad && UI.dtmfKeypad.classList.contains('visible')) {
    if (!UI.dtmfKeypad.contains(e.target) && !UI.dtmfToggleBtn.contains(e.target)) {
      UI.dtmfKeypad.classList.remove('visible');
      UI.dtmfToggleBtn.classList.remove('active');
    }
  }
});

UI.callBtn.addEventListener('click', function() {
  // Training mode: toggle training session
  if (callMode === 'training') {
    if (isTrainingActive) {
      stopTrainingSession();
    } else {
      startTrainingSession();
    }
    return;
  }
  
  // Live mode: normal Twilio call
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

async function generateInitialHint(goal) {
  try {
    var token = getAuthToken();
    var response = await fetch('/api/generate-initial-hint', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? 'Bearer ' + token : ''
      },
      body: JSON.stringify({ goal: goal, language: currentLanguage })
    });
    
    if (response.ok) {
      var data = await response.json();
      return { en: data.en, ru: data.translation };
    }
  } catch (err) {
    log('Error generating initial hint: ' + err.message);
  }
  
  // Fallback to local detection
  return getNextStepHintLocal(goal);
}

function getNextStepHintLocal(goal) {
  var goalLower = (goal || '').toLowerCase();
  
  // JOB / HIRING
  if (goalLower.includes('работ') || goalLower.includes('job') || goalLower.includes('hiring') || 
      goalLower.includes('driver') || goalLower.includes('водител') || goalLower.includes('трудоустр') ||
      goalLower.includes('вакан') || goalLower.includes('position') || goalLower.includes('employ')) {
    return { en: 'Hi, are you currently hiring?', ru: 'Здравствуйте, вы сейчас набираете сотрудников?' };
  }
  
  // APPOINTMENT / MEETING
  if (goalLower.includes('встреч') || goalLower.includes('meet') || goalLower.includes('appointment')) {
    return { en: 'What time works for you tomorrow?', ru: 'Во сколько вам удобно завтра?' };
  }
  
  // BOOKING / SCHEDULE
  if (goalLower.includes('запис') || goalLower.includes('book') || goalLower.includes('schedule')) {
    return { en: 'Do you have any availability this week?', ru: 'Есть ли у вас свободное время на этой неделе?' };
  }
  
  // PRICE / COST
  if (goalLower.includes('цен') || goalLower.includes('price') || goalLower.includes('cost') || goalLower.includes('стоим')) {
    return { en: 'Could you tell me the price for...?', ru: 'Можете сказать цену на...?' };
  }
  
  // INFO / QUESTION
  if (goalLower.includes('узнать') || goalLower.includes('info') || goalLower.includes('question')) {
    return { en: 'I have a quick question about...', ru: 'У меня быстрый вопрос про...' };
  }
  
  // Default: generic opener
  return { en: 'Hello, I am calling about...', ru: 'Здравствуйте, я звоню по поводу...' };
}

// --- PREPARE stage (Task #183): pre-call preparation chat with GPT-5.6 Sol ---

function sendPrepareMessage(text) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    // Store in the outbox BEFORE calling send() so that if the socket closes
    // between the send() call and the server ack the text is not lost.
    pendingPrepareText = text;
    socket.send(JSON.stringify({ type: 'prepare_message', text: text }));
    showPrepareThinking();
    return true;
  } else {
    // Always overwrite the input field with the pending text — regardless of
    // any existing draft — so the user can click Send once the connection
    // is restored without retyping or re-recording.
    if (UI.textInput) {
      UI.textInput.value = text;
    }
    addMessage('ai', '⚠️ Нет соединения с сервером. Ваш текст сохранён в поле ввода — нажмите «Отправить» ещё раз, когда связь восстановится.');
    return false;
  }
}

var prepareThinkingEl = null;
function showPrepareThinking() {
  hidePrepareThinking();
  prepareThinkingEl = document.createElement('div');
  prepareThinkingEl.className = 'message ai';
  prepareThinkingEl.innerHTML = '<div class="message-label">AI</div><div class="message-bubble" style="color:#9ca3af;">…</div>';
  UI.chatContainer.appendChild(prepareThinkingEl);
  UI.chatContainer.scrollTop = UI.chatContainer.scrollHeight;
}
function hidePrepareThinking() {
  if (prepareThinkingEl && prepareThinkingEl.parentNode) prepareThinkingEl.parentNode.removeChild(prepareThinkingEl);
  prepareThinkingEl = null;
}

// Proposed-goal card: compact goal + "✓ Всё верно / Изменить". The goal is
// NOT active until the user confirms; "Изменить" just continues the dialog.
function addGoalProposal(goal) {
  var wrap = document.createElement('div');
  wrap.className = 'message ai';
  wrap.setAttribute('data-testid', 'goal-proposal');
  var bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.style.border = '1px solid #f59e0b';
  bubble.style.background = 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)';
  var label = document.createElement('div');
  label.style.cssText = 'font-size:0.7rem;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;';
  label.textContent = '🎯 Цель звонка';
  var goalText = document.createElement('div');
  goalText.textContent = goal;
  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:10px;';
  var okBtn = document.createElement('button');
  okBtn.textContent = '✓ Всё верно';
  okBtn.setAttribute('data-testid', 'button-goal-confirm');
  okBtn.style.cssText = 'flex:1;padding:8px 12px;border:none;border-radius:8px;background:#10a37f;color:#fff;font-weight:600;cursor:pointer;font-size:0.9rem;';
  var editBtn = document.createElement('button');
  editBtn.textContent = 'Изменить';
  editBtn.setAttribute('data-testid', 'button-goal-edit');
  editBtn.style.cssText = 'flex:1;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;cursor:pointer;font-size:0.9rem;';
  okBtn.addEventListener('click', function() {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'prepare_confirm_goal', goal: goal }));
      btnRow.remove();
      showPrepareThinking();
    }
  });
  editBtn.addEventListener('click', function() {
    btnRow.remove();
    UI.textInput.placeholder = 'Что изменить в цели?';
    UI.textInput.focus();
  });
  btnRow.appendChild(okBtn);
  btnRow.appendChild(editBtn);
  bubble.appendChild(label);
  bubble.appendChild(goalText);
  bubble.appendChild(btnRow);
  var msgLabel = document.createElement('div');
  msgLabel.className = 'message-label';
  msgLabel.textContent = 'AI';
  wrap.appendChild(msgLabel);
  wrap.appendChild(bubble);
  UI.chatContainer.appendChild(wrap);
  UI.chatContainer.scrollTop = UI.chatContainer.scrollHeight;
}

function sendTextToAI() {
  const text = UI.textInput.value.trim();
  if (!text) return;
  
  // Training mode: send to training API
  if (callMode === 'training' && isTrainingActive) {
    sendTrainingTurn(text);
    UI.textInput.value = '';
    return;
  }
  
  if (!isInCall && !isTrainingActive) {
    if (callMode === 'training') {
      // Training keeps the legacy behavior: first message becomes the goal.
      callGoal = text;
      setGoalActive(true);
      addMessage('honor', text);
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'set_goal', goal: text }));
      }
      addMessage('ai', '🎯 Goal set! Click the phone button to start training.');
    } else {
      // PREPARE stage (live mode): the message goes to the preparation chat
      // with GPT-5.6 Sol. The goal appears ONLY after Sol proposes it and the
      // user presses "✓ Всё верно" (prepare_confirm_goal -> goal_set echo).
      addMessage('honor', text);
      if (sendPrepareMessage(text)) {
        // WS was open — message queued; clear the input.
        UI.textInput.value = '';
      }
      // If WS was down, sendPrepareMessage already restored text to the input;
      // we must not clear it here — the user needs it for the retry.
      return;
    }
  } else {
    addMessage('honor', text);
    
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'ask_ai',
        question: text,
        goal: callGoal
      }));
    }
  }
  
  UI.textInput.value = '';
}

UI.textInput.addEventListener('keypress', function(e) {
  if (e.key === 'Enter') {
    sendTextToAI();
  }
});

UI.sendBtn.addEventListener('click', function() {
  sendTextToAI();
});

UI.toggleSidebarBtn.addEventListener('click', function() {
  UI.sidebar.classList.toggle('collapsed');
});

UI.closeSidebarBtn.addEventListener('click', function() {
  UI.sidebar.classList.add('collapsed');
});

var LANGUAGE_DISPLAY = {
  ru: { flag: '🇷🇺', name: 'Russian' },
  es: { flag: '🇪🇸', name: 'Spanish' }
};

function updateLanguageSelector(langCode) {
  var display = LANGUAGE_DISPLAY[langCode] || LANGUAGE_DISPLAY['ru'];
  var flagEl = document.getElementById('currentLangFlag');
  var nameEl = document.getElementById('currentLangName');
  if (flagEl) flagEl.textContent = display.flag;
  if (nameEl) nameEl.textContent = display.name;
}

function toggleLanguageDropdown() {
  var dropdown = document.getElementById('languageDropdown');
  if (dropdown) {
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  }
}

function selectLanguage(langCode) {
  currentLanguage = langCode;
  localStorage.setItem('talkhint_language', langCode);
  log('Selected language: ' + langCode);
  
  updateLanguageSelector(langCode);
  
  // Close dropdown
  var dropdown = document.getElementById('languageDropdown');
  if (dropdown) dropdown.style.display = 'none';
  
  document.querySelectorAll('[data-lang]').forEach(function(item) {
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

// Language selector toggle
var langSelector = document.getElementById('languageSelector');
if (langSelector) {
  langSelector.addEventListener('click', function(e) {
    e.stopPropagation();
    toggleLanguageDropdown();
  });
}

// Language item selection
document.querySelectorAll('.language-item').forEach(function(item) {
  item.addEventListener('click', function(e) {
    e.stopPropagation();
    var langCode = this.getAttribute('data-lang');
    if (langCode) {
      selectLanguage(langCode);
    }
  });
});

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  var dropdown = document.getElementById('languageDropdown');
  var selector = document.getElementById('languageSelector');
  if (dropdown && selector && !selector.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.style.display = 'none';
  }
});

(function initLanguage() {
  var savedLang = localStorage.getItem('talkhint_language') || 'ru';
  updateLanguageSelector(savedLang);
  var langItem = document.querySelector('[data-lang="' + savedLang + '"]');
  if (langItem) {
    langItem.classList.add('active');
  }
})();

// AI Model selector
var MODEL_DISPLAY = {
  'gpt-4.1-mini': 'GPT-4.1 mini',
  'gpt-4.1-nano': 'GPT-4.1 nano',
  'gpt-4o-mini': 'GPT-4o mini',
  'gpt-4o': 'GPT-4o',
  'gemini-2.5-flash-lite': 'Gemini 2.5 Flash-Lite',
  'gemini-2.5-flash': 'Gemini 2.5 Flash'
};

function updateModelSelector(modelId) {
  var nameEl = document.getElementById('currentModelName');
  if (nameEl) nameEl.textContent = MODEL_DISPLAY[modelId] || MODEL_DISPLAY['gpt-4.1-mini'];
}

// Reconcile the UI + localStorage with the model the server actually applied
// (e.g. after a rejected/unknown local value or on reconnect).
function syncModelFromServer(modelId) {
  if (!MODEL_DISPLAY[modelId]) return;
  localStorage.setItem('talkhint_model', modelId);
  updateModelSelector(modelId);
  document.querySelectorAll('[data-model]').forEach(function(item) {
    item.classList.toggle('active', item.getAttribute('data-model') === modelId);
  });
  log('Model confirmed by server: ' + modelId);
}

function toggleModelDropdown() {
  var dropdown = document.getElementById('modelDropdown');
  if (dropdown) {
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  }
}

function selectModel(modelId) {
  localStorage.setItem('talkhint_model', modelId);
  log('Selected model: ' + modelId);

  updateModelSelector(modelId);

  var dropdown = document.getElementById('modelDropdown');
  if (dropdown) dropdown.style.display = 'none';

  document.querySelectorAll('[data-model]').forEach(function(item) {
    item.classList.remove('active');
  });
  var selectedItem = document.querySelector('[data-model="' + modelId + '"]');
  if (selectedItem) selectedItem.classList.add('active');

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'set_model',
      model: modelId
    }));
  }
}

var modelSelector = document.getElementById('modelSelector');
if (modelSelector) {
  modelSelector.addEventListener('click', function(e) {
    e.stopPropagation();
    toggleModelDropdown();
  });
}

document.querySelectorAll('[data-model]').forEach(function(item) {
  item.addEventListener('click', function(e) {
    e.stopPropagation();
    var modelId = this.getAttribute('data-model');
    if (modelId) selectModel(modelId);
  });
});

document.addEventListener('click', function(e) {
  var dropdown = document.getElementById('modelDropdown');
  var selector = document.getElementById('modelSelector');
  if (dropdown && selector && !selector.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.style.display = 'none';
  }
});

(function initModel() {
  var savedModel = localStorage.getItem('talkhint_model') || 'gemini-2.5-flash-lite';
  updateModelSelector(savedModel);
  var modelItem = document.querySelector('[data-model="' + savedModel + '"]');
  if (modelItem) modelItem.classList.add('active');
})();

// Call Mode Toggle (Live / Training)
function setCallMode(mode) {
  if (callMode === mode) return;
  
  callMode = mode;
  localStorage.setItem('talkhint_call_mode', mode);
  log('Call mode set to: ' + mode);
  
  // Update UI toggle
  document.querySelectorAll('.mode-option').forEach(function(item) {
    item.classList.remove('active');
  });
  var selectedMode = document.querySelector('[data-mode="' + mode + '"]');
  if (selectedMode) {
    selectedMode.classList.add('active');
  }
  
  // Toggle training mode class on body
  if (mode === 'training') {
    document.body.classList.add('training-mode');
    UI.phoneInput.placeholder = 'Not needed in Training';
    UI.textInput.placeholder = 'Write your goal...';
    UI.statusText.textContent = 'Training Ready';
  } else {
    document.body.classList.remove('training-mode');
    UI.phoneInput.placeholder = '+1 234 567 8900';
    UI.textInput.placeholder = 'Напишите цель звонка...';
    if (device && device.state === 'registered') {
      UI.statusText.textContent = 'Ready';
    }
  }
  
  // Update microphone button visibility
  log('[Mode] Calling updateMicButtonVisibility after mode change to: ' + mode);
  updateMicButtonVisibility();
  
  // Save to server
  saveCallModeToServer(mode);
}

async function saveCallModeToServer(mode) {
  try {
    var token = getAuthToken();
    if (!token) return;
    
    await fetch('/api/user/call-mode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ callMode: mode })
    });
  } catch (err) {
    log('Error saving call mode: ' + err.message);
  }
}

document.querySelectorAll('.mode-option').forEach(function(item) {
  item.addEventListener('click', function() {
    var mode = this.getAttribute('data-mode');
    if (mode) {
      // PAYWALL: Live call requires subscription
      if (mode === 'live' && !hasActiveSubscription()) {
        showUpgradeModal();
        return;
      }
      setCallMode(mode);
    }
  });
});

// Initial call mode - will be re-evaluated after subscription loads
(function initCallMode() {
  // Default to training for new users (will be checked after subscription loads)
  var savedMode = localStorage.getItem('talkhint_call_mode') || 'training';
  callMode = savedMode;
  var modeItem = document.querySelector('[data-mode="' + savedMode + '"]');
  if (modeItem) {
    document.querySelectorAll('.mode-option').forEach(function(item) {
      item.classList.remove('active');
    });
    modeItem.classList.add('active');
  }
  if (savedMode === 'training') {
    document.body.classList.add('training-mode');
    UI.phoneInput.placeholder = 'Not needed in Training';
    UI.textInput.placeholder = 'Write your goal...';
  }
})();

// Force training mode if no subscription (called after subscription loads)
function enforceCallModeBySubscription() {
  if (!hasActiveSubscription() && callMode === 'live') {
    log('[Mode] No subscription, forcing training mode');
    setCallMode('training');
  }
}

// Training Mode Functions
async function startTrainingSession() {
  if (!callGoal) {
    addSystemMessage('Please set a call goal first (type in the text box below)');
    return;
  }
  
  log('Starting training session with goal: ' + callGoal);
  isTrainingActive = true;
  
  try {
    var token = getAuthToken();
    var res = await fetch('/training/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        goal: callGoal,
        conversationLanguage: 'en', // GST always speaks English
        hintLanguage: currentLanguage // User's native language for translations
      })
    });
    
    var data = await res.json();
    if (data.sessionId) {
      trainingSessionId = data.sessionId;
      log('Training session started: ' + trainingSessionId);
      
      // Update UI
      UI.callBtn.classList.add('on-call');
      UI.statusText.textContent = 'Training Active';
      UI.statusDot.classList.add('on-call');
      
      // Switch input field to Chat/Message mode
      UI.textInput.placeholder = 'Type your reply or use mic...';
      
      // Show initial hint based on goal - what should user say FIRST
      if (data.initialHint) {
        addSystemMessage('Say this to start the call:');
        addHint(data.initialHint.suggestion, data.initialHint.translation);
        if (data.initialHint.context) {
          addSystemMessage(data.initialHint.context);
        }
      } else {
        addSystemMessage('Training session started! Say your opening phrase.');
      }
      
      // Show microphone button for voice input
      log('[Training] Calling updateMicButtonVisibility after session start');
      updateMicButtonVisibility();
    } else {
      log('Failed to start training: ' + (data.error || 'Unknown error'));
      isTrainingActive = false;
    }
  } catch (err) {
    log('Error starting training: ' + err.message);
    isTrainingActive = false;
  }
}

async function sendTrainingTurn(honText) {
  if (!trainingSessionId || !isTrainingActive) {
    log('No active training session');
    return;
  }
  
  log('Sending training turn: ' + honText);
  
  // Add HON message to chat
  addMessage('HON', honText);
  
  try {
    var token = getAuthToken();
    var res = await fetch('/training/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        sessionId: trainingSessionId,
        hon_text: honText
      })
    });
    
    var data = await res.json();
    
    if (data.error) {
      log('Training turn error: ' + data.error);
      addSystemMessage('Error: ' + data.error);
      return;
    }
    
    // Add GST response with TTS and translation
    if (data.gst && data.gst.text) {
      addGstMessageWithTTS(data.gst.text, data.gst.translation);
    }
    
    // Add HINT as system message
    if (data.hint) {
      var hintText = '';
      if (data.hint.suggestion) {
        hintText += data.hint.suggestion;
      }
      if (data.hint.translation) {
        hintText += '\n' + LANGUAGE_FLAGS[currentLanguage] + ' ' + data.hint.translation;
      }
      if (hintText) {
        addHintMessage(hintText, data.hint.goal_state, data.hint.responseType);
      }
    }
    
    // Show suggested goal change if AI detected intent shift
    if (data.suggested_goal) {
      showGoalSuggestion(data.suggested_goal.goal, data.suggested_goal.reason);
    }
  } catch (err) {
    log('Error in training turn: ' + err.message);
    addSystemMessage('Error: ' + err.message);
  }
}

async function stopTrainingSession() {
  log('Stopping training session');
  
  // Reset session on server
  if (trainingSessionId) {
    try {
      var token = getAuthToken();
      await fetch('/training/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ sessionId: trainingSessionId })
      });
    } catch (err) {
      log('Error resetting training session: ' + err.message);
    }
  }
  
  isTrainingActive = false;
  trainingSessionId = null;
  
  // Update UI
  UI.callBtn.classList.remove('on-call');
  UI.statusText.textContent = 'Training Ready';
  UI.statusDot.classList.remove('on-call');
  
  // Reset input field to Goal mode
  UI.textInput.placeholder = 'Write your goal...';
  
  // Reset goal
  callGoal = '';
  setGoalActive(false);
  
  // Hide microphone button
  log('[Training] Calling updateMicButtonVisibility after session stop');
  updateMicButtonVisibility();
  
  addSystemMessage('Training ended. Set a new goal to start again.');
}

// Show suggested goal change banner with Apply/Ignore buttons
function showGoalSuggestion(newGoal, reason) {
  log('[Training] Showing goal suggestion: ' + newGoal);
  
  // Remove any existing suggestion banner
  var existing = document.querySelector('.goal-suggestion-banner');
  if (existing) existing.remove();
  
  var banner = document.createElement('div');
  banner.className = 'goal-suggestion-banner';
  banner.style.cssText = 'background: linear-gradient(135deg, #fef3c7, #fde68a); border: 1px solid #f59e0b; border-radius: 12px; padding: 12px 16px; margin: 8px 0; animation: slideIn 0.3s ease;';
  
  banner.innerHTML = 
    '<div style="font-size: 0.85rem; color: #92400e; margin-bottom: 8px;">' +
    '<strong>💡 Suggested goal change:</strong> ' + reason +
    '</div>' +
    '<div style="font-size: 0.95rem; font-weight: 500; color: #78350f; margin-bottom: 12px;">' +
    '"' + newGoal + '"' +
    '</div>' +
    '<div style="display: flex; gap: 8px;">' +
    '<button class="apply-goal-btn" style="background: #059669; color: white; border: none; border-radius: 8px; padding: 8px 16px; font-size: 0.9rem; cursor: pointer;">✓ Apply</button>' +
    '<button class="ignore-goal-btn" style="background: #9ca3af; color: white; border: none; border-radius: 8px; padding: 8px 16px; font-size: 0.9rem; cursor: pointer;">✕ Ignore</button>' +
    '</div>';
  
  // Add to chat
  UI.chatContainer.appendChild(banner);
  UI.chatContainer.scrollTop = UI.chatContainer.scrollHeight;
  
  // Button handlers
  banner.querySelector('.apply-goal-btn').addEventListener('click', function() {
    applyNewGoal(newGoal);
    banner.remove();
  });
  
  banner.querySelector('.ignore-goal-btn').addEventListener('click', function() {
    log('[Training] Goal suggestion ignored');
    addSystemMessage('Goal kept as: "' + callGoal + '"');
    banner.remove();
  });
}

// Apply new goal to the session
async function applyNewGoal(newGoal) {
  log('[Training] Applying new goal: ' + newGoal);
  
  callGoal = newGoal;
  addGoalFeedEvent('🎯 Цель обновлена: ' + newGoal);
  
  // Update goal on server
  if (trainingSessionId) {
    try {
      var token = getAuthToken();
      await fetch('/training/turn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          sessionId: trainingSessionId,
          hon_text: '',
          goal_override: newGoal
        })
      });
    } catch (err) {
      log('[Training] Error updating goal: ' + err.message);
    }
  }
  
  addSystemMessage('Goal updated to: "' + newGoal + '"');
}

// Add GST message with Listen button, translation, and optional autoplay
function addGstMessageWithTTS(text, translation) {
  var msgEl = document.createElement('div');
  msgEl.className = 'message gst';
  
  var translationHtml = '';
  if (translation) {
    var flag = LANGUAGE_FLAGS[currentLanguage] || '🇷🇺';
    translationHtml = '<div class="message-translation" style="font-size: 0.9rem; color: #6b7280; margin-top: 4px;">' + flag + ' ' + translation + '</div>';
  }
  
  msgEl.innerHTML = 
    '<div class="message-label">👤 Guest</div>' +
    '<div class="message-bubble">' + text + '</div>' +
    translationHtml +
    '<div style="margin-top: 8px; display: flex; gap: 6px;">' +
    '<button class="gst-listen-btn" style="background: #6366f1; color: white; border: none; border-radius: 6px; padding: 4px 12px; font-size: 0.8rem; cursor: pointer;">🔊 Listen</button>' +
    '<button class="gst-save-btn" style="background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; border-radius: 6px; padding: 4px 12px; font-size: 0.8rem; cursor: pointer;">⭐ Save</button>' +
    '</div>';
  
  var listenBtn = msgEl.querySelector('.gst-listen-btn');
  
  // Listen button for GST (English only)
  listenBtn.addEventListener('click', function() {
    playTTS(text, 'gst', this);
  });
  
  // Save button placeholder
  msgEl.querySelector('.gst-save-btn').addEventListener('click', function() {
    addSystemMessage('⭐ Card saved! (Coming soon: flashcard deck)');
  });
  
  UI.emptyState.style.display = 'none';
  UI.chatContainer.appendChild(msgEl);
  UI.chatContainer.scrollTop = UI.chatContainer.scrollHeight;
  
  // Autoplay if enabled
  if (ttsAutoplayGST && callMode === 'training' && isTrainingActive) {
    log('[TTS] Autoplay GST message');
    playTTS(text, 'gst', listenBtn);
  }
}

function addHintMessage(text, goalState, responseType) {
  var msgEl = document.createElement('div');
  msgEl.className = 'message hint';
  
  // Extract English part only (before newline with flag)
  var englishText = text.split('\n')[0].trim();
  
  // Check if goal is achieved
  var isAchieved = goalState && goalState.achieved;
  var achievedBadge = isAchieved ? '<span style="background: #10b981; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.7rem; margin-left: 8px;">✓ Goal Achieved</span>' : '';
  
  // TASK 6: Response type badge (HOLD/STEER/CLOSE)
  var typeBadgeColors = {
    'HOLD': { bg: '#fbbf24', text: '#78350f' },  // Yellow
    'STEER': { bg: '#3b82f6', text: 'white' },   // Blue
    'CLOSE': { bg: '#10b981', text: 'white' }    // Green
  };
  var typeColor = typeBadgeColors[responseType] || typeBadgeColors['STEER'];
  var typeBadge = responseType ? '<span style="background: ' + typeColor.bg + '; color: ' + typeColor.text + '; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; margin-left: 6px; font-weight: 600;">' + responseType + '</span>' : '';
  
  msgEl.innerHTML = '<div class="message-content"><strong>HINT:</strong>' + typeBadge + achievedBadge + ' ' + text.replace(/\n/g, '<br>') + 
    '<div style="margin-top: 8px;">' +
    '<button class="listen-btn" style="background: #6366f1; color: white; border: none; border-radius: 6px; padding: 4px 12px; font-size: 0.8rem; cursor: pointer; margin-right: 6px;">🔊 Listen</button>' +
    '<button class="save-btn" style="background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; border-radius: 6px; padding: 4px 12px; font-size: 0.8rem; cursor: pointer;">⭐ Save</button>' +
    (isAchieved ? '<button class="new-goal-btn" style="background: #10b981; color: white; border: none; border-radius: 6px; padding: 4px 12px; font-size: 0.8rem; cursor: pointer; margin-left: 6px;">🎯 New Goal</button>' : '') +
    '</div></div>';
  
  if (goalState && goalState.next_step && !isAchieved) {
    var goalEl = document.createElement('div');
    goalEl.className = 'goal-hint';
    goalEl.style.cssText = 'font-size: 0.8rem; color: #6b7280; margin-top: 4px;';
    goalEl.textContent = 'Next: ' + goalState.next_step;
    msgEl.querySelector('.message-content').appendChild(goalEl);
  }
  
  // Listen button for HINT (English only)
  msgEl.querySelector('.listen-btn').addEventListener('click', function() {
    playTTS(englishText, 'hint', this);
  });
  
  // Save button placeholder
  msgEl.querySelector('.save-btn').addEventListener('click', function() {
    addSystemMessage('⭐ Card saved! (Coming soon: flashcard deck)');
  });
  
  // New Goal button - reset session and start fresh
  var newGoalBtn = msgEl.querySelector('.new-goal-btn');
  if (newGoalBtn) {
    newGoalBtn.addEventListener('click', function() {
      stopTrainingSession();
      addSystemMessage('🎯 Ready for a new goal! Type your goal and tap Start.');
    });
  }
  
  UI.emptyState.style.display = 'none';
  UI.chatContainer.appendChild(msgEl);
  UI.chatContainer.scrollTop = UI.chatContainer.scrollHeight;
}

function addSystemMessage(text) {
  var msgEl = document.createElement('div');
  msgEl.className = 'message system';
  msgEl.innerHTML = '<div class="message-content" style="color: #6b7280; font-style: italic;">' + text + '</div>';
  
  UI.emptyState.style.display = 'none';
  UI.chatContainer.appendChild(msgEl);
  UI.chatContainer.scrollTop = UI.chatContainer.scrollHeight;
}

// TTS playback function - calls /training/tts and plays audio
async function playTTS(text, voiceType, buttonEl) {
  if (!text || text.trim() === '') return;
  
  log('[TTS] Playing: "' + text.substring(0, 30) + '..."');
  
  // Stop any currently playing audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  
  // Update button state
  var originalText = buttonEl ? buttonEl.textContent : '';
  if (buttonEl) {
    buttonEl.textContent = '⏳ Loading...';
    buttonEl.disabled = true;
  }
  
  try {
    var token = getAuthToken();
    var res = await fetch('/training/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        text: text,
        voiceType: voiceType || 'gst'
      })
    });
    
    if (!res.ok) {
      var errorData = await res.json();
      throw new Error(errorData.error || 'TTS failed');
    }
    
    var data = await res.json();
    
    // Create audio from base64
    var audioBlob = base64ToBlob(data.audio, data.mimeType || 'audio/mpeg');
    var audioUrl = URL.createObjectURL(audioBlob);
    
    currentAudio = new Audio(audioUrl);
    
    // Update button during playback
    if (buttonEl) {
      buttonEl.textContent = '🔊 Playing...';
    }
    
    currentAudio.onended = function() {
      if (buttonEl) {
        buttonEl.textContent = originalText;
        buttonEl.disabled = false;
      }
      currentAudio = null;
    };
    
    currentAudio.onerror = function() {
      if (buttonEl) {
        buttonEl.textContent = originalText;
        buttonEl.disabled = false;
      }
      log('[TTS] Audio playback error');
    };
    
    await currentAudio.play();
    
  } catch (err) {
    log('[TTS] Error: ' + err.message);
    if (buttonEl) {
      buttonEl.textContent = originalText;
      buttonEl.disabled = false;
    }
  }
}

// Helper: convert base64 to Blob
function base64ToBlob(base64, mimeType) {
  var byteString = atob(base64);
  var ab = new ArrayBuffer(byteString.length);
  var ia = new Uint8Array(ab);
  for (var i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeType });
}

let currentPlan = 'free';
let stripeProducts = [];

async function loadSubscription() {
  try {
    const token = getAuthToken();
    const headers = {};
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }
    const res = await fetch('/api/subscription', {
      credentials: 'include',
      headers: headers
    });
    if (res.ok) {
      const data = await res.json();
      currentPlan = data.plan || 'free';
      updatePlanBadge(currentPlan, !!data.stripeCustomerId);
      log('Loaded subscription: ' + currentPlan);
      
      // Enforce call mode based on subscription
      enforceCallModeBySubscription();
    }
  } catch (err) {
    log('Error loading subscription: ' + err.message);
  }
}

function hasActiveSubscription() {
  return currentPlan && currentPlan !== 'free' && currentPlan !== 'none';
}

function updatePlanBadge(plan, hasStripeCustomer) {
  if (!UI.planBadge) return;
  
  // SIMPLIFIED: No trial - only Basic $15/mo or no subscription
  var hasSub = hasActiveSubscription();
  
  if (hasSub) {
    UI.planBadge.style.display = 'block';
    UI.planBadge.className = 'plan-badge basic';
    UI.planBadge.textContent = 'Basic $15/mo';
    UI.upgradeBtn.style.display = 'none';
    UI.manageBtn.style.display = hasStripeCustomer ? 'block' : 'none';
  } else {
    // No subscription - hide badge, show upgrade button
    UI.planBadge.style.display = 'none';
    UI.upgradeBtn.style.display = 'block';
    UI.manageBtn.style.display = 'none';
  }
  
  // Update section visibility based on subscription
  updateSectionVisibility(hasSub);
}

function updateSectionVisibility(hasSub) {
  var numbersSection = document.getElementById('numbersSection');
  var forwardingSection = document.getElementById('forwardingSection');
  
  if (numbersSection) {
    numbersSection.style.display = hasSub ? 'block' : 'none';
  }
  if (forwardingSection) {
    forwardingSection.style.display = hasSub ? 'block' : 'none';
  }
}

async function loadStripeProducts() {
  try {
    const res = await fetch('/api/products');
    if (res.ok) {
      const data = await res.json();
      stripeProducts = data.products || [];
      log('Loaded ' + stripeProducts.length + ' Stripe products');
    } else {
      log('Failed to load products: ' + res.status);
    }
  } catch (err) {
    log('Error loading products: ' + err.message);
  }
}

async function openCheckout(priceId) {
  try {
    const token = getAuthToken();
    if (!token) {
      alert('Please log in first');
      return;
    }
    
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({ priceId: priceId })
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to start checkout');
    }
  } catch (err) {
    log('Checkout error: ' + err.message);
    alert('Failed to start checkout');
  }
}

async function openBillingPortal() {
  try {
    const token = getAuthToken();
    if (!token) {
      alert('Please log in first');
      return;
    }
    
    const res = await fetch('/api/billing-portal', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } else {
      const data = await res.json();
      alert(data.error || 'Failed to open billing portal');
    }
  } catch (err) {
    log('Billing portal error: ' + err.message);
    alert('Failed to open billing portal');
  }
}

// SIMPLIFIED: Show upgrade modal with just Basic $15 plan
var upgradeModalLoading = false;

async function showUpgradeModal() {
  // Prevent multiple loads
  if (upgradeModalLoading) return;
  
  // If no products loaded, try loading with timeout
  if (stripeProducts.length === 0) {
    upgradeModalLoading = true;
    
    // Show loading modal
    var loadingModal = document.createElement('div');
    loadingModal.className = 'modal-overlay active';
    loadingModal.id = 'upgradeModal';
    loadingModal.innerHTML = '<div class="modal"><div class="modal-header"><span class="modal-title">Loading...</span><button class="modal-close" onclick="closeUpgradeModal()">&times;</button></div><div class="modal-body" style="text-align: center; padding: 40px;">Loading plans...</div></div>';
    document.body.appendChild(loadingModal);
    
    try {
      // Load with timeout (5 seconds)
      var timeout = new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error('timeout')); }, 5000);
      });
      await Promise.race([loadStripeProducts(), timeout]);
    } catch (err) {
      log('Failed to load Stripe products: ' + err.message);
    }
    
    upgradeModalLoading = false;
    closeUpgradeModal();
    
    // Show result
    if (stripeProducts.length === 0) {
      // Show error modal
      var errorModal = document.createElement('div');
      errorModal.className = 'modal-overlay active';
      errorModal.id = 'upgradeModal';
      errorModal.innerHTML = '<div class="modal"><div class="modal-header"><span class="modal-title">Subscription</span><button class="modal-close" onclick="closeUpgradeModal()">&times;</button></div><div class="modal-body" style="text-align: center; padding: 20px;"><p style="color: #ef4444; margin-bottom: 16px;">Unable to load subscription plans.</p><p style="color: #666;">Please try again later or contact support.</p><button class="btn btn-secondary" onclick="closeUpgradeModal()" style="margin-top: 16px;">Close</button></div></div>';
      document.body.appendChild(errorModal);
      return;
    }
  }
  
  var modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.id = 'upgradeModal';
  
  // SIMPLIFIED: Show only one Basic plan (first available product)
  var content = '<div class="modal"><div class="modal-header"><span class="modal-title">Upgrade to Basic</span><button class="modal-close" onclick="closeUpgradeModal()">&times;</button></div><div class="modal-body">';
  
  // Find first product with valid price (Basic plan)
  var basicProduct = null;
  var basicPrice = null;
  for (var i = 0; i < stripeProducts.length; i++) {
    var product = stripeProducts[i];
    var price = product.prices && product.prices[0];
    if (price) {
      basicProduct = product;
      basicPrice = price;
      break;
    }
  }
  
  if (basicProduct && basicPrice) {
    var amount = (basicPrice.unit_amount / 100).toFixed(0);
    
    content += '<div class="plan-card" style="border: 2px solid #6366f1; border-radius: 12px; padding: 20px; text-align: center;">';
    content += '<h3 style="margin: 0 0 8px 0; color: #6366f1;">Basic Plan</h3>';
    content += '<div style="font-size: 2rem; font-weight: 700; margin: 16px 0;">$' + amount + '<span style="font-size: 1rem; color: #666; font-weight: 400;">/month</span></div>';
    content += '<ul style="text-align: left; margin: 16px 0; padding-left: 20px; color: #374151;">';
    content += '<li style="margin-bottom: 8px;">📱 1 Personal phone number</li>';
    content += '<li style="margin-bottom: 8px;">📞 Live calls with AI assistance</li>';
    content += '<li style="margin-bottom: 8px;">🎓 Training calls</li>';
    content += '<li style="margin-bottom: 8px;">📚 Learning & flashcards</li>';
    content += '<li style="margin-bottom: 8px;">🔔 Notifications</li>';
    content += '</ul>';
    content += '<button class="btn btn-primary" onclick="openCheckout(\'' + basicPrice.id + '\')" style="width: 100%; padding: 12px; font-size: 1rem;">Subscribe Now</button>';
    content += '</div>';
  } else {
    content += '<p style="color: #ef4444; text-align: center;">No plans available. Please try again later.</p>';
  }
  
  content += '</div></div>';
  modal.innerHTML = content;
  document.body.appendChild(modal);
  
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeUpgradeModal();
  });
}

function closeUpgradeModal() {
  var modal = document.getElementById('upgradeModal');
  if (modal) modal.remove();
}

if (UI.upgradeBtn) {
  UI.upgradeBtn.addEventListener('click', showUpgradeModal);
}

if (UI.manageBtn) {
  UI.manageBtn.addEventListener('click', openBillingPortal);
}

log('TalkHint Chat UI');
connectWebSocket();
initTwilioDevice();
loadUserNumbers();
loadUserPrompts();
loadSubscription();

// Reveal the sidebar admin-panel shortcut only for benchmark admins.
(async function initAdminLink() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return;
    const me = await res.json();
    if (me && ((me.user && me.user.isAdmin) || me.isAdmin)) {
      const link = document.getElementById('adminPanelLink');
      if (link) link.style.display = '';
    }
  } catch (e) { /* not logged in / offline — keep hidden */ }
})();
loadStripeProducts();
checkPendingCalls();  // Check for pending calls from push notifications
loadForwardingPhone();  // Load forwarding phone setting

// Forwarding Phone Settings
async function loadForwardingPhone() {
  try {
    var response = await fetch('/api/settings/forwarding', { credentials: 'include' });
    if (response.ok) {
      var data = await response.json();
      var input = document.getElementById('forwardingPhoneInput');
      if (input && data.forwardingPhone) {
        input.value = data.forwardingPhone;
      }
    }
  } catch (error) {
    log('Forwarding load error: ' + error.message);
  }
}

async function saveForwardingPhone() {
  var input = document.getElementById('forwardingPhoneInput');
  var statusEl = document.getElementById('forwardingStatus');
  if (!input) return;
  
  try {
    var response = await fetch('/api/settings/forwarding', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forwardingPhone: input.value })
    });
    
    if (response.ok) {
      if (statusEl) {
        statusEl.textContent = 'Saved!';
        statusEl.style.color = '#10b981';
        setTimeout(function() { statusEl.textContent = ''; }, 2000);
      }
    } else {
      var err = await response.json();
      if (statusEl) {
        statusEl.textContent = err.error || 'Error';
        statusEl.style.color = '#ef4444';
      }
    }
  } catch (error) {
    log('Forwarding save error: ' + error.message);
    if (statusEl) {
      statusEl.textContent = 'Error saving';
      statusEl.style.color = '#ef4444';
    }
  }
}

var saveForwardingBtn = document.getElementById('saveForwardingBtn');
if (saveForwardingBtn) {
  saveForwardingBtn.addEventListener('click', saveForwardingPhone);
}

// ===== My Context (Personal Context) =====
var CONTEXT_TEMPLATES = {
  cdl: "I'm a CDL truck driver looking for dispatch/driving jobs. I have OTR experience and a clean driving record. On calls, help me ask about pay per mile, routes, home time, and equipment. Keep replies short and professional. Never claim endorsements or certifications I haven't confirmed.",
  massage: "I run a massage salon. Services: Classic massage ($80/hr), Deep tissue ($100/hr), Sports massage ($120/90min). I want to book clients, confirm date/time, and upsell add-ons like hot stones. Keep replies warm, friendly, and concise.",
  universal: "I'm a small business owner handling calls with clients and partners. My goal is to be clear, polite, and move every call toward a concrete next step (a booking, a price agreement, or a follow-up). Keep suggestions short and natural."
};

function authHeaders() {
  var token = getAuthToken();
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  return headers;
}

async function loadUserContext() {
  try {
    var response = await fetch('/api/user/context', {
      credentials: 'include',
      headers: authHeaders()
    });
    if (response.ok) {
      var data = await response.json();
      var textarea = document.getElementById('contextText');
      if (textarea) textarea.value = data.context || '';
      updateContextStatus(data.context || '');
    }
  } catch (error) {
    log('Context load error: ' + error.message);
  }
}

function updateContextStatus(context) {
  var statusEl = document.getElementById('contextStatus');
  if (!statusEl) return;
  if (context && context.trim()) {
    statusEl.textContent = '✓ Context set (' + context.trim().length + ' chars)';
    statusEl.style.color = '#10b981';
  } else {
    statusEl.textContent = 'Not set';
    statusEl.style.color = '#6b7280';
  }
}

async function saveUserContext() {
  var textarea = document.getElementById('contextText');
  if (!textarea) return;
  var saveBtn = document.getElementById('contextModalSave');
  if (saveBtn) saveBtn.disabled = true;
  try {
    var response = await fetch('/api/user/context', {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
      body: JSON.stringify({ context: textarea.value })
    });
    if (response.ok) {
      var data = await response.json();
      if (data.context !== undefined) textarea.value = data.context;
      updateContextStatus(data.context || textarea.value);
      closeContextModal();
    } else {
      var err = await response.json().catch(function() { return {}; });
      alert('Failed to save context: ' + (err.error || response.status));
    }
  } catch (error) {
    log('Context save error: ' + error.message);
    alert('Failed to save context: ' + error.message);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function openContextModal() {
  var modal = document.getElementById('contextModal');
  if (modal) modal.classList.add('active');
}

function closeContextModal() {
  var modal = document.getElementById('contextModal');
  if (modal) modal.classList.remove('active');
}

(function initContextUI() {
  var editBtn = document.getElementById('editContextBtn');
  if (editBtn) editBtn.addEventListener('click', openContextModal);

  var closeBtn = document.getElementById('contextModalClose');
  if (closeBtn) closeBtn.addEventListener('click', closeContextModal);

  var cancelBtn = document.getElementById('contextModalCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeContextModal);

  var saveBtn = document.getElementById('contextModalSave');
  if (saveBtn) saveBtn.addEventListener('click', saveUserContext);

  var modal = document.getElementById('contextModal');
  if (modal) modal.addEventListener('click', function(e) {
    if (e.target === modal) closeContextModal();
  });

  document.querySelectorAll('[data-context-template]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var key = btn.getAttribute('data-context-template');
      var textarea = document.getElementById('contextText');
      if (textarea && CONTEXT_TEMPLATES[key]) textarea.value = CONTEXT_TEMPLATES[key];
    });
  });
})();

loadUserContext();

// ===== Contacts (Contact Memory) =====
var contactsCache = [];
var editingContactId = null;

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadContacts() {
  var listEl = document.getElementById('contactsList');
  if (listEl) listEl.innerHTML = '<div style="color:#6b7280; padding:8px;">Loading…</div>';
  try {
    var response = await fetch('/api/contacts', {
      credentials: 'include',
      headers: authHeaders()
    });
    if (response.ok) {
      var data = await response.json();
      contactsCache = data.contacts || [];
      renderContacts();
      updateContactsStatus();
    } else if (listEl) {
      listEl.innerHTML = '<div style="color:#ef4444; padding:8px;">Failed to load contacts (' + response.status + ')</div>';
    }
  } catch (error) {
    log('Contacts load error: ' + error.message);
    if (listEl) listEl.innerHTML = '<div style="color:#ef4444; padding:8px;">Failed to load contacts</div>';
  }
}

function updateContactsStatus() {
  var statusEl = document.getElementById('contactsStatus');
  if (!statusEl) return;
  var n = contactsCache.length;
  statusEl.textContent = n ? (n + (n === 1 ? ' contact' : ' contacts')) : 'No contacts yet';
}

function renderContacts() {
  var listEl = document.getElementById('contactsList');
  if (!listEl) return;
  if (!contactsCache.length) {
    listEl.innerHTML = '<div style="color:#6b7280; padding:8px;">No saved contacts yet. After a call, the assistant remembers the caller here.</div>';
    return;
  }
  listEl.innerHTML = contactsCache.map(function(c) {
    var lastCall = c.lastCallAt ? new Date(c.lastCallAt).toISOString().slice(0, 10) : '';
    var meta = [];
    if (c.importance && c.importance.trim()) meta.push('★ ' + escapeHtml(c.importance.trim()));
    if (lastCall) meta.push('Last call: ' + lastCall);
    var hasName = c.name && c.name.trim();
    return '' +
      '<div class="contact-row" data-testid="row-contact-' + escapeHtml(c.id) + '" style="border:1px solid #e5e7eb; border-radius:8px; padding:10px; margin-bottom:8px;">' +
        (hasName ? '<div style="font-weight:600; margin-bottom:2px;" data-testid="text-contact-name-' + escapeHtml(c.id) + '">' + escapeHtml(c.name.trim()) + '</div>' : '') +
        '<div style="' + (hasName ? 'font-size:0.85rem; color:#6b7280;' : 'font-weight:600;') + ' margin-bottom:2px;" data-testid="text-contact-phone-' + escapeHtml(c.id) + '">' + escapeHtml(c.phoneNumber) + '</div>' +
        (meta.length ? '<div style="font-size:0.75rem; color:#6b7280; margin-bottom:6px;">' + meta.join(' · ') + '</div>' : '') +
        (c.summary && c.summary.trim() ? '<div style="font-size:0.85rem; margin-bottom:4px;">' + escapeHtml(c.summary.trim()) + '</div>' : '') +
        (c.notes && c.notes.trim() ? '<div style="font-size:0.8rem; color:#374151; margin-bottom:6px;"><em>Notes:</em> ' + escapeHtml(c.notes.trim()) + '</div>' : '') +
        '<div style="display:flex; gap:8px; margin-top:6px;">' +
          '<button class="btn btn-secondary btn-small" data-contact-edit="' + escapeHtml(c.id) + '" data-testid="button-edit-contact-' + escapeHtml(c.id) + '">Edit</button>' +
          '<button class="btn btn-secondary btn-small" data-contact-delete="' + escapeHtml(c.id) + '" data-testid="button-delete-contact-' + escapeHtml(c.id) + '">Delete</button>' +
        '</div>' +
      '</div>';
  }).join('');

  listEl.querySelectorAll('[data-contact-edit]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      openContactEditModal(btn.getAttribute('data-contact-edit'));
    });
  });
  listEl.querySelectorAll('[data-contact-delete]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      deleteContact(btn.getAttribute('data-contact-delete'));
    });
  });
}

function openContactsModal() {
  var modal = document.getElementById('contactsModal');
  if (modal) modal.classList.add('active');
  loadContacts();
}

function closeContactsModal() {
  var modal = document.getElementById('contactsModal');
  if (modal) modal.classList.remove('active');
}

function openContactEditModal(id) {
  var contact = contactsCache.filter(function(c) { return c.id === id; })[0];
  if (!contact) return;
  editingContactId = id;
  var title = document.getElementById('contactEditTitle');
  if (title) title.textContent = 'Edit ' + (contact.name && contact.name.trim() ? contact.name.trim() : contact.phoneNumber);
  var nameField = document.getElementById('contactName');
  var imp = document.getElementById('contactImportance');
  var sum = document.getElementById('contactSummary');
  var notes = document.getElementById('contactNotes');
  if (nameField) nameField.value = contact.name || '';
  if (imp) imp.value = contact.importance || '';
  if (sum) sum.value = contact.summary || '';
  if (notes) notes.value = contact.notes || '';
  var modal = document.getElementById('contactEditModal');
  if (modal) modal.classList.add('active');
}

function closeContactEditModal() {
  editingContactId = null;
  var modal = document.getElementById('contactEditModal');
  if (modal) modal.classList.remove('active');
}

async function saveContact() {
  if (!editingContactId) return;
  var saveBtn = document.getElementById('contactEditSave');
  if (saveBtn) saveBtn.disabled = true;
  var nameField = document.getElementById('contactName');
  var imp = document.getElementById('contactImportance');
  var sum = document.getElementById('contactSummary');
  var notes = document.getElementById('contactNotes');
  try {
    var response = await fetch('/api/contacts/' + encodeURIComponent(editingContactId), {
      method: 'PUT',
      credentials: 'include',
      headers: authHeaders(),
      body: JSON.stringify({
        name: nameField ? nameField.value : '',
        importance: imp ? imp.value : '',
        summary: sum ? sum.value : '',
        notes: notes ? notes.value : ''
      })
    });
    if (response.ok) {
      var data = await response.json();
      if (data.contact) {
        contactsCache = contactsCache.map(function(c) {
          return c.id === data.contact.id ? data.contact : c;
        });
        renderContacts();
      }
      closeContactEditModal();
    } else {
      var err = await response.json().catch(function() { return {}; });
      alert('Failed to save contact: ' + (err.error || response.status));
    }
  } catch (error) {
    log('Contact save error: ' + error.message);
    alert('Failed to save contact: ' + error.message);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function deleteContact(id) {
  var contact = contactsCache.filter(function(c) { return c.id === id; })[0];
  if (!confirm('Delete what the assistant remembers about ' + (contact ? contact.phoneNumber : 'this caller') + '? This cannot be undone.')) return;
  try {
    var response = await fetch('/api/contacts/' + encodeURIComponent(id), {
      method: 'DELETE',
      credentials: 'include',
      headers: authHeaders()
    });
    if (response.ok) {
      contactsCache = contactsCache.filter(function(c) { return c.id !== id; });
      renderContacts();
      updateContactsStatus();
    } else {
      var err = await response.json().catch(function() { return {}; });
      alert('Failed to delete contact: ' + (err.error || response.status));
    }
  } catch (error) {
    log('Contact delete error: ' + error.message);
    alert('Failed to delete contact: ' + error.message);
  }
}

// ===== Static Context (Knowledge Cards) =====
var cardsCache = [];
var editingCardId = null;

var CARD_TYPE_LABELS = { project: 'Projects', company: 'Company / Services' };

async function loadCards() {
  var listEl = document.getElementById('cardsList');
  if (listEl) listEl.innerHTML = '<div style="color:#6b7280; padding:8px;">Loading...</div>';
  try {
    var response = await fetch('/api/cards', {
      credentials: 'include',
      headers: authHeaders()
    });
    if (response.ok) {
      var data = await response.json();
      cardsCache = data.cards || [];
      renderCards();
      updateCardsStatus();
    } else {
      if (listEl) listEl.innerHTML = '<div style="color:#ef4444; padding:8px;">Failed to load cards (' + response.status + ')</div>';
    }
  } catch (error) {
    log('Cards load error: ' + error.message);
    if (listEl) listEl.innerHTML = '<div style="color:#ef4444; padding:8px;">Failed to load cards</div>';
  }
}

function updateCardsStatus() {
  var statusEl = document.getElementById('cardsStatus');
  if (!statusEl) return;
  var n = cardsCache.length;
  statusEl.textContent = n ? (n + (n === 1 ? ' card' : ' cards')) : 'No cards yet';
}

function renderCardRow(c) {
  return '<div class="card-row" data-testid="row-card-' + escapeHtml(c.id) + '" style="border:1px solid #e5e7eb; border-radius:8px; padding:10px; margin-bottom:8px;">' +
    '<div style="font-weight:600; margin-bottom:2px;" data-testid="text-card-title-' + escapeHtml(c.id) + '">' + escapeHtml(c.title || '') + '</div>' +
    '<div style="font-size:0.85rem; color:#6b7280; margin-bottom:6px; white-space:pre-wrap;" data-testid="text-card-body-' + escapeHtml(c.id) + '">' + escapeHtml(c.body || '') + '</div>' +
    '<div style="display:flex; gap:6px;">' +
      '<button class="btn btn-secondary btn-small" data-card-edit="' + escapeHtml(c.id) + '" data-testid="button-edit-card-' + escapeHtml(c.id) + '">Edit</button>' +
      '<button class="btn btn-secondary btn-small" data-card-delete="' + escapeHtml(c.id) + '" data-testid="button-delete-card-' + escapeHtml(c.id) + '">Delete</button>' +
    '</div>' +
  '</div>';
}

function renderCards() {
  var listEl = document.getElementById('cardsList');
  if (!listEl) return;
  if (!cardsCache.length) {
    listEl.innerHTML = '<div style="color:#6b7280; padding:8px;">No cards yet. Add a project or a company/service fact so the assistant can answer questions about your work on every call.</div>';
    return;
  }
  var html = '';
  ['project', 'company'].forEach(function(type) {
    var group = cardsCache.filter(function(c) { return c.cardType === type; });
    if (!group.length) return;
    html += '<div style="font-size:0.8rem; font-weight:700; color:#374151; margin:6px 0;">' + escapeHtml(CARD_TYPE_LABELS[type]) + '</div>';
    html += group.map(renderCardRow).join('');
  });
  listEl.innerHTML = html;
  listEl.querySelectorAll('[data-card-edit]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      openCardEditModal(btn.getAttribute('data-card-edit'));
    });
  });
  listEl.querySelectorAll('[data-card-delete]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      deleteCard(btn.getAttribute('data-card-delete'));
    });
  });
}

function openCardsModal() {
  var modal = document.getElementById('cardsModal');
  if (modal) modal.classList.add('active');
  loadCards();
}

function closeCardsModal() {
  var modal = document.getElementById('cardsModal');
  if (modal) modal.classList.remove('active');
}

function openCardEditModal(id) {
  var card = cardsCache.filter(function(c) { return c.id === id; })[0];
  editingCardId = id || null;
  var titleEl = document.getElementById('cardEditTitle');
  var typeEl = document.getElementById('cardType');
  var titleField = document.getElementById('cardTitle');
  var bodyField = document.getElementById('cardBody');
  var sortField = document.getElementById('cardSortOrder');
  if (card) {
    if (titleEl) titleEl.textContent = 'Edit card';
    if (typeEl) typeEl.value = card.cardType || 'project';
    if (titleField) titleField.value = card.title || '';
    if (bodyField) bodyField.value = card.body || '';
    if (sortField) sortField.value = (card.sortOrder != null ? card.sortOrder : 0);
  } else {
    if (titleEl) titleEl.textContent = 'New card';
    if (titleField) titleField.value = '';
    if (bodyField) bodyField.value = '';
    if (sortField) sortField.value = 0;
  }
  var modal = document.getElementById('cardEditModal');
  if (modal) modal.classList.add('active');
}

function openNewCardModal(type) {
  openCardEditModal(null);
  var typeEl = document.getElementById('cardType');
  if (typeEl) typeEl.value = type || 'project';
}

function closeCardEditModal() {
  editingCardId = null;
  var modal = document.getElementById('cardEditModal');
  if (modal) modal.classList.remove('active');
}

async function saveCard() {
  var saveBtn = document.getElementById('cardEditSave');
  if (saveBtn) saveBtn.disabled = true;
  var typeEl = document.getElementById('cardType');
  var titleField = document.getElementById('cardTitle');
  var bodyField = document.getElementById('cardBody');
  var sortField = document.getElementById('cardSortOrder');
  var payload = {
    cardType: typeEl ? typeEl.value : 'project',
    title: titleField ? titleField.value.trim() : '',
    body: bodyField ? bodyField.value.trim() : '',
    sortOrder: sortField && sortField.value !== '' ? Number(sortField.value) : 0
  };
  if (!payload.title) { alert('Title is required'); if (saveBtn) saveBtn.disabled = false; return; }
  if (!payload.body) { alert('Details are required'); if (saveBtn) saveBtn.disabled = false; return; }
  try {
    var url = editingCardId ? '/api/cards/' + encodeURIComponent(editingCardId) : '/api/cards';
    var method = editingCardId ? 'PUT' : 'POST';
    var response = await fetch(url, {
      method: method,
      credentials: 'include',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      await loadCards();
      closeCardEditModal();
    } else {
      var err = await response.json().catch(function() { return {}; });
      alert('Failed to save card: ' + (err.error || response.status));
    }
  } catch (error) {
    log('Card save error: ' + error.message);
    alert('Failed to save card: ' + error.message);
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function deleteCard(id) {
  var card = cardsCache.filter(function(c) { return c.id === id; })[0];
  if (!confirm('Delete "' + (card ? card.title : 'this card') + '"? This cannot be undone.')) return;
  try {
    var response = await fetch('/api/cards/' + encodeURIComponent(id), {
      method: 'DELETE',
      credentials: 'include',
      headers: authHeaders()
    });
    if (response.ok) {
      cardsCache = cardsCache.filter(function(c) { return c.id !== id; });
      renderCards();
      updateCardsStatus();
    } else {
      var err = await response.json().catch(function() { return {}; });
      alert('Failed to delete card: ' + (err.error || response.status));
    }
  } catch (error) {
    log('Card delete error: ' + error.message);
    alert('Failed to delete card: ' + error.message);
  }
}

(function initCardsUI() {
  var openBtn = document.getElementById('openCardsBtn');
  if (openBtn) openBtn.addEventListener('click', openCardsModal);
  var closeBtn = document.getElementById('cardsModalClose');
  if (closeBtn) closeBtn.addEventListener('click', closeCardsModal);
  var cancelBtn = document.getElementById('cardsModalCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeCardsModal);
  var cardsModal = document.getElementById('cardsModal');
  if (cardsModal) cardsModal.addEventListener('click', function(e) {
    if (e.target === cardsModal) closeCardsModal();
  });

  var addProject = document.getElementById('addProjectCardBtn');
  if (addProject) addProject.addEventListener('click', function() { openNewCardModal('project'); });
  var addCompany = document.getElementById('addCompanyCardBtn');
  if (addCompany) addCompany.addEventListener('click', function() { openNewCardModal('company'); });

  var editClose = document.getElementById('cardEditModalClose');
  if (editClose) editClose.addEventListener('click', closeCardEditModal);
  var editCancel = document.getElementById('cardEditCancel');
  if (editCancel) editCancel.addEventListener('click', closeCardEditModal);
  var editSave = document.getElementById('cardEditSave');
  if (editSave) editSave.addEventListener('click', saveCard);
  var editModal = document.getElementById('cardEditModal');
  if (editModal) editModal.addEventListener('click', function(e) {
    if (e.target === editModal) closeCardEditModal();
  });
})();

// ===== Dialogue Library UI =====
// Ready-made lines served instantly during a call before falling through to GPT.
// Saved per GOAL: each library is one goal (its own id), with goalText + goalType.
var DIALOGUE_GOAL_LABELS = {
  booking: 'Запись/Бронирование',
  pricing: 'Узнать цены',
  support: 'Техподдержка',
  info: 'Информация',
  negotiation: 'Переговоры',
  other: 'Другое'
};
var DIALOGUE_TYPE_LABELS = {
  opening: 'Opening',
  discovery: 'Discovery',
  typical: 'Typical',
  objection: 'Objection',
  clarifying: 'Clarifying',
  closing: 'Closing'
};
var dialogueLibraries = [];              // list of libraries [{id, goalType, goalText, entries[]}]
var currentDialogueLibraryId = null;     // id of the goal being edited (null = new, unsaved goal)
var dialogueEntries = [];                // working copy of entries for the edited goal
var editingDialogueEntryId = null;

function currentDialogueGoalType() {
  var sel = document.getElementById('dialogueGoalType');
  return sel ? sel.value : 'booking';
}

function currentDialogueGoalText() {
  var el = document.getElementById('dialogueGoalText');
  return el ? el.value.trim() : '';
}

async function loadDialogueLibraries() {
  try {
    var response = await fetch('/api/dialogue-libraries', {
      credentials: 'include',
      headers: authHeaders()
    });
    if (response.ok) {
      var data = await response.json();
      dialogueLibraries = (data.libraries || []).slice();
      updateDialogueStatus();
      renderDialogueLibrariesList();
    }
  } catch (error) {
    log('Dialogue libraries load error: ' + error.message);
  }
}

function updateDialogueStatus() {
  var statusEl = document.getElementById('dialogueStatus');
  if (!statusEl) return;
  var n = dialogueLibraries.length;
  statusEl.textContent = n ? (n + (n === 1 ? ' goal library' : ' goal libraries')) : 'No libraries yet';
}

function showDialogueListView() {
  currentDialogueLibraryId = null;
  var listView = document.getElementById('dialogueListView');
  var editView = document.getElementById('dialogueEditView');
  var delBtn = document.getElementById('dialogueDeleteBtn');
  if (listView) listView.style.display = '';
  if (editView) editView.style.display = 'none';
  if (delBtn) delBtn.style.display = 'none';
  renderDialogueLibrariesList();
}

function showDialogueEditView() {
  var listView = document.getElementById('dialogueListView');
  var editView = document.getElementById('dialogueEditView');
  var delBtn = document.getElementById('dialogueDeleteBtn');
  if (listView) listView.style.display = 'none';
  if (editView) editView.style.display = '';
  // Delete only makes sense for a goal that already exists on the server.
  if (delBtn) delBtn.style.display = currentDialogueLibraryId ? '' : 'none';
}

function renderDialogueLibrariesList() {
  var listEl = document.getElementById('dialogueLibrariesList');
  if (!listEl) return;
  if (!dialogueLibraries.length) {
    listEl.innerHTML = '<div style="color:#6b7280; padding:8px;">No goals yet. Click "New goal" to create one and auto-build its library.</div>';
    return;
  }
  listEl.innerHTML = dialogueLibraries.map(function(lib) {
    var count = Array.isArray(lib.entries) ? lib.entries.length : 0;
    var label = DIALOGUE_GOAL_LABELS[lib.goalType] || lib.goalType;
    var desc = lib.goalText ? escapeHtml(lib.goalText) : '<span style="color:#9ca3af;">(no description)</span>';
    return '<div class="card-row" data-testid="row-dialogue-library-' + escapeHtml(lib.id) + '" style="border:1px solid #e5e7eb; border-radius:8px; padding:10px; margin-bottom:8px; cursor:pointer;" data-dialogue-open="' + escapeHtml(lib.id) + '">' +
      '<div style="font-size:0.7rem; font-weight:700; text-transform:uppercase; color:#6366f1; margin-bottom:2px;">' + escapeHtml(label) + ' · ' + count + (count === 1 ? ' line' : ' lines') + '</div>' +
      '<div style="font-weight:600;" data-testid="text-dialogue-library-goal-' + escapeHtml(lib.id) + '">' + desc + '</div>' +
    '</div>';
  }).join('');
  listEl.querySelectorAll('[data-dialogue-open]').forEach(function(row) {
    row.addEventListener('click', function() {
      openDialogueEditor(row.getAttribute('data-dialogue-open'));
    });
  });
}

// Open the editor for an existing goal (by id) or a fresh new goal (id null).
function openDialogueEditor(id) {
  var lib = id ? dialogueLibraries.filter(function(l) { return l.id === id; })[0] : null;
  currentDialogueLibraryId = lib ? lib.id : null;
  dialogueEntries = lib && Array.isArray(lib.entries) ? lib.entries.slice() : [];
  var goalTypeEl = document.getElementById('dialogueGoalType');
  var goalTextEl = document.getElementById('dialogueGoalText');
  if (goalTypeEl) goalTypeEl.value = lib ? (lib.goalType || 'booking') : 'booking';
  if (goalTextEl) goalTextEl.value = lib ? (lib.goalText || '') : '';
  showDialogueEditView();
  renderDialogueEntries();
}

function renderDialogueEntryRow(e) {
  var variants = Array.isArray(e.variants) && e.variants.length
    ? '<div style="font-size:0.75rem; color:#9ca3af; margin-top:2px;">+ ' + e.variants.length + ' variant' + (e.variants.length === 1 ? '' : 's') + '</div>'
    : '';
  return '<div class="card-row" data-testid="row-dialogue-' + escapeHtml(e.id) + '" style="border:1px solid #e5e7eb; border-radius:8px; padding:10px; margin-bottom:8px;">' +
    '<div style="font-size:0.7rem; font-weight:700; text-transform:uppercase; color:#6366f1; margin-bottom:2px;">' + escapeHtml(DIALOGUE_TYPE_LABELS[e.type] || e.type || '') + '</div>' +
    '<div style="font-weight:600; margin-bottom:2px;" data-testid="text-dialogue-trigger-' + escapeHtml(e.id) + '">' + escapeHtml(e.trigger || '(no trigger)') + '</div>' +
    variants +
    '<div style="font-size:0.85rem; color:#374151; margin:4px 0; white-space:pre-wrap;" data-testid="text-dialogue-answer-' + escapeHtml(e.id) + '">' + escapeHtml(e.answer || '') + '</div>' +
    (e.translation ? '<div style="font-size:0.8rem; color:#6b7280; margin-bottom:6px; white-space:pre-wrap;">' + escapeHtml(e.translation) + '</div>' : '') +
    '<div style="display:flex; gap:6px;">' +
      '<button class="btn btn-secondary btn-small" data-dialogue-edit="' + escapeHtml(e.id) + '" data-testid="button-edit-dialogue-' + escapeHtml(e.id) + '">Edit</button>' +
      '<button class="btn btn-secondary btn-small" data-dialogue-delete="' + escapeHtml(e.id) + '" data-testid="button-delete-dialogue-' + escapeHtml(e.id) + '">Delete</button>' +
    '</div>' +
  '</div>';
}

function renderDialogueEntries() {
  var listEl = document.getElementById('dialogueEntriesList');
  if (!listEl) return;
  if (!dialogueEntries.length) {
    listEl.innerHTML = '<div style="color:#6b7280; padding:8px;">No lines yet for this goal. Click "Auto-build" to generate a library from your context and cards, or add lines manually.</div>';
    return;
  }
  var sorted = dialogueEntries.slice().sort(function(a, b) {
    return (a.sortOrder != null ? a.sortOrder : 0) - (b.sortOrder != null ? b.sortOrder : 0);
  });
  listEl.innerHTML = sorted.map(renderDialogueEntryRow).join('');
  listEl.querySelectorAll('[data-dialogue-edit]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      openDialogueEntryModal(btn.getAttribute('data-dialogue-edit'));
    });
  });
  listEl.querySelectorAll('[data-dialogue-delete]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      deleteDialogueEntry(btn.getAttribute('data-dialogue-delete'));
    });
  });
}

function openDialogueModal() {
  var modal = document.getElementById('dialogueModal');
  if (modal) modal.classList.add('active');
  loadDialogueLibraries().then(function() {
    showDialogueListView();
  });
}

function closeDialogueModal() {
  var modal = document.getElementById('dialogueModal');
  if (modal) modal.classList.remove('active');
}

// Sync the currently edited library object in the in-memory list (or append it).
function upsertDialogueLibraryCache(library) {
  if (!library) return;
  var idx = dialogueLibraries.map(function(l) { return l.id; }).indexOf(library.id);
  if (idx >= 0) dialogueLibraries[idx] = library;
  else dialogueLibraries.push(library);
  currentDialogueLibraryId = library.id;
  dialogueEntries = Array.isArray(library.entries) ? library.entries.slice() : [];
  updateDialogueStatus();
}

async function generateDialogueLibrary() {
  var btn = document.getElementById('generateDialogueBtn');
  var goalType = currentDialogueGoalType();
  var goalText = currentDialogueGoalText();
  if (dialogueEntries.length && !confirm('Auto-build will REPLACE the current lines for this goal. Continue?')) return;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Building...'; }
  try {
    var body = { goalType: goalType, goalText: goalText };
    if (currentDialogueLibraryId) body.id = currentDialogueLibraryId;
    var response = await fetch('/api/dialogue-libraries/generate', {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
      body: JSON.stringify(body)
    });
    if (response.ok) {
      var data = await response.json();
      if (data.library) {
        upsertDialogueLibraryCache(data.library);
        showDialogueEditView();
        renderDialogueEntries();
      }
      if (data.warning) alert(data.warning);
    } else {
      var err = await response.json().catch(function() { return {}; });
      alert('Auto-build failed: ' + (err.error || response.status));
    }
  } catch (error) {
    log('Dialogue generate error: ' + error.message);
    alert('Auto-build failed: ' + error.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ Auto-build'; }
  }
}

// Persist the current goal: PUT if it already exists (by id), else POST create.
async function saveDialogueLibrary() {
  var goalType = currentDialogueGoalType();
  var goalText = currentDialogueGoalText();
  var url, method;
  if (currentDialogueLibraryId) {
    url = '/api/dialogue-libraries/' + encodeURIComponent(currentDialogueLibraryId);
    method = 'PUT';
  } else {
    url = '/api/dialogue-libraries';
    method = 'POST';
  }
  var response = await fetch(url, {
    method: method,
    credentials: 'include',
    headers: authHeaders(),
    body: JSON.stringify({ goalType: goalType, goalText: goalText, entries: dialogueEntries })
  });
  if (response.ok) {
    var data = await response.json();
    if (data.library) upsertDialogueLibraryCache(data.library);
    return true;
  }
  var err = await response.json().catch(function() { return {}; });
  alert('Failed to save: ' + (err.error || response.status));
  return false;
}

async function saveDialogueGoal() {
  var btn = document.getElementById('dialogueSaveGoalBtn');
  if (btn) btn.disabled = true;
  try {
    var ok = await saveDialogueLibrary();
    if (ok) renderDialogueEntries();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteDialogueLibrary() {
  if (!currentDialogueLibraryId) { showDialogueListView(); return; }
  if (!confirm('Delete this entire goal library? This cannot be undone.')) return;
  try {
    var response = await fetch('/api/dialogue-libraries/' + encodeURIComponent(currentDialogueLibraryId), {
      method: 'DELETE',
      credentials: 'include',
      headers: authHeaders()
    });
    if (response.ok) {
      var removedId = currentDialogueLibraryId;
      dialogueLibraries = dialogueLibraries.filter(function(l) { return l.id !== removedId; });
      dialogueEntries = [];
      updateDialogueStatus();
      showDialogueListView();
    } else {
      var err = await response.json().catch(function() { return {}; });
      alert('Failed to delete: ' + (err.error || response.status));
    }
  } catch (error) {
    log('Dialogue delete error: ' + error.message);
    alert('Failed to delete: ' + error.message);
  }
}

function openDialogueEntryModal(id) {
  var entry = dialogueEntries.filter(function(e) { return e.id === id; })[0];
  editingDialogueEntryId = id || null;
  var titleEl = document.getElementById('dialogueEntryTitle');
  var typeEl = document.getElementById('dialogueEntryType');
  var triggerEl = document.getElementById('dialogueEntryTrigger');
  var variantsEl = document.getElementById('dialogueEntryVariants');
  var answerEl = document.getElementById('dialogueEntryAnswer');
  var translationEl = document.getElementById('dialogueEntryTranslation');
  var slotEl = document.getElementById('dialogueEntrySlot');
  var sortEl = document.getElementById('dialogueEntrySortOrder');
  if (entry) {
    if (titleEl) titleEl.textContent = 'Edit line';
    if (typeEl) typeEl.value = entry.type || 'typical';
    if (triggerEl) triggerEl.value = entry.trigger || '';
    if (variantsEl) variantsEl.value = (Array.isArray(entry.variants) ? entry.variants : []).join('\n');
    if (answerEl) answerEl.value = entry.answer || '';
    if (translationEl) translationEl.value = entry.translation || '';
    if (slotEl) slotEl.value = entry.slot || '';
    if (sortEl) sortEl.value = (entry.sortOrder != null ? entry.sortOrder : 0);
  } else {
    if (titleEl) titleEl.textContent = 'New line';
    if (typeEl) typeEl.value = 'typical';
    if (triggerEl) triggerEl.value = '';
    if (variantsEl) variantsEl.value = '';
    if (answerEl) answerEl.value = '';
    if (translationEl) translationEl.value = '';
    if (slotEl) slotEl.value = '';
    if (sortEl) sortEl.value = dialogueEntries.length;
  }
  var modal = document.getElementById('dialogueEntryModal');
  if (modal) modal.classList.add('active');
}

function closeDialogueEntryModal() {
  editingDialogueEntryId = null;
  var modal = document.getElementById('dialogueEntryModal');
  if (modal) modal.classList.remove('active');
}

async function saveDialogueEntry() {
  var saveBtn = document.getElementById('dialogueEntrySave');
  if (saveBtn) saveBtn.disabled = true;
  var typeEl = document.getElementById('dialogueEntryType');
  var triggerEl = document.getElementById('dialogueEntryTrigger');
  var variantsEl = document.getElementById('dialogueEntryVariants');
  var answerEl = document.getElementById('dialogueEntryAnswer');
  var translationEl = document.getElementById('dialogueEntryTranslation');
  var slotEl = document.getElementById('dialogueEntrySlot');
  var sortEl = document.getElementById('dialogueEntrySortOrder');
  var answer = answerEl ? answerEl.value.trim() : '';
  if (!answer) { alert('Answer is required'); if (saveBtn) saveBtn.disabled = false; return; }
  var variants = variantsEl
    ? variantsEl.value.split('\n').map(function(v) { return v.trim(); }).filter(function(v) { return v; })
    : [];
  var slot = slotEl ? slotEl.value.trim() : '';
  var entry = {
    id: editingDialogueEntryId || ('e_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
    type: typeEl ? typeEl.value : 'typical',
    trigger: triggerEl ? triggerEl.value.trim() : '',
    variants: variants,
    answer: answer,
    translation: translationEl ? translationEl.value.trim() : '',
    slot: slot || null,
    sortOrder: sortEl && sortEl.value !== '' ? Number(sortEl.value) : dialogueEntries.length
  };
  if (editingDialogueEntryId) {
    dialogueEntries = dialogueEntries.map(function(e) { return e.id === editingDialogueEntryId ? entry : e; });
  } else {
    dialogueEntries.push(entry);
  }
  try {
    var ok = await saveDialogueLibrary();
    if (ok) {
      renderDialogueEntries();
      closeDialogueEntryModal();
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function deleteDialogueEntry(id) {
  var entry = dialogueEntries.filter(function(e) { return e.id === id; })[0];
  if (!confirm('Delete this line' + (entry && entry.trigger ? ' ("' + entry.trigger + '")' : '') + '?')) return;
  dialogueEntries = dialogueEntries.filter(function(e) { return e.id !== id; });
  var ok = await saveDialogueLibrary();
  if (ok) renderDialogueEntries();
}

(function initDialogueUI() {
  var openBtn = document.getElementById('openDialogueBtn');
  if (openBtn) openBtn.addEventListener('click', openDialogueModal);
  var closeBtn = document.getElementById('dialogueModalClose');
  if (closeBtn) closeBtn.addEventListener('click', closeDialogueModal);
  var cancelBtn = document.getElementById('dialogueModalCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeDialogueModal);
  var dialogueModal = document.getElementById('dialogueModal');
  if (dialogueModal) dialogueModal.addEventListener('click', function(e) {
    if (e.target === dialogueModal) closeDialogueModal();
  });

  var newGoalBtn = document.getElementById('newDialogueGoalBtn');
  if (newGoalBtn) newGoalBtn.addEventListener('click', function() { openDialogueEditor(null); });
  var backBtn = document.getElementById('dialogueBackBtn');
  if (backBtn) backBtn.addEventListener('click', showDialogueListView);

  var genBtn = document.getElementById('generateDialogueBtn');
  if (genBtn) genBtn.addEventListener('click', generateDialogueLibrary);
  var saveGoalBtn = document.getElementById('dialogueSaveGoalBtn');
  if (saveGoalBtn) saveGoalBtn.addEventListener('click', saveDialogueGoal);
  var addEntryBtn = document.getElementById('addDialogueEntryBtn');
  if (addEntryBtn) addEntryBtn.addEventListener('click', function() { openDialogueEntryModal(null); });
  var delLibBtn = document.getElementById('dialogueDeleteBtn');
  if (delLibBtn) delLibBtn.addEventListener('click', deleteDialogueLibrary);

  var entryClose = document.getElementById('dialogueEntryModalClose');
  if (entryClose) entryClose.addEventListener('click', closeDialogueEntryModal);
  var entryCancel = document.getElementById('dialogueEntryCancel');
  if (entryCancel) entryCancel.addEventListener('click', closeDialogueEntryModal);
  var entrySave = document.getElementById('dialogueEntrySave');
  if (entrySave) entrySave.addEventListener('click', saveDialogueEntry);
  var entryModal = document.getElementById('dialogueEntryModal');
  if (entryModal) entryModal.addEventListener('click', function(e) {
    if (e.target === entryModal) closeDialogueEntryModal();
  });
})();

(function initContactsUI() {
  var openBtn = document.getElementById('openContactsBtn');
  if (openBtn) openBtn.addEventListener('click', openContactsModal);

  var closeBtn = document.getElementById('contactsModalClose');
  if (closeBtn) closeBtn.addEventListener('click', closeContactsModal);
  var cancelBtn = document.getElementById('contactsModalCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeContactsModal);
  var contactsModal = document.getElementById('contactsModal');
  if (contactsModal) contactsModal.addEventListener('click', function(e) {
    if (e.target === contactsModal) closeContactsModal();
  });

  var editClose = document.getElementById('contactEditModalClose');
  if (editClose) editClose.addEventListener('click', closeContactEditModal);
  var editCancel = document.getElementById('contactEditCancel');
  if (editCancel) editCancel.addEventListener('click', closeContactEditModal);
  var editSave = document.getElementById('contactEditSave');
  if (editSave) editSave.addEventListener('click', saveContact);
  var editModal = document.getElementById('contactEditModal');
  if (editModal) editModal.addEventListener('click', function(e) {
    if (e.target === editModal) closeContactEditModal();
  });
})();

// Service Worker and Push Notifications
var swRegistration = null;
var notificationsBtn = document.getElementById('enableNotificationsBtn');

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    log('Service workers not supported');
    return null;
  }
  
  try {
    const registration = await navigator.serviceWorker.register('/app/sw.js');
    log('Service worker registered');
    
    // Listen for updates
    registration.addEventListener('updatefound', function() {
      const newWorker = registration.installing;
      log('New service worker found, installing...');
      
      newWorker.addEventListener('statechange', function() {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New version available - show update prompt
          log('New version available');
          showUpdatePrompt(registration);
        }
      });
    });
    
    navigator.serviceWorker.addEventListener('message', function(event) {
      if (event.data && event.data.type === 'INCOMING_CALL') {
        log('Incoming call from SW: ' + event.data.fromNumber + ' callSid: ' + event.data.callSid);
        showPushIncomingCall(event.data.fromNumber, event.data.callSid);
      }
    });
    
    return registration;
  } catch (error) {
    log('SW registration failed: ' + error.message);
    return null;
  }
}

function showUpdatePrompt(registration) {
  var updateBanner = document.createElement('div');
  updateBanner.id = 'updateBanner';
  updateBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#4f46e5;color:white;padding:12px;text-align:center;z-index:10000;font-size:14px;';
  updateBanner.innerHTML = 'New version available! <button id="updateBtn" style="margin-left:10px;background:white;color:#4f46e5;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;font-weight:600;">Update</button>';
  document.body.prepend(updateBanner);
  
  document.getElementById('updateBtn').addEventListener('click', function() {
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    window.location.reload();
  });
}

async function subscribeToPush() {
  // Check if running as PWA (standalone mode)
  var isPWA = window.matchMedia('(display-mode: standalone)').matches || 
              window.navigator.standalone === true;
  
  if (!isPWA) {
    alert('Please add TalkHint to Home Screen first, then open from there to enable notifications');
    log('Not running as PWA');
    return false;
  }
  
  try {
    // Request permission FIRST (iOS requires user gesture)
    const permission = await Notification.requestPermission();
    log('Notification permission: ' + permission);
    
    if (permission !== 'granted') {
      alert('Please allow notifications to receive incoming call alerts');
      return false;
    }
    
    // Wait for service worker to be ready (critical for iOS)
    log('Waiting for service worker...');
    const registration = await navigator.serviceWorker.ready;
    log('Service worker ready');
    
    if (!registration.pushManager) {
      log('Push manager not available');
      alert('Push notifications not supported on this device');
      return false;
    }
    
    // Get VAPID public key from server
    const vapidResponse = await fetch('/api/push/vapid-key', { credentials: 'include' });
    if (!vapidResponse.ok) {
      log('Push not configured on server');
      alert('Push notifications are not configured on the server');
      return false;
    }
    
    const { publicKey } = await vapidResponse.json();
    if (!publicKey) {
      log('No VAPID public key');
      return false;
    }
    
    // Check existing subscription
    let subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      // Subscribe to push
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      log('Push subscription created');
    } else {
      log('Already subscribed to push');
    }
    
    // Save subscription to server
    const saveResponse = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ subscription: subscription.toJSON() })
    });
    
    if (saveResponse.ok) {
      log('Push subscription saved');
      updateNotificationButton(true);
      return true;
    } else {
      log('Failed to save subscription');
      return false;
    }
  } catch (error) {
    log('Push subscription error: ' + error.message);
    alert('Failed to enable notifications: ' + error.message);
    return false;
  }
}

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = window.atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function updateNotificationButton(enabled) {
  if (!notificationsBtn) return;
  if (enabled) {
    notificationsBtn.innerHTML = '<span>✓</span><span>Notifications Enabled</span>';
    notificationsBtn.style.background = '#22c55e';
    notificationsBtn.disabled = true;
  } else {
    notificationsBtn.innerHTML = '<span>🔔</span><span>Enable Notifications</span>';
    notificationsBtn.style.background = '#6366f1';
    notificationsBtn.disabled = false;
  }
}

async function checkExistingSubscription() {
  if (!swRegistration) return;
  try {
    const subscription = await swRegistration.pushManager.getSubscription();
    if (subscription) {
      log('Existing push subscription found');
      updateNotificationButton(true);
    }
  } catch (e) {
    log('Error checking subscription: ' + e.message);
  }
}

// Button click handler - iOS requires user gesture for permission
if (notificationsBtn) {
  notificationsBtn.addEventListener('click', function() {
    subscribeToPush();
  });
}

// Register service worker on load
registerServiceWorker().then(function(registration) {
  swRegistration = registration;
  if (registration) {
    checkExistingSubscription();
  }
});

// ============================================================
// PUSH-TO-TALK MICROPHONE FOR TRAINING MODE
// ============================================================
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// --- PREPARE voice input: tap-to-record, OpenAI gpt-4o-transcribe (accuracy-
// first, any language). Deepgram is NOT used here (provider policy v1). ---
let prepareRecorder = null;
let prepareChunks = [];
let isPrepareRecording = false;
// Last captured audio payload, kept until STT succeeds so the user can retry
// on network failure without re-recording.
let pendingPrepareAudio = null; // { b64: string, mime: string } | null
// Text of the last prepare_message sent to the server, kept until the server
// acknowledges it with prepare_reply / prepare_error / prepare_opening.
// Used to recover the message when the socket closes before the ack arrives.
var pendingPrepareText = null; // string | null

function isPrepareContext() {
  return callMode === 'live' && !isInCall && !isTrainingActive;
}

// Show an AI error bubble with a "Retry" button that re-submits the retained audio.
function addPrepareRetryMessage(msg) {
  var wrap = document.createElement('div');
  wrap.className = 'message ai';
  var label = document.createElement('div');
  label.className = 'message-label';
  label.textContent = 'AI';
  var bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = msg;
  if (pendingPrepareAudio) {
    var retryBtn = document.createElement('button');
    retryBtn.textContent = '🔄 Повторить';
    retryBtn.style.cssText = 'margin-top:8px;padding:6px 14px;border:none;border-radius:8px;background:#6366f1;color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;display:block;';
    retryBtn.addEventListener('click', function() {
      wrap.remove();
      UI.micBtn.classList.add('processing');
      submitPrepareAudio(pendingPrepareAudio).finally(function() {
        UI.micBtn.classList.remove('processing');
      });
    });
    bubble.appendChild(retryBtn);
  }
  wrap.appendChild(label);
  wrap.appendChild(bubble);
  UI.chatContainer.appendChild(wrap);
  UI.chatContainer.scrollTop = UI.chatContainer.scrollHeight;
}

// Submit a retained audio payload to STT and, on success, send the recognized
// text to the PREPARE chat. Keeps pendingPrepareAudio set until STT succeeds
// so the retry button can re-use the same payload.
async function submitPrepareAudio(payload) {
  if (!payload) return;
  let res;
  try {
    res = await fetch('/api/prepare/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getAuthToken() },
      credentials: 'include',
      body: JSON.stringify({ audio: payload.b64, mimeType: payload.mime })
    });
  } catch (networkErr) {
    log('[PrepareMic] STT upload failed (network): ' + networkErr.message);
    addPrepareRetryMessage('⚠️ Ошибка сети при загрузке записи. Нажмите «Повторить» или наберите сообщение текстом.');
    return;
  }
  if (!res.ok) {
    var errBody = await res.json().catch(function() { return {}; });
    addPrepareRetryMessage('⚠️ ' + (errBody.error || 'Не удалось распознать речь.'));
    return;
  }
  var data = await res.json();
  var text = (data.text || '').trim();
  if (!text) {
    addMessage('ai', '⚠️ Речь не распознана — попробуйте ещё раз, чуть ближе к микрофону.');
    return;
  }
  // STT succeeded — clear the retained payload so retry is no longer offered.
  pendingPrepareAudio = null;
  // Show the recognized text in the chat feed.
  addMessage('honor', text);
  // Send to PREPARE chat; if WS is down the text is preserved in the input
  // field by sendPrepareMessage so the user can retry once reconnected.
  sendPrepareMessage(text);
}

async function togglePrepareRecording() {
  if (isPrepareRecording) {
    if (prepareRecorder && prepareRecorder.state !== 'inactive') prepareRecorder.stop();
    isPrepareRecording = false;
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    }
    prepareRecorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
    prepareChunks = [];
    prepareRecorder.ondataavailable = function(e) { if (e.data.size > 0) prepareChunks.push(e.data); };
    prepareRecorder.onstop = async function() {
      UI.micBtn.classList.remove('recording');
      UI.micBtn.classList.add('processing');
      stream.getTracks().forEach(function(t) { t.stop(); });
      try {
        if (prepareChunks.length === 0) return;
        const blob = new Blob(prepareChunks, { type: mimeType || 'audio/webm' });
        if (blob.size < 2000) { log('[PrepareMic] Blob too small, skipping'); return; }
        const base64Audio = await blobToBase64(blob);
        // Retain the audio payload before we attempt STT so the user can retry
        // without re-recording if the network request fails.
        pendingPrepareAudio = { b64: base64Audio, mime: mimeType || 'audio/webm' };
        await submitPrepareAudio(pendingPrepareAudio);
      } catch (e) {
        log('[PrepareMic] transcription error: ' + e.message);
        addPrepareRetryMessage('⚠️ Ошибка при отправке записи. Нажмите «Повторить» или наберите сообщение текстом.');
      } finally {
        UI.micBtn.classList.remove('processing');
      }
    };
    prepareRecorder.start();
    isPrepareRecording = true;
    UI.micBtn.classList.add('recording');
    log('[PrepareMic] Recording started (tap again to stop)');
  } catch (e) {
    log('[PrepareMic] getUserMedia failed: ' + e.message);
    addMessage('ai', '⚠️ Нет доступа к микрофону. Разрешите доступ в настройках браузера.');
  }
}

function initMicButton() {
  if (!UI.micBtn) {
    log('[Mic] Mic button not found');
    return;
  }
  
  // Show/hide mic button based on training mode
  updateMicButtonVisibility();
  
  // Push-to-talk (training): mousedown to start, mouseup to stop.
  // In PREPARE context (live mode, no call) the same button is TAP-to-start /
  // TAP-to-stop instead — 30-60 seconds of speech is too long to hold.
  UI.micBtn.addEventListener('mousedown', function() { if (!isPrepareContext()) startRecording(); });
  UI.micBtn.addEventListener('mouseup', function() { if (!isPrepareContext()) stopRecording(); });
  UI.micBtn.addEventListener('mouseleave', function() { if (!isPrepareContext()) stopRecording(); });
  UI.micBtn.addEventListener('click', function() { if (isPrepareContext()) togglePrepareRecording(); });
  
  // Touch events for mobile
  UI.micBtn.addEventListener('touchstart', function(e) {
    if (isPrepareContext()) return; // tap handled by click
    e.preventDefault();
    startRecording();
  });
  UI.micBtn.addEventListener('touchend', function(e) {
    if (isPrepareContext()) return;
    e.preventDefault();
    stopRecording();
  });
  
  log('[Mic] Push-to-talk initialized');
}

function updateMicButtonVisibility() {
  log('[Mic] updateMicButtonVisibility called: callMode=' + callMode + ', isTrainingActive=' + isTrainingActive);
  if (!UI.micBtn) {
    log('[Mic] micBtn element not found!');
    return;
  }
  
  // Show mic in training sessions AND in the PREPARE context (live mode,
  // before a call): there the user speaks the problem instead of typing.
  if ((callMode === 'training' && isTrainingActive) || isPrepareContext()) {
    UI.micBtn.style.display = 'flex';
    log('[Mic] Showing mic button');
  } else {
    UI.micBtn.style.display = 'none';
    log('[Mic] Hiding mic button');
  }
}

async function startRecording() {
  if (isRecording || !isTrainingActive) return;
  
  try {
    log('[Mic] Requesting microphone access...');
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      } 
    });
    
    // Determine best supported mime type
    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/mp4';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = ''; // Let browser choose
        }
      }
    }
    
    log('[Mic] Using mime type: ' + (mimeType || 'default'));
    
    // 32 kbps opus is enough for clean speech and cuts upload size 3-4x
    const options = mimeType
      ? { mimeType, audioBitsPerSecond: 32000 }
      : { audioBitsPerSecond: 32000 };
    mediaRecorder = new MediaRecorder(stream, options);
    audioChunks = [];
    
    mediaRecorder.ondataavailable = function(event) {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = async function() {
      log('[Mic] Recording stopped, processing...');
      UI.micBtn.classList.remove('recording');
      UI.micBtn.classList.add('processing');
      
      // Stop all tracks
      stream.getTracks().forEach(track => track.stop());
      
      if (audioChunks.length === 0) {
        log('[Mic] No audio data recorded');
        UI.micBtn.classList.remove('processing');
        return;
      }
      
      const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
      log('[Mic] Audio blob size: ' + audioBlob.size + ' bytes');

      // Skip tiny/empty blobs (spurious taps) — avoids Deepgram 400 "corrupt data" errors
      if (audioBlob.size < 2000) {
        log('[Mic] Blob too small, skipping transcription');
        UI.micBtn.classList.remove('processing');
        return;
      }

      // Convert to base64 and send to STT
      const base64Audio = await blobToBase64(audioBlob);
      await sendAudioForTranscription(base64Audio, mimeType || 'audio/webm');
      
      UI.micBtn.classList.remove('processing');
    };
    
    mediaRecorder.start();
    isRecording = true;
    UI.micBtn.classList.add('recording');
    log('[Mic] Recording started');
    
  } catch (err) {
    log('[Mic] Error accessing microphone: ' + err.message);
    alert('Could not access microphone. Please grant permission.');
  }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  
  isRecording = false;
  if (mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    log('[Mic] Stopping recording...');
  }
}

function blobToBase64(blob) {
  return new Promise(function(resolve, reject) {
    const reader = new FileReader();
    reader.onloadend = function() {
      // Remove the data URL prefix to get just base64
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function sendAudioForTranscription(base64Audio, mimeType) {
  try {
    log('[Mic] Sending audio for transcription...');
    
    const token = getAuthToken();
    const response = await fetch('/training/stt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        audio: base64Audio,
        mimeType: mimeType
      })
    });
    
    if (!response.ok) {
      let errorMsg = 'Transcription failed';
      try {
        const error = await response.json();
        errorMsg = error.error || errorMsg;
      } catch (e) {
        // Response was not JSON
        errorMsg = 'Server error: ' + response.status;
      }
      throw new Error(errorMsg);
    }
    
    let result;
    try {
      result = await response.json();
    } catch (e) {
      throw new Error('Invalid response from server');
    }
    const text = result.text;
    
    if (!text || text.trim() === '') {
      log('[Mic] No speech detected');
      addSystemMessage('(No speech detected - try again)');
      return;
    }
    
    log('[Mic] Transcribed: ' + text);
    
    // Put transcribed text in input field for user to review/edit before sending
    UI.textInput.value = text;
    UI.textInput.focus();
    addSystemMessage('Tap Send to confirm, or edit the text first');
    
  } catch (err) {
    log('[Mic] Transcription error: ' + err.message);
    addSystemMessage('Voice input error: ' + err.message);
  }
}

// Initialize mic button on load
initMicButton();
