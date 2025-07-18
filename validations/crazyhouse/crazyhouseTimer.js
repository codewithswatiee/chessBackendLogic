import { Chess } from "chess.js"
import { updateRepetitionMap } from "./crazyhouseStandard.js"

// Create initial state for Crazyhouse with Timer (3+2 time control)
export function createInitialCrazyhouseWithTimerState() {
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

      // Crazyhouse with Timer specific state
      pocketPanel: {
        white: [], // Pieces white can drop (captured black pieces)
        black: [], // Pieces black can drop (captured white pieces)
      },
      pocketTimers: {
        white: [], // Timer info for each piece in white's pocket
        black: [], // Timer info for each piece in black's pocket
      },
      capturedPieces: {
        white: [], // Pieces captured by white (black pieces)
        black: [], // Pieces captured by black (white pieces)
      },
      pocketTimeLimit: 10000, // 10 seconds for each piece in pocket

      gameEnded: false,
      endReason: null,
      winner: null,
      endTimestamp: null,
      gameVariant: "crazyhouse-with-timer",
    }
  } catch (error) {
    console.error("Error creating initial Crazyhouse with Timer state:", error)
    throw error
  }
}

// Update pocket timers and remove expired pieces
export function updatePocketTimers(state, currentTimestamp) {
  try {
    if (!state.pocketTimers || !state.pocketPanel) {
      return state
    }

    const expiredPieces = { white: [], black: [] }

    // Check white's pocket
    for (let i = state.pocketTimers.white.length - 1; i >= 0; i--) {
      const timer = state.pocketTimers.white[i]
      const elapsed = currentTimestamp - timer.capturedAt

      if (elapsed >= state.pocketTimeLimit) {
        // Remove expired piece
        expiredPieces.white.push(timer.piece)
        state.pocketTimers.white.splice(i, 1)

        // Find and remove from pocket panel
        const pocketIndex = state.pocketPanel.white.indexOf(timer.piece)
        if (pocketIndex > -1) {
          state.pocketPanel.white.splice(pocketIndex, 1)
        }

        console.log(`White's ${timer.piece} expired after ${elapsed}ms`)
      }
    }

    // Check black's pocket
    for (let i = state.pocketTimers.black.length - 1; i >= 0; i--) {
      const timer = state.pocketTimers.black[i]
      const elapsed = currentTimestamp - timer.capturedAt

      if (elapsed >= state.pocketTimeLimit) {
        // Remove expired piece
        expiredPieces.black.push(timer.piece)
        state.pocketTimers.black.splice(i, 1)

        // Find and remove from pocket panel
        const pocketIndex = state.pocketPanel.black.indexOf(timer.piece)
        if (pocketIndex > -1) {
          state.pocketPanel.black.splice(pocketIndex, 1)
        }

        console.log(`Black's ${timer.piece} expired after ${elapsed}ms`)
      }
    }

    return { ...state, expiredPieces }
  } catch (error) {
    console.error("Error updating pocket timers:", error)
    return state
  }
}

