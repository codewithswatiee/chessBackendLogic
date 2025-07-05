import mongoose from "mongoose";

const Variant = new mongoose.Schema(
    {
        _id: ObjectId,
        enum: ['crazyhouse', 'decay', 'sixPoint', 'classic'],
        description: String,
        rules: {
          crazyhouse: {
            pocketEnabled: Boolean,
            dropTimerSec: Number
          },
          decay: {
            initialDecayPiece: String,
            startTimerSec: Number,
            incrementPerMove: Number
          },
          sixPoint: {
            maxPoints: Number,
            pieceValues: {
              pawn: 1,
              knight: 2,
              bishop: 2,
              rook: 3,
              queen: 4
            }
          }
        },
        supportsPointMode: Boolean,
        allowedPointModes: [Number],
        defaultTimeControl: String
      }         
)

export default mongoose.model("Variant", Variant);