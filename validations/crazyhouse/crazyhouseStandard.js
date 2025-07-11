import { Chess } from "chess.js"

// Helper: Validate ObjectId format
export function isValidObjectId(id) {
  if (!id) return false
  if (typeof id !== "string") return false
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
    if (userData.userId) {
      const validUserId = safeObjectId(userData.userId)
      if (validUserId) {
        sanitized.userId = validUserId
      } else {
        console.warn("[SANITIZE] Invalid userId:", userData.userId)
        return null
      }
    }
    if (userData.sessionId) {
      const validSessionId = safeObjectId(userData.sessionId)
      if (validSessionId) {
        sanitized.sessionId = validSessionId
      } else {
        console.warn("[SANITIZE] Invalid sessionId:", userData.sessionId)
        return null
      }
    }
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

// Crazyhouse: Validate piece drop
function validatePieceDrop(game, piece, square) {
  // Basic validation
  if (!piece || !square) return false

  // Check if square is occupied
  if (game.get(square)) return false

  // Pawn restrictions - cannot drop on 1st or 8th rank
  if (piece.type === "p") {
    const rank = square[1]
    if (rank === "1" || rank === "8") return false
  }

  // Check for pawn double-check (can't drop pawn that gives check if king can't move)
  const tempGame = new Chess(game.fen())
  try {
    // Simulate the drop by placing piece temporarily
    tempGame.put({ type: piece.type, color: piece.color }, square)
    // If this creates an impossible position, it's invalid
    if (tempGame.inCheck()) {
      const moves = tempGame.moves()
      if (moves.length === 0) return false // Would be checkmate, invalid drop
    }
    return true
  } catch (error) {
    return false
  }
}

// Create initial state for Standard Crazyhouse
export function createInitialState() {
  try {
    const game = new Chess() // Standard starting position
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
      whiteTime: 180000, // 3 minutes in ms
      blackTime: 180000,
      increment: 2000, // 2 seconds increment
      turnStartTimestamp: now,
      lastMoveTimestamp: now,
      moveHistory: [],
      gameStarted: false,
      firstMoveTimestamp: null,
      capturedPieces: {
        white: [], // Pieces captured by white (for reference)
        black: [], // Pieces captured by black (for reference)
      },
      // Standard Crazyhouse specific fields
      pocketPieces: {
        white: [], // Pieces white can drop (no timers)
        black: [], // Pieces black can drop (no timers)
      },
      gameEnded: false,
      endReason: null,
      winner: null,
      endTimestamp: null,
      variant: "crazyhouse-standard", // Mark this as Standard Crazyhouse
    }
  } catch (error) {
    console.error("Error creating Standard Crazyhouse initial state:", error)
    throw error
  }
}