// Validate piece drop for Crazyhouse with Timer
export function validatePieceDropWithTimer(state, drop, playerColor, currentTimestamp) {
  try {
    console.log("=== PIECE DROP WITH TIMER VALIDATION START ===")
    console.log("Drop:", drop, "Player:", playerColor)

    if (!drop || !drop.piece || !drop.square) {
      return { valid: false, reason: "Invalid drop format", code: "INVALID_DROP_FORMAT" }
    }

    const { piece, square } = drop

    // Update pocket timers first to remove expired pieces
    const updatedState = updatePocketTimers(state, currentTimestamp)
    Object.assign(state, updatedState)

    // Check if player has this piece in pocket (after timer updates)
    if (!state.pocketPanel[playerColor].includes(piece)) {
      return { valid: false, reason: "Piece not available in pocket or has expired", code: "PIECE_NOT_IN_POCKET" }
    }

    // Find the specific piece timer to validate it hasn't expired
    const pieceTimer = state.pocketTimers[playerColor].find((timer) => timer.piece === piece)
    if (!pieceTimer) {
      return { valid: false, reason: "Piece timer not found", code: "PIECE_TIMER_NOT_FOUND" }
    }

    const elapsed = currentTimestamp - pieceTimer.capturedAt
    if (elapsed >= state.pocketTimeLimit) {
      return { valid: false, reason: "Piece has expired", code: "PIECE_EXPIRED" }
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

    return { valid: true, code: "VALID_DROP", remainingTime: state.pocketTimeLimit - elapsed }
  } catch (error) {
    console.error("Error validating piece drop with timer:", error)
    return { valid: false, reason: "Internal error during drop validation", code: "INTERNAL_ERROR" }
  }
}

// Apply piece drop to game state (with timer)
export function applyPieceDropWithTimer(state, drop, playerColor, currentTimestamp) {
  try {
    console.log("=== APPLYING PIECE DROP WITH TIMER ===")

    // Validate the drop first
    const validation = validatePieceDropWithTimer(state, drop, playerColor, currentTimestamp)
    if (!validation.valid) {
      return validation
    }

    const { piece, square } = drop

    // Remove piece from pocket
    const pocketIndex = state.pocketPanel[playerColor].indexOf(piece)
    if (pocketIndex > -1) {
      state.pocketPanel[playerColor].splice(pocketIndex, 1)
    }

    // Remove corresponding timer
    const timerIndex = state.pocketTimers[playerColor].findIndex((timer) => timer.piece === piece)
    if (timerIndex > -1) {
      state.pocketTimers[playerColor].splice(timerIndex, 1)
    }

    // Update FEN to include the dropped piece
    const game = new Chess(state.fen)

    // Track the drop in move history
    const dropMove = {
      from: "@", // Special notation for drops
      to: square,
      piece: piece,
      drop: true,
      san: `${piece.toUpperCase()}@${square}`,
      color: playerColor === "white" ? "w" : "b",
      remainingTime: validation.remainingTime,
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

    console.log("Piece drop with timer applied successfully")

    return {
      valid: true,
      drop: dropMove,
      state,
      code: "DROP_SUCCESS",
    }
  } catch (error) {
    console.error("Error applying piece drop with timer:", error)
    return { valid: false, reason: "Internal error during drop application", code: "INTERNAL_ERROR" }
  }
}

// Enhanced move validation for Crazyhouse with Timer
export function validateAndApplyCrazyhouseWithTimerMove(state, move, playerColor, currentTimestamp) {
  try {
    console.log("=== CRAZYHOUSE WITH TIMER MOVE VALIDATION START ===")
    console.log("Move:", move, "Player:", playerColor)

    // Update pocket timers first
    const updatedState = updatePocketTimers(state, currentTimestamp)
    Object.assign(state, updatedState)

    // Handle piece drops
    if (move.drop) {
      return applyPieceDropWithTimer(state, move, playerColor, currentTimestamp)
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
    if (typeof state.pocketTimeLimit !== "number") state.pocketTimeLimit = 10000
    if (!state.moveHistory) state.moveHistory = []
    if (!state.repetitionMap) state.repetitionMap = new Map()
    if (typeof state.gameStarted !== "boolean") state.gameStarted = false
    if (!state.firstMoveTimestamp) state.firstMoveTimestamp = null
    if (!state.pocketPanel) state.pocketPanel = { white: [], black: [] }
    if (!state.pocketTimers) state.pocketTimers = { white: [], black: [] }
    if (!state.capturedPieces) state.capturedPieces = { white: [], black: [] }
    if (typeof state.gameEnded !== "boolean") state.gameEnded = false

    // Check for time-based game ending
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

    // Handle captured pieces in Crazyhouse with Timer
    if (capturedPiece) {
      const capturingPlayer = currentPlayerBeforeMove === "w" ? "white" : "black"
      state.capturedPieces[capturingPlayer].push(capturedPiece.type)

      // Add captured piece to pocket with timer
      const pocketPiece = capturedPiece.type
      if (pocketPiece === "q" || pocketPiece === "r" || pocketPiece === "b" || pocketPiece === "n") {
        // In Crazyhouse, promoted pieces revert to pawns when captured
        // This is a simplification
      }

      state.pocketPanel[capturingPlayer].push(pocketPiece)

      // Add timer for the captured piece
      state.pocketTimers[capturingPlayer].push({
        piece: pocketPiece,
        capturedAt: currentTimestamp,
        expiresAt: currentTimestamp + state.pocketTimeLimit,
      })

      console.log(
        `${capturingPlayer} captured ${capturedPiece.type}, added to pocket with ${state.pocketTimeLimit}ms timer`,
      )
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
    const resultStatus = checkCrazyhouseWithTimerGameStatus(state, game)

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
      pocketTimers: state.pocketTimers,
      expiredPieces: updatedState.expiredPieces,
    }

    console.log("=== CRAZYHOUSE WITH TIMER MOVE VALIDATION END ===")

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
      expiredPieces: updatedState.expiredPieces,
      ...resultStatus,
    }
  } catch (error) {
    console.error("Error in validateAndApplyCrazyhouseWithTimerMove:", error)
    return {
      valid: false,
      reason: "Internal error during move validation",
      error: error.message,
      code: "INTERNAL_ERROR",
      stack: error.stack,
    }
  }
}

// Get current timers for Crazyhouse with Timer
export function getCurrentCrazyhouseWithTimerTimers(state, currentTimestamp) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[TIMER] Invalid state provided to getCurrentCrazyhouseWithTimerTimers")
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

    // Update pocket timers
    const updatedState = updatePocketTimers(state, currentTimestamp)
    Object.assign(state, updatedState)

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
        pocketTimers: state.pocketTimers,
        expiredPieces: updatedState.expiredPieces,
      }
    }

    if (!state.gameStarted || !state.turnStartTimestamp || state.moveHistory.length === 0) {
      return {
        white: state.whiteTime || 180000,
        black: state.blackTime || 180000,
        activeColor: state.activeColor || "white",
        gameEnded: false,
        pocketPanel: state.pocketPanel || { white: [], black: [] },
        pocketTimers: state.pocketTimers || { white: [], black: [] },
        expiredPieces: updatedState.expiredPieces,
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
        pocketTimers: state.pocketTimers || { white: [], black: [] },
        expiredPieces: updatedState.expiredPieces,
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
        pocketTimers: state.pocketTimers,
        expiredPieces: updatedState.expiredPieces,
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
        pocketTimers: state.pocketTimers,
        expiredPieces: updatedState.expiredPieces,
      }
    }

    return {
      white: whiteTime,
      black: blackTime,
      activeColor: currentPlayerColor,
      gameEnded: false,
      pocketPanel: state.pocketPanel || { white: [], black: [] },
      pocketTimers: state.pocketTimers || { white: [], black: [] },
      expiredPieces: updatedState.expiredPieces,
    }
  } catch (error) {
    console.error("Error in getCurrentCrazyhouseWithTimerTimers:", error)
    return {
      white: state?.whiteTime || 180000,
      black: state?.blackTime || 180000,
      activeColor: state?.activeColor || "white",
      gameEnded: false,
      error: error.message,
      pocketPanel: state?.pocketPanel || { white: [], black: [] },
      pocketTimers: state?.pocketTimers || { white: [], black: [] },
      expiredPieces: { white: [], black: [] },
    }
  }
}

