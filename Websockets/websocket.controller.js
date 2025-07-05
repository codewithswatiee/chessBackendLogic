import dotenv from "dotenv";
// import {
//   createGameSession,
//   processMove,
//   reconnectToSession,
//   endSession,
// } from "../controllers/game.controller.js";
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
    const queryParams = socket.handshake.query;
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
  // const gameNamespace = io.of("/game");

  // gameNamespace.on("connection", (socket) => {
  //   const queryParams = socket.handshake.query;
  //   const userId = queryParams.userId;
  //   let currentSessionId = null;

  //   if (!userId) {
  //     console.error("UserId not provided in handshake query");
  //     socket.disconnect(true);
  //     return;
  //   }

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
  // });
};

export default websocketRoutes;
