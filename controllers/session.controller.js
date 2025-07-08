import { v4 as uuidv4 } from 'uuid';
import redisClient, { 
  sessionKey, 
  userSessionKey, 
  SESSION_TIMEOUT 
} from '../config/redis.config.js';
import { createInitialState as createStandardInitialState, convertBigIntToNumber } from '../validations/classic/standard.js';
import { createInitialState as createBlitzInitialState } from '../validations/classic/blitz.js';

// Game variants and their configurations
const GAME_VARIANTS = {
  classic: {
    name: 'Classic',
    subvariants: {
      standard: {
        name: 'Standard',
        initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        timeControl: { base: 10 * 60 * 1000, increment: 0 }, // 10 minutes
        description: 'Standard FIDE chess rules with classical time control'
      },
      blitz: {
        name: 'Blitz',
        initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        timeControl: { base: 3 * 60 * 1000, increment: 2000 }, // 3+2
        description: 'Fast-paced chess with 3 minutes base + 2 second increment'
      },
      bullet: {
        name: 'Bullet',
        initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        timeControl: { base: 60 * 1000, increment: 0 }, // 1+0 (corrected from 1+1)
        description: 'Ultra-fast chess with 1 minute base, no increment'
      }
    }
  }
};

// Chess-specific constants
const CHESS_CONSTANTS = {
  PIECES: {
    PAWN: 'p',
    ROOK: 'r',
    KNIGHT: 'n',
    BISHOP: 'b',
    QUEEN: 'q',
    KING: 'k'
  },
  COLORS: {
    WHITE: 'white',
    BLACK: 'black'
  },
  CASTLING_RIGHTS: {
    WHITE_KINGSIDE: 'K',
    WHITE_QUEENSIDE: 'Q',
    BLACK_KINGSIDE: 'k',
    BLACK_QUEENSIDE: 'q'
  },
  GAME_RESULTS: {
    WHITE_WINS: 'white_wins',
    BLACK_WINS: 'black_wins',
    DRAW: 'draw',
    ONGOING: 'ongoing'
  },
  DRAW_REASONS: {
    STALEMATE: 'stalemate',
    INSUFFICIENT_MATERIAL: 'insufficient_material',
    THREEFOLD_REPETITION: 'threefold_repetition',
    FIFTY_MOVE_RULE: 'fifty_move_rule',
    MUTUAL_AGREEMENT: 'mutual_agreement'
  },
  WIN_REASONS: {
    CHECKMATE: 'checkmate',
    TIME_FORFEIT: 'time_forfeit',
    RESIGNATION: 'resignation',
    ABANDONMENT: 'abandonment'
  }
};

// Input validation functions
const validatePlayer = (player) => {
  if (!player || typeof player !== 'object') {
    console.error('Invalid player type:', player); 
    return false
  };
  if (!player.userId || typeof player.userId !== 'string') {
    console.error('Invalid player userId:', player.userId); 
    return false
  };
  if (!player.username || typeof player.username !== 'string') {
    console.error('Invalid player username:', player.username); 
    return false
  };
  if (typeof player.rating !== 'number') {
    console.error('Invalid player rating:', player.rating, typeof player.rating, 'for user', player.username); 
    return false
  };
  return true;
};

const validateGameConfig = (variant, subvariant) => {
  if (!variant || !GAME_VARIANTS[variant]) return false;
  if (!subvariant || !GAME_VARIANTS[variant].subvariants[subvariant]) return false;
  return true;
};

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
 * Parse FEN string to extract board state components
 */
function parseFen(fen) {
  const parts = fen.split(' ');
  return {
    position: parts[0],
    activeColor: parts[1],
    castlingRights: parts[2],
    enPassantSquare: parts[3],
    halfmoveClock: parseInt(parts[4]) || 0,
    fullmoveNumber: parseInt(parts[5]) || 1
  };
}

/**
 * Create initial game state with comprehensive chess rules
 */
