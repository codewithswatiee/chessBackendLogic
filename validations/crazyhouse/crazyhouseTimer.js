import { Chess } from "chess.js";

// Helper: Validate ObjectId format (Keep existing)
export function isValidObjectId(id) {
  if (!id) return false;
  if (typeof id !== "string") return false;
  return /^[0-9a-fA-F]{24}$/.test(id);
}

// Helper: Safely handle ObjectId operations (Keep existing)
export function safeObjectId(id, fallback = null) {
  try {
    if (!id) return fallback;
    if (typeof id === "string" && isValidObjectId(id)) {
      return id;
    }
    if (typeof id === "object" && id.toString && isValidObjectId(id.toString())) {
      return id.toString();
    }
    console.warn("[ObjectId] Invalid ObjectId format:", id);
    return fallback;
  } catch (error) {
    console.error("[ObjectId] Error processing ObjectId:", error);
    return fallback;
  }
}

// Helper: Validate and sanitize user data for database operations (Keep existing)
export function sanitizeUserData(userData) {
  try {
    if (!userData || typeof userData !== "object") {
      return null;
    }

    const sanitized = {};

    // Handle user ID
    if (userData.userId) {
      const validUserId = safeObjectId(userData.userId);
      if (validUserId) {
        sanitized.userId = validUserId;
      } else {
        console.warn("[SANITIZE] Invalid userId:", userData.userId);
        return null;
      }
    }

    // Handle session ID
    if (userData.sessionId) {
      const validSessionId = safeObjectId(userData.sessionId);
      if (validSessionId) {
        sanitized.sessionId = validSessionId;
      } else {
        console.warn("[SANITIZE] Invalid sessionId:", userData.sessionId);
        return null;
      }
    }

    // Copy other safe fields
    const safeFields = ["username", "rating", "avatar", "title"];
    safeFields.forEach((field) => {
      if (userData[field] !== undefined) {
        sanitized[field] = userData[field];
      }
    });

    return sanitized;
  } catch (error) {
    console.error("[SANITIZE] Error sanitizing user data:", error);
    return null;
  }
}

// Helper: Safe database operation wrapper (Keep existing)
export async function safeDatabaseOperation(operation, context = "unknown") {
  try {
    console.log(`[DB] Starting ${context} operation`);
    const result = await operation();
    console.log(`[DB] Completed ${context} operation successfully`);
    return { success: true, data: result };
  } catch (error) {
    console.error(`[DB] Error in ${context} operation:`, error.message);

    // Handle specific MongoDB errors
    if (error.name === "CastError" && error.path === "_id") {
      return {
        success: false,
        error: "Invalid ID format",
        code: "INVALID_OBJECT_ID",
        context: context,
      };
    }

    if (error.name === "ValidationError") {
      return {
        success: false,
        error: "Data validation failed",
        code: "VALIDATION_ERROR",
        context: context,
        details: error.errors,
      };
    }

    if (error.code === 11000) {
      return {
        success: false,
        error: "Duplicate key error",
        code: "DUPLICATE_KEY",
        context: context,
      };
    }

    return {
      success: false,
      error: error.message || "Database operation failed",
      code: "DB_ERROR",
      context: context,
    };
  }
}

// --- Crazyhouse withTimer Constants ---
const DROP_TIME_LIMIT = 10000; // 10 seconds in ms
const BASE_TIME = 180000; // 3 minutes in ms
const INCREMENT_TIME = 2000; // 2 seconds increment per move

// Create initial state for a Crazyhouse withTimer game
export function createCrazyhouseInitialState() {
  try {
    const game = new Chess(); // default position
    const fen = game.fen();
    const [
      position,
      activeColor,
      castlingRights,
      enPassantSquare,
      halfmoveClock,
      fullmoveNumber,
    ] = fen.split(" ");

    const now = Date.now();

    return {
      fen,
      position,
      activeColor: activeColor === "w" ? "white" : "black",
      castlingRights,
      enPassantSquare,
      halfmoveClock: Number.parseInt(halfmoveClock),
      fullmoveNumber: Number.parseInt(fullmoveNumber),
      whiteTime: BASE_TIME,
      blackTime: BASE_TIME,
      increment: INCREMENT_TIME,
      turnStartTimestamp: now,
      lastMoveTimestamp: now,
      moveHistory: [],
      gameStarted: false,
      firstMoveTimestamp: null,
      gameEnded: false,
      endReason: null,
      winner: null,
      endTimestamp: null,
      pocketedPieces: {
        white: [], // Pieces captured by white (black pieces) - stored as type 'p', 'n', 'b', 'r', 'q'
        black: [], // Pieces captured by black (white pieces)
      },
      // Maps to store drop timers: key is a unique piece identifier, value is expiration timestamp
      // Example: { 'b_1700000000000': 1700000010000 } (piece type + timestamp it was captured)
      dropTimers: {
        white: new Map(),
        black: new Map(),
      },
    };
  } catch (error) {
    console.error("Error creating crazyhouse initial state:", error);
    throw error;
  }
}

