import { Chess } from "chess.js"

// Helper: Validate ObjectId format (Keep existing)
export function isValidObjectId(id) {
  if (!id) return false
  if (typeof id !== "string") return false
  return /^[0-9a-fA-F]{24}$/.test(id)
}

// Helper: Safely handle ObjectId operations (Keep existing)
export function safeObjectId(id, fallback = null) {
  try {
    if (!id) return fallback
    if (typeof id === "string" && isValidObjectId(id)) {
      return id
    }
    if (typeof id === "object" && id.toString && isValidObjectId(id.toString())) {
      return id.toString()
    }
    console.warn("[ObjectId] Invalid ObjectId format:", id)
    return fallback
  } catch (error) {
    console.error("[ObjectId] Error processing ObjectId:", error)
    return fallback
  }
}

// Helper: Validate and sanitize user data for database operations (Keep existing)
export function sanitizeUserData(userData) {
  try {
    if (!userData || typeof userData !== "object") {
      return null
    }
    const sanitized = {}
    // Handle user ID
    if (userData.userId) {
      const validUserId = safeObjectId(userData.userId)
      if (validUserId) {
        sanitized.userId = validUserId
      } else {
        console.warn("[SANITIZE] Invalid userId:", userData.userId)
        return null
      }
    }
    // Handle session ID
    if (userData.sessionId) {
      const validSessionId = safeObjectId(userData.sessionId)
      if (validSessionId) {
        sanitized.sessionId = validSessionId
      } else {
        console.warn("[SANITIZE] Invalid sessionId:", userData.sessionId)
        return null
      }
    }
    // Copy other safe fields
    const safeFields = ["username", "rating", "avatar", "title"]
    safeFields.forEach((field) => {
      if (userData[field] !== undefined) {
        sanitized[field] = userData[field]
      }
    })
    return sanitized
  } catch (error) {
    console.error("[SANITIZE] Error sanitizing user data:", error)
    return null
  }
}

// Helper: Safe database operation wrapper (Keep existing)
export async function safeDatabaseOperation(operation, context = "unknown") {
  try {
    console.log(`[DB] Starting ${context} operation`)
    const result = await operation()
    console.log(`[DB] Completed ${context} operation successfully`)
    return { success: true, data: result }
  } catch (error) {
    console.error(`[DB] Error in ${context} operation:`, error.message)
    // Handle specific MongoDB errors
    if (error.name === "CastError" && error.path === "_id") {
      return {
        success: false,
        error: "Invalid ID format",
        code: "INVALID_OBJECT_ID",
        context: context,
      }
    }
    if (error.name === "ValidationError") {
      return {
        success: false,
        error: "Data validation failed",
        code: "VALIDATION_ERROR",
        context: context,
        details: error.errors,
      }
    }
    if (error.code === 11000) {
      return {
        success: false,
        error: "Duplicate key error",
        code: "DUPLICATE_KEY",
        context: context,
      }
    }
    return {
      success: false,
      error: error.message || "Database operation failed",
      code: "DB_ERROR",
      context: context,
    }
  }
}

// --- Crazyhouse withTimer Constants ---
const DROP_TIME_LIMIT = 10000 // 10 seconds in ms
const BASE_TIME = 180000 // 3 minutes in ms
const INCREMENT_TIME = 2000 // 2 seconds increment per move

// Create initial state for a Crazyhouse withTimer game
export function createCrazyhouseInitialState() {
  try {
    const game = new Chess() // default position
    const fen = game.fen()
    const [position, activeColor, castlingRights, enPassantSquare, halfmoveClock, fullmoveNumber] = fen.split(" ")
    const now = Date.now()
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
      // Derived state: pieces in pocket that are not currently available for drop
      frozenPieces: {
        white: [],
        black: [],
      },
    }
  } catch (error) {
    console.error("Error creating crazyhouse initial state:", error)
    throw error
  }
}

