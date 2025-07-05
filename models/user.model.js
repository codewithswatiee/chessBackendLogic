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
              crazyhouse: {
                type: Number,
                default: 0
              },
              decayChess: {
                type: Number,
                default: 0
              },
              sixPoint: {
                type: Number,
                default: 0
              },
              classic:{
                blitz: {
                  type: Number,
                  default: 0
                },
                bullet: {
                  type: Number,
                  default: 0
                },
                standard: {
                  type: Number,
                  default: 0
                }
              }
            },
            stats: {
              crazyhouse: { 
                wins:{
                  type: Number,
                  default: 0
                }, losses: {
                  type: Number,
                  default: 0
                }, draws: {
                  type: Number,
                  default: 0
                }
              },
              classic: {
                blitz: { 
                  wins:{
                  type: Number,
                  default: 0
                  }, losses: {
                    type: Number,
                    default: 0
                  }, draws: {
                    type: Number,
                    default: 0
                  }
                },
                standard: { 
                  wins:{
                  type: Number,
                  default: 0
                  }, losses: {
                    type: Number,
                    default: 0
                  }, draws: {
                    type: Number,
                    default: 0
                  }
                },
                bullet: { 
                  wins: {
                    type: Number,
                    default: 0
                  }, losses: {
                    type: Number,
                    default: 0
                  }, draws: {
                    type: Number,
                    default: 0
                  }
                },
              },
              decayChess: { wins: {
                type: Number,
                default: 0
              }, losses: {
                type: Number,
                default: 0
              }, draws: {
                type: Number,
                default: 0
              } },
              sixPoint: { wins: {
                type: Number,
                default: 0
              }, losses: {
                type: Number,
                default: 0
              }, draws: {
                type: Number,
                default: 0
              } }
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