function createInitialGameState(variant, subvariant, whitePlayer, blackPlayer) {
  const gameConfig = GAME_VARIANTS[variant].subvariants[subvariant];
  const fenData = parseFen(gameConfig.initialFen);
  const now = Date.now();
  const timeControl = gameConfig.timeControl;
  // Only for standard chess, use the logic from validations/standard.js
  if (variant === 'classic' && subvariant === 'standard') {
    const now = Date.now();
    const state = createStandardInitialState();
  
    // Attach player and session/game metadata as before
    return {
      board: state,
      sessionId: null,
      variantName: GAME_VARIANTS[variant].name,
      subvariantName: GAME_VARIANTS[variant].subvariants[subvariant].name,
      description: GAME_VARIANTS[variant].subvariants[subvariant].description,
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
      timeControl: {
        type: getTimeControlType(timeControl),
        baseTime: timeControl.base,
        increment: timeControl.increment,
        timers: {
          white: timeControl.base,
          black: timeControl.base
        },
        timeSpent: {
          white: [],
          black: []
        },
        flagged: {
          white: false,
          black: false
        }
      },
      status: 'active',
      result: CHESS_CONSTANTS.GAME_RESULTS.ONGOING,
      resultReason: null,
      winner: null,
      moves: [],
      moveCount: 0,
      lastMove: null,
      gameState: {
        check: false,
        checkmate: false,
        stalemate: false,
        insufficientMaterial: false,
        threefoldRepetition: false,
        fiftyMoveRule: false
      },
      positionHistory: [gameConfig.initialFen],
      createdAt: Number(now),
      lastActivity: Number(now),
      startedAt: Number(now),
      endedAt: null,
      rules: getChessRules(variant, subvariant),
      metadata: {
        source: 'matchmaking',
        rated: true,
        spectators: [],
        allowSpectators: true,
        drawOffers: {
          white: false,
          black: false
        },
        resignations: {
          white: false,
          black: false
        },
        premoves: {
          white: null,
          black: null
        }
      }
    };
  } else if (variant === 'classic' && subvariant === 'blitz') {
    const now = Date.now();
    const state = createBlitzInitialState()

    return {
      board: state,
      sessionId: null,
      variantName: GAME_VARIANTS[variant].name,
      subvariantName: GAME_VARIANTS[variant].subvariants[subvariant].name,
      description: GAME_VARIANTS[variant].subvariants[subvariant].description,
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
      timeControl: {
        type: getTimeControlType(timeControl),
        baseTime: timeControl.base,
        increment: timeControl.increment,
        timers: {
          white: timeControl.base,
          black: timeControl.base
        },
        timeSpent: {
          white: [],
          black: []
        },
        flagged: {
          white: false,
          black: false
        }
      },
      status: 'active',
      result: CHESS_CONSTANTS.GAME_RESULTS.ONGOING,
      resultReason: null,
      winner: null,
      moves: [],
      moveCount: 0,
      lastMove: null,
      gameState: {
        check: false,
        checkmate: false,
        stalemate: false,
        insufficientMaterial: false,
        threefoldRepetition: false,
        fiftyMoveRule: false
      },
      positionHistory: [gameConfig.initialFen],
      createdAt: Number(now),
      lastActivity: Number(now),
      startedAt: Number(now),
      endedAt: null,
      rules: getChessRules(variant, subvariant),
      metadata: {
        source: 'matchmaking',
        rated: true,
        spectators: [],
        allowSpectators: true,
        drawOffers: {
          white: false,
          black: false
        },
        resignations: {
          white: false,
          black: false
        },
        premoves: {
          white: null,
          black: null
        }
      }
    };
  }
  // Fallback to previous logic for other variant
  return {
    // ...existing code for non-standard variants...
    sessionId: null,
    variantName: GAME_VARIANTS[variant].name,
    subvariantName: gameConfig.name,
    description: gameConfig.description,
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
    board: {
      fen: gameConfig.initialFen,
      position: fenData.position,
      activeColor: fenData.activeColor === 'w' ? 'white' : 'black',
      castlingRights: fenData.castlingRights,
      enPassantSquare: fenData.enPassantSquare,
      halfmoveClock: fenData.halfmoveClock,
      fullmoveNumber: fenData.fullmoveNumber
    },
    timeControl: {
      type: getTimeControlType(timeControl),
      baseTime: timeControl.base,
      increment: timeControl.increment,
      timers: {
        white: timeControl.base,
        black: timeControl.base
      },
      timeSpent: {
        white: [],
        black: []
      },
      flagged: {
        white: false,
        black: false
      }
    },
    status: 'active',
    result: CHESS_CONSTANTS.GAME_RESULTS.ONGOING,
    resultReason: null,
    winner: null,
    moves: [],
    moveCount: 0,
    lastMove: null,
    gameState: {
      check: false,
      checkmate: false,
      stalemate: false,
      insufficientMaterial: false,
      threefoldRepetition: false,
      fiftyMoveRule: false
    },
    positionHistory: [gameConfig.initialFen],
    createdAt: now,
    lastActivity: now,
    startedAt: now,
    endedAt: null,
    rules: getChessRules(variant, subvariant),
    metadata: {
      source: 'matchmaking',
      rated: true,
      spectators: [],
      allowSpectators: true,
      drawOffers: {
        white: false,
        black: false
      },
      resignations: {
        white: false,
        black: false
      },
      premoves: {
        white: null,
        black: null
      }
    }
  };
}