// Update game timers and check for expired dropped pieces
function updateCrazyhouseTimers(state, currentTimestamp) {
  if (state.gameEnded) return

  const game = new Chess(state.fen)
  const currentPlayer = game.turn()
  const currentPlayerColor = currentPlayer === "w" ? "white" : "black"

  // Deduct time from current player's main clock
  if (state.gameStarted && state.turnStartTimestamp) {
    const elapsed = currentTimestamp - state.turnStartTimestamp
    if (currentPlayer === "w") {
      state.whiteTime = Math.max(0, state.whiteTime - elapsed)
    } else {
      state.blackTime = Math.max(0, state.blackTime - elapsed)
    }
  }

  // Sequential drop timer logic - ONLY for the active player
  const activeColorForDropTimer = currentPlayerColor // The player whose turn it is
  const pocket = state.pocketedPieces[activeColorForDropTimer]
  const timers = state.dropTimers[activeColorForDropTimer]

  if (pocket.length > 0 && timers.size > 0) {
    const firstPiece = pocket[0]
    const timerKey = firstPiece.id
    const expirationTimestamp = timers.get(timerKey)

    // If the timer for the active player's droppable piece has expired
    if (expirationTimestamp && currentTimestamp >= expirationTimestamp) {
      // Remove expired piece from pocket and timer
      pocket.shift()
      timers.delete(timerKey)
      console.log(`Removed expired ${firstPiece.type} from ${activeColorForDropTimer}'s pocket due to timeout.`)

      // Start timer for next piece, if any, for the *same* player
      if (pocket.length > 0) {
        const nextPiece = pocket[0]
        timers.set(nextPiece.id, currentTimestamp + DROP_TIME_LIMIT)
        console.log(`Started timer for next piece ${nextPiece.type} in ${activeColorForDropTimer}'s pocket.`)
      }
    }
  }
  // frozenPieces will be derived when the state is returned
}

// Handle piece drop logic
function handlePieceDrop(state, move, playerColor, game) {
  const playerPocket = state.pocketedPieces[playerColor]
  const playerDropTimers = state.dropTimers[playerColor]
  const now = Date.now()

  console.log(`Handling piece drop for ${playerColor}:`, state.pocketedPieces, "Timers:", state.dropTimers)

  // Sequential drop: only first piece in pocket is available
  if (playerPocket.length === 0) {
    return { valid: false, reason: "No pieces in pocket", code: "PIECE_NOT_IN_POCKET" }
  }

  const firstPiece = playerPocket[0]
  if (move.piece !== firstPiece.type) {
    return { valid: false, reason: `Only ${firstPiece.type} can be dropped next`, code: "SEQUENTIAL_DROP_ONLY" }
  }

  const timerKey = firstPiece.id
  const expirationTimestamp = playerDropTimers.get(timerKey)

  if (!expirationTimestamp) {
    return { valid: false, reason: `No timer found for piece ${firstPiece.type}`, code: "PIECE_NOT_AVAILABLE" }
  }

  if (now >= expirationTimestamp) {
    // Piece expired, remove from pocket and timer
    playerPocket.shift()
    playerDropTimers.delete(timerKey)
    // Start timer for next piece, if any
    if (playerPocket.length > 0) {
      const nextPiece = playerPocket[0]
      playerDropTimers.set(nextPiece.id, now + DROP_TIME_LIMIT)
    }
    console.warn(`Attempted to drop expired piece: ${firstPiece.type}. Removed from pocket.`)
    return { valid: false, reason: `Piece ${firstPiece.type} drop limit expired`, code: "DROP_EXPIRED" }
  }

  // Validate standard Crazyhouse drop rules
  const targetRank = Number.parseInt(move.to[1])
  if (firstPiece.type.toLowerCase() === "p" && (targetRank === 1 || targetRank === 8)) {
    return { valid: false, reason: "Pawns cannot be dropped on 1st or 8th rank", code: "INVALID_PAWN_DROP" }
  }
  if (game.get(move.to)) {
    return { valid: false, reason: "Cannot drop on an occupied square", code: "SQUARE_OCCUPIED" }
  }

  // Apply the drop
  try {
    game.put({ type: firstPiece.type, color: playerColor === "white" ? "w" : "b" }, move.to)
    playerPocket.shift() // Remove from pocket
    playerDropTimers.delete(timerKey) // Remove timer

    // Start timer for next piece, if any
    if (playerPocket.length > 0) {
      const nextPiece = playerPocket[0]
      playerDropTimers.set(nextPiece.id, now + DROP_TIME_LIMIT)
    }

    return { valid: true, game: game }
  } catch (error) {
    console.error("Chess.js put error during drop:", error)
    return { valid: false, reason: "Illegal drop: " + error.message, code: "CHESS_JS_ERROR" }
  }
}

