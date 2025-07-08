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
  leaveQueue,
  cleanupIdleUsers,
} from "../controllers/matchmaking.controller.js";

dotenv.config();

// In-memory mapping for socketId <-> userId
const socketIdToUserId = {};

const websocketRoutes = (io) => {
  const matchmakingNamespace = io.of("/matchmaking");

  matchmakingNamespace.on("connection", (socket) => {
    const queryParams = socket.handshake.auth;
    const userId = queryParams.userId;

    if (!userId) {
      console.error("UserId not provided in handshake query");
      socket.disconnect(true);
      return;
    }

    console.log("User connected to socket:", socket.id);

    // Listen for join queue
    socket.on("queue:join", async ({ variant, subvariant='' }) => {
      console.log("Received queue:join for user", userId, "variant", variant, subvariant);

      try {
        socketIdToUserId[socket.id] = userId;

        await joinQueue({
          userId,
          socketId: socket.id,
          variant,
          io: matchmakingNamespace,
          subvariant,
        });

        console.log(`User ${userId} successfully joined the queue`);
      } catch (err) {
        console.error("Error joining queue:", err);
        socket.emit("queue:error", {
          message: "Failed to join queue",
          error: err.message || err,
        });
      }
    });

    // Listen for leave queue
    socket.on("queue:leave", async () => {
      try {
        await leaveQueue(userId);
        socket.emit("queue:left");

        // Clean up mapping
        Object.keys(socketIdToUserId).forEach((sid) => {
          if (socketIdToUserId[sid] === userId) delete socketIdToUserId[sid];
        });

        console.log("User left the queue:", userId);
      } catch (err) {
        socket.emit("queue:error", {
          message: "Failed to leave queue",
          error: err.message,
        });
      }
    });

    // On disconnect, remove user from queue if present
    socket.on("disconnect", async () => {
      const userId = socketIdToUserId[socket.id];
      if (userId) {
        await leaveQueue(userId);
        delete socketIdToUserId[socket.id];
        console.log(`User disconnected and left queue: ${userId}`);
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
        const { move: moveObj, gameState } = await makeMove({ sessionId, userId, move, timestamp, variant, subvariant });
        // Always emit all game events to the whole session
        gameNamespace.to(sessionId).emit("game:move", { move: moveObj, gameState });
        gameNamespace.to(sessionId).emit("game:timer", { timers: gameState.board.whiteTime, black: gameState.board.blackTime });
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
