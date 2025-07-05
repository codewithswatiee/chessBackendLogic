import mongoose from "mongoose";

const Leaderboard = new mongoose.Schema(
    {
        _id: ObjectId,
        variant: String,
        pointMode: Number | null,
        topPlayers: [{
          userId: ObjectId,
          username: String,
          rating: Number,
          winRate: Number
        }],
        updatedAt: Date
      }          
)

export default mongoose.model("Leaderboard", Leaderboard);