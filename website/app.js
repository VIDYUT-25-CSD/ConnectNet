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

// ============================================
// GOOGLE MAPS INITIALIZATION
// ============================================
function initMap() {
    // Center on Bengaluru (disaster area - change as needed)
    map = new google.maps.Map(document.getElementById("map"), {
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
            icon: getMarkerIcon(emergencyType)
        });

        // Create info window
        const infoWindow = new google.maps.InfoWindow({
            content: `
                <div style="color: #333; padding: 5px;">
                    <h3 style="margin: 0 0 10px 0; color: #667eea;">Emergency Alert</h3>
                    <p style="margin: 5px 0;"><strong>Message:</strong> ${message.emergency_text}</p>
                    <p style="margin: 5px 0;"><strong>Location:</strong> ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}</p>
                    <p style="margin: 5px 0;"><strong>Time:</strong> ${new Date(message.received_timestamp).toLocaleString()}</p>
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
        
        newCard.innerHTML = `
            <div class="message-text">${message.emergency_text}</div>
            <div class="message-meta">
                <span class="message-badge badge-${emergencyType}">${emergencyType}</span>
                <span>${new Date(message.received_timestamp).toLocaleTimeString()}</span>
            </div>
        `;

        newCard.addEventListener('click', () => {
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

function applyFilter(filterType) {
    currentFilter = filterType;
    
    // Filter sidebar cards
    const cards = document.querySelectorAll('.message-card');
    cards.forEach(card => {
        if (filterType === 'all' || card.dataset.type === filterType) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });

    // Filter map markers
    markers.forEach(item => {
        if (filterType === 'all' || item.type === filterType) {
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