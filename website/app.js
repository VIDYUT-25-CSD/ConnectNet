// ============================================
// FIREBASE CONFIGURATION
// ============================================
// TODO: Replace with your Firebase config from Firebase Console
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

// Auto-delete messages older than 24 hours (in milliseconds)
const MESSAGE_EXPIRY_TIME = 24 * 60 * 60 * 1000; // 24 hours

// ============================================
// AUTO-DELETE OLD MESSAGES
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
        
        Object.keys(messages).forEach(messageId => {
            const message = messages[messageId];
            const messageTime = message.received_timestamp;
            
            // Check if message is older than 24 hours
            if (messageTime < cutoffTime) {
                console.log(`🗑️ Deleting old message: ${messageId} (${new Date(messageTime).toLocaleString()})`);
                deletePromises.push(
                    database.ref(`messages/${messageId}`).remove()
                );
                deletedCount++;
            }
        });
        
        if (deletedCount > 0) {
            Promise.all(deletePromises).then(() => {
                console.log(`✅ Deleted ${deletedCount} old message(s)`);
            }).catch(error => {
                console.error('❌ Error deleting messages:', error);
            });
        } else {
            console.log('✅ No old messages found. All messages are within 24 hours.');
        }
    });
}

// Run cleanup when page loads
cleanupOldMessages();

// Run cleanup every hour automatically
setInterval(cleanupOldMessages, 60 * 60 * 1000); // Check every hour

