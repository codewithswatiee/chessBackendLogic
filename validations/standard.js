import { Chess } from "chess.js"

// Helper: Recursively convert BigInt values to Number for JSON serialization
export function convertBigIntToNumber(obj) {
  if (typeof obj === "bigint") {
    return Number(obj)
  } else if (Array.isArray(obj)) {
    return obj.map(convertBigIntToNumber)
  } else if (obj && typeof obj === "object") {
    const newObj = {}
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        newObj[key] = convertBigIntToNumber(obj[key])
      }
    }
    return newObj
  }
  return obj
}

// Helper: Validate ObjectId format
export function isValidObjectId(id) {
  if (!id) return false
  if (typeof id !== "string") return false
  // MongoDB ObjectId is 24 characters hex string
  return /^[0-9a-fA-F]{24}$/.test(id)
}

// Helper: Safely handle ObjectId operations
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

// Helper: Validate and sanitize user data for database operations
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

// Helper: Safe database operation wrapper
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

// Create initial state for a 10-minute game
export function createInitialState() {
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
      whiteTime: 600000, // 10 minutes in ms
      blackTime: 600000,
      turnStartTimestamp: now,
      lastMoveTimestamp: now,
      moveHistory: [],
      gameStarted: false, // Track if game has actually started
      firstMoveTimestamp: null, // Track when the first move was made
      capturedPieces: {
        white: [], // Pieces captured by white (black pieces)
        black: [], // Pieces captured by black (white pieces)
      },
      gameEnded: false, // Track if game has ended
      endReason: null, // Reason for game ending
      winner: null, // Winner of the game
      endTimestamp: null, // When the game ended
    }
  } catch (error) {
    console.error("Error creating initial state:", error)
    throw error
  }
}

