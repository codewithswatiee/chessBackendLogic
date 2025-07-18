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

// --- NEW EXPORTS FOR TOURNAMENT CONTROLLER ---
// Define and export these here for use in tournament.controller.js
export const REGULAR_QUEUE_KEYS_BY_VARIANT = {
    'crazyhouse': 'queue:crazyhouse',
    'sixpointer': 'queue:sixpointer',
    'decay': 'queue:decay',
    'classic:blitz': 'queue:classic:blitz',
    'classic:bullet': 'queue:classic:bullet',
    'classic:standard': 'queue:classic:standard',
};
export const REGULAR_USER_DATA_KEY = (userId) => `queueuser:${userId}`;
// --- END NEW EXPORTS ---


// Supported variants
const VARIANTS = ['crazyhouse', 'sixpointer', 'decay', 'classic'];

// Cooldown in ms
const REJOIN_COOLDOWN = 10 * 1000;
// Idle timeout in ms
const IDLE_TIMEOUT = 5 * 60 * 1000;
// Closest-rank window in ms
const RANK_WINDOW = 10 * 1000;

// Redis key helpers
// const queueKey = (variant) => { // This helper is no longer needed
//     return REGULAR_QUEUE_KEYS_BY_VARIANT[variant] || `queue:${variant}`;
// };
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

/**
 * Helper: Centralized match initiation function
 * This function is now more robust to determine the game variant and clean up queues.
 * @param {Object} player1Data - User data from Redis (can be regular or tournament)
 * @param {Object} player2Data - User data from Redis (can be regular or tournament)
 * @param {Socket} player1Socket
 * @param {Socket} player2Socket
 * @param {Server} io
 */
