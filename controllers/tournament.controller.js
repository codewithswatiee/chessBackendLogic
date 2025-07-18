import redisClient from '../config/redis.config.js';
import { leaveQueue } from './matchmaking.controller.js'; // Import existing matchmaking functions
import { createGameSession } from './session.controller.js'; // Import createGameSession
import UserModel from '../models/User.model.js';

// Constants for tournament management
const TOURNAMENT_ID_COUNTER_KEY = 'tournament:id_counter';
const TOURNAMENT_ACTIVE_KEY = 'tournament:active';
const TOURNAMENT_DETAILS_KEY = (tournamentId) => `tournament:${tournamentId}:details`;
const TOURNAMENT_PARTICIPANTS_KEY = (tournamentId) => `tournament:${tournamentId}:participants`;
export const TOURNAMENT_QUEUE_KEY = 'tournament:queue'; // Central queue for all tournament players
export const TOURNAMENT_USER_DATA_KEY = (tournamentId, userId) => `tournament:${tournamentId}:user:${userId}`;

// Constants for game flow (ideally imported from a central config)
const REJOIN_COOLDOWN = 10 * 1000; // 10 seconds
const COOLDOWN_KEY = (uid) => `cooldown:${uid}`;
const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Supported variants (mirror from matchmaking.js or import if needed)
const VARIANTS = ['crazyhouse', 'sixpointer', 'decay', 'classic']; // This constant isn't currently used in the provided code but good to keep.

// Helper: Get a random variant and subvariant (duplicate from matchmaking.js for self-containment, or export from there)
function getRandomVariantAndSubvariant() {
    const variantsWithSubvariants = [
        { variant: 'crazyhouse', subvariants: [] },
        { variant: 'sixpointer', subvariants: [] },
        { variant: 'decay', subvariants: [] },
        { variant: 'classic', subvariants: ['blitz', 'bullet', 'standard'] }
    ];

    const randomVariantIndex = Math.floor(Math.random() * variantsWithSubvariants.length);
    const selectedVariant = variantsWithSubvariants[randomVariantIndex];

    const variant = selectedVariant.variant;
    let subvariant = '';

    if (selectedVariant.subvariants.length > 0) {
        const randomSubvariantIndex = Math.floor(Math.random() * selectedVariant.subvariants.length);
        subvariant = selectedVariant.subvariants[randomSubvariantIndex];
    }

    return { variant, subvariant };
}

/**
 * Helper to get rating field for a given variant.
 * @param {string} variant
 * @returns {string} The corresponding rating field name in the user model.
 */
function getRatingField(variant) {
    switch (variant) {
        case 'crazyhouse': return 'crazyhouse';
        case 'sixpointer': return 'sixPoint';
        case 'decay': return 'decayChess';
        case 'classic': return 'classic';
        default: throw new Error('Unknown variant');
    }
}

/**
 * Creates a new tournament.
 * @param {Object} params - { name, capacity, startTime, duration, entryFee, prizePool }
 * @returns {string} The new tournament ID.
 */
export async function createTournament({ name, capacity = 200, startTime = Date.now(), duration = 60 * 60 * 1000, entryFee = 0, prizePool = 0 }) {
    const tournamentId = await redisClient.incr(TOURNAMENT_ID_COUNTER_KEY);
    const tournamentDetails = {
        id: tournamentId.toString(),
        name,
        capacity: capacity.toString(), // Store as string to be consistent with hSet
        startTime: startTime.toString(),
        duration: duration.toString(),
        entryFee: entryFee.toString(),
        prizePool: prizePool.toString(),
        status: 'open', // 'open', 'in-progress', 'finished'
        participantsCount: '0',
        createdAt: Date.now().toString()
    };

    // Store tournament details
    await redisClient.hSet(TOURNAMENT_DETAILS_KEY(tournamentId), tournamentDetails);
    // Set this as the active tournament (you might want more sophisticated active tournament management)
    await redisClient.set(TOURNAMENT_ACTIVE_KEY, tournamentId.toString());

    console.log(`[createTournament] Created tournament ${tournamentId}:`, tournamentDetails);
    return tournamentId.toString();
}

/**
 * Gets details of the currently active tournament.
 * @returns {Object|null} Tournament details or null if no active tournament.
 */
