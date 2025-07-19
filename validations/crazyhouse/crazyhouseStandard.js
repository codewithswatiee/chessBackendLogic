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

// --- Crazyhouse (Standard) Constants ---
const BASE_TIME_STANDARD = 180000; // 3 minutes in ms
const INCREMENT_TIME_STANDARD = 2000; // 2 seconds increment per move

// Create initial state for a Crazyhouse (Standard) game
export function createCrazyhouseStandardInitialState() {
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
      whiteTime: BASE_TIME_STANDARD,
      blackTime: BASE_TIME_STANDARD,
      increment: INCREMENT_TIME_STANDARD,
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
      // No 'dropTimers' for standard Crazyhouse
    };
  } catch (error) {
    console.error("Error creating crazyhouse standard initial state:", error);
    throw error;
  }
}

// Update game timers (no drop timer logic for Standard Crazyhouse)
function updateCrazyhouseStandardTimers(state, currentTimestamp) {
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
  // No drop timer expiration logic needed here for Standard Crazyhouse
}

// Handle piece drop logic for Standard Crazyhouse (no timer checks)
// Handle piece drop logic for Standard Crazyhouse (no timer checks)
function handlePieceDropStandard(state, move, playerColor, game) {
  const pieceType = move.piece; // e.g., 'p', 'n', 'b', 'r', 'q'
  const targetSquare = move.to;
  const playerPocket = state.pocketedPieces[playerColor];

  // Find the piece in the pocket
  const pieceIndexInPocket = playerPocket.indexOf(pieceType);
  if (pieceIndexInPocket === -1) {
    return { valid: false, reason: `Piece ${pieceType} not in pocket`, code: "PIECE_NOT_IN_POCKET" };
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
    
    // IMPORTANT: Manually switch the turn after a drop
    // Chess.js doesn't automatically switch turns when using put()
    const newFen = game.fen();
    const fenParts = newFen.split(' ');
    
    // Switch the active color (second part of FEN)
    fenParts[1] = fenParts[1] === 'w' ? 'b' : 'w';
    
    // Increment the fullmove number if it was black's turn
    if (playerColor === "black") {
      fenParts[5] = (parseInt(fenParts[5]) + 1).toString();
    }
    
    // Update the halfmove clock (reset to 0 for pawn drops, increment for others)
    if (pieceType.toLowerCase() === 'p') {
      fenParts[4] = '0';
    } else {
      fenParts[4] = (parseInt(fenParts[4]) + 1).toString();
    }
    
    // Reconstruct the game with the corrected FEN
    const correctedFen = fenParts.join(' ');
    game.load(correctedFen);
    
    playerPocket.splice(pieceIndexInPocket, 1); // Remove from pocket
    
    // Create a move-like result object for consistency with regular moves
    const moveResult = {
      from: "pocket",
      to: targetSquare,
      piece: pieceType,
      color: playerColor === "white" ? "w" : "b",
      captured: null,
      promotion: null,
      san: `${pieceType.toUpperCase()}@${targetSquare}`,
      flags: "d", // 'd' for drop
      drop: true
    };
    
    return { valid: true, game: game, result: moveResult };
  } catch (error) {
    console.error("Chess.js put error during drop:", error);
    return { valid: false, reason: "Illegal drop: " + error.message, code: "CHESS_JS_ERROR" };
  }
}