// Validate a move or piece drop and apply Crazyhouse withTimer rules
export function validateAndApplyCrazyhouseMove(state, move, playerColor, currentTimestamp) {
  try {
    console.log("=== CRAZYHOUSE MOVE VALIDATION START ===")
    console.log("Move/Drop:", move, "Player:", playerColor)

    if (!validateInputs(state, move, playerColor)) {
      return { valid: false, reason: "Invalid input parameters", code: "INVALID_INPUT" }
    }

    if (!currentTimestamp || typeof currentTimestamp !== "number") {
      currentTimestamp = Date.now()
    }

    if (state.gameEnded) {
      return {
        valid: false,
        reason: "Game has already ended",
        gameEnded: true,
        shouldNavigateToMenu: true,
        code: "GAME_ENDED",
      }
    }

    // Initialize state defaults if needed
    initializeStateDefaults(state, currentTimestamp)

    // Reconstruct game from FEN
    let game
    try {
      game = new Chess(state.fen)
      state.game = game // Attach to state for helpers
    } catch (error) {
      console.error("Error reconstructing game from FEN:", error)
      return { valid: false, reason: "Invalid game state (FEN)", code: "INVALID_FEN" }
    }

    // Check turn
    const currentPlayerBeforeMove = game.turn()
    const currentPlayerColor = currentPlayerBeforeMove === "w" ? "white" : "black"
    if (currentPlayerColor !== playerColor) {
      return { valid: false, reason: "Not your turn", code: "WRONG_TURN" }
    }

    // Update timers *before* processing the current move/drop
    updateCrazyhouseTimers(state, currentTimestamp)

    // After updating, check for timeout
    const timeoutResult = checkForTimeout(state, currentTimestamp)
    if (timeoutResult.gameEnded) {
      return timeoutResult
    }

    let moveResult
    let isDrop = false
    if (move.drop === true) {
      isDrop = true
      moveResult = handlePieceDrop(state, move, playerColor, game)
    } else {
      // Standard chess move
      moveResult = validateChessMove(state, move, playerColor, currentTimestamp)

      // If it's a capture, add to pocketedPieces and start drop timer if pocket was empty
      if (moveResult.valid && moveResult.capturedPiece) {
        const capturedPieceType = moveResult.capturedPiece.type.toLowerCase()
        const capturingPlayerColor = playerColor
        const pieceId = `${capturedPieceType}_${Date.now()}`
        const pieceObj = { type: capturedPieceType, id: pieceId, capturedAt: currentTimestamp }

        const pocket = state.pocketedPieces[capturingPlayerColor]
        const timers = state.dropTimers[capturingPlayerColor]

        const wasEmpty = pocket.length === 0
        pocket.push(pieceObj)

        if (wasEmpty) {
          timers.set(pieceId, currentTimestamp + DROP_TIME_LIMIT)
        }
        // If not empty, timer will be started when previous piece is dropped/expired
        console.log(`${capturingPlayerColor} captured ${capturedPieceType}. Added to pocket.`)
      }
    }

    if (!moveResult.valid) {
      return moveResult // Return error from move/drop validation
    }

    // Update game state after successful move/drop
    updateGameStateAfterMove(state, moveResult, currentTimestamp, isDrop)

    // Check game status
    const gameStatus = checkCrazyhouseGameStatus(state, game)
    if (gameStatus.result !== "ongoing") {
      finalizeGameEnd(state, gameStatus, currentTimestamp)
    }

    console.log("======= Drop Timers State =======", state.dropTimers)
    if (state.game) delete state.game // Clean up temp Chess instance
    console.log("=== CRAZYHOUSE MOVE VALIDATION END ===")

    return createMoveResult(state, moveResult, gameStatus)
  } catch (error) {
    console.error("Error in validateAndApplyCrazyhouseMove:", error)
    return {
      valid: false,
      reason: "Internal error during move validation",
      error: error.message,
      code: "INTERNAL_ERROR",
    }
  }
}

// Helper functions for better organization (largely reused from decay, with adjustments)
function validateInputs(state, move, playerColor) {
  if (!state || typeof state !== "object") return false
  // Move can be a standard move { from, to } or a drop { type: 'drop', piece: 'p', to: 'e4' }
  if (!move || typeof move !== "object") return false
  if (!playerColor || (playerColor !== "white" && playerColor !== "black")) return false
  if (move.drop === true) {
    if (!move.piece || !move.to) return false
  } else {
    if (!move.from || !move.to) return false
  }
  return true
}