// Update game timers and check for expired dropped pieces
function updateCrazyhouseTimers(state, currentTimestamp) {
  if (state.gameEnded) return;

  const game = new Chess(state.fen);
  const currentPlayer = game.turn();
  const currentPlayerColor = currentPlayer === "w" ? "white" : "black";

  // Deduct time from current player's main clock
  if (state.gameStarted && state.turnStartTimestamp) {
    const elapsed = currentTimestamp - state.turnStartTimestamp;
    if (currentPlayer === "w") {
      state.whiteTime = Math.max(0, state.whiteTime - elapsed);
    } else {
      state.blackTime = Math.max(0, state.blackTime - elapsed);
    }
  }

  // Check for expired pocketed pieces
  const playerPocketTimers = state.dropTimers[currentPlayerColor];
  if (playerPocketTimers && playerPocketTimers.size > 0) {
    const toRemove = [];
    for (let [pieceIdentifier, expirationTimestamp] of playerPocketTimers.entries()) {
      if (currentTimestamp >= expirationTimestamp) {
        // Piece has expired, remove it from pocket and timer map
        const pieceType = pieceIdentifier.split('_')[0]; // Extract piece type from identifier
        const pieceIndex = state.pocketedPieces[currentPlayerColor].findIndex(p => p === pieceType);
        if (pieceIndex !== -1) {
            state.pocketedPieces[currentPlayerColor].splice(pieceIndex, 1);
            console.log(`Removed expired ${pieceType} from ${currentPlayerColor}'s pocket.`);
        }
        toRemove.push(pieceIdentifier);
      }
    }
    toRemove.forEach(id => playerPocketTimers.delete(id));
  }
}


