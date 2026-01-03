// ================================
// WebSocket Configuration
// ================================
const WS_URL = "wss://ameng-gogs-cat-87.deno.dev/";
let socket = null;
let reconnectTimer = null;

// ================================
// Connect WebSocket
// ================================
function connectWebSocket() {
    socket = new WebSocket(WS_URL);

    // Connection opened
    socket.onopen = () => {
        console.log("✅ Connected to WebSocket server");

        // Example: notify server player joined
        sendWS({
            type: "PLAYER_JOIN",
            time: Date.now()
        });
    };

    // Receive messages
    socket.onmessage = (event) => {
        let data;

        try {
            data = JSON.parse(event.data);
        } catch (err) {
            console.error("⚠️ Invalid JSON from server:", event.data);
            return;
        }

        console.log("📩 Message from server:", data);

        switch (data.type) {

            case "CALL_NUMBER":
                gameState.currentNumber = data.number;
                gameState.calledNumbers.push(data.number);
                updateUI();
                break;

            case "GAME_START":
                gameState.gameActive = true;
                break;

            case "GAME_END":
                gameState.gameActive = false;
                break;

            default:
                console.log("ℹ️ Unknown message type:", data.type);
        }
    };

    // Connection closed
    socket.onclose = () => {
        console.log("❌ WebSocket disconnected. Reconnecting...");
        reconnect();
    };

    // Error handling
    socket.onerror = (error) => {
        console.error("⚠️ WebSocket error:", error);
        socket.close();
    };
}

// ================================
// Send Message Helper
// ================================
function sendWS(data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(data));
    } else {
        console.warn("🚫 WebSocket not connected");
    }
}

// ================================
// Auto Reconnect
// ================================
function reconnect() {
    if (reconnectTimer) return;

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
    }, 3000); // reconnect after 3 seconds
}

// ================================
// UI Update Example
// ================================
function updateUI() {
    console.log("🎯 Current Number:", gameState.currentNumber);
}

// ================================
// Start WebSocket
// ================================
connectWebSocket();
