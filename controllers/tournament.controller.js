import redisClient from '../config/redis.config.js';
import { leaveQueue } from './matchmaking.controller.js'; // Import existing matchmaking functions
import { createGameSession } from './session.controller.js'; // Import createGameSession
import UserModel from '../models/User.model.js';
import TournamentModel from '../models/tournament.model.js'; // Import Tournament model
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
        { 
            variant: 'crazyhouse', 
            subvariants: ['standard', 'withTimer']  // Added Crazyhouse subvariants
        },
        { 
            variant: 'sixpointer', 
            subvariants: [] 
        },
        { 
            variant: 'decay', 
            subvariants: [] 
        },
        { 
            variant: 'classic', 
            subvariants: ['blitz', 'bullet', 'standard'] 
        }
    ];

    const randomVariantIndex = Math.floor(Math.random() * variantsWithSubvariants.length);
    const selectedVariant = variantsWithSubvariants[randomVariantIndex];

    const variant = selectedVariant.variant;
    let subvariant = '';

    // If the variant has subvariants, randomly select one
    if (selectedVariant.subvariants.length > 0) {
        const randomSubvariantIndex = Math.floor(Math.random() * selectedVariant.subvariants.length);
        subvariant = selectedVariant.subvariants[randomSubvariantIndex];
    }

    console.log(`[getRandomVariantAndSubvariant] Selected ${variant}${subvariant ? `:${subvariant}` : ''}`);
    return { variant, subvariant };
}

/**
 * Creates a new tournament.
 * @param {Object} params - { name, capacity, startTime, duration, entryFee, prizePool }
 * @returns {string} The new tournament ID.
 */
export async function createTournament({ name, capacity = 200, startTime, endTime }) {
    try {
        // Create tournament in MongoDB
        const tournament = new TournamentModel({
            name,
            capacity,
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            status: 'scheduled',
            leaderboard: [],
            matches: []
        });

        await tournament.save();
        console.log(`[createTournament] Created tournament ${tournament._id} starting at ${startTime}`);

        // Store tournament details in Redis for matchmaking
        const tournamentId = tournament._id.toString();
        await redisClient.hSet(TOURNAMENT_DETAILS_KEY(tournamentId), {
            id: tournamentId,
            name,
            capacity: capacity.toString(),
            startTime: startTime.toString(),
            endTime: endTime.toString(),
            status: 'scheduled',
            participantsCount: '0'
        });

        // If tournament should be active now, update both MongoDB and Redis
        const now = new Date();
        if (now >= tournament.startTime) {
            await Promise.all([
                TournamentModel.findByIdAndUpdate(tournamentId, { status: 'active' }),
                redisClient.hSet(TOURNAMENT_DETAILS_KEY(tournamentId), 'status', 'active'),
                redisClient.set(TOURNAMENT_ACTIVE_KEY, tournamentId)
            ]);
        }

        return tournamentId;
    } catch (error) {
        console.error('[createTournament] Error:', error);
        throw error;
    }
}

/**
 * Gets details of the currently active tournament.
 * @returns {Object|null} Tournament details or null if no active tournament.
 */
export async function getActiveTournamentDetails() {
    try {
        // Get active tournament from MongoDB
        const now = new Date();
        const activeTournament = await TournamentModel.findOne({
            startTime: { $lte: now },
            endTime: { $gte: now },
            status: { $in: ['scheduled', 'active'] }
        });

        if (activeTournament) {
            // Ensure Redis has the tournament details
            const tournamentId = activeTournament._id.toString();
            const redisDetails = await redisClient.hGetAll(TOURNAMENT_DETAILS_KEY(tournamentId));
            
            if (!redisDetails.id) {
                // Sync tournament details to Redis if missing
                await redisClient.hSet(TOURNAMENT_DETAILS_KEY(tournamentId), {
                    id: tournamentId,
                    name: activeTournament.name,
                    capacity: activeTournament.capacity.toString(),
                    startTime: activeTournament.startTime.toString(),
                    endTime: activeTournament.endTime.toString(),
                    status: activeTournament.status,
                    participantsCount: activeTournament.leaderboard.length.toString()
                });
                await redisClient.set(TOURNAMENT_ACTIVE_KEY, tournamentId);
            }
        }

        return activeTournament;
    } catch (error) {
        console.error('[getActiveTournamentDetails] Error:', error);
        return null;
    }
}