export async function getActiveTournamentDetails() {
    const activeTournamentId = await redisClient.get(TOURNAMENT_ACTIVE_KEY);
    if (!activeTournamentId) {
        return null;
    }
    const details = await redisClient.hGetAll(TOURNAMENT_DETAILS_KEY(activeTournamentId));
    if (Object.keys(details).length === 0) { // Check if the hash is empty
        await redisClient.del(TOURNAMENT_ACTIVE_KEY); // Clean up stale active tournament
        return null;
    }
    // Convert stringified numbers back to numbers
    details.capacity = parseInt(details.capacity);
    details.startTime = parseInt(details.startTime);
    details.duration = parseInt(details.duration);
    details.entryFee = parseFloat(details.entryFee);
    details.prizePool = parseFloat(details.prizePool);
    details.participantsCount = parseInt(details.participantsCount);
    details.createdAt = parseInt(details.createdAt);
    return details;
}

/**
 * User joins the active tournament.
 * @param {Object} params - { userId, socketId, io }
 */
export async function joinTournament({ userId, socketId, io }) {
    try {
        console.log(`[joinTournament] userId=${userId}, socketId=${socketId}`);

        let activeTournament = await getActiveTournamentDetails();

        // If no active tournament, create one
        if (!activeTournament) {
            console.log("[joinTournament] No active tournament found, creating a new default tournament.");
            const newTournamentId = await createTournament({
                name: "Instant Chess Tournament",
                capacity: 100, // Default capacity for automatically created tournaments
                duration: 2 * 60 * 60 * 1000, // 2 hours duration
                entryFee: 0, // Free entry
                prizePool: 0, // No prize pool for instant tournaments
                startTime: Date.now() // Start now
            });
            activeTournament = await getActiveTournamentDetails(); // Fetch the details of the newly created tournament
            if (!activeTournament) {
                io.to(socketId).emit('tournament:error', { message: 'Failed to create a new tournament.' });
                return;
            }
            // Notify all connected clients about the new active tournament
            io.emit('tournament:new_active', { tournamentId: activeTournament.id, name: activeTournament.name });
            console.log(`[joinTournament] New tournament '${activeTournament.name}' (${activeTournament.id}) created and set as active.`);
        }

        // Check if the tournament is open for registration (should always be for newly created, but good to keep)
        if (activeTournament.status !== 'open') {
            io.to(socketId).emit('tournament:error', { message: 'Tournament is not open for registration.' });
            return;
        }

        const tournamentId = activeTournament.id;

        // Check if user is already in the tournament (participant count is updated by join, this checks active participation)
        const isMember = await redisClient.sIsMember(TOURNAMENT_PARTICIPANTS_KEY(tournamentId), userId);
        if (isMember) {
            console.log(`[joinTournament] User ${userId} already registered for tournament ${tournamentId}. Re-adding to queue for next game.`);
            // Just ensure they are in the tournament queue with a random variant for their next game
            await addTournamentUserToQueue(userId, socketId, tournamentId, io);
            io.to(socketId).emit('tournament:joined', { tournament: activeTournament, status: 'already_joined' });
            return;
        }

        // Check capacity
        const currentParticipants = await redisClient.sCard(TOURNAMENT_PARTICIPANTS_KEY(tournamentId));
        if (currentParticipants >= activeTournament.capacity) {
            io.to(socketId).emit('tournament:error', { message: 'Tournament is full.' });
            return;
        }

        // Add user to tournament participants set
        await redisClient.sAdd(TOURNAMENT_PARTICIPANTS_KEY(tournamentId), userId);
        await redisClient.hIncrBy(TOURNAMENT_DETAILS_KEY(tournamentId), 'participantsCount', 1);

        console.log(`[joinTournament] User ${userId} joined tournament ${tournamentId}.`);

        // Now, add them to the general tournament queue with a randomly assigned variant
        await addTournamentUserToQueue(userId, socketId, tournamentId, io);

        io.to(socketId).emit('tournament:joined', { tournament: activeTournament, status: 'newly_joined' });

    } catch (err) {
        console.error(`[joinTournament] Error for user ${userId}:`, err);
        io.to(socketId).emit('tournament:error', { message: 'Internal server error while joining tournament.' });
    }
}

/**
 * Adds a tournament participant to the general tournament matchmaking queue
 * with a randomly assigned variant for their next game.
 * @param {string} userId
 * @param {string} socketId
 * @param {string} tournamentId
 * @param {Server} io
 */
