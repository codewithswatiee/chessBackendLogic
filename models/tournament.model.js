import mongoose from "mongoose";

const Tournament = new mongoose.Schema(
    {
        name: String,
        variant: String,
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
        status: String, // "upcoming", "ongoing", "completed"
        startedAt: Date,
        endedAt: Date
      }
           
)

export default mongoose.model("Tournament", Tournament);