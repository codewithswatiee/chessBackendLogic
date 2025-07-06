
import Game from '../models/game.model.js';
import redisClient, { sessionKey, gameStateKey, userSessionKey } from '../config/redis.config.js';
import { validateAndApplyMove, getLegalMoves, checkGameStatus } from '../validations/standard.js';
import { getSessionById, updateGameState } from './session.controller.js';

// Make a move
export async function makeMove({ sessionId, userId, move, timestamp }) {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error('Session not found');
  const { gameState } = session;
  const color = (gameState.players.white.userId === userId) ? 'white' : (gameState.players.black.userId === userId) ? 'black' : null;
  if (!color) throw new Error('User not a player in this game');
  if (gameState.status !== 'active') throw new Error('Game is not active');

  // Validate and apply move
  const result = validateAndApplyMove(gameState.board, move, color, timestamp);
  if (!result.valid) throw new Error(result.reason || 'Invalid move');

  // Update game state
  gameState.board = result.state;
  gameState.moves.push(result.move);
  gameState.moveCount = (gameState.moveCount || 0) + 1;
  gameState.lastMove = result.move;
  gameState.positionHistory.push(result.state.fen);
  gameState.gameState = result;

  // Check for game end
  if (result.result && result.result !== 'ongoing') {
    gameState.status = 'finished';
    gameState.result = result.result;
    gameState.resultReason = result.reason || null;
    gameState.winner = result.winner || null;
    gameState.endedAt = Date.now();
    // Persist to MongoDB
    await Game.findOneAndUpdate(
      { sessionId },
      {
        $set: {
          moves: gameState.moves,
          state: gameState.board,
          winner: gameState.winner,
          result: gameState.result,
          endedAt: gameState.endedAt,
        },
      },
      { upsert: true }
    );
  } else {
    // Update only moves and state
    await Game.findOneAndUpdate(
      { sessionId },
      {
        $set: {
          moves: gameState.moves,
          state: gameState.board,
        },
      },
      { upsert: true }
    );
  }

  await updateGameState(sessionId, gameState);
  return { move: result.move, gameState };
}

// Get possible moves for a piece
export async function getPossibleMoves({ sessionId, square }) {
    console.log("Getting possible moves for square:", square);
  const session = await getSessionById(sessionId);
  if (!session) throw new Error('Session not found');
  const { gameState } = session;
  const fen = gameState.board.fen;
  const moves = getLegalMoves(fen).filter(m => m.from === square);
  return moves;
}

// Resign
export async function resign({ sessionId, userId }) {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error('Session not found');
  const { gameState } = session;
  if (gameState.status !== 'active') throw new Error('Game is not active');
  const color = (gameState.players.white.userId === userId) ? 'white' : (gameState.players.black.userId === userId) ? 'black' : null;
  if (!color) throw new Error('User not a player in this game');
  const winner = color === 'white' ? 'black' : 'white';
  gameState.status = 'finished';
  gameState.result = winner;
  gameState.resultReason = 'resignation';
  gameState.winner = winner;
  gameState.endedAt = Date.now();
  await updateGameState(sessionId, gameState);
  await Game.findOneAndUpdate(
    { sessionId },
    {
      $set: {
        winner: gameState.winner,
        result: gameState.result,
        endedAt: gameState.endedAt,
      },
    },
    { upsert: true }
  );
  return { gameState };
}

// Offer draw
export async function offerDraw({ sessionId, userId }) {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error('Session not found');
  const { gameState } = session;
  if (gameState.status !== 'active') throw new Error('Game is not active');
  const color = (gameState.players.white.userId === userId) ? 'white' : (gameState.players.black.userId === userId) ? 'black' : null;
  if (!color) throw new Error('User not a player in this game');
  gameState.metadata.drawOffers[color] = true;
  await updateGameState(sessionId, gameState);
  return { gameState };
}

// Accept draw
export async function acceptDraw({ sessionId, userId }) {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error('Session not found');
  const { gameState } = session;
  if (gameState.status !== 'active') throw new Error('Game is not active');
  const color = (gameState.players.white.userId === userId) ? 'white' : (gameState.players.black.userId === userId) ? 'black' : null;
  if (!color) throw new Error('User not a player in this game');
  // Only allow if opponent offered draw
  const oppColor = color === 'white' ? 'black' : 'white';
  if (!gameState.metadata.drawOffers[oppColor]) throw new Error('No draw offer from opponent');
  gameState.status = 'finished';
  gameState.result = 'draw';
  gameState.resultReason = 'mutual_agreement';
  gameState.winner = null;
  gameState.endedAt = Date.now();
  await updateGameState(sessionId, gameState);
  await Game.findOneAndUpdate(
    { sessionId },
    {
      $set: {
        result: 'draw',
        endedAt: gameState.endedAt,
      },
    },
    { upsert: true }
  );
  return { gameState };
}

// Decline draw
export async function declineDraw({ sessionId, userId }) {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error('Session not found');
  const { gameState } = session;
  if (gameState.status !== 'active') throw new Error('Game is not active');
  const color = (gameState.players.white.userId === userId) ? 'white' : (gameState.players.black.userId === userId) ? 'black' : null;
  if (!color) throw new Error('User not a player in this game');
  const oppColor = color === 'white' ? 'black' : 'white';
  gameState.metadata.drawOffers[oppColor] = false;
  await updateGameState(sessionId, gameState);
  return { gameState };
}
