import { v4 as uuidv4 } from 'uuid';
import redisClient, { 
  sessionKey, 
  userSessionKey, 
  moveListKey, 
  gameStateKey,
  SESSION_TIMEOUT,
  MOVE_TIMEOUT
} from '../config/redis.config.js';
import GameModel from '../models/game.model.js';

/**
 * Create a new game session after matchmaking
 */
export async function createGameSession(whitePlayer, blackPlayer, variant, subvariant = null) {
  const sessionId = uuidv4();
  const now = Date.now();
  const baseTime = 5 * 60 * 1000; // 5 minutes per player (example)
  const sessionData = {
    sessionId,
    variant,
    playerWhite: whitePlayer,
    playerBlack: blackPlayer,
    currentFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    status: 'active',
    createdAt: now,
    lastMoveAt: now,
    turn: 'white',
    timers: JSON.stringify({ white: baseTime, black: baseTime })
  };

  // Store in Redis with expiration
  await redisClient.hSet(sessionKey(sessionId), sessionData);
  await redisClient.expire(sessionKey(sessionId), SESSION_TIMEOUT / 1000);

  // Map users to session
  await redisClient.set(userSessionKey(whitePlayer.userId), sessionId);
  await redisClient.set(userSessionKey(blackPlayer.userId), sessionId);

  return sessionId;
}

/**
 * Validate and process a move
 */
export async function processMove(sessionId, userId, move) {
  const session = await redisClient.hGetAll(sessionKey(sessionId));
  if (!session) throw new Error('Session not found');

  // Validate it's user's turn
  const playerColor = session.playerWhite.userId === userId ? 'white' : 'black';
  if (session.turn !== playerColor) throw new Error('Not your turn');

  // Validate move (add chess logic validation here)
  const isValidMove = validateMove(session.currentFen, move);
  if (!isValidMove) throw new Error('Invalid move');

  const now = Date.now();
  const moveData = {
    ...move,
    color: playerColor,
    timestamp: now
  };

  // Store move in Redis list
  await redisClient.rPush(moveListKey(sessionId), JSON.stringify(moveData));

  // Timer logic
  let timers = { white: 5 * 60 * 1000, black: 5 * 60 * 1000 };
  if (session.timers) {
    try { timers = JSON.parse(session.timers); } catch {}
  }
  const lastMoveAt = parseInt(session.lastMoveAt) || now;
  const elapsed = now - lastMoveAt;
  timers[playerColor] = Math.max(0, timers[playerColor] - elapsed);

  // If timer expired, end game
  if (timers[playerColor] <= 0) {
    await endSession(sessionId, 'timeout');
    throw new Error('Time expired');
  }

  // Update game state
  const newFen = calculateNewFen(session.currentFen, move);
  await redisClient.hSet(sessionKey(sessionId), {
    currentFen: newFen,
    lastMoveAt: now,
    turn: playerColor === 'white' ? 'black' : 'white',
    timers: JSON.stringify(timers)
  });

  // Reset session timeout
  await redisClient.expire(sessionKey(sessionId), SESSION_TIMEOUT / 1000);

  return { newFen, moveData, timers };
}

/**
 * Reconnect user to existing session
 */
export async function reconnectToSession(userId) {
  const sessionId = await redisClient.get(userSessionKey(userId));
  if (!sessionId) return null;

  const session = await redisClient.hGetAll(sessionKey(sessionId));
  if (!session) {
    await redisClient.del(userSessionKey(userId));
    return null;
  }

  // Validate session is still active and not timed out
  if (session.status !== 'active' || 
      Date.now() - parseInt(session.lastMoveAt) > SESSION_TIMEOUT) {
    await endSession(sessionId, 'timeout');
    return null;
  }

  return session;
}

/**
 * End game session and persist to DB
 */
export async function endSession(sessionId, reason = 'completed') {
  const session = await redisClient.hGetAll(sessionKey(sessionId));
  if (!session) return;

  // Get all moves
  const moves = await redisClient.lRange(moveListKey(sessionId), 0, -1);
  const parsedMoves = moves.map(m => JSON.parse(m));

  // Create game record
  const game = new GameModel({
    variant: session.variant,
    players: {
      white: session.playerWhite.userId,
      black: session.playerBlack.userId
    },
    moves: parsedMoves,
    state: {
      board: parseFen(session.currentFen),
      timers: {
        white: 0,
        black: 0
      }
    },
    result: determineResult(session, reason),
    startedAt: new Date(parseInt(session.createdAt)),
    endedAt: new Date()
  });

  await game.save();

  // Cleanup Redis
  await redisClient.del(sessionKey(sessionId));
  await redisClient.del(moveListKey(sessionId));
  await redisClient.del(userSessionKey(session.playerWhite.userId));
  await redisClient.del(userSessionKey(session.playerBlack.userId));
}

// Helper functions to implement
function validateMove(fen, move) {
  // TODO: Implement chess move validation
  return true;
}

function calculateNewFen(currentFen, move) {
  // TODO: Implement FEN position update
  return currentFen;
}

function parseFen(fen) {
  // Simple FEN parser: returns 2D array of board
  if (!fen) return [];
  const [position] = fen.split(' ');
  const rows = position.split('/');
  return rows.map(row => {
    const arr = [];
    for (const char of row) {
      if (!isNaN(char)) {
        for (let i = 0; i < parseInt(char); i++) arr.push('');
      } else {
        arr.push(char);
      }
    }
    return arr;
  });
}

function determineResult(session, reason) {
  // Determine result string for MongoDB
  if (reason === 'timeout') return 'draw';
  if (reason === 'forfeit') return 'forfeit';
  if (reason === 'disconnected') return 'disconnected';
  if (reason === 'completed') {
    // Optionally, check for checkmate/stalemate here
    return session.winnerId ? (session.winnerId === session.playerWhite.userId ? 'white' : 'black') : 'draw';
  }
  return null;
}

// Optionally, add a periodic cleanup for expired sessions
setInterval(async () => {
  // Scan all sessions and end those with expired timers
  // (Implementation depends on how you want to track all session keys)
}, 60 * 1000);
