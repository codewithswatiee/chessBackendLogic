import { v4 as uuidv4 } from 'uuid';
import redisClient, { 
  sessionKey, 
  userSessionKey, 
  SESSION_TIMEOUT 
} from '../config/redis.config.js';

// Game variants and their configurations
const GAME_VARIANTS = {
  classic: {
    name: 'Classic Chess',
    subvariants: {
      standard: {
        name: 'Standard',
        initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        timeControl: { base: 10 * 60 * 1000, increment: 0 } // 10 minutes
      },
      blitz: {
        name: 'Blitz',
        initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        timeControl: { base: 3 * 60 * 1000, increment: 2000 } // 3+2
      },
      bullet: {
        name: 'Bullet',
        initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        timeControl: { base: 60 * 1000, increment: 1000 } // 1+1
      }
    }
  },
  fischer960: {
    name: 'Fischer Random Chess',
    subvariants: {
      standard: {
        name: 'Fischer 960',
        initialFen: null, // Will be generated
        timeControl: { base: 10 * 60 * 1000, increment: 0 }
      }
    }
  },
  kingOfTheHill: {
    name: 'King of the Hill',
    subvariants: {
      standard: {
        name: 'King of the Hill',
        initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        timeControl: { base: 10 * 60 * 1000, increment: 0 }
      }
    }
  }
};

// Input validation functions
const validatePlayer = (player) => {
  if (!player || typeof player !== 'object') return false;
  if (!player.userId || typeof player.userId !== 'string') return false;
  if (!player.username || typeof player.username !== 'string') return false;
  if (!player.rating || typeof player.rating !== 'number') return false;
  return true;
};

const validateGameConfig = (variant, subvariant) => {
  if (!variant || !GAME_VARIANTS[variant]) return false;
  if (!subvariant || !GAME_VARIANTS[variant].subvariants[subvariant]) return false;
  return true;
};

/**
 * Generate Fischer 960 starting position
 */
function generateFischer960Position() {
  const positions = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'rnbqkrbn/pppppppp/8/8/8/8/PPPPPPPP/RNBQKRBN w KQkq - 0 1',
    'rnbqnrkb/pppppppp/8/8/8/8/PPPPPPPP/RNBQNRKB w KQkq - 0 1',
    // Add more Fischer 960 positions as needed
  ];
  return positions[Math.floor(Math.random() * positions.length)];
}

/**
 * Randomly assign colors to players
 */
function assignPlayerColors(player1, player2) {
  const shouldPlayer1BeWhite = Math.random() < 0.5;
  
  if (shouldPlayer1BeWhite) {
    return {
      whitePlayer: player1,
      blackPlayer: player2
    };
  } else {
    return {
      whitePlayer: player2,
      blackPlayer: player1
    };
  }
}

/**
 * Create initial game state
 */
function createInitialGameState(variant, subvariant, whitePlayer, blackPlayer) {
  const gameConfig = GAME_VARIANTS[variant].subvariants[subvariant];
  
  let initialFen = gameConfig.initialFen;
  if (variant === 'fischer960') {
    initialFen = generateFischer960Position();
  }
  
  const now = Date.now();
  const timeControl = gameConfig.timeControl;
  
  return {
    // Game identification
    variant,
    subvariant,
    variantName: GAME_VARIANTS[variant].name,
    subvariantName: gameConfig.name,
    
    // Players
    players: {
      white: {
        userId: whitePlayer.userId,
        username: whitePlayer.username,
        rating: whitePlayer.rating,
        avatar: whitePlayer.avatar || null,
        title: whitePlayer.title || null
      },
      black: {
        userId: blackPlayer.userId,
        username: blackPlayer.username,
        rating: blackPlayer.rating,
        avatar: blackPlayer.avatar || null,
        title: blackPlayer.title || null
      }
    },
    
    // Game state
    board: {
      fen: initialFen,
      turn: 'white',
      castlingRights: 'KQkq',
      enPassant: '-',
      halfmoveClock: 0,
      fullmoveNumber: 1
    },
    
    // Time control
    timeControl: {
      type: getTimeControlType(timeControl),
      baseTime: timeControl.base,
      increment: timeControl.increment,
      timers: {
        white: timeControl.base,
        black: timeControl.base
      }
    },
    
    // Session info
    status: 'active',
    createdAt: now,
    lastActivity: now,
    moveCount: 0,
    
    // Game rules based on variant
    rules: getGameRules(variant),
    
    // Additional metadata
    metadata: {
      source: 'matchmaking',
      rated: true,
      spectators: [],
      allowSpectators: true
    }
  };
}

/**
 * Get time control type based on time settings
 */
function getTimeControlType(timeControl) {
  const totalTime = timeControl.base + (timeControl.increment * 40); // Estimate for 40 moves
  
  if (totalTime < 3 * 60 * 1000) return 'bullet';
  if (totalTime < 10 * 60 * 1000) return 'blitz';
  if (totalTime < 30 * 60 * 1000) return 'rapid';
  return 'classical';
}

/**
 * Get game rules based on variant
 */
function getGameRules(variant) {
  const baseRules = {
    checkmate: true,
    stalemate: true,
    threefoldRepetition: true,
    fiftyMoveRule: true,
    insufficientMaterial: true
  };
  
  switch (variant) {
    case 'kingOfTheHill':
      return {
        ...baseRules,
        kingToCenter: true // King reaching center squares wins
      };
    case 'fischer960':
      return {
        ...baseRules,
        fischer960Castling: true
      };
    default:
      return baseRules;
  }
}

