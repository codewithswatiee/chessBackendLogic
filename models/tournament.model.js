import mongoose from "mongoose";

const Tournament = new mongoose.Schema(
    {
        name: String,
        variant: String,
        capacity: {
          type: Number,
          default: 200,
          max: 200
        },
        matches: [{
          player1: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
          },
          player2: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
          },
          sessionId: String, // For tracking game sessions
          state: {
            type: Object, // Game state object, can be customized as needed
            default: {}
          },
          result: String,
          winner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null // null if ongoing
          },
        }],
        status: String,
        startTime: {
          type: Date,
          required: true
        },
        endTime: {
          type: Date,
          required: true
        },
        leaderboard: [{
          player: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
          },
          currentStreak: {
            type: Number,
            default: 0
          },
          wins: {
            type: Number,
            default: 0
          }
        }],
        createdAt: {
            type: Date,
            default: Date.now,
            expires: 7 * 24 * 60 * 60 // 7 days in seconds
        }
    }
)

// Add method to check if tournament is full
Tournament.methods.isFull = function() {
    return this.leaderboard.length >= this.capacity;
};

export default mongoose.model("Tournament", Tournament);