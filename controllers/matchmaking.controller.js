import { Server } from 'socket.io';
import UserModel from '../models/User.model.js';
import redisClient from '../config/redis.config.js';
import { createGameSession } from './session.controller.js';
import gameModel from '../models/game.model.js';

// Supported variants
const VARIANTS = ['Crazyhouse with Timer', '6Pointer Chess', 'Decay Chess', 'Classic'];

// Cooldown in ms
const REJOIN_COOLDOWN = 10 * 1000;
// Idle timeout in ms
const IDLE_TIMEOUT = 5 * 60 * 1000;
// Closest-rank window in ms
const RANK_WINDOW = 10 * 1000;

// Redis key helpers
const queueKey = (variant) => `queue:${variant}`;
const userKey = (userId) => `queueuser:${userId}`;
const cooldownKey = (userId) => `cooldown:${userId}`;

// Helper: get rating field for variant
function getRatingField(variant) {
  switch (variant) {
    case 'Crazyhouse with Timer': return 'crazyhouse';
    case 'Six Pointer': return 'sixPoint';
    case 'Decay Chess': return 'decayChess';
    case 'Classic': return 'classic';
    default: throw new Error('Unknown variant');
  }
}

/**
 * Add user to matchmaking queue (sorted set by rank, with join time as tiebreaker)
 * @param {Object} params - { userId, socketId, rank, variant }
 * @param {Server} io - Socket.IO server instance
 */
export async function joinQueue({ userId, socketId, variant, subvariant , io}) {
  try {
    console.log(`[joinQueue] userId=${userId}, socketId=${socketId}, variant=${variant}, subvariant=${subvariant}`);
    
    // Check cooldown
    const cooldown = await redisClient.get(cooldownKey(userId));
    if (cooldown && Date.now() < parseInt(cooldown)) {
      console.log(`[joinQueue] User ${userId} is on cooldown until ${cooldown}`);
      io.to(socketId).emit('queue:cooldown', { until: parseInt(cooldown) });
      return;
    }

    // Clean up any existing queue data for this user first
    await cleanupUserFromAllQueues(userId);

    const userDoc = await UserModel.findById(userId);
    if (!userDoc) {
      console.error(`[joinQueue] User not found: ${userId}`);
      io.to(socketId).emit('queue:error', { message: 'User not found.' });
      return;
    }

    let rank;
    let ratingField;
    if (variant === 'classic') {
      // subvariant must be provided for Classic (either 'blitz' or 'bullet')
      if (!subvariant || (subvariant !== 'blitz' && subvariant !== 'bullet' && subvariant !== 'standard')) {
        console.error(`[joinQueue] Invalid or missing subvariant for Classic: ${subvariant}`);
        io.to(socketId).emit('queue:error', { message: 'Invalid or missing subvariant for Classic (must be blitz or bullet).' });
        return;
      }
      rank = userDoc.ratings?.classic?.[subvariant];
      if (rank === undefined) {
        console.error(`[joinQueue] No rank for user ${userId} in Classic ${subvariant}`);
        io.to(socketId).emit('queue:error', { message: `No rank found for Classic ${subvariant}` });
        return;
      }
      ratingField = `classic.${subvariant}`;
    } else {
      ratingField = getRatingField(variant);
      rank = userDoc.ratings?.[ratingField];
      if (rank === undefined) {
        console.error(`[joinQueue] No rank for user ${userId} in variant ${variant}`);
        io.to(socketId).emit('queue:error', { message: `No rank found for variant ${variant}` });
        return;
      }
    }

    const now = Date.now();
    const score = rank + (now / 1e13);
    
    // Set user data with fresh socket and 'waiting' status
    await redisClient.hSet(userKey(userId), {
      userId,
      socketId,
      rank,
      variant,
      subvariant: subvariant || '',
      joinTime: now,
      status: 'waiting',
    });
    
    await redisClient.zAdd(queueKey(variant), [{ score, value: userId }]);
    console.log(`[joinQueue] User ${userId} added to queue for ${variant} with rank ${rank}`);
    
    // Try to match immediately when user joins
    try {
      const matchFound = await tryMatch(userId, variant, io, true);
      
      // If no match found by rank, try fallback matching after delay
      if (!matchFound) {
        setTimeout(async () => {
          try {
            await tryMatch(userId, variant, io, false);
          } catch (err) {
            console.error(`[joinQueue] Error in tryMatch (fallback) for user ${userId}:`, err);
          }
        }, RANK_WINDOW);
      }
    } catch (err) {
      console.error(`[joinQueue] Error in tryMatch (byRank) for user ${userId}:`, err);
    }
  } catch (err) {
    console.error(`[joinQueue] Unexpected error:`, err);
    io.to(socketId).emit('queue:error', { message: 'Internal server error.' });
  }
}