// Handle piece drop logic
function handlePieceDrop(state, move, playerColor, game) {
  const pieceType = move.piece; // e.g., 'p', 'n', 'b', 'r', 'q'
  const targetSquare = move.to;
  const playerPocket = state.pocketedPieces[playerColor];
  const playerDropTimers = state.dropTimers[playerColor];
  const now = Date.now();

  // Find the piece in the pocket
  const pieceIndexInPocket = playerPocket.indexOf(pieceType);
  if (pieceIndexInPocket === -1) {
    return { valid: false, reason: `Piece ${pieceType} not in pocket`, code: "PIECE_NOT_IN_POCKET" };
  }

  // Construct the piece identifier for timer lookup (assuming the oldest piece is always dropped)
  // This requires `dropTimers` to be robustly managed to link to the *specific* instance of the captured piece.
  // A more robust approach might be to use an array of objects in pocketedPieces:
  // `{ type: 'p', capturedAt: timestamp }` and then link dropTimers to this object.
  // For simplicity here, we'll just check if *any* piece of that type has expired.
  // A better implementation would assign a unique ID to each captured piece.
  
  // For this example, let's assume `dropTimers` stores the *first* time a piece of that type was captured and is available.
  // A more precise implementation would associate a unique ID with each captured piece in the pocket.
  
  // To handle multiple identical pieces, we need a way to identify which specific piece is being dropped.
  // Let's adjust `pocketedPieces` and `dropTimers` to store objects with unique IDs for robustness.
  // REVISIT: For now, we'll assume the client sends the 'id' of the piece from the pocket.
  // A more practical approach for Crazyhouse is to just check if a *type* of piece is available.
  
  // Let's refine the pocket management:
  // state.pocketedPieces[playerColor] will be an array of { type: 'p', id: 'uniqueId', capturedAt: timestamp }
  // state.dropTimers[playerColor] will map 'uniqueId' to 'expirationTimestamp'

  // For the current example, we'll simplify and just check if the piece type is in the pocket.
  // This means the frontend must ensure it only tries to drop pieces that are available.

  // Check drop timer (simplistic: assumes any piece of that type can be dropped if not expired)
  // To truly match "each captured piece has a 10-second limit", we need a precise link.
  // A better state for pocketedPieces:
  // `pocketedPieces: { white: [{ type: 'q', id: 'q-123', capturedAt: 1700000000000 }], ... }`
  // `dropTimers: { white: { 'q-123': 1700000010000 }, ... }`
  
  // Given the current structure, we need to adapt. Let's assume `move.dropId` is passed from client
  // or we just find the *first* matching piece in the pocket.
  
  const pieceToDropIdentifier = Array.from(playerDropTimers.keys()).find(key => key.startsWith(pieceType + '_'));
  
  if (!pieceToDropIdentifier) {
      return { valid: false, reason: `Piece ${pieceType} not available for drop (no timer found)`, code: "PIECE_NOT_AVAILABLE" };
  }

  const expirationTimestamp = playerDropTimers.get(pieceToDropIdentifier);

  if (now >= expirationTimestamp) {
    // Piece has expired, remove it from pocket and timers, and disallow drop
    const pieceIndex = playerPocket.indexOf(pieceType);
    if (pieceIndex !== -1) {
        playerPocket.splice(pieceIndex, 1);
    }
    playerDropTimers.delete(pieceToDropIdentifier);
    console.warn(`Attempted to drop expired piece: ${pieceType}. Removed from pocket.`);
    return { valid: false, reason: `Piece ${pieceType} drop limit expired`, code: "DROP_EXPIRED" };
  }

  // Validate standard Crazyhouse drop rules
  const targetRank = parseInt(targetSquare[1]);
  if (pieceType.toLowerCase() === "p" && (targetRank === 1 || targetRank === 8)) {
    return { valid: false, reason: "Pawns cannot be dropped on 1st or 8th rank", code: "INVALID_PAWN_DROP" };
  }

  // Check if target square is empty (Crazyhouse rule)
  if (game.get(targetSquare)) {
    return { valid: false, reason: "Cannot drop on an occupied square", code: "SQUARE_OCCUPIED" };
  }

  // Apply the drop
  try {
    game.put({ type: pieceType, color: playerColor === "white" ? "w" : "b" }, targetSquare);
    playerPocket.splice(pieceIndexInPocket, 1); // Remove from pocket
    playerDropTimers.delete(pieceToDropIdentifier); // Remove from drop timers
    return { valid: true, game: game };
  } catch (error) {
    console.error("Chess.js put error during drop:", error);
    return { valid: false, reason: "Illegal drop: " + error.message, code: "CHESS_JS_ERROR" };
  }
}

