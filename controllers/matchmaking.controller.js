import { Server } from 'socket.io';
import UserModel from '../models/User.model.js';
import redisClient from '../config/redis.config.js';
import { createGameSession } from './session.controller.js';
// import gameModel from '../models/game.model.js'; // Commented out as per original code

// Import tournament controller functions
import {
    TOURNAMENT_QUEUE_KEY,
    TOURNAMENT_USER_DATA_KEY,
    getActiveTournamentDetails,
    leaveTournament, // We will use this to clean up tournament users if they get matched
} from './tournament.controller.js';

// Supported variants
const VARIANTS = ['crazyhouse', 'sixpointer', 'decay', 'classic'];

// Cooldown in ms
const REJOIN_COOLDOWN = 10 * 1000;
// Idle timeout in ms
const IDLE_TIMEOUT = 5 * 60 * 1000;
// Closest-rank window in ms
const RANK_WINDOW = 10 * 1000;

// Redis key helpers
const queueKey = (variant) => `queue:${variant}`;
const userKey = (userId) => `queueuser:${userId}`; // For regular queue users
const cooldownKey = (userId) => `cooldown:${userId}`;

// Helper: get rating field for variant
export function getRatingField(variant) { // Export this for use in tournament.controller.js
    switch (variant) {
        case 'crazyhouse': return 'crazyhouse';
        case 'sixpointer': return 'sixPoint';
        case 'decay': return 'decayChess';
        case 'classic': return 'classic';
        default: throw new Error('Unknown variant');
    }
}

// Helper: Centralized match initiation function
async function initiateMatch(player1Data, player2Data, player1Socket, player2Socket, io) {
    const { userId: userId1, variant, subvariant } = player1Data;
    const { userId: userId2 } = player2Data;

    console.log(`[initiateMatch] Initiating game between ${userId1} and ${userId2} for ${variant} ${subvariant}`);

    // Atomically remove both players from their respective queues
    // This logic needs to be careful: player1Data and player2Data can come from either
    // the regular queue (`queueuser:`) or the tournament queue (`tournament:{id}:user:`)
    const player1IsTournament = player1Data.tournamentId;
    const player2IsTournament = player2Data.tournamentId;

    if (player1IsTournament) {
        const activeTournament = await getActiveTournamentDetails();
        if (activeTournament) {
            await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userId1);
            await redisClient.del(TOURNAMENT_USER_DATA_KEY(activeTournament.id, userId1));
        }
    } else {
        await redisClient.zRem(queueKey(variant), userId1);
        await redisClient.del(userKey(userId1));
    }

    if (player2IsTournament) {
        const activeTournament = await getActiveTournamentDetails();
        if (activeTournament) {
            await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userId2);
            await redisClient.del(TOURNAMENT_USER_DATA_KEY(activeTournament.id, userId2));
        }
    } else {
        await redisClient.zRem(queueKey(variant), userId2);
        await redisClient.del(userKey(userId2));
    }

    await redisClient.set(cooldownKey(userId1), Date.now() + REJOIN_COOLDOWN, { EX: REJOIN_COOLDOWN / 1000 });
    await redisClient.set(cooldownKey(userId2), Date.now() + REJOIN_COOLDOWN, { EX: REJOIN_COOLDOWN / 1000 });

    // Fetch user details for both users
    let userDoc1, userDoc2;
    try {
        userDoc1 = await UserModel.findById(userId1).select('_id name ratings');
        userDoc2 = await UserModel.findById(userId2).select('_id name ratings');
    } catch (err) {
        console.error(`[initiateMatch] Error fetching user details:`, err);
        player1Socket.emit('queue:error', { message: 'Failed to fetch opponent details.' });
        player2Socket.emit('queue:error', { message: 'Failed to fetch opponent details.' });
        return;
    }

    if (!userDoc1 || !userDoc2) {
        player1Socket.emit('queue:error', { message: 'Opponent not found.' });
        player2Socket.emit('queue:error', { message: 'Opponent not found.' });
        console.error(`[initiateMatch] User details not found for userId1=${userId1} or userId2=${userId2}`);
        return;
    }

    const p1Rating = variant === 'classic' ? userDoc1.ratings?.classic?.[subvariant] : userDoc1.ratings?.[getRatingField(variant)];
    const p2Rating = variant === 'classic' ? userDoc2.ratings?.classic?.[subvariant] : userDoc2.ratings?.[getRatingField(variant)];

    const player1 = {
        userId: userDoc1._id.toString(),
        username: userDoc1.name,
        rating: p1Rating,
    };

    const player2 = {
        userId: userDoc2._id.toString(),
        username: userDoc2.name,
        rating: p2Rating,
    };

    const { sessionId, gameState } = await createGameSession(
        player1,
        player2,
        variant.toLowerCase(),
        subvariant,
    );

    console.log(`[initiateMatch] Created game session: ${sessionId}, gameState:`, gameState);

    player1Socket.emit('queue:matched', {
        opponent: { userId: userDoc2._id, name: userDoc2.name },
        variant,
        sessionId,
        gameState,
        subvariant,
        tournamentMatch: !!player1IsTournament // Indicate if this was a tournament match
    });
    player2Socket.emit('queue:matched', {
        opponent: { userId: userDoc1._id, name: userDoc1.name },
        variant,
        sessionId,
        gameState,
        subvariant,
        tournamentMatch: !!player2IsTournament // Indicate if this was a tournament match
    });

    console.log(`[Matched] Successfully matched user ${userId1} with ${userId2} in ${variant}`);
}


