import Game from '../models/game.model.js';
import { getLegalMoves as legalMovesBlitz, validateAndApplyMove as validateBlitz } from '../validations/classic/blitz.js';
import { getLegalMoves as legalMovesBullet, validateAndApplyMove as validateBullet} from '../validations/classic/bullet.js';
import { validateAndApplyMove as validateStandard, getLegalMoves as legalMovesStandard } from '../validations/classic/standard.js';
// Renamed for clarity in imports if possible, otherwise use original names
import { getCrazyhouseStandardLegalMoves as legalMovesCzyStnd, validateAndApplyCrazyhouseStandardMove as validateCzyStd} from '../validations/crazyhouse/crazyhouseStandard.js';
import { validateAndApplyCrazyhouseMove as validateCzyTimer, getCrazyhouseLegalMoves as legalMovesCzyTimer } from '../validations/crazyhouse/crazyhouseTimer.js';
import { getDecayLegalMoves, validateAndApplyDecayMove } from '../validations/decay.js';
import { getLegalMoves as legalMovesSixPointer, validateAndApplyMove as validateSixPointer, resetSixPointerTimer } from '../validations/sixPointer.js';
import { getSessionById, updateGameState } from './session.controller.js';

// Make a move
export async function makeMove({ sessionId, userId, move, timestamp, variant , subvariant  }) {
  console.log("Making move:", move, "for user:", userId, "at timestamp:", timestamp);

  const session = await getSessionById(sessionId);
  if (!session) return { type: 'game:error', message: 'Session not found' };

  // Ensure gameState exists and is active
  if (!session.gameState || session.gameState.status !== 'active') {
    return { type: 'game:error', message: 'Game is not active or invalid state' };
  }

  let gameState = session.gameState; // Use a mutable copy if desired, but direct modification is fine here as it's saved later

  console.log("Current game state (before move processing):", gameState);

  const color = (gameState.players.white.userId === userId) ? 'white' : (gameState.players.black.userId === userId) ? 'black' : null;
  if (!color) return { type: 'game:error', message: 'User not a player in this game' };

  // Initialize arrays/objects if missing (important for first move)
  gameState.moves = gameState.moves || [];
  gameState.positionHistory = gameState.positionHistory || [];
  gameState.metadata = gameState.metadata || {};
  gameState.metadata.drawOffers = gameState.metadata.drawOffers || { white: false, black: false };

  const now = timestamp || Date.now();

  // --- **CRITICAL CHANGE**: REMOVE GENERIC TIMER LOGIC HERE ---
  // All timer deduction/increment/timeout checking for classic and crazyhouse variants
  // will now be handled *inside* their respective validateAndApplyMove functions.
  // The only exception is SixPointer which has a unique time-out penalty mechanism.

  // If it's sixpointer, handle its unique timer logic *before* calling its validator
  // This logic should handle the point deduction and timer reset for a timeout
  // before the move itself is validated or applied.
  if (variant === 'sixpointer') {
    if (!gameState.board.timers) { // Initialize if not present
      gameState.board.timers = {
        white: { remaining: 30000, lastUpdateTime: now, isRunning: true },
        black: { remaining: 30000, lastUpdateTime: now, isRunning: false }
      };
    }
    // Ensure both times are present for sixpointer
    gameState.board.whiteTime = gameState.board.whiteTime ?? 30000;
    gameState.board.blackTime = gameState.board.blackTime ?? 30000;


    const currentSixPointerPlayerTime = gameState.board.timers[color].remaining;
    const elapsed = now - (gameState.board.timers[color].lastUpdateTime || now);

    // Update remaining time for the current player
    gameState.board.timers[color].remaining = Math.max(0, currentSixPointerPlayerTime - elapsed);
    gameState.board[`${color}Time`] = gameState.board.timers[color].remaining; // Sync board.whiteTime/blackTime

    if (gameState.board.timers[color].remaining <= 0) {
      // Player timed out in SixPointer
      const opponentColor = color === 'white' ? 'black' : 'white';
      const pointsKey = color === 'white' ? 'whitePoints' : 'blackPoints';
      gameState.board.points = gameState.board.points || { white: 0, black: 0 }; // Initialize if not exists
      gameState.board.points[color] = Math.max(0, (gameState.board.points[color] || 0) - 1); // Deduct point

      // Reset timers for both players and pass turn
      gameState.board.timers.white.remaining = 30000;
      gameState.board.timers.black.remaining = 30000;
      gameState.board.timers.white.lastUpdateTime = now;
      gameState.board.timers.black.lastUpdateTime = now;
      gameState.board.timers.white.isRunning = (opponentColor === 'white');
      gameState.board.timers.black.isRunning = (opponentColor === 'black');

      gameState.board.activeColor = opponentColor; // Pass turn
      gameState.board.whiteTime = 30000; // Reset synced times
      gameState.board.blackTime = 30000;

      await updateGameState(sessionId, gameState);
      return {
        type: 'game:warning',
        message: `${color} timed out, 1 point deducted and turn passed to ${opponentColor}`,
        move: null,
        gameState
      };
    }
    // If not timed out, update lastUpdateTime for the current player before passing to validator
    gameState.board.timers[color].lastUpdateTime = now;
  }


  // Determine which validator and legal moves function to use based on variant and subvariant
  let validateFunc;
  let legalMovesFunc;

  if (variant === 'classic') {
    if (subvariant === 'standard') {
      validateFunc = validateStandard;
      legalMovesFunc = legalMovesStandard;
    } else if (subvariant === 'blitz') {
      validateFunc = validateBlitz;
      legalMovesFunc = legalMovesBlitz;
    } else if (subvariant === 'bullet') {
      validateFunc = validateBullet;
      legalMovesFunc = legalMovesBullet;
    }
  } else if (variant === 'crazyhouse') {
    if (subvariant === 'standard') {
      validateFunc = validateCzyStd;
      legalMovesFunc = legalMovesCzyStnd;
    } else if (subvariant === 'withTimer') {
      validateFunc = validateCzyTimer;
      legalMovesFunc = legalMovesCzyTimer;
    }
  } else if (variant === 'sixpointer') {
    validateFunc = validateSixPointer;
    legalMovesFunc = legalMovesSixPointer;
  } else if (variant === 'decay') {
    validateFunc = validateAndApplyDecayMove;
    legalMovesFunc = getDecayLegalMoves;
  }

  if (!validateFunc || !legalMovesFunc) {
    return { type: 'game:error', message: 'Invalid variant or subvariant' };
  }

  // For Crazyhouse variants, you need to pass the pocketedPieces for legal moves
  let possibleMoves;
  if (variant === 'crazyhouse') {
    possibleMoves = legalMovesFunc(gameState.board.fen, gameState.board.pocketedPieces, color);
  } else {
    possibleMoves = legalMovesFunc(gameState.board.fen);
  }

  console.log("Moves received:", move);
  // Filtering legal moves for a specific 'from' square is only relevant for board moves, not drops
  const isMoveLegal = possibleMoves && possibleMoves.some(m =>
    (m.from === move.from && m.to === move.to && (!m.promotion || m.promotion === move.promotion)) ||
    (move.type === 'drop' && m.from === 'pocket' && m.to === move.to && m.piece === move.piece)
  );

  if (!isMoveLegal) {
    return { type: 'game:warning', message: 'Move is not legal' };
  }

  // Apply move using the variant-specific validator
  // Pass the current gameState.board (which contains FEN, pocketedPieces, timers, etc.)
  // and the timestamp for accurate timer calculations within the validator.
  const result = validateFunc(gameState.board, move, color, now);
  console.log("Move validation result from variant validator:", result);

  if (!result.valid) {
    return {
      type: 'game:warning',
      message: result.reason || 'Invalid move',
      move: null,
      gameState // return the current state so the frontend can continue
    };
  }

  // Update game state using the *entire* state object returned by the validator
  // This ensures that all changes (FEN, timers, activeColor, pocketedPieces, gameEnded status)
  // are consistently applied.
  gameState.board = result.state; // This is the fully updated board state from the validator
  gameState.moves.push(result.move);
  gameState.moveCount = (gameState.moveCount || 0) + 1;
  gameState.lastMove = result.move;
  gameState.positionHistory.push(result.state.fen);
  gameState.gameState = result; // Store the validation result itself if useful for frontend

  // **IMPORTANT:**
  // The `result.state` from the `validateAndApply...Move` functions
  // should already contain the updated `activeColor`, `whiteTime`, `blackTime`,
  // and for Crazyhouse `pocketedPieces`, and `dropTimers` (if withTimer).
  // So, remove manual updates to these here:
  // gameState.board.activeColor = (color === 'white') ? 'black' : 'white'; // REMOVE THIS LINE
  // gameState.board.timers = gameState.timers; // This mapping should ideally happen when storing the state

  // For SixPointer, the specific timer reset logic after a valid move needs to be handled here
  // (as it affects both players' times based on the custom rule).
  // Note: the `validateSixPointer` already adds increment, this is for the *reset* after a move.
  if (variant === 'sixpointer') {
    resetSixPointerTimer(gameState); // This function should reset both timers to 30s.
    // Sync the board's time properties with the timers
    gameState.board.whiteTime = gameState.board.timers.white.remaining;
    gameState.board.blackTime = gameState.board.timers.black.remaining;
  }


  // Check for game end. The `result` object from the validator should contain this.
  if (result.gameEnded) { // Assuming result.gameEnded is a boolean
    gameState.status = 'finished';
    gameState.result = result.result; // e.g., 'checkmate', 'timeout', 'draw'
    gameState.resultReason = result.endReason || null; // e.g., 'checkmate', 'white ran out of time'
    gameState.winner = result.winnerColor || null; // 'white' or 'black'
    gameState.endedAt = result.endTimestamp || now;
  } else {
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

  let legalMovesFunc;
  if (variant === 'classic') {
    if (subvariant === 'standard') {
      legalMovesFunc = legalMovesStandard;
    } else if (subvariant === 'blitz') {
      legalMovesFunc = legalMovesBlitz;
    } else if (subvariant === 'bullet') {
      legalMovesFunc = legalMovesBullet;
    }
  } else if (variant === 'crazyhouse') {
    if (subvariant === 'standard') {
      legalMovesFunc = legalMovesCzyStnd;
    } else if (subvariant === 'withTimer') {
      legalMovesFunc = legalMovesCzyTimer;
    }
  } else if (variant === 'sixpointer') {
    legalMovesFunc = legalMovesSixPointer;
  } else if (variant === 'decay') {
    legalMovesFunc = getDecayLegalMoves;
  }

  if (!legalMovesFunc) {
    throw new Error('Invalid variant or subvariant');
  }

  let moves;
  if (variant === 'crazyhouse') {
    // For Crazyhouse, pass pocketedPieces and playerColor
    const playerColor = (gameState.board.activeColor === 'w') ? 'white' : 'black'; // Or derive from `gameState.players`
    moves = legalMovesFunc(fen, gameState.board.pocketedPieces, playerColor);
    // If `square` is 'pocket', return all drop moves for the current player
    if (square === 'pocket') {
      return moves.filter(m => m.from === 'pocket');
    }
    // Otherwise, filter by the specific square for board moves
    return moves.filter(m => m.from === square);
  } else {
    // For classic variants, just filter by 'from' square
    moves = legalMovesFunc(fen).filter(m => m.from === square);
  }
  return moves;
}

// Resign (No changes needed, as it's a global game action)
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
  return { gameState };
}

// Offer draw (No changes needed)
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

// Accept draw (No changes needed)
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
  return { gameState };
}

// Decline draw (No changes needed)
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