function initializeStateDefaults(state, currentTimestamp) {
  if (typeof state.turnStartTimestamp !== "number") state.turnStartTimestamp = currentTimestamp
  if (typeof state.lastMoveTimestamp !== "number") state.lastMoveTimestamp = currentTimestamp
  if (typeof state.whiteTime !== "number") state.whiteTime = BASE_TIME
  if (typeof state.blackTime !== "number") state.blackTime = BASE_TIME
  if (!state.moveHistory) state.moveHistory = []
  if (typeof state.gameStarted !== "boolean") state.gameStarted = false
  if (!state.firstMoveTimestamp) state.firstMoveTimestamp = null
  if (!state.capturedPieces) state.capturedPieces = { white: [], black: [] } // Legacy, now pocketedPieces
  if (!state.pocketedPieces) state.pocketedPieces = { white: [], black: [] }
  if (!state.dropTimers) state.dropTimers = { white: new Map(), black: new Map() }
  else {
    // Ensure Maps are rehydrated if they come from a plain object (e.g., database)
    state.dropTimers.white = new Map(Object.entries(state.dropTimers.white || {}))
    state.dropTimers.black = new Map(Object.entries(state.dropTimers.black || {}))
  }
  if (typeof state.gameEnded !== "boolean") state.gameEnded = false
  if (!state.frozenPieces) state.frozenPieces = { white: [], black: [] } // Initialize if not present
}

function checkForTimeout(state, currentTimestamp) {
  // We already updated timers in updateCrazyhouseTimers before calling this.
  // So, just check the current state of times.
  if (state.whiteTime <= 0) {
    return createTimeoutResult(state, "black", "White ran out of time", currentTimestamp)
  }
  if (state.blackTime <= 0) {
    return createTimeoutResult(state, "white", "Black ran out of time", currentTimestamp)
  }
  return { gameEnded: false }
}

function createTimeoutResult(state, winner, reason, currentTimestamp) {
  state.gameEnded = true
  state.endReason = "timeout"
  state.winnerColor = winner
  state.winner = null // Assuming winner username/ID comes from outside state.players
  state.endTimestamp = currentTimestamp
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
  }
}

function validateChessMove(state, move, playerColor, currentTimestamp) {
  const game = state.game // Chess instance already created in main function

  // Check turn (already done in main function, but good for self-contained helper)
  const currentPlayerBeforeMove = game.turn()
  const currentPlayerColor = currentPlayerBeforeMove === "w" ? "white" : "black"
  if (currentPlayerColor !== playerColor) {
    return { valid: false, reason: "Not your turn", code: "WRONG_TURN" }
  }

  // Handle timing for first move
  if (!state.gameStarted || state.moveHistory.length === 0) {
    console.log("FIRST MOVE DETECTED - Starting game timers")
    state.gameStarted = true
    state.firstMoveTimestamp = currentTimestamp
    state.turnStartTimestamp = currentTimestamp
    state.lastMoveTimestamp = currentTimestamp
  }

  // Time deduction for current player already handled by `updateCrazyhouseTimers` before this.

  // Validate and apply the move
  let result
  try {
    result = game.move(move)
  } catch (error) {
    console.error("Chess.js move error:", error)
    return { valid: false, reason: "Invalid move", code: "CHESS_JS_ERROR", details: error.message }
  }

  if (!result) return { valid: false, reason: "Illegal move", code: "ILLEGAL_MOVE" }

  return {
    valid: true,
    result: result,
    game: game,
    capturedPiece: result.captured ? { type: result.captured, color: result.color } : null, // Chess.js provides captured piece
    currentPlayerBeforeMove: currentPlayerBeforeMove,
  }
}

function updateGameStateAfterMove(state, moveResult, currentTimestamp, isDrop) {
  const { result, capturedPiece, currentPlayerBeforeMove, game } = moveResult

  // Captured piece handling for Crazyhouse is done in validateAndApplyCrazyhouseMove
  // for regular moves. For drops, there's no capture.

  // Update state after successful move/drop
  const oldFen = state.fen
  state.fen = game.fen()
  state.lastMoveTimestamp = currentTimestamp

  // Add increment to the player who just moved (3+2 time control)
  if (currentPlayerBeforeMove === "w") {
    state.whiteTime += state.increment
  } else {
    state.blackTime += state.increment
  }

  // Reset turn start timestamp for the NEXT player's turn
  state.turnStartTimestamp = currentTimestamp
  state.moveHistory.push(result)

  // Update the active color
  const newActivePlayer = game.turn()
  state.activeColor = newActivePlayer === "w" ? "white" : "black"

  console.log("Move/Drop completed:")
  console.log("- FEN changed from:", oldFen.split(" ")[0], "to:", state.fen.split(" ")[0])
  console.log("- Next player's turn:", newActivePlayer, "Active color:", state.activeColor)
  console.log("- Final times - White:", state.whiteTime, "Black:", state.blackTime)

  // Update repetition tracking (Crazyhouse repetition includes pocketed pieces)
  updateRepetitionMap(state, game, true) // true for Crazyhouse FEN
}