/**
 * Add user to matchmaking queue (sorted set by rank, with join time as tiebreaker)
 * This function is for non-tournament players choosing a specific variant.
 * @param {Object} params - { userId, socketId, rank, variant, subvariant }
 * @param {Server} io - Socket.IO server instance
 */
export async function joinQueue({ userId, socketId, variant, subvariant, io }) {
    try {
        console.log(`[joinQueue] userId=${userId}, socketId=${socketId}, variant=${variant}, subvariant=${subvariant}`);

        // Check cooldown
        const cooldown = await redisClient.get(cooldownKey(userId));
        if (cooldown && Date.now() < parseInt(cooldown)) {
            console.log(`[joinQueue] User ${userId} is on cooldown until ${cooldown}`);
            io.to(socketId).emit('queue:cooldown', { until: parseInt(cooldown) });
            return;
        }

        // Clean up any existing queue data for this user first from regular queues
        await cleanupUserFromAllQueues(userId);
        // Also ensure they are not in the tournament queue if they explicitly join a regular queue
        const activeTournament = await getActiveTournamentDetails();
        if (activeTournament) {
            const tournamentUser = await redisClient.hGetAll(TOURNAMENT_USER_DATA_KEY(activeTournament.id, userId));
            if (tournamentUser && tournamentUser.status === 'waiting') {
                await leaveTournament(userId, activeTournament.id);
            }
        }


        const userDoc = await UserModel.findById(userId);
        if (!userDoc) {
            console.error(`[joinQueue] User not found: ${userId}`);
            io.to(socketId).emit('queue:error', { message: 'User not found.' });
            return;
        }

        let rank;
        let ratingField;
        if (variant === 'classic') {
            if (!subvariant || (subvariant !== 'blitz' && subvariant !== 'bullet' && subvariant !== 'standard')) {
                console.error(`[joinQueue] Invalid or missing subvariant for Classic: ${subvariant}`);
                io.to(socketId).emit('queue:error', { message: 'Invalid or missing subvariant for Classic (must be blitz, bullet, or standard).' });
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
            const matchFound = await tryMatchRegularUser(userId, variant, io, true); // This is for regular users matching with other regular users
            if (!matchFound) {
                setTimeout(async () => {
                    try {
                        await tryMatchRegularUser(userId, variant, io, false);
                    } catch (err) {
                        console.error(`[joinQueue] Error in tryMatchRegularUser (fallback) for user ${userId}:`, err);
                    }
                }, RANK_WINDOW);
            }
        } catch (err) {
            console.error(`[joinQueue] Error in tryMatchRegularUser (byRank) for user ${userId}:`, err);
        }
    } catch (err) {
        console.error(`[joinQueue] Unexpected error:`, err);
        io.to(socketId).emit('queue:error', { message: 'Internal server error.' });
    }
}

/**
 * Clean up user from all REGULAR queues (helper function)
 * EXPORTED for use in tournament controller if needed.
 */
export async function cleanupUserFromAllQueues(userId) {
    try {
        for (const variant of VARIANTS) {
            await redisClient.zRem(queueKey(variant), userId);
        }
        await redisClient.del(userKey(userId));
        console.log(`[cleanupUserFromAllQueues] Cleaned up user ${userId} from all regular queues`);
    } catch (err) {
        console.error(`[cleanupUserFromAllQueues] Error cleaning up user ${userId}:`, err);
    }
}

/**
 * Try to match a regular queue user.
 * This function is solely for matching regular queue users among themselves,
 * OR for matching them against tournament users.
 * @param {string} userId
 * @param {string} variant
 * @param {Server} io
 * @param {boolean} byRank - true: closest rank, false: fallback random
 * @returns {boolean} - true if match was found and completed, false otherwise
 */
async function tryMatchRegularUser(userId, variant, io, byRank) {
    console.log(`[tryMatchRegularUser] userId=${userId}, variant=${variant}, byRank=${byRank}`);
    const user = await redisClient.hGetAll(userKey(userId));
    if (!user || user.status !== 'waiting') {
        console.log(`[tryMatchRegularUser] User ${userId} not in waiting state. Status: ${user?.status}`);
        return false;
    }

    const userSocket = io.sockets.get(user.socketId);
    if (!userSocket) {
        console.log(`[tryMatchRegularUser] User ${userId} socket ${user.socketId} is disconnected, removing from queue`);
        await leaveQueue(userId);
        return false;
    }

    // --- Search in Regular Queue First ---
    let queue;
    if (byRank) {
        const userRank = parseFloat(user.rank);
        let range = 100;
        const queueSize = await redisClient.zCard(queueKey(variant));
        if (queueSize > 1000) range = 50;
        if (Date.now() - parseInt(user.joinTime) > 5000) range *= 2;
        queue = await redisClient.zRangeByScore(queueKey(variant), userRank - range, userRank + range);
    } else {
        queue = await redisClient.zRange(queueKey(variant), 0, -1);
    }

    queue = queue.filter((id) => id !== userId); // Filter out self

    let validRegularCandidates = [];
    for (const id of queue) {
        const other = await redisClient.hGetAll(userKey(id));
        if (other && other.status === 'waiting') {
            if (variant === 'classic' && other.subvariant !== user.subvariant) {
                continue; // Classic variant requires subvariant match
            }
            const otherSocket = io.sockets.get(other.socketId);
            if (otherSocket) {
                validRegularCandidates.push(id);
            } else {
                console.log(`[tryMatchRegularUser] Cleaning up disconnected user ${id}`);
                await leaveQueue(id);
            }
        }
    }
    console.log(`[tryMatchRegularUser] Valid regular candidates for ${userId}:`, validRegularCandidates);

    if (validRegularCandidates.length > 0) {
        let bestMatch = null;
        let minDiff = Infinity;
        const userRank = parseFloat(user.rank);
        const userJoin = parseInt(user.joinTime);

        for (const otherId of validRegularCandidates) {
            const other = await redisClient.hGetAll(userKey(otherId));
            const otherRank = parseFloat(other.rank);
            const otherJoin = parseInt(other.joinTime);
            const diff = Math.abs(userRank - otherRank);

            if (byRank) {
                if (diff < minDiff || (diff === minDiff && otherJoin < (bestMatch?.joinTime || Infinity))) {
                    minDiff = diff;
                    bestMatch = { ...other, userId: otherId, diff, joinTime: otherJoin };
                }
            } else {
                if (!bestMatch || otherJoin < bestMatch.joinTime) {
                    bestMatch = { ...other, userId: otherId, joinTime: otherJoin };
                }
            }
        }
        if (bestMatch) {
            console.log(`[tryMatchRegularUser] Found regular queue match: ${userId} vs ${bestMatch.userId}`);
            await initiateMatch(user, bestMatch, userSocket, io.sockets.get(bestMatch.socketId), io);
            return true;
        }
    }

    // --- Fallback: Search in Tournament Queue for this variant if no regular match found ---
    console.log(`[tryMatchRegularUser] No regular match for ${userId}, checking tournament queue for ${user.variant} ${user.subvariant}`);
    const activeTournament = await getActiveTournamentDetails();
    if (activeTournament) {
        const tournamentId = activeTournament.id;
        let tournamentCandidates = await redisClient.zRange(TOURNAMENT_QUEUE_KEY, 0, -1);

        for (const candidateId of tournamentCandidates) {
            const candidate = await redisClient.hGetAll(TOURNAMENT_USER_DATA_KEY(tournamentId, candidateId));
            if (candidate && candidate.status === 'waiting' && candidate.variant === user.variant) {
                if (user.variant === 'classic' && candidate.subvariant !== user.subvariant) {
                    continue; // Classic variant requires subvariant match
                }
                const candidateSocket = io.sockets.get(candidate.socketId);
                if (candidateSocket) {
                    // Found a match with a tournament player!
                    console.log(`[tryMatchRegularUser] Found cross-queue match: ${userId} (regular) vs ${candidateId} (tournament)`);
                    await initiateMatch(user, candidate, userSocket, candidateSocket, io);
                    return true;
                } else {
                    console.log(`[tryMatchRegularUser] Cleaning up disconnected tournament user ${candidateId}`);
                    await leaveTournament(candidateId, tournamentId);
                }
            }
        }
    }

    console.log(`[tryMatchRegularUser] No match found for regular user ${userId}`);
    return false;
}

/**
 * Remove user from queue (on disconnect or manual leave)
 * EXPORTED for use by socket handlers.
 */
export async function leaveQueue(userId) {
    try {
        const user = await redisClient.hGetAll(userKey(userId));
        if (!user) {
            console.log(`[leaveQueue] User ${userId} not found in regular Redis queue.`);
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

        console.log(`[leaveQueue] User ${userId} removed from regular queue (was: ${user.status})`);
    } catch (err) {
        console.error(`[leaveQueue] Error for user ${userId}:`, err);
    }
}

/**
 * Handle socket disconnection for users in regular queues.
 * EXPORTED for use by socket handlers.
 */
export async function handleDisconnect(userId, socketId) {
    try {
        console.log(`[handleDisconnect] userId=${userId}, socketId=${socketId}`);

        // Check if user is in a regular queue
        const userInRegularQueue = await redisClient.hGetAll(userKey(userId));
        if (userInRegularQueue && userInRegularQueue.socketId === socketId) {
            await leaveQueue(userId);
            console.log(`[handleDisconnect] Removed user ${userId} from regular queue due to disconnect`);
        }

        // Also check if user is in tournament queue
        const activeTournament = await getActiveTournamentDetails();
        if (activeTournament) {
            const tournamentId = activeTournament.id;
            const userInTournamentQueue = await redisClient.hGetAll(TOURNAMENT_USER_DATA_KEY(tournamentId, userId));
            if (userInTournamentQueue && userInTournamentQueue.socketId === socketId) {
                await leaveTournament(userId, tournamentId); // Use tournament specific leave
                console.log(`[handleDisconnect] Removed user ${userId} from tournament queue due to disconnect`);
            }
        }

    } catch (err) {
        console.error(`[handleDisconnect] Error for user ${userId}:`, err);
    }
}


/**
 * Periodic cleanup: remove idle users from REGULAR queue
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
                    console.log(`[cleanupIdleUsers] Removed idle user ${userId} from ${variant} (regular queue)`);
                }
            }
        }
    } catch (err) {
        console.error(`[cleanupIdleUsers] Error:`, err);
    }
}

// Optionally, set up a periodic cleanup (call this from your main app)
setInterval(cleanupIdleUsers, 60 * 1000);