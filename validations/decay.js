import { Chess } from "chess.js"

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

// Create initial state for a 3+2 decay game
export function createDecayInitialState() {
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
      whiteTime: 180000, // 3 minutes in ms
      blackTime: 180000,
      increment: 2000, // 2 seconds increment per move
      turnStartTimestamp: now,
      lastMoveTimestamp: now,
      moveHistory: [],
      gameStarted: false,
      firstMoveTimestamp: null,
      capturedPieces: {
        white: [], // Pieces captured by white (black pieces)
        black: [], // Pieces captured by black (white pieces)
      },
      gameEnded: false,
      endReason: null,
      winner: null,
      endTimestamp: null,

      // Decay-specific fields
      decayActive: false, // Becomes true when first queen is moved
      decayTimers: {
        white: {
          queen: {
            active: false,
            timeRemaining: 0,
            moveCount: 0,
            frozen: false,
            startTimestamp: null,
            lastUpdateTimestamp: null,
          },
          majorPiece: {
            active: false,
            timeRemaining: 0,
            moveCount: 0,
            frozen: false,
            startTimestamp: null,
            lastUpdateTimestamp: null,
            pieceType: null, // 'rook', 'bishop', 'knight'
            pieceSquare: null, // to track which specific piece
          },
        },
        black: {
          queen: {
            active: false,
            timeRemaining: 0,
            moveCount: 0,
            frozen: false,
            startTimestamp: null,
            lastUpdateTimestamp: null,
          },
          majorPiece: {
            active: false,
            timeRemaining: 0,
            moveCount: 0,
            frozen: false,
            startTimestamp: null,
            lastUpdateTimestamp: null,
            pieceType: null,
            pieceSquare: null,
          },
        },
      },
      frozenPieces: {
        white: [], // Array of frozen piece positions
        black: [],
      },
    }
  } catch (error) {
    console.error("Error creating decay initial state:", error)
    throw error
  }
}

// Check if a piece is a major piece (for decay timer after queen freezes)
function isMajorPiece(pieceType) {
  return ["r", "n", "b"].includes(pieceType.toLowerCase())
}

// Update decay timers based on current timestamp
function updateDecayTimers(state, currentTimestamp) {
  if (!state.decayActive) return

  const colors = ["white", "black"]

  colors.forEach((color) => {
    // Update queen decay timer
    const queenTimer = state.decayTimers[color].queen
    if (queenTimer.active && !queenTimer.frozen) {
      const elapsed = currentTimestamp - queenTimer.lastUpdateTimestamp
      queenTimer.timeRemaining = Math.max(0, queenTimer.timeRemaining - elapsed)
      queenTimer.lastUpdateTimestamp = currentTimestamp

      // Check if queen timer expired
      if (queenTimer.timeRemaining <= 0) {
        queenTimer.frozen = true
        queenTimer.active = false
        state.frozenPieces[color].push("queen")
        console.log(`${color} queen frozen due to decay timer expiration`)
      }
    }

    // Update major piece decay timer
    const majorTimer = state.decayTimers[color].majorPiece
    if (majorTimer.active && !majorTimer.frozen) {
      const elapsed = currentTimestamp - majorTimer.lastUpdateTimestamp
      majorTimer.timeRemaining = Math.max(0, majorTimer.timeRemaining - elapsed)
      majorTimer.lastUpdateTimestamp = currentTimestamp

      // Check if major piece timer expired
      if (majorTimer.timeRemaining <= 0) {
        majorTimer.frozen = true
        majorTimer.active = false
        if (majorTimer.pieceSquare) {
          state.frozenPieces[color].push(majorTimer.pieceSquare)
        }
        console.log(
          `${color} ${majorTimer.pieceType} at ${majorTimer.pieceSquare} frozen due to decay timer expiration`,
        )
      }
    }
  })
}

// Check if a move involves a frozen piece
function isMovingFrozenPiece(state, move, playerColor) {
  const frozenPieces = state.frozenPieces[playerColor]

  // Check if moving a frozen queen
  if (frozenPieces.includes("queen")) {
    const game = new Chess(state.fen)
    const piece = game.get(move.from)
    if (piece && piece.type === "q" && piece.color === (playerColor === "white" ? "w" : "b")) {
      return { frozen: true, reason: "Queen is frozen due to decay timer expiration" }
    }
  }

  // Check if moving a frozen major piece
  if (frozenPieces.includes(move.from)) {
    return { frozen: true, reason: "This piece is frozen due to decay timer expiration" }
  }

  return { frozen: false }
}