/**
 * User joins the active tournament.
 * @param {Object} params - { userId, socketId, io }
 */
export async function joinTournament({ userId, socketId, io }) {
    try {
        const activeTournament = await getActiveTournamentDetails();
        
        if (!activeTournament) {
            io.to(socketId).emit('tournament:error', { 
                message: 'No active tournament available. Tournaments run from 9 AM to 9 PM daily.' 
            });
            return;
        }

        const tournamentId = activeTournament._id.toString();

        // Check Redis participant count first (faster)
        const participantsCount = await redisClient.hGet(TOURNAMENT_DETAILS_KEY(tournamentId), 'participantsCount');
        if (parseInt(participantsCount) >= activeTournament.capacity) {
            io.to(socketId).emit('tournament:error', { message: 'Tournament is full.' });
            return;
        }

        // Add to MongoDB leaderboard
        const updateResult = await TournamentModel.findByIdAndUpdate(
            tournamentId,
            {
                $addToSet: {
                    leaderboard: {
                        player: userId,
                        currentStreak: 0,
                        wins: 0
                    }
                }
            },
            { new: true }
        );

        // If successfully added to MongoDB, update Redis
        if (updateResult) {
            await Promise.all([
                redisClient.sAdd(TOURNAMENT_PARTICIPANTS_KEY(tournamentId), userId),
                redisClient.hIncrBy(TOURNAMENT_DETAILS_KEY(tournamentId), 'participantsCount', 1),
                addTournamentUserToQueue(userId, socketId, tournamentId, io)
            ]);
        }

        io.to(socketId).emit('tournament:joined', { 
            tournament: activeTournament,
            status: 'newly_joined'
        });

    } catch (err) {
        console.error(`[joinTournament] Error for user ${userId}:`, err);
        io.to(socketId).emit('tournament:error', { 
            message: 'Internal server error while joining tournament.' 
        });
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

        // Assign random variant/subvariant immediately when joining tournament queue
        const { variant, subvariant } = getRandomVariantAndSubvariant();

        let rank = 1200;
        if (userDoc.ratings && typeof userDoc.ratings === 'object') {
            rank = userDoc.ratings;
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
            variant,           // Assign variant immediately
            subvariant         // Assign subvariant immediately
        });

        await redisClient.zAdd(TOURNAMENT_QUEUE_KEY, [{ score, value: userId }]);
        console.log(`[addTournamentUserToQueue] User ${userId} added to tournament queue with variant: ${variant}${subvariant ? `:${subvariant}` : ''}`);

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

    const tournamentId = activeTournament._id.toString();
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
    console.log(`[tryMatchTournamentUser] Tournament user ${userId} has variant: ${userVariant}${userSubvariant ? `:${userSubvariant}` : ''}`);

    // --- 1. Search in Tournament Queue First (Any Variant) ---
    console.log(`[tryMatchTournamentUser] Searching for opponent in tournament queue`);
    let tournamentCandidates = await redisClient.zRange(TOURNAMENT_QUEUE_KEY, 0, -1, { REV: true, BY: 'score' });
    tournamentCandidates = tournamentCandidates.filter(id => id !== userId);

    for (const candidateId of tournamentCandidates) {
        const candidate = await redisClient.hGetAll(TOURNAMENT_USER_DATA_KEY(tournamentId, candidateId));
        if (candidate && candidate.status === 'waiting' && candidate.tournamentId === tournamentId) {
            const candidateSocket = io.sockets.get(candidate.socketId);
            if (candidateSocket) {
                // For tournament vs tournament match, use the first user's variant
                console.log(`[tryMatchTournamentUser] Found tournament match: ${userId} (${userVariant}${userSubvariant ? `:${userSubvariant}` : ''}) vs ${candidateId} (${candidate.variant}${candidate.subvariant ? `:${candidate.subvariant}` : ''})`);
                console.log(`[tryMatchTournamentUser] Using ${userId}'s variant: ${userVariant}${userSubvariant ? `:${userSubvariant}` : ''}`);
                
                await initiateMatch(
                    user,
                    candidate,
                    userSocket,
                    candidateSocket,
                    io,
                    false // Not cross-queue
                );
                return true;
            } else {
                await leaveTournament(candidateId, tournamentId);
            }
        }
    }

    // --- 2. Fallback to Regular Variant Queues (Tournament user's variant takes priority) ---
    console.log(`[tryMatchTournamentUser] No tournament match for ${userId}, checking regular queues for compatible variants`);

    // First, try to find a regular user with the SAME variant as tournament user
    const tournamentUserQueueKey = userVariant === 'classic' ? 
        REGULAR_QUEUE_KEYS_BY_VARIANT[`classic:${userSubvariant}`] : 
        REGULAR_QUEUE_KEYS_BY_VARIANT[userVariant];

    if (tournamentUserQueueKey) {
        console.log(`[tryMatchTournamentUser] Checking regular queue for tournament user's variant: ${tournamentUserQueueKey}`);
        let regularCandidates = await redisClient.zRange(tournamentUserQueueKey, 0, -1, { REV: true, BY: 'score' });
        
        for (const candidateId of regularCandidates) {
            const candidate = await redisClient.hGetAll(REGULAR_USER_DATA_KEY(candidateId));
            if (candidate && candidate.status === 'waiting') {
                // Check if variants match
                if (candidate.variant === userVariant && candidate.subvariant === userSubvariant) {
                    const candidateSocket = io.sockets.get(candidate.socketId);
                    if (candidateSocket) {
                        console.log(`[tryMatchTournamentUser] Found compatible regular user: ${userId} (T:${userVariant}${userSubvariant ? `:${userSubvariant}` : ''}) vs ${candidateId} (R:${candidate.variant}${candidate.subvariant ? `:${candidate.subvariant}` : ''})`);
                        console.log(`[tryMatchTournamentUser] Using regular user's variant: ${candidate.variant}${candidate.subvariant ? `:${candidate.subvariant}` : ''}`);
                        
                        await initiateMatch(
                            user,          // Tournament user (player1) - their variant will be used
                            candidate,     // Regular user (player2)
                            userSocket,
                            candidateSocket,
                            io,
                            true           // isCrossQueueMatch: true
                        );
                        return true;
                    } else {
                        console.log(`[tryMatchTournamentUser] Cleaning up disconnected regular user ${candidateId}`);
                        await leaveQueue(candidateId);
                    }
                }
            }
        }
    }

    // --- 3. Final fallback: Check all regular queues (any variant) ---
    console.log(`[tryMatchTournamentUser] No compatible regular user found, checking all regular queues as final fallback`);
    const allRegularQueueKeys = Object.values(REGULAR_QUEUE_KEYS_BY_VARIANT);

    for (const regularQueueKey of allRegularQueueKeys) {
        if (!regularQueueKey || regularQueueKey === tournamentUserQueueKey) continue; // Skip already checked queue

        console.log(`[tryMatchTournamentUser] Checking regular queue: ${regularQueueKey}`);
        let regularCandidates = await redisClient.zRange(regularQueueKey, 0, -1, { REV: true, BY: 'score' });

        for (const candidateId of regularCandidates) {
            const candidate = await redisClient.hGetAll(REGULAR_USER_DATA_KEY(candidateId));
            if (candidate && candidate.status === 'waiting') {
                const candidateSocket = io.sockets.get(candidate.socketId);
                if (candidateSocket) {
                    console.log(`[tryMatchTournamentUser] Found fallback regular user: ${userId} (T:${userVariant}${userSubvariant ? `:${userSubvariant}` : ''}) vs ${candidateId} (R:${candidate.variant}${candidate.subvariant ? `:${candidate.subvariant}` : ''})`);
                    console.log(`[tryMatchTournamentUser] Using regular user's variant: ${candidate.variant}${candidate.subvariant ? `:${candidate.subvariant}` : ''}`);
                    
                    await initiateMatch(
                        user,          // Tournament user (player1) - their variant will be used
                        candidate,     // Regular user (player2)
                        userSocket,
                        candidateSocket,
                        io,
                        true           // isCrossQueueMatch: true
                    );
                    return true;
                } else {
                    console.log(`[tryMatchTournamentUser] Cleaning up disconnected regular user ${candidateId}`);
                    await leaveQueue(candidateId);
                }
            }
        }
    }

    console.log(`[tryMatchTournamentUser] No match found for user ${userId} after checking all queues`);
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
    const { userId: userId1 } = player1Data;
    const { userId: userId2 } = player2Data;

    let gameVariant;
    let gameSubvariant;

    if (isCrossQueueMatch) {
        // For cross-queue matches, use regular player's variant (player2 is the regular user)
        gameVariant = player2Data.variant;
        gameSubvariant = player2Data.subvariant;
        console.log(`[initiateMatch] Cross-queue match. Using regular user's variant: ${gameVariant}${gameSubvariant ? `:${gameSubvariant}` : ''}`);
    } else {
        // For tournament vs tournament matches, use player1's variant
        gameVariant = player1Data.variant;
        gameSubvariant = player1Data.subvariant;
        console.log(`[initiateMatch] Tournament match. Using first player's variant: ${gameVariant}${gameSubvariant ? `:${gameSubvariant}` : ''}`);
    }


    console.log(`[initiateMatch] Initiating game between ${userId1} and ${userId2} for ${gameVariant} ${gameSubvariant}`);

    // Atomically remove both players from their respective queues
    // This logic needs to be robust for both tournament and regular players.
    // player1 is always the tournament user for this function's entry point.
    await redisClient.zRem(TOURNAMENT_QUEUE_KEY, userId1);
    await redisClient.del(TOURNAMENT_USER_DATA_KEY(player1Data.tournamentId, userId1)); // Clear tournament user data

    if (isCrossQueueMatch) {
        // player2 is from a regular queue
        let player2QueueKey;
        if (player2Data.variant === 'classic') {
            player2QueueKey = `queue:classic:${player2Data.subvariant}`;
        } else if(player2Data.variant === 'crazyhouse') {
            player2QueueKey = `queue:crazyhouse:${player2Data.subvariant}`;
        } else {
            player2QueueKey = `queue:${player2Data.variant}`;
        }
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
        rating: player1Rating
    };

    const player2 = {
        userId: userDoc2._id.toString(),
        username: userDoc2.name,
        rating: player2Rating
    };

    // Create source object based on match type
    const source = {
        [player1.userId]: isCrossQueueMatch ? 'tournament' : 'tournament',
        [player2.userId]: isCrossQueueMatch ? 'matchmaking' : 'tournament'
    };

    console.log(`[initiateMatch] Players: ${player1.userId} vs ${player2.userId} (${gameVariant} ${gameSubvariant})`);
    console.log(`[initiateMatch] Sources: Player1=${source[player1.userId]}, Player2=${source[player2.userId]}`);

    // Create game session with source information
    const { sessionId, gameState } = await createGameSession(
        player1,
        player2,
        gameVariant,
        gameSubvariant,
        source  // Pass the source object instead of just 'tournament'
    );

    // Emit match events with source information
    player1Socket.emit('queue:matched', {
        opponent: { userId: userDoc2._id, name: userDoc2.name },
        variant: gameVariant,
        sessionId,
        gameState,
        subvariant: gameSubvariant,
        tournamentMatch: !isCrossQueueMatch,
        source: source[player1.userId]  // Add source to emitted data
    });

    player2Socket.emit('queue:matched', {
        opponent: { userId: userDoc1._id, name: userDoc1.name },
        variant: gameVariant,
        sessionId,
        gameState,
        subvariant: gameSubvariant,
        tournamentMatch: !isCrossQueueMatch,
        source: source[player2.userId]  // Add source to emitted data
    });

    console.log(`[Matched] ${sessionId}: Successfully matched user ${userId1} with ${userId2} in ${gameVariant} (Cross-queue: ${isCrossQueueMatch})`);
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


