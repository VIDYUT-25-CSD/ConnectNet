// ============================================
// FIREBASE CONFIGURATION
// ============================================
const firebaseConfig = {
  apiKey: "AIzaSyAf053IXMKKznQhn0QTq1h3R-15LeJlTd4",
  authDomain: "connectnet-d7ea7.firebaseapp.com",
  databaseURL: "https://connectnet-d7ea7-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "connectnet-d7ea7",
  storageBucket: "connectnet-d7ea7.firebasestorage.app",
  messagingSenderId: "41676851019",
  appId: "1:41676851019:web:00c0cfb56fe05309b6cace",
  measurementId: "G-Z4HSGS3N20"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// ============================================
// GLOBAL VARIABLES
// ============================================
let map;
let markers = [];
let currentFilter = 'all';
let processedMessageIds = new Set();

// Auto-delete messages older than 24 hours
const MESSAGE_EXPIRY_TIME = 24 * 60 * 60 * 1000;

// ============================================
// MESSAGE FORMAT NORMALIZATION
// ============================================
function normalizeMessage(message, firebaseKey = null) {
  const normalized = {
    original_message_id: message.original_message_id || message.uid || firebaseKey || `fallback-${Date.now()}`,
    emergency_text: message.emergency_text || message.payloadEncrypted || 'Emergency alert',
    location_string: message.location_string || 
      (message.latitude && message.longitude ? `${message.latitude},${message.longitude}` : '12.9716,77.5946'),
    received_timestamp: message.received_timestamp || message.timestamp || Date.now(),
    type: message.type || detectEmergencyTypeFromText(message.emergency_text || message.payloadEncrypted || ''),
    team_deployed: message.team_deployed || false,
    deployed_by: message.deployed_by || null,
    deployed_at: message.deployed_at || null
  };
  return normalized;
}

// ============================================
// HELPER FUNCTIONS
// ============================================
function detectEmergencyTypeFromText(text) {
  const lowerText = text.toLowerCase();
  if (lowerText.includes('medical') || lowerText.includes('injured') || lowerText.includes('hurt') || lowerText.includes('bleeding')) {
    return 'medical';
  } else if (lowerText.includes('fire') || lowerText.includes('burning') || lowerText.includes('smoke')) {
    return 'fire';
  } else if (lowerText.includes('trapped') || lowerText.includes('stuck') || lowerText.includes('buried') || lowerText.includes('collapse')) {
    return 'trapped';
  } else if (lowerText.includes('water') || lowerText.includes('flood') || lowerText.includes('drowning') || lowerText.includes('river')) {
    return 'water';
  }
  return 'medical';
}

function detectEmergencyType(normalizedMessage) {
  if (normalizedMessage.type) {
    const type = normalizedMessage.type.toLowerCase();
    if (['medical', 'fire', 'trapped', 'water'].includes(type)) return type;
  }
  return detectEmergencyTypeFromText(normalizedMessage.emergency_text);
}

function getMarkerIcon(type) {
  const colors = {
    medical: '#ef4444',
    fire: '#f97316',
    trapped: '#eab308',
    water: '#3b82f6'
  };
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: colors[type] || '#ef4444',
    fillOpacity: 0.9,
    strokeColor: '#ffffff',
    strokeWeight: 2,
    scale: 8
  };
}

function getDeployedMarkerIcon() {
  return {
    path: google.maps.SymbolPath.CIRCLE,
    fillColor: '#22c55e',
    fillOpacity: 0.9,
    strokeColor: '#ffffff',
    strokeWeight: 2,
    scale: 8
  };
}

// ============================================
// AUTO-DELETE OLD MESSAGES (SAFE VERSION)
// ============================================
function cleanupOldMessages() {
  const now = Date.now();
  const cutoffTime = now - MESSAGE_EXPIRY_TIME;

  console.log('🧹 Checking for messages older than 24 hours...');
  const messagesRef = database.ref('messages');

  messagesRef.once('value', (snapshot) => {
    const messages = snapshot.val();
    if (!messages) {
      console.log('No messages to clean up.');
      return;
    }

    let deletedCount = 0;
    const deletePromises = [];
    const seenOriginalIds = new Set();

    Object.keys(messages).forEach(messageId => {
      const rawMessage = messages[messageId];
      const message = normalizeMessage(rawMessage, messageId);
      let messageTime = Number(message.received_timestamp);

      if (isNaN(messageTime)) return; // skip invalid
      if (messageTime < 10000000000) messageTime *= 1000; // seconds → ms

      if (messageTime < cutoffTime) {
        console.log(`🧹 Skipping old message: ${messageId} (${new Date(messageTime).toLocaleString()})`);
        return;
      }

      if (seenOriginalIds.has(message.original_message_id)) {
        console.log(`🗑️ Duplicate message skipped: ${messageId} (ID: ${message.original_message_id})`);
        return;
      } else {
        seenOriginalIds.add(message.original_message_id);
      }
    });

    if (deletedCount === 0) console.log('✅ No old/duplicate deletions performed (safe cleanup).');
  });
}

