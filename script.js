// WebSocket URL (Deno backend)
const WS_URL = "wss://ameng-gogs-cat-87.deno.dev/";

// Create WebSocket connection
const socket = new WebSocket(WS_URL);

// Connection opened
socket.onopen = () => {
    console.log("✅ Connected to WebSocket server");
};

// Receive messages
socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log("📩 Message from server:", data);

    // Example: update game state
    if (data.type === "CALL_NUMBER") {
        gameState.currentNumber = data.number;
        gameState.calledNumbers.push(data.number);
    }
};

// Connection closed
socket.onclose = () => {
    console.log("❌ WebSocket connection closed");
};

// Error handling
socket.onerror = (error) => {
    console.error("⚠️ WebSocket error:", error);
};