// Validate a move or piece drop and apply Crazyhouse withTimer rules
export function validateAndApplyCrazyhouseMove(state, move, playerColor, currentTimestamp) {
  try {
    console.log("=== CRAZYHOUSE MOVE VALIDATION START ===");
    console.log("Move/Drop:", move, "Player:", playerColor);

    if (!validateInputs(state, move, playerColor)) {
      return { valid: false, reason: "Invalid input parameters", code: "INVALID_INPUT" };
    }

    if (!currentTimestamp || typeof currentTimestamp !== "number") {
      currentTimestamp = Date.now();
    }

    if (state.gameEnded) {
      return {
        valid: false,
        reason: "Game has already ended",
        gameEnded: true,
        shouldNavigateToMenu: true,
        code: "GAME_ENDED",
      };
    }

    // Initialize state defaults if needed
    initializeStateDefaults(state, currentTimestamp);

    // Reconstruct game from FEN
    let game;
    try {
      game = new Chess(state.fen);
      state.game = game; // Attach to state for helpers
    } catch (error) {
      console.error("Error reconstructing game from FEN:", error);
      return { valid: false, reason: "Invalid game state (FEN)", code: "INVALID_FEN" };
    }

    // Check turn
    const currentPlayerBeforeMove = game.turn();
    const currentPlayerColor = currentPlayerBeforeMove === "w" ? "white" : "black";
    if (currentPlayerColor !== playerColor) {
      return { valid: false, reason: "Not your turn", code: "WRONG_TURN" };
    }

    // Update timers *before* processing the current move/drop
    updateCrazyhouseTimers(state, currentTimestamp);

    // After updating, check for timeout
    const timeoutResult = checkForTimeout(state, currentTimestamp);
    if (timeoutResult.gameEnded) {
        return timeoutResult;
    }

    let moveResult;
    let isDrop = false;

    if (move.type === "drop") { // Assuming 'move' object has a 'type: "drop"' property
      isDrop = true;
      moveResult = handlePieceDrop(state, move, playerColor, game);
    } else {
      // Standard chess move
      moveResult = validateChessMove(state, move, playerColor, currentTimestamp);

      // If it's a capture, add to pocketedPieces and start drop timer
      if (moveResult.valid && moveResult.capturedPiece) {
        const capturedPieceType = moveResult.capturedPiece.type.toLowerCase();
        const capturingPlayerColor = playerColor;
        state.pocketedPieces[capturingPlayerColor].push(capturedPieceType);
        
        // Assign a unique ID to the captured piece for precise timer tracking
        const pieceIdentifier = `${capturedPieceType}_${Date.now()}`;
        state.dropTimers[capturingPlayerColor].set(pieceIdentifier, currentTimestamp + DROP_TIME_LIMIT);
        console.log(`${capturingPlayerColor} captured ${capturedPieceType}. Available for drop for 10s.`);
      }
    }

    if (!moveResult.valid) {
      return moveResult; // Return error from move/drop validation
    }

    // Update game state after successful move/drop
    updateGameStateAfterMove(state, moveResult, currentTimestamp, isDrop);

    // Check game status
    const gameStatus = checkCrazyhouseGameStatus(state, game);
    if (gameStatus.result !== "ongoing") {
      finalizeGameEnd(state, gameStatus, currentTimestamp);
    }

    if (state.game) delete state.game; // Clean up temp Chess instance

    console.log("=== CRAZYHOUSE MOVE VALIDATION END ===");
    return createMoveResult(state, moveResult, gameStatus);
  } catch (error) {
    console.error("Error in validateAndApplyCrazyhouseMove:", error);
    return {
      valid: false,
      reason: "Internal error during move validation",
      error: error.message,
      code: "INTERNAL_ERROR",
    };
  }
}

// Helper functions for better organization (largely reused from decay, with adjustments)
function validateInputs(state, move, playerColor) {
  if (!state || typeof state !== "object") return false;
  // Move can be a standard move { from, to } or a drop { type: 'drop', piece: 'p', to: 'e4' }
  if (!move || typeof move !== "object") return false;
  if (!playerColor || (playerColor !== "white" && playerColor !== "black")) return false;

  if (move.type === "drop") {
    if (!move.piece || !move.to) return false;
  } else {
    if (!move.from || !move.to) return false;
  }
  return true;
}

function initializeStateDefaults(state, currentTimestamp) {
  if (typeof state.turnStartTimestamp !== "number") state.turnStartTimestamp = currentTimestamp;
  if (typeof state.lastMoveTimestamp !== "number") state.lastMoveTimestamp = currentTimestamp;
  if (typeof state.whiteTime !== "number") state.whiteTime = BASE_TIME;
  if (typeof state.blackTime !== "number") state.blackTime = BASE_TIME;
  if (!state.moveHistory) state.moveHistory = [];
  if (typeof state.gameStarted !== "boolean") state.gameStarted = false;
  if (!state.firstMoveTimestamp) state.firstMoveTimestamp = null;
  if (!state.capturedPieces) state.capturedPieces = { white: [], black: [] }; // Legacy, now pocketedPieces
  if (!state.pocketedPieces) state.pocketedPieces = { white: [], black: [] };
  if (!state.dropTimers) state.dropTimers = { white: new Map(), black: new Map() };
  else { // Ensure Maps are rehydrated if they come from a plain object (e.g., database)
    state.dropTimers.white = new Map(state.dropTimers.white);
    state.dropTimers.black = new Map(state.dropTimers.black);
  }
  if (typeof state.gameEnded !== "boolean") state.gameEnded = false;
}

function checkForTimeout(state, currentTimestamp) {
  // We already updated timers in updateCrazyhouseTimers before calling this.
  // So, just check the current state of times.
  if (state.whiteTime <= 0) {
    return createTimeoutResult(state, "black", "White ran out of time", currentTimestamp);
  }
  if (state.blackTime <= 0) {
    return createTimeoutResult(state, "white", "Black ran out of time", currentTimestamp);
  }
  return { gameEnded: false };
}

