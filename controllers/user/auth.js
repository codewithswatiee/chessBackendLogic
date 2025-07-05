import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import UserModel from "../../models/User.model.js";

dotenv.config();
const SECRET_KEY = process.env.SECRET_KEY;

// Controller function for user registration
export const registerUser = async (req, res) => {
    const { name, email, password } = req.body;

    try {
        // Check if user already exists
        let existingUser = await UserModel.findOne({ email });

        if (existingUser) {
            return res.status(400).json({ message: "Email already exists" });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create a new user
        const newUser = new UserModel({ name, email, password: hashedPassword });

        // Save the user to the database
        await newUser.save();

        // Generate JWT token
        const token = jwt.sign({ userId: newUser._id }, SECRET_KEY, { expiresIn: "1d" });

        // Return the token and any additional user data as needed
        res.status(201).json({
            token,
            user: {
                _id: newUser._id,
                name: newUser.name,
                email: newUser.email,
            },
        });

    } catch (error) {
        console.error("Error during signup:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
};

// Controller function for user login
export const loginUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    // Find user based on email
    const user = await UserModel.findOne({ email });
    console.log(user)

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    
    const isValidPassword = await bcrypt.compare(password, user.password);
    console.log(isValidPassword)

    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    } 

      const token = jwt.sign({ userId: user._id }, SECRET_KEY, { expiresIn: "1d" });

      // Return the token and accountType in the response
      return res.status(200).json({
        token,
        user: {
            _id: user._id,
            name: user.name,
            email: user.email,
        },
      });
  } catch (error) {
    console.error("Error during login:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};
