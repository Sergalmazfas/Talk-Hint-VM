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
  manageBtn: document.getElementById('manageBtn')
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
let isTTSPlaying = false; // Flag to suppress owner transcript echo during TTS

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

// Token management state
let currentIdentity = null;
let tokenExpiresAt = null;
let isRefreshingToken = false;
const TOKEN_REFRESH_BUFFER_MS = 60000; // Refresh 1 minute before expiry

// Parse JWT to get expiry time
function parseJwtExpiry(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload.exp ? payload.exp * 1000 : null; // Convert to ms
  } catch (e) {
    return null;
  }
}

// Check if token needs refresh
function isTokenExpiringSoon() {
  if (!tokenExpiresAt) return true;
  return Date.now() > (tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS);
}

// Show session expired UI
function showSessionExpiredUI() {
  log('[Auth] Session expired - showing reload message');
  UI.statusDot.classList.remove('connected', 'calling', 'active');
  UI.statusDot.classList.add('error');
  UI.statusText.textContent = 'Session expired. Reload app.';
  UI.callBtn.disabled = true;
  
  // Show a prominent message
  const expiredBanner = document.createElement('div');
  expiredBanner.id = 'sessionExpiredBanner';
  expiredBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ef4444;color:white;padding:12px;text-align:center;z-index:9999;font-weight:bold;';
  expiredBanner.innerHTML = 'Session expired. <a href="javascript:location.reload()" style="color:white;text-decoration:underline;">Reload app</a>';
  if (!document.getElementById('sessionExpiredBanner')) {
    document.body.appendChild(expiredBanner);
  }
}

// Refresh Twilio token
async function refreshTwilioToken(reason) {
  if (isRefreshingToken) {
    log('[Auth] Token refresh already in progress');
    return false;
  }
  
  isRefreshingToken = true;
  log('[Auth] Refreshing token... reason=' + reason);
  
  try {
    const authToken = getAuthToken();
    const headers = {};
    if (authToken) {
      headers['Authorization'] = 'Bearer ' + authToken;
    }
    const response = await fetch('/api/token', { 
      credentials: 'include',
      headers: headers
    });
    
    if (response.status === 401 || response.status === 403) {
      log('[Auth] Unauthorized - session expired');
      showSessionExpiredUI();
      isRefreshingToken = false;
      return false;
    }
    
    const data = await response.json();
    
    if (data.error) {
      log('[Auth] Token refresh error: ' + data.error);
      if (data.error.toLowerCase().includes('unauthorized') || data.error.toLowerCase().includes('session')) {
        showSessionExpiredUI();
      }
      isRefreshingToken = false;
      return false;
    }
    
    // Validate identity matches
    if (currentIdentity && data.identity !== currentIdentity) {
      log('[Auth] Identity mismatch! Expected=' + currentIdentity + ' Got=' + data.identity);
      showSessionExpiredUI();
      isRefreshingToken = false;
      return false;
    }
    
    currentIdentity = data.identity;
    tokenExpiresAt = parseJwtExpiry(data.token);
    log('[Auth] Token refreshed for: ' + data.identity + ' expires: ' + (tokenExpiresAt ? new Date(tokenExpiresAt).toISOString() : 'unknown'));
    
    // Update device token
    if (device) {
      device.updateToken(data.token);
      log('[Auth] Device token updated');
    }
    
    isRefreshingToken = false;
    return true;
  } catch (err) {
    log('[Auth] Token refresh failed: ' + err.message);
    isRefreshingToken = false;
    return false;
  }
}

// Handle visibility change (app resume)
document.addEventListener('visibilitychange', async function() {
  if (document.visibilityState === 'visible') {
    log('[Auth] App resumed - checking token');
    if (isTokenExpiringSoon()) {
      await refreshTwilioToken('resume');
    }
  }
});

