import Department from "../models/Department";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { NextFunction, Request, Response } from "express";
import { requireValidObjectId } from "../utils/validate";

interface AuthRequest extends Request {
  user?: any;
}

// GET /api/departments - List all departments (or filtered by college)
export const getDepartments = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { collegeId } = req.query;
    const query: any = {};
    if (collegeId) query.collegeId = collegeId;

    const departments = await Department.find(query)
      .populate("collegeId", "name code")
      .populate("headId", "firstName surname")
      .lean();
    
    res.status(200).json({ departments });
  }
);

// GET /api/departments/:id - Get single department
export const getDepartment = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!requireValidObjectId(req.params.id, res)) return;

    const department = await Department.findById(req.params.id)
      .populate("collegeId", "name code")
      .populate("headId", "firstName surname")
      .lean();
    
    if (!department) {
      return next(new AppError("Department not found", 404));
    }
    res.status(200).json({ department });
  }
);

// POST /api/departments - Create department
export const createDepartment = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { name, code, collegeId, headId } = req.body;

    if (!name || !code) {
      return next(new AppError("name and code are required", 400));
    }

    const existing = await Department.findOne({ name });
    if (existing) {
      return next(new AppError("Department with this name already exists", 400));
    }

    const department = await Department.create({ name, code, collegeId, headId });
    res.status(201).json({ department });
  }
);

// PUT /api/departments/:id - Update department
export const updateDepartment = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const { name, code, collegeId, headId } = req.body;

    if (!requireValidObjectId(req.params.id, res)) return;

    const department = await Department.findById(req.params.id);
    if (!department) {
      return next(new AppError("Department not found", 404));
    }

    if (name) department.name = name;
    if (code) department.code = code;
    if (collegeId !== undefined) department.collegeId = collegeId;
    if (headId !== undefined) department.headId = headId;

    await department.save();
    res.status(200).json({ department });
  }
);

// DELETE /api/departments/:id - Delete department
export const deleteDepartment = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!requireValidObjectId(req.params.id, res)) return;

    const department = await Department.findByIdAndDelete(req.params.id);
    if (!department) {
      return next(new AppError("Department not found", 404));
    }
    res.status(200).json({ message: "Department deleted successfully" });
  }
);