export async function addTournamentUserToQueue(userId, socketId, tournamentId, io) {
    try {
        const userDoc = await UserModel.findById(userId);
        if (!userDoc) {
            console.error(`[addTournamentUserToQueue] User not found: ${userId}`);
            io.to(socketId).emit('queue:error', { message: 'User not found.' });
            return;
        }

        // Check if user is already in the queue for this tournament's game.
        const existingQueueEntry = await redisClient.hGetAll(TOURNAMENT_USER_DATA_KEY(tournamentId, userId));
        if (existingQueueEntry && existingQueueEntry.status === 'waiting') {
            console.log(`[addTournamentUserToQueue] User ${userId} already in tournament queue for tournament ${tournamentId}.`);
            await tryMatchTournamentUser(userId, io);
            return;
        }


        // Randomly choose a variant and subvariant for this game
        const { variant, subvariant } = getRandomVariantAndSubvariant();
        console.log(`[addTournamentUserToQueue] User ${userId} assigned variant: ${variant}, subvariant: ${subvariant}`);

        let rank;
        const ratingField = getRatingField(variant);
        if (variant === 'classic' && subvariant) {
            rank = userDoc.ratings?.classic?.[subvariant];
        } else {
            rank = userDoc.ratings?.[ratingField];
        }

        if (rank === undefined || rank === null) {
            rank = 1200; // Default ELO
            console.warn(`[addTournamentUserToQueue] No rank for user ${userId} in variant ${variant}, using default ${rank}`);
        }

        const now = Date.now();
        const score = parseFloat(rank) + (now / 1e13); // Rank as primary sort, join time as tiebreaker

        // Store user's current tournament game details
        await redisClient.hSet(TOURNAMENT_USER_DATA_KEY(tournamentId, userId), {
            userId,
            socketId,
            rank: rank.toString(), // Store as string
            variant,
            subvariant: subvariant || '',
            joinTime: now.toString(), // Store as string
            status: 'waiting',
            tournamentId, // Mark this user as being in a tournament
        });

        // Add to the common tournament queue
        await redisClient.zAdd(TOURNAMENT_QUEUE_KEY, [{ score, value: userId }]);
        console.log(`[addTournamentUserToQueue] User ${userId} added to tournament queue (variant: ${variant}, rank: ${rank})`);

        // Try to match immediately
        try {
            await tryMatchTournamentUser(userId, io);
        } catch (err) {
            console.error(`[addTournamentUserToQueue] Error in tryMatchTournamentUser for user ${userId}:`, err);
        }

    } catch (err) {
        console.error(`[addTournamentUserToQueue] Unexpected error adding tournament user ${userId} to queue:`, err);
        io.to(socketId).emit('tournament:error', { message: 'Internal server error adding to tournament queue.' });
    }
}

/**
 * Remove user from tournament (e.g., if they leave or disconnect).
 * This will also remove them from the tournament queue.
 * @param {string} userId
 * @param {string} tournamentId
 */
export async function leaveTournament(userId, tournamentId) {
    try {
        console.log(`[leaveTournament] userId=${userId}, tournamentId=${tournamentId}`);
        // Remove from tournament participants set
        await redisClient.sRem(TOURNAMENT_PARTICIPANTS_KEY(tournamentId), userId);
        // Only decrement participant count if user was actually in the set
        const decremented = await redisClient.hIncrBy(TOURNAMENT_DETAILS_KEY(tournamentId), 'participantsCount', -1);
        if (decremented < 0) { // Ensure count doesn't go negative
             await redisClient.hSet(TOURNAMENT_DETAILS_KEY(tournamentId), 'participantsCount', '0');
        }

        // Remove from general tournament queue
        await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userId);

        // Remove tournament user data
        await redisClient.del(TOURNAMENT_USER_DATA_KEY(tournamentId, userId));

        console.log(`[leaveTournament] User ${userId} left tournament ${tournamentId}`);
    } catch (err) {
        console.error(`[leaveTournament] Error for user ${userId} in tournament ${tournamentId}:`, err);
    }
}

/**
 * Try to match a tournament user. This function will look for opponents in:
 * 1. The tournament queue (other tournament participants)
 * 2. Regular variant-specific queues (players playing that specific variant)
 * @param {string} userId - The tournament user to match
 * @param {Server} io - Socket.IO server instance
 * @returns {boolean} - true if match was found and completed, false otherwise
 */
