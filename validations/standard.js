import { Chess } from 'chess.js';


// Create initial state for a 10-minute game
export function createInitialState() {
  const game = new Chess(); // default position

  const fen = game.fen();
  const [position, activeColor, castlingRights, enPassantSquare, halfmoveClock, fullmoveNumber] = fen.split(' ');

  return {
    fen,
    position,
    activeColor: activeColor === 'w' ? 'white' : 'black',
    castlingRights,
    enPassantSquare,
    halfmoveClock: parseInt(halfmoveClock),
    fullmoveNumber: parseInt(fullmoveNumber),
  };
}

// Validate a move
export function validateAndApplyMove(state, move, playerColor, currentTimestamp) {
  const game = new Chess(state.game.fen());

  // Timer handling
  const elapsed = currentTimestamp - state.turnStartTimestamp;
  if (game.turn() === 'w') {
    state.whiteTime -= elapsed;
    if (state.whiteTime <= 0) return { valid: false, reason: 'Time out', result: 'black wins' };
  } else {
    state.blackTime -= elapsed;
    if (state.blackTime <= 0) return { valid: false, reason: 'Time out', result: 'white wins' };
  }

  // Try move
  const result = game.move(move);
  if (!result) return { valid: false, reason: 'Illegal move' };

  // Update state
  state.game = game;
  state.turnStartTimestamp = currentTimestamp;
  state.moveHistory.push(result);
  updateRepetitionMap(state);

  const resultStatus = checkGameStatus(state);

  return {
    valid: true,
    move: result,
    state,
    ...resultStatus,
  };
}

// Generate all possible legal moves
export function getLegalMoves(fen) {
  const game = new Chess(fen);
  return game.moves({ verbose: true });
}

// Draw detection & game status
export function checkGameStatus(state) {
  const game = state.game;

  if (game.in_checkmate()) return { result: 'checkmate', winner: game.turn() === 'w' ? 'black' : 'white' };
  if (game.in_stalemate()) return { result: 'draw', reason: 'stalemate' };
  if (game.insufficient_material()) return { result: 'draw', reason: 'insufficient material' };
  if (game.in_threefold_repetition()) return { result: 'draw', reason: 'threefold repetition' };
  if (game.in_draw()) return { result: 'draw', reason: '50-move rule' };

  // Manual check for 5x / 75x repetition
  const repetitionCount = state.repetitionMap.get(game.fen()) || 0;
  if (repetitionCount >= 5) return { result: 'draw', reason: 'fivefold repetition' };
  if (state.moveHistory.length >= 150) return { result: 'draw', reason: '75-move rule' };

  return { result: 'ongoing' };
}

// Helper: track FEN repetitions for 5-fold and 75-move rule
export function updateRepetitionMap(state) {
  const fen = state.game.fen();
  const current = state.repetitionMap.get(fen) || 0;
  state.repetitionMap.set(fen, current + 1);
}