function createTimeoutResult(state, winner, reason, currentTimestamp) {
  state.gameEnded = true;
  state.endReason = "timeout";
  state.winnerColor = winner;
  state.winner = null; // Assuming winner username/ID comes from outside state.players
  state.endTimestamp = currentTimestamp;

  return {
    valid: false,
    reason: reason,
    result: "timeout",
    winnerColor: winner,
    gameEnded: true,
    endReason: "timeout",
    shouldNavigateToMenu: true,
    endTimestamp: currentTimestamp,
    code: "TIMEOUT",
  };
}

function validateChessMove(state, move, playerColor, currentTimestamp) {
  let game = state.game; // Chess instance already created in main function

  // Check turn (already done in main function, but good for self-contained helper)
  const currentPlayerBeforeMove = game.turn();
  const currentPlayerColor = currentPlayerBeforeMove === "w" ? "white" : "black";

  if (currentPlayerColor !== playerColor) {
    return { valid: false, reason: "Not your turn", code: "WRONG_TURN" };
  }

  // Handle timing for first move
  if (!state.gameStarted || state.moveHistory.length === 0) {
    console.log("FIRST MOVE DETECTED - Starting game timers");
    state.gameStarted = true;
    state.firstMoveTimestamp = currentTimestamp;
    state.turnStartTimestamp = currentTimestamp;
    state.lastMoveTimestamp = currentTimestamp;
  }
  // Time deduction for current player already handled by `updateCrazyhouseTimers` before this.

  // Validate and apply the move
  let result;
  try {
    result = game.move(move);
  } catch (error) {
    console.error("Chess.js move error:", error);
    return { valid: false, reason: "Invalid move", code: "CHESS_JS_ERROR", details: error.message };
  }

  if (!result) return { valid: false, reason: "Illegal move", code: "ILLEGAL_MOVE" };

  return {
    valid: true,
    result: result,
    game: game,
    capturedPiece: result.captured ? { type: result.captured, color: result.color } : null, // Chess.js provides captured piece
    currentPlayerBeforeMove: currentPlayerBeforeMove,
  };
}

function updateGameStateAfterMove(state, moveResult, currentTimestamp, isDrop) {
  const { result, capturedPiece, currentPlayerBeforeMove, game } = moveResult;

  // Captured piece handling for Crazyhouse is done in validateAndApplyCrazyhouseMove
  // for regular moves. For drops, there's no capture.

  // Update state after successful move/drop
  const oldFen = state.fen;
  state.fen = game.fen();
  state.lastMoveTimestamp = currentTimestamp;

  // Add increment to the player who just moved (3+2 time control)
  if (currentPlayerBeforeMove === "w") {
    state.whiteTime += state.increment;
  } else {
    state.blackTime += state.increment;
  }

  // Reset turn start timestamp for the NEXT player's turn
  state.turnStartTimestamp = currentTimestamp;
  state.moveHistory.push(result);

  // Update the active color
  const newActivePlayer = game.turn();
  state.activeColor = newActivePlayer === "w" ? "white" : "black";

  console.log("Move/Drop completed:");
  console.log("- FEN changed from:", oldFen.split(" ")[0], "to:", state.fen.split(" ")[0]);
  console.log("- Next player's turn:", newActivePlayer, "Active color:", state.activeColor);
  console.log("- Final times - White:", state.whiteTime, "Black:", state.blackTime);

  // Update repetition tracking (Crazyhouse repetition includes pocketed pieces)
  updateRepetitionMap(state, game, true); // true for Crazyhouse FEN
}

function finalizeGameEnd(state, gameStatus, currentTimestamp) {
  state.gameEnded = true;
  state.endReason = gameStatus.result;
  state.winnerColor = gameStatus.winnerColor || null;
  state.endTimestamp = currentTimestamp;
}