async function initiateMatch(player1Data, player2Data, player1Socket, player2Socket, io) {
    const { userId: userId1 } = player1Data;
    const { userId: userId2 } = player2Data;

    // Determine if player1 or player2 is from a tournament queue
    const player1IsTournament = !!player1Data.tournamentId;
    const player2IsTournament = !!player2Data.tournamentId;

    // --- Determine the game variant and subvariant ---
    // If one player is tournament and the other is regular, the game variant should align with the regular player's queue.
    // If both are regular, it uses player1's. If both are tournament, it uses player1's (tournament rules).
    let gameVariant;
    let gameSubvariant;

    if (player1IsTournament && !player2IsTournament) {
        // Tournament player matched with regular player -> use regular player's variant
        gameVariant = player2Data.variant;
        gameSubvariant = player2Data.subvariant;
        console.log(`[initiateMatch] Cross-queue match (T vs R). Game variant: ${gameVariant} ${gameSubvariant}`);
    } else if (!player1IsTournament && player2IsTournament) {
        // Regular player matched with tournament player -> use regular player's variant
        gameVariant = player1Data.variant; // Player1 is the regular player here
        gameSubvariant = player1Data.subvariant;
        console.log(`[initiateMatch] Cross-queue match (R vs T). Game variant: ${gameVariant} ${gameSubvariant}`);
    } else {
        // Both are regular OR both are tournament -> use player1's variant
        gameVariant = player1Data.variant;
        gameSubvariant = player1Data.subvariant;
        console.log(`[initiateMatch] Same-queue match. Game variant: ${gameVariant} ${gameSubvariant}`);
    }

    console.log(`[initiateMatch] Initiating game between ${userId1} and ${userId2} for ${gameVariant} ${gameSubvariant}`);

    // --- Atomically remove both players from their respective queues ---
    const cleanupPlayer = async (userData, isTournament) => {
        if (isTournament) {
            const activeTournament = await getActiveTournamentDetails(); // Need to fetch again for safety
            if (activeTournament && userData.tournamentId === activeTournament.id) {
                await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userData.userId);
                await redisClient.del(TOURNAMENT_USER_DATA_KEY(activeTournament.id, userData.userId));
            } else {
                // If tournament data is stale or tournament ended, just try to remove from general tournament queue
                await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userData.userId);
            }
        } else {
            // Use REGULAR_QUEUE_KEYS_BY_VARIANT to get the correct queue key
            const specificQueueKey = userData.variant === 'classic' ? REGULAR_QUEUE_KEYS_BY_VARIANT[`classic:${userData.subvariant}`] : REGULAR_QUEUE_KEYS_BY_VARIANT[userData.variant];
            if (specificQueueKey) {
                 await redisClient.zRem(specificQueueKey, userData.userId);
            } else {
                console.warn(`[cleanupPlayer] Could not determine specific regular queue key for user ${userData.userId}, variant ${userData.variant}, subvariant ${userData.subvariant}.`);
            }
            await redisClient.del(userKey(userData.userId));
        }
        console.log(`[initiateMatch] Cleaned up ${userData.userId} from ${isTournament ? 'tournament' : 'regular'} queue.`);
    };

    await cleanupPlayer(player1Data, player1IsTournament);
    await cleanupPlayer(player2Data, player2IsTournament);


    // Apply cooldown
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

    // Get ratings based on the determined gameVariant
    const p1Rating = gameVariant === 'classic' && gameSubvariant ? userDoc1.ratings?.classic?.[gameSubvariant] : userDoc1.ratings?.[getRatingField(gameVariant)];
    const p2Rating = gameVariant === 'classic' && gameSubvariant ? userDoc2.ratings?.classic?.[gameSubvariant] : userDoc2.ratings?.[getRatingField(gameVariant)];


    const player1 = {
        userId: userDoc1._id.toString(),
        username: userDoc1.name,
        rating: p1Rating || 1200, // Default if rating is undefined
    };

    const player2 = {
        userId: userDoc2._id.toString(),
        username: userDoc2.name,
        rating: p2Rating || 1200, // Default if rating is undefined
    };

    const { sessionId, gameState } = await createGameSession(
        player1,
        player2,
        gameVariant.toLowerCase(),
        gameSubvariant,
    );

    console.log(`[initiateMatch] Created game session: ${sessionId}`);

    player1Socket.emit('queue:matched', {
        opponent: { userId: userDoc2._id, name: userDoc2.name },
        variant: gameVariant,
        sessionId,
        gameState,
        subvariant: gameSubvariant,
        tournamentMatch: player1IsTournament && player2IsTournament // Only true if both are tournament players
    });
    player2Socket.emit('queue:matched', {
        opponent: { userId: userDoc1._id, name: userDoc1.name },
        variant: gameVariant,
        sessionId,
        gameState,
        subvariant: gameSubvariant,
        tournamentMatch: player1IsTournament && player2IsTournament // Only true if both are tournament players
    });

    console.log(`[Matched] Successfully matched user ${userId1} with ${userId2} in ${gameVariant} (P1 is T: ${player1IsTournament}, P2 is T: ${player2IsTournament})`);
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
        // This function already iterates through VARIANTS which implies all regular queues.
        await cleanupUserFromAllQueues(userId);

        // Also ensure they are not in the tournament queue if they explicitly join a regular queue
        const activeTournament = await getActiveTournamentDetails();
        if (activeTournament) {
            const tournamentUser = await redisClient.hGetAll(TOURNAMENT_USER_DATA_KEY(activeTournament.id, userId));
            if (tournamentUser && tournamentUser.status === 'waiting') {
                console.log(`[joinQueue] User ${userId} was in tournament queue, removing before joining regular queue.`);
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
            // If classic rank is undefined, use default 1200
            if (rank === undefined || rank === null) {
                rank = 1200;
                console.warn(`[joinQueue] No rank for user ${userId} in Classic ${subvariant}, using default ${rank}`);
            }
            ratingField = `classic.${subvariant}`;
        } else {
            ratingField = getRatingField(variant);
            rank = userDoc.ratings?.[ratingField];
            // If variant rank is undefined, use default 1200
            if (rank === undefined || rank === null) {
                rank = 1200;
                console.warn(`[joinQueue] No rank for user ${userId} in variant ${variant}, using default ${rank}`);
            }
        }

        const now = Date.now();
        const score = parseFloat(rank) + (now / 1e13); // Ensure rank is float for score calculation

        await redisClient.hSet(userKey(userId), {
            userId,
            socketId,
            rank: rank.toString(), // Store as string
            variant,
            subvariant: subvariant || '',
            joinTime: now.toString(), // Store as string
            status: 'waiting',
        });

        // Use the full queue key from REGULAR_QUEUE_KEYS_BY_VARIANT for zAdd
        const fullQueueKey = variant === 'classic' ? REGULAR_QUEUE_KEYS_BY_VARIANT[`classic:${subvariant}`] : REGULAR_QUEUE_KEYS_BY_VARIANT[variant];
        if (!fullQueueKey) {
            console.error(`[joinQueue] Could not determine Redis queue key for variant: ${variant}, subvariant: ${subvariant}`);
            io.to(socketId).emit('queue:error', { message: 'Failed to join queue: invalid variant/subvariant.' });
            return;
        }
        await redisClient.zAdd(fullQueueKey, [{ score, value: userId }]);
        console.log(`[joinQueue] User ${userId} added to regular queue ${fullQueueKey} with rank ${rank}`);

        // Try to match immediately when user joins
        try {
            const matchFound = await tryMatchRegularUser(userId, variant, io, true); // This is for regular users matching with other regular users
            if (!matchFound) {
                // If no immediate rank-based match, try a broader search after a delay
                setTimeout(async () => {
                    try {
                        await tryMatchRegularUser(userId, variant, io, false); // Broader search
                    } catch (err) {
                        console.error(`[joinQueue] Error in tryMatchRegularUser (fallback) for user ${userId}:`, err);
                    }
                }, RANK_WINDOW);
            }
        } catch (err) {
            console.error(`[joinQueue] Error in tryMatchRegularUser (initial) for user ${userId}:`, err);
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
        // Iterate through all possible regular queue keys defined.
        for (const key of Object.values(REGULAR_QUEUE_KEYS_BY_VARIANT)) {
            await redisClient.zRem(key, userId);
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
 * @param {string} variant - The variant the user is looking for (their preferred variant)
 * @param {Server} io
 * @param {boolean} byRank - true: closest rank, false: fallback random (broader search)
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

    // --- 1. Search in Regular Queue (Same Variant/Subvariant) ---
    // Use the specific queue key for the user's preferred variant/subvariant
    const specificRegularQueueKey = user.variant === 'classic' ? REGULAR_QUEUE_KEYS_BY_VARIANT[`classic:${user.subvariant}`] : REGULAR_QUEUE_KEYS_BY_VARIANT[user.variant];

    if (!specificRegularQueueKey) {
        console.error(`[tryMatchRegularUser] Invalid specific regular queue key for variant: ${user.variant}, subvariant: ${user.subvariant}`);
        return false;
    }

    let queueCandidates;
    if (byRank) {
        const userRank = parseFloat(user.rank);
        let range = 100;
        const queueSize = await redisClient.zCard(specificRegularQueueKey);
        if (queueSize > 1000) range = 50; // Smaller range for larger queues
        if (Date.now() - parseInt(user.joinTime) > 5000) range *= 2; // Expand range over time
        queueCandidates = await redisClient.zRangeByScore(specificRegularQueueKey, userRank - range, userRank + range);
    } else {
        // If not by rank (i.e., broader search), just get all in this queue
        queueCandidates = await redisClient.zRange(specificRegularQueueKey, 0, -1);
    }

    queueCandidates = queueCandidates.filter((id) => id !== userId); // Filter out self

    let validRegularCandidates = [];
    for (const id of queueCandidates) {
        const other = await redisClient.hGetAll(userKey(id));
        if (other && other.status === 'waiting') {
            // Crucial: for regular-to-regular matches, always match exact variant and subvariant
            // This implicitly filters for classic subvariants as well because specificRegularQueueKey already targets it.
            if (other.variant === user.variant && other.subvariant === user.subvariant) {
                const otherSocket = io.sockets.get(other.socketId);
                if (otherSocket) {
                    validRegularCandidates.push(other); // Push the full data object for easier access
                } else {
                    console.log(`[tryMatchRegularUser] Cleaning up disconnected user ${id}`);
                    await leaveQueue(id);
                }
            }
        }
    }
    console.log(`[tryMatchRegularUser] Found ${validRegularCandidates.length} valid regular candidates for ${userId} in its specific queue.`);


    if (validRegularCandidates.length > 0) {
        let bestMatch = null;
        let minDiff = Infinity;
        const userRank = parseFloat(user.rank);

        for (const other of validRegularCandidates) {
            const otherRank = parseFloat(other.rank);
            const otherJoin = parseInt(other.joinTime);
            const diff = Math.abs(userRank - otherRank);

            if (byRank) {
                if (diff < minDiff || (diff === minDiff && otherJoin < (bestMatch?.joinTime || Infinity))) {
                    minDiff = diff;
                    bestMatch = { ...other, diff, joinTime: otherJoin };
                }
            } else { // Broader search, prioritize oldest join time
                if (!bestMatch || otherJoin < bestMatch.joinTime) {
                    bestMatch = { ...other, joinTime: otherJoin };
                }
            }
        }

        if (bestMatch) {
            console.log(`[tryMatchRegularUser] Found regular queue match: ${userId} vs ${bestMatch.userId}`);
            await initiateMatch(user, bestMatch, userSocket, io.sockets.get(bestMatch.socketId), io);
            return true;
        }
    }

    // --- 2. Fallback: Search in Tournament Queue for this regular user's variant/subvariant ---
    // A regular user only falls back to the tournament queue if the tournament explicitly matches their variant.
    console.log(`[tryMatchRegularUser] No regular-to-regular match for ${userId}, checking tournament queue for ${user.variant} ${user.subvariant}`);
    const activeTournament = await getActiveTournamentDetails();
    if (activeTournament) {
        const tournamentId = activeTournament.id;
        // Fetch users from the tournament queue (could be optimized with ZRANGEBYSCORE by rank if needed)
        let tournamentCandidates = await redisClient.zRange(TOURNAMENT_QUEUE_KEY, 0, -1);

        for (const candidateId of tournamentCandidates) {
            const candidate = await redisClient.hGetAll(TOURNAMENT_USER_DATA_KEY(tournamentId, candidateId));
            if (candidate && candidate.status === 'waiting' && candidate.tournamentId === tournamentId) {
                // For cross-queue matches (regular user matching tournament user),
                // ensure the tournament user's assigned game variant matches the regular user's desired variant.
                if (candidate.variant === user.variant && candidate.subvariant === user.subvariant) {
                    const candidateSocket = io.sockets.get(candidate.socketId);
                    if (candidateSocket) {
                        // Found a match with a tournament player!
                        console.log(`[tryMatchRegularUser] Found cross-queue match: ${userId} (regular, ${user.variant} ${user.subvariant}) vs ${candidateId} (tournament, ${candidate.variant} ${candidate.subvariant})`);
                        await initiateMatch(user, candidate, userSocket, candidateSocket, io); // Regular user (P1) vs Tournament user (P2)
                        return true;
                    } else {
                        console.log(`[tryMatchRegularUser] Cleaning up disconnected tournament user ${candidateId}`);
                        await leaveTournament(candidateId, tournamentId);
                    }
                }
            }
        }
    }

    console.log(`[tryMatchRegularUser] No match found for regular user ${userId} after checking both queues.`);
    return false;
}

/**
 * Remove user from queue (on disconnect or manual leave)
 * EXPORTED for use by socket handlers and other controllers.
 */
export async function leaveQueue(userId) {
    try {
        const user = await redisClient.hGetAll(userKey(userId));
        if (!user) {
            console.log(`[leaveQueue] User ${userId} not found in regular Redis queue data.`);
            // Attempt to remove from all regular queues just in case inconsistent state
            await cleanupUserFromAllQueues(userId);
            return;
        }

        // Remove from the specific queue they were in
        const specificQueueKey = user.variant === 'classic' ? REGULAR_QUEUE_KEYS_BY_VARIANT[`classic:${user.subvariant}`] : REGULAR_QUEUE_KEYS_BY_VARIANT[user.variant];
        if (specificQueueKey) {
            await redisClient.zRem(specificQueueKey, userId);
            console.log(`[leaveQueue] User ${userId} removed from regular queue: ${specificQueueKey}.`);
        } else {
            console.warn(`[leaveQueue] Could not determine specific queue key for user ${userId}. Attempting general cleanup.`);
        }

        // Clean up user data
        await redisClient.del(userKey(userId));

        // Set cooldown only if they were actively waiting (not if already matched/disconnected)
        if (user.status === 'waiting') {
            const cooldownUntil = Date.now() + REJOIN_COOLDOWN;
            await redisClient.set(cooldownKey(userId), cooldownUntil, { EX: REJOIN_COOLDOWN / 1000 });
        }

        console.log(`[leaveQueue] User ${userId} cleanup completed (was: ${user.status}).`);
    } catch (err) {
        console.error(`[leaveQueue] Error for user ${userId}:`, err);
    }
}

/**
 * Handle socket disconnection for users in regular queues and tournament queues.
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
        } else {
            console.log(`[handleDisconnect] User ${userId} not found in regular queue with matching socketId, or already removed.`);
        }

        // Also check if user is in tournament queue
        const activeTournament = await getActiveTournamentDetails();
        if (activeTournament) {
            const tournamentId = activeTournament.id;
            const userInTournamentQueue = await redisClient.hGetAll(TOURNAMENT_USER_DATA_KEY(tournamentId, userId));
            if (userInTournamentQueue && userInTournamentQueue.socketId === socketId) {
                await leaveTournament(userId, tournamentId); // Use tournament specific leave
                console.log(`[handleDisconnect] Removed user ${userId} from tournament queue due to disconnect`);
            } else {
                 console.log(`[handleDisconnect] User ${userId} not found in tournament queue with matching socketId, or already removed.`);
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
        // Iterate through all actual queue keys, not just variants, to catch classic subvariants
        for (const queueKeyString of Object.values(REGULAR_QUEUE_KEYS_BY_VARIANT)) {
            const queue = await redisClient.zRange(queueKeyString, 0, -1);
            for (const userId of queue) {
                const user = await redisClient.hGetAll(userKey(userId));
                if (!user || user.status !== 'waiting') {
                    // If user data is missing or not in waiting, remove from queue
                    await redisClient.zRem(queueKeyString, userId);
                    continue;
                }
                if (Date.now() - parseInt(user.joinTime) > IDLE_TIMEOUT) {
                    await leaveQueue(userId); // Use the unified leaveQueue
                    console.log(`[cleanupIdleUsers] Removed idle user ${userId} from ${queueKeyString} (regular queue)`);
                }
            }
        }
    } catch (err) {
        console.error(`[cleanupIdleUsers] Error:`, err);
    }
}

// Optionally, set up a periodic cleanup (call this from your main app)
setInterval(cleanupIdleUsers, 60 * 1000);