// backend/server.ts
import { serve } from "https://deno.land/std/http/server.ts";

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

const players = new Map<string, Player>();
const rooms = new Map<string, Room>();

serve((req) => {
  if (req.headers.get("upgrade") !== "websocket") {
    return new Response("WebSocket only", { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  const playerId = crypto.randomUUID();

  const player: Player = {
    id: playerId,
    socket,
    name: `Player_${playerId.slice(0, 6)}`,
    isHost: false,
  };

  players.set(playerId, player);

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: "welcome",
      playerId
    }));
  };

  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    handleMessage(player, msg);
  };

  socket.onclose = () => {
    handleDisconnect(player);
  };

  return response;
});

function handleMessage(player: Player, msg: any) {
  switch (msg.type) {
    case "createRoom": {
      const roomId = crypto.randomUUID();
      const room: Room = {
        id: roomId,
        hostId: player.id,
        players: new Map(),
        calledNumbers: [],
        gameActive: false,
      };

      player.isHost = true;
      player.roomId = roomId;
      room.players.set(player.id, player);
      rooms.set(roomId, room);

      player.socket.send(JSON.stringify({
        type: "roomCreated",
        roomId
      }));
      break;
    }

    case "joinRoom": {
      const room = rooms.get(msg.roomId);
      if (!room) return;

      player.roomId = room.id;
      room.players.set(player.id, player);

      broadcast(room, {
        type: "playerJoined",
        playerId: player.id
      });
      break;
    }

    case "numberCall": {
      const room = rooms.get(player.roomId!);
      if (!room || !player.isHost) return;

      room.calledNumbers.push(msg.number);
      broadcast(room, {
        type: "numberCalled",
        number: msg.number
      });
      break;
    }

    // RTC SIGNALING
    case "offer":
    case "answer":
    case "candidate": {
      const target = players.get(msg.targetPlayerId);
      if (!target) return;

      target.socket.send(JSON.stringify({
        type: msg.type,
        from: player.id,
        data: msg.data
      }));
      break;
    }
  }
}

function broadcast(room: Room, message: any) {
  const data = JSON.stringify(message);
  room.players.forEach(p => p.socket.send(data));
}

function handleDisconnect(player: Player) {
  players.delete(player.id);
  if (!player.roomId) return;

  const room = rooms.get(player.roomId);
  room?.players.delete(player.id);

  if (room && room.players.size === 0) {
    rooms.delete(room.id);
  }
}
