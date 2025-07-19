import mongoose from "mongoose";

const User = new mongoose.Schema(
        {
            name: {
              type: String,
              required: true,
            },
            email: {
              type: String,
              required: true
            },
            password: {
              type: String,
              required: true
            },
            ratings: {
              type: Number,
              default: 0
            },
            win: {
              type: Number,
              default: 0
            },
            lose: {
              type: Number,
              default: 0
            },
            tournaments: [
              {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Tournament"
              }
            ],
            createdAt: {
              type: Date,
              default: Date.now
            },
            updatedAt: {
              type: Date,
              default: Date.now
            }
          }
)

export default mongoose.model("User", User);