// Validate a move or piece drop and apply Crazyhouse (Standard) rules
export function validateAndApplyCrazyhouseStandardMove(state, move, playerColor, currentTimestamp) {
  try {
    console.log("=== CRAZYHOUSE STANDARD MOVE VALIDATION START ===");
    console.log("Move/Drop:", move, "Player:", playerColor);

    if (!validateInputsStandard(state, move, playerColor)) {
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
    initializeStateDefaultsStandard(state, currentTimestamp);

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
    updateCrazyhouseStandardTimers(state, currentTimestamp);

    // After updating, check for timeout
    const timeoutResult = checkForTimeoutStandard(state, currentTimestamp);
    if (timeoutResult.gameEnded) {
      return timeoutResult;
    }

    let moveResult;
    let isDrop = false;
    console.log("move:", move);

    if (move.drop === true) { // Assuming 'move' object has a 'type: "drop"' property

      isDrop = true;
      moveResult = handlePieceDropStandard(state, move, playerColor, game);
    } else {
      // Standard chess move
      moveResult = validateChessMoveStandard(state, move, playerColor, currentTimestamp);

      // If it's a capture, add to pocketedPieces
      if (moveResult.valid && moveResult.capturedPiece) {
        const capturedPieceType = moveResult.capturedPiece.type.toLowerCase();
        const capturingPlayerColor = playerColor;
        state.pocketedPieces[capturingPlayerColor].push(capturedPieceType);
        console.log(`${capturingPlayerColor} captured ${capturedPieceType}. Added to pocket.`);
      }
    }

    if (!moveResult.valid) {
      return moveResult; // Return error from move/drop validation
    }

    // Update game state after successful move/drop
    updateGameStateAfterMoveStandard(state, moveResult, currentTimestamp, isDrop);

    // Check game status
    const gameStatus = checkCrazyhouseStandardGameStatus(state, game);
    if (gameStatus.result !== "ongoing") {
      finalizeGameEndStandard(state, gameStatus, currentTimestamp);
    }

    if (state.game) delete state.game; // Clean up temp Chess instance

    console.log("=== CRAZYHOUSE STANDARD MOVE VALIDATION END ===");
    return createMoveResultStandard(state, moveResult, gameStatus);
  } catch (error) {
    console.error("Error in validateAndApplyCrazyhouseStandardMove:", error);
    return {
      valid: false,
      reason: "Internal error during move validation",
      error: error.message,
      code: "INTERNAL_ERROR",
    };
  }
}

// Helper functions for better organization (adapted for Standard Crazyhouse)
function validateInputsStandard(state, move, playerColor) {
  if (!state || typeof state !== "object") return false;
  if (!move || typeof move !== "object") return false;
  if (!playerColor || (playerColor !== "white" && playerColor !== "black")) return false;

  if (move.drop === true) {
    if (!move.piece || !move.to) return false;
  } else {
    if (!move.from || !move.to) return false;
  }
  return true;
}

function initializeStateDefaultsStandard(state, currentTimestamp) {
  if (typeof state.turnStartTimestamp !== "number") state.turnStartTimestamp = currentTimestamp;
  if (typeof state.lastMoveTimestamp !== "number") state.lastMoveTimestamp = currentTimestamp;
  if (typeof state.whiteTime !== "number") state.whiteTime = BASE_TIME_STANDARD;
  if (typeof state.blackTime !== "number") state.blackTime = BASE_TIME_STANDARD;
  if (!state.moveHistory) state.moveHistory = [];
  if (typeof state.gameStarted !== "boolean") state.gameStarted = false;
  if (!state.firstMoveTimestamp) state.firstMoveTimestamp = null;
  if (!state.pocketedPieces) state.pocketedPieces = { white: [], black: [] };
  if (typeof state.gameEnded !== "boolean") state.gameEnded = false;
  // No 'dropTimers' initialization for standard Crazyhouse
}

function checkForTimeoutStandard(state, currentTimestamp) {
  if (state.whiteTime <= 0) {
    return createTimeoutResultStandard(state, "black", "White ran out of time", currentTimestamp);
  }
  if (state.blackTime <= 0) {
    return createTimeoutResultStandard(state, "white", "Black ran out of time", currentTimestamp);
  }
  return { gameEnded: false };
}

function createTimeoutResultStandard(state, winner, reason, currentTimestamp) {
  state.gameEnded = true;
  state.endReason = "timeout";
  state.winnerColor = winner;
  state.winner = null;
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

function validateChessMoveStandard(state, move, playerColor, currentTimestamp) {
  let game = state.game;

  const currentPlayerBeforeMove = game.turn();
  const currentPlayerColor = currentPlayerBeforeMove === "w" ? "white" : "black";

  if (currentPlayerColor !== playerColor) {
    return { valid: false, reason: "Not your turn", code: "WRONG_TURN" };
  }

  if (!state.gameStarted || state.moveHistory.length === 0) {
    console.log("FIRST MOVE DETECTED - Starting game timers");
    state.gameStarted = true;
    state.firstMoveTimestamp = currentTimestamp;
    state.turnStartTimestamp = currentTimestamp;
    state.lastMoveTimestamp = currentTimestamp;
  }

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
    capturedPiece: result.captured ? { type: result.captured, color: result.color } : null,
    currentPlayerBeforeMove: currentPlayerBeforeMove,
  };
}

function updateGameStateAfterMoveStandard(state, moveResult, currentTimestamp, isDrop) {
  const { result, capturedPiece, currentPlayerBeforeMove, game } = moveResult;

  const oldFen = state.fen;
  state.fen = game.fen();
  state.lastMoveTimestamp = currentTimestamp;

  if (currentPlayerBeforeMove === "w") {
    state.whiteTime += state.increment;
  } else {
    state.blackTime += state.increment;
  }

  state.turnStartTimestamp = currentTimestamp;
  state.moveHistory.push(result);

  const newActivePlayer = game.turn();
  state.activeColor = newActivePlayer === "w" ? "white" : "black";

  console.log("Move/Drop completed:");
  console.log("- FEN changed from:", oldFen.split(" ")[0], "to:", state.fen.split(" ")[0]);
  console.log("- Next player's turn:", newActivePlayer, "Active color:", state.activeColor);
  console.log("- Final times - White:", state.whiteTime, "Black:", state.blackTime);

  // Update repetition tracking for Crazyhouse (includes pocket)
  updateRepetitionMap(state, game, true);
}

function finalizeGameEndStandard(state, gameStatus, currentTimestamp) {
  state.gameEnded = true;
  state.endReason = gameStatus.result;
  state.winnerColor = gameStatus.winnerColor || null;
  state.endTimestamp = currentTimestamp;
}

function createMoveResultStandard(state, moveResult, gameStatus) {
  state.gameState = {
    check: moveResult.game.inCheck(),
    checkmate: moveResult.game.isCheckmate(),
    stalemate: moveResult.game.isStalemate(),
    insufficientMaterial: moveResult.game.isInsufficientMaterial(),
    threefoldRepetition: moveResult.game.isThreefoldRepetition(),
    fiftyMoveRule: moveResult.game.isDraw(),
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
    // No 'dropTimers' in the returned state for Standard Crazyhouse
  };

  console.log("Pocket Pieces", state.gameState.pocketedPieces);

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

// Get current timer values for Standard Crazyhouse
export function getCurrentCrazyhouseStandardTimers(state, currentTimestamp) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[CRAZYHOUSE_STANDARD_TIMER] Invalid state provided");
      return {
        white: BASE_TIME_STANDARD,
        black: BASE_TIME_STANDARD,
        activeColor: "white",
        gameEnded: false,
        error: "Invalid state",
      };
    }

    if (!currentTimestamp || typeof currentTimestamp !== "number") {
      currentTimestamp = Date.now();
    }

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
      };
    }

    if (!state.gameStarted || !state.turnStartTimestamp || state.moveHistory.length === 0) {
      return {
        white: state.whiteTime || BASE_TIME_STANDARD,
        black: state.blackTime || BASE_TIME_STANDARD,
        activeColor: state.activeColor || "white",
        gameEnded: false,
        pocketedPieces: state.pocketedPieces,
      };
    }

    // Temporarily update timers to reflect current time before returning
    const tempState = JSON.parse(JSON.stringify(state));
    updateCrazyhouseStandardTimers(tempState, currentTimestamp);

    if (tempState.whiteTime <= 0) {
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
      };
    }

    if (tempState.blackTime <= 0) {
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
      };
    }

    return {
      white: tempState.whiteTime,
      black: tempState.blackTime,
      activeColor: tempState.activeColor,
      gameEnded: false,
      pocketedPieces: tempState.pocketedPieces,
    };
  } catch (error) {
    console.error("Error in getCurrentCrazyhouseStandardTimers:", error);
    return {
      white: state?.whiteTime || BASE_TIME_STANDARD,
      black: state?.blackTime || BASE_TIME_STANDARD,
      activeColor: state?.activeColor || "white",
      gameEnded: false,
      error: error.message,
    };
  }
}