/**
 * Clean up user from all queues (helper function)
 */
async function cleanupUserFromAllQueues(userId) {
  try {
    // Remove from all variant queues
    for (const variant of VARIANTS) {
      await redisClient.zRem(queueKey(variant), userId);
    }
    
    // Delete user data
    await redisClient.del(userKey(userId));
    
    console.log(`[cleanupUserFromAllQueues] Cleaned up user ${userId} from all queues`);
  } catch (err) {
    console.error(`[cleanupUserFromAllQueues] Error cleaning up user ${userId}:`, err);
  }
}

/**
 * Try to match a user in the queue
 * @param {string} userId
 * @param {string} variant
 * @param {Server} io
 * @param {boolean} byRank - true: closest rank, false: fallback random
 * @returns {boolean} - true if match was found and completed, false otherwise
 */
async function tryMatch(userId, variant, io, byRank) {
  try {
    console.log(`[tryMatch] userId=${userId}, variant=${variant}, byRank=${byRank}`);
    const user = await redisClient.hGetAll(userKey(userId));
    if (!user || user.status !== 'waiting') {
      console.log(`[tryMatch] User ${userId} not in waiting state. Status: ${user?.status}`);
      return false;
    }
    
    // Validate that the user's socket is still connected
    const userSocket = io.sockets.get(user.socketId);
    if (!userSocket) {
      console.log(`[tryMatch] User ${userId} socket ${user.socketId} is disconnected, removing from queue`);
      await leaveQueue(userId);
      return false;
    }
    
    let queue;
    if (variant === 'classic') {
      // Only match users with the same subvariant (blitz or bullet)
      if (!user.subvariant) {
        console.log(`[tryMatch] User ${userId} missing subvariant for Classic.`);
        return false;
      }
    }
    
    if (byRank) {
      // Use a window for efficient search
      const userRank = parseFloat(user.rank);
      let range = 100;
      const queueSize = await redisClient.zCard(queueKey(variant));
      if (queueSize > 1000) range = 50;
      if (Date.now() - parseInt(user.joinTime) > 5000) range *= 2;
      queue = await redisClient.zRangeByScore(queueKey(variant), userRank - range, userRank + range);
      console.log(`[tryMatch] All candidates in rank window:`, queue);
    } else {
      queue = await redisClient.zRange(queueKey(variant), 0, -1);
      console.log(`[tryMatch] All candidates in fallback:`, queue);
    }
    
    // IMPORTANT: Filter out the user themselves from candidates
    queue = queue.filter((id) => id !== userId);
    console.log(`[tryMatch] Candidates after filtering out self for user ${userId}:`, queue);
    
    // For Classic, filter by subvariant and validate socket connections
    if (variant === 'classic') {
      const validQueue = [];
      for (const id of queue) {
        const other = await redisClient.hGetAll(userKey(id));
        if (other && other.subvariant === user.subvariant && other.status === 'waiting') {
          // Check if socket is still connected
          const otherSocket = io.sockets.get(other.socketId);
          if (otherSocket) {
            validQueue.push(id);
          } else {
            // Clean up disconnected user
            console.log(`[tryMatch] Cleaning up disconnected user ${id}`);
            await leaveQueue(id);
          }
        }
      }
      queue = validQueue;
    } else {
      // For other variants, just validate socket connections
      const validQueue = [];
      for (const id of queue) {
        const other = await redisClient.hGetAll(userKey(id));
        if (other && other.status === 'waiting') {
          const otherSocket = io.sockets.get(other.socketId);
          if (otherSocket) {
            validQueue.push(id);
          } else {
            // Clean up disconnected user
            console.log(`[tryMatch] Cleaning up disconnected user ${id}`);
            await leaveQueue(id);
          }
        }
      }
      queue = validQueue;
    }
    
    console.log(`[tryMatch] Final valid candidates for user ${userId}:`, queue);
    
    if (!queue.length) {
      console.log(`[tryMatch] No valid candidates for user ${userId}`);
      return false;
    }
    
    let bestMatch = null;
    let minDiff = Infinity;
    const userRank = parseFloat(user.rank);
    const userJoin = parseInt(user.joinTime);
    
    for (const otherId of queue) {
      const other = await redisClient.hGetAll(userKey(otherId));
      console.log(`[tryMatch] Checking candidate:`, { otherId, status: other?.status, rank: other?.rank, joinTime: other?.joinTime });
      
      if (!other || other.status !== 'waiting') {
        console.log(`[tryMatch] Skipping candidate ${otherId} - invalid or not waiting`);
        continue;
      }
      
      const otherRank = parseFloat(other.rank);
      const otherJoin = parseInt(other.joinTime);
      const diff = Math.abs(userRank - otherRank);
      
      if (byRank) {
        if (diff < minDiff || (diff === minDiff && otherJoin < (bestMatch?.joinTime || Infinity))) {
          minDiff = diff;
          bestMatch = { ...other, userId: otherId, diff, joinTime: otherJoin };
          console.log(`[tryMatch] New bestMatch by rank:`, bestMatch);
        }
      } else {
        if (!bestMatch || otherJoin < bestMatch.joinTime) {
          bestMatch = { ...other, userId: otherId, joinTime: otherJoin };
          console.log(`[tryMatch] New bestMatch fallback:`, bestMatch);
        }
      }
    }
    
    if (!bestMatch) {
      console.log(`[tryMatch] No suitable match found for user ${userId}`);
      return false;
    }
    
    // Double-check socket connections before proceeding
    const matchSocket = io.sockets.get(bestMatch.socketId);
    if (!userSocket || !matchSocket) {
      console.log(`[tryMatch] Socket validation failed at match time. User: ${!!userSocket}, Match: ${!!matchSocket}`);
      
      // Clean up disconnected users
      if (!userSocket) await leaveQueue(userId);
      if (!matchSocket) await leaveQueue(bestMatch.userId);
      
      return false;
    }
    
    console.log(`[tryMatch] PROCEEDING WITH MATCH: ${userId} vs ${bestMatch.userId}`);
    
    // Remove both from queue atomically
    await redisClient.zRem(queueKey(variant), userId, bestMatch.userId);
    await redisClient.hSet(userKey(userId), { status: 'matched' });
    await redisClient.hSet(userKey(bestMatch.userId), { status: 'matched' });
    
    const cooldownUntil = Date.now() + REJOIN_COOLDOWN;
    await redisClient.set(cooldownKey(userId), cooldownUntil, { EX: REJOIN_COOLDOWN / 1000 });
    await redisClient.set(cooldownKey(bestMatch.userId), cooldownUntil, { EX: REJOIN_COOLDOWN / 1000 });
    
    console.log(`[tryMatch] userSocket:`, user.socketId, !!userSocket, 'matchSocket:', bestMatch.socketId, !!matchSocket);
    
    // Fetch user details for both users
    let userDoc, matchDoc;
    try {
      userDoc = await UserModel.findById(userId).select('_id name ratings');
      matchDoc = await UserModel.findById(bestMatch.userId).select('_id name ratings');
      console.log("Found both users")
    } catch (err) {
      console.error(`[tryMatch] Error fetching user details:`, err);
      userSocket.emit('queue:error', { message: 'Failed to fetch opponent details.' });
      matchSocket.emit('queue:error', { message: 'Failed to fetch opponent details.' });
      return false;
    }
    
    if (!userDoc || !matchDoc) {
      userSocket.emit('queue:error', { message: 'Opponent not found.' });
      matchSocket.emit('queue:error', { message: 'Opponent not found.' });
      console.error(`[tryMatch] User details not found for userId=${userId} or matchId=${bestMatch.userId}`);
      return false;
    }
    

    console.log(user.subvariant)
    const subvariant = user.subvariant; 

    console.log(userDoc.ratings?.classic?.[subvariant])
    const player1 = {
        userId: userDoc._id.toString(),
        username: userDoc.name,
        rating: variant === 'classic' ? userDoc.ratings?.classic?.[subvariant] : userDoc.ratings?.[getRatingField(variant)],
    }

    const player2 = {
        userId: matchDoc._id.toString(),
        username: matchDoc.name,
        rating: variant === 'classic' ? matchDoc.ratings?.classic?.[subvariant] : matchDoc.ratings?.[getRatingField(variant)],
    }
    const {sessionId, gameState} = await createGameSession(
      player1,
      player2,
      variant.toLowerCase(),
      subvariant,
    )
    console.log(`[tryMatch] Created game session: ${sessionId}, gameState:`, gameState);
    
    // Send session info with match notification
    userSocket.emit('queue:matched', { 
      opponent: { userId: matchDoc._id, name: matchDoc.name }, 
      variant,
      sessionId ,
      gameState,
      subvariant,
    });
    matchSocket.emit('queue:matched', { 
      opponent: { userId: userDoc._id, name: userDoc.name }, 
      variant,
      sessionId ,
      gameState,
      subvariant,
    });

    const updateGameModel = await gameModel.insertOne({
      sessionId,
      players: {
        white: gameState.players.white.userId,
        black: gameState.players.black.userId,
      },
      variant: variant.toLowerCase(),
      subvariant,
      startedAt: new Date(),
    }, { new: true });

    if (!updateGameModel) {
      console.error(`[tryMatch] Error updating game model for session ${sessionId}`);
      userSocket.emit('queue:error', { message: 'Failed to update game model.' });
      matchSocket.emit('queue:error', { message: 'Failed to update game model.' });
      return false;
    }
    
    console.log(`[Matched] Successfully matched user ${userId} with ${bestMatch.userId} in ${variant}`);
    
    // Clean up Redis data after successful match
    await redisClient.del(userKey(userId));
    await redisClient.del(userKey(bestMatch.userId));
    
    return true;
    
    
  } catch (err) {
    console.error(`[tryMatch] Error for user ${userId}:`, err);
    return false;
  }
}

