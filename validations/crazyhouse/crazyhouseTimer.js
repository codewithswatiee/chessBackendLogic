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
        white: [], // Pieces captured by white (black pieces) - stored as { type: 'p', id: 'unique_id', capturedAt: timestamp }
        black: [], // Pieces captured by black (white pieces)
      },
      // Maps to store drop timers: key is piece ID, value is expiration timestamp
      dropTimers: {
        white: new Map(),
        black: new Map(),
      },
      // Derived state: pieces in pocket that are not currently available for drop
      frozenPieces: {
        white: [],
        black: [],
      },
      repetitionMap: new Map(),
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

  for (const color of ["white", "black"]) {
    const pocket = state.pocketedPieces[color]
    const timers = state.dropTimers[color]

    if (pocket.length === 0 || timers.size === 0) continue

    // Only update timer for the player whose turn it is
    if (color === currentPlayerColor) {
      const firstPiece = pocket[0]
      const timerKey = firstPiece.id
      let expirationTimestamp = timers.get(timerKey)

      // If timer hasn't started yet, start it now
      if (!expirationTimestamp) {
        timers.set(timerKey, currentTimestamp + DROP_TIME_LIMIT)
        expirationTimestamp = timers.get(timerKey)
      }

      // If timer expired, move piece to frozen
      if (currentTimestamp >= expirationTimestamp) {
        // Remove expired piece from pocket and timer
        pocket.shift()
        timers.delete(timerKey)
        state.frozenPieces[color].push(firstPiece)
        console.log(`Piece ${firstPiece.type} expired for ${color}, moved to frozen.`)

        // Start timer for next piece, if any
        if (pocket.length > 0) {
          const nextPiece = pocket[0]
          timers.set(nextPiece.id, currentTimestamp + DROP_TIME_LIMIT)
        }
      }
    }
    // For opponent, do NOT decrement timer or start timer
  }
}

