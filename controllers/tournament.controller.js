import redisClient from '../config/redis.config.js';
import { leaveQueue } from './matchmaking.controller.js'; // Import existing matchmaking functions
import { createGameSession } from './session.controller.js'; // Import createGameSession
import UserModel from '../models/User.model.js';
// NEW IMPORTS for flexible fallback
import { REGULAR_QUEUE_KEYS_BY_VARIANT, REGULAR_USER_DATA_KEY } from './matchmaking.controller.js';

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
const VARIANTS = ['crazyhouse', 'sixpointer', 'decay', 'classic'];

/**
 * Helper: Get a random variant and subvariant (duplicate from matchmaking.js for self-containment, or export from there)
 * This is used when a user *initially* joins a tournament queue.
 */
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

        // Only add to queue, do NOT assign variant/subvariant yet
        let rank = 1200;
        if (userDoc.ratings && typeof userDoc.ratings === 'object') {
            // Use any rating field you want, or keep default
        }

        const now = Date.now();
        const score = parseFloat(rank) + (now / 1e13);

        await redisClient.hSet(TOURNAMENT_USER_DATA_KEY(tournamentId, userId), {
            userId,
            socketId,
            rank: rank.toString(),
            joinTime: now.toString(),
            status: 'waiting',
            tournamentId,
        });

        await redisClient.zAdd(TOURNAMENT_QUEUE_KEY, [{ score, value: userId }]);
        console.log(`[addTournamentUserToQueue] User ${userId} added to tournament queue (no variant assigned yet)`);

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
 * 1. The tournament queue (other tournament participants) for the assigned variant.
 * 2. ANY regular variant queue as a fallback.
 * @param {string} userId - The tournament user to match
 * @param {Server} io - Socket.IO server instance
 * @returns {boolean} - true if match was found and completed, false otherwise
 */
export async function tryMatchTournamentUser(userId, io) {
    console.log(`[tryMatchTournamentUser] Attempting to match userId=${userId}`);

    const activeTournament = await getActiveTournamentDetails();
    if (!activeTournament) {
        console.log(`[tryMatchTournamentUser] No active tournament. Removing user ${userId} from tournament queue.`);
        await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userId);
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
        console.log(`[tryMatchTournamentUser] User ${userId}'s socket ${user.socketId} is disconnected, removing from tournament queue`);
        await leaveTournament(userId, tournamentId);
        return false;
    }

    const userVariant = user.variant;
    const userSubvariant = user.subvariant;
    const userRank = parseFloat(user.rank);

    // --- 1. Search in Tournament Queue First (Same Variant) ---
    console.log(`[tryMatchTournamentUser] Searching for opponent for ${userId} in tournament queue for ${userVariant} ${userSubvariant}.`);
    let tournamentCandidates = await redisClient.zRange(TOURNAMENT_QUEUE_KEY, 0, -1, { REV: true, BY: 'score' });
    tournamentCandidates = tournamentCandidates.filter(id => id !== userId); // Exclude self

    for (const candidateId of tournamentCandidates) {
        const candidate = await redisClient.hGetAll(TOURNAMENT_USER_DATA_KEY(tournamentId, candidateId));
        if (candidate && candidate.status === 'waiting' && candidate.tournamentId === tournamentId) {
            const candidateSocket = io.sockets.get(candidate.socketId);
            if (candidateSocket) {
                // Assign random variant/subvariant for this match
                const { variant, subvariant } = getRandomVariantAndSubvariant();
                // Update both users' data
                await redisClient.hSet(TOURNAMENT_USER_DATA_KEY(tournamentId, userId), { variant, subvariant });
                await redisClient.hSet(TOURNAMENT_USER_DATA_KEY(tournamentId, candidateId), { variant, subvariant });
                // Pass variant/subvariant to initiateMatch
                await initiateMatch(
                    { ...user, variant, subvariant },
                    { ...candidate, variant, subvariant },
                    userSocket,
                    candidateSocket,
                    io,
                    false
                );
                return true;
            } else {
                await leaveTournament(candidateId, tournamentId);
            }
        }
    }

    // --- 2. Fallback to Regular Variant Queues (Any Variant) ---
    console.log(`[tryMatchTournamentUser] No tournament match for ${userId}, falling back to any regular queue.`);

    // Get all distinct regular queue keys
    const allRegularQueueKeys = Object.values(REGULAR_QUEUE_KEYS_BY_VARIANT);

    for (const regularQueueKey of allRegularQueueKeys) {
        if (!regularQueueKey) continue; // Skip if key is somehow empty

        console.log(`[tryMatchTournamentUser] Checking regular queue: ${regularQueueKey}`);
        let regularCandidates = await redisClient.zRange(regularQueueKey, 0, -1, { REV: true, BY: 'score' });
        regularCandidates = regularCandidates.filter(id => id !== userId); // Exclude self

        for (const candidateId of regularCandidates) {
            const candidate = await redisClient.hGetAll(REGULAR_USER_DATA_KEY(candidateId));
            if (candidate && candidate.status === 'waiting') {
                const candidateSocket = io.sockets.get(candidate.socketId);
                if (candidateSocket) {
                    // Found a match with a regular queue player!
                    console.log(`[tryMatchTournamentUser] Found cross-queue match: ${userId} (T:${userVariant} ${userSubvariant}) vs ${candidateId} (R:${candidate.variant} ${candidate.subvariant})`);

                    // Use the regular candidate's variant and subvariant for the game
                    await initiateMatch(
                        user,          // Tournament user (player1)
                        candidate,     // Regular user (player2)
                        userSocket,
                        candidateSocket,
                        io,
                        true           // isCrossQueueMatch: true
                    );
                    return true;
                } else {
                    console.log(`[tryMatchTournamentUser] Cleaning up disconnected regular user ${candidateId}`);
                    await leaveQueue(candidateId); // Use leaveQueue from matchmaking.js
                }
            }
        }
    }

    console.log(`[tryMatchTournamentUser] No match found for user ${userId} after checking both queues.`);
    return false;
}