// ============================================
// DEPLOYMENT HANDLER
// ============================================
function deployTeam(messageId) {
  const teamName = prompt('Enter your rescue team name/ID:');
  if (!teamName || teamName.trim() === '') {
    alert('Team name is required to deploy!');
    return;
  }

  const messageRef = database.ref(`messages/${messageId}`);
  messageRef.update({
    team_deployed: true,
    deployed_by: teamName.trim(),
    deployed_at: Date.now()
  }).then(() => {
    alert(`✅ Team "${teamName}" has been deployed!`);
    const card = document.querySelector(`[data-message-id="${messageId}"]`);
    if (card) {
      card.classList.add('deployed');
      card.dataset.deployed = 'true';
      const button = card.querySelector('.deploy-btn');
      if (button) {
        button.outerHTML = `
          <div class="deployed-status">
            <span class="deployed-icon">✅</span> Team Deployed by ${teamName}
            at ${new Date().toLocaleTimeString()}
          </div>
        `;
      }
    }
    const markerData = markers.find(m => m.messageId === messageId);
    if (markerData) {
      markerData.marker.setIcon(getDeployedMarkerIcon());
      markerData.data.team_deployed = true;
    }
  }).catch(error => alert('❌ Error deploying team: ' + error.message));
}

// ============================================
// FIREBASE REALTIME LISTENER (SAFE VERSION)
// ============================================
function listenForMessages() {
  const messagesRef = database.ref('messages');
  const listElement = document.getElementById('message-list-sidebar');

  messagesRef.on('child_added', (snapshot) => {
    const rawMessage = snapshot.val();
    const messageId = snapshot.key;

    console.log('📨 New message received:', messageId, rawMessage);

    const message = normalizeMessage(rawMessage, messageId);
    console.log('📨 Normalized message:', message);

    // ✅ Normalize timestamp
    let messageTime = Number(message.received_timestamp);
    if (isNaN(messageTime)) messageTime = Date.now();
    else if (messageTime < 10000000000) messageTime *= 1000;
    message.received_timestamp = messageTime;

    // ✅ Expiry check (skip only)
    const now = Date.now();
    if (now - message.received_timestamp > MESSAGE_EXPIRY_TIME) {
      console.log(`⏰ Skipping expired message ${messageId} (${new Date(message.received_timestamp)})`);
      return;
    }

    // ✅ Duplicate check (skip only)
    if (processedMessageIds.has(message.original_message_id)) {
      console.log(`⚠️ Skipping duplicate: ${message.original_message_id}`);
      return;
    }
    processedMessageIds.add(message.original_message_id);

    // Parse coordinates
    const [lat, lng] = message.location_string.split(',').map(parseFloat);
    const coords = { lat, lng };
    const emergencyType = detectEmergencyType(message);

    console.log(`✅ Displaying message: ${emergencyType} at ${coords.lat}, ${coords.lng}`);

    const marker = new google.maps.Marker({
      position: coords,
      map: map,
      title: message.emergency_text,
      animation: google.maps.Animation.DROP,
      icon: message.team_deployed ? getDeployedMarkerIcon() : getMarkerIcon(emergencyType)
    });

    const infoWindow = new google.maps.InfoWindow({
      content: `
        <div style="color:#333; padding:5px;">
          <h3 style="color:#667eea; margin:0 0 10px 0;">Emergency Alert</h3>
          <p><strong>Message:</strong> ${message.emergency_text}</p>
          <p><strong>Location:</strong> ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}</p>
          <p><strong>Time:</strong> ${new Date(message.received_timestamp).toLocaleString()}</p>
          ${message.team_deployed
            ? `<p style="color:#22c55e;"><strong>✅ Team Deployed</strong></p>
               ${message.deployed_by ? `<p><strong>By:</strong> ${message.deployed_by}</p>` : ''}`
            : `<p style="color:#ef4444;"><strong>⚠️ Awaiting Response</strong></p>`}
        </div>
      `
    });

    marker.addListener('click', () => infoWindow.open(map, marker));
    markers.push({ marker, type: emergencyType, coords, messageId, data: message });

    const newCard = document.createElement('div');
    newCard.className = `message-card ${emergencyType}`;
    newCard.dataset.type = emergencyType;
    newCard.dataset.messageId = messageId;
    newCard.dataset.deployed = message.team_deployed ? 'true' : 'false';
    if (message.team_deployed) newCard.classList.add('deployed');

    newCard.innerHTML = `
      <div class="message-text">${message.emergency_text}</div>
      <div class="message-meta">
        <span class="message-badge badge-${emergencyType}">${emergencyType}</span>
        <span>${new Date(message.received_timestamp).toLocaleTimeString()}</span>
      </div>
      ${message.team_deployed
        ? `<div class="deployed-status">
             <span class="deployed-icon">✅</span> Team Deployed
             ${message.deployed_by ? `by ${message.deployed_by}` : ''}
             ${message.deployed_at ? `at ${new Date(message.deployed_at).toLocaleTimeString()}` : ''}
           </div>`
        : `<button class="deploy-btn" onclick="deployTeam('${messageId}')">🚁 Deploy Rescue Team</button>`}
    `;

    newCard.addEventListener('click', (e) => {
      if (e.target.classList.contains('deploy-btn')) return;
      if (window.innerWidth <= 768) switchToMapView();
      map.panTo(coords);
      map.setZoom(15);
      infoWindow.open(map, marker);
    });

    const noMessages = listElement.querySelector('.no-messages');
    if (noMessages) noMessages.remove();
    listElement.prepend(newCard);

    applyFilter(currentFilter);
  });

  messagesRef.on('child_removed', (snapshot) => {
    const messageId = snapshot.key;
    const rawMessage = snapshot.val();
    console.log(`🗑️ Message removed: ${messageId}`);

    if (rawMessage) {
      const message = normalizeMessage(rawMessage, messageId);
      processedMessageIds.delete(message.original_message_id);
    }

    const card = document.querySelector(`[data-message-id="${messageId}"]`);
    if (card) card.remove();

    const markerIndex = markers.findIndex(m => m.messageId === messageId);
    if (markerIndex !== -1) {
      markers[markerIndex].marker.setMap(null);
      markers.splice(markerIndex, 1);
    }

    const listElement = document.getElementById('message-list-sidebar');
    if (listElement.children.length === 0) {
      const noMessages = document.createElement('div');
      noMessages.className = 'no-messages';
      noMessages.textContent = 'Waiting for emergency messages...';
      listElement.appendChild(noMessages);
    }
  });
}

