import dotenv from "dotenv";
import {
  makeMove,
  getPossibleMoves,
  resign,
  offerDraw,
  acceptDraw,
  declineDraw
} from "../controllers/game.controller.js";
import {
  joinQueue,
  cleanupIdleUsers,
  handleDisconnect,
} from "../controllers/matchmaking.controller.js";
import { createTournament, getActiveTournamentDetails, handleTournamentMatchResult, joinTournament, leaveTournament } from "../controllers/tournament.controller.js";
import tournamentModel from "../models/tournament.model.js";
import UserModel from "../models/User.model.js";

dotenv.config();

// In-memory mapping for socketId <-> userId
const socketIdToUserId = {};

const websocketRoutes = (io) => {
  const matchmakingNamespace = io.of("/matchmaking");

  matchmakingNamespace.on("connection", (socket) => {
        // userId should ideally come from an authenticated session (e.g., JWT in handshake.auth.token)
        const queryParams = socket.handshake.auth;
        const userId = queryParams.userId; // Get userId from auth payload

        if (!userId) {
            console.error("UserId not provided in handshake auth");
            socket.disconnect(true);
            return;
        }

        // Store the mapping for disconnection handling
        socketIdToUserId[socket.id] = userId;
        console.log(`User ${userId} connected to socket: ${socket.id}`);

        // --- Regular Matchmaking Events ---
        socket.on("queue:join", async ({ variant, subvariant = '' }) => {
            console.log("Received queue:join for user", userId, "variant", variant, subvariant);

            try {
                // The socketIdToUserId mapping is already handled on connection.

                await joinQueue({
                    userId,
                    socketId: socket.id,
                    variant,
                    io: matchmakingNamespace, // Pass the namespace for emitting events
                    subvariant,
                    source: 'matchmaking'
                });

                console.log(`User ${userId} successfully joined the regular queue`);
            } catch (err) {
                console.error("Error joining regular queue:", err);
                socket.emit("queue:error", {
                    message: "Failed to join regular queue",
                    error: err.message || err,
                });
            }
        });

        socket.on("queue:leave", async () => {
            try {
                await handleDisconnect(userId, socket.id); // Use the general disconnect handler for cleanup
                socket.emit("queue:left");
                console.log(`User ${userId} explicitly left the regular queue`);
            } catch (err) {
                socket.emit("queue:error", {
                    message: "Failed to leave regular queue",
                    error: err.message,
                });
            }
        });

        // --- Tournament Matchmaking Events ---
        socket.on("tournament:join", async () => {
            console.log(`Received tournament:join for user ${userId}`);
            try {
                await joinTournament({
                    userId,
                    socketId: socket.id,
                    io: matchmakingNamespace, // Pass the namespace
                    source: 'tournament'
                });
                console.log(`User ${userId} successfully joined the tournament`);
            } catch (err) {
                console.error("Error joining tournament:", err);
                socket.emit("tournament:error", {
                    message: "Failed to join tournament",
                    error: err.message || err,
                });
            }
        });

        socket.on("tournament:leave", async () => {
            console.log(`Received tournament:leave for user ${userId}`);
            try {
                const activeTournament = await getActiveTournamentDetails();
                if (activeTournament) {
                    await leaveTournament(userId, activeTournament.id); // Use the tournament-specific leave
                    socket.emit("tournament:left", { message: 'You have left the tournament.' });
                    console.log(`User ${userId} explicitly left tournament ${activeTournament.id}`);
                } else {
                    socket.emit("tournament:error", { message: "No active tournament to leave." });
                }
            } catch (err) {
                console.error("Error leaving tournament:", err);
                socket.emit("tournament:error", {
                    message: "Failed to leave tournament",
                    error: err.message,
                });
            }
        });

        socket.on("tournament:get_active", async () => {
            console.log(`Received tournament:get_active for user ${userId}`);
            try {
                const activeTournament = await getActiveTournamentDetails();
                socket.emit("tournament:active_details", { tournament: activeTournament });
            } catch (err) {
                console.error("Error fetching active tournament details:", err);
                socket.emit("tournament:error", {
                    message: "Failed to fetch active tournament details.",
                    error: err.message || err,
                });
            }
        });

//         // Event for creating tournaments (typically an admin-only action)
//         socket.on("tournament:create", async ({ name }) => {
//             if (userId !== 'ADMIN_USER_ID') {
//                 socket.emit('tournament:error', { message: 'Unauthorized: Only admins can create tournaments.' });
//                 return;
//             }
//             try {
//                 // Set tournament times for today
//                 const now = new Date();
//                 const startTime = new Date(now.setHours(9, 0, 0, 0));
//                 const endTime = new Date(now.setHours(21, 0, 0, 0));
//                 
//                 const tournamentId = await createTournament({ 
//                     name, 
//                     capacity: 200,
//                     startTime,
//                     endTime
//                 });
//                 
//                 matchmakingNamespace.emit('tournament:new_active', { 
//                     tournamentId, 
//                     name, 
//                     message: 'A new tournament has been created!' 
//                 });
//                 
//                 socket.emit('tournament:created', { 
//                     tournamentId, 
//                     message: 'Tournament created successfully.' 
//                 });
//                 
//             } catch (error) {
//                 console.error('Error creating tournament:', error);
//                 socket.emit('tournament:error', { message: 'Failed to create tournament.' });
//             }
//         });


        // --- Disconnect Handling ---
        socket.on("disconnect", async () => {
            const disconnectedUserId = socketIdToUserId[socket.id];
            if (disconnectedUserId) {
                // Use the universal handleDisconnect that checks both regular and tournament queues
                await handleDisconnect(disconnectedUserId, socket.id);
                delete socketIdToUserId[socket.id];
                console.log(`User disconnected and cleaned up from queues: ${disconnectedUserId}`);
            } else {
                console.log(`Socket disconnected without mapped user: ${socket.id}`);
            }
        });
    });

  // Periodic cleanup of idle users
  const intervalId = setInterval(() => {
    cleanupIdleUsers();
  }, 60 * 1000);

  // Optional: cleanup on server shutdown
  process.on("SIGINT", () => {
    clearInterval(intervalId);
    process.exit();
  });

  // Game namespace for handling chess moves
  const gameNamespace = io.of("/game");

  gameNamespace.on("connection", (socket) => {
    const queryParams = socket.handshake.auth;
    console.log("queryParams:", queryParams);
    const {userId, sessionId, variant, subvariant, source} = queryParams; // Add source to destructuring
    console.log("User connected to game socket:", socket.id, "UserId:", userId, "SessionId:", sessionId, "Source:", source);

    if (!userId || !sessionId || !source) { // Add source check
      console.error("UserId/sessionId/source not provided in handshake auth");
      socket.disconnect(true);
      return;
    }

    // Join the session room so both players get updates
    socket.join(sessionId);
    console.log(`User ${userId} joined session room ${sessionId}`);
    // --- Outgoing events from client ---
    // Make move
    socket.on("game:makeMove", async ({ move, timestamp }) => {
      try {
        const result = await makeMove({ 
        sessionId, 
        userId, 
        move, 
        timestamp, 
        variant, 
        subvariant,
        source
        });
        if (result && result.type === 'game:warning') {
          console.warn("Game warning:", result.message);
          gameNamespace.to(sessionId).emit("game:warning", { message: result.message, move: result.move, gameState: result.gameState });
          return;
        }
        const { move: moveObj, gameState } = result;
        // Always emit all game events to the whole session
        gameNamespace.to(sessionId).emit("game:move", { move: moveObj, gameState });

        // --- MODIFICATION START ---
        // Emit main game timers from gameState.board
        gameNamespace.to(sessionId).emit("game:timer", {
            white: gameState.board.whiteTime,
            black: gameState.board.blackTime,
            // For Crazyhouse withTimer, pass dropTimers if available
            dropTimers: gameState.board.dropTimers || null
        });
        // --- MODIFICATION END ---

        if (gameState.status === 'finished') {
            // Check source from metadata for both players
            await handleGameEnd(gameState, variant);
            gameNamespace.to(sessionId).emit("game:end", { gameState });
        }
      } catch (err) {
        gameNamespace.to(sessionId).emit("game:error", { message: err.message });
      }
    });

    // Get possible moves
    socket.on("game:getPossibleMoves", async ({ square }) => {
      try {
        const moves = await getPossibleMoves({ sessionId, square, variant, subvariant });
        gameNamespace.to(sessionId).emit("game:possibleMoves", { square, moves });
      } catch (err) {
        gameNamespace.to(sessionId).emit("game:error", { message: err.message });
      }
    });

    // Resign
    socket.on("game:resign", async () => {
      try {
        const { gameState } = await resign({ sessionId, userId, variant, subvariant });
        gameNamespace.to(sessionId).emit("game:end", { gameState });
      } catch (err) {
        gameNamespace.to(sessionId).emit("game:error", { message: err.message });
      }
    });

    // Offer draw
    socket.on("game:offerDraw", async () => {
      try {
        const { gameState } = await offerDraw({ sessionId, userId , variant, subvariant});
        gameNamespace.to(sessionId).emit("game:gameState", { gameState });
      } catch (err) {
        gameNamespace.to(sessionId).emit("game:error", { message: err.message });
      }
    });

    // Accept draw
    socket.on("game:acceptDraw", async () => {
      try {
        const { gameState } = await acceptDraw({ sessionId, userId, variant, subvariant });
        gameNamespace.to(sessionId).emit("game:end", { gameState });
      } catch (err) {
        gameNamespace.to(sessionId).emit("game:error", { message: err.message });
      }
    });

    // Decline draw
    socket.on("game:declineDraw", async () => {
      try {
        const { gameState } = await declineDraw({ sessionId, userId , variant, subvariant });
        gameNamespace.to(sessionId).emit("game:gameState", { gameState });
      } catch (err) {
        gameNamespace.to(sessionId).emit("game:error", { message: err.message });
      }
    });
  });
};


