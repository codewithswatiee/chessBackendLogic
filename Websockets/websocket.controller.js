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
import { createTournament, getActiveTournamentDetails, joinTournament, leaveTournament } from "../controllers/tournament.controller.js";

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

        // Event for creating tournaments (typically an admin-only action)
        socket.on("tournament:create", async ({ name, capacity, startTime, duration, entryFee, prizePool }) => {
            // Implement authorization check here (e.g., if user is admin)
            if (userId !== 'ADMIN_USER_ID') { // Replace with actual admin check
                socket.emit('tournament:error', { message: 'Unauthorized: Only admins can create tournaments.' });
                return;
            }
            try {
                const tournamentId = await createTournament({ name, capacity, startTime, duration, entryFee, prizePool });
                // Emit to all connected clients in the namespace to notify about new tournament
                matchmakingNamespace.emit('tournament:new_active', { tournamentId, name, message: 'A new tournament has been created!' });
                socket.emit('tournament:created', { tournamentId, message: 'Tournament created successfully.' });
                console.log(`Admin ${userId} created tournament ${tournamentId}`);
            } catch (error) {
                console.error('Error creating tournament:', error);
                socket.emit('tournament:error', { message: 'Failed to create tournament.' });
            }
        });


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
    const {userId, sessionId, variant, subvariant} = queryParams;
    console.log("User connected to game socket:", socket.id, "UserId:", userId, "SessionId:", sessionId);

    if (!userId || !sessionId) {
      console.error("UserId/sessionId not provided in handshake auth");
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
        console.log("Received game:makeMove for user", userId, "session", sessionId, "move", move);
        const result = await makeMove({ sessionId, userId, move, timestamp, variant, subvariant });
        if (result && result.type === 'game:warning') {
          console.warn("Game warning:", result.message);
          gameNamespace.to(sessionId).emit("game:warning", { message: result.message, move: result.move, gameState: result.gameState });
          return;
        }
        const { move: moveObj, gameState } = result;
        console.log("Game making a move")
        // Always emit all game events to the whole session
        gameNamespace.to(sessionId).emit("game:move", { move: moveObj, gameState });
        gameNamespace.to(sessionId).emit("game:timer", { white: gameState.timers.white.remaining, black: gameState.timers.black.remaining });
        if (gameState.status === 'finished') {
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
        console.log("Possible moves for square", square, ":", moves);
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

  //   // Attempt reconnection
  //   socket.on("game:reconnect", async () => {
  //     try {
  //       const session = await reconnectToSession(userId);
  //       if (session) {
  //         currentSessionId = session.sessionId;
  //         socket.join(session.sessionId);
  //         socket.emit("game:reconnected", session);
  //       } else {
  //         socket.emit("game:expired");
  //       }
  //     } catch (err) {
  //       console.error("Reconnection error:", err);
  //       socket.emit("game:error", { message: "Reconnection failed" });
  //     }
  //   });

  //   // Handle moves
  //   socket.on("game:move", async (data) => {
  //     try {
  //       if (!currentSessionId) {
  //         throw new Error("No active session");
  //       }

  //       const { newFen, moveData } = await processMove(
  //         currentSessionId,
  //         userId,
  //         data.move
  //       );

  //       // Broadcast the move to both players
  //       socket
  //         .to(currentSessionId)
  //         .emit("game:move", { fen: newFen, move: moveData });
  //       socket.emit("game:moveConfirmed", { fen: newFen, move: moveData });
  //     } catch (err) {
  //       console.error("Move error:", err);
  //       socket.emit("game:error", { message: err.message });
  //     }
  //   });

  //   // Handle forfeit/resignation
  //   socket.on("game:forfeit", async () => {
  //     if (currentSessionId) {
  //       await endSession(currentSessionId, "forfeit");
  //       gameNamespace
  //         .to(currentSessionId)
  //         .emit("game:ended", { reason: "forfeit" });
  //     }
  //   });

    // Handle disconnection
  //   socket.on("disconnect", async () => {
  //     if (currentSessionId) {
  //       // Don't end session immediately, wait for potential reconnect
  //       setTimeout(async () => {
  //         const session = await reconnectToSession(userId);
  //         if (!session) {
  //           await endSession(currentSessionId, "disconnected");
  //         }
  //       }, 30000); // 30 second grace period
  //     }
  //   });
  });
};

export default websocketRoutes;