// Validate a move and update timers properly
export function validateAndApplyMove(state, move, playerColor, currentTimestamp) {
  try {
    console.log("=== MOVE VALIDATION START ===")
    console.log("Move:", move, "Player:", playerColor)
    console.log("Game started:", state.gameStarted, "First move timestamp:", state.firstMoveTimestamp)
    console.log("Current state - White time:", state.whiteTime, "Black time:", state.blackTime)
    console.log("Turn start timestamp:", state.turnStartTimestamp)

    // Validate input parameters
    if (!state || typeof state !== "object") {
      return { valid: false, reason: "Invalid game state", code: "INVALID_STATE" }
    }

    if (!move || typeof move !== "object" || !move.from || !move.to) {
      return { valid: false, reason: "Invalid move format", code: "INVALID_MOVE" }
    }

    if (!playerColor || (playerColor !== "white" && playerColor !== "black")) {
      return { valid: false, reason: "Invalid player color", code: "INVALID_PLAYER" }
    }

    if (!currentTimestamp || typeof currentTimestamp !== "number") {
      currentTimestamp = Date.now()
    }

    // Check if game has already ended
    if (state.gameEnded) {
      return {
        valid: false,
        reason: "Game has already ended",
        gameEnded: true,
        shouldNavigateToMenu: true,
        code: "GAME_ENDED",
      }
    }

    // Always reconstruct game from FEN to avoid corrupted Chess.js instances after deserialization
    let game
    if (state.fen) {
      try {
        game = new Chess(state.fen)
        state.game = game
      } catch (error) {
        console.error("Error reconstructing game from FEN:", error)
        return { valid: false, reason: "Invalid game state", code: "INVALID_FEN" }
      }
    } else {
      return { valid: false, reason: "Invalid state: missing FEN", code: "MISSING_FEN" }
    }

    // Initialize timer values if missing
    if (typeof state.turnStartTimestamp !== "number") state.turnStartTimestamp = currentTimestamp
    if (typeof state.lastMoveTimestamp !== "number") state.lastMoveTimestamp = currentTimestamp
    if (typeof state.whiteTime !== "number") state.whiteTime = 600000
    if (typeof state.blackTime !== "number") state.blackTime = 600000
    if (!state.moveHistory) state.moveHistory = []
    if (!state.repetitionMap) state.repetitionMap = new Map()
    if (typeof state.gameStarted !== "boolean") state.gameStarted = false
    if (!state.firstMoveTimestamp) state.firstMoveTimestamp = null
    if (!state.capturedPieces) state.capturedPieces = { white: [], black: [] }
    if (typeof state.gameEnded !== "boolean") state.gameEnded = false

    // Check for time-based game ending BEFORE processing the move
    if (state.whiteTime <= 0) {
      state.gameEnded = true
      state.endReason = "timeout"
      state.winnerColor = "black"
      state.winner = null // Will be set by calling function
      state.endTimestamp = currentTimestamp
      console.log("WHITE TIMEOUT - Game ended, black wins")
      return {
        valid: false,
        reason: "White ran out of time",
        result: "timeout",
        winnerColor: "black",
        winner: null,
        gameEnded: true,
        endReason: "timeout",
        shouldNavigateToMenu: true,
        endTimestamp: currentTimestamp,
        code: "WHITE_TIMEOUT",
      }
    }
    if (state.blackTime <= 0) {
      state.gameEnded = true
      state.endReason = "timeout"
      state.winnerColor = "white"
      state.winner = null // Will be set by calling function
      state.endTimestamp = currentTimestamp
      console.log("BLACK TIMEOUT - Game ended, white wins")
      return {
        valid: false,
        reason: "Black ran out of time",
        result: "timeout",
        winnerColor: "white",
        winner: null,
        gameEnded: true,
        endReason: "timeout",
        shouldNavigateToMenu: true,
        endTimestamp: currentTimestamp,
        code: "BLACK_TIMEOUT",
      }
    }

    // IMPORTANT: Get the current player BEFORE making the move
    // This is the player who is making the move and whose time should be deducted
    const currentPlayerBeforeMove = game.turn() // 'w' or 'b'
    const currentPlayerColor = currentPlayerBeforeMove === "w" ? "white" : "black"

    console.log("Current player before move:", currentPlayerBeforeMove, "Color:", currentPlayerColor)
    console.log("Player making move:", playerColor)

    // Verify that the player making the move matches the current turn
    if (currentPlayerColor !== playerColor) {
      return { valid: false, reason: "Not your turn", code: "WRONG_TURN" }
    }

    // Handle first move specially
    if (!state.gameStarted || state.moveHistory.length === 0) {
      console.log("FIRST MOVE DETECTED - Starting game timers")
      state.gameStarted = true
      state.firstMoveTimestamp = currentTimestamp
      state.turnStartTimestamp = currentTimestamp
      state.lastMoveTimestamp = currentTimestamp

      // For the first move, don't deduct any time - just start the timer
      console.log("First move - no time deduction, just starting timers")
    } else {
      // Calculate elapsed time since the turn started (for subsequent moves)
      const elapsed = currentTimestamp - state.turnStartTimestamp
      console.log("Elapsed time since turn started:", elapsed, "ms")
      console.log("Times before deduction - White:", state.whiteTime, "Black:", state.blackTime)

      // Deduct time from the player who is making the move (current player)
      if (currentPlayerBeforeMove === "w") {
        const newWhiteTime = Math.max(0, state.whiteTime - elapsed)
        console.log("WHITE MOVE: Deducting", elapsed, "ms from white time")
        console.log("White time:", state.whiteTime, "->", newWhiteTime)
        state.whiteTime = newWhiteTime
        if (state.whiteTime <= 0) {
          state.gameEnded = true
          state.endReason = "timeout"
          state.winnerColor = "black"
          state.winner = null
          state.endTimestamp = currentTimestamp
          return {
            valid: false,
            reason: "Time out",
            result: "timeout",
            winnerColor: "black",
            winner: null,
            gameEnded: true,
            endReason: "timeout",
            shouldNavigateToMenu: true,
            endTimestamp: currentTimestamp,
            code: "WHITE_TIMEOUT_DURING_MOVE",
          }
        }
      } else {
        const newBlackTime = Math.max(0, state.blackTime - elapsed)
        console.log("BLACK MOVE: Deducting", elapsed, "ms from black time")
        console.log("Black time:", state.blackTime, "->", newBlackTime)
        state.blackTime = newBlackTime
        if (state.blackTime <= 0) {
          state.gameEnded = true
          state.endReason = "timeout"
          state.winnerColor = "white"
          state.winner = null
          state.endTimestamp = currentTimestamp
          return {
            valid: false,
            reason: "Time out",
            result: "timeout",
            winnerColor: "white",
            winner: null,
            gameEnded: true,
            endReason: "timeout",
            shouldNavigateToMenu: true,
            endTimestamp: currentTimestamp,
            code: "BLACK_TIMEOUT_DURING_MOVE",
          }
        }
      }

      console.log("Times after deduction - White:", state.whiteTime, "Black:", state.blackTime)
    }

    // Check if this move captures a piece
    const targetSquare = move.to
    const capturedPiece = game.get(targetSquare)

    // Validate and apply the move
    let result
    try {
      result = game.move(move)
    } catch (error) {
      console.error("Chess.js move error:", error)
      return { valid: false, reason: "Invalid move", code: "CHESS_JS_ERROR", details: error.message }
    }

    console.log("Move result:", result)
    if (!result) return { valid: false, reason: "Illegal move", code: "ILLEGAL_MOVE" }

    // Track captured pieces
    if (capturedPiece) {
      const capturingPlayer = currentPlayerBeforeMove === "w" ? "white" : "black"
      state.capturedPieces[capturingPlayer].push(capturedPiece.type)
      console.log(`${capturingPlayer} captured ${capturedPiece.type}`)
    }

    // Update state after successful move
    const oldFen = state.fen
    state.fen = game.fen()
    state.lastMoveTimestamp = currentTimestamp

    // CRITICAL: Reset turn start timestamp for the NEXT player's turn
    state.turnStartTimestamp = currentTimestamp
    state.moveHistory.push(result)

    // Update the active color to reflect whose turn it is now
    const newActivePlayer = game.turn() // 'w' or 'b' - this is now the NEXT player
    state.activeColor = newActivePlayer === "w" ? "white" : "black"

    console.log("Move completed:")
    console.log("- FEN changed from:", oldFen.split(" ")[0], "to:", state.fen.split(" ")[0])
    console.log("- Next player's turn:", newActivePlayer, "Active color:", state.activeColor)
    console.log("- Turn start timestamp reset to:", state.turnStartTimestamp)
    console.log("- Final times - White:", state.whiteTime, "Black:", state.blackTime)
    console.log("- Move count:", state.moveHistory.length)

    // Update repetition tracking
    updateRepetitionMap(state, game)

    const resultStatus = checkGameStatus(state, game)
    console.log("Game status after move:", resultStatus)

    // Check if the game has ended due to checkmate, stalemate, etc.
    if (resultStatus.result !== "ongoing") {
      state.gameEnded = true
      state.endReason = resultStatus.result

      // FIXED: Store winner as user ID, not color string
      if (resultStatus.winner) {
        // Get the actual user ID of the winning player
        const winnerColor = resultStatus.winner // "white" or "black"
        state.winnerColor = winnerColor // Store the color for reference
        state.winner = null // Will be set by the calling function with actual user ID
      } else {
        state.winner = null
        state.winnerColor = null
      }

      state.endTimestamp = currentTimestamp
      console.log(
        `GAME ENDED: ${resultStatus.result}`,
        resultStatus.winner ? `Winner color: ${resultStatus.winner}` : "",
      )

      // Add navigation flag for game ending
      resultStatus.shouldNavigateToMenu = true
      resultStatus.endTimestamp = currentTimestamp
      resultStatus.winnerColor = state.winnerColor // Pass winner color to caller
    }

    // Remove any accidental Chess instance before returning state
    if (state.game) delete state.game

    // Add detailed game state info for frontend
    state.gameState = {
      check: game.inCheck ? game.inCheck() : false,
      checkmate: game.isCheckmate(),
      stalemate: game.isStalemate(),
      insufficientMaterial: game.isInsufficientMaterial(),
      threefoldRepetition: game.isThreefoldRepetition(),
      fiftyMoveRule: game.isDraw(),
      canCastleKingside: {
        white: game.castling && game.castling["w"] && game.castling["w"].k,
        black: game.castling && game.castling["b"] && game.castling["b"].b,
      },
      canCastleQueenside: {
        white: game.castling && game.castling["w"] && game.castling["w"].q,
        black: game.castling && game.castling["b"] && game.castling["b"].q,
      },
      promotionAvailable: result && result.flags && result.flags.includes("p"),
      lastMove: result,
      result: resultStatus.result,
      winner: resultStatus.winner || null,
      drawReason: resultStatus.reason || null,
      gameEnded: state.gameEnded,
      endReason: state.endReason,
      endTimestamp: state.endTimestamp,
    }

    console.log("=== MOVE VALIDATION END ===")

    return {
      valid: true,
      move: result,
      state,
      gameEnded: state.gameEnded,
      endReason: state.endReason,
      endTimestamp: state.endTimestamp,
      code: "SUCCESS",
      ...resultStatus,
    }
  } catch (error) {
    console.error("Error in validateAndApplyMove:", error)
    return {
      valid: false,
      reason: "Internal error during move validation",
      error: error.message,
      code: "INTERNAL_ERROR",
      stack: error.stack,
    }
  }
}