// Handle decay timer logic for a move
function handleDecayMove(state, move, playerColor, currentTimestamp) {
  const game = new Chess(state.fen)
  const piece = game.get(move.from)

  if (!piece) return

  const color = playerColor
  const pieceType = piece.type
  const pieceColor = piece.color === "w" ? "white" : "black"

  // Only handle moves by the current player
  if (pieceColor !== color) return

  // Handle queen moves
  if (pieceType === "q") {
    const queenTimer = state.decayTimers[color].queen

    if (!state.decayActive) {
      // First queen move in the game - activate decay system
      state.decayActive = true
      console.log("Decay system activated - first queen move detected")
    }

    if (!queenTimer.active && !queenTimer.frozen) {
      // First time moving this queen
      queenTimer.active = true
      queenTimer.timeRemaining = 25000 // 25 seconds
      queenTimer.moveCount = 1
      queenTimer.startTimestamp = currentTimestamp
      queenTimer.lastUpdateTimestamp = currentTimestamp
      console.log(`${color} queen decay timer started: 25 seconds`)
    } else if (queenTimer.active && !queenTimer.frozen) {
      // Subsequent queen moves - add 2 seconds
      queenTimer.moveCount++
      queenTimer.timeRemaining += 2000
      queenTimer.lastUpdateTimestamp = currentTimestamp
      console.log(
        `${color} queen move #${queenTimer.moveCount}: +2 seconds added, total: ${queenTimer.timeRemaining}ms`,
      )
    }
  }

  // Handle major piece moves (only if queen is frozen)
  else if (isMajorPiece(pieceType) && state.decayTimers[color].queen.frozen) {
    const majorTimer = state.decayTimers[color].majorPiece

    if (!majorTimer.active && !majorTimer.frozen) {
      // First major piece move after queen is frozen
      majorTimer.active = true
      majorTimer.timeRemaining = 20000 // 20 seconds
      majorTimer.moveCount = 1
      majorTimer.pieceType = pieceType
      majorTimer.pieceSquare = move.to // Track where the piece moved to
      majorTimer.startTimestamp = currentTimestamp
      majorTimer.lastUpdateTimestamp = currentTimestamp
      console.log(`${color} ${pieceType} decay timer started: 20 seconds`)
    } else if (majorTimer.active && !majorTimer.frozen && majorTimer.pieceSquare === move.from) {
      // Moving the same major piece that has the timer
      majorTimer.moveCount++
      majorTimer.timeRemaining += 2000
      majorTimer.pieceSquare = move.to // Update position
      majorTimer.lastUpdateTimestamp = currentTimestamp
      console.log(
        `${color} ${pieceType} move #${majorTimer.moveCount}: +2 seconds added, total: ${majorTimer.timeRemaining}ms`,
      )
    }
  }
}

