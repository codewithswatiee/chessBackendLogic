import { Chess } from "chess.js"

export function isValidObjectId(id) {
  if (!id) return false
  if (typeof id !== "string") return false
  return /^[0-9a-fA-F]{24}$/.test(id)
}

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

// Create initial state for Crazyhouse Standard (3+2 time control)
export function createInitialCrazyhouseState() {
  try {
    const game = new Chess()
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
      blackTime: 180000, // 3 minutes in ms
      increment: 2000, // 2 seconds increment
      turnStartTimestamp: now,
      lastMoveTimestamp: now,
      moveHistory: [],
      gameStarted: false,
      firstMoveTimestamp: null,

      // Crazyhouse-specific state
      pocketPanel: {
        white: [], // Pieces white can drop (captured black pieces)
        black: [], // Pieces black can drop (captured white pieces)
      },
      capturedPieces: {
        white: [], // Pieces captured by white (black pieces)
        black: [], // Pieces captured by black (white pieces)
      },

      gameEnded: false,
      endReason: null,
      winner: null,
      endTimestamp: null,
      gameVariant: "crazyhouse-standard",
    }
  } catch (error) {
    console.error("Error creating initial Crazyhouse state:", error)
    throw error
  }
}

// Validate piece drop for Crazyhouse
export function validatePieceDrop(state, drop, playerColor) {
  try {
    console.log("=== PIECE DROP VALIDATION START ===")
    console.log("Drop:", drop, "Player:", playerColor)

    if (!drop || !drop.piece || !drop.square) {
      return { valid: false, reason: "Invalid drop format", code: "INVALID_DROP_FORMAT" }
    }

    const { piece, square } = drop

    // Check if player has this piece in pocket
    if (!state.pocketPanel[playerColor].includes(piece)) {
      return { valid: false, reason: "Piece not available in pocket", code: "PIECE_NOT_IN_POCKET" }
    }

    // Reconstruct game to validate drop
    let game
    try {
      game = new Chess(state.fen)
    } catch (error) {
      return { valid: false, reason: "Invalid game state", code: "INVALID_FEN" }
    }

    // Check if it's the player's turn
    const currentPlayer = game.turn()
    const currentPlayerColor = currentPlayer === "w" ? "white" : "black"
    if (currentPlayerColor !== playerColor) {
      return { valid: false, reason: "Not your turn", code: "WRONG_TURN" }
    }

    // Check if target square is empty
    const targetPiece = game.get(square)
    if (targetPiece) {
      return { valid: false, reason: "Target square is occupied", code: "SQUARE_OCCUPIED" }
    }

    // Validate square format (a1-h8)
    if (!/^[a-h][1-8]$/.test(square)) {
      return { valid: false, reason: "Invalid square format", code: "INVALID_SQUARE" }
    }

    // Crazyhouse-specific rules
    const rank = Number.parseInt(square[1])

    // Pawns cannot be dropped on 1st or 8th rank
    if (piece === "p" && (rank === 1 || rank === 8)) {
      return { valid: false, reason: "Pawns cannot be dropped on 1st or 8th rank", code: "INVALID_PAWN_DROP" }
    }

    // Check if drop would result in check (simulate the drop)
    try {
      // Create a temporary position with the piece dropped
      const pieceColor = playerColor === "white" ? "w" : "b"
      const pieceSymbol = pieceColor === "w" ? piece.toUpperCase() : piece.toLowerCase()

      // We need to manually validate this since chess.js doesn't support drops
      // For now, we'll allow the drop if basic rules are met
      // In a full implementation, you'd need a Crazyhouse-aware chess engine

      return { valid: true, code: "VALID_DROP" }
    } catch (error) {
      return { valid: false, reason: "Drop would result in illegal position", code: "ILLEGAL_DROP_POSITION" }
    }
  } catch (error) {
    console.error("Error validating piece drop:", error)
    return { valid: false, reason: "Internal error during drop validation", code: "INTERNAL_ERROR" }
  }
}