// Get current timer values (useful for periodic updates)
export function getCurrentTimers(state, currentTimestamp) {
  try {
    // Validate input
    if (!state || typeof state !== "object") {
      console.error("[TIMER] Invalid state provided to getCurrentTimers")
      return {
        white: 600000,
        black: 600000,
        activeColor: "white",
        gameEnded: false,
        error: "Invalid state",
      }
    }

    if (!currentTimestamp || typeof currentTimestamp !== "number") {
      currentTimestamp = Date.now()
    }

    // If game has ended, return the final timer values
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
      }
    }

    if (!state.gameStarted || !state.turnStartTimestamp || state.moveHistory.length === 0) {
      return {
        white: state.whiteTime || 600000,
        black: state.blackTime || 600000,
        activeColor: state.activeColor || "white",
        gameEnded: false,
      }
    }

    // Reconstruct game to check whose turn it is
    let game
    try {
      game = new Chess(state.fen)
    } catch (error) {
      console.error("[TIMER] Error reconstructing game from FEN:", error)
      return {
        white: state.whiteTime || 600000,
        black: state.blackTime || 600000,
        activeColor: state.activeColor || "white",
        gameEnded: false,
        error: "Invalid FEN",
      }
    }

    const currentPlayer = game.turn() // 'w' or 'b'
    const currentPlayerColor = currentPlayer === "w" ? "white" : "black"
    const elapsed = currentTimestamp - state.turnStartTimestamp

    let whiteTime = state.whiteTime || 600000
    let blackTime = state.blackTime || 600000

    // Only deduct time from the current player (whose turn it is right now)
    if (currentPlayer === "w") {
      whiteTime = Math.max(0, whiteTime - elapsed)
    } else {
      blackTime = Math.max(0, blackTime - elapsed)
    }

    // Check for timeout and end game if necessary
    if (whiteTime <= 0) {
      state.gameEnded = true
      state.endReason = "timeout"
      state.winnerColor = "black"
      state.winner = null
      state.endTimestamp = currentTimestamp
      return {
        white: 0,
        black: blackTime,
        activeColor: currentPlayerColor,
        gameEnded: true,
        endReason: "timeout",
        winnerColor: "black",
        winner: null,
        shouldNavigateToMenu: true,
        endTimestamp: currentTimestamp,
      }
    }

    if (blackTime <= 0) {
      state.gameEnded = true
      state.endReason = "timeout"
      state.winnerColor = "white"
      state.winner = null
      state.endTimestamp = currentTimestamp
      return {
        white: whiteTime,
        black: 0,
        activeColor: currentPlayerColor,
        gameEnded: true,
        endReason: "timeout",
        winnerColor: "white",
        winner: null,
        shouldNavigateToMenu: true,
        endTimestamp: currentTimestamp,
      }
    }

    return {
      white: whiteTime,
      black: blackTime,
      activeColor: currentPlayerColor,
      gameEnded: false,
    }
  } catch (error) {
    console.error("Error in getCurrentTimers:", error)
    return {
      white: state?.whiteTime || 600000,
      black: state?.blackTime || 600000,
      activeColor: state?.activeColor || "white",
      gameEnded: false,
      error: error.message,
    }
  }
}

