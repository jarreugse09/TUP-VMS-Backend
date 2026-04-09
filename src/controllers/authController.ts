import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User";
import QRCode from "../models/QRCode";
import { generateQRString } from "../utils/qrUtils";
import { validationResult } from "express-validator";
import { resolveOrganizationRefs, resolveSupervisorId } from "../utils/orgStructure";

// ===== Register =====
export const register = async (req: Request, res: Response) => {
  // Validate input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    if (typeof req.body.customQR !== "undefined") {
      return res
        .status(403)
        .json({ message: "QR customization is restricted to admins" });
    }

    // Normalize email
    const email = req.body.email?.trim().toLowerCase();

    // Destructure remaining fields
    const {
      firstName,
      surname,
      birthdate,
      role,
      subRole,
      staffType,
      designation,
      officeUnit,
      college,
      department,
      supervisorEmail,
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
    const orgRefs = await resolveOrganizationRefs({ college, department });
    const supervisorId = await resolveSupervisorId({ supervisorEmail });

    // Create user
    const user = new User({
      firstName,
      surname,
      birthdate,
      role,
      subRole: subRole || undefined,
      staffType: role === "Staff" ? staffType : undefined,
      designation: designation?.trim() || undefined,
      officeUnit: officeUnit?.trim() || undefined,
      college: orgRefs.college,
      collegeId: orgRefs.collegeId,
      department: orgRefs.department,
      departmentId: orgRefs.departmentId,
      supervisorId,
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
    // console.log("REQ BODY:", req.body);

    // Normalize email
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
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
      {
        id: user._id,
        _id: user._id,
        role: user.role,
        subRole: user.subRole,
        staffType: user.staffType,
        designation: user.designation,
        officeUnit: user.officeUnit,
        college: user.college,
        collegeId: user.collegeId,
        department: user.department,
        departmentId: user.departmentId,
        supervisorId: user.supervisorId,
        workScheduleId: user.workScheduleId,
        firstName: user.firstName,
        surname: user.surname,
        name: `${user.firstName} ${user.surname}`,
      },
      process.env.JWT_SECRET!,
      { expiresIn: "1h" },
    );

    res.json({
      token,
      user: {
        _id: user._id.toString(),
        role: user.role,
        subRole: user.subRole,
        firstName: user.firstName,
        surname: user.surname,
        staffType: user.staffType,
        designation: user.designation,
        officeUnit: user.officeUnit,
        college: user.college,
        collegeId: user.collegeId,
        department: user.department,
        departmentId: user.departmentId,
        supervisorId: user.supervisorId,
        workScheduleId: user.workScheduleId,
        photoURL: user.photoURL,
        mustCapturePhoto: user.mustCapturePhoto,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
