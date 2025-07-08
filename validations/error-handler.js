// Centralized error handling for the chess game backend

export class ChessGameError extends Error {
  constructor(message, code, context = {}) {
    super(message)
    this.name = "ChessGameError"
    this.code = code
    this.context = context
    this.timestamp = new Date().toISOString()
  }
}

// Error codes
export const ERROR_CODES = {
  // Database errors
  INVALID_OBJECT_ID: "INVALID_OBJECT_ID",
  DB_CONNECTION_FAILED: "DB_CONNECTION_FAILED",
  DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
  DUPLICATE_KEY: "DUPLICATE_KEY",
  VALIDATION_ERROR: "VALIDATION_ERROR",

  // Game logic errors
  GAME_NOT_FOUND: "GAME_NOT_FOUND",
  INVALID_MOVE: "INVALID_MOVE",
  GAME_ENDED: "GAME_ENDED",
  WRONG_TURN: "WRONG_TURN",
  TIMEOUT: "TIMEOUT",

  // Socket errors
  SOCKET_ERROR: "SOCKET_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  RATE_LIMITED: "RATE_LIMITED",

  // General errors
  INTERNAL_ERROR: "INTERNAL_ERROR",
  INVALID_INPUT: "INVALID_INPUT",
}

// Log error with context
export function logError(error, context = {}) {
  const errorInfo = {
    message: error.message,
    code: error.code || "UNKNOWN",
    context: { ...context, ...error.context },
    timestamp: new Date().toISOString(),
    stack: error.stack,
  }

  console.error("[ERROR]", JSON.stringify(errorInfo, null, 2))
  return errorInfo
}

// Handle ObjectId casting errors specifically
export function handleObjectIdError(error, operation = "unknown") {
  if (error.name === "CastError" && error.path === "_id") {
    const customError = new ChessGameError(`Invalid ID format in ${operation}`, ERROR_CODES.INVALID_OBJECT_ID, {
      operation,
      originalError: error.message,
    })
    return logError(customError)
  }
  return null
}

// Handle MongoDB validation errors
export function handleValidationError(error, operation = "unknown") {
  if (error.name === "ValidationError") {
    const customError = new ChessGameError(`Validation failed in ${operation}`, ERROR_CODES.VALIDATION_ERROR, {
      operation,
      validationErrors: error.errors,
      originalError: error.message,
    })
    return logError(customError)
  }
  return null
}

// Generic error handler for socket events
export function handleSocketError(socket, error, event = "unknown") {
  const errorInfo = logError(error, { event, socketId: socket?.id })

  // Send safe error message to client (don't expose internal details)
  const clientError = {
    error: true,
    message:
      error.code === ERROR_CODES.INVALID_OBJECT_ID ? "Invalid game or user ID" : "An error occurred. Please try again.",
    code: error.code || ERROR_CODES.INTERNAL_ERROR,
    timestamp: new Date().toISOString(),
  }

  if (socket && socket.emit) {
    socket.emit("game:error", clientError)
  }

  return errorInfo
}

// Rate limiting helper
const rateLimitMap = new Map()

export function checkRateLimit(identifier, maxRequests = 10, windowMs = 60000) {
  const now = Date.now()
  const windowStart = now - windowMs

  if (!rateLimitMap.has(identifier)) {
    rateLimitMap.set(identifier, [])
  }

  const requests = rateLimitMap.get(identifier)

  // Remove old requests outside the window
  const validRequests = requests.filter((timestamp) => timestamp > windowStart)

  if (validRequests.length >= maxRequests) {
    return {
      allowed: false,
      resetTime: validRequests[0] + windowMs,
    }
  }

  validRequests.push(now)
  rateLimitMap.set(identifier, validRequests)

  return {
    allowed: true,
    remaining: maxRequests - validRequests.length,
  }
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now()
  const windowMs = 60000 // 1 minute

  for (const [identifier, requests] of rateLimitMap.entries()) {
    const validRequests = requests.filter((timestamp) => timestamp > now - windowMs)
    if (validRequests.length === 0) {
      rateLimitMap.delete(identifier)
    } else {
      rateLimitMap.set(identifier, validRequests)
    }
  }
}, 300000) // Clean up every 5 minutes