// Handle piece drop logic - enhanced with better validation
function handlePieceDrop(state, move, playerColor, game) {
  const playerPocket = state.pocketedPieces[playerColor]
  const playerDropTimers = state.dropTimers[playerColor]
  const now = Date.now()

  console.log(`Handling piece drop for ${playerColor}:`, {
    pocket: playerPocket,
    timers: Object.fromEntries(playerDropTimers),
    move,
  })

  // Check if pocket has pieces
  if (playerPocket.length === 0) {
    return { valid: false, reason: "No pieces in pocket", code: "PIECE_NOT_IN_POCKET" }
  }

  // Sequential drop: only first piece in pocket is available
  const firstPiece = playerPocket[0]
  if (move.piece !== firstPiece.type) {
    return {
      valid: false,
      reason: `Only ${firstPiece.type} can be dropped next. Current queue: ${playerPocket.map((p) => p.type).join(", ")}`,
      code: "SEQUENTIAL_DROP_ONLY",
    }
  }

  const timerKey = firstPiece.id
  let expirationTimestamp = playerDropTimers.get(timerKey)

  // If timer is not in the active map, check if it's paused on the piece itself
  if (!expirationTimestamp && firstPiece.timerPaused && firstPiece.remainingTime !== undefined) {
    expirationTimestamp = now + firstPiece.remainingTime // Calculate effective expiration
  }

  // Check if piece has an active timer (either in map or paused on piece)
  if (!expirationTimestamp) {
    return { valid: false, reason: `No active timer found for piece ${firstPiece.type}`, code: "PIECE_NOT_AVAILABLE" }
  }

  // Check if piece timer has expired
  if (now >= expirationTimestamp) {
    // Auto-remove expired piece
    playerPocket.shift()
    playerDropTimers.delete(timerKey)
    delete firstPiece.timerPaused // Clean up paused flag
    delete firstPiece.remainingTime // Clean up remaining time

    // Start timer for next piece, if any
    if (playerPocket.length > 0) {
      const nextPiece = playerPocket[0]
      playerDropTimers.set(nextPiece.id, now + DROP_TIME_LIMIT)
      console.log(`Started timer for next piece ${nextPiece.type} after expired drop attempt.`)
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

  // Create a test game to validate the drop doesn't put player in check
  const testGame = new Chess(game.fen())
  try {
    testGame.put({ type: firstPiece.type, color: playerColor === "white" ? "w" : "b" }, move.to)

    // Check if this puts the current player in check (illegal)
    if (testGame.inCheck() && testGame.turn() === (playerColor === "white" ? "w" : "b")) {
      return { valid: false, reason: "Drop would leave king in check", code: "SELF_CHECK" }
    }
  } catch (error) {
    console.error("Chess.js put error during drop validation:", error)
    return { valid: false, reason: "Illegal drop: " + error.message, code: "CHESS_JS_ERROR" }
  }

  // Apply the drop to the actual game
  try {
    game.put({ type: firstPiece.type, color: playerColor === "white" ? "w" : "b" }, move.to)

    // --- IMPORTANT: Manually advance the turn for drops ---
    const currentFenParts = game.fen().split(" ")
    currentFenParts[1] = currentFenParts[1] === "w" ? "b" : "w" // Toggle active color
    game.load(currentFenParts.join(" ")) // Load the updated FEN back into the game object
    // --- End of turn advancement for drops ---

    // Remove from pocket and timer
    playerPocket.shift()
    playerDropTimers.delete(timerKey)
    delete firstPiece.timerPaused // Clean up paused flag
    delete firstPiece.remainingTime // Clean up remaining time

    // Start timer for next piece, if any
    if (playerPocket.length > 0) {
      const nextPiece = playerPocket[0]
      playerDropTimers.set(nextPiece.id, now + DROP_TIME_LIMIT)
      console.log(`Started timer for next piece ${nextPiece.type} after successful drop.`)
    }

    return {
      valid: true,
      game: game,
      result: {
        type: "d", // drop flag
        piece: firstPiece.type,
        to: move.to,
        from: "pocket",
        san: `${firstPiece.type.toUpperCase()}@${move.to}`,
        color: playerColor === "white" ? "w" : "b",
      },
    }
  } catch (error) {
    console.error("Chess.js put error during actual drop:", error)
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
      // If it's a capture, add to pocketedPieces and manage drop timers
      if (moveResult.valid && moveResult.capturedPiece) {
        const capturedPieceType = moveResult.capturedPiece.type.toLowerCase()
        const capturingPlayerColor = playerColor
        const pieceId = `${capturedPieceType}_${currentTimestamp}_${Math.random().toString(36).substr(2, 9)}`
        const pieceObj = {
          type: capturedPieceType,
          id: pieceId,
          capturedAt: currentTimestamp,
        }
        const pocket = state.pocketedPieces[capturingPlayerColor]
        const timers = state.dropTimers[capturingPlayerColor]
        const wasEmpty = pocket.length === 0
        pocket.push(pieceObj)

        // Start timer immediately if this is the first piece, or if no timer exists for first piece
        if (wasEmpty || (pocket.length === 1 && !timers.has(pieceObj.id))) {
          timers.set(pieceId, currentTimestamp + DROP_TIME_LIMIT)
          console.log(`Started immediate timer for captured ${capturedPieceType} by ${capturingPlayerColor}.`)
        }
        // If not the first piece, timer will be started when previous pieces are used/expired

        console.log(`${capturingPlayerColor} captured ${capturedPieceType}. Pocket now has ${pocket.length} pieces.`)
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

    console.log("=== Final State ===")
    console.log("Drop Timers:", {
      white: Object.fromEntries(state.dropTimers.white),
      black: Object.fromEntries(state.dropTimers.black),
    })
    console.log("Pocketed Pieces:", state.pocketedPieces)

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

// Helper functions for better organization
function validateInputs(state, move, playerColor) {
  if (!state || typeof state !== "object") return false
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
  if (!state.pocketedPieces) state.pocketedPieces = { white: [], black: [] }

  if (!state.dropTimers) {
    state.dropTimers = { white: new Map(), black: new Map() }
  } else {
    // Ensure Maps are rehydrated if they come from a plain object (e.g., database)
    if (!(state.dropTimers.white instanceof Map)) {
      state.dropTimers.white = new Map(Object.entries(state.dropTimers.white || {}))
    }
    if (!(state.dropTimers.black instanceof Map)) {
      state.dropTimers.black = new Map(Object.entries(state.dropTimers.black || {}))
    }
  }

  if (typeof state.gameEnded !== "boolean") state.gameEnded = false
  if (!state.frozenPieces) state.frozenPieces = { white: [], black: [] }
  if (!state.repetitionMap) {
    state.repetitionMap = new Map()
  } else if (!(state.repetitionMap instanceof Map)) {
    state.repetitionMap = new Map(Object.entries(state.repetitionMap || {}))
  }
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
  const game = state.game
  // Handle timing for first move
  if (!state.gameStarted || state.moveHistory.length === 0) {
    console.log("FIRST MOVE DETECTED - Starting game timers")
    state.gameStarted = true
    state.firstMoveTimestamp = currentTimestamp
    state.turnStartTimestamp = currentTimestamp
    state.lastMoveTimestamp = currentTimestamp
  }

  // Validate and apply the move
  let result
  try {
    result = game.move(move)
  } catch (error) {
    console.error("Chess.js move error:", error)
    return { valid: false, reason: "Invalid move", code: "CHESS_JS_ERROR", details: error.message }
  }

  if (!result) {
    return { valid: false, reason: "Illegal move", code: "ILLEGAL_MOVE" }
  }

  return {
    valid: true,
    result: result,
    game: game,
    capturedPiece: result.captured ? { type: result.captured, color: result.color } : null,
    currentPlayerBeforeMove: game.turn() === "w" ? "b" : "w", // Previous player
  }
}

function updateGameStateAfterMove(state, moveResult, currentTimestamp, isDrop) {
  const { result, game } = moveResult
  const oldFen = state.fen
  state.fen = game.fen()
  state.lastMoveTimestamp = currentTimestamp

  // Calculate elapsed time for the move
  const previousPlayer = isDrop ? (game.turn() === "w" ? "b" : "w") : moveResult.currentPlayerBeforeMove
  const turnStart = state.turnStartTimestamp || currentTimestamp
  const elapsed = Math.max(0, currentTimestamp - turnStart)

  // Deduct elapsed time, then add increment (but not for first move)
  if (state.gameStarted && state.moveHistory.length > 0) {
    if (previousPlayer === "w") {
      state.whiteTime = Math.max(0, state.whiteTime - elapsed + state.increment)
    } else {
      state.blackTime = Math.max(0, state.blackTime - elapsed + state.increment)
    }
  } else {
    // First move: just set gameStarted, don't deduct or increment
    state.gameStarted = true
    state.firstMoveTimestamp = currentTimestamp
  }

  // Reset turn start timestamp for the NEXT player's turn
  state.turnStartTimestamp = currentTimestamp
  state.moveHistory.push(result)

  // Update the active color
  const newActivePlayer = game.turn()
  state.activeColor = newActivePlayer === "w" ? "white" : "black"

  // Pause timers for previous player and resume for new active player
  const previousColor = previousPlayer === "w" ? "white" : "black"
  const newColor = newActivePlayer === "w" ? "white" : "black"

  // Pause previous player's timers
  pauseDropTimer(state, previousColor, currentTimestamp)

  // Resume new player's timers
  resumeDropTimer(state, newColor, currentTimestamp)

  console.log("Move/Drop completed:")
  console.log("- FEN changed from:", oldFen, "to:", state.fen)
  console.log("- Next player's turn:", newActivePlayer, "Active color:", state.activeColor)
  console.log("- Final times - White:", state.whiteTime, "Black:", state.blackTime)

  // Update repetition tracking (Crazyhouse repetition includes pocket state)
  updateRepetitionMap(state, game, true)
}

function finalizeGameEnd(state, gameStatus, currentTimestamp) {
  state.gameEnded = true
  state.endReason = gameStatus.result
  state.winnerColor = gameStatus.winnerColor || null
  state.endTimestamp = currentTimestamp
}

function createMoveResult(state, moveResult, gameStatus) {
  // Derive frozenPieces for the current state
  const derivedFrozenPieces = deriveFrozenPieces(state)
  state.gameState = {
    check: moveResult.game.inCheck(),
    checkmate: moveResult.game.isCheckmate(),
    stalemate: moveResult.game.isStalemate(),
    insufficientMaterial: moveResult.game.isInsufficientMaterial(),
    threefoldRepetition: isThreefoldRepetition(state),
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
    dropTimers: {
      white: Object.fromEntries(state.dropTimers.white),
      black: Object.fromEntries(state.dropTimers.black),
    },
    frozenPieces: derivedFrozenPieces,
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

// Helper function to derive frozen pieces
function deriveFrozenPieces(state) {
  const now = Date.now()
  const frozenPieces = {
    white: [],
    black: [],
  }

  for (const color of ["white", "black"]) {
    const pocket = state.pocketedPieces[color]
    const timers = state.dropTimers[color]

    if (pocket.length > 0) {
      // First piece with active, non-expired timer is droppable
      const firstPiece = pocket[0]
      let timerExpiration = timers.get(firstPiece.id)

      // If timer is not in the active map, check if it's paused on the piece itself
      if (!timerExpiration && firstPiece.timerPaused && firstPiece.remainingTime !== undefined) {
        timerExpiration = now + firstPiece.remainingTime // Calculate effective expiration
      }

      if (!timerExpiration || now >= timerExpiration) {
        // First piece has no active timer or expired timer - all pieces are frozen
        frozenPieces[color] = [...pocket]
      } else {
        // First piece is droppable - rest are frozen
        frozenPieces[color] = pocket.slice(1)
      }
    }
  }
  return frozenPieces
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

    // Initialize defaults
    initializeStateDefaults(state, currentTimestamp)

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
          black: Object.fromEntries(state.dropTimers.black),
        },
        frozenPieces: deriveFrozenPieces(state),
      }
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
          black: Object.fromEntries(state.dropTimers.black),
        },
        frozenPieces: deriveFrozenPieces(state),
      }
    }

    // Create temporary state for calculation without modifying original
    const tempState = {
      ...state,
      dropTimers: {
        white: new Map(state.dropTimers.white),
        black: new Map(state.dropTimers.black),
      },
      pocketedPieces: {
        white: [...state.pocketedPieces.white],
        black: [...state.pocketedPieces.black],
      },
    }

    updateCrazyhouseTimers(tempState, currentTimestamp)

    // Check for timeout after temp update
    if (tempState.whiteTime <= 0) {
      state.gameEnded = true
      state.endReason = "timeout"
      state.winnerColor = "black"
      state.endTimestamp = currentTimestamp
      return {
        white: 0,
        black: tempState.blackTime,
        activeColor: tempState.activeColor,
        gameEnded: true,
        endReason: "timeout",
        winnerColor: "black",
        shouldNavigateToMenu: true,
        endTimestamp: currentTimestamp,
        pocketedPieces: tempState.pocketedPieces,
        dropTimers: {
          white: Object.fromEntries(tempState.dropTimers.white),
          black: Object.fromEntries(tempState.dropTimers.black),
        },
        frozenPieces: deriveFrozenPieces(tempState),
      }
    }

    if (tempState.blackTime <= 0) {
      state.gameEnded = true
      state.endReason = "timeout"
      state.winnerColor = "white"
      state.endTimestamp = currentTimestamp
      return {
        white: tempState.whiteTime,
        black: 0,
        activeColor: tempState.activeColor,
        gameEnded: true,
        endReason: "timeout",
        winnerColor: "white",
        shouldNavigateToMenu: true,
        endTimestamp: currentTimestamp,
        pocketedPieces: tempState.pocketedPieces,
        dropTimers: {
          white: Object.fromEntries(tempState.dropTimers.white),
          black: Object.fromEntries(tempState.dropTimers.black),
        },
        frozenPieces: deriveFrozenPieces(tempState),
      }
    }

    return {
      white: tempState.whiteTime,
      black: tempState.blackTime,
      activeColor: tempState.activeColor,
      gameEnded: false,
      pocketedPieces: tempState.pocketedPieces,
      dropTimers: {
        white: Object.fromEntries(tempState.dropTimers.white),
        black: Object.fromEntries(tempState.dropTimers.black),
      },
      frozenPieces: deriveFrozenPieces(tempState),
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
  console.log("=== CRAZYHOUSE LEGAL MOVES GENERATION START ===")
  console.log("FEN:", pocketedPieces, "Player Color:", playerColor, "Drop Timers:", dropTimers)
  try {
    if (!fen || typeof fen !== "string") {
      console.error("[CRAZYHOUSE_MOVES] Invalid FEN provided:", fen)
      return []
    }

    const game = new Chess(fen)
    const allBoardMoves = game.moves({ verbose: true })
    const legalMoves = [...allBoardMoves]

    // Add possible piece drops
    if (pocketedPieces && pocketedPieces[playerColor] && dropTimers && dropTimers[playerColor]) {
      const currentPlayerPocket = pocketedPieces[playerColor]
      console.log(currentPlayerPocket)
      // Use the Map directly, it's already deserialized in gameController.js
      const currentPlayerDropTimers = dropTimers[playerColor]
      const now = Date.now()

      // Only the first piece in the pocket can be dropped, and only if its timer is active and not expired
      if (currentPlayerPocket.length > 0) {
        const firstPieceInPocket = currentPlayerPocket[0]
        const timerKey = firstPieceInPocket.id
        let expirationTimestamp = currentPlayerDropTimers.get(timerKey)

        // IMPORTANT: If timer is not in the active map, check if it's paused on the piece itself
        if (!expirationTimestamp && firstPieceInPocket.timerPaused && firstPieceInPocket.remainingTime !== undefined) {
          expirationTimestamp = now + firstPieceInPocket.remainingTime // Calculate effective expiration
        }

        // Check if the first piece is currently droppable
        if (expirationTimestamp && now < expirationTimestamp) {
          const pieceType = firstPieceInPocket.type

          for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
              const square = String.fromCharCode(97 + col) + (row + 1)
              // Standard Crazyhouse drop rules
              if (pieceType.toLowerCase() === "p" && (row === 0 || row === 7)) {
                continue // Pawns cannot be dropped on 1st or 8th rank
              }
              // Check if square is empty
              if (!game.get(square)) {
                // Create a test game to validate the drop doesn't put player in check
                const testGame = new Chess(game.fen())
                try {
                  testGame.put(
                    {
                      type: pieceType,
                      color: playerColor === "white" ? "w" : "b",
                    },
                    square,
                  )

                  // Check if this puts the current player in check (illegal)
                  if (testGame.inCheck() && testGame.turn() === (playerColor === "white" ? "w" : "b")) {
                    continue // Skip this drop as it would leave king in check
                  }

                  // Add valid drop move
                  legalMoves.push({
                    from: "pocket",
                    to: square,
                    piece: pieceType,
                    drop: true,
                    san: `${pieceType.toUpperCase()}@${square}`,
                    color: playerColor === "white" ? "w" : "b",
                    flags: "d", // drop flag
                    pieceId: firstPieceInPocket.id,
                    timeRemaining: expirationTimestamp - now,
                  })
                } catch (error) {
                  // Skip invalid drops
                  console.warn(`Invalid drop test for ${pieceType} on ${square}:`, error.message)
                  continue
                }
              }
            }
          }
        }
      }
    }
    return legalMoves
  } catch (error) {
    console.error("Error in getCrazyhouseLegalMoves:", error)
    return []
  }
}

// Check for game end conditions specific to Crazyhouse
function checkCrazyhouseGameStatus(state, game) {
  try {
    // Standard chess end conditions
    if (game.isCheckmate()) {
      const winner = game.turn() === "w" ? "black" : "white"
      return {
        result: "checkmate",
        winnerColor: winner,
        reason: "Checkmate",
      }
    }
    if (game.isStalemate()) {
      return {
        result: "draw",
        reason: "Stalemate",
      }
    }
    if (game.isInsufficientMaterial()) {
      return {
        result: "draw",
        reason: "Insufficient material",
      }
    }
    // Check for threefold repetition (including pocket state)
    if (isThreefoldRepetition(state)) {
      return {
        result: "draw",
        reason: "Threefold repetition",
      }
    }
    // 50-move rule (but note: in Crazyhouse, captures reset this counter)
    if (game.isDraw()) {
      return {
        result: "draw",
        reason: "50-move rule",
      }
    }
    // Game is ongoing
    return {
      result: "ongoing",
    }
  } catch (error) {
    console.error("Error checking game status:", error)
    return {
      result: "ongoing",
    }
  }
}

// Update repetition map for threefold repetition detection
function updateRepetitionMap(state, game, includePockets = true) {
  try {
    let positionKey = game.fen()

    if (includePockets) {
      // Include pocket state in position key for Crazyhouse
      const pocketString = JSON.stringify({
        white: state.pocketedPieces.white.map((p) => p.type).sort(),
        black: state.pocketedPieces.black.map((p) => p.type).sort(),
      })
      positionKey += `_${pocketString}`
    }

    const currentCount = state.repetitionMap.get(positionKey) || 0
    state.repetitionMap.set(positionKey, currentCount + 1)

    console.log(`Position repetition count: ${currentCount + 1} for key: ${positionKey}`)
  } catch (error) {
    console.error("Error updating repetition map:", error)
  }
}

// Check for threefold repetition
function isThreefoldRepetition(state) {
  try {
    if (!state.repetitionMap || state.repetitionMap.size === 0) {
      return false
    }

    for (const [position, count] of state.repetitionMap.entries()) {
      if (count >= 3) {
        console.log(`Threefold repetition detected for position: ${position}`)
        return true
      }
    }
    return false
  } catch (error) {
    console.error("Error checking threefold repetition:", error)
    return false
  }
}

// Get available pieces for dropping (only the first piece in queue if timer is active)
export function getAvailableDropPieces(state, playerColor, currentTimestamp) {
  try {
    if (!currentTimestamp) {
      currentTimestamp = Date.now()
    }
    if (!state.pocketedPieces || !state.pocketedPieces[playerColor]) {
      return []
    }

    const pocket = state.pocketedPieces[playerColor]
    const timers = state.dropTimers[playerColor]

    if (pocket.length === 0) {
      return []
    }

    // Only first piece can be dropped in sequential system
    const firstPiece = pocket[0]
    const timerKey = firstPiece.id
    let expirationTimestamp = timers.get(timerKey)

    // IMPORTANT: If timer is not in the active map, check if it's paused on the piece itself
    if (!expirationTimestamp && firstPiece.timerPaused && firstPiece.remainingTime !== undefined) {
      expirationTimestamp = currentTimestamp + firstPiece.remainingTime // Calculate effective expiration
    }

    // Check if piece has active, non-expired timer
    if (expirationTimestamp && currentTimestamp < expirationTimestamp) {
      return [
        {
          ...firstPiece,
          timeRemaining: expirationTimestamp - currentTimestamp,
          canDrop: true,
        },
      ]
    }

    return [] // No pieces available for drop
  } catch (error) {
    console.error("Error getting available drop pieces:", error)
    return []
  }
}

// Get all pieces in pocket with their drop status
export function getPocketStatus(state, playerColor, currentTimestamp) {
  try {
    if (!currentTimestamp) {
      currentTimestamp = Date.now()
    }
    if (!state.pocketedPieces || !state.pocketedPieces[playerColor]) {
      return {
        pieces: [],
        droppable: [],
        frozen: [],
      }
    }

    const pocket = state.pocketedPieces[playerColor]
    const timers = state.dropTimers[playerColor]

    if (pocket.length === 0) {
      return {
        pieces: [],
        droppable: [],
        frozen: [],
      }
    }

    const pieces = pocket.map((piece, index) => {
      const timerKey = piece.id
      let expirationTimestamp = timers.get(timerKey)

      // IMPORTANT: If timer is not in the active map, check if it's paused on the piece itself
      if (!expirationTimestamp && piece.timerPaused && piece.remainingTime !== undefined) {
        expirationTimestamp = currentTimestamp + piece.remainingTime // Calculate effective expiration
      }

      const timeRemaining = expirationTimestamp ? Math.max(0, expirationTimestamp - currentTimestamp) : 0

      return {
        ...piece,
        index,
        hasTimer: !!expirationTimestamp,
        timeRemaining,
        expired: expirationTimestamp ? currentTimestamp >= expirationTimestamp : false,
        canDrop: index === 0 && expirationTimestamp && currentTimestamp < expirationTimestamp,
      }
    })

    const droppable = pieces.filter((p) => p.canDrop)
    const frozen = pieces.filter((p) => !p.canDrop)

    return {
      pieces,
      droppable,
      frozen,
    }
  } catch (error) {
    console.error("Error getting pocket status:", error)
    return {
      pieces: [],
      droppable: [],
      frozen: [],
    }
  }
}

// Force expire pieces that have exceeded their drop time limit
export function expireDropPieces(state, currentTimestamp) {
  try {
    if (!currentTimestamp) {
      currentTimestamp = Date.now()
    }
    let expiredCount = 0
    for (const color of ["white", "black"]) {
      const pocket = state.pocketedPieces[color]
      const timers = state.dropTimers[color]

      if (pocket.length === 0) continue

      // Find and remove all expired pieces
      const expiredIndices = []

      for (let i = 0; i < pocket.length; i++) {
        const piece = pocket[i]
        let expirationTimestamp = timers.get(piece.id)

        // IMPORTANT: If timer is not in the active map, check if it's paused on the piece itself
        if (!expirationTimestamp && piece.timerPaused && piece.remainingTime !== undefined) {
          expirationTimestamp = currentTimestamp + piece.remainingTime // Calculate effective expiration
        }

        if (expirationTimestamp && currentTimestamp >= expirationTimestamp) {
          expiredIndices.push(i)
        }
      }

      // Remove expired pieces (in reverse order to maintain indices)
      for (let j = expiredIndices.length - 1; j >= 0; j--) {
        const index = expiredIndices[j]
        const piece = pocket[index]
        pocket.splice(index, 1)
        timers.delete(piece.id)
        delete piece.timerPaused // Clean up paused flag
        delete piece.remainingTime // Clean up remaining time
        expiredCount++
        console.log(`Force expired ${piece.type} from ${color}'s pocket`)
      }

      // Start timer for new first piece if pocket is not empty
      if (pocket.length > 0) {
        const firstPiece = pocket[0]
        if (!timers.has(firstPiece.id)) {
          timers.set(firstPiece.id, currentTimestamp + DROP_TIME_LIMIT)
          console.log(`Started timer for new first piece ${firstPiece.type} in ${color}'s pocket`)
        }
      }
    }
    return expiredCount
  } catch (error) {
    console.error("Error expiring drop pieces:", error)
    return 0
  }
}

// Serialize state for storage (convert Maps to objects)
export function serializeCrazyhouseState(state) {
  try {
    return {
      ...state,
      dropTimers: {
        white: Object.fromEntries(state.dropTimers.white),
        black: Object.fromEntries(state.dropTimers.black),
      },
      repetitionMap: Object.fromEntries(state.repetitionMap),
    }
  } catch (error) {
    console.error("Error serializing state:", error)
    return state
  }
}

// Deserialize state from storage (convert objects back to Maps)
export function deserializeCrazyhouseState(serializedState) {
  try {
    return {
      ...serializedState,
      dropTimers: {
        white: new Map(Object.entries(serializedState.dropTimers?.white || {})),
        black: new Map(Object.entries(serializedState.dropTimers?.black || {})),
      },
      repetitionMap: new Map(Object.entries(serializedState.repetitionMap || {})),
    }
  } catch (error) {
    console.error("Error deserializing state:", error)
    return serializedState
  }
}

// Pause the drop timer for the current piece in the pocket (if any)
export function pauseDropTimer(state, color, currentTimestamp) {
  const pocket = state.pocketedPieces[color]
  const timers = state.dropTimers[color]
  if (pocket.length === 0) return
  const firstPiece = pocket[0]
  const timerKey = firstPiece.id
  const expirationTimestamp = timers.get(timerKey)
  if (expirationTimestamp) {
    // Store remaining time on the piece
    firstPiece.remainingTime = Math.max(0, expirationTimestamp - currentTimestamp)
    timers.delete(timerKey)
    firstPiece.timerPaused = true
  }
}

export function resumeDropTimer(state, color, currentTimestamp) {
  const pocket = state.pocketedPieces[color]
  const timers = state.dropTimers[color]
  if (pocket.length === 0) return
  const firstPiece = pocket[0]
  const timerKey = firstPiece.id
  if (firstPiece.timerPaused && firstPiece.remainingTime > 0) {
    timers.set(timerKey, currentTimestamp + firstPiece.remainingTime)
    delete firstPiece.timerPaused
    delete firstPiece.remainingTime
  }
}
