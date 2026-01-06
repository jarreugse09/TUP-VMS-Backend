import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User";
import QRCode from "../models/QRCode";
import { generateQRString } from "../utils/qrUtils";
import { body, validationResult } from "express-validator";

export const register = async (req: Request, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    firstName,
    surname,
    birthdate,
    role,
    staffType,
    email,
    password,
    photoURL,
  } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

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
    res.status(500).json({ message: "Server error" });
  }
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

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
    res.status(500).json({ message: "Server error" });
  }
};
