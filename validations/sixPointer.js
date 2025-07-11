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

// 6PT Chess: Point values for pieces
const PIECE_VALUES = {
  p: 1, // pawn
  n: 3, // knight
  b: 3, // bishop
  r: 5, // rook
  q: 9, // queen
  k: 0, // king (not capturable in normal play)
}

// 6PT Chess: Generate a balanced random mid-game position
export function generateRandomBalancedPosition() {
  // In 6PT Chess, the game starts from a legal, balanced mid-game position.
  // These positions are pre-selected to ensure no clear material or positional advantage.
  // The function randomly selects one from the list.
  const balancedPositions = [
    "r2q1rk1/pp3pbp/4b1p1/3pPp2/3P1P2/2N1nN1Q/PP4PP/R4RK1 w - - 0 16",
    "rnbq1rk1/pp2ppbp/3p1np1/8/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQ - 0 7",
    "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 4 5",
    "rnbqk2r/pp2bppp/4pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 2 6",
    "r2qkbnr/ppp2ppp/2np4/4p3/2B1P1b1/3P1N2/PPP2PPP/RNBQK2R w KQkq - 2 6",
    // Add more balanced, legal mid-game FENs as needed
  ]
  // Randomly select one
  const randomIndex = Math.floor(Math.random() * balancedPositions.length)
  return balancedPositions[randomIndex]
}

// 6PT Chess: Calculate current points for both players
function calculatePoints(capturedPieces) {
  const whitePoints = capturedPieces.white.reduce((sum, piece) => sum + (PIECE_VALUES[piece] || 0), 0)
  const blackPoints = capturedPieces.black.reduce((sum, piece) => sum + (PIECE_VALUES[piece] || 0), 0)
  return { white: whitePoints, black: blackPoints }
}

// Create initial state for 6PT Chess
export function createInitialState() {
  try {
    // Generate random balanced starting position
    const randomFen = generateRandomBalancedPosition()
    const game = new Chess(randomFen)
    const fen = game.fen()
    console.log("Generated random FEN for 6PT Chess:", fen)
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
      whiteTime: 30000, // 30 seconds per move
      blackTime: 30000, // 30 seconds per move
      turnStartTimestamp: now,
      lastMoveTimestamp: now,
      moveHistory: [],
      gameStarted: false,
      firstMoveTimestamp: null,
      capturedPieces: {
        white: [],
        black: [],
      },
      // 6PT Chess specific fields
      movesPlayed: {
        white: 0,
        black: 0,
      },
      maxMoves: 6,
      points: {
        white: 0,
        black: 0,
      },
      gameEnded: false,
      endReason: null,
      winner: null,
      endTimestamp: null,
      variant: "6pt",
    }
  } catch (error) {
    console.error("Error creating 6PT Chess initial state:", error)
    throw error
  }
}

// 6PT Chess: Check for foul play on final move
function checkFoulPlay(state, game, move, playerColor) {
  // Get move counts
  const whiteMovesPlayed = state.movesPlayed?.white || 0
  const blackMovesPlayed = state.movesPlayed?.black || 0

  // Check if this is the player's final (6th) move
  const isPlayersFinalMove =
    (playerColor === "white" && whiteMovesPlayed >= 5) || (playerColor === "black" && blackMovesPlayed >= 5)

  if (!isPlayersFinalMove) return false

  // Check if the move captures a piece
  const targetSquare = move.to
  const capturedPiece = game.get(targetSquare)

  if (!capturedPiece) return false

  // Check if opponent has moves left and can recapture
  const opponentColor = playerColor === "white" ? "black" : "white"
  const opponentMovesLeft = opponentColor === "white" ? 6 - whiteMovesPlayed : 6 - blackMovesPlayed

  if (opponentMovesLeft <= 0) {
    // Opponent has no moves left to recapture - this is foul play
    console.log(`FOUL PLAY DETECTED: ${playerColor} captured on final move with no opponent moves left`)
    return true
  }

  return false
}


export function resetSixPointerTimer(gameState) {
    // The activeColor is the player who just moved, so switch to the next player
    const nextColor = gameState.board.activeColor === 'white' ? 'black' : 'white';
    gameState.timers[nextColor].remaining = gameState.timeControl.perMove;
    gameState.timers[nextColor].lastUpdateTime = Date.now();

    console.log(`Resetting timer for ${nextColor}. New time: ${gameState.timers[nextColor].remaining}ms`);
}


