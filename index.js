// staging
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import logger from "morgan";
import http from "http";
import { Server } from "socket.io";
import authRoutes from "./router/auth.route.js";
import websocketRoutes from "./Websockets/websocket.controller.js";
import UserModel from "./models/User.model.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT;

// HTTP server created from the Express app
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:8081"
    ],
    methods: "*"
  },
});

// CORS configuration
const allowedOrigins = [
  "http://localhost:8081",
];

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(logger("dev"));
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg =
          "The CORS policy for this site does not allow access from the specified Origin.";
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true, // Add this
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"], // Add this
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "ngrok-skip-browser-warning",
    ], // Add this
  })
);

// app.options("*", cors());

// To check server status
app.get("/", (req, res) => {
  res.json({ status: "running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/leaderboard",  async (req, res) => {
  try {
    const users = await UserModel.find({})
      .sort({ ratings: -1 })  
      .select('_id email name ratings win lose');

    res.status(200).json({ success: true, users });
  } catch (err) {
    console.error('[GET /users/ratings]', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});


// web-socket
websocketRoutes(io);

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI,
     {
  useNewUrlParser: true,
  useUnifiedTopology: true,

  })
  .then(() => {
    console.log("Connected to MongoDB");
    server.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((err) => console.log("Failed to connect to MongoDB", err));
