import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

const redisClient = createClient({
  url: "redis://localhost:6379", // Load Redis URL from .env
});

redisClient.on("connect", () => console.log("✅ Connected to Redis"));
redisClient.on("error", (err) => console.error("❌ Redis error:", err));

// 📌 Ensure Redis connection is established before export
(async () => {
  try {
    await redisClient.connect();
    console.log("🚀 Redis client connected successfully");
  } catch (err) {
    console.error("❌ Failed to connect to Redis:", err);
  }
})();

// Redis key helpers for game sessions
export const sessionKey = (sessionId) => `session:${sessionId}`;
export const userSessionKey = (userId) => `user:session:${userId}`;
export const moveListKey = (sessionId) => `moves:${sessionId}`;
export const gameStateKey = (sessionId) => `gamestate:${sessionId}`;

// Constants for session management
export const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
export const MOVE_TIMEOUT = 30 * 1000; // 30 seconds per move

export default redisClient; // Export global Redis instance