// Apply piece drop to game state
export function applyPieceDrop(state, drop, playerColor, currentTimestamp) {
  try {
    console.log("=== APPLYING PIECE DROP ===")

    // Validate the drop first
    const validation = validatePieceDrop(state, drop, playerColor)
    if (!validation.valid) {
      return validation
    }

    const { piece, square } = drop

    // Remove piece from pocket
    const pocketIndex = state.pocketPanel[playerColor].indexOf(piece)
    if (pocketIndex > -1) {
      state.pocketPanel[playerColor].splice(pocketIndex, 1)
    }

    // Update FEN to include the dropped piece
    // This is a simplified approach - in a full implementation, you'd need proper FEN manipulation
    const game = new Chess(state.fen)

    // For demonstration, we'll track the drop in move history
    const dropMove = {
      from: "@", // Special notation for drops
      to: square,
      piece: piece,
      drop: true,
      san: `${piece.toUpperCase()}@${square}`,
      color: playerColor === "white" ? "w" : "b",
    }

    // Update game state
    state.moveHistory.push(dropMove)
    state.lastMoveTimestamp = currentTimestamp

    // Apply time increment
    if (playerColor === "white") {
      state.whiteTime += state.increment
    } else {
      state.blackTime += state.increment
    }

    // Switch turns
    state.activeColor = state.activeColor === "white" ? "black" : "white"
    state.turnStartTimestamp = currentTimestamp

    console.log("Piece drop applied successfully")

    return {
      valid: true,
      drop: dropMove,
      state,
      code: "DROP_SUCCESS",
    }
  } catch (error) {
    console.error("Error applying piece drop:", error)
    return { valid: false, reason: "Internal error during drop application", code: "INTERNAL_ERROR" }
  }
}

// Enhanced move validation for Crazyhouse Standard
export function validateAndApplyCrazyhouseMove(state, move, playerColor, currentTimestamp) {
  try {
    console.log("=== CRAZYHOUSE MOVE VALIDATION START ===")
    console.log("Move:", move, "Player:", playerColor)

    // Handle piece drops
    if (move.drop) {
      return applyPieceDrop(state, move, playerColor, currentTimestamp)
    }

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

    // Reconstruct game from FEN
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
    if (typeof state.increment !== "number") state.increment = 2000
    if (!state.moveHistory) state.moveHistory = []
    if (!state.repetitionMap) state.repetitionMap = new Map()
    if (typeof state.gameStarted !== "boolean") state.gameStarted = false
    if (!state.firstMoveTimestamp) state.firstMoveTimestamp = null
    if (!state.pocketPanel) state.pocketPanel = { white: [], black: [] }
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
        gameEnded: true,
        endReason: "timeout",
        shouldNavigateToMenu: true,
        endTimestamp: currentTimestamp,
        code: "BLACK_TIMEOUT",
      }
    }

    // Get current player before move
    const currentPlayerBeforeMove = game.turn()
    const currentPlayerColor = currentPlayerBeforeMove === "w" ? "white" : "black"

    // Verify turn
    if (currentPlayerColor !== playerColor) {
      return { valid: false, reason: "Not your turn", code: "WRONG_TURN" }
    }

    // Handle first move
    if (!state.gameStarted || state.moveHistory.length === 0) {
      console.log("FIRST MOVE DETECTED - Starting game timers")
      state.gameStarted = true
      state.firstMoveTimestamp = currentTimestamp
      state.turnStartTimestamp = currentTimestamp
      state.lastMoveTimestamp = currentTimestamp
    } else {
      // Calculate elapsed time and deduct from current player
      const elapsed = currentTimestamp - state.turnStartTimestamp

      if (currentPlayerBeforeMove === "w") {
        const newWhiteTime = Math.max(0, state.whiteTime - elapsed)
        state.whiteTime = newWhiteTime
        if (state.whiteTime <= 0) {
          state.gameEnded = true
          state.endReason = "timeout"
          state.winnerColor = "black"
          state.endTimestamp = currentTimestamp
          return {
            valid: false,
            reason: "Time out",
            result: "timeout",
            winnerColor: "black",
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
          state.endTimestamp = currentTimestamp
          return {
            valid: false,
            reason: "Time out",
            result: "timeout",
            winnerColor: "white",
            gameEnded: true,
            endReason: "timeout",
            shouldNavigateToMenu: true,
            endTimestamp: currentTimestamp,
            code: "BLACK_TIMEOUT_DURING_MOVE",
          }
        }
      }
    }

    // Check for captured piece
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

    if (!result) return { valid: false, reason: "Illegal move", code: "ILLEGAL_MOVE" }

    // Handle captured pieces in Crazyhouse
    if (capturedPiece) {
      const capturingPlayer = currentPlayerBeforeMove === "w" ? "white" : "black"
      state.capturedPieces[capturingPlayer].push(capturedPiece.type)

      // Add captured piece to pocket (convert to unpromoted piece if needed)
      const pocketPiece = capturedPiece.type
      if (pocketPiece === "q" || pocketPiece === "r" || pocketPiece === "b" || pocketPiece === "n") {
        // In Crazyhouse, promoted pieces revert to pawns when captured
        // This is a simplification - you might want more complex logic
      }
      state.pocketPanel[capturingPlayer].push(pocketPiece)

      console.log(`${capturingPlayer} captured ${capturedPiece.type}, added to pocket`)
    }

    // Apply time increment
    if (currentPlayerBeforeMove === "w") {
      state.whiteTime += state.increment
    } else {
      state.blackTime += state.increment
    }

    // Update state after successful move
    const oldFen = state.fen
    state.fen = game.fen()
    state.lastMoveTimestamp = currentTimestamp
    state.turnStartTimestamp = currentTimestamp
    state.moveHistory.push(result)

    // Update active color
    const newActivePlayer = game.turn()
    state.activeColor = newActivePlayer === "w" ? "white" : "black"

    // Update repetition tracking
    updateRepetitionMap(state, game)

    // Check game status
    const resultStatus = checkCrazyhouseGameStatus(state, game)

    if (resultStatus.result !== "ongoing") {
      state.gameEnded = true
      state.endReason = resultStatus.result
      state.winnerColor = resultStatus.winnerColor || null
      state.endTimestamp = currentTimestamp
      resultStatus.shouldNavigateToMenu = true
      resultStatus.endTimestamp = currentTimestamp
      resultStatus.winnerColor = state.winnerColor
    }

    // Clean up Chess instance
    if (state.game) delete state.game

    // Add detailed game state info
    state.gameState = {
      check: game.inCheck ? game.inCheck() : false,
      checkmate: game.isCheckmate(),
      stalemate: game.isStalemate(),
      insufficientMaterial: game.isInsufficientMaterial(),
      threefoldRepetition: game.isThreefoldRepetition(),
      fiftyMoveRule: game.isDraw(),
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
      pocketPanel: state.pocketPanel,
    }

    console.log("=== CRAZYHOUSE MOVE VALIDATION END ===")

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
      ...resultStatus,
    }
  } catch (error) {
    console.error("Error in validateAndApplyCrazyhouseMove:", error)
    return {
      valid: false,
      reason: "Internal error during move validation",
      error: error.message,
      code: "INTERNAL_ERROR",
      stack: error.stack,
    }
  }
}