/**
 * Centralized function to initiate a match between two players (tournament or regular).
 * @param {Object} player1Data - User data from Redis (the user who initiated the match attempt, typically the tournament user here)
 * @param {Object} player2Data - User data from Redis (the found opponent)
 * @param {Socket} player1Socket
 * @param {Socket} player2Socket
 * @param {Server} io
 * @param {boolean} isCrossQueueMatch - True if player2 is from a regular queue
 */
async function initiateMatch(player1Data, player2Data, player1Socket, player2Socket, io, isCrossQueueMatch = false) {
    // When a tournament player matches with a regular queue player,
    // the game's variant and subvariant will be determined by the regular player's (player2Data) variant.
    // Otherwise, it uses player1Data's variant (tournament to tournament match).

    const { userId: userId1 } = player1Data;
    const { userId: userId2 } = player2Data;

    let gameVariant;
    let gameSubvariant;

    if (isCrossQueueMatch) {
        // If it's a cross-queue match, the game variant is dictated by the regular player (player2)
        gameVariant = player2Data.variant;
        gameSubvariant = player2Data.subvariant;
        console.log(`[initiateMatch] Cross-queue match. Game variant will be: ${gameVariant} ${gameSubvariant}`);
    } else {
        // If both are tournament players (or both regular, though this function focuses on tournament player1),
        // the game variant is taken from player1's assigned tournament variant.
        gameVariant = player1Data.variant;
        gameSubvariant = player1Data.subvariant;
        console.log(`[initiateMatch] Tournament match. Game variant will be: ${gameVariant} ${gameSubvariant}`);
    }


    console.log(`[initiateMatch] Initiating game between ${userId1} and ${userId2} for ${gameVariant} ${gameSubvariant}`);

    // Atomically remove both players from their respective queues
    // This logic needs to be robust for both tournament and regular players.
    // player1 is always the tournament user for this function's entry point.
    await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userId1);
    await redisClient.del(TOURNAMENT_USER_DATA_KEY(player1Data.tournamentId, userId1)); // Clear tournament user data

    if (isCrossQueueMatch) {
        // player2 is from a regular queue
        const player2QueueKey = player2Data.variant === 'classic' ? `queue:classic:${player2Data.subvariant}` : `queue:${player2Data.variant}`;
        await redisClient.zRem(player2QueueKey, userId2);
        await redisClient.del(REGULAR_USER_DATA_KEY(userId2)); // Clear regular user data
    } else {
        // player2 is also a tournament player
        await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userId2);
        await redisClient.del(TOURNAMENT_USER_DATA_KEY(player2Data.tournamentId, userId2)); // Clear tournament user data
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

    // Determine the rating to use for each player based on the *gameVariant*
    const player1Rating = userDoc1.ratings
    const player2Rating = userDoc2.ratings

    const player1 = {
        userId: userDoc1._id.toString(),
        username: userDoc1.name,
        rating: player1Rating || 1200, // Default if not found
    };

    const player2 = {
        userId: userDoc2._id.toString(),
        username: userDoc2.name,
        rating: player2Rating || 1200, // Default if not found
    };

    // Create game session using the determined gameVariant and gameSubvariant
    const { sessionId, gameState } = await createGameSession(
        player1,
        player2,
        gameVariant.toLowerCase(),
        gameSubvariant.toLowerCase(),
        'tournament'
    );

    console.log(`[initiateMatch] Created game session: ${sessionId}`);

    player1Socket.emit('queue:matched', {
        opponent: { userId: userDoc2._id, name: userDoc2.name },
        variant: gameVariant,
        sessionId,
        gameState,
        subvariant: gameSubvariant,
        tournamentMatch: !isCrossQueueMatch // Indicate if this was a *pure* tournament match
    });
    player2Socket.emit('queue:matched', {
        opponent: { userId: userDoc1._id, name: userDoc1.name },
        variant: gameVariant,
        sessionId,
        gameState,
        subvariant: gameSubvariant,
        tournamentMatch: !isCrossQueueMatch // Indicate if this was a *pure* tournament match
    });

    console.log(`[Matched] Successfully matched user ${userId1} with ${userId2} in ${gameVariant} (Cross-queue: ${isCrossQueueMatch})`);
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
            console.log(`[handleTournamentDisconnect] No active tournament. Attempting to remove from general tournament queue.`);
            await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userId);
            return;
        }

        const tournamentId = activeTournament.id;
        // Check if the user is in the tournament's specific data AND if the socketId matches
        const user = await redisClient.hGetAll(TOURNAMENT_USER_DATA_KEY(tournamentId, userId));
        if (user && user.socketId === socketId) {
            await leaveTournament(userId, tournamentId);
            console.log(`[handleTournamentDisconnect] Removed user ${userId} from tournament queue due to disconnect`);
        } else {
             console.log(`[handleTournamentDisconnect] User ${userId} not in tournament queue with this socketId, or socketId mismatch.`);
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