/**
 * Get time control type based on time settings (Chess.com style)
 */
function getTimeControlType(timeControl) {
  const baseMinutes = timeControl.base / (60 * 1000);
  const incrementSeconds = timeControl.increment / 1000;
  
  // Chess.com time control categories
  if (baseMinutes <= 1 || (baseMinutes <= 1 && incrementSeconds == 0)) {
    return 'bullet';
  } else if (baseMinutes <= 3 || (baseMinutes <= 3 && incrementSeconds <= 2)) {
    return 'blitz';
  } else {
    return 'standard';
  }
}

/**
 * Get comprehensive chess rules based on variant and subvariant
 */
function getChessRules(variant, subvariant) {
  const baseRules = {
    // Standard FIDE rules
    fideRules: true,
    
    // Win conditions
    checkmate: true,
    resignation: true,
    timeForfeiture: true,
    
    // Draw conditions
    stalemate: true,
    insufficientMaterial: true,
    threefoldRepetition: true,
    fiftyMoveRule: true,
    mutualAgreement: true,
    
    // Time control rules
    timeControl: {
      mainClock: true,
      increment: true,
      flagFall: true, // Time expires = loss
      premove: true   // Allow premoves for faster play
    },
    
    // Move validation
    illegalMoves: {
      penalty: 'revert', // Revert illegal moves
      timeDeduction: false // No time penalty for illegal moves in online play
    },
    
    // Castling rules
    castling: {
      kingside: true,
      queenside: true,
      throughCheck: false,
      intoCheck: false,
      whileInCheck: false
    },
    
    // En passant
    enPassant: true,
    
    // Pawn promotion
    promotion: {
      pieces: ['queen', 'rook', 'bishop', 'knight'],
      mandatory: true,
      underpromotion: true
    },
    
    // Special rules for online play
    online: {
      autoFlag: true,        // Automatically flag on time expiration
      drawClaim: true,       // Allow draw claims
      takeback: false,       // No takebacks in rated games
      analysis: false,       // No engine analysis during game
      opening_book: false    // No opening book during game
    }
  };
  
  // Variant-specific rule modifications
  switch (variant) {
    case 'classic':
      // Apply subvariant-specific rules
      switch (subvariant) {
        case 'bullet':
          return {
            ...baseRules,
            timeControl: {
              ...baseRules.timeControl,
              increment: false, // 1+0 format
              flagFall: true,
              premove: true // Critical for bullet chess
            },
            online: {
              ...baseRules.online,
              autoFlag: true,
              quickDraw: true // Faster draw claim processing
            }
          };
          
        case 'blitz':
          return {
            ...baseRules,
            timeControl: {
              ...baseRules.timeControl,
              increment: true, // 3+2 format
              flagFall: true,
              premove: true
            },
            online: {
              ...baseRules.online,
              autoFlag: true
            }
          };
          
        case 'standard':
          return {
            ...baseRules,
            timeControl: {
              ...baseRules.timeControl,
              increment: false, // Classical time control
              flagFall: true,
              premove: false // Less critical for longer games
            },
            online: {
              ...baseRules.online,
              autoFlag: true,
              analysis: false // Still no analysis in standard online
            }
          };
          
        default:
          return baseRules;
      }
      
    default:
      return baseRules;
  }
}

/**
 * Initialize game timers based on time control
 */
function initializeTimers(gameState) {
  const { timeControl } = gameState;
  
  return {
    white: {
      remaining: timeControl.baseTime,
      lastUpdateTime: Date.now(),
      isRunning: gameState.board.activeColor === 'white'
    },
    black: {
      remaining: timeControl.baseTime,
      lastUpdateTime: Date.now(),
      isRunning: gameState.board.activeColor === 'black'
    }
  };
}

