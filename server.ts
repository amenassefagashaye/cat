// backend/server.ts
import { serve } from "https://deno.land/std/http/server.ts";

// ================================
// Interfaces
// ================================
interface Player {
  id: string;
  socket: WebSocket;
  roomId?: string;
  name: string;
  isHost: boolean;
}

interface Room {
  id: string;
  hostId: string;
  players: Map<string, Player>;
  calledNumbers: number[];
  gameActive: boolean;
}

// ================================
// Data Storage
// ================================
const players = new Map<string, Player>();
const rooms = new Map<string, Room>();

// ================================
// Serve WebSocket
// ================================
serve((req) => {

  if (req.headers.get("upgrade") !== "websocket") {
    return new Response("WebSocket only", { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  // Generate a new player ID
  const playerId = crypto.randomUUID();
  const player: Player = {
    id: playerId,
    socket,
    name: `Player_${playerId.slice(0, 6)}`,
    isHost: false,
  };

  players.set(playerId, player);

  // ================================
  // WebSocket Events
  // ================================
  socket.onopen = () => {
    console.log(`✅ Player connected: ${player.name}`);
    // Send welcome message with playerId
    socket.send(JSON.stringify({
      type: "welcome",
      playerId,
      name: player.name,
    }));
  };

  socket.onmessage = (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (err) {
      console.error("⚠️ Invalid JSON:", event.data);
      return;
    }

    console.log("📩 Message from player:", player.name, data);

    // Handle message types
    switch (data.type) {
      case "JOIN_ROOM":
        handleJoinRoom(player, data.roomId);
        break;

      case "CALL_NUMBER":
        handleCallNumber(player, data.number);
        break;

      default:
        console.warn("ℹ️ Unknown message type:", data.type);
    }
  };

  socket.onclose = () => {
    console.log(`❌ Player disconnected: ${player.name}`);
    // Remove from players Map
    players.delete(playerId);
    // Remove from room if any
    if (player.roomId) {
      const room = rooms.get(player.roomId);
      if (room) {
        room.players.delete(playerId);
        broadcastRoom(room, {
          type: "PLAYER_LEFT",
          playerId,
        });
      }
    }
  };

  socket.onerror = (err) => {
    console.error("⚠️ WebSocket error:", err);
    socket.close();
  };

  return response;
});

// ================================
// Helper Functions
// ================================

// Join or create room
function handleJoinRoom(player: Player, roomId?: string) {
  let room: Room;

  if (roomId && rooms.has(roomId)) {
    room = rooms.get(roomId)!;
  } else {
    const newRoomId = crypto.randomUUID();
    room = {
      id: newRoomId,
      hostId: player.id,
      players: new Map(),
      calledNumbers: [],
      gameActive: false,
    };
    rooms.set(newRoomId, room);
    player.isHost = true;
  }

  player.roomId = room.id;
  room.players.set(player.id, player);

  // Notify all in room
  broadcastRoom(room, {
    type: "ROOM_UPDATE",
    roomId: room.id,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
    })),
  });
}

// Call number in room
function handleCallNumber(player: Player, number: number) {
  if (!player.roomId) return;
  const room = rooms.get(player.roomId);
  if (!room) return;

  room.calledNumbers.push(number);

  broadcastRoom(room, {
    type: "CALL_NUMBER",
    number,
    calledNumbers: room.calledNumbers,
  });
}

// Broadcast message to all players in a room
function broadcastRoom(room: Room, message: any) {
  const json = JSON.stringify(message);
  for (const p of room.players.values()) {
    if (p.socket.readyState === WebSocket.OPEN) {
      p.socket.send(json);
    }
  }
}