// ============================================
// GOOGLE MAPS INITIALIZATION
// ============================================
function initMap() {
    // Center on Bengaluru (disaster area - change as needed)
    map = new google.maps.Map(document.getElementById("map"), {
        gestureHandling: 'greedy',  
        center: { lat: 12.9716, lng: 77.5946 },
        zoom: 12,
        styles: [
            { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
            {
                featureType: "administrative.locality",
                elementType: "labels.text.fill",
                stylers: [{ color: "#d59563" }]
            },
            {
                featureType: "poi",
                elementType: "labels.text.fill",
                stylers: [{ color: "#d59563" }]
            },
            {
                featureType: "road",
                elementType: "geometry",
                stylers: [{ color: "#38414e" }]
            },
            {
                featureType: "road",
                elementType: "geometry.stroke",
                stylers: [{ color: "#212a37" }]
            },
            {
                featureType: "water",
                elementType: "geometry",
                stylers: [{ color: "#17263c" }]
            }
        ]
    });

    // Start listening for messages after map is ready
    listenForMessages();
}

// ============================================
// FIREBASE REALTIME LISTENER
// ============================================
function listenForMessages() {
    const messagesRef = database.ref('messages');
    const listElement = document.getElementById('message-list-sidebar');

    messagesRef.on('child_added', (snapshot) => {
        const message = snapshot.val();
        const messageId = snapshot.key;

        // Check if message is already expired (older than 24 hours)
        const now = Date.now();
        const messageAge = now - message.received_timestamp;
        
        if (messageAge > MESSAGE_EXPIRY_TIME) {
            console.log(`⏰ Message ${messageId} is expired, deleting...`);
            database.ref(`messages/${messageId}`).remove();
            return; // Don't display expired messages
        }

        // Parse coordinates
        const parts = message.location_string.split(',');
        const coords = {
            lat: parseFloat(parts[0]),
            lng: parseFloat(parts[1])
        };

        // Detect emergency type
        const emergencyType = detectEmergencyType(message.emergency_text);

        // Create map marker
        const marker = new google.maps.Marker({
            position: coords,
            map: map,
            title: message.emergency_text,
            animation: google.maps.Animation.DROP,
            icon: message.team_deployed ? getDeployedMarkerIcon(emergencyType) : getMarkerIcon(emergencyType)
        });

        // Create info window
        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="color: #333; padding: 5px;">
                    <h3 style="margin: 0 0 10px 0; color: #667eea;">Emergency Alert</h3>
                    <p style="margin: 5px 0;"><strong>Message:</strong> ${message.emergency_text}</p>
                    <p style="margin: 5px 0;"><strong>Location:</strong> ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}</p>
                    <p style="margin: 5px 0;"><strong>Time:</strong> ${new Date(message.received_timestamp).toLocaleString()}</p>
                    ${message.team_deployed ? 
                        `<p style="margin: 5px 0; color: #22c55e;"><strong>✅ Team Deployed</strong></p>
                         ${message.deployed_by ? `<p style="margin: 5px 0;"><strong>By:</strong> ${message.deployed_by}</p>` : ''}
                         ${message.deployed_at ? `<p style="margin: 5px 0;"><strong>At:</strong> ${new Date(message.deployed_at).toLocaleTimeString()}</p>` : ''}` :
                        '<p style="margin: 5px 0; color: #ef4444;"><strong>⚠️ Awaiting Response</strong></p>'
                    }
                </div>
            `
        });

        marker.addListener('click', () => {
            infoWindow.open(map, marker);
        });

        // Store marker with metadata
        markers.push({
            marker: marker,
            type: emergencyType,
            coords: coords,
            messageId: messageId,
            data: message
        });

        // Create sidebar card
        const newCard = document.createElement('div');
        newCard.className = `message-card ${emergencyType}`;
        newCard.dataset.type = emergencyType;
        newCard.dataset.messageId = messageId;
        
        // Check if team is already deployed
        const isDeployed = message.team_deployed || false;
        if (isDeployed) {
            newCard.classList.add('deployed');
        }
        
        // Add deployment status to dataset
        newCard.dataset.deployed = isDeployed ? 'true' : 'false';
        
        newCard.innerHTML = `
            <div class="message-text">${message.emergency_text}</div>
            <div class="message-meta">
                <span class="message-badge badge-${emergencyType}">${emergencyType}</span>
                <span>${new Date(message.received_timestamp).toLocaleTimeString()}</span>
            </div>
            ${isDeployed ? 
                `<div class="deployed-status">
                    <span class="deployed-icon">✅</span> Team Deployed
                    ${message.deployed_by ? `by ${message.deployed_by}` : ''}
                    ${message.deployed_at ? `at ${new Date(message.deployed_at).toLocaleTimeString()}` : ''}
                </div>` :
                `<button class="deploy-btn" onclick="deployTeam('${messageId}')">
                    🚁 Deploy Rescue Team
                </button>`
            }
        `;

        newCard.addEventListener('click', (e) => {
            // Don't pan if clicking the deploy button
            if (e.target.classList.contains('deploy-btn')) {
                return;
            }
            map.panTo(coords);
            map.setZoom(15);
            infoWindow.open(map, marker);
        });

        // Remove "no messages" placeholder
        const noMessages = listElement.querySelector('.no-messages');
        if (noMessages) {
            noMessages.remove();
        }

        // Add to top of list
        listElement.prepend(newCard);

        // Apply current filter
        applyFilter(currentFilter);
    });

    // Listen for removed messages
    messagesRef.on('child_removed', (snapshot) => {
        const messageId = snapshot.key;
        console.log(`🗑️ Message removed: ${messageId}`);
        
        // Remove from sidebar
        const card = document.querySelector(`[data-message-id="${messageId}"]`);
        if (card) {
            card.remove();
        }
        
        // Remove marker from map
        const markerIndex = markers.findIndex(m => m.messageId === messageId);
        if (markerIndex !== -1) {
            markers[markerIndex].marker.setMap(null); // Remove from map
            markers.splice(markerIndex, 1); // Remove from array
        }
        
        // Show "no messages" if list is empty
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
// HELPER FUNCTIONS
// ============================================
function detectEmergencyType(text) {
    const lowerText = text.toLowerCase();
    if (lowerText.includes('medical') || lowerText.includes('injured') || lowerText.includes('hurt')) {
        return 'medical';
    } else if (lowerText.includes('fire') || lowerText.includes('burning')) {
        return 'fire';
    } else if (lowerText.includes('trapped') || lowerText.includes('stuck') || lowerText.includes('buried')) {
        return 'trapped';
    } else if (lowerText.includes('water') || lowerText.includes('flood') || lowerText.includes('drowning')) {
        return 'water';
    }
    return 'medical'; // default
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
        fillColor: colors[type],
        fillOpacity: 0.9,
        strokeColor: '#ffffff',
        strokeWeight: 2,
        scale: 8
    };
}

function getDeployedMarkerIcon(type) {
    return {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: '#22c55e',
        fillOpacity: 0.9,
        strokeColor: '#ffffff',
        strokeWeight: 2,
        scale: 8
    };
}

function deployTeam(messageId) {
    const teamName = prompt('Enter your rescue team name/ID:');
    
    if (!teamName || teamName.trim() === '') {
        alert('Team name is required to deploy!');
        return;
    }

    // Update Firebase with deployment info
    const messageRef = database.ref(`messages/${messageId}`);
    
    messageRef.update({
        team_deployed: true,
        deployed_by: teamName.trim(),
        deployed_at: Date.now()
    }).then(() => {
        alert(`✅ Team "${teamName}" has been deployed to this location!`);
        
        // Update the card in the UI
        const card = document.querySelector(`[data-message-id="${messageId}"]`);
        if (card) {
            card.classList.add('deployed');
            card.dataset.deployed = 'true';
            
            // Replace button with deployed status
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

        // Update the marker color
        const markerData = markers.find(m => m.messageId === messageId);
        if (markerData) {
            markerData.marker.setIcon(getDeployedMarkerIcon(markerData.type));
            markerData.data.team_deployed = true;
        }
    }).catch(error => {
        alert('❌ Error deploying team: ' + error.message);
    });
}

function applyFilter(filterType) {
    currentFilter = filterType;
    
    // Filter sidebar cards
    const cards = document.querySelectorAll('.message-card');
    cards.forEach(card => {
        const cardType = card.dataset.type;
        const isDeployed = card.dataset.deployed === 'true';
        
        let shouldShow = false;
        
        if (filterType === 'all') {
            shouldShow = true;
        } else if (filterType === 'pending') {
            shouldShow = !isDeployed;
        } else if (filterType === 'deployed') {
            shouldShow = isDeployed;
        } else {
            shouldShow = cardType === filterType;
        }
        
        card.style.display = shouldShow ? 'block' : 'none';
    });

    // Filter map markers
    markers.forEach(item => {
        const isDeployed = item.data.team_deployed || false;
        let shouldShow = false;
        
        if (filterType === 'all') {
            shouldShow = true;
        } else if (filterType === 'pending') {
            shouldShow = !isDeployed;
        } else if (filterType === 'deployed') {
            shouldShow = isDeployed;
        } else {
            shouldShow = item.type === filterType;
        }
        
        if (shouldShow) {
            item.marker.setMap(map);
        } else {
            item.marker.setMap(null);
        }
    });
}

// ============================================
// FILTER BUTTON HANDLERS
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyFilter(btn.dataset.filter);
        });
    });
});