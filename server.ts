import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

interface Player {
    id: string;
    ws: WebSocket;
    name: string;
    phone: string;
    stake: number;
    board: string;
    payment: number;
    roomId?: string;
    peerId?: string;
    isHost: boolean;
    connected: boolean;
}

interface Room {
    id: string;
    name: string;
    hostId: string;
    players: Map<string, Player>;
    gameType: string;
    gameActive: boolean;
    calledNumbers: number[];
    maxPlayers: number;
    createdAt: Date;
}

interface Message {
    type: string;
    [key: string]: any;
}

class BingoServer {
    private wss: WebSocketServer;
    private rooms: Map<string, Room> = new Map();
    private players: Map<string, Player> = new Map();
    private server: any;

    constructor(port: number = 3000) {
        const app = express();
        app.use(cors());
        app.use(express.json());
        app.use(express.static('../frontend'));

        this.server = createServer(app);
        this.wss = new WebSocketServer({ server: this.server });

        this.setupWebSocket();
        this.setupRoutes(app);

        this.server.listen(port, () => {
            console.log(`Server running on port ${port}`);
            console.log(`WebSocket server ready`);
        });
    }

    private setupWebSocket(): void {
        this.wss.on('connection', (ws: WebSocket) => {
            const playerId = uuidv4();
            console.log(`New player connected: ${playerId}`);

            // Add to players map
            const player: Player = {
                id: playerId,
                ws,
                name: '',
                phone: '',
                stake: 0,
                board: '',
                payment: 0,
                isHost: false,
                connected: true
            };
            this.players.set(playerId, player);

            ws.on('message', (data: Buffer) => {
                try {
                    const message: Message = JSON.parse(data.toString());
                    this.handleMessage(playerId, message);
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            });

            ws.on('close', () => {
                console.log(`Player disconnected: ${playerId}`);
                this.handleDisconnect(playerId);
            });

            ws.on('error', (error) => {
                console.error(`WebSocket error for player ${playerId}:`, error);
            });

            // Send welcome message
            ws.send(JSON.stringify({
                type: 'welcome',
                playerId,
                serverTime: new Date().toISOString()
            }));
        });
    }

    private setupRoutes(app: express.Application): void {
        // Health check
        app.get('/health', (req, res) => {
            res.json({
                status: 'ok',
                players: this.players.size,
                rooms: this.rooms.size,
                timestamp: new Date().toISOString()
            });
        });

        // Get server stats
        app.get('/stats', (req, res) => {
            const stats = {
                totalPlayers: this.players.size,
                totalRooms: this.rooms.size,
                activeRooms: Array.from(this.rooms.values()).filter(room => room.players.size > 0).length,
                activePlayers: Array.from(this.players.values()).filter(p => p.connected).length,
                rooms: Array.from(this.rooms.values()).map(room => ({
                    id: room.id,
                    name: room.name,
                    players: room.players.size,
                    gameType: room.gameType,
                    gameActive: room.gameActive,
                    host: room.hostId
                }))
            };
            res.json(stats);
        });

        // Create room
        app.post('/room/create', (req, res) => {
            const { playerId, roomName, gameType } = req.body;
            
            if (!playerId || !roomName || !gameType) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const player = this.players.get(playerId);
            if (!player) {
                return res.status(404).json({ error: 'Player not found' });
            }

            const roomId = uuidv4();
            const room: Room = {
                id: roomId,
                name: roomName,
                hostId: playerId,
                players: new Map(),
                gameType,
                gameActive: false,
                calledNumbers: [],
                maxPlayers: 100,
                createdAt: new Date()
            };

            // Add host to room
            room.players.set(playerId, player);
            player.roomId = roomId;
            player.isHost = true;
            this.rooms.set(roomId, room);

            res.json({
                roomId,
                roomName,
                gameType,
                host: player.name,
                createdAt: room.createdAt
            });

            console.log(`Room created: ${roomId} by ${player.name}`);
        });

        // Join room
        app.post('/room/join', (req, res) => {
            const { playerId, roomId } = req.body;
            
            if (!playerId || !roomId) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const player = this.players.get(playerId);
            const room = this.rooms.get(roomId);

            if (!player) {
                return res.status(404).json({ error: 'Player not found' });
            }

            if (!room) {
                return res.status(404).json({ error: 'Room not found' });
            }

            if (room.players.size >= room.maxPlayers) {
                return res.status(400).json({ error: 'Room is full' });
            }

            // Add player to room
            room.players.set(playerId, player);
            player.roomId = roomId;

            // Notify all players in room
            this.broadcastToRoom(roomId, {
                type: 'playerJoined',
                player: {
                    id: player.id,
                    name: player.name,
                    phone: player.phone
                },
                count: room.players.size
            }, playerId);

            res.json({
                roomId,
                roomName: room.name,
                gameType: room.gameType,
                hostId: room.hostId,
                playerCount: room.players.size,
                calledNumbers: room.calledNumbers
            });

            console.log(`Player ${player.name} joined room ${roomId}`);
        });

        // Leave room
        app.post('/room/leave', (req, res) => {
            const { playerId, roomId } = req.body;
            
            if (!playerId || !roomId) {
                return res.status(400).json({ error: 'Missing required fields' });
            }

            const player = this.players.get(playerId);
            const room = this.rooms.get(roomId);

            if (!player || !room) {
                return res.status(404).json({ error: 'Player or room not found' });
            }

            // Remove player from room
            room.players.delete(playerId);
            player.roomId = undefined;

            // If room is empty, delete it
            if (room.players.size === 0) {
                this.rooms.delete(roomId);
                console.log(`Room ${roomId} deleted (empty)`);
            } else {
                // If host left, assign new host
                if (room.hostId === playerId) {
                    const newHost = room.players.values().next().value;
                    if (newHost) {
                        room.hostId = newHost.id;
                        newHost.isHost = true;
                        
                        this.broadcastToRoom(roomId, {
                            type: 'newHost',
                            hostId: newHost.id,
                            hostName: newHost.name
                        });
                    }
                }

                // Notify remaining players
                this.broadcastToRoom(roomId, {
                    type: 'playerLeft',
                    playerId,
                    count: room.players.size
                });
            }

            res.json({ success: true });
            console.log(`Player ${player.name} left room ${roomId}`);
        });

        // Get room info
        app.get('/room/:roomId', (req, res) => {
            const room = this.rooms.get(req.params.roomId);
            
            if (!room) {
                return res.status(404).json({ error: 'Room not found' });
            }

            const players = Array.from(room.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                phone: p.phone,
                stake: p.stake,
                isHost: p.isHost,
                connected: p.connected
            }));

            res.json({
                id: room.id,
                name: room.name,
                gameType: room.gameType,
                gameActive: room.gameActive,
                hostId: room.hostId,
                players,
                calledNumbers: room.calledNumbers,
                createdAt: room.createdAt
            });
        });
    }

    private handleMessage(playerId: string, message: Message): void {
        const player = this.players.get(playerId);
        if (!player) return;

        try {
            switch (message.type) {
                case 'join':
                    this.handleJoin(player, message);
                    break;
                case 'register':
                    this.handleRegister(player, message);
                    break;
                case 'numberCall':
                    this.handleNumberCall(player, message);
                    break;
                case 'win':
                    this.handleWin(player, message);
                    break;
                case 'offer':
                    this.handleRTCRequest(player, 'offer', message);
                    break;
                case 'answer':
                    this.handleRTCRequest(player, 'answer', message);
                    break;
                case 'candidate':
                    this.handleRTCRequest(player, 'candidate', message);
                    break;
                case 'createRoom':
                    this.handleCreateRoom(player, message);
                    break;
                case 'joinRoom':
                    this.handleJoinRoom(player, message);
                    break;
                case 'leaveRoom':
                    this.handleLeaveRoom(player, message);
                    break;
                case 'startGame':
                    this.handleStartGame(player, message);
                    break;
                case 'stopGame':
                    this.handleStopGame(player, message);
                    break;
                case 'chat':
                    this.handleChat(player, message);
                    break;
                default:
                    console.warn(`Unknown message type: ${message.type}`);
            }
        } catch (error) {
            console.error(`Error handling message from ${playerId}:`, error);
            player.ws.send(JSON.stringify({
                type: 'error',
                message: 'Failed to process message'
            }));
        }
    }

    private handleJoin(player: Player, message: Message): void {
        player.name = message.name || `Player_${player.id.substring(0, 8)}`;
        player.phone = message.phone || '';
        
        console.log(`Player joined: ${player.name} (${player.id})`);
        
        // Send current server state
        player.ws.send(JSON.stringify({
            type: 'gameState',
            state: {
                totalPlayers: this.players.size,
                activeRooms: this.rooms.size
            }
        }));
    }

    private handleRegister(player: Player, message: Message): void {
        const { player: playerData } = message;
        
        if (playerData) {
            player.name = playerData.name || player.name;
            player.phone = playerData.phone || player.phone;
            player.stake = playerData.stake || 25;
            player.board = playerData.board || '1';
            player.payment = playerData.payment || 25;
            
            console.log(`Player registered: ${player.name}, Stake: ${player.stake}, Payment: ${player.payment}`);
            
            // Broadcast new player to all connected clients
            this.broadcastToAll({
                type: 'playerJoined',
                player: {
                    id: player.id,
                    name: player.name,
                    phone: player.phone
                },
                count: this.players.size
            }, player.id);
        }
    }

    private handleNumberCall(player: Player, message: Message): void {
        const { number, display } = message;
        
        if (!player.roomId) return;

        const room = this.rooms.get(player.roomId);
        if (!room) return;

        // Only host can call numbers
        if (!player.isHost) {
            player.ws.send(JSON.stringify({
                type: 'error',
                message: 'Only host can call numbers'
            }));
            return;
        }

        // Add number to room's called numbers
        if (!room.calledNumbers.includes(number)) {
            room.calledNumbers.push(number);
        }

        // Broadcast to all players in room
        this.broadcastToRoom(room.id, {
            type: 'numberCalled',
            number,
            display,
            caller: player.name,
            timestamp: new Date().toISOString()
        }, player.id);

        console.log(`Number called in room ${room.id}: ${display} by ${player.name}`);
    }

    private handleWin(player: Player, message: Message): void {
        const { player: playerName, pattern, amount } = message;
        
        if (!player.roomId) return;

        const room = this.rooms.get(player.roomId);
        if (!room) return;

        // Broadcast win to all players in room
        this.broadcastToRoom(room.id, {
            type: 'playerWon',
            player: playerName,
            pattern,
            amount,
            timestamp: new Date().toISOString(),
            calledNumbers: room.calledNumbers.length
        }, player.id);

        console.log(`Player ${playerName} won in room ${room.id}: ${pattern} - ${amount} BIRR`);
    }

    private handleRTCRequest(player: Player, type: string, message: Message): void {
        const { targetPlayerId, ...data } = message;
        
        if (!targetPlayerId) {
            player.ws.send(JSON.stringify({
                type: 'error',
                message: 'Target player ID required'
            }));
            return;
        }

        const targetPlayer = this.players.get(targetPlayerId);
        if (!targetPlayer || !targetPlayer.connected) {
            player.ws.send(JSON.stringify({
                type: 'error',
                message: 'Target player not found or disconnected'
            }));
            return;
        }

        // Forward RTC signaling data
        targetPlayer.ws.send(JSON.stringify({
            type,
            fromPlayerId: player.id,
            ...data
        }));

        console.log(`RTC ${type} forwarded from ${player.id} to ${targetPlayerId}`);
    }

    private handleCreateRoom(player: Player, message: Message): void {
        const { roomName, gameType, maxPlayers = 100 } = message;
        
        if (!roomName || !gameType) {
            player.ws.send(JSON.stringify({
                type: 'error',
                message: 'Room name and game type required'
            }));
            return;
        }

        const roomId = uuidv4();
        const room: Room = {
            id: roomId,
            name: roomName,
            hostId: player.id,
            players: new Map(),
            gameType,
            gameActive: false,
            calledNumbers: [],
            maxPlayers,
            createdAt: new Date()
        };

        // Add host to room
        room.players.set(player.id, player);
        player.roomId = roomId;
        player.isHost = true;
        this.rooms.set(roomId, room);

        player.ws.send(JSON.stringify({
            type: 'roomCreated',
            roomId,
            roomName,
            gameType,
            maxPlayers,
            createdAt: room.createdAt
        }));

        console.log(`Room created by ${player.name}: ${roomName} (${roomId})`);
    }

    private handleJoinRoom(player: Player, message: Message): void {
        const { roomId } = message;
        
        if (!roomId) {
            player.ws.send(JSON.stringify({
                type: 'error',
                message: 'Room ID required'
            }));
            return;
        }

        const room = this.rooms.get(roomId);
        if (!room) {
            player.ws.send(JSON.stringify({
                type: 'error',
                message: 'Room not found'
            }));
            return;
        }

        if (room.players.size >= room.maxPlayers) {
            player.ws.send(JSON.stringify({
                type: 'error',
                message: 'Room is full'
            }));
            return;
        }

        // Leave current room if any
        if (player.roomId && player.roomId !== roomId) {
            this.handleLeaveRoom(player, { type: 'leaveRoom', roomId: player.roomId });
        }

        // Add player to room
        room.players.set(player.id, player);
        player.roomId = roomId;
        player.isHost = false;

        // Send room info to player
        player.ws.send(JSON.stringify({
            type: 'roomJoined',
            roomId,
            roomName: room.name,
            gameType: room.gameType,
            hostId: room.hostId,
            playerCount: room.players.size,
            calledNumbers: room.calledNumbers,
            gameActive: room.gameActive
        }));

        // Notify other players
        this.broadcastToRoom(roomId, {
            type: 'playerJoinedRoom',
            player: {
                id: player.id,
                name: player.name,
                phone: player.phone
            },
            playerCount: room.players.size
        }, player.id);

        console.log(`Player ${player.name} joined room ${room.name} (${roomId})`);
    }

    private handleLeaveRoom(player: Player, message: Message): void {
        const { roomId } = message;
        
        if (!roomId) return;

        const room = this.rooms.get(roomId);
        if (!room) return;

        // Remove player from room
        room.players.delete(player.id);
        player.roomId = undefined;
        player.isHost = false;

        // If room is empty, delete it
        if (room.players.size === 0) {
            this.rooms.delete(roomId);
            console.log(`Room ${roomId} deleted (empty)`);
        } else {
            // If host left, assign new host
            if (room.hostId === player.id) {
                const newHost = room.players.values().next().value;
                if (newHost) {
                    room.hostId = newHost.id;
                    newHost.isHost = true;
                    
                    this.broadcastToRoom(roomId, {
                        type: 'newHost',
                        hostId: newHost.id,
                        hostName: newHost.name
                    });
                }
            }

            // Notify remaining players
            this.broadcastToRoom(roomId, {
                type: 'playerLeftRoom',
                playerId: player.id,
                playerCount: room.players.size
            });
        }

        console.log(`Player ${player.name} left room ${roomId}`);
    }

    private handleStartGame(player: Player, message: Message): void {
        if (!player.roomId) return;

        const room = this.rooms.get(player.roomId);
        if (!room) return;

        // Only host can start game
        if (!player.isHost) {
            player.ws.send(JSON.stringify({
                type: 'error',
                message: 'Only host can start the game'
            }));
            return;
        }

        room.gameActive = true;
        room.calledNumbers = []; // Reset called numbers

        this.broadcastToRoom(room.id, {
            type: 'gameStarted',
            host: player.name,
            gameType: room.gameType,
            timestamp: new Date().toISOString()
        });

        console.log(`Game started in room ${room.id} by ${player.name}`);
    }

    private handleStopGame(player: Player, message: Message): void {
        if (!player.roomId) return;

        const room = this.rooms.get(player.roomId);
        if (!room) return;

        // Only host can stop game
        if (!player.isHost) {
            player.ws.send(JSON.stringify({
                type: 'error',
                message: 'Only host can stop the game'
            }));
            return;
        }

        room.gameActive = false;

        this.broadcastToRoom(room.id, {
            type: 'gameStopped',
            host: player.name,
            timestamp: new Date().toISOString(),
            totalNumbersCalled: room.calledNumbers.length
        });

        console.log(`Game stopped in room ${room.id} by ${player.name}`);
    }

    private handleChat(player: Player, message: Message): void {
        const { text, roomId } = message;
        
        if (!text) return;

        if (roomId) {
            // Room chat
            this.broadcastToRoom(roomId, {
                type: 'chatMessage',
                from: player.name,
                text,
                timestamp: new Date().toISOString()
            }, player.id);
        } else {
            // Global chat
            this.broadcastToAll({
                type: 'globalChat',
                from: player.name,
                text,
                timestamp: new Date().toISOString()
            }, player.id);
        }
    }

    private handleDisconnect(playerId: string): void {
        const player = this.players.get(playerId);
        if (!player) return;

        player.connected = false;

        // Remove from room
        if (player.roomId) {
            this.handleLeaveRoom(player, { type: 'leaveRoom', roomId: player.roomId });
        }

        // Remove from players list after delay
        setTimeout(() => {
            if (this.players.has(playerId) && !this.players.get(playerId)?.connected) {
                this.players.delete(playerId);
                console.log(`Player ${playerId} removed from server`);
            }
        }, 30000); // 30 seconds delay
    }

    private broadcastToRoom(roomId: string, message: Message, excludePlayerId?: string): void {
        const room = this.rooms.get(roomId);
        if (!room) return;

        const messageStr = JSON.stringify(message);
        
        room.players.forEach((player, playerId) => {
            if (playerId !== excludePlayerId && player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(messageStr);
            }
        });
    }

    private broadcastToAll(message: Message, excludePlayerId?: string): void {
        const messageStr = JSON.stringify(message);
        
        this.players.forEach((player, playerId) => {
            if (playerId !== excludePlayerId && player.connected && player.ws.readyState === WebSocket.OPEN) {
                player.ws.send(messageStr);
            }
        });
    }

    // Cleanup empty rooms periodically
    private cleanupRooms(): void {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        for (const [roomId, room] of this.rooms.entries()) {
            if (room.players.size === 0 && room.createdAt < oneHourAgo) {
                this.rooms.delete(roomId);
                console.log(`Cleaned up empty room: ${roomId}`);
            }
        }
    }
}

// Start server
const PORT = parseInt(process.env.PORT || '3000');
new BingoServer(PORT);

// Periodic cleanup
setInterval(() => {
    const server = new BingoServer(PORT);
    (server as any).cleanupRooms?.();
}, 30 * 60 * 1000); // Every 30 minutes