// Validate a move and apply decay rules
export function validateAndApplyDecayMove(state, move, playerColor, currentTimestamp) {
  try {
    console.log("=== DECAY MOVE VALIDATION START ===")
    console.log("Move:", move, "Player:", playerColor)
    console.log("Decay active:", state.decayActive)

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

    // Update decay timers before processing move
    updateDecayTimers(state, currentTimestamp)

    // Check if trying to move a frozen piece
    const frozenCheck = isMovingFrozenPiece(state, move, playerColor)
    if (frozenCheck.frozen) {
      return {
        valid: false,
        reason: frozenCheck.reason,
        code: "PIECE_FROZEN",
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
    if (!state.moveHistory) state.moveHistory = []
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
      // Calculate elapsed time and deduct from current player
      const elapsed = currentTimestamp - state.turnStartTimestamp

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

    // Handle decay logic for this move
    handleDecayMove(state, move, playerColor, currentTimestamp)

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

    console.log("Move completed:")
    console.log("- FEN changed from:", oldFen.split(" ")[0], "to:", state.fen.split(" ")[0])
    console.log("- Next player's turn:", newActivePlayer, "Active color:", state.activeColor)
    console.log("- Final times - White:", state.whiteTime, "Black:", state.blackTime)

    // Update repetition tracking
    updateRepetitionMap(state, game)
    const resultStatus = checkDecayGameStatus(state, game)

    // Check if the game has ended
    if (resultStatus.result !== "ongoing") {
      state.gameEnded = true
      state.endReason = resultStatus.result
      state.winnerColor = resultStatus.winnerColor || null
      state.endTimestamp = currentTimestamp
      resultStatus.shouldNavigateToMenu = true
      resultStatus.endTimestamp = currentTimestamp
      resultStatus.winnerColor = state.winnerColor
    }

    // Remove Chess instance before returning
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
      // Decay-specific state
      decayActive: state.decayActive,
      decayTimers: state.decayTimers,
      frozenPieces: state.frozenPieces,
    }

    console.log("Game state after move:", state.gameState)
    console.log("Current decay timers:", state.decayTimers)
    console.log("Frozen pieces:", state.frozenPieces)
    

    console.log("=== DECAY MOVE VALIDATION END ===")


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
    console.error("Error in validateAndApplyDecayMove:", error)
    return {
      valid: false,
      reason: "Internal error during move validation",
      error: error.message,
      code: "INTERNAL_ERROR",
      stack: error.stack,
    }
  }
}

// Get current timer values including decay timers
export function getCurrentDecayTimers(state, currentTimestamp) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[DECAY_TIMER] Invalid state provided")
      return {
        white: 180000,
        black: 180000,
        activeColor: "white",
        gameEnded: false,
        error: "Invalid state",
        decayTimers: null,
      }
    }

    if (!currentTimestamp || typeof currentTimestamp !== "number") {
      currentTimestamp = Date.now()
    }

    // Update decay timers
    updateDecayTimers(state, currentTimestamp)

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
        decayTimers: state.decayTimers,
        frozenPieces: state.frozenPieces,
      }
    }

    if (!state.gameStarted || !state.turnStartTimestamp || state.moveHistory.length === 0) {
      return {
        white: state.whiteTime || 180000,
        black: state.blackTime || 180000,
        activeColor: state.activeColor || "white",
        gameEnded: false,
        decayTimers: state.decayTimers,
        frozenPieces: state.frozenPieces,
      }
    }

    // Reconstruct game to check whose turn it is
    let game
    try {
      game = new Chess(state.fen)
    } catch (error) {
      console.error("[DECAY_TIMER] Error reconstructing game from FEN:", error)
      return {
        white: state.whiteTime || 180000,
        black: state.blackTime || 180000,
        activeColor: state.activeColor || "white",
        gameEnded: false,
        error: "Invalid FEN",
        decayTimers: state.decayTimers,
        frozenPieces: state.frozenPieces,
      }
    }

    const currentPlayer = game.turn()
    const currentPlayerColor = currentPlayer === "w" ? "white" : "black"
    const elapsed = currentTimestamp - state.turnStartTimestamp

    let whiteTime = state.whiteTime || 180000
    let blackTime = state.blackTime || 180000

    // Deduct time from current player
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
        decayTimers: state.decayTimers,
        frozenPieces: state.frozenPieces,
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
        decayTimers: state.decayTimers,
        frozenPieces: state.frozenPieces,
      }
    }

    return {
      white: whiteTime,
      black: blackTime,
      activeColor: currentPlayerColor,
      gameEnded: false,
      decayTimers: state.decayTimers,
      frozenPieces: state.frozenPieces,
    }
  } catch (error) {
    console.error("Error in getCurrentDecayTimers:", error)
    return {
      white: state?.whiteTime || 180000,
      black: state?.blackTime || 180000,
      activeColor: state?.activeColor || "white",
      gameEnded: false,
      error: error.message,
      decayTimers: state?.decayTimers || null,
      frozenPieces: state?.frozenPieces || null,
    }
  }
}

// Generate legal moves excluding frozen pieces
export function getDecayLegalMoves(fen, frozenPieces, playerColor) {
  try {
    if (!fen || typeof fen !== "string") {
      console.error("[DECAY_MOVES] Invalid FEN provided:", fen)
      return []
    }

    const game = new Chess(fen)
    const allMoves = game.moves({ verbose: true })

    if (!frozenPieces || !frozenPieces[playerColor]) {
      return allMoves
    }

    const frozen = frozenPieces[playerColor]

    // Filter out moves from frozen pieces
    return allMoves.filter((move) => {
      // Check if moving frozen queen
      if (frozen.includes("queen")) {
        const piece = game.get(move.from)
        if (piece && piece.type === "q" && piece.color === (playerColor === "white" ? "w" : "b")) {
          return false
        }
      }

      // Check if moving from a frozen square
      if (frozen.includes(move.from)) {
        return false
      }

      return true
    })
  } catch (error) {
    console.error("Error getting decay legal moves:", error)
    return []
  }
}

// Check game status including decay-specific conditions
export function checkDecayGameStatus(state, gameInstance) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[DECAY_STATUS] Invalid state provided")
      return { result: "ongoing", error: "Invalid state" }
    }

    let game = gameInstance
    if (!game) {
      if (!state.fen) {
        console.error("[DECAY_STATUS] Missing FEN in game state")
        return { result: "ongoing", error: "Missing FEN" }
      }
      try {
        game = new Chess(state.fen)
      } catch (error) {
        console.error("[DECAY_STATUS] Error reconstructing game from FEN:", error)
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
    console.error("Error checking decay game status:", error)
    return { result: "ongoing", error: error.message, winnerColor: null }
  }
}

// Helper: track FEN repetitions
export function updateRepetitionMap(state, gameInstance) {
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