// Validate a move or drop for Standard Crazyhouse
export function validateAndApplyMove(state, move, playerColor, currentTimestamp) {
  try {
    console.log("=== CRAZYHOUSE STANDARD MOVE VALIDATION START ===")
    console.log("Move:", JSON.stringify(move), "Player:", playerColor)
    console.log("Current pocket pieces:", JSON.stringify(state.pocketPieces))

    // Validate input parameters
    if (!state || typeof state !== "object") {
      return { valid: false, reason: "Invalid game state", code: "INVALID_STATE" }
    }
    if (!move || typeof move !== "object") {
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

    // Initialize Standard Crazyhouse specific fields if missing
    if (!state.pocketPieces) state.pocketPieces = { white: [], black: [] }
    if (!state.increment) state.increment = 2000
    if (!state.variant) state.variant = "crazyhouse-standard"

    // Always reconstruct game from FEN
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
    if (typeof state.whiteTime !== "number") state.whiteTime = 180000
    if (typeof state.blackTime !== "number") state.blackTime = 180000
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
      state.winner = null
      state.endTimestamp = currentTimestamp
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
      state.winner = null
      state.endTimestamp = currentTimestamp
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

    // Get the current player BEFORE making the move
    const currentPlayerBeforeMove = game.turn() // 'w' or 'b'
    const currentPlayerColor = currentPlayerBeforeMove === "w" ? "white" : "black"

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
    } else {
      // Calculate elapsed time since the turn started
      const elapsed = currentTimestamp - state.turnStartTimestamp
      console.log("Elapsed time since turn started:", elapsed, "ms")

      // Deduct time from the player who is making the move
      if (currentPlayerBeforeMove === "w") {
        const newWhiteTime = Math.max(0, state.whiteTime - elapsed)
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
    }

    let result
    let isDrop = false

    // FIXED: Check if this is a piece drop (has 'drop' property) or regular move
    if (move.drop && move.drop.piece && move.drop.square) {
      isDrop = true
      const { piece, square } = move.drop

      console.log("Processing drop:", piece, "to", square)

      // Validate piece drop
      if (!validatePieceDrop(game, piece, square)) {
        return { valid: false, reason: "Invalid piece drop", code: "INVALID_DROP" }
      }

      // Check if player has this piece in pocket
      const playerPocket = state.pocketPieces[playerColor] || []
      const pieceIndex = playerPocket.findIndex((p) => p.type === piece.type && p.color === piece.color)

      if (pieceIndex === -1) {
        console.log("Piece not found in pocket. Available pieces:", playerPocket)
        return { valid: false, reason: "Piece not available in pocket", code: "PIECE_NOT_IN_POCKET" }
      }

      // Remove piece from pocket
      state.pocketPieces[playerColor].splice(pieceIndex, 1)
      console.log("Removed piece from pocket. Remaining:", state.pocketPieces[playerColor])

      // Apply the drop by placing the piece on the board
      try {
        const pieceToPlace = {
          type: piece.type,
          color: playerColor === "white" ? "w" : "b",
        }
        game.put(pieceToPlace, square)

        // Create a result object similar to chess.js move result
        result = {
          from: null,
          to: square,
          piece: piece.type,
          color: playerColor === "white" ? "w" : "b",
          flags: "d", // drop flag
          san: `${piece.type.toUpperCase()}@${square}`,
          drop: true,
          captured: null,
        }

        console.log("Drop successful:", result)
      } catch (error) {
        console.error("Failed to drop piece:", error)
        return { valid: false, reason: "Failed to drop piece", code: "DROP_FAILED", details: error.message }
      }
    } else {
      // Regular chess move
      const targetSquare = move.to
      const capturedPiece = game.get(targetSquare)

      // Validate and apply the move
      try {
        result = game.move(move)
      } catch (error) {
        console.error("Chess.js move error:", error)
        return { valid: false, reason: "Invalid move", code: "CHESS_JS_ERROR", details: error.message }
      }

      if (!result) return { valid: false, reason: "Illegal move", code: "ILLEGAL_MOVE" }

      // Handle captured pieces - add to pocket (no timer in standard)
      if (capturedPiece) {
        const capturingPlayer = currentPlayerBeforeMove === "w" ? "white" : "black"
        state.capturedPieces[capturingPlayer].push(capturedPiece.type)

        // Add captured piece to pocket (no timer)
        let pieceType = capturedPiece.type
        // Promoted pieces revert to pawns when captured
        if (result.flags.includes("c") && capturedPiece.type === "q" && result.piece === "p") {
          pieceType = "p"
        }

        state.pocketPieces[capturingPlayer].push({
          type: pieceType,
          color: capturingPlayer === "white" ? "w" : "b",
        })

        console.log(`${capturingPlayer} captured ${capturedPiece.type}, added to pocket`)
      }
    }

    // Add increment after successful move/drop
    if (currentPlayerBeforeMove === "w") {
      state.whiteTime += state.increment
    } else {
      state.blackTime += state.increment
    }

    // Update state after successful move/drop
    const oldFen = state.fen
    state.fen = game.fen()
    state.lastMoveTimestamp = currentTimestamp
    state.turnStartTimestamp = currentTimestamp
    state.moveHistory.push(result)

    // Update the active color
    const newActivePlayer = game.turn()
    state.activeColor = newActivePlayer === "w" ? "white" : "black"

    // Update repetition tracking
    updateRepetitionMap(state, game)

    // Check game status
    const resultStatus = checkCrazyhouseGameStatus(state, game)
    console.log("Standard Crazyhouse game status after move:", resultStatus)

    // Check if the game has ended
    if (resultStatus.result !== "ongoing") {
      state.gameEnded = true
      state.endReason = resultStatus.result
      state.winnerColor = resultStatus.winnerColor || null
      state.endTimestamp = currentTimestamp
      console.log(`CRAZYHOUSE STANDARD GAME ENDED: ${resultStatus.result}`)
      resultStatus.shouldNavigateToMenu = true
      resultStatus.endTimestamp = currentTimestamp
      resultStatus.winnerColor = state.winnerColor
    }

    // Remove any accidental Chess instance before returning state
    if (state.game) delete state.game

    // FIXED: Add detailed game state info for frontend with proper pocket pieces
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
      winner:
        resultStatus.winnerColor && state.players && state.players[resultStatus.winnerColor]
          ? state.players[resultStatus.winnerColor].username
          : null,
      winnerId:
        resultStatus.winnerColor && state.players && state.players[resultStatus.winnerColor]
          ? state.players[resultStatus.winnerColor]._id || null
          : null,
      drawReason: resultStatus.reason || null,
      gameEnded: state.gameEnded,
      endReason: state.endReason,
      endTimestamp: state.endTimestamp,
      // Standard Crazyhouse specific info
      pocketPieces: state.pocketPieces, // CRITICAL: Include updated pocket pieces
      variant: state.variant,
      isDrop: isDrop,
    }

    // FIXED: Also add pocket pieces to the main board state for compatibility
    state.board = state.board || {}
    state.board.pocketPieces = state.pocketPieces

    console.log("Final pocket pieces in state:", JSON.stringify(state.pocketPieces))
    console.log("=== CRAZYHOUSE STANDARD MOVE VALIDATION END ===")

    return {
      valid: true,
      move: result,
      state,
      gameEnded: state.gameEnded,
      endReason: state.endReason,
      endTimestamp: state.endTimestamp,
      code: "SUCCESS",
      winnerColor: state.winnerColor,
      winner: state.winner,
      isDrop: isDrop,
      pocketPieces: state.pocketPieces, // CRITICAL: Include in response
      ...resultStatus,
    }
  } catch (error) {
    console.error("Error in Standard Crazyhouse validateAndApplyMove:", error)
    return {
      valid: false,
      reason: "Internal error during move validation",
      error: error.message,
      code: "INTERNAL_ERROR",
      stack: error.stack,
    }
  }
}

