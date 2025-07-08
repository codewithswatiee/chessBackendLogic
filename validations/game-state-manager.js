import { safeObjectId } from "./chess-utils.js"

// Helper function to resolve winner from color to actual user ID
export function resolveGameWinner(gameState, players) {
  try {
    if (!gameState.winnerColor || !players) {
      return null
    }

    // Get the player object for the winning color
    const winningPlayer = players[gameState.winnerColor]
    if (!winningPlayer || !winningPlayer.userId) {
      console.warn("[WINNER] No player found for winning color:", gameState.winnerColor)
      return null
    }

    // Validate and return the user ID
    const validUserId = safeObjectId(winningPlayer.userId)
    if (!validUserId) {
      console.warn("[WINNER] Invalid user ID for winner:", winningPlayer.userId)
      return null
    }

    return validUserId
  } catch (error) {
    console.error("[WINNER] Error resolving game winner:", error)
    return null
  }
}

// Helper function to prepare game state for database storage
export function prepareGameStateForDB(gameState, players) {
  try {
    // Create a clean copy of the game state
    const dbState = { ...gameState }

    // Resolve winner color to actual user ID
    if (dbState.winnerColor && players) {
      dbState.winner = resolveGameWinner(dbState, players)
    } else {
      dbState.winner = null
    }

    // Clean up temporary fields
    delete dbState.winnerColor
    delete dbState.game // Remove Chess.js instance if present

    // Ensure all required fields are present and valid
    if (dbState.sessionId) {
      dbState.sessionId = safeObjectId(dbState.sessionId)
    }

    // Convert Map to Object for JSON serialization
    if (dbState.repetitionMap instanceof Map) {
      dbState.repetitionMap = Object.fromEntries(dbState.repetitionMap)
    }

    // Validate timestamps
    const now = Date.now()
    if (!dbState.createdAt || typeof dbState.createdAt !== "number") {
      dbState.createdAt = now
    }
    if (!dbState.lastActivity || typeof dbState.lastActivity !== "number") {
      dbState.lastActivity = now
    }

    return dbState
  } catch (error) {
    console.error("[DB_PREP] Error preparing game state for database:", error)
    return null
  }
}

// Helper function to safely update game in database
export async function updateGameInDB(gameCollection, sessionId, gameState, players) {
  try {
    const validSessionId = safeObjectId(sessionId)
    if (!validSessionId) {
      throw new Error("Invalid session ID format")
    }

    const preparedState = prepareGameStateForDB(gameState, players)
    if (!preparedState) {
      throw new Error("Failed to prepare game state for database")
    }

    console.log("[DB_UPDATE] Updating game:", validSessionId)
    console.log("[DB_UPDATE] Winner color:", gameState.winnerColor, "-> Winner ID:", preparedState.winner)

    const result = await gameCollection.updateOne(
      { sessionId: validSessionId },
      {
        $set: {
          ...preparedState,
          lastActivity: Date.now(),
        },
      },
    )

    if (result.matchedCount === 0) {
      console.warn("[DB_UPDATE] No game found with session ID:", validSessionId)
      return { success: false, error: "Game not found" }
    }

    console.log("[DB_UPDATE] Game updated successfully")
    return { success: true, data: result }
  } catch (error) {
    console.error("[DB_UPDATE] Error updating game in database:", error)
    return { success: false, error: error.message }
  }
}

// Helper function to create game result summary
export function createGameResult(gameState, players) {
  try {
    const result = {
      result: gameState.endReason || "unknown",
      endTimestamp: gameState.endTimestamp || Date.now(),
      moveCount: gameState.moveHistory?.length || 0,
      duration: null,
      winner: null,
      winnerColor: gameState.winnerColor || null,
    }

    // Calculate game duration
    if (gameState.firstMoveTimestamp && gameState.endTimestamp) {
      result.duration = gameState.endTimestamp - gameState.firstMoveTimestamp
    }

    // Resolve winner
    if (gameState.winnerColor && players) {
      result.winner = resolveGameWinner(gameState, players)
    }

    return result
  } catch (error) {
    console.error("[RESULT] Error creating game result:", error)
    return null
  }
}