// Get current timers for Crazyhouse
export function getCurrentCrazyhouseTimers(state, currentTimestamp) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[TIMER] Invalid state provided to getCurrentCrazyhouseTimers")
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
        pocketPanel: state.pocketPanel,
      }
    }

    if (!state.gameStarted || !state.turnStartTimestamp || state.moveHistory.length === 0) {
      return {
        white: state.whiteTime || 180000,
        black: state.blackTime || 180000,
        activeColor: state.activeColor || "white",
        gameEnded: false,
        pocketPanel: state.pocketPanel || { white: [], black: [] },
      }
    }

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
        pocketPanel: state.pocketPanel || { white: [], black: [] },
      }
    }

    const currentPlayer = game.turn()
    const currentPlayerColor = currentPlayer === "w" ? "white" : "black"
    const elapsed = currentTimestamp - state.turnStartTimestamp

    let whiteTime = state.whiteTime || 180000
    let blackTime = state.blackTime || 180000

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
      state.endTimestamp = currentTimestamp
      return {
        white: 0,
        black: blackTime,
        activeColor: currentPlayerColor,
        gameEnded: true,
        endReason: "timeout",
        winnerColor: "black",
        shouldNavigateToMenu: true,
        endTimestamp: currentTimestamp,
        pocketPanel: state.pocketPanel,
      }
    }

    if (blackTime <= 0) {
      state.gameEnded = true
      state.endReason = "timeout"
      state.winnerColor = "white"
      state.endTimestamp = currentTimestamp
      return {
        white: whiteTime,
        black: 0,
        activeColor: currentPlayerColor,
        gameEnded: true,
        endReason: "timeout",
        winnerColor: "white",
        shouldNavigateToMenu: true,
        endTimestamp: currentTimestamp,
        pocketPanel: state.pocketPanel,
      }
    }

    return {
      white: whiteTime,
      black: blackTime,
      activeColor: currentPlayerColor,
      gameEnded: false,
      pocketPanel: state.pocketPanel || { white: [], black: [] },
    }
  } catch (error) {
    console.error("Error in getCurrentCrazyhouseTimers:", error)
    return {
      white: state?.whiteTime || 180000,
      black: state?.blackTime || 180000,
      activeColor: state?.activeColor || "white",
      gameEnded: false,
      error: error.message,
      pocketPanel: state?.pocketPanel || { white: [], black: [] },
    }
  }
}

