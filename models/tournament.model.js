import mongoose from "mongoose";

const Tournament = new mongoose.Schema(
    {
        _id: ObjectId,
        name: String,
        variant: String,
        pointMode: Number | null,
        participants: [ObjectId],
        rounds: [{
          roundNumber: Number,
          matches: [{
            player1: ObjectId,
            player2: ObjectId,
            gameId: ObjectId,
            result: String
          }]
        }],
        winner: ObjectId | null,
        status: String, // "upcoming", "ongoing", "completed"
        startedAt: Date,
        endedAt: Date
      }
           
)

export default mongoose.model("Tournament", Tournament);