// Validate a move and update timers properly for 6PT Chess
export function validateAndApplyMove(state, move, playerColor, currentTimestamp) {
  try {
    console.log("=== 6PT CHESS MOVE VALIDATION START ===")
    console.log("Move:", move, "Player:", playerColor)
    console.log("Moves played:", state.movesPlayed)
    console.log("Current points:", state.points)

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

    // Initialize 6PT Chess specific fields if missing
    if (!state.movesPlayed) state.movesPlayed = { white: 0, black: 0 }
    if (!state.points) state.points = { white: 0, black: 0 }
    if (!state.maxMoves) state.maxMoves = 6
    if (!state.variant) state.variant = "6pt"

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

    // 6PT Chess: Check if player has exceeded move limit
    const playerMovesPlayed = state.movesPlayed[playerColor] || 0
    if (playerMovesPlayed >= state.maxMoves) {
      return {
        valid: false,
        reason: `${playerColor} has already played ${state.maxMoves} moves`,
        code: "MOVE_LIMIT_EXCEEDED",
      }
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

    // 6PT Chess: Check for foul play before making the move
    if (checkFoulPlay(state, game, move, playerColor)) {
      return {
        valid: false,
        reason: "Foul play: Cannot capture on final move when opponent has no moves left",
        code: "FOUL_PLAY",
      }
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

    if (!result) return { valid: false, reason: "Illegal move", code: "ILLEGAL_MOVE" }

    // Track captured pieces and update points
    if (capturedPiece) {
      const capturingPlayer = currentPlayerBeforeMove === "w" ? "white" : "black"
      state.capturedPieces[capturingPlayer].push(capturedPiece.type)

      // Add points for the captured piece
      const pieceValue = PIECE_VALUES[capturedPiece.type] || 0
      state.points[capturingPlayer] += pieceValue

      console.log(`${capturingPlayer} captured ${capturedPiece.type} for ${pieceValue} points`)
      console.log("Updated points:", state.points)
    }

    // Update move count for the player who just moved
    state.movesPlayed[playerColor]++
    console.log("Updated moves played:", state.movesPlayed)

    // Update state after successful move
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

    // Check game status (including 6PT specific end conditions)
    const resultStatus = check6PTGameStatus(state, game)
    console.log("6PT Game status after move:", resultStatus)

    // Check if the game has ended
    if (resultStatus.result !== "ongoing") {
      state.gameEnded = true
      state.endReason = resultStatus.result
      state.winnerColor = resultStatus.winnerColor || null
      state.endTimestamp = currentTimestamp

      console.log(`6PT GAME ENDED: ${resultStatus.result}`)
      resultStatus.shouldNavigateToMenu = true
      resultStatus.endTimestamp = currentTimestamp
      resultStatus.winnerColor = state.winnerColor
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
      // 6PT Chess specific info
      movesPlayed: state.movesPlayed,
      maxMoves: state.maxMoves,
      points: state.points,
      variant: state.variant,
    }

    console.log("=== 6PT CHESS MOVE VALIDATION END ===")
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
    console.error("Error in 6PT Chess validateAndApplyMove:", error)
    return {
      valid: false,
      reason: "Internal error during move validation",
      error: error.message,
      code: "INTERNAL_ERROR",
      stack: error.stack,
    }
  }
}

// Get current timer values (same as original but with 6PT awareness)
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
        // 6PT Chess specific
        movesPlayed: state.movesPlayed,
        points: state.points,
        variant: state.variant,
      }
    }

    if (!state.gameStarted || !state.turnStartTimestamp || state.moveHistory.length === 0) {
      return {
        white: state.whiteTime || 600000,
        black: state.blackTime || 600000,
        activeColor: state.activeColor || "white",
        gameEnded: false,
        movesPlayed: state.movesPlayed || { white: 0, black: 0 },
        points: state.points || { white: 0, black: 0 },
        variant: state.variant || "6pt",
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

    const currentPlayer = game.turn()
    const currentPlayerColor = currentPlayer === "w" ? "white" : "black"
    const elapsed = currentTimestamp - state.turnStartTimestamp

    let whiteTime = state.whiteTime || 600000
    let blackTime = state.blackTime || 600000

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
        movesPlayed: state.movesPlayed,
        points: state.points,
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
        movesPlayed: state.movesPlayed,
        points: state.points,
        variant: state.variant,
      }
    }

    return {
      white: whiteTime,
      black: blackTime,
      activeColor: currentPlayerColor,
      gameEnded: false,
      movesPlayed: state.movesPlayed || { white: 0, black: 0 },
      points: state.points || { white: 0, black: 0 },
      variant: state.variant || "6pt",
    }
  } catch (error) {
    console.error("Error in getCurrentTimers:", error)
    return {
      white: state?.whiteTime || 600000,
      black: state?.blackTime || 600000,
      activeColor: state?.activeColor || "white",
      gameEnded: false,
      error: error.message,
      movesPlayed: state?.movesPlayed || { white: 0, black: 0 },
      points: state?.points || { white: 0, black: 0 },
      variant: state?.variant || "6pt",
    }
  }
}

