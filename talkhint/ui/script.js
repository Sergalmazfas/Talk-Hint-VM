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
  
  if (numbers.length === 0) {
    UI.numbersList.innerHTML = '<div class="folders-empty">No numbers yet</div>';
    return;
  }

  numbers.forEach(function(num) {
    var item = document.createElement('div');
    item.className = 'number-item';
    item.setAttribute('data-number-id', num.id);
    if (currentNumber === num.id) {
      item.classList.add('active');
    }
    
    var icon = num.type === 'work' ? '💼' : '📱';
    var badgeClass = num.type === 'work' ? 'work' : 'personal';
    var badgeText = num.type === 'work' ? 'Work' : 'Personal';
    
    var iconSpan = document.createElement('span');
    iconSpan.className = 'number-icon';
    iconSpan.textContent = icon;
    
    var infoDiv = document.createElement('div');
    infoDiv.className = 'number-info';
    
    var nameDiv = document.createElement('div');
    nameDiv.className = 'number-name';
    nameDiv.textContent = num.name;
    
    var valueDiv = document.createElement('div');
    valueDiv.className = 'number-value';
    valueDiv.textContent = num.twilioNumber;
    
    infoDiv.appendChild(nameDiv);
    infoDiv.appendChild(valueDiv);
    
    var badge = document.createElement('span');
    badge.className = 'number-type-badge ' + badgeClass;
    badge.textContent = badgeText;
    
    item.appendChild(iconSpan);
    item.appendChild(infoDiv);
    item.appendChild(badge);
    
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
    if (type === 'you' || type === 'honor') label = '🎙️ You';
    else if (type === 'guest') label = '👤 Guest';
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

function getNextStepHint(goal) {
  var goalLower = (goal || '').toLowerCase();
  
  // Detect goal type and suggest next step
  if (goalLower.includes('встреч') || goalLower.includes('meet') || goalLower.includes('appointment')) {
    return { en: 'What time works for you tomorrow?', ru: 'Во сколько вам удобно завтра?' };
  }
  if (goalLower.includes('запис') || goalLower.includes('book') || goalLower.includes('schedule')) {
    return { en: 'Do you have any availability this week?', ru: 'Есть ли у вас свободное время на этой неделе?' };
  }
  if (goalLower.includes('цен') || goalLower.includes('price') || goalLower.includes('cost') || goalLower.includes('стоим')) {
    return { en: 'Could you tell me the price for...?', ru: 'Можете сказать цену на...?' };
  }
  if (goalLower.includes('узнать') || goalLower.includes('info') || goalLower.includes('question')) {
    return { en: 'I have a quick question about...', ru: 'У меня быстрый вопрос про...' };
  }
  
  return { en: 'How can I help you today?', ru: 'Чем могу помочь сегодня?' };
}

function sendTextToAI() {
  const text = UI.textInput.value.trim();
  if (!text) return;
  
  if (!isInCall) {
    callGoal = text;
    setGoalActive(true);
    showGoalBadge(text);
    addMessage('honor', text);
    
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'set_goal',
        goal: text
      }));
    }
    
    addMessage('ai', '🎯 Цель установлена! Теперь позвоните.');
    
    // Show next_step hint immediately
    var nextStep = getNextStepHint(text);
    addHint(nextStep.en, nextStep.ru);
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
    }
  } catch (err) {
    log('Error loading subscription: ' + err.message);
  }
}

function updatePlanBadge(plan, hasStripeCustomer) {
  if (!UI.planBadge) return;
  
  UI.planBadge.className = 'plan-badge ' + plan;
  
  var planNames = {
    'free': 'Free Trial',
    'personal': 'Personal $9/mo',
    'pro': 'Pro $19/mo'
  };
  UI.planBadge.textContent = planNames[plan] || 'Free Trial';
  
  if (plan === 'free') {
    UI.upgradeBtn.style.display = 'block';
    UI.manageBtn.style.display = 'none';
  } else {
    UI.upgradeBtn.style.display = 'none';
    UI.manageBtn.style.display = hasStripeCustomer ? 'block' : 'none';
  }
}

async function loadStripeProducts() {
  try {
    const res = await fetch('/api/stripe/config');
    if (res.ok) {
      const data = await res.json();
      stripeProducts = data.products || [];
      log('Loaded ' + stripeProducts.length + ' Stripe products');
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

function showUpgradeModal() {
  if (stripeProducts.length === 0) {
    alert('Loading plans...');
    loadStripeProducts().then(showUpgradeModal);
    return;
  }
  
  var modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.id = 'upgradeModal';
  
  var content = '<div class="modal"><div class="modal-header"><span class="modal-title">Choose Your Plan</span><button class="modal-close" onclick="closeUpgradeModal()">&times;</button></div><div class="modal-body">';
  
  stripeProducts.forEach(function(product) {
    var price = product.prices && product.prices[0];
    if (!price) return;
    
    var amount = (price.unit_amount / 100).toFixed(0);
    var planType = product.metadata && product.metadata.plan_type || 'personal';
    
    content += '<div class="plan-card" style="border: 1px solid #e5e5e5; border-radius: 12px; padding: 16px; margin-bottom: 12px;">';
    content += '<h3 style="margin: 0 0 8px 0;">' + escapeHtml(product.name) + '</h3>';
    content += '<p style="color: #666; margin: 0 0 12px 0;">' + escapeHtml(product.description || '') + '</p>';
    content += '<div style="font-size: 1.5rem; font-weight: 600; margin-bottom: 12px;">$' + amount + '<span style="font-size: 0.9rem; color: #666;">/month</span></div>';
    content += '<button class="btn btn-primary" onclick="openCheckout(\'' + price.id + '\')" style="width: 100%;">Subscribe</button>';
    content += '</div>';
  });
  
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