export async function tryMatchTournamentUser(userId, io) {
    console.log(`[tryMatchTournamentUser] userId=${userId}`);

    const activeTournament = await getActiveTournamentDetails();
    if (!activeTournament) {
        // If there's no active tournament, the user is likely in the queue from a previous tournament.
        // We should try to find their tournamentId from their user data to clean up.
        // This is a more robust way to handle cleanup for users who might be in the queue
        // but their tournament has ended or become inactive.
        console.log(`[tryMatchTournamentUser] No active tournament. Attempting to find and clear user's specific tournament data.`);
        // Assuming TOURNAMENT_USER_DATA_KEY stores the tournamentId.
        // You might need a more general lookup if you have multiple tournaments.
        // For simplicity, if no active tournament, we'll try to find any tournament data for the user
        // that might be lingering.
        // This part needs careful consideration based on your Redis key structure.
        // If TOURNAMENT_USER_DATA_KEY depends on `tournamentId`, you can't get it without knowing the ID.
        // A better approach would be to store the `currentTournamentId` directly on the user's general queue data,
        // or have a global `user:active_tournament:${userId}` key.

        // For now, if activeTournament is null, we can't properly use leaveTournament,
        // so we'll just remove from the global queue if they are there.
        await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userId);
        // We might also need to delete any `TOURNAMENT_USER_DATA_KEY` if it exists for *any* tournament.
        // This would require a SCAN command or a predefined knowledge of the tournament ID the user was in.
        // For this scenario, assuming they would have left properly or the data cleans up eventually.
        return false;
    }

    const tournamentId = activeTournament.id;
    const user = await redisClient.hGetAll(TOURNAMENT_USER_DATA_KEY(tournamentId, userId));

    if (!user || user.status !== 'waiting') {
        console.log(`[tryMatchTournamentUser] User ${userId} not in waiting state for tournament ${tournamentId}. Status: ${user?.status}`);
        return false;
    }

    const userSocket = io.sockets.get(user.socketId);
    if (!userSocket) {
        console.log(`[tryMatchTournamentUser] User ${userId} socket ${user.socketId} is disconnected, removing from tournament queue`);
        await leaveTournament(userId, tournamentId); // Now passing correct tournamentId
        return false;
    }

    const userVariant = user.variant;
    const userSubvariant = user.subvariant;
    const userRank = parseFloat(user.rank);
    // const userJoinTime = parseInt(user.joinTime); // Not directly used for matching, but useful for debugging/sorting

    // --- Search in Tournament Queue First ---
    console.log(`[tryMatchTournamentUser] Searching for opponent for ${userId} in tournament queue for ${userVariant} ${userSubvariant}.`);
    // Get all users from the tournament queue, sorted by score (rank + joinTime)
    let tournamentCandidates = await redisClient.zRange(TOURNAMENT_QUEUE_KEY, 0, -1, { REV: true, BY: 'score' }); // Start with higher ranks
    tournamentCandidates = tournamentCandidates.filter(id => id !== userId); // Exclude self

    for (const candidateId of tournamentCandidates) {
        const candidate = await redisClient.hGetAll(TOURNAMENT_USER_DATA_KEY(tournamentId, candidateId));
        // Ensure candidate is waiting, is for the same tournament, and matches variant/subvariant
        if (candidate && candidate.status === 'waiting' &&
            candidate.tournamentId === tournamentId && // Crucial check for correct tournament
            candidate.variant === userVariant && candidate.subvariant === userSubvariant) {

            const candidateSocket = io.sockets.get(candidate.socketId);
            if (candidateSocket) {
                // Found a match within the tournament queue!
                console.log(`[tryMatchTournamentUser] Found tournament match: ${userId} vs ${candidateId}`);
                await initiateMatch(user, candidate, userSocket, candidateSocket, io);
                return true;
            } else {
                console.log(`[tryMatchTournamentUser] Cleaning up disconnected tournament user ${candidateId}`);
                await leaveTournament(candidateId, tournamentId);
            }
        }
    }

    // --- Fallback to Regular Variant Queue if no tournament match found ---
    console.log(`[tryMatchTournamentUser] No tournament match for ${userId}, falling back to regular queue for ${userVariant} ${userSubvariant}.`);
    const regularQueueKey = userVariant === 'classic' ? `queue:classic` : `queue:${userVariant}`;
    // Fetch candidates from the specific regular queue
    let regularCandidates = await redisClient.zRange(regularQueueKey, 0, -1, { REV: true, BY: 'score' }); // Start with higher ranks
    regularCandidates = regularCandidates.filter(id => id !== userId); // Exclude self

    for (const candidateId of regularCandidates) {
        // Assuming `queueuser:${candidateId}` is the key for regular queue users
        const candidate = await redisClient.hGetAll(`queueuser:${candidateId}`);
        if (candidate && candidate.status === 'waiting' && candidate.variant === userVariant) {
            // For 'classic', ensure subvariant matches
            if (userVariant === 'classic' && candidate.subvariant !== userSubvariant) {
                continue; // Skip if subvariant doesn't match for classic
            }
            const candidateSocket = io.sockets.get(candidate.socketId);
            if (candidateSocket) {
                // Found a match with a regular queue player!
                console.log(`[tryMatchTournamentUser] Found cross-queue match: ${userId} (tournament) vs ${candidateId} (regular)`);
                await initiateMatch(user, candidate, userSocket, candidateSocket, io, true); // Pass true to indicate cross-queue
                return true;
            } else {
                console.log(`[tryMatchTournamentUser] Cleaning up disconnected regular user ${candidateId}`);
                await leaveQueue(candidateId); // Use leaveQueue from matchmaking.js
            }
        }
    }

    console.log(`[tryMatchTournamentUser] No match found for user ${userId} after checking both queues.`);
    return false;
}

