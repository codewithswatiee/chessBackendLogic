import Game from '../models/game.model.js';
import { getLegalMoves as legalMovesBlitz, validateAndApplyMove as validateBlitz } from '../validations/classic/blitz.js';
import { getLegalMoves as legalMovesBullet, validateAndApplyMove as validateBullet} from '../validations/classic/bullet.js';
import { validateAndApplyMove as validateStandard, getLegalMoves as legalMovesStandard } from '../validations/classic/standard.js';
import { getCrazyhouseLegalMoves, validateAndApplyCrazyhouseMove } from '../validations/crazyhouse/crazyhouseStandard.js';
import { getCrazyhouseWithTimerLegalMoves, validateAndApplyCrazyhouseWithTimerMove } from '../validations/crazyhouse/crazyhouseTimer.js';
import { getDecayLegalMoves, validateAndApplyDecayMove } from '../validations/decay.js';
import { getLegalMoves as legalMovesSixPointer, validateAndApplyMove as validateSixPointer, resetSixPointerTimer } from '../validations/sixPointer.js';
import { getSessionById, updateGameState } from './session.controller.js';

// Make a move
export async function makeMove({ sessionId, userId, move, timestamp, variant , subvariant  }) {
  const session = await getSessionById(sessionId);
  console.log("Making move:", move, "for user:", userId, "at timestamp:", timestamp);
  if (!session) return { type: 'game:error', message: 'Session not found' };
  const { gameState } = session;

  console.log("Current game state:", gameState);


  const color = (gameState.players.white.userId === userId) ? 'white' : (gameState.players.black.userId === userId) ? 'black' : null;
  if (!color) return { type: 'game:error', message: 'User not a player in this game' };
  if (gameState.status !== 'active') return { type: 'game:error', message: 'Game is not active' };

  // Initialize arrays/objects if missing
  gameState.moves = gameState.moves || [];
  gameState.positionHistory = gameState.positionHistory || [];
  gameState.metadata = gameState.metadata || {};
  gameState.metadata.drawOffers = gameState.metadata.drawOffers || { white: false, black: false };

  // --- TIMER LOGIC START ---
  const now = timestamp || Date.now();
  const opponentColor = color === 'white' ? 'black' : 'white';

  if (variant !== 'sixpointer') {
    // Generic timer logic for non-sixpointer variants
    if (!gameState.timers) {
      gameState.timers = {
        white: { remaining: 180000, lastUpdateTime: now, isRunning: true },
        black: { remaining: 180000, lastUpdateTime: now, isRunning: false }
      };
    }
    const elapsed = now - (gameState.timers[color].lastUpdateTime || now);
    gameState.timers[color].remaining -= elapsed;
    gameState.timers[color].lastUpdateTime = now;
    gameState.timers[color].isRunning = false;
    gameState.timers[opponentColor].isRunning = true;
    gameState.timers[opponentColor].lastUpdateTime = now;
    // If time runs out
    if (gameState.timers[color].remaining <= 0) {
      gameState.status = 'finished';
      gameState.result = opponentColor;
      gameState.resultReason = 'timeout';
      gameState.winner = opponentColor;
      gameState.endedAt = now;
      await updateGameState(sessionId, gameState);
      return { move: null, gameState };
    }
  } else {
    // --- SIXPOINTER TIMER LOGIC ---
    if (variant === 'sixpointer') {
      if (!gameState.timers) {
        gameState.timers = {
          white: { remaining: 30000, lastUpdateTime: now, isRunning: true },
          black: { remaining: 30000, lastUpdateTime: now, isRunning: false }
        };
      }
      const elapsed = now - (gameState.timers[color].lastUpdateTime || now);
      gameState.timers[color].remaining -= elapsed;

      // If time runs out for the current player
      if (gameState.timers[color].remaining <= 0) {
        // Reduce 1 point from the player who timed out
        if (gameState.board.points) {
          gameState.board.points[color] = Math.max(0, (gameState.board.points[color] || 0) - 1);
        } else {
          // fallback for legacy keys
          const pointsKey = color === 'white' ? 'whitePoints' : 'blackPoints';
          gameState.board[pointsKey] = Math.max(0, (gameState.board[pointsKey] || 0) - 1);
        }

        // Pass the turn to the opponent
        gameState.board.activeColor = opponentColor;

        // Reset both timers
        gameState.timers.white.remaining = 30000;
        gameState.timers.black.remaining = 30000;
        gameState.timers.white.lastUpdateTime = now;
        gameState.timers.black.lastUpdateTime = now;
        gameState.timers.white.isRunning = (opponentColor === 'white');
        gameState.timers.black.isRunning = (opponentColor === 'black');

        // Also reset whiteTime and blackTime for sixpointer
        gameState.board.whiteTime = 30000;
        gameState.board.blackTime = 30000;

        await updateGameState(sessionId, gameState);

        return {
          type: 'game:warning',
          message: `${color} timed out, 1 point deducted and turn passed to ${opponentColor}`,
          move: null,
          gameState
        };
      }

      // Normal timer reset after a valid move (keep your existing logic here)
      // ...
    }
  }
  // --- TIMER LOGIC END ---

  // Validate that the move is one of the possible moves
  const fen = gameState.board.fen;
  console.log("Current FEN:", fen);
  let possibleMoves;
  if (variant === 'classic' && subvariant === 'standard') {
    possibleMoves = legalMovesStandard(fen).filter(m => m.from === move.from);
  } else if (variant === 'classic' && subvariant === 'blitz') {
    possibleMoves = legalMovesBlitz(fen).filter(m => m.from === move.from);
  } else if(variant === 'classic' && subvariant === 'bullet') {
    possibleMoves = legalMovesBullet(fen).filter(m => m.from === move.from);
  } else if(variant === 'sixpointer') {
    possibleMoves = legalMovesSixPointer(fen).filter(m => m.from === move.from);
  } else if(variant === 'decay') {
    possibleMoves = getDecayLegalMoves(fen).filter(m => m.from === move.from); 
  } else if (variant === 'crazyhouse' && subvariant === 'standard') {
    possibleMoves = getCrazyhouseLegalMoves(gameState.board);
  } else if (variant === 'crazyhouse' && subvariant === 'withTimer') {
    possibleMoves = getCrazyhouseWithTimerLegalMoves(gameState.board, timestamp);
  } else {
    return { type: 'game:error', message: 'Invalid variant or subvariant'};
  }
  
  console.log("Moves received:", move);
  console.log("Possible moves for square", move.from, ":", possibleMoves);

  const isMoveLegal = possibleMoves && possibleMoves.some(m => m.from === move.from && m.to === move.to && (!m.promotion || m.promotion === move.promotion));
  if (!isMoveLegal) {
    return { type: 'game:warning', message: 'Move is not legal' };
  }

  // Apply move
  let result;
  if (variant === 'classic' && subvariant === 'standard') {
    result = validateStandard(gameState.board, move, color, timestamp);
  } else if (variant === 'classic' && subvariant === 'blitz') {
    result = validateBlitz(gameState.board, move, color, timestamp);
  } else if(variant === 'classic' && subvariant === 'bullet') {
    result = validateBullet(gameState.board, move, color, timestamp);
  } else if(variant === 'sixpointer') {
    result = validateSixPointer(gameState.board, move, color, timestamp);
  } else if(variant === 'decay') {
    result = validateAndApplyDecayMove(gameState.board, move, color, timestamp);
  } else if (variant === 'crazyhouse' && subvariant === 'standard') {
    result = validateAndApplyCrazyhouseMove(gameState.board, move, color, timestamp);
  } else if (variant === 'crazyhouse' && subvariant === 'withTimer') {
    result = validateAndApplyCrazyhouseWithTimerMove(gameState.board, move, color, timestamp);
  }
  console.log("Move result:", result);
  if (!result.valid) {
    // Instead of returning, attach a warning and return the unchanged game state
    
    return { 
      type: 'game:warning', 
      message: result.reason || 'Invalid move', 
      move: null, 
      gameState // return the current state so the frontend can continue
    };
  }

  // Update game state
  gameState.board = result.state;
  gameState.moves.push(result.move);
  gameState.moveCount = (gameState.moveCount || 0) + 1;
  gameState.lastMove = result.move;
  gameState.positionHistory.push(result.state.fen);
  gameState.gameState = result;

  if(variant === 'sixpointer') {
    resetSixPointerTimer(gameState); // Call BEFORE changing activeColor
    // Also reset whiteTime and blackTime for sixpointer
    gameState.board.whiteTime = 30000;
    gameState.board.blackTime = 30000;
  }

  // Change activeColor to next player
  gameState.board.activeColor = (color === 'white') ? 'black' : 'white';

  // Attach timers to board for frontend
  gameState.board.timers = gameState.timers;

  // Check for game end
  if (result.result && result.result !== 'ongoing') {
    gameState.status = 'finished';
    gameState.result = result.result;
    gameState.resultReason = result.reason || null;
    gameState.winner = result.winner || null;
    gameState.endedAt = Date.now();
    // Persist to MongoDB
    // await Game.findOneAndUpdate(
    //   { sessionId },
    //   {
    //     $set: {
    //       moves: gameState.moves,
    //       state: gameState.board,
    //       winner: gameState.winnerId,
    //       result: gameState.result,
    //       endedAt: gameState.endedAt,
    //     },
    //   },
    //   { upsert: true }
    // );
  } else {
    // Update only moves and state
    // await Game.findOneAndUpdate(
    //   { sessionId },
    //   {
    //     $set: {
    //       moves: gameState.moves,
    //       state: gameState.board,
    //     },
    //   },
    //   { upsert: true }
    // );
    console.log("Game is still active, no end condition met");
  }

  await updateGameState(sessionId, gameState);
  console.log("Game state after move:", gameState);
  return { move: result.move, gameState };
}