// async function handleMatchmakingResult(gameState, variant) {
//     try {
//         const incPoint = getVariantPoints(variant);
//         const winnerId = gameState.winnerColor === 'white' ? 
//             gameState.players.white.userId : 
//             gameState.players.black.userId;
//         const looserId = gameState.winnerColor === 'white' ? 
//             gameState.players.black.userId : 
//             gameState.players.white.userId;

//         console.log(`Saving matchmaking results - Winner: ${winnerId}, Loser: ${looserId}, Points: ${incPoint}`);

//         const [winnerUpdate, loserUpdate] = await Promise.all([
//             UserModel.findByIdAndUpdate(
//                 winnerId,
//                 {
//                     $inc: {
//                         ratings: incPoint,
//                         wins: 1
//                     }
//                 },
//                 { new: true }
//             ),
//             UserModel.findByIdAndUpdate(
//                 looserId,
//                 {
//                     $inc: { 
//                         losses: 1
//                     }
//                 },
//                 { new: true }
//             )
//         ]);

//         console.log(`Results saved - Winner new rating: ${winnerUpdate.ratings}, Loser new losses: ${loserUpdate.losses}`);
//         return true;
//     } catch (error) {
//         console.error('Error saving matchmaking results:', error);
//         throw error;
//     }
// }