// Get current timer values (no piece timers in standard)
export function getCurrentTimers(state, currentTimestamp) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[TIMER] Invalid state provided to getCurrentTimers")
      return {
        white: 180000,
        black: 180000,
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
        pocketPieces: state.pocketPieces || { white: [], black: [] }, // FIXED: Include pocket pieces
        variant: state.variant || "crazyhouse-standard",
      }
    }

    if (!state.gameStarted || !state.turnStartTimestamp || state.moveHistory.length === 0) {
      return {
        white: state.whiteTime || 180000,
        black: state.blackTime || 180000,
        activeColor: state.activeColor || "white",
        gameEnded: false,
        pocketPieces: state.pocketPieces || { white: [], black: [] }, // FIXED: Include pocket pieces
        variant: state.variant || "crazyhouse-standard",
      }
    }

    // Reconstruct game to check whose turn it is
    let game
    try {
      game = new Chess(state.fen)
    } catch (error) {
      console.error("[TIMER] Error reconstructing game from FEN:", error)
      return {
        white: state.whiteTime || 180000,
        black: state.blackTime || 180000,
        activeColor: state.activeColor || "white",
        gameEnded: false,
        error: "Invalid FEN",
      }
    }

    const currentPlayer = game.turn()
    const currentPlayerColor = currentPlayer === "w" ? "white" : "black"
    const elapsed = currentTimestamp - state.turnStartTimestamp

    let whiteTime = state.whiteTime || 180000
    let blackTime = state.blackTime || 180000

    // Only deduct time from the current player
    if (currentPlayer === "w") {
      whiteTime = Math.max(0, whiteTime - elapsed)
    } else {
      blackTime = Math.max(0, blackTime - elapsed)
    }

    // Check for timeout
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
        pocketPieces: state.pocketPieces || { white: [], black: [] }, // FIXED: Include pocket pieces
        variant: state.variant,
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
        pocketPieces: state.pocketPieces || { white: [], black: [] }, // FIXED: Include pocket pieces
        variant: state.variant,
      }
    }

    return {
      white: whiteTime,
      black: blackTime,
      activeColor: currentPlayerColor,
      gameEnded: false,
      pocketPieces: state.pocketPieces || { white: [], black: [] }, // FIXED: Include pocket pieces
      variant: state.variant || "crazyhouse-standard",
    }
  } catch (error) {
    console.error("Error in getCurrentTimers:", error)
    return {
      white: state?.whiteTime || 180000,
      black: state?.blackTime || 180000,
      activeColor: state?.activeColor || "white",
      gameEnded: false,
      error: error.message,
      pocketPieces: state?.pocketPieces || { white: [], black: [] }, // FIXED: Include pocket pieces
      variant: state?.variant || "crazyhouse-standard",
    }
  }
}

// Generate all possible legal moves including drops
export function getLegalMoves(fen, pocketPieces) {
  try {
    if (!fen || typeof fen !== "string") {
      console.error("[MOVES] Invalid FEN provided to getLegalMoves:", fen)
      return []
    }

    const game = new Chess(fen)
    const moves = game.moves({ verbose: true })

    // Add possible drops
    if (pocketPieces) {
      const currentPlayer = game.turn()
      const playerColor = currentPlayer === "w" ? "white" : "black"
      const playerPocket = pocketPieces[playerColor] || []

      // Generate drop moves for each piece in pocket
      playerPocket.forEach((piece) => {
        for (let file = "a"; file <= "h"; file++) {
          for (let rank = 1; rank <= 8; rank++) {
            const square = file + rank
            if (validatePieceDrop(game, piece, square)) {
              moves.push({
                from: null,
                to: square,
                piece: piece.type,
                color: piece.color,
                flags: "d",
                san: `${piece.type.toUpperCase()}@${square}`,
                drop: true,
              })
            }
          }
        }
      })
    }

    return moves
  } catch (error) {
    console.error("Error getting legal moves:", error)
    return []
  }
}