// Get possible moves for a piece
export async function getPossibleMoves({ sessionId, square, variant, subvariant }) {
    console.log("Getting possible moves for square:", square);
  const session = await getSessionById(sessionId);
  if (!session) throw new Error('Session not found');
  const { gameState } = session;
  const fen = gameState.board.fen;
  let moves;
  if (variant === 'classic' && subvariant === 'standard') {
    moves = legalMovesStandard(fen).filter(m => m.from === square);
  } else if (variant === 'classic' && subvariant === 'blitz') {
    moves = legalMovesBlitz(fen).filter(m => m.from === square);
  } else if(variant === 'classic' && subvariant === 'bullet') {
    moves = legalMovesBullet(fen).filter(m => m.from === square);
  } else if(variant === 'sixpointer') {
    moves = legalMovesSixPointer(fen).filter(m => m.from === square);
  } else if(variant === 'decay') {
    moves = getDecayLegalMoves(fen).filter(m => m.from === square); //
  } else if (variant === 'crazyhouse' && subvariant === 'standard') {
    moves = getCrazyhouseLegalMoves(gameState.board);
  } else if (variant === 'crazyhouse' && subvariant === 'withTimer') {
    moves = getCrazyhouseWithTimerLegalMoves(gameState.board, timestamp);
  } else {
    throw new Error('Invalid variant or subvariant');
  }
  // const moves = legalMovesStandard(fen).filter(m => m.from === square);
  return moves;
}

// Resign
export async function resign({ sessionId, userId }) {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error('Session not found');
  const { gameState } = session
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
  // await Game.findOneAndUpdate(
  //   { sessionId },
  //   {
  //     $set: {
  //       winner: gameState.winner,
  //       result: gameState.result,
  //       endedAt: gameState.endedAt,
  //     },
  //   },
  //   { upsert: true }
  // );
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
  // await Game.findOneAndUpdate(
  //   { sessionId },
  //   {
  //     $set: {
  //       result: 'draw',
  //       endedAt: gameState.endedAt,
  //     },
  //   },
  //   { upsert: true }
  // );
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