/**
 * Main function to create a new game session
 */
export async function createGameSession(player1, player2, variant = 'classic', subvariant = 'standard', customConfig = {}) {
  try {
    // Input validation
    if (!validatePlayer(player1) || !validatePlayer(player2)) {
      throw new Error('Invalid player data provided');
    }
    
    if (player1.userId === player2.userId) {
      throw new Error('Cannot create game session with the same player');
    }
    
    if (!validateGameConfig(variant, subvariant)) {
      throw new Error(`Invalid game variant: ${variant}/${subvariant}`);
    }
    
    // Check if either player is already in an active session
    const [player1Session, player2Session] = await Promise.all([
      redisClient.get(userSessionKey(player1.userId)),
      redisClient.get(userSessionKey(player2.userId))
    ]);
    
    if (player1Session) {
      throw new Error(`Player ${player1.username} is already in an active game`);
    }
    
    if (player2Session) {
      throw new Error(`Player ${player2.username} is already in an active game`);
    }
    
    // Generate session ID
    const sessionId = uuidv4();
    
    // Assign colors randomly
    const { whitePlayer, blackPlayer } = assignPlayerColors(player1, player2);
    
    // Create initial game state
    const gameState = createInitialGameState(variant, subvariant, whitePlayer, blackPlayer);
    
    // Apply any custom configurations
    if (customConfig.timeControl) {
      gameState.timeControl = { ...gameState.timeControl, ...customConfig.timeControl };
    }
    
    if (customConfig.rated !== undefined) {
      gameState.metadata.rated = customConfig.rated;
    }
    
    // Prepare session data for Redis
    const sessionData = {
      sessionId,
      gameState: JSON.stringify(gameState),
      playerWhiteId: whitePlayer.userId,
      playerBlackId: blackPlayer.userId,
      variant,
      subvariant,
      status: 'active',
      createdAt: Date.now().toString(),
      lastActivity: Date.now().toString()
    };
    
    // Store in Redis using transaction for atomicity
    const multi = redisClient.multi();
    
    // Store session data
    multi.hSet(sessionKey(sessionId), sessionData);
    multi.expire(sessionKey(sessionId), Math.floor(SESSION_TIMEOUT / 1000));
    
    // Map users to session
    multi.set(userSessionKey(whitePlayer.userId), sessionId);
    multi.set(userSessionKey(blackPlayer.userId), sessionId);
    multi.expire(userSessionKey(whitePlayer.userId), Math.floor(SESSION_TIMEOUT / 1000));
    multi.expire(userSessionKey(blackPlayer.userId), Math.floor(SESSION_TIMEOUT / 1000));
    
    // Execute transaction
    await multi.exec();
    
    // Log session creation
    console.log(`Game session created: ${sessionId}`, {
      white: whitePlayer.username,
      black: blackPlayer.username,
      variant: `${variant}/${subvariant}`
    });
    
    // Return session data for frontend
    return {
      success: true,
      sessionId,
      gameState: {
        ...gameState,
        sessionId,
        userColor: {
          [whitePlayer.userId]: 'white',
          [blackPlayer.userId]: 'black'
        }
      }
    };
    
  } catch (error) {
    console.error('Error creating game session:', error);
    throw new Error(`Failed to create game session: ${error.message}`);
  }
}

/**
 * Get session data by session ID
 */
export async function getSessionById(sessionId) {
  try {
    if (!sessionId) {
      throw new Error('Session ID is required');
    }
    
    const sessionData = await redisClient.hGetAll(sessionKey(sessionId));
    
    if (!sessionData || Object.keys(sessionData).length === 0) {
      return null;
    }
    
    // Parse game state
    const gameState = JSON.parse(sessionData.gameState);
    
    return {
      sessionId,
      gameState,
      createdAt: parseInt(sessionData.createdAt),
      lastActivity: parseInt(sessionData.lastActivity),
      status: sessionData.status
    };
    
  } catch (error) {
    console.error('Error getting session:', error);
    return null;
  }
}

/**
 * Check if user has active session
 */
export async function getUserActiveSession(userId) {
  try {
    const sessionId = await redisClient.get(userSessionKey(userId));
    
    if (!sessionId) {
      return null;
    }
    
    const sessionData = await getSessionById(sessionId);
    
    if (!sessionData) {
      // Clean up orphaned user session
      await redisClient.del(userSessionKey(userId));
      return null;
    }
    
    return sessionData;
    
  } catch (error) {
    console.error('Error checking user active session:', error);
    return null;
  }
}

/**
 * Update session activity timestamp
 */
export async function updateSessionActivity(sessionId) {
  try {
    const exists = await redisClient.exists(sessionKey(sessionId));
    
    if (!exists) {
      return false;
    }
    
    await redisClient.hSet(sessionKey(sessionId), 'lastActivity', Date.now().toString());
    await redisClient.expire(sessionKey(sessionId), Math.floor(SESSION_TIMEOUT / 1000));
    
    return true;
    
  } catch (error) {
    console.error('Error updating session activity:', error);
    return false;
  }
}

/**
 * Get available game variants
 */
export function getAvailableVariants() {
  return Object.keys(GAME_VARIANTS).map(key => ({
    key,
    name: GAME_VARIANTS[key].name,
    subvariants: Object.keys(GAME_VARIANTS[key].subvariants).map(subKey => ({
      key: subKey,
      name: GAME_VARIANTS[key].subvariants[subKey].name,
      timeControl: GAME_VARIANTS[key].subvariants[subKey].timeControl
    }))
  }));
}