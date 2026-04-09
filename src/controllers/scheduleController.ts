import { Request, Response } from "express";
import SpecialSchedule from "../models/SpecialSchedule";
import User from "../models/User";
import WorkSchedule from "../models/WorkSchedule";
import { AppError } from "../utils/AppError";
import { catchAsync } from "../utils/catchAsync";
import { computeDailyAttendance } from "../utils/attendanceComputer";
import { getScopedUserQuery } from "../utils/orgRbac";
import { getNormalizedSubRole } from "../utils/rbac";

interface AuthRequest extends Request {
  user?: any;
}

const isSecurityOnlyTarget = (user: any) =>
  String(user.role || "") === "Staff" &&
  ["security_head", "security_staff"].includes(
    getNormalizedSubRole(user) || String(user.staffType || "").toLowerCase(),
  );

const ensureSecurityHeadCanManageTargets = (viewer: any, targets: any[]) => {
  if (getNormalizedSubRole(viewer) !== "security_head") return;

  const invalidTarget = targets.find((target) => !isSecurityOnlyTarget(target));
  if (invalidTarget) {
    throw new AppError(
      "Security head can only manage schedules for security staff",
      403,
    );
  }
};

export const getWorkSchedules = catchAsync(async (req: AuthRequest, res: Response) => {
  const schedules = await WorkSchedule.find()
    .populate("createdBy", "firstName surname role subRole")
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json(schedules);
});

export const createWorkSchedule = catchAsync(async (req: AuthRequest, res: Response) => {
  const { name, days, timeIn, timeOut, graceMinutes, isFlexible } = req.body;

  const schedule = await WorkSchedule.create({
    name: String(name || "").trim(),
    days: Array.isArray(days) ? days : [],
    timeIn,
    timeOut,
    graceMinutes: Number(graceMinutes ?? 15),
    isFlexible: Boolean(isFlexible),
    createdBy: req.user?._id || req.user?.id || null,
  });

  res.status(201).json(schedule);
});

export const updateWorkSchedule = catchAsync(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { name, days, timeIn, timeOut, graceMinutes, isFlexible } = req.body;

  const schedule = await WorkSchedule.findByIdAndUpdate(
    id,
    {
      $set: {
        name: String(name || "").trim(),
        days: Array.isArray(days) ? days : [],
        timeIn,
        timeOut,
        graceMinutes: Number(graceMinutes ?? 15),
        isFlexible: Boolean(isFlexible),
      },
    },
    { new: true },
  );

  if (!schedule) {
    throw new AppError("Work schedule not found", 404);
  }

  res.status(200).json(schedule);
});

export const assignWorkSchedule = catchAsync(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { userIds } = req.body as { userIds?: string[] };

  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new AppError("userIds is required", 400);
  }

  const schedule = await WorkSchedule.findById(id);
  if (!schedule) {
    throw new AppError("Work schedule not found", 404);
  }

  const targets = await User.find({ _id: { $in: userIds } })
    .select("_id role subRole staffType")
    .lean();

  ensureSecurityHeadCanManageTargets(req.user, targets);

  await User.updateMany(
    { _id: { $in: targets.map((target: any) => target._id) } },
    { $set: { workScheduleId: schedule._id } },
  );

  res.status(200).json({
    message: "Work schedule assigned successfully",
    assignedCount: targets.length,
  });
});

export const getAssignableUsers = catchAsync(async (req: AuthRequest, res: Response) => {
  const query = await getScopedUserQuery(req.user, {
    workforceOnly: true,
    includeSubordinates: true,
  });

  const users = await User.find(query)
    .populate("workScheduleId", "name days timeIn timeOut graceMinutes isFlexible")
    .select(
      "_id firstName surname email role subRole staffType college collegeId department departmentId workScheduleId",
    )
    .lean();

  const filteredUsers =
    getNormalizedSubRole(req.user) === "security_head"
      ? users.filter((user: any) => isSecurityOnlyTarget(user))
      : users;

  res.status(200).json(filteredUsers);
});

export const getSpecialSchedules = catchAsync(async (req: AuthRequest, res: Response) => {
  const schedules = await SpecialSchedule.find()
    .populate("approvedBy", "firstName surname role subRole")
    .sort({ date: -1, createdAt: -1 })
    .lean();

  res.status(200).json(schedules);
});

export const createSpecialSchedule = catchAsync(async (req: AuthRequest, res: Response) => {
  const { type, scope, targetId, date, dateEnd, reason } = req.body;

  const schedule = await SpecialSchedule.create({
    type,
    scope,
    targetId: targetId || null,
    date,
    dateEnd: dateEnd || null,
    reason: String(reason || "").trim(),
    approvedBy: req.user?._id || req.user?.id || null,
  });

  res.status(201).json(schedule);
});

export const updateSpecialSchedule = catchAsync(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { type, scope, targetId, date, dateEnd, reason } = req.body;

  const schedule = await SpecialSchedule.findByIdAndUpdate(
    id,
    {
      $set: {
        type,
        scope,
        targetId: targetId || null,
        date,
        dateEnd: dateEnd || null,
        reason: String(reason || "").trim(),
        approvedBy: req.user?._id || req.user?.id || null,
      },
    },
    { new: true },
  );

  if (!schedule) {
    throw new AppError("Special schedule not found", 404);
  }

  res.status(200).json(schedule);
});

export const deleteSpecialSchedule = catchAsync(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const schedule = await SpecialSchedule.findByIdAndDelete(id);
  if (!schedule) {
    throw new AppError("Special schedule not found", 404);
  }

  res.status(200).json({ message: "Special schedule deleted successfully" });
});

export const triggerAttendanceComputation = catchAsync(
  async (req: AuthRequest, res: Response) => {
    const targetDate = req.body?.date ? new Date(req.body.date) : new Date();
    const result = await computeDailyAttendance(
      targetDate,
      String(req.user?._id || req.user?.id || ""),
    );

    res.status(200).json({
      message: "Attendance computation completed",
      result,
    });
  },
);
