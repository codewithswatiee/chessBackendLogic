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

import { Chess } from "chess.js"

// Create initial state for a 10-minute game
export function createInitialState() {
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
  }
}

// Validate a move and update timers properly
export function validateAndApplyMove(state, move, playerColor, currentTimestamp) {
  console.log("=== MOVE VALIDATION START ===")
  console.log("Move:", move, "Player:", playerColor)
  console.log("Game started:", state.gameStarted, "First move timestamp:", state.firstMoveTimestamp)
  console.log("Current state - White time:", state.whiteTime, "Black time:", state.blackTime)
  console.log("Turn start timestamp:", state.turnStartTimestamp)

  // Always reconstruct game from FEN to avoid corrupted Chess.js instances after deserialization
  let game
  if (state.fen) {
    game = new Chess(state.fen)
    state.game = game
  } else {
    throw new Error("Invalid state: missing game and fen")
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

  // IMPORTANT: Get the current player BEFORE making the move
  // This is the player who is making the move and whose time should be deducted
  const currentPlayerBeforeMove = game.turn() // 'w' or 'b'
  const currentPlayerColor = currentPlayerBeforeMove === "w" ? "white" : "black"

  console.log("Current player before move:", currentPlayerBeforeMove, "Color:", currentPlayerColor)
  console.log("Player making move:", playerColor)

  // Verify that the player making the move matches the current turn
  if (currentPlayerColor !== playerColor) {
    return { valid: false, reason: "Not your turn" }
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
        return { valid: false, reason: "Time out", result: "black wins", winner: "black" }
      }
    } else {
      const newBlackTime = Math.max(0, state.blackTime - elapsed)
      console.log("BLACK MOVE: Deducting", elapsed, "ms from black time")
      console.log("Black time:", state.blackTime, "->", newBlackTime)
      state.blackTime = newBlackTime
      if (state.blackTime <= 0) {
        return { valid: false, reason: "Time out", result: "white wins", winner: "white" }
      }
    }

    console.log("Times after deduction - White:", state.whiteTime, "Black:", state.blackTime)
  }

  // Check if this move captures a piece
  const targetSquare = move.to
  const capturedPiece = game.get(targetSquare)

  // Validate and apply the move
  const result = game.move(move)
  console.log("Move result:", result)
  if (!result) return { valid: false, reason: "Illegal move" }

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
      black: game.castling && game.castling["b"] && game.castling["b"].k,
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
  }

  console.log("=== MOVE VALIDATION END ===")

  return {
    valid: true,
    move: result,
    state,
    ...resultStatus,
  }
}

// Get current timer values (useful for periodic updates)
export function getCurrentTimers(state, currentTimestamp) {
  if (!state.gameStarted || !state.turnStartTimestamp || state.moveHistory.length === 0) {
    return {
      white: state.whiteTime || 600000,
      black: state.blackTime || 600000,
      activeColor: state.activeColor || "white",
    }
  }

  // Reconstruct game to check whose turn it is
  const game = new Chess(state.fen)
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

  return {
    white: whiteTime,
    black: blackTime,
    activeColor: currentPlayerColor,
  }
}

// Generate all possible legal moves
export function getLegalMoves(fen) {
  const game = new Chess(fen)
  return game.moves({ verbose: true })
}

// Draw detection & game status
export function checkGameStatus(state, gameInstance) {
  // Always reconstruct game from FEN if not provided
  let game = gameInstance
  if (!game) {
    if (!state.fen) throw new Error("Invalid state: missing FEN")
    game = new Chess(state.fen)
  }

  // Check for time-based wins first
  if (state.whiteTime <= 0) return { result: "timeout", winner: "black", reason: "white ran out of time" }
  if (state.blackTime <= 0) return { result: "timeout", winner: "white", reason: "black ran out of time" }

  if (game.isCheckmate()) return { result: "checkmate", winner: game.turn() === "w" ? "black" : "white" }
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
  if (state.moveHistory.length >= 150) return { result: "draw", reason: "75-move rule" }

  return { result: "ongoing" }
}

// Helper: track FEN repetitions for 5-fold and 75-move rule
export function updateRepetitionMap(state, gameInstance) {
  // Defensive: reconstruct repetitionMap if missing
  let fen
  if (gameInstance) {
    fen = gameInstance.fen()
  } else if (state.fen) {
    fen = state.fen
  } else {
    throw new Error("Invalid state: missing FEN")
  }

  if (!(state.repetitionMap instanceof Map)) {
    state.repetitionMap = new Map(Object.entries(state.repetitionMap || {}))
  }

  const current = state.repetitionMap.get(fen) || 0
  state.repetitionMap.set(fen, current + 1)
  console.log("Repetition map updated for FEN:", fen, "Count:", counter + 1)
}