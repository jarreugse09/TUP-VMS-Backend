import Attendance from "../models/Attendance";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { NextFunction, Request, Response } from "express";

interface AuthRequest extends Request {
    user?: any;
}

export const getAttendance = catchAsync(async (req: AuthRequest, res: Response, next: NextFunction) => {
    const attendance = await Attendance.find()
        .populate("staffId", "firstName surname role photoURL")
        .populate("scannedBy", "firstName surname")
        .sort({ date: -1 });


    res.status(200).json({ attendance });
})