// Helper: Recursively convert BigInt values to Number for JSON serialization
export function convertBigIntToNumber(obj) {
  if (typeof obj === 'bigint') {
    return Number(obj);
  } else if (Array.isArray(obj)) {
    return obj.map(convertBigIntToNumber);
  } else if (obj && typeof obj === 'object') {
    const newObj = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        newObj[key] = convertBigIntToNumber(obj[key]);
      }
    }
    return newObj;
  }
  return obj;
}
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
    whiteTime: 600000, // 10 minutes ms
    blackTime: 600000,
    turnStartTimestamp: Date.now(),
    moveHistory: [],
  };
}

// Validate a move
export function validateAndApplyMove(state, move, playerColor, currentTimestamp) {
  console.log("Validating move:", move, "for player:", playerColor, "board state:", state);
  // Always reconstruct game from FEN to avoid corrupted Chess.js instances after deserialization
  let game;
  if (state.fen) {
    game = new Chess(state.fen);
    state.game = game;
  } else {
    throw new Error('Invalid state: missing game and fen');
  }

  // Timer handling
  if (typeof state.turnStartTimestamp !== 'number') state.turnStartTimestamp = currentTimestamp;
  if (typeof state.whiteTime !== 'number') state.whiteTime = 600000;
  if (typeof state.blackTime !== 'number') state.blackTime = 600000;
  if (!state.moveHistory) state.moveHistory = [];
  if (!state.repetitionMap) state.repetitionMap = new Map();

  const elapsed = currentTimestamp - state.turnStartTimestamp;
  console.log("Elapsed time since last turn:", elapsed, "ms");
  console.log("Current turn:", game.turn(), "White time:", state.whiteTime, "Black time:", state.blackTime);
  if (game.turn() === 'w') {
    state.whiteTime -= elapsed;
    if (state.whiteTime <= 0) return { valid: false, reason: 'Time out', result: 'black wins' };
  } else {
    state.blackTime -= elapsed;
    if (state.blackTime <= 0) return { valid: false, reason: 'Time out', result: 'white wins' };
  }

  // Try move
  const result = game.move(move);
  console.log("Move result:", result);
  if (!result) return { valid: false, reason: 'Illegal move' };

  // Update state (do NOT persist the Chess instance)
  state.fen = game.fen();
  state.turnStartTimestamp = currentTimestamp;
  state.moveHistory.push(result);
  // Pass the Chess instance to updateRepetitionMap as argument, not in state
  updateRepetitionMap(state, game);
  console.log("Move history updated:", state.moveHistory);

  const resultStatus = checkGameStatus(state, game);
  console.log("Game status after move:", resultStatus);

  // Remove any accidental Chess instance before returning state
  if (state.game) delete state.game;

  // Add detailed game state info for frontend
  state.gameState = {
    check: game.inCheck ? game.inCheck() : false,
    checkmate: game.isCheckmate(),
    stalemate: game.isStalemate(),
    insufficientMaterial: game.isInsufficientMaterial(),
    threefoldRepetition: game.isThreefoldRepetition(),
    fiftyMoveRule: game.isDraw(),
    canCastleKingside: {
      white: game.castling && game.castling['w'] && game.castling['w'].k,
      black: game.castling && game.castling['b'] && game.castling['b'].k
    },
    canCastleQueenside: {
      white: game.castling && game.castling['w'] && game.castling['w'].q,
      black: game.castling && game.castling['b'] && game.castling['b'].q
    },
    promotionAvailable: result && result.flags && result.flags.includes('p'),
    lastMove: result,
    result: resultStatus.result,
    winner: resultStatus.winner || null,
    drawReason: resultStatus.reason || null
  };

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
export function checkGameStatus(state, gameInstance) {
  // Always reconstruct game from FEN if not provided
  let game = gameInstance;
  if (!game) {
    if (!state.fen) throw new Error('Invalid state: missing FEN');
    game = new Chess(state.fen);
  }


  if (game.isCheckmate()) return { result: 'checkmate', winner: game.turn() === 'w' ? 'black' : 'white' };
  if (game.isStalemate()) return { result: 'draw', reason: 'stalemate' };
  if (game.isInsufficientMaterial()) return { result: 'draw', reason: 'insufficient material' };
  if (game.isThreefoldRepetition()) return { result: 'draw', reason: 'threefold repetition' };
  if (game.isDraw()) return { result: 'draw', reason: '50-move rule' };

  // Manual check for 5x / 75x repetition
  if (!(state.repetitionMap instanceof Map)) {
    state.repetitionMap = new Map(Object.entries(state.repetitionMap || {}));
  }
  const repetitionCount = state.repetitionMap.get(game.fen()) || 0;
  if (repetitionCount >= 5) return { result: 'draw', reason: 'fivefold repetition' };
  if (state.moveHistory.length >= 150) return { result: 'draw', reason: '75-move rule' };

  return { result: 'ongoing' };
}

// Helper: track FEN repetitions for 5-fold and 75-move rule
export function updateRepetitionMap(state, gameInstance) {
  // Defensive: reconstruct repetitionMap if missing
  let fen;
  if (gameInstance) {
    fen = gameInstance.fen();
  } else if (state.fen) {
    fen = state.fen;
  } else {
    throw new Error('Invalid state: missing FEN');
  }
  if (!(state.repetitionMap instanceof Map)) {
    state.repetitionMap = new Map(Object.entries(state.repetitionMap || {}));
  }
  const current = state.repetitionMap.get(fen) || 0;
  state.repetitionMap.set(fen, current + 1);
  console.log("Repetition map updated for FEN:", fen, "Count:", current + 1);
}