function finalizeGameEnd(state, gameStatus, currentTimestamp) {
  state.gameEnded = true
  state.endReason = gameStatus.result
  state.winnerColor = gameStatus.winnerColor || null
  state.endTimestamp = currentTimestamp
}

function createMoveResult(state, moveResult, gameStatus) {
  // Derive frozenPieces for the current state
  const derivedFrozenPieces = {
    white: [],
    black: [],
  }

  // For white
  if (state.pocketedPieces.white.length > 0) {
    const firstWhitePiece = state.pocketedPieces.white[0]
    // If the first piece has an active timer, the rest are frozen
    if (state.dropTimers.white.has(firstWhitePiece.id)) {
      derivedFrozenPieces.white = state.pocketedPieces.white.slice(1)
    } else {
      // If no timer for the first piece (e.g., it expired or was dropped, and no new timer started yet),
      // then all pieces in the pocket are considered frozen/unavailable until a new timer starts.
      derivedFrozenPieces.white = state.pocketedPieces.white
    }
  }

  // For black
  if (state.pocketedPieces.black.length > 0) {
    const firstBlackPiece = state.pocketedPieces.black[0]
    if (state.dropTimers.black.has(firstBlackPiece.id)) {
      derivedFrozenPieces.black = state.pocketedPieces.black.slice(1)
    } else {
      derivedFrozenPieces.black = state.pocketedPieces.black
    }
  }

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
    dropTimers: {
      // Convert Maps to plain objects for easier serialization if needed
      white: Object.fromEntries(state.dropTimers.white),
      black: Object.fromEntries(state.dropTimers.black),
    },
    frozenPieces: derivedFrozenPieces, // Add derived frozen pieces here
  }

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
  }
}

