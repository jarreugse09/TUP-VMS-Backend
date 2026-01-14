import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User";
import QRCode from "../models/QRCode";
import { generateQRString } from "../utils/qrUtils";
import { validationResult } from "express-validator";

// ===== Register =====
export const register = async (req: Request, res: Response) => {
  // Validate input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    // Normalize email
    const email = req.body.email?.trim().toLowerCase();

    // Destructure remaining fields
    const {
      firstName,
      surname,
      birthdate,
      role,
      staffType,
      password,
      photoURL,
    } = req.body;

    // Check existing user
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      firstName,
      surname,
      birthdate,
      role,
      staffType: role === "Staff" ? staffType : undefined,
      email,
      passwordHash,
      photoURL,
    });

    await user.save();

    // Generate QR for non-TUP accounts
    if (role !== "TUP") {
      const qrString = generateQRString(role);
      const qrCode = new QRCode({ userId: user._id, qrString });
      await qrCode.save();
    }

    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ===== Login =====
export const login = async (req: Request, res: Response) => {
  try {
    // Log the request body for debugging on Render
    console.log("REQ BODY:", req.body);

    // Normalize email
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    // Sign JWT token
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET!,
      { expiresIn: "1h" }
    );

    res.json({
      token,
      user: {
        _id: user._id.toString(),
        role: user.role,
        firstName: user.firstName,
        surname: user.surname,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