// Generate all possible legal moves (same as original)
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

// 6PT Chess specific game status checker
export function check6PTGameStatus(state, gameInstance) {
  try {
    // Validate input
    if (!state || typeof state !== "object") {
      console.error("[6PT STATUS] Invalid state provided to check6PTGameStatus")
      return { result: "ongoing", error: "Invalid state" }
    }

    // Always reconstruct game from FEN if not provided
    let game = gameInstance
    if (!game) {
      if (!state.fen) {
        console.error("[6PT STATUS] Missing FEN in game state")
        return { result: "ongoing", error: "Missing FEN" }
      }
      try {
        game = new Chess(state.fen)
      } catch (error) {
        console.error("[6PT STATUS] Error reconstructing game from FEN:", error)
        return { result: "ongoing", error: "Invalid FEN" }
      }
    }

    // Initialize 6PT fields if missing
    if (!state.movesPlayed) state.movesPlayed = { white: 0, black: 0 }
    if (!state.points) state.points = { white: 0, black: 0 }
    if (!state.maxMoves) state.maxMoves = 6

    // Check for time-based wins first
    if (state.whiteTime <= 0) return { result: "timeout", winnerColor: "black", reason: "white ran out of time" }
    if (state.blackTime <= 0) return { result: "timeout", winnerColor: "white", reason: "black ran out of time" }

    // Check for checkmate - this automatically ends the game
    if (game.isCheckmate()) {
      const winnerColor = game.turn() === "w" ? "black" : "white"
      console.log(`6PT CHECKMATE DETECTED: ${winnerColor} wins!`)
      return { result: "checkmate", winnerColor: winnerColor }
    }

    // 6PT Chess: Check if both players have completed their 6 moves
    const whiteMovesCompleted = state.movesPlayed.white >= state.maxMoves
    const blackMovesCompleted = state.movesPlayed.black >= state.maxMoves

    if (whiteMovesCompleted && blackMovesCompleted) {
      // Both players completed 6 moves - count points
      const finalPoints = calculatePoints(state.capturedPieces)
      console.log("6PT: Both players completed 6 moves. Final points:", finalPoints)

      if (finalPoints.white > finalPoints.black) {
        return { result: "points", winnerColor: "white", reason: "white won by points", finalPoints }
      } else if (finalPoints.black > finalPoints.white) {
        return { result: "points", winnerColor: "black", reason: "black won by points", finalPoints }
      } else {
        return { result: "draw", reason: "equal points", winnerColor: null, finalPoints }
      }
    }

    // Check for other draw conditions (but only if game hasn't reached move limit)
    if (game.isStalemate()) return { result: "draw", reason: "stalemate", winnerColor: null }
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
    console.error("Error checking 6PT game status:", error)
    return { result: "ongoing", error: error.message, winnerColor: null }
  }
}

// Standard game status checker (for compatibility)
export function checkGameStatus(state, gameInstance) {
  // For 6PT Chess, use the specialized checker
  if (state?.variant === "6pt") {
    return check6PTGameStatus(state, gameInstance)
  }

  // Original implementation for standard chess
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
      console.log(`CHECKMATE DETECTED: ${winnerColor} wins!`)
      return { result: "checkmate", winnerColor: winnerColor }
    }

    if (game.isStalemate()) return { result: "draw", reason: "stalemate", winnerColor: null }
    if (game.isInsufficientMaterial()) return { result: "draw", reason: "insufficient material", winnerColor: null }
    if (game.isThreefoldRepetition()) return { result: "draw", reason: "threefold repetition", winnerColor: null }
    if (game.isDraw()) return { result: "draw", reason: "50-move rule", winnerColor: null }

    if (!(state.repetitionMap instanceof Map)) {
      state.repetitionMap = new Map(Object.entries(state.repetitionMap || {}))
    }
    const repetitionCount = state.repetitionMap.get(game.fen()) || 0
    if (repetitionCount >= 5) return { result: "draw", reason: "fivefold repetition", winnerColor: null }
    if (state.moveHistory && state.moveHistory.length >= 150)
      return { result: "draw", reason: "75-move rule", winnerColor: null }

    return { result: "ongoing", winnerColor: null }
  } catch (error) {
    console.error("Error checking game status:", error)
    return { result: "ongoing", error: error.message, winnerColor: null }
  }
}

// Helper: track FEN repetitions (same as original)
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