// Generate legal moves and possible piece drops for Standard Crazyhouse (no timer checks)
export function getCrazyhouseStandardLegalMoves(fen, pocketedPieces, playerColor) {
  try {
    if (!fen || typeof fen !== "string") {
      console.error("[CRAZYHOUSE_STANDARD_MOVES] Invalid FEN provided:", fen);
      return [];
    }

    const game = new Chess(fen);
    const allBoardMoves = game.moves({ verbose: true });
    const legalMoves = [...allBoardMoves];

    // Add possible piece drops
    if (pocketedPieces && pocketedPieces[playerColor]) {
      const currentPlayerPocket = pocketedPieces[playerColor];
      const uniqueDroppablePieces = [...new Set(currentPlayerPocket)]; // Get unique types

      for (const pieceType of uniqueDroppablePieces) {
        // No timer check needed for standard Crazyhouse

        for (let row = 0; row < 8; row++) {
          for (let col = 0; col < 8; col++) {
            const square = String.fromCharCode(97 + col) + (row + 1);

            // Standard Crazyhouse drop rules: Pawns cannot be dropped on 1st or 8th rank
            if (pieceType.toLowerCase() === "p" && (row === 0 || row === 7)) {
              continue;
            }

            // Square must be empty for a drop
            if (!game.get(square)) {
              try {
                // Temporarily apply the drop to check legality (e.g., not self-check)
                const tempGame = new Chess(fen);
                tempGame.put({ type: pieceType, color: playerColor === "white" ? "w" : "b" }, square);

                // Ensure putting the piece doesn't put the *current player's* king in check
                if (!tempGame.inCheck()) {
                  legalMoves.push({
                    from: "pocket", // Special 'from' to denote a drop
                    to: square,
                    piece: pieceType,
                    color: playerColor === "white" ? "w" : "b",
                    captured: null,
                    promotion: null,
                    san: `${pieceType.toUpperCase()}@${square}`,
                    flags: "d",
                    drop: true // <-- Add this property for backend compatibility
                  });
                }
              } catch (e) {
                // This catch handles cases like attempting to put a king where one already exists
              }
            }
          }
        }
      }
    }
    return legalMoves;
  } catch (error) {
    console.error("Error getting crazyhouse standard legal moves:", error);
    return [];
  }
}