// ============================================
// MAP INITIALIZATION
// ============================================
function initMap() {
  console.log('🗺️ Initializing map...');
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 12.9716, lng: 77.5946 },
    zoom: 12,
    gestureHandling: 'greedy',
    styles: [
      { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] }
    ]
  });

  console.log('✅ Map initialized');
  listenForMessages();
  cleanupOldMessages();
  setInterval(cleanupOldMessages, 60 * 60 * 1000);
}

window.initMap = initMap;

// ============================================
// FILTER & VIEW HANDLING
// ============================================
function applyFilter(filterType) {
  currentFilter = filterType;
  
  document.querySelectorAll('.message-card').forEach(card => {
    const type = card.dataset.type;
    const deployed = card.dataset.deployed === 'true';
    let show = false;
    if (filterType === 'all') show = true;
    else if (filterType === 'pending') show = !deployed;
    else if (filterType === 'deployed') show = deployed;
    else show = type === filterType;
    card.style.display = show ? 'block' : 'none';
  });

  markers.forEach(m => {
    const deployed = m.data.team_deployed || false;
    let show = false;
    if (filterType === 'all') show = true;
    else if (filterType === 'pending') show = !deployed;
    else if (filterType === 'deployed') show = deployed;
    else show = m.type === filterType;
    m.marker.setMap(show ? map : null);
  });
}

function switchToMapView() {
  const sidebar = document.querySelector('.sidebar');
  const mapElement = document.getElementById('map');
  const toggleButtons = document.querySelectorAll('.toggle-btn');
  
  sidebar.classList.remove('active');
  mapElement.style.display = 'block';
  toggleButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === 'map');
  });
  if (map) setTimeout(() => google.maps.event.trigger(map, 'resize'), 100);
}

function switchToMessagesView() {
  const sidebar = document.querySelector('.sidebar');
  const mapElement = document.getElementById('map');
  const toggleButtons = document.querySelectorAll('.toggle-btn');
  
  sidebar.classList.add('active');
  mapElement.style.display = 'none';
  toggleButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === 'messages');
  });
}

// ============================================
// DOM READY
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  console.log('📱 DOM loaded, initializing UI...');
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilter(btn.dataset.filter);
    });
  });
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      console.log('📱 Toggle clicked:', view);
      if (view === 'messages') switchToMessagesView();
      else switchToMapView();
    });
  });
  console.log('✅ UI initialization complete');
  console.log('⏳ Waiting for Google Maps to load...');
});