// Get current timer values including drop timers
export function getCurrentCrazyhouseTimers(state, currentTimestamp) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[CRAZYHOUSE_TIMER] Invalid state provided")
      return {
        white: BASE_TIME,
        black: BASE_TIME,
        activeColor: "white",
        gameEnded: false,
        error: "Invalid state",
      }
    }

    if (!currentTimestamp || typeof currentTimestamp !== "number") {
      currentTimestamp = Date.now()
    }

    // Re-hydrate Maps if necessary (e.g., state loaded from DB)
    if (!(state.dropTimers.white instanceof Map)) {
      state.dropTimers.white = new Map(Object.entries(state.dropTimers.white || {}))
    }
    if (!(state.dropTimers.black instanceof Map)) {
      state.dropTimers.black = new Map(Object.entries(state.dropTimers.black || {}))
    }

    // If game has ended, return final values
    if (state.gameEnded) {
      // Derive frozenPieces for the final state
      const derivedFrozenPieces = {
        white: [],
        black: [],
      }
      if (state.pocketedPieces.white.length > 0) {
        const firstWhitePiece = state.pocketedPieces.white[0]
        if (state.dropTimers.white.has(firstWhitePiece.id)) {
          derivedFrozenPieces.white = state.pocketedPieces.white.slice(1)
        } else {
          derivedFrozenPieces.white = state.pocketedPieces.white
        }
      }
      if (state.pocketedPieces.black.length > 0) {
        const firstBlackPiece = state.pocketedPieces.black[0]
        if (state.dropTimers.black.has(firstBlackPiece.id)) {
          derivedFrozenPieces.black = state.pocketedPieces.black.slice(1)
        } else {
          derivedFrozenPieces.black = state.pocketedPieces.black
        }
      }

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
          black: Object.fromEntries(state.dropTimers.black),
        },
        frozenPieces: derivedFrozenPieces, // Add derived frozen pieces here
      }
    }

    // For first move, don't deduct time
    if (!state.gameStarted || !state.turnStartTimestamp || state.moveHistory.length === 0) {
      // Derive frozenPieces for the initial/pre-game state (will be empty)
      const derivedFrozenPieces = {
        white: [],
        black: [],
      }

      return {
        white: state.whiteTime || BASE_TIME,
        black: state.blackTime || BASE_TIME,
        activeColor: state.activeColor || "white",
        gameEnded: false,
        pocketedPieces: state.pocketedPieces,
        dropTimers: {
          white: Object.fromEntries(state.dropTimers.white),
          black: Object.fromEntries(state.dropTimers.black),
        },
        frozenPieces: derivedFrozenPieces, // Add derived frozen pieces here
      }
    }

    // Temporarily update timers to reflect current time before returning
    const tempState = JSON.parse(JSON.stringify(state)) // Deep copy to avoid modifying original state for this read operation
    tempState.dropTimers.white = new Map(Object.entries(state.dropTimers.white))
    tempState.dropTimers.black = new Map(Object.entries(state.dropTimers.black))

    updateCrazyhouseTimers(tempState, currentTimestamp) // Use tempState for calculation

    // Check for timeout after temp update
    if (tempState.whiteTime <= 0) {
      // This means white timed out, black wins
      state.gameEnded = true
      state.endReason = "timeout"
      state.winnerColor = "black"
      state.winner = null
      state.endTimestamp = currentTimestamp

      // Derive frozenPieces for the timeout state
      const derivedFrozenPieces = {
        white: [],
        black: [],
      }
      if (tempState.pocketedPieces.white.length > 0) {
        const firstWhitePiece = tempState.pocketedPieces.white[0]
        if (tempState.dropTimers.white.has(firstWhitePiece.id)) {
          derivedFrozenPieces.white = tempState.pocketedPieces.white.slice(1)
        } else {
          derivedFrozenPieces.white = tempState.pocketedPieces.white
        }
      }
      if (tempState.pocketedPieces.black.length > 0) {
        const firstBlackPiece = tempState.pocketedPieces.black[0]
        if (tempState.dropTimers.black.has(firstBlackPiece.id)) {
          derivedFrozenPieces.black = tempState.pocketedPieces.black.slice(1)
        } else {
          derivedFrozenPieces.black = tempState.pocketedPieces.black
        }
      }

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
          black: Object.fromEntries(state.dropTimers.black),
        },
        frozenPieces: derivedFrozenPieces, // Add derived frozen pieces here
      }
    }

    if (tempState.blackTime <= 0) {
      // This means black timed out, white wins
      state.gameEnded = true
      state.endReason = "timeout"
      state.winnerColor = "white"
      state.winner = null
      state.endTimestamp = currentTimestamp

      // Derive frozenPieces for the timeout state
      const derivedFrozenPieces = {
        white: [],
        black: [],
      }
      if (tempState.pocketedPieces.white.length > 0) {
        const firstWhitePiece = tempState.pocketedPieces.white[0]
        if (tempState.dropTimers.white.has(firstWhitePiece.id)) {
          derivedFrozenPieces.white = tempState.pocketedPieces.white.slice(1)
        } else {
          derivedFrozenPieces.white = tempState.pocketedPieces.white
        }
      }
      if (tempState.pocketedPieces.black.length > 0) {
        const firstBlackPiece = tempState.pocketedPieces.black[0]
        if (tempState.dropTimers.black.has(firstBlackPiece.id)) {
          derivedFrozenPieces.black = tempState.pocketedPieces.black.slice(1)
        } else {
          derivedFrozenPieces.black = tempState.pocketedPieces.black
        }
      }

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
          black: Object.fromEntries(state.dropTimers.black),
        },
        frozenPieces: derivedFrozenPieces, // Add derived frozen pieces here
      }
    }

    console.log("Current Crazyhouse timers:", state.dropTimers)

    // Derive frozenPieces for the current ongoing state
    const derivedFrozenPieces = {
      white: [],
      black: [],
    }
    if (tempState.pocketedPieces.white.length > 0) {
      const firstWhitePiece = tempState.pocketedPieces.white[0]
      if (tempState.dropTimers.white.has(firstWhitePiece.id)) {
        derivedFrozenPieces.white = tempState.pocketedPieces.white.slice(1)
      } else {
        derivedFrozenPieces.white = tempState.pocketedPieces.white
      }
    }
    if (tempState.pocketedPieces.black.length > 0) {
      const firstBlackPiece = tempState.pocketedPieces.black[0]
      if (tempState.dropTimers.black.has(firstBlackPiece.id)) {
        derivedFrozenPieces.black = tempState.pocketedPieces.black.slice(1)
      } else {
        derivedFrozenPieces.black = tempState.pocketedPieces.black
      }
    }

    return {
      white: tempState.whiteTime,
      black: tempState.blackTime,
      activeColor: tempState.activeColor,
      gameEnded: false,
      pocketedPieces: tempState.pocketedPieces,
      dropTimers: {
        // Convert Maps to plain objects for return
        white: Object.fromEntries(tempState.dropTimers.white),
        black: Object.fromEntries(tempState.dropTimers.black),
      },
      frozenPieces: derivedFrozenPieces, // Add derived frozen pieces here
    }
  } catch (error) {
    console.error("Error in getCurrentCrazyhouseTimers:", error)
    return {
      white: state?.whiteTime || BASE_TIME,
      black: state?.blackTime || BASE_TIME,
      activeColor: state?.activeColor || "white",
      gameEnded: false,
      error: error.message,
    }
  }
}