/**
 * Centralized function to initiate a match between two players (tournament or regular).
 * @param {Object} player1Data - User data from Redis (tournament user or regular user)
 * @param {Object} player2Data - User data from Redis (tournament user or regular user)
 * @param {Socket} player1Socket
 * @param {Socket} player2Socket
 * @param {Server} io
 * @param {boolean} isCrossQueueMatch - True if player2 is from a regular queue
 */
async function initiateMatch(player1Data, player2Data, player1Socket, player2Socket, io, isCrossQueueMatch = false) {
    const { userId: userId1, variant, subvariant } = player1Data;
    const { userId: userId2 } = player2Data;

    console.log(`[initiateMatch] Initiating game between ${userId1} and ${userId2} for ${variant} ${subvariant}`);

    // Atomically remove both players from their respective queues
    await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userId1); // Always remove player1 from tournament queue
    if (isCrossQueueMatch) {
        // Remove player2 from their regular queue
        const player2QueueKey = player2Data.variant === 'classic' ? `queue:classic` : `queue:${player2Data.variant}`;
        await redisClient.zRem(player2QueueKey, userId2);
    } else {
        // If both are tournament players, remove player2 from tournament queue
        await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userId2);
    }

    // Set status to 'matched' in their respective Redis user data
    if (player1Data.tournamentId) {
        await redisClient.hSet(TOURNAMENT_USER_DATA_KEY(player1Data.tournamentId, userId1), { status: 'matched' });
    } else {
        await redisClient.hSet(`queueuser:${userId1}`, { status: 'matched' });
    }

    if (player2Data.tournamentId) {
        await redisClient.hSet(TOURNAMENT_USER_DATA_KEY(player2Data.tournamentId, userId2), { status: 'matched' });
    } else {
        await redisClient.hSet(`queueuser:${userId2}`, { status: 'matched' });
    }

    // Apply cooldown
    const cooldownUntil1 = Date.now() + REJOIN_COOLDOWN;
    const cooldownUntil2 = Date.now() + REJOIN_COOLDOWN;
    await redisClient.set(COOLDOWN_KEY(userId1), cooldownUntil1, { EX: REJOIN_COOLDOWN / 1000 });
    await redisClient.set(COOLDOWN_KEY(userId2), cooldownUntil2, { EX: REJOIN_COOLDOWN / 1000 });

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

    const player1 = {
        userId: userDoc1._id.toString(),
        username: userDoc1.name,
        rating: variant === 'classic' && subvariant ? userDoc1.ratings?.classic?.[subvariant] : userDoc1.ratings?.[getRatingField(variant)],
    };

    const player2 = {
        userId: userDoc2._id.toString(),
        username: userDoc2.name,
        rating: variant === 'classic' && subvariant ? userDoc2.ratings?.classic?.[subvariant] : userDoc2.ratings?.[getRatingField(variant)],
    };

    // Create game session
    const { sessionId, gameState } = await createGameSession(
        player1,
        player2,
        variant.toLowerCase(),
        subvariant.toLowerCase(),
    );

    console.log(`[initiateMatch] Created game session: ${sessionId}`);

    player1Socket.emit('queue:matched', {
        opponent: { userId: userDoc2._id, name: userDoc2.name },
        variant,
        sessionId,
        gameState,
        subvariant,
        tournamentMatch: !!player1Data.tournamentId // Indicate if this was a tournament match
    });
    player2Socket.emit('queue:matched', {
        opponent: { userId: userDoc1._id, name: userDoc1.name },
        variant,
        sessionId,
        gameState,
        subvariant,
        tournamentMatch: !!player2Data.tournamentId // Indicate if this was a tournament match
    });

    console.log(`[Matched] Successfully matched user ${userId1} with ${userId2} in ${variant} (Tournament: ${!!player1Data.tournamentId})`);

    // Clean up Redis user data after successful match
    // This is done after emitting to ensure data is available during the match setup
    if (player1Data.tournamentId) {
        await redisClient.del(TOURNAMENT_USER_DATA_KEY(player1Data.tournamentId, userId1));
    } else {
        await redisClient.del(`queueuser:${userId1}`);
    }

    if (player2Data.tournamentId) {
        await redisClient.del(TOURNAMENT_USER_DATA_KEY(player2Data.tournamentId, userId2));
    } else {
        await redisClient.del(`queueuser:${userId2}`);
    }
}