// Crazyhouse game status checker
export function checkCrazyhouseGameStatus(state, gameInstance) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[CRAZYHOUSE STATUS] Invalid state provided to checkCrazyhouseGameStatus")
      return { result: "ongoing", error: "Invalid state" }
    }

    let game = gameInstance
    if (!game) {
      if (!state.fen) {
        console.error("[CRAZYHOUSE STATUS] Missing FEN in game state")
        return { result: "ongoing", error: "Missing FEN" }
      }
      try {
        game = new Chess(state.fen)
      } catch (error) {
        console.error("[CRAZYHOUSE STATUS] Error reconstructing game from FEN:", error)
        return { result: "ongoing", error: "Invalid FEN" }
      }
    }

    // Check for time-based wins first
    if (state.whiteTime <= 0) return { result: "timeout", winnerColor: "black", reason: "white ran out of time" }
    if (state.blackTime <= 0) return { result: "timeout", winnerColor: "white", reason: "black ran out of time" }

    // Check for checkmate
    if (game.isCheckmate()) {
      const winnerColor = game.turn() === "w" ? "black" : "white"
      console.log(`CRAZYHOUSE CHECKMATE DETECTED: ${winnerColor} wins!`)
      return { result: "checkmate", winnerColor: winnerColor }
    }

    // In Crazyhouse, stalemate is very rare due to piece drops
    if (game.isStalemate()) {
      // Check if player has pieces to drop
      const currentPlayer = game.turn()
      const playerColor = currentPlayer === "w" ? "white" : "black"
      const playerPocket = state.pocketPieces?.[playerColor] || []
      if (playerPocket.length > 0) {
        // Player has pieces to drop, so not actually stalemate
        return { result: "ongoing", winnerColor: null }
      }
      return { result: "draw", reason: "stalemate", winnerColor: null }
    }

    if (game.isInsufficientMaterial()) return { result: "draw", reason: "insufficient material", winnerColor: null }
    if (game.isThreefoldRepetition()) return { result: "draw", reason: "threefold repetition", winnerColor: null }

    // Manual check for 5x repetition
    if (!(state.repetitionMap instanceof Map)) {
      state.repetitionMap = new Map(Object.entries(state.repetitionMap || {}))
    }
    const repetitionCount = state.repetitionMap.get(game.fen()) || 0
    if (repetitionCount >= 5) return { result: "draw", reason: "fivefold repetition", winnerColor: null }

    return { result: "ongoing", winnerColor: null }
  } catch (error) {
    console.error("Error checking Crazyhouse game status:", error)
    return { result: "ongoing", error: error.message, winnerColor: null }
  }
}

// Standard game status checker (for compatibility)
export function checkGameStatus(state, gameInstance) {
  if (state?.variant === "crazyhouse-standard") {
    return checkCrazyhouseGameStatus(state, gameInstance)
  }
  // Fallback to standard chess logic
  try {
    if (!state || typeof state !== "object") {
      console.error("[STATUS] Invalid state provided to checkGameStatus")
      return { result: "ongoing", error: "Invalid state" }
    }

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

    if (state.whiteTime <= 0) return { result: "timeout", winnerColor: "black", reason: "white ran out of time" }
    if (state.blackTime <= 0) return { result: "timeout", winnerColor: "white", reason: "black ran out of time" }

    if (game.isCheckmate()) {
      const winnerColor = game.turn() === "w" ? "black" : "white"
      return { result: "checkmate", winnerColor: winnerColor }
    }

    if (game.isStalemate()) return { result: "draw", reason: "stalemate", winnerColor: null }
    if (game.isInsufficientMaterial()) return { result: "draw", reason: "insufficient material", winnerColor: null }
    if (game.isThreefoldRepetition()) return { result: "draw", reason: "threefold repetition", winnerColor: null }
    if (game.isDraw()) return { result: "draw", reason: "50-move rule", winnerColor: null }

    return { result: "ongoing", winnerColor: null }
  } catch (error) {
    console.error("Error checking game status:", error)
    return { result: "ongoing", error: error.message, winnerColor: null }
  }
}

// Helper: track FEN repetitions
export function updateRepetitionMap(state, gameInstance) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[REPETITION] Invalid state provided to updateRepetitionMap")
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