function createMoveResult(state, moveResult, gameStatus) {
  state.gameState = {
    check: moveResult.game.inCheck(),
    checkmate: moveResult.game.isCheckmate(),
    stalemate: moveResult.game.isStalemate(),
    insufficientMaterial: moveResult.game.isInsufficientMaterial(),
    threefoldRepetition: moveResult.game.isThreefoldRepetition(),
    fiftyMoveRule: moveResult.game.isDraw(), // Chess.js isDraw includes 50-move rule
    lastMove: moveResult.result,
    result: gameStatus.result,
    winner:
      gameStatus.winnerColor && state.players && state.players[gameStatus.winnerColor]
        ? state.players[gameStatus.winnerColor].username
        : null,
    winnerId:
      gameStatus.winnerColor && state.players && state.players[gameStatus.winnerColor]
        ? state.players[gameStatus.winnerColor]._id || null
        : null,
    drawReason: gameStatus.reason || null,
    gameEnded: state.gameEnded,
    endReason: state.endReason,
    endTimestamp: state.endTimestamp,
    pocketedPieces: state.pocketedPieces,
    dropTimers: { // Convert Maps to plain objects for easier serialization if needed
        white: Object.fromEntries(state.dropTimers.white),
        black: Object.fromEntries(state.dropTimers.black)
    },
  };

  return {
    valid: true,
    move: moveResult.result,
    state,
    gameEnded: state.gameEnded,
    endReason: state.endReason,
    endTimestamp: state.endTimestamp,
    code: "SUCCESS",
    winnerColor: state.winnerColor,
    winner: state.winner,
    ...gameStatus,
  };
}

// Get current timer values including drop timers
export function getCurrentCrazyhouseTimers(state, currentTimestamp) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[CRAZYHOUSE_TIMER] Invalid state provided");
      return {
        white: BASE_TIME,
        black: BASE_TIME,
        activeColor: "white",
        gameEnded: false,
        error: "Invalid state",
      };
    }

    if (!currentTimestamp || typeof currentTimestamp !== "number") {
      currentTimestamp = Date.now();
    }

    // Re-hydrate Maps if necessary (e.g., state loaded from DB)
    if (!(state.dropTimers.white instanceof Map)) {
      state.dropTimers.white = new Map(Object.entries(state.dropTimers.white || {}));
    }
    if (!(state.dropTimers.black instanceof Map)) {
      state.dropTimers.black = new Map(Object.entries(state.dropTimers.black || {}));
    }

    // If game has ended, return final values
    if (state.gameEnded) {
      return {
        white: state.whiteTime || 0,
        black: state.blackTime || 0,
        activeColor: state.activeColor || "white",
        gameEnded: true,
        endReason: state.endReason,
        winner: state.winner,
        shouldNavigateToMenu: true,
        endTimestamp: state.endTimestamp,
        pocketedPieces: state.pocketedPieces,
        dropTimers: {
            white: Object.fromEntries(state.dropTimers.white),
            black: Object.fromEntries(state.dropTimers.black)
        },
      };
    }

    // For first move, don't deduct time
    if (!state.gameStarted || !state.turnStartTimestamp || state.moveHistory.length === 0) {
      return {
        white: state.whiteTime || BASE_TIME,
        black: state.blackTime || BASE_TIME,
        activeColor: state.activeColor || "white",
        gameEnded: false,
        pocketedPieces: state.pocketedPieces,
        dropTimers: {
            white: Object.fromEntries(state.dropTimers.white),
            black: Object.fromEntries(state.dropTimers.black)
        },
      };
    }

    // Temporarily update timers to reflect current time before returning
    const tempState = JSON.parse(JSON.stringify(state)); // Deep copy to avoid modifying original state for this read operation
    tempState.dropTimers.white = new Map(Object.entries(state.dropTimers.white));
    tempState.dropTimers.black = new Map(Object.entries(state.dropTimers.black));
    
    updateCrazyhouseTimers(tempState, currentTimestamp); // Use tempState for calculation

    // Check for timeout after temp update
    if (tempState.whiteTime <= 0) {
      // This means white timed out, black wins
      state.gameEnded = true;
      state.endReason = "timeout";
      state.winnerColor = "black";
      state.winner = null;
      state.endTimestamp = currentTimestamp;
      return {
        white: 0,
        black: tempState.blackTime,
        activeColor: tempState.activeColor,
        gameEnded: true,
        endReason: "timeout",
        winnerColor: "black",
        winner: null,
        shouldNavigateToMenu: true,
        endTimestamp: currentTimestamp,
        pocketedPieces: state.pocketedPieces,
        dropTimers: {
            white: Object.fromEntries(state.dropTimers.white),
            black: Object.fromEntries(state.dropTimers.black)
        },
      };
    }

    if (tempState.blackTime <= 0) {
      // This means black timed out, white wins
      state.gameEnded = true;
      state.endReason = "timeout";
      state.winnerColor = "white";
      state.winner = null;
      state.endTimestamp = currentTimestamp;
      return {
        white: tempState.whiteTime,
        black: 0,
        activeColor: tempState.activeColor,
        gameEnded: true,
        endReason: "timeout",
        winnerColor: "white",
        winner: null,
        shouldNavigateToMenu: true,
        endTimestamp: currentTimestamp,
        pocketedPieces: state.pocketedPieces,
        dropTimers: {
            white: Object.fromEntries(state.dropTimers.white),
            black: Object.fromEntries(state.dropTimers.black)
        },
      };
    }

    return {
      white: tempState.whiteTime,
      black: tempState.blackTime,
      activeColor: tempState.activeColor,
      gameEnded: false,
      pocketedPieces: tempState.pocketedPieces,
      dropTimers: { // Convert Maps to plain objects for return
          white: Object.fromEntries(tempState.dropTimers.white),
          black: Object.fromEntries(tempState.dropTimers.black)
      },
    };
  } catch (error) {
    console.error("Error in getCurrentCrazyhouseTimers:", error);
    return {
      white: state?.whiteTime || BASE_TIME,
      black: state?.blackTime || BASE_TIME,
      activeColor: state?.activeColor || "white",
      gameEnded: false,
      error: error.message,
    };
  }
}