// Check game status for Crazyhouse with Timer
export function checkCrazyhouseWithTimerGameStatus(state, gameInstance) {
  try {
    if (!state || typeof state !== "object") {
      console.error("[STATUS] Invalid state provided to checkCrazyhouseWithTimerGameStatus")
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
    console.error("Error checking Crazyhouse with Timer game status:", error)
    return { result: "ongoing", error: error.message, winnerColor: null }
  }
}

// Get legal moves including possible drops (with timer info)
export function getCrazyhouseWithTimerLegalMoves(state, currentTimestamp) {
  console.log("=== GETTING CRAZYHOUSE WITH TIMER LEGAL MOVES ===")
  try {
    if (!state || !state.fen) {
      console.error("[MOVES] Invalid state provided to getCrazyhouseWithTimerLegalMoves")
      return { moves: [], drops: [] }
    }

    // Update pocket timers first
    const updatedState = updatePocketTimers(state, currentTimestamp)
    Object.assign(state, updatedState)

    const game = new Chess(state.fen)
    const regularMoves = game.moves({ verbose: true })

    // Get possible drops (only non-expired pieces)
    const currentPlayer = game.turn() === "w" ? "white" : "black"
    const availablePieces = state.pocketPanel?.[currentPlayer] || []
    const availableTimers = state.pocketTimers?.[currentPlayer] || []
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

              // Find timer info for this piece
              const pieceTimer = availableTimers.find((timer) => timer.piece === availablePiece)
              const remainingTime = pieceTimer
                ? Math.max(0, state.pocketTimeLimit - (currentTimestamp - pieceTimer.capturedAt))
                : 0

              drops.push({
                piece: availablePiece,
                square: square,
                drop: true,
                san: `${availablePiece.toUpperCase()}@${square}`,
                remainingTime: remainingTime,
                expiresAt: pieceTimer ? pieceTimer.expiresAt : currentTimestamp,
              })
            }
          }
        }
      }
    }

    return {
      moves: regularMoves,
      drops: drops,
      expiredPieces: updatedState.expiredPieces,
    }
  } catch (error) {
    console.error("Error getting Crazyhouse with Timer legal moves:", error)
    return { moves: [], drops: [], expiredPieces: { white: [], black: [] } }
  }
}