// Generate all possible legal moves
export function getLegalMoves(fen) {
  try {
    if (!fen || typeof fen !== "string") {
      console.error("[MOVES] Invalid FEN provided to getLegalMoves:", fen)
      return []
    }

    const game = new Chess(fen)
    return game.moves({ verbose: true })
  } catch (error) {
    console.error("Error getting legal moves:", error)
    return []
  }
}

// Draw detection & game status
export function checkGameStatus(state, gameInstance) {
  try {
    // Validate input
    if (!state || typeof state !== "object") {
      console.error("[STATUS] Invalid state provided to checkGameStatus")
      return { result: "ongoing", error: "Invalid state" }
    }

    // Always reconstruct game from FEN if not provided
    let game = gameInstance
    if (!game) {
      if (!state.fen) {
        console.error("[STATUS] Missing FEN in game state")
        return { result: "ongoing", error: "Missing FEN" }
      }
      try {
        game = new Chess(state.fen)
      } catch (error) {
        console.error("[STATUS] Error reconstructing game from FEN:", error)
        return { result: "ongoing", error: "Invalid FEN" }
      }
    }

    // Check for time-based wins first
    if (state.whiteTime <= 0) return { result: "timeout", winnerColor: "black", reason: "white ran out of time" }
    if (state.blackTime <= 0) return { result: "timeout", winnerColor: "white", reason: "black ran out of time" }

    // Check for checkmate - this automatically ends the game
    if (game.isCheckmate()) {
      const winnerColor = game.turn() === "w" ? "black" : "white"
      console.log(`CHECKMATE DETECTED: ${winnerColor} wins!`)
      return { result: "checkmate", winnerColor: winnerColor }
    }

    // Check for other draw conditions
    if (game.isStalemate()) return { result: "draw", reason: "stalemate" }
    if (game.isInsufficientMaterial()) return { result: "draw", reason: "insufficient material" }
    if (game.isThreefoldRepetition()) return { result: "draw", reason: "threefold repetition" }
    if (game.isDraw()) return { result: "draw", reason: "50-move rule" }

    // Manual check for 5x / 75x repetition
    if (!(state.repetitionMap instanceof Map)) {
      state.repetitionMap = new Map(Object.entries(state.repetitionMap || {}))
    }
    const repetitionCount = state.repetitionMap.get(game.fen()) || 0
    if (repetitionCount >= 5) return { result: "draw", reason: "fivefold repetition" }
    if (state.moveHistory && state.moveHistory.length >= 150) return { result: "draw", reason: "75-move rule" }

    return { result: "ongoing" }
  } catch (error) {
    console.error("Error checking game status:", error)
    return { result: "ongoing", error: error.message }
  }
}

// Helper: track FEN repetitions for 5-fold and 75-move rule
export function updateRepetitionMap(state, gameInstance) {
  try {
    // Validate input
    if (!state || typeof state !== "object") {
      console.error("[REPETITION] Invalid state provided to updateRepetitionMap")
      return
    }

    // Defensive: reconstruct repetitionMap if missing
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

    if (!(state.repetitionMap instanceof Map)) {
      state.repetitionMap = new Map(Object.entries(state.repetitionMap || {}))
    }

    const current = state.repetitionMap.get(fen) || 0
    state.repetitionMap.set(fen, current + 1)
    console.log("Repetition map updated for FEN:", fen, "Count:", current + 1)
  } catch (error) {
    console.error("Error updating repetition map:", error)
  }
}