function getVariantPoints(variant) {
    switch(variant) {
        case 'classic': return 1;
        case 'crazyhouse': return 2;
        case 'sixpointer':
        case 'decay': return 3;
        default: return 1;
        }
}

async function handleGameEnd(gameState, variant) {
    try {
        const winnerId = gameState.winnerColor === 'white' ? 
            gameState.players.white.userId : 
            gameState.players.black.userId;
        const loserId = gameState.winnerColor === 'white' ? 
            gameState.players.black.userId : 
            gameState.players.white.userId;

        const winnerSource = gameState.metadata.source[winnerId];
        const loserSource = gameState.metadata.source[loserId];

        console.log(`Game ended - Winner: ${winnerId} (${winnerSource}), Loser: ${loserId} (${loserSource})`);

        const updatePromises = [];

        // Handle winner updates
        if (winnerSource === 'tournament') {
            const activeTournament = await tournamentModel.findOne({ status: 'active' });
            if (activeTournament) {
                updatePromises.push(
                    tournamentModel.findByIdAndUpdate(
                        activeTournament._id,
                        {
                            $inc: {
                                'leaderboard.$[elem].currentStreak': 1,
                                'leaderboard.$[elem].wins': 1
                            }
                        },
                        {
                            arrayFilters: [{ 'elem.player': winnerId }],
                            new: true
                        }
                    )
                );
            }
        } else {
            // Matchmaking winner
            updatePromises.push(
                UserModel.findByIdAndUpdate(
                    winnerId,
                    {
                        $inc: {
                            ratings: getVariantPoints(variant),
                            wins: 1
                        }
                    },
                    { new: true }
                )
            );
        }

        // Handle loser updates
        if (loserSource === 'tournament') {
            const activeTournament = await tournamentModel.findOne({ status: 'active' });
            if (activeTournament) {
                updatePromises.push(
                    tournamentModel.findByIdAndUpdate(
                        activeTournament._id,
                        {
                            $set: {
                                'leaderboard.$[elem].currentStreak': 0
                            }
                        },
                        {
                            arrayFilters: [{ 'elem.player': loserId }],
                            new: true
                        }
                    )
                );
            }
        } else {
            // Matchmaking loser
            updatePromises.push(
                UserModel.findByIdAndUpdate(
                    loserId,
                    {
                        $inc: { losses: 1 }
                    },
                    { new: true }
                )
            );
        }

        const results = await Promise.all(updatePromises);
        console.log('Game results updated successfully:', results);
        return true;
    } catch (error) {
        console.error('Error handling game end:', error);
        throw error;
    }
}

export default websocketRoutes;
// Update the game:makeMove event handler section: