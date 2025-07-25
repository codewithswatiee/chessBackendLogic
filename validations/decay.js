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
      // Decay-specific fields - simplified structure
      decayActive: false, // Becomes true when first queen is moved
      queenDecayTimers: {
        white: {
          active: false,
          timeRemaining: 0,
          moveCount: 0,
          frozen: false,
          square: null,
        },
        black: {
          active: false,
          timeRemaining: 0,
          moveCount: 0,
          frozen: false,
          square: null,
        },
      },
      majorPieceDecayTimers: {
        white: {
          active: false,
          timeRemaining: 0,
          moveCount: 0,
          frozen: false,
          pieceType: null,
          square: null,
        },
        black: {
          active: false,
          timeRemaining: 0,
          moveCount: 0,
          frozen: false,
          pieceType: null,
          square: null,
        },
      },
      frozenPieces: {
        white: [], // Array of frozen piece squares
        black: [],
      },
    }
  } catch (error) {
    console.error("Error creating decay initial state:", error)
    throw error
  }
}

// Constants for decay timers
const QUEEN_INITIAL_DECAY_TIME = 25000 // 25 seconds
const MAJOR_PIECE_INITIAL_DECAY_TIME = 20000 // 20 seconds
const DECAY_TIME_INCREMENT = 2000 // +2 seconds per move

// Check if a piece is a major piece (for decay timer after queen freezes)
function isMajorPiece(pieceType) {
  return ["r", "n", "b"].includes(pieceType.toLowerCase())
}

// Check if a piece is a queen
function isQueen(pieceType) {
  return pieceType.toLowerCase() === "q"
}

// Update decay timers based on current timestamp - ONLY during player's turn
function updateDecayTimers(state, currentTimestamp) {
  if (!state.decayActive) return

  // Determine whose turn it is
  let game
  try {
    game = new Chess(state.fen)
  } catch (e) {
    return
  }

  const turn = game.turn() // 'w' or 'b'
  const color = turn === "w" ? "white" : "black"

  // Only update decay timers for the player whose turn it is
  const queenTimer = state.queenDecayTimers[color]
  if (queenTimer.active && !queenTimer.frozen) {
    const elapsed = currentTimestamp - state.turnStartTimestamp
    queenTimer.timeRemaining = Math.max(0, queenTimer.timeRemaining - elapsed)

    if (queenTimer.timeRemaining <= 0) {
      queenTimer.frozen = true
      queenTimer.active = false
      if (queenTimer.square) {
        state.frozenPieces[color].push(queenTimer.square)
      }
      console.log(`${color} queen frozen due to decay timer expiration`)
    }
  }

  // Update major piece decay timer
  const majorTimer = state.majorPieceDecayTimers[color]
  if (majorTimer.active && !majorTimer.frozen) {
    const elapsed = currentTimestamp - state.turnStartTimestamp
    majorTimer.timeRemaining = Math.max(0, majorTimer.timeRemaining - elapsed)

    if (majorTimer.timeRemaining <= 0) {
      majorTimer.frozen = true
      majorTimer.active = false
      if (majorTimer.square) {
        state.frozenPieces[color].push(majorTimer.square)
      }
      console.log(`${color} ${majorTimer.pieceType} at ${majorTimer.square} frozen due to decay timer expiration`)
    }
  }
}

// Check if a move involves a frozen piece
function isMovingFrozenPiece(state, move, playerColor) {
  const frozenPieces = state.frozenPieces[playerColor]

  // Check if moving from a frozen square
  if (frozenPieces.includes(move.from)) {
    return { frozen: true, reason: "This piece is frozen due to decay timer expiration" }
  }

  return { frozen: false }
}

// Handle decay timer logic for a move - CORE REQUIREMENT IMPLEMENTATION
function handleDecayMove(state, move, playerColor, currentTimestamp) {
  const game = new Chess(state.fen)
  const piece = game.get(move.from)
  if (!piece) return

  const color = playerColor
  const pieceType = piece.type
  const pieceColor = piece.color === "w" ? "white" : "black"

  // Only handle moves by the current player
  if (pieceColor !== color) return

  // Handle queen moves - CORE REQUIREMENT
  if (isQueen(pieceType)) {
    const queenTimer = state.queenDecayTimers[color]

    if (!state.decayActive) {
      state.decayActive = true
      console.log("Decay system activated - first queen move detected")
    }

    if (!queenTimer.active && !queenTimer.frozen) {
      queenTimer.active = true
      queenTimer.timeRemaining = QUEEN_INITIAL_DECAY_TIME
      queenTimer.moveCount = 1
      queenTimer.square = move.to
      console.log(`${color} queen decay timer started: 25 seconds`)
    } else if (queenTimer.active && !queenTimer.frozen) {
      // Only increment by 2 seconds per move, never above 25s
      queenTimer.moveCount++
      queenTimer.timeRemaining = Math.min(
        queenTimer.timeRemaining + DECAY_TIME_INCREMENT, // always +2s
        QUEEN_INITIAL_DECAY_TIME
      )
      queenTimer.square = move.to
      console.log(
        `${color} queen move #${queenTimer.moveCount}: +2 seconds added, total: ${queenTimer.timeRemaining}ms (max 25000ms)`
      )
    }
  }
  // Handle major piece moves - FIXED VERSION
  else if (isMajorPiece(pieceType)) {
    const queenTimer = state.queenDecayTimers[color]
    const majorTimer = state.majorPieceDecayTimers[color]

    if (queenTimer.frozen && !majorTimer.active && !majorTimer.frozen) {
      // Start decay timer for the FIRST major piece moved after queen freezes
      majorTimer.active = true
      majorTimer.timeRemaining = MAJOR_PIECE_INITIAL_DECAY_TIME
      majorTimer.moveCount = 1
      majorTimer.pieceType = pieceType
      majorTimer.square = move.to
      console.log(`${color} ${pieceType} decay timer started: 20 seconds (first major piece after queen frozen)`)
    } else if (majorTimer.active && !majorTimer.frozen) {
      // Only allow moves of the SAME major piece that started decaying
      if (majorTimer.square === move.from && majorTimer.pieceType === pieceType) {
        // Update timer for the tracked major piece
        majorTimer.moveCount++
        majorTimer.timeRemaining = Math.min(
          majorTimer.timeRemaining + DECAY_TIME_INCREMENT,
          MAJOR_PIECE_INITIAL_DECAY_TIME
        )
        majorTimer.square = move.to
        console.log(
          `${color} ${pieceType} move #${majorTimer.moveCount}: +2 seconds added, total: ${majorTimer.timeRemaining}ms`
        )
      }
    }
  }
}

// Validate a move and apply decay rules - REFACTORED FOR CLARITY
export function validateAndApplyDecayMove(state, move, playerColor, currentTimestamp) {
  try {
    console.log("=== DECAY MOVE VALIDATION START ===")
    console.log("Move:", move, "Player:", playerColor)

    // Input validation
    if (!validateInputs(state, move, playerColor)) {
      return { valid: false, reason: "Invalid input parameters", code: "INVALID_INPUT" }
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

    // Initialize state if needed
    initializeStateDefaults(state, currentTimestamp)

    // Check for timeout before processing move
    const timeoutResult = checkForTimeout(state, currentTimestamp)
    if (timeoutResult.gameEnded) {
      return timeoutResult
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

    // Validate the chess move
    const moveResult = validateChessMove(state, move, playerColor, currentTimestamp)
    if (!moveResult.valid) {
      return moveResult
    }

    // Apply decay logic for this move
    handleDecayMove(state, move, playerColor, currentTimestamp)

    // Update game state after successful move
    updateGameStateAfterMove(state, moveResult, currentTimestamp)

    // Check game status
    const gameStatus = checkDecayGameStatus(state, moveResult.game)
    if (gameStatus.result !== "ongoing") {
      finalizeGameEnd(state, gameStatus, currentTimestamp)
    }

    // Clean up and return result
    if (state.game) delete state.game

    console.log("=== DECAY MOVE VALIDATION END ===")
    return createMoveResult(state, moveResult, gameStatus)
  } catch (error) {
    console.error("Error in validateAndApplyDecayMove:", error)
    return {
      valid: false,
      reason: "Internal error during move validation",
      error: error.message,
      code: "INTERNAL_ERROR",
    }
  }
}

// Helper functions for better organization
function validateInputs(state, move, playerColor) {
  if (!state || typeof state !== "object") return false
  if (!move || typeof move !== "object" || !move.from || !move.to) return false
  if (!playerColor || (playerColor !== "white" && playerColor !== "black")) return false
  return true
}

function initializeStateDefaults(state, currentTimestamp) {
  if (typeof state.turnStartTimestamp !== "number") state.turnStartTimestamp = currentTimestamp
  if (typeof state.lastMoveTimestamp !== "number") state.lastMoveTimestamp = currentTimestamp
  if (typeof state.whiteTime !== "number") state.whiteTime = 180000
  if (typeof state.blackTime !== "number") state.blackTime = 180000
  if (!state.moveHistory) state.moveHistory = []
  if (typeof state.gameStarted !== "boolean") state.gameStarted = false
  if (!state.firstMoveTimestamp) state.firstMoveTimestamp = null
  if (!state.capturedPieces) state.capturedPieces = { white: [], black: [] }
  if (typeof state.gameEnded !== "boolean") state.gameEnded = false
}

function checkForTimeout(state, currentTimestamp) {
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
  state.winner = null
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
  // Reconstruct game from FEN
  let game
  try {
    game = new Chess(state.fen)
    state.game = game
  } catch (error) {
    console.error("Error reconstructing game from FEN:", error)
    return { valid: false, reason: "Invalid game state", code: "INVALID_FEN" }
  }

  // Check turn
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
  } else {
    // Calculate elapsed time and deduct from current player
    const elapsed = currentTimestamp - state.turnStartTimestamp
    if (currentPlayerBeforeMove === "w") {
      state.whiteTime = Math.max(0, state.whiteTime - elapsed)
    } else {
      state.blackTime = Math.max(0, state.blackTime - elapsed)
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

  return {
    valid: true,
    result: result,
    game: game,
    capturedPiece: capturedPiece,
    currentPlayerBeforeMove: currentPlayerBeforeMove,
  }
}

function updateGameStateAfterMove(state, moveResult, currentTimestamp) {
  const { result, capturedPiece, currentPlayerBeforeMove, game } = moveResult

  // Track captured pieces
  if (capturedPiece) {
    const capturingPlayer = currentPlayerBeforeMove === "w" ? "white" : "black"
    state.capturedPieces[capturingPlayer].push(capturedPiece.type)
    console.log(`${capturingPlayer} captured ${capturedPiece.type}`)

    // --- UNFREEZE LOGIC: Remove the square from frozenPieces if it was frozen ---
    const opponentColor = capturingPlayer === "white" ? "black" : "white"
    const capturedSquare = result.to
    const frozenIndex = state.frozenPieces[opponentColor].indexOf(capturedSquare)
    if (frozenIndex !== -1) {
      state.frozenPieces[opponentColor].splice(frozenIndex, 1)
      console.log(`Unfroze square ${capturedSquare} for ${opponentColor} (piece was captured)`)
    }
    // --------------------------------------------------------------------------
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
}

function finalizeGameEnd(state, gameStatus, currentTimestamp) {
  state.gameEnded = true
  state.endReason = gameStatus.result
  state.winnerColor = gameStatus.winnerColor || null
  state.endTimestamp = currentTimestamp
}

function createMoveResult(state, moveResult, gameStatus) {
  // Add detailed game state info
  state.gameState = {
    check: moveResult.game.inCheck ? moveResult.game.inCheck() : false,
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
    // Decay-specific state
    decayActive: state.decayActive,
    queenDecayTimers: state.queenDecayTimers,
    majorPieceDecayTimers: state.majorPieceDecayTimers,
    frozenPieces: state.frozenPieces,
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

// Get current timer values including decay timers - IMPROVED PRECISION
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
      }
    }

    if (!currentTimestamp || typeof currentTimestamp !== "number") {
      currentTimestamp = Date.now()
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
        queenDecayTimers: state.queenDecayTimers,
        majorPieceDecayTimers: state.majorPieceDecayTimers,
        frozenPieces: state.frozenPieces,
      }
    }

    // For first move, don't deduct time
    if (!state.gameStarted || !state.turnStartTimestamp || state.moveHistory.length === 0) {
      return {
        white: state.whiteTime || 180000,
        black: state.blackTime || 180000,
        activeColor: state.activeColor || "white",
        gameEnded: false,
        queenDecayTimers: state.queenDecayTimers,
        majorPieceDecayTimers: state.majorPieceDecayTimers,
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
      }
    }

    const currentPlayer = game.turn()
    const currentPlayerColor = currentPlayer === "w" ? "white" : "black"
    const elapsed = currentTimestamp - state.turnStartTimestamp

    let whiteTime = state.whiteTime || 180000
    let blackTime = state.blackTime || 180000

    // Deduct time from current player only
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

    // Update decay timers for current player
    updateDecayTimers(state, currentTimestamp)

    return {
      white: whiteTime,
      black: blackTime,
      activeColor: currentPlayerColor,
      gameEnded: false,
      queenDecayTimers: state.queenDecayTimers,
      majorPieceDecayTimers: state.majorPieceDecayTimers,
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

    // Filter out moves from frozen squares
    return allMoves.filter((move) => {
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