// Check game status including Crazyhouse specific conditions (repetition includes pocket)
export function checkCrazyhouseStandardGameStatus(state, gameInstance) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[CRAZYHOUSE_STANDARD_STATUS] Invalid state provided");
      return { result: "ongoing", error: "Invalid state" };
    }

    let game = gameInstance;
    if (!game) {
      if (!state.fen) {
        console.error("[CRAZYHOUSE_STANDARD_STATUS] Missing FEN in game state");
        return { result: "ongoing", error: "Missing FEN" };
      }
      try {
        game = new Chess(state.fen);
      } catch (error) {
        console.error("[CRAZYHOUSE_STANDARD_STATUS] Error reconstructing game from FEN:", error);
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

    // Crazyhouse repetition must include the pocketed pieces state
    if (!(state.repetitionMap instanceof Map)) {
      state.repetitionMap = new Map(Object.entries(state.repetitionMap || {}));
    }
    const crazyhouseFen = getCrazyhouseFenForRepetition(game.fen(), state.pocketedPieces);
    const repetitionCount = state.repetitionMap.get(crazyhouseFen) || 0;
    if (repetitionCount >= 3) return { result: "draw", reason: "threefold repetition (crazyhouse)", winnerColor: null };

    // Chess.com Crazyhouse implements 50-move and 75-move rules for draws.
    // Chess.js's isDraw() includes 50-move rule.
    if (game.isDraw()) return { result: "draw", reason: "50-move rule", winnerColor: null };

    // 75-move rule (150 half-moves)
    if (state.moveHistory && state.moveHistory.length >= 150)
      return { result: "draw", reason: "75-move rule", winnerColor: null };

    return { result: "ongoing", winnerColor: null };
  } catch (error) {
    console.error("Error checking crazyhouse standard game status:", error);
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
      // Sort pocketed pieces to ensure consistent FEN for repetition checking
      const whitePocket = state.pocketedPieces.white.slice().sort().join('');
      const blackPocket = state.pocketedPieces.black.slice().sort().join('');
      repetitionFen += `[${whitePocket}][${blackPocket}]`;
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
    // Only the board position (first part of FEN) matters for Chess.js's internal FEN
    // For Crazyhouse, we append the pocket state to create a unique repetition key.
    let crazyhouseFen = fen.split(' ')[0];
    // Sort pocketed pieces to ensure consistency for repetition checks
    const whitePocket = pocketedPieces.white.slice().sort().join('');
    const blackPocket = pocketedPieces.black.slice().sort().join('');
    crazyhouseFen += `[${whitePocket}][${blackPocket}]`;
    return crazyhouseFen;
}