/**
 * Handle disconnect for tournament users.
 * @param {string} userId
 * @param {string} socketId
 */
export async function handleTournamentDisconnect(userId, socketId) {
    try {
        console.log(`[handleTournamentDisconnect] userId=${userId}, socketId=${socketId}`);
        const activeTournament = await getActiveTournamentDetails();
        if (!activeTournament) {
            // If no active tournament, try to find any tournament data for the user.
            // This is a more complex cleanup scenario, potentially requiring scanning keys
            // if TOURNAMENT_USER_DATA_KEY is purely dependent on tournamentId.
            // For now, if there's no active tournament, we'll try a best-effort removal from
            // the main queue if they somehow ended up there.
            // A more robust solution for global cleanup would involve storing the user's
            // current tournamentId in a general user-specific key (e.g., `user:${userId}:current_tournament`).
            console.log(`[handleTournamentDisconnect] No active tournament. Attempting to remove from general tournament queue.`);
            await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userId);
            // Optionally, try to guess the tournament ID or iterate through a few recent ones
            // to delete TOURNAMENT_USER_DATA_KEY. This is beyond the scope of a simple fix.
            return;
        }

        const tournamentId = activeTournament.id;
        const user = await redisClient.hGetAll(TOURNAMENT_USER_DATA_KEY(tournamentId, userId));
        if (user && user.socketId === socketId) {
            await leaveTournament(userId, tournamentId);
            console.log(`[handleTournamentDisconnect] Removed user ${userId} from tournament queue due to disconnect`);
        }
    } catch (err) {
        console.error(`[handleTournamentDisconnect] Error for user ${userId}:`, err);
    }
}

/**
 * Periodic cleanup for idle tournament users.
 */
export async function cleanupIdleTournamentUsers() {
    try {
        const activeTournament = await getActiveTournamentDetails();
        if (!activeTournament) return;

        const tournamentId = activeTournament.id;
        // Fetch users from the queue. Consider fetching a manageable chunk if queue is very large.
        const queueUserIds = await redisClient.zRange(TOURNAMENT_QUEUE_KEY, 0, -1);

        for (const userId of queueUserIds) {
            const user = await redisClient.hGetAll(TOURNAMENT_USER_DATA_KEY(tournamentId, userId));
            if (!user || user.status !== 'waiting') {
                // If user data is missing or not in waiting, remove from queue
                await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userId);
                continue;
            }
            // Check if their last activity (joinTime in queue) exceeds the idle timeout
            if (Date.now() - parseInt(user.joinTime) > IDLE_TIMEOUT) {
                await leaveTournament(userId, tournamentId);
                console.log(`[cleanupIdleTournamentUsers] Removed idle tournament user ${userId} from tournament ${tournamentId}`);
            }
        }
    } catch (err) {
        console.error(`[cleanupIdleTournamentUsers] Error:`, err);
    }
}

// Set up periodic cleanup for tournament users
setInterval(cleanupIdleTournamentUsers, 60 * 1000);