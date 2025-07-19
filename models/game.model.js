import mongoose from "mongoose";

const Game = new mongoose.Schema(
    {
        variant: String, 
        sessionId: String, // For tracking game sessions
        subvariant: String, 
        players: {
          white: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          },
          black: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
          }
        },
        state: {},
        winner: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null // null if draw or ongoing
        },
        result: String, // "white", "black", "draw"
        startedAt: Date,
        endedAt: Date,
      }      
)

export default mongoose.model("Game", Game);