// Periodic token refresh check
setInterval(async function() {
  if (device && isTokenExpiringSoon() && !isOnCall) {
    await refreshTwilioToken('periodic');
  }
}, 30000); // Check every 30 seconds

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
  document.getElementById('acceptCallBtn').onclick = async function() {
    log('Accepting Twilio Device call...');
    // Refresh token before accepting to ensure valid auth
    if (isTokenExpiringSoon()) {
      log('[Auth] Token expiring - refreshing before accept');
      const refreshed = await refreshTwilioToken('incoming_call');
      if (!refreshed) {
        log('[Auth] Token refresh failed - cannot accept call');
        return;
      }
    }
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
  
  // Refresh token before accepting to ensure valid auth
  if (isTokenExpiringSoon()) {
    log('[Auth] Token expiring - refreshing before accept');
    const refreshed = await refreshTwilioToken('incoming_push_call');
    if (!refreshed) {
      log('[Auth] Token refresh failed - cannot accept call');
      hideIncomingCallNotification();
      return;
    }
  }
  
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
  return protocol + '//' + window.location.host + path;
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
  
  if ((type === 'you' || type === 'honor') && !hasGoal) {
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
  
  if ((type === 'you' || type === 'honor') && !hasGoal) {
    setGoalActive(true);
  }
  
  const now = Date.now();
  // Only group actual speech transcripts, never goals or user questions
  const isTranscriptType = (type === 'you' || type === 'honor' || type === 'guest');
  const shouldGroup = (type === lastMessageType) && 
                      (now - lastMessageTime < GROUP_WINDOW_MS) && 
                      lastMessageEl && 
                      isTranscriptType;
  
  if (shouldGroup) {
    const bubble = lastMessageEl.querySelector('.message-bubble');
    if (bubble) {
      // Dedupe: don't add if exact same text is already the last line
      const existingLines = bubble.textContent.split('\n');
      const lastLine = existingLines[existingLines.length - 1];
      if (lastLine && lastLine.trim() === text.trim()) {
        log('[Dedupe] Skipping duplicate text: ' + text.substring(0, 30));
        return; // Skip duplicate
      }
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
    else if (type === 'goal') label = '🎯 Goal';
    else if (type === 'user_question') label = '❓ You asked';
    
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

// Goal badge in header
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
    const authToken = getAuthToken();
    const headers = {};
    if (authToken) {
      headers['Authorization'] = 'Bearer ' + authToken;
    }
    const response = await fetch('/api/token', { 
      credentials: 'include',
      headers: headers
    });
    
    if (response.status === 401 || response.status === 403) {
      log('[Auth] Unauthorized on init - session expired');
      showSessionExpiredUI();
      return;
    }
    
    const data = await response.json();
    
    if (data.error) {
      log('Token error: ' + data.error);
      if (data.error.toLowerCase().includes('unauthorized') || data.error.toLowerCase().includes('session')) {
        showSessionExpiredUI();
      } else {
        UI.statusText.textContent = 'Token error';
      }
      return;
    }

    // Store token identity and expiry
    currentIdentity = data.identity;
    tokenExpiresAt = parseJwtExpiry(data.token);
    log('Token received for: ' + data.identity + ' expires: ' + (tokenExpiresAt ? new Date(tokenExpiresAt).toISOString() : 'unknown'));
    
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
      
      // Setup audio devices (skip on iOS Safari as it doesn't support setInputDevice)
      try {
        var isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
        var isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
        
        // List available input devices first
        var inputDevices = await navigator.mediaDevices.enumerateDevices();
        var mics = inputDevices.filter(function(d) { return d.kind === 'audioinput'; });
        log('[Audio] Available microphones: ' + mics.length + ' (iOS=' + isIOS + ', Safari=' + isSafari + ')');
        mics.forEach(function(mic, i) {
          log('[Audio] Mic ' + i + ': ' + (mic.label || 'Unnamed') + ' (' + mic.deviceId.substring(0,8) + ')');
        });
        
        // iOS Safari doesn't support setInputDevice - skip it
        if (!isIOS && device.audio && device.audio.setInputDevice) {
          await device.audio.setInputDevice('default');
          log('[Audio] Input device set to default');
        } else {
          log('[Audio] Skipping setInputDevice (iOS/Safari uses system default)');
        }
      } catch (e) {
        log('[Audio] Device setup warning: ' + e.message + ' (non-fatal on iOS)');
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
      break;

    case 'owner_transcript':
    case 'hon_transcript':
      if (data.text) {
        // TTS echo suppression: ignore owner transcripts while TTS is playing
        if (isTTSPlaying) {
          log('[Echo] Suppressed owner transcript during TTS: ' + data.text.substring(0, 30));
          break;
        }
        
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
      // Auto-detect goal from conversation
      if (data.goalType && data.goalType !== 'other') {
        var goalLabel = getGoalLabel(data.goalType);
        showGoalBadge(goalLabel);
        if (!callGoal) {
          callGoal = goalLabel;
          setGoalActive(true);
        }
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
        addMessage('ai', '🎯 Цель: ' + callGoal);
        showGoalBadge(callGoal);
      } else {
        // Safe Start: no goal set, AI will help discover it
        addMessage('ai', '👋 Звонок начался! Я слушаю и буду подсказывать.');
        addHint('What brings you to call today?', 'Что привело вас сегодня?');
      }
      
      // Start quality monitoring for debugging audio issues
      startQualityMonitoring(activeCall);
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
}

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
    callGoal = text;
    setGoalActive(true);
    showGoalBadge(text);
    // Goal is NOT a transcript - use 'goal' type, not 'honor'
    addMessage('goal', text);
    
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'set_goal',
        goal: text
      }));
    }
    
    if (callMode === 'training') {
      addMessage('ai', '🎯 Goal set! Click the phone button to start training.');
      // In training mode, don't show hint here - it will be generated by AI when session starts
    } else {
      addMessage('ai', '🎯 Цель установлена! Теперь позвоните.');
      // In live mode, generate goal-specific initial hint
      generateInitialHint(text).then(function(nextStep) {
        addHint(nextStep.en, nextStep.ru);
      });
    }
  } else {
    // User question during call - use 'user_question' type, not transcript
    addMessage('user_question', text);
    
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
  showGoalBadge(newGoal);
  
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
    isTTSPlaying = false;
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
      isTTSPlaying = false;
      log('[TTS] Playback ended, echo suppression OFF');
    };
    
    currentAudio.onerror = function() {
      if (buttonEl) {
        buttonEl.textContent = originalText;
        buttonEl.disabled = false;
      }
      isTTSPlaying = false;
      log('[TTS] Audio playback error');
    };
    
    isTTSPlaying = true;
    log('[TTS] Playback started, echo suppression ON');
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

function initMicButton() {
  if (!UI.micBtn) {
    log('[Mic] Mic button not found');
    return;
  }
  
  // Show/hide mic button based on training mode
  updateMicButtonVisibility();
  
  // Push-to-talk: mousedown to start, mouseup to stop
  UI.micBtn.addEventListener('mousedown', startRecording);
  UI.micBtn.addEventListener('mouseup', stopRecording);
  UI.micBtn.addEventListener('mouseleave', stopRecording);
  
  // Touch events for mobile
  UI.micBtn.addEventListener('touchstart', function(e) {
    e.preventDefault();
    startRecording();
  });
  UI.micBtn.addEventListener('touchend', function(e) {
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
  
  // Show mic button only in training mode when session is active
  if (callMode === 'training' && isTrainingActive) {
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
    
    const options = mimeType ? { mimeType } : {};
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
