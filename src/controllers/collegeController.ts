import College from "../models/College";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { NextFunction, Request, Response } from "express";
import { requireValidObjectId } from "../utils/validate";

interface AuthRequest extends Request {
  user?: any;
}

// GET /api/colleges - List all colleges
export const getColleges = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const colleges = await College.find().populate("deanId", "firstName surname").lean();
    res.status(200).json({ colleges });
  }
);

// GET /api/colleges/:id - Get single college
export const getCollege = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!requireValidObjectId(req.params.id, res)) return;

    const college = await College.findById(req.params.id).populate("deanId", "firstName surname").lean();
    if (!college) {
      return next(new AppError("College not found", 404));
    }
    res.status(200).json({ college });
  }
);

// POST /api/colleges - Create college
export const createCollege = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { name, code, deanId } = req.body;

    if (!name || !code) {
      return next(new AppError("name and code are required", 400));
    }

    const existing = await College.findOne({ $or: [{ name }, { code }] });
    if (existing) {
      return next(new AppError("College with this name or code already exists", 400));
    }

    const college = await College.create({ name, code, deanId });
    res.status(201).json({ college });
  }
);

// PUT /api/colleges/:id - Update college
export const updateCollege = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { name, code, deanId } = req.body;

    if (!requireValidObjectId(req.params.id, res)) return;

    const college = await College.findById(req.params.id);
    if (!college) {
      return next(new AppError("College not found", 404));
    }

    if (name) college.name = name;
    if (code) college.code = code;
    if (deanId !== undefined) college.deanId = deanId;

    await college.save();
    res.status(200).json({ college });
  }
);

// DELETE /api/colleges/:id - Delete college
export const deleteCollege = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!requireValidObjectId(req.params.id, res)) return;

    const college = await College.findByIdAndDelete(req.params.id);
    if (!college) {
      return next(new AppError("College not found", 404));
    }
    res.status(200).json({ message: "College deleted successfully" });
  }
);