// Get pocket panel info with timers
export function getPocketPanelWithTimers(state, currentTimestamp) {
  try {
    if (!state) {
      return {
        white: [],
        black: [],
        timers: { white: [], black: [] },
        expiredPieces: { white: [], black: [] },
      }
    }

    // Update pocket timers
    const updatedState = updatePocketTimers(state, currentTimestamp)
    Object.assign(state, updatedState)

    // Calculate remaining times for each piece
    const pocketInfo = {
      white: [],
      black: [],
      timers: { white: [], black: [] },
      expiredPieces: updatedState.expiredPieces || { white: [], black: [] },
    }

    // Process white's pocket
    if (state.pocketPanel?.white) {
      state.pocketPanel.white.forEach((piece, index) => {
        const timer = state.pocketTimers?.white?.find((t) => t.piece === piece)
        const remainingTime = timer ? Math.max(0, state.pocketTimeLimit - (currentTimestamp - timer.capturedAt)) : 0

        pocketInfo.white.push(piece)
        pocketInfo.timers.white.push({
          piece,
          remainingTime,
          expiresAt: timer ? timer.expiresAt : currentTimestamp,
          capturedAt: timer ? timer.capturedAt : currentTimestamp,
        })
      })
    }

    // Process black's pocket
    if (state.pocketPanel?.black) {
      state.pocketPanel.black.forEach((piece, index) => {
        const timer = state.pocketTimers?.black?.find((t) => t.piece === piece)
        const remainingTime = timer ? Math.max(0, state.pocketTimeLimit - (currentTimestamp - timer.capturedAt)) : 0

        pocketInfo.black.push(piece)
        pocketInfo.timers.black.push({
          piece,
          remainingTime,
          expiresAt: timer ? timer.expiresAt : currentTimestamp,
          capturedAt: timer ? timer.capturedAt : currentTimestamp,
        })
      })
    }

    return pocketInfo
  } catch (error) {
    console.error("Error getting pocket panel with timers:", error)
    return {
      white: [],
      black: [],
      timers: { white: [], black: [] },
      expiredPieces: { white: [], black: [] },
      error: error.message,
    }
  }
}