export async function createGameSession(player1, player2, variant, subvariant, customConfig = {}) {
  try {
    // Input validation
    console.log('Creating game session with players:', player1, player2);
    console.log('Variant:', variant, 'Subvariant:', subvariant);
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
    // const [player1Session, player2Session] = await Promise.all([
    //   redisClient.get(userSessionKey(player1.userId)),
    //   redisClient.get(userSessionKey(player2.userId))
    // ]);
    
    // if (player1Session) {
    //   throw new Error(`Player ${player1.username} is already in an active game`);
    // }
    
    // if (player2Session) {
    //   throw new Error(`Player ${player2.username} is already in an active game`);
    // }
    
    // Generate session ID
    const sessionId = uuidv4();
    
    // Assign colors randomly
    const { whitePlayer, blackPlayer } = assignPlayerColors(player1, player2);
    
    // Create initial game state
    const gameState = createInitialGameState(variant, subvariant, whitePlayer, blackPlayer);
    gameState.sessionId = sessionId;
    
    // Apply any custom configurations
    if (customConfig.timeControl) {
      gameState.timeControl = { ...gameState.timeControl, ...customConfig.timeControl };
    }
    
    if (customConfig.rated !== undefined) {
      gameState.metadata.rated = customConfig.rated;
    }
    
    if (customConfig.allowSpectators !== undefined) {
      gameState.metadata.allowSpectators = customConfig.allowSpectators;
    }
    
    // Initialize timers
    const timers = initializeTimers(gameState);
    gameState.timers = timers;
    
    // Prepare session data for Redis
    const sessionData = {
      sessionId,
      gameState: JSON.stringify(convertBigIntToNumber(gameState)),
      playerWhiteId: whitePlayer.userId,
      playerBlackId: blackPlayer.userId,
      variant,
      subvariant,
      status: 'active',
      createdAt: Date.now().toString(),
      lastActivity: Date.now().toString(),
      timeControl: JSON.stringify(convertBigIntToNumber(gameState.timeControl))
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
      variant: `${variant}/${subvariant}`,
      timeControl: `${gameState.timeControl.baseTime/60000}+${gameState.timeControl.increment/1000}`
    });
    
    // Return session data for frontend
    return {
      success: true,
      sessionId,
      gameState: {
        ...gameState,
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
    
    // Parse game state and convert any BigInt to Number (defensive)
    let gameState = JSON.parse(sessionData.gameState);
    gameState = convertBigIntToNumber(gameState);
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
 * Update game state in Redis
 */
export async function updateGameState(sessionId, gameState) {
  try {
    const exists = await redisClient.exists(sessionKey(sessionId));
    
    if (!exists) {
      return false;
    }
    
    const multi = redisClient.multi();
    multi.hSet(sessionKey(sessionId), {
      gameState: JSON.stringify(convertBigIntToNumber(gameState)),
      lastActivity: Date.now().toString(),
      status: gameState.status
    });
    multi.expire(sessionKey(sessionId), Math.floor(SESSION_TIMEOUT / 1000));
    
    await multi.exec();
    return true;
    
  } catch (error) {
    console.error('Error updating game state:', error);
    return false;
  }
}

/**
 * Check for time forfeiture
 */
export async function checkTimeForfeiture(sessionId) {
  try {
    const session = await getSessionById(sessionId);
    if (!session || session.gameState.status !== 'active') {
      return null;
    }
    
    const { gameState } = session;
    const { timers, board } = gameState;
    const activeColor = board.activeColor;
    
    if (timers[activeColor].remaining <= 0) {
      // Time has expired
      const winner = activeColor === 'white' ? 'black' : 'white';
      
      gameState.status = 'finished';
      gameState.result = winner === 'white' ? CHESS_CONSTANTS.GAME_RESULTS.WHITE_WINS : CHESS_CONSTANTS.GAME_RESULTS.BLACK_WINS;
      gameState.resultReason = CHESS_CONSTANTS.WIN_REASONS.TIME_FORFEIT;
      gameState.winner = winner;
      gameState.endedAt = Date.now();
      gameState.timeControl.flagged[activeColor] = true;
      
      await updateGameState(sessionId, gameState);
      
      return {
        gameOver: true,
        winner,
        reason: CHESS_CONSTANTS.WIN_REASONS.TIME_FORFEIT,
        gameState
      };
    }
    
    return null;
    
  } catch (error) {
    console.error('Error checking time forfeiture:', error);
    return null;
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
      description: GAME_VARIANTS[key].subvariants[subKey].description,
      timeControl: GAME_VARIANTS[key].subvariants[subKey].timeControl
    }))
  }));
}

/**
 * Get chess constants for frontend use
 */
export function getChessConstants() {
  return CHESS_CONSTANTS;
}