// Generate legal moves and possible piece drops
export function getCrazyhouseLegalMoves(fen, pocketedPieces, dropTimers, playerColor) {
  try {
    if (!fen || typeof fen !== "string") {
      console.error("[CRAZYHOUSE_MOVES] Invalid FEN provided:", fen)
      return []
    }

    const game = new Chess(fen)
    const allBoardMoves = game.moves({ verbose: true })
    const legalMoves = [...allBoardMoves]

    // Add possible piece drops
    if (pocketedPieces && pocketedPieces[playerColor]) {
      const currentPlayerPocket = pocketedPieces[playerColor]
      const currentPlayerDropTimers = new Map(Object.entries(dropTimers[playerColor] || {})) // Ensure Map
      const now = Date.now()

      // In the "withTimer" subvariant, only the first piece in the pocket can be dropped,
      // and only if its timer hasn't expired.
      if (currentPlayerPocket.length > 0) {
        const firstPieceInPocket = currentPlayerPocket[0]
        const timerKey = firstPieceInPocket.id
        const expirationTimestamp = currentPlayerDropTimers.get(timerKey)

        // Check if the first piece is currently droppable (timer active and not expired)
        if (expirationTimestamp && now < expirationTimestamp) {
          const pieceType = firstPieceInPocket.type
          for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
              const square = String.fromCharCode(97 + col) + (row + 1)

              // Standard Crazyhouse drop rules
              if (pieceType.toLowerCase() === "p" && (row === 0 || row === 7)) {
                continue // Pawns cannot be dropped on 1st or 8th rank
              }

              if (!game.get(square)) {
                // Square must be empty for a drop
                try {
                  // Temporarily apply the drop to check legality (e.g., not self-check)
                  const tempGame = new Chess(fen)
                  tempGame.put({ type: pieceType, color: playerColor === "white" ? "w" : "b" }, square)

                  // If putting the piece doesn't immediately result in an illegal state for the current player
                  if (!tempGame.inCheck()) {
                    legalMoves.push({
                      from: "pocket", // Special 'from' to denote a drop
                      to: square,
                      piece: pieceType,
                      color: playerColor === "white" ? "w" : "b",
                      captured: null,
                      promotion: null,
                      san: `${pieceType.toUpperCase()}@${square}`, // Standard Algebraic Notation for drops
                      flags: "d", // 'd' for drop
                    })
                  }
                } catch (e) {
                  // Illegal drop (e.g., trying to put a second king)
                }
              }
            }
          }
        }
      }
    }
    return legalMoves
  } catch (error) {
    console.error("Error getting crazyhouse legal moves:", error)
    return []
  }
}

