import Game from '../models/game.model.js';
import { getLegalMoves as legalMovesBlitz, validateAndApplyMove as validateBlitz } from '../validations/classic/blitz.js';
import { getLegalMoves as legalMovesBullet, validateAndApplyMove as validateBullet} from '../validations/classic/bullet.js';
import { validateAndApplyMove as validateStandard, getLegalMoves as legalMovesStandard } from '../validations/classic/standard.js';
import { getSessionById, updateGameState } from './session.controller.js';

// Make a move
export async function makeMove({ sessionId, userId, move, timestamp, variant , subvariant  }) {
  const session = await getSessionById(sessionId);
  console.log("Making move:", move, "for user:", userId, "at timestamp:", timestamp);
  if (!session) throw new Error('Session not found');
  const { gameState } = session;

  console.log("Current game state:", gameState);


  const color = (gameState.players.white.userId === userId) ? 'white' : (gameState.players.black.userId === userId) ? 'black' : null;
  if (!color) throw new Error('User not a player in this game');
  if (gameState.status !== 'active') throw new Error('Game is not active');

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
  }
  
  console.log("Moves received:", move);
  console.log("Possible moves for square", move.from, ":", possibleMoves);

  const isMoveLegal = possibleMoves.some(m => m.from === move.from && m.to === move.to && (!m.promotion || m.promotion === move.promotion));
  if (!isMoveLegal) throw new Error('Move is not legal');

  // Apply move
  let result;
  if (variant === 'classic' && subvariant === 'standard') {
    result = validateStandard(gameState.board, move, color, timestamp);
  } else if (variant === 'classic' && subvariant === 'blitz') {
    result = validateBlitz(gameState.board, move, color, timestamp);
  } else if(variant === 'classic' && subvariant === 'bullet') {
    result = validateBullet(gameState.board, move, color, timestamp);
  }
  console.log("Move result:", result);
  if (!result.valid) throw new Error(result.reason || 'Invalid move');

  // Update game state
  gameState.board = result.state;
  gameState.moves.push(result.move);
  gameState.moveCount = (gameState.moveCount || 0) + 1;
  gameState.lastMove = result.move;
  gameState.positionHistory.push(result.state.fen);
  gameState.gameState = result;

  // Change activeColor to next player
  gameState.board.activeColor = (color === 'white') ? 'black' : 'white';

  // Check for game end
  if (result.result && result.result !== 'ongoing') {
    gameState.status = 'finished';
    gameState.result = result.result;
    gameState.resultReason = result.reason || null;
    gameState.winner = result.winnerId || null;
    gameState.endedAt = Date.now();
    // Persist to MongoDB
    await Game.findOneAndUpdate(
      { sessionId },
      {
        $set: {
          moves: gameState.moves,
          state: gameState.board,
          winner: gameState.winnerId,
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