// Generate legal moves and possible piece drops
export function getCrazyhouseLegalMoves(fen, pocketedPieces, dropTimers, playerColor) {
  try {
    if (!fen || typeof fen !== "string") {
      console.error("[CRAZYHOUSE_MOVES] Invalid FEN provided:", fen);
      return [];
    }

    const game = new Chess(fen);
    const allBoardMoves = game.moves({ verbose: true });
    const legalMoves = [...allBoardMoves];

    // Add possible piece drops
    if (pocketedPieces && pocketedPieces[playerColor]) {
      const currentPlayerPocket = pocketedPieces[playerColor];
      const currentPlayerDropTimers = new Map(Object.entries(dropTimers[playerColor] || {})); // Ensure Map
      const now = Date.now();

      const uniqueDroppablePieces = [...new Set(currentPlayerPocket)]; // Get unique types

      for (const pieceType of uniqueDroppablePieces) {
        // Find *an* available instance of this piece type that hasn't expired
        let isPieceAvailable = false;
        for (let [pieceIdentifier, expirationTimestamp] of currentPlayerDropTimers.entries()) {
            if (pieceIdentifier.startsWith(pieceType + '_') && now < expirationTimestamp) {
                isPieceAvailable = true;
                break;
            }
        }

        if (!isPieceAvailable) {
            continue; // This piece type is not currently droppable
        }

        for (let row = 0; row < 8; row++) {
          for (let col = 0; col < 8; col++) {
            const square = String.fromCharCode(97 + col) + (row + 1);

            // Standard Crazyhouse drop rules
            if (pieceType.toLowerCase() === "p" && (row === 0 || row === 7)) {
              continue; // Pawns cannot be dropped on 1st or 8th rank
            }

            if (!game.get(square)) { // Square must be empty for a drop
              try {
                // Temporarily apply the drop to check legality (e.g., not self-check)
                const tempGame = new Chess(fen);
                tempGame.put({ type: pieceType, color: playerColor === "white" ? "w" : "b" }, square);
                
                // If putting the piece doesn't immediately result in an illegal state for the current player
                // (e.g., king in check, if putting own king into check)
                if (!tempGame.inCheck()) { // This is a simplification; a full check would involve looking at opponent's next moves
                    legalMoves.push({
                        from: "pocket", // Special 'from' to denote a drop
                        to: square,
                        piece: pieceType,
                        color: playerColor === "white" ? "w" : "b",
                        captured: null,
                        promotion: null,
                        san: `${pieceType.toUpperCase()}@${square}`, // Standard Algebraic Notation for drops
                        flags: "d", // 'd' for drop
                        
                    });
                }
              } catch (e) {
                // Illegal drop (e.g., trying to put a second king)
              }
            }
          }
        }
      }
    }

    return legalMoves;
  } catch (error) {
    console.error("Error getting crazyhouse legal moves:", error);
    return [];
  }
}