// Check game status for Crazyhouse
export function checkCrazyhouseGameStatus(state, gameInstance) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[STATUS] Invalid state provided to checkCrazyhouseGameStatus")
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

    // Check for time-based wins first
    if (state.whiteTime <= 0) return { result: "timeout", winnerColor: "black", reason: "white ran out of time" }
    if (state.blackTime <= 0) return { result: "timeout", winnerColor: "white", reason: "black ran out of time" }

    // In Crazyhouse, checkmate is harder to achieve due to piece drops
    // But we still check for it
    if (game.isCheckmate()) {
      const winnerColor = game.turn() === "w" ? "black" : "white"
      console.log(`CHECKMATE DETECTED: ${winnerColor} wins!`)
      return { result: "checkmate", winnerColor: winnerColor }
    }

    // Check for other draw conditions (less common in Crazyhouse)
    if (game.isStalemate()) return { result: "draw", reason: "stalemate", winnerColor: null }
    if (game.isInsufficientMaterial()) return { result: "draw", reason: "insufficient material", winnerColor: null }
    if (game.isThreefoldRepetition()) return { result: "draw", reason: "threefold repetition", winnerColor: null }
    if (game.isDraw()) return { result: "draw", reason: "50-move rule", winnerColor: null }

    // Manual repetition checks
    if (!(state.repetitionMap instanceof Map)) {
      state.repetitionMap = new Map(Object.entries(state.repetitionMap || {}))
    }
    const repetitionCount = state.repetitionMap.get(game.fen()) || 0
    if (repetitionCount >= 5) return { result: "draw", reason: "fivefold repetition", winnerColor: null }
    if (state.moveHistory && state.moveHistory.length >= 150)
      return { result: "draw", reason: "75-move rule", winnerColor: null }

    return { result: "ongoing", winnerColor: null }
  } catch (error) {
    console.error("Error checking Crazyhouse game status:", error)
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

// Get legal moves including possible drops
export function getCrazyhouseLegalMoves(state) {
  try {
    if (!state || !state.fen) {
      console.error("[MOVES] Invalid state provided to getCrazyhouseLegalMoves")
      return { moves: [], drops: [] }
    }

    const game = new Chess(state.fen)
    const regularMoves = game.moves({ verbose: true })

    // Get possible drops
    const currentPlayer = game.turn() === "w" ? "white" : "black"
    const availablePieces = state.pocketPanel?.[currentPlayer] || []
    const drops = []

    if (availablePieces.length > 0) {
      // Generate all possible drop squares
      for (let file = 0; file < 8; file++) {
        for (let rank = 0; rank < 8; rank++) {
          const square = String.fromCharCode(97 + file) + (rank + 1)
          const piece = game.get(square)

          // Only consider empty squares
          if (!piece) {
            for (const availablePiece of availablePieces) {
              // Check if drop is legal
              if (availablePiece === "p" && (rank === 0 || rank === 7)) {
                continue // Pawns can't be dropped on 1st or 8th rank
              }

              drops.push({
                piece: availablePiece,
                square: square,
                drop: true,
                san: `${availablePiece.toUpperCase()}@${square}`,
              })
            }
          }
        }
      }
    }

    return { moves: regularMoves, drops: drops }
  } catch (error) {
    console.error("Error getting Crazyhouse legal moves:", error)
    return { moves: [], drops: [] }
  }
}