/**
 * Remove user from queue (on disconnect or manual leave)
 */
export async function leaveQueue(userId) {
  try {
    const user = await redisClient.hGetAll(userKey(userId));
    if (!user) {
      console.log(`[leaveQueue] User ${userId} not found in Redis.`);
      return;
    }
    
    // Remove from queue regardless of status
    if (user.variant) {
      await redisClient.zRem(queueKey(user.variant), userId);
    }
    
    // Clean up user data
    await redisClient.del(userKey(userId));
    
    // Set cooldown only if they were actively waiting
    if (user.status === 'waiting') {
      const cooldownUntil = Date.now() + REJOIN_COOLDOWN;
      await redisClient.set(cooldownKey(userId), cooldownUntil, { EX: REJOIN_COOLDOWN / 1000 });
    }
    
    console.log(`[leaveQueue] User ${userId} removed from queue (was: ${user.status})`);
  } catch (err) {
    console.error(`[leaveQueue] Error for user ${userId}:`, err);
  }
}

/**
 * Handle socket disconnection
 */
export async function handleDisconnect(userId, socketId) {
  try {
    console.log(`[handleDisconnect] userId=${userId}, socketId=${socketId}`);
    
    const user = await redisClient.hGetAll(userKey(userId));
    if (user && user.socketId === socketId) {
      await leaveQueue(userId);
      console.log(`[handleDisconnect] Removed user ${userId} from queue due to disconnect`);
    }
  } catch (err) {
    console.error(`[handleDisconnect] Error for user ${userId}:`, err);
  }
}

/**
 * Periodic cleanup: remove idle users from queue
 */
export async function cleanupIdleUsers() {
  try {
    for (const variant of VARIANTS) {
      const queue = await redisClient.zRange(queueKey(variant), 0, -1);
      for (const userId of queue) {
        const user = await redisClient.hGetAll(userKey(userId));
        if (!user || user.status !== 'waiting') {
          await redisClient.zRem(queueKey(variant), userId);
          continue;
        }
        if (Date.now() - parseInt(user.joinTime) > IDLE_TIMEOUT) {
          await leaveQueue(userId);
          console.log(`[cleanupIdleUsers] Removed idle user ${userId} from ${variant}`);
        }
      }
    }
  } catch (err) {
    console.error(`[cleanupIdleUsers] Error:`, err);
  }
}

// Optionally, set up a periodic cleanup (call this from your main app)
setInterval(cleanupIdleUsers, 60 * 1000);