// Check game status including Crazyhouse specific conditions
export function checkCrazyhouseGameStatus(state, gameInstance) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[CRAZYHOUSE_STATUS] Invalid state provided");
      return { result: "ongoing", error: "Invalid state" };
    }

    let game = gameInstance;
    if (!game) {
      if (!state.fen) {
        console.error("[CRAZYHOUSE_STATUS] Missing FEN in game state");
        return { result: "ongoing", error: "Missing FEN" };
      }
      try {
        game = new Chess(state.fen);
      } catch (error) {
        console.error("[CRAZYHOUSE_STATUS] Error reconstructing game from FEN:", error);
        return { result: "ongoing", error: "Invalid FEN" };
      }
    }

    // Check for time-based wins first
    if (state.whiteTime <= 0) return { result: "timeout", winnerColor: "black", reason: "white ran out of time" };
    if (state.blackTime <= 0) return { result: "timeout", winnerColor: "white", reason: "black ran out of time" };

    // Check for checkmate
    if (game.isCheckmate()) {
      const winnerColor = game.turn() === "w" ? "black" : "white";
      console.log(`CHECKMATE DETECTED: ${winnerColor} wins!`);
      return { result: "checkmate", winnerColor: winnerColor };
    }

    // Check for other draw conditions
    if (game.isStalemate()) return { result: "draw", reason: "stalemate", winnerColor: null };
    if (game.isInsufficientMaterial()) return { result: "draw", reason: "insufficient material", winnerColor: null };
    
    // Chess.js's isThreefoldRepetition relies on standard FEN, which doesn't include pocket.
    // We need a custom check for Crazyhouse, which updateRepetitionMap helps with.
    // If the FEN+pocket has appeared 3 times, it's a draw.
    if (!(state.repetitionMap instanceof Map)) {
        state.repetitionMap = new Map(Object.entries(state.repetitionMap || {}));
    }
    const crazyhouseFen = getCrazyhouseFenForRepetition(game.fen(), state.pocketedPieces);
    const repetitionCount = state.repetitionMap.get(crazyhouseFen) || 0;
    if (repetitionCount >= 3) return { result: "draw", reason: "threefold repetition (crazyhouse)", winnerColor: null };

    // Check 50-move rule: Crazyhouse has no 50-move rule usually because drops reset it.
    // However, if Chess.js `isDraw()` handles it, we can keep it for general draws.
    // If we want to strictly follow Crazyhouse rules, this should be modified.
    // For now, let's keep it as Chess.js `isDraw` handles standard rules.
    if (game.isDraw()) return { result: "draw", reason: "50-move rule", winnerColor: null };


    // Crazyhouse typically has a 75-move rule.
    if (state.moveHistory && state.moveHistory.length >= 150) // 150 half-moves = 75 full moves
      return { result: "draw", reason: "75-move rule", winnerColor: null };

    return { result: "ongoing", winnerColor: null };
  } catch (error) {
    console.error("Error checking crazyhouse game status:", error);
    return { result: "ongoing", error: error.message, winnerColor: null };
  }
}

// Helper: track FEN repetitions for Crazyhouse (includes pocketed pieces)
export function updateRepetitionMap(state, gameInstance, isCrazyhouse = false) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[REPETITION] Invalid state provided");
      return;
    }

    let fen;
    if (gameInstance) {
      fen = gameInstance.fen();
    } else if (state.fen) {
      fen = state.fen;
    } else {
      console.error("[REPETITION] Missing FEN in game state");
      return;
    }

    if (!fen || typeof fen !== "string") {
      console.error("[REPETITION] Invalid FEN format:", fen);
      return;
    }

    // For Crazyhouse, repetition must include the pocketed pieces state
    let repetitionFen = fen;
    if (isCrazyhouse && state.pocketedPieces) {
        repetitionFen += `[${state.pocketedPieces.white.join('')}]`;
        repetitionFen += `[${state.pocketedPieces.black.join('')}]`;
    }

    if (!(state.repetitionMap instanceof Map)) {
      state.repetitionMap = new Map(Object.entries(state.repetitionMap || {}));
    }

    const current = state.repetitionMap.get(repetitionFen) || 0;
    state.repetitionMap.set(repetitionFen, current + 1);

    console.log("Repetition map updated for Crazyhouse FEN:", repetitionFen, "Count:", current + 1);
  } catch (error) {
    console.error("Error updating repetition map:", error);
  }
}

// Helper: Generate a Crazyhouse FEN string for repetition checking
function getCrazyhouseFenForRepetition(fen, pocketedPieces) {
    let crazyhouseFen = fen.split(' ')[0]; // Only the board position
    const whitePocket = pocketedPieces.white.sort().join('');
    const blackPocket = pocketedPieces.black.sort().join('');
    crazyhouseFen += `[${whitePocket}][${blackPocket}]`;
    return crazyhouseFen;
}