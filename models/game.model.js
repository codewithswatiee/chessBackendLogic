import mongoose from "mongoose";

const Game = new mongoose.Schema(
    {
        variant: String, 
        pointMode: Number, 
        players: {
          white: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
          },
          black: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
          }
        },
        moves: [{
          from: String,
          to: String,
          piece: String,
          captured: { type: String, default: null },
          timestamp: Date,
          extra: {
            // CRAZYHOUSE: tracks dropped pieces
            droppedPiece: { type: String, default: null },
            // DECAY: track decay impact
            triggeredDecay: Boolean,
            pieceWithDecay: String
          }
        }],
        state: {
          board: [[String]], // e.g., 2D array of pieces
          pockets: {
            white: [String], // for Crazyhouse
            black: [String]
          },
          timers: {
            white: Number,
            black: Number,
            decay: {
              piece: String,
              startedAt: Date,
              expiresAt: Date
            }
          },
          totalPointsWhite: Number, // for 6-point chess
          totalPointsBlack: Number
        },
        winner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null // null if draw or ongoing
          },
        result: String, // "white", "black", "draw"
        startedAt: Date,
        endedAt: Date,
        ratingChange: {
          white: Number,
          black: Number
        }
      }      
)

export default mongoose.model("Game", Game);