// Check game status including Crazyhouse specific conditions
export function checkCrazyhouseGameStatus(state, gameInstance) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[CRAZYHOUSE_STATUS] Invalid state provided")
      return { result: "ongoing", error: "Invalid state" }
    }

    let game = gameInstance
    if (!game) {
      if (!state.fen) {
        console.error("[CRAZYHOUSE_STATUS] Missing FEN in game state")
        return { result: "ongoing", error: "Missing FEN" }
      }
      try {
        game = new Chess(state.fen)
      } catch (error) {
        console.error("[CRAZYHOUSE_STATUS] Error reconstructing game from FEN:", error)
        return { result: "ongoing", error: "Invalid FEN" }
      }
    }

    // Check for time-based wins first
    if (state.whiteTime <= 0) return { result: "timeout", winnerColor: "black", reason: "white ran out of time" }
    if (state.blackTime <= 0) return { result: "timeout", winnerColor: "white", reason: "black ran out of time" }

    // Check for checkmate
    if (game.isCheckmate()) {
      const winnerColor = game.turn() === "w" ? "black" : "white"
      console.log(`CHECKMATE DETECTED: ${winnerColor} wins!`)
      return { result: "checkmate", winnerColor: winnerColor }
    }

    // Check for other draw conditions
    if (game.isStalemate()) return { result: "draw", reason: "stalemate", winnerColor: null }
    if (game.isInsufficientMaterial()) return { result: "draw", reason: "insufficient material", winnerColor: null }

    // Chess.js's isThreefoldRepetition relies on standard FEN, which doesn't include pocket.
    // We need a custom check for Crazyhouse, which updateRepetitionMap helps with.
    // If the FEN+pocket has appeared 3 times, it's a draw.
    if (!(state.repetitionMap instanceof Map)) {
      state.repetitionMap = new Map(Object.entries(state.repetitionMap || {}))
    }
    const crazyhouseFen = getCrazyhouseFenForRepetition(game.fen(), state.pocketedPieces)
    const repetitionCount = state.repetitionMap.get(crazyhouseFen) || 0
    if (repetitionCount >= 3) return { result: "draw", reason: "threefold repetition (crazyhouse)", winnerColor: null }

    // Check 50-move rule: Crazyhouse has no 50-move rule usually because drops reset it.
    // However, if Chess.js `isDraw()` handles it, we can keep it for general draws.
    // If we want to strictly follow Crazyhouse rules, this should be modified.
    // For now, let's keep it as Chess.js `isDraw` handles standard rules.
    if (game.isDraw()) return { result: "draw", reason: "50-move rule", winnerColor: null }

    // Crazyhouse typically has a 75-move rule.
    if (state.moveHistory && state.moveHistory.length >= 150)
      // 150 half-moves = 75 full moves
      return { result: "draw", reason: "75-move rule", winnerColor: null }

    return { result: "ongoing", winnerColor: null }
  } catch (error) {
    console.error("Error checking crazyhouse game status:", error)
    return { result: "ongoing", error: error.message, winnerColor: null }
  }
}

// Helper: track FEN repetitions for Crazyhouse (includes pocketed pieces)
export function updateRepetitionMap(state, gameInstance, isCrazyhouse = false) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[REPETITION] Invalid state provided")
      return
    }

    let fen
    if (gameInstance) {
      fen = gameInstance.fen()
    } else if (state.fen) {
      fen = state.fen
    } else {
      console.error("[REPETITION] Missing FEN in game state")
      return
    }

    if (!fen || typeof fen !== "string") {
      console.error("[REPETITION] Invalid FEN format:", fen)
      return
    }

    // For Crazyhouse, repetition must include the pocketed pieces state
    let repetitionFen = fen
    if (isCrazyhouse && state.pocketedPieces) {
      repetitionFen += `[${state.pocketedPieces.white.map((p) => p.type).join("")}]`
      repetitionFen += `[${state.pocketedPieces.black.map((p) => p.type).join("")}]`
    }

    if (!(state.repetitionMap instanceof Map)) {
      state.repetitionMap = new Map(Object.entries(state.repetitionMap || {}))
    }

    const current = state.repetitionMap.get(repetitionFen) || 0
    state.repetitionMap.set(repetitionFen, current + 1)
    console.log("Repetition map updated for Crazyhouse FEN:", repetitionFen, "Count:", current + 1)
  } catch (error) {
    console.error("Error updating repetition map:", error)
  }
}

// Helper: Generate a Crazyhouse FEN string for repetition checking
function getCrazyhouseFenForRepetition(fen, pocketedPieces) {
  let crazyhouseFen = fen.split(" ")[0] // Only the board position
  // For sequential pocket, join types in order
  const whitePocket = pocketedPieces.white.map((p) => p.type).join("")
  const blackPocket = pocketedPieces.black.map((p) => p.type).join("")
  crazyhouseFen += `[${whitePocket}][${blackPocket}]`
  return crazyhouseFen
}
