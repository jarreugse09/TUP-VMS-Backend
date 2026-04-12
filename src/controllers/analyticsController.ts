import { Request, Response } from "express";
import mongoose from "mongoose";
import Attendance from "../models/Attendance";
import User from "../models/User";
import TransactionLog from "../models/TransactionLog";
import VisitLog from "../models/VisitLog";
import {
  getScopedUserIds,
  getScopedUserQuery,
} from "../utils/orgRbac";
import { getEffectiveRole, getNormalizedSubRole } from "../utils/rbac";

interface AuthRequest extends Request {
  user?: any;
}

type AttendanceDoc = {
  staffId: string;
  date: Date;
  timeIn: Date | null;
  timeOut: Date | null;
  totalHours?: number | null;
};

type AttendanceSummary = {
  userCount: number;
  attendanceRecords: number;
  usersCurrentlyInside: number;
  usersCheckedOut: number;
  attendanceRate: number;
  completionRate: number;
  averageHoursRendered: number;
  averageCheckInMinutes: number | null;
};

const ACADEMIC_LEADERSHIP_SUB_ROLES = [
  "top_management",
  "dean",
  "department_head",
];
const FACULTY_SUB_ROLES = ["faculty"];
const NON_ACADEMIC_SUB_ROLES = [
  "non_academic",
  "maintenance",
  "hr_head",
  "hr_staff",
  "security_head",
  "security_staff",
];

const round = (value: number, digits: number = 2) =>
  Number(value.toFixed(digits));

const getDateRangeBounds = (req: AuthRequest) => {
  const { startDate, endDate } = req.query as {
    startDate?: string;
    endDate?: string;
  };

  const start = startDate ? new Date(startDate) : new Date();
  const end = endDate ? new Date(endDate) : new Date();

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

const getInclusiveDayCount = (start: Date, end: Date) =>
  Math.max(
    1,
    Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );

const toCheckInMinutes = (value?: Date | null) => {
  if (!value) return null;
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
};

const computeRenderedHours = (record: AttendanceDoc) => {
  if (typeof record.totalHours === "number" && Number.isFinite(record.totalHours)) {
    return record.totalHours;
  }

  if (!record.timeIn || !record.timeOut) return null;
  const diffMs = new Date(record.timeOut).getTime() - new Date(record.timeIn).getTime();
  if (diffMs <= 0) return null;
  return diffMs / (60 * 60 * 1000);
};

const summarizeAttendance = (
  userIds: string[],
  attendance: AttendanceDoc[],
  dayCount: number,
): AttendanceSummary => {
  const idSet = new Set(userIds.map(String));
  const relevant = attendance.filter((record) => idSet.has(String(record.staffId)));

  const attendanceRecords = relevant.filter((record) => record.timeIn).length;
  const usersCurrentlyInside = relevant.filter(
    (record) => record.timeIn && !record.timeOut,
  ).length;
  const usersCheckedOut = relevant.filter((record) => record.timeOut).length;

  const renderedHours = relevant
    .map(computeRenderedHours)
    .filter((value): value is number => typeof value === "number");

  const checkInMinutes = relevant
    .map((record) => toCheckInMinutes(record.timeIn))
    .filter((value): value is number => typeof value === "number");

  const denominator = userIds.length * dayCount;

  return {
    userCount: userIds.length,
    attendanceRecords,
    usersCurrentlyInside,
    usersCheckedOut,
    attendanceRate: denominator > 0 ? round((attendanceRecords / denominator) * 100) : 0,
    completionRate:
      attendanceRecords > 0 ? round((usersCheckedOut / attendanceRecords) * 100) : 0,
    averageHoursRendered:
      renderedHours.length > 0
        ? round(renderedHours.reduce((sum, value) => sum + value, 0) / renderedHours.length)
        : 0,
    averageCheckInMinutes:
      checkInMinutes.length > 0
        ? round(checkInMinutes.reduce((sum, value) => sum + value, 0) / checkInMinutes.length)
        : null,
  };
};

const buildManagedAttendanceAnalytics = async (
  req: AuthRequest,
  scopedWorkforceUsers: any[],
  attendance: AttendanceDoc[],
  dayCount: number,
) => {
  const subRole = getNormalizedSubRole(req.user);
  const viewerId = String(req.user?._id || req.user?.id || "");
  
  // The global silo filter in orgRbac already restricts scopedWorkforceUsers 
  // to ONLY allowed roles (department_head, faculty, etc.) for deans/heads.
  const managedUsers = scopedWorkforceUsers.filter((user) => String(user._id) !== viewerId);

  if (subRole === "dean") {
    // Dean Scope: ALL members within the collegeId
    // Already pre-filtered by orgRbac to excludes Visitors/Students
    const departments = Array.from(
      new Set(
        managedUsers
          .map((user) => String(user.department || "").trim())
          .filter(Boolean),
      ),
    ).sort();

    return {
      label: "College Workforce Performance",
      summary: summarizeAttendance(
        managedUsers.map((user) => String(user._id)),
        attendance,
        dayCount,
      ),
      groups: departments.map((department) => {
        const departmentUsers = managedUsers.filter(
          (user) => String(user.department || "").trim() === department,
        );

        return {
          key: department,
          label: department,
          summary: summarizeAttendance(
            departmentUsers.map((user) => String(user._id)),
            attendance,
            dayCount,
          ),
        };
      }),
    };
  }

  if (subRole === "department_head") {
    // Dept Head Scope: ALL members within the departmentId
    return {
      label: "Department Performance Metrics",
      summary: summarizeAttendance(
        managedUsers.map((user) => String(user._id)),
        attendance,
        dayCount,
      ),
      groups: [
        {
          key: "department",
          label: String(req.user?.department || "Department Workforce"),
          summary: summarizeAttendance(
            managedUsers.map((user) => String(user._id)),
            attendance,
            dayCount,
          ),
        },
      ],
    };
  }

  if (subRole === "hr_head" || subRole === "hr_staff") {
    const workforceGroups = [
      {
        key: "faculty",
        label: "Faculty Workforce",
        users: scopedWorkforceUsers.filter((user) =>
          FACULTY_SUB_ROLES.includes(String(user.subRole || "").toLowerCase()),
        ),
      },
      {
        key: "academic",
        label: "Academic Leadership",
        users: scopedWorkforceUsers.filter((user) =>
          ACADEMIC_LEADERSHIP_SUB_ROLES.includes(
            String(user.subRole || "").toLowerCase(),
          ),
        ),
      },
      {
        key: "staff",
        label: "Administrative Staff",
        users: scopedWorkforceUsers.filter((user) =>
          NON_ACADEMIC_SUB_ROLES.includes(String(user.subRole || "").toLowerCase()) ||
          String(user.role || "") === "Staff",
        ),
      },
    ];

    return {
      label: "University Workforce KPI",
      summary: summarizeAttendance(
        scopedWorkforceUsers.map((user) => String(user._id)),
        attendance,
        dayCount,
      ),
      groups: workforceGroups.map((group) => ({
        key: group.key,
        label: group.label,
        summary: summarizeAttendance(
          group.users.map((user) => String(user._id)),
          attendance,
          dayCount,
        ),
      })),
    };
  }

  return null;
};

export const getHourlyAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const subRole = getNormalizedSubRole(req.user);
    const { date } = req.query as { date?: string };

    if (!date) {
      return res
        .status(400)
        .json({ message: "Date parameter required (YYYY-MM-DD)" });
    }

    const targetDate = new Date(date);
    const start = new Date(targetDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(targetDate);
    end.setHours(23, 59, 59, 999);
    const scopedUserIds = await getScopedUserIds(req.user, {
      includeSubordinates: true,
    });

    const roles = ["Student", "Staff", "Visitor", "TUP"];
    const hourlyData: Record<number, any> = {};

    for (let h = 0; h < 24; h += 1) {
      hourlyData[h] = { hour: h, Student: 0, Staff: 0, Visitor: 0, TUP: 0 };
    }

    for (const role of roles) {
      const ids = await User.find({ role, _id: { $in: scopedUserIds } }).distinct("_id");

      let logs: any[];
      if (role === "Staff" || role === "TUP") {
        const matchStage: any = {
          staffId: { $in: ids },
          date: { $gte: start, $lte: end },
          timeIn: { $ne: null },
        };
        const subRole = getNormalizedSubRole(req.user);
        if (subRole === 'dean' && req.user.collegeId) {
          matchStage.collegeId = new mongoose.Types.ObjectId(req.user.collegeId);
        } else if (subRole === 'department_head' && req.user.departmentId) {
          matchStage.departmentId = new mongoose.Types.ObjectId(req.user.departmentId);
        }

        logs = await Attendance.aggregate([
          { $match: matchStage },
          {
            $project: {
              hour: { $hour: "$timeIn" },
            },
          },
          {
            $group: {
              _id: "$hour",
              count: { $sum: 1 },
            },
          },
        ]);
      } else {
        const matchStage: any = {
          userId: { $in: ids },
          date: { $gte: start, $lte: end },
          timeIn: { $ne: null },
        };
        const subRole = getNormalizedSubRole(req.user);
        if (subRole === 'dean' && req.user.collegeId) {
          matchStage.collegeId = new mongoose.Types.ObjectId(req.user.collegeId);
        } else if (subRole === 'department_head' && req.user.departmentId) {
          matchStage.departmentId = new mongoose.Types.ObjectId(req.user.departmentId);
        }

        logs = await VisitLog.aggregate([
          { $match: matchStage },
          {
            $project: {
              hour: { $hour: "$timeIn" },
            },
          },
          {
            $group: {
              _id: "$hour",
              count: { $sum: 1 },
            },
          },
        ]);
      }

      logs.forEach((item) => {
        const hour = item._id;
        if (hour >= 0 && hour < 24) {
          hourlyData[hour][role] = item.count;
        }
      });
    }

    res.status(200).json({ hourly: Object.values(hourlyData) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Hourly analytics computation failed" });
  }
};

export const getAnalyticsOverview = async (req: AuthRequest, res: Response) => {
  try {
    const subRole = getNormalizedSubRole(req.user);
    const { start, end } = getDateRangeBounds(req);
    const dayCount = getInclusiveDayCount(start, end);
    const scopedUserIds = await getScopedUserIds(req.user, {
      includeSubordinates: true,
    });

    const workforceScopeQuery = await getScopedUserQuery(req.user, {
      workforceOnly: true,
      includeSubordinates: true,
    });

    const scopedWorkforceUsers = await User.find(workforceScopeQuery)
      .select("_id role subRole college department")
      .lean();

    const workforceUserIds = scopedWorkforceUsers.map((user: any) => user._id);
    const attendanceQuery: any = {
      staffId: { $in: workforceUserIds },
      date: { $gte: start, $lte: end },
      deletedAt: null,
    };
    if (subRole === 'dean' && req.user.collegeId) {
      attendanceQuery.collegeId = new mongoose.Types.ObjectId(req.user.collegeId);
    } else if (subRole === 'department_head' && req.user.departmentId) {
      attendanceQuery.departmentId = new mongoose.Types.ObjectId(req.user.departmentId);
    }

    const attendanceDocs = (await Attendance.find(attendanceQuery)
      .select("staffId date timeIn timeOut totalHours")
      .lean()) as unknown as AttendanceDoc[];

    const visitorIds = await User.find({
      role: "Visitor",
      _id: { $in: scopedUserIds },
    }).distinct("_id");

    const visitorsMatch: any = {
      userId: { $in: visitorIds },
      date: { $gte: start, $lte: end },
    };
    // Visitors might not have collegeId/departmentId, so we scope by their host's or just by visitorIds
    // which are already scoped by getScopedUserIds. However, for database-level hardening:
    if (subRole === 'dean' && req.user.collegeId) {
      visitorsMatch.collegeId = new mongoose.Types.ObjectId(req.user.collegeId);
    }

    const dailyVisitors = await VisitLog.aggregate([
      { $match: visitorsMatch },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const staffDaily = await Attendance.aggregate([
      {
        $match: {
          staffId: { $in: workforceUserIds },
          date: { $gte: start, $lte: end },
          deletedAt: null,
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          count: { $sum: { $cond: [{ $ne: ["$timeIn", null] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const studentIds = await User.find({
      role: "Student",
      _id: { $in: scopedUserIds },
    }).distinct("_id");

    const roles = ["Student", "Staff", "Visitor", "TUP"];
    const dateKeys = Array.from(
      new Set([
        ...staffDaily.map((item: any) => item._id),
        ...dailyVisitors.map((item: any) => item._id),
      ]),
    ).sort();

    const rolesSummary: Record<string, any> = {};

    for (const role of roles) {
      if (role === "Staff" || role === "TUP") {
        const ids =
          role === "Staff"
            ? scopedWorkforceUsers
                .filter((user: any) => String(user.role) === "Staff")
                .map((user: any) => String(user._id))
            : scopedWorkforceUsers
                .filter((user: any) => String(user.role) === "TUP")
                .map((user: any) => String(user._id));

        const dailyMap = new Map(
          attendanceDocs
            .filter((record) =>
              ids.includes(String(record.staffId)),
            )
            .reduce((acc, record) => {
              if (!record.timeIn) return acc;
              const key = new Date(record.date).toISOString().slice(0, 10);
              acc.set(key, (acc.get(key) || 0) + 1);
              return acc;
            }, new Map<string, number>()),
        );

        const summary = summarizeAttendance(ids, attendanceDocs, dayCount);

        rolesSummary[role] = {
          totalUsers: ids.length,
          usersCurrentlyInside: summary.usersCurrentlyInside,
          usersCheckedOut: summary.usersCheckedOut,
          dailyCounts: dateKeys.map((dateKey) => ({
            _id: dateKey,
            count: dailyMap.get(dateKey) || 0,
          })),
        };
      } else {
        const ids = role === "Student" ? studentIds : visitorIds;
        const usersCurrentlyInside = await VisitLog.countDocuments({
          visitorId: { $in: ids },
          date: { $gte: start, $lte: end },
          timeIn: { $ne: null },
          timeOut: null,
        });

        const usersCheckedOut = await VisitLog.countDocuments({
          visitorId: { $in: ids },
          date: { $gte: start, $lte: end },
          timeOut: { $ne: null },
        });

        const studentMatch: any = {
          visitorId: { $in: ids },
          date: { $gte: start, $lte: end },
          timeIn: { $ne: null },
        };
        if (subRole === 'dean' && req.user.collegeId) {
          studentMatch.collegeId = new mongoose.Types.ObjectId(req.user.collegeId);
        }

        const daily = await VisitLog.aggregate([
          { $match: studentMatch },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]);

        const map = new Map(daily.map((item: any) => [item._id, item.count]));

        rolesSummary[role] = {
          totalUsers: await User.countDocuments({ role, _id: { $in: scopedUserIds } }),
          usersCurrentlyInside,
          usersCheckedOut,
          dailyCounts: dateKeys.map((dateKey) => ({
            _id: dateKey,
            count: map.get(dateKey) || 0,
          })),
        };
      }
    }

    const combinedDaily = dateKeys.map((dateKey) => {
      const row: any = { _id: dateKey };
      for (const role of roles) {
        row[role] =
          rolesSummary[role].dailyCounts.find((item: any) => item._id === dateKey)?.count || 0;
      }
      return row;
    });

    const viewerId = String(req.user?._id || req.user?.id || "");
    const effectiveRole = getEffectiveRole(req.user);
    const selfAttendance = summarizeAttendance([viewerId], attendanceDocs, dayCount);
    const totalSelfLate = attendanceDocs.filter((a: any) => String(a.staffId) === viewerId && a.status === "late").length;
    const selfPunctualityScore = selfAttendance.attendanceRecords > 0 
        ? Math.round(((selfAttendance.attendanceRecords - totalSelfLate) / selfAttendance.attendanceRecords) * 100) 
        : 100;

    const serviceTimesMatch: any = {
      staffId: viewerId,
      transactionStart: { $gte: start, $lte: end },
      transactionEnd: { $ne: null }
    };
    if (subRole === 'dean' && req.user.collegeId) {
      serviceTimesMatch.collegeId = new mongoose.Types.ObjectId(req.user.collegeId);
    } else if (subRole === 'department_head' && req.user.departmentId) {
      serviceTimesMatch.departmentId = new mongoose.Types.ObjectId(req.user.departmentId);
    }

    const serviceTimes = await TransactionLog.aggregate([
      { $match: serviceTimesMatch },
      {
        $project: {
          durationMs: { $subtract: ["$transactionEnd", "$transactionStart"] }
        }
      },
      {
        $group: {
          _id: null,
          avgDurationMs: { $avg: "$durationMs" }
        }
      }
    ]);
    const avgServiceTimeMinutes = serviceTimes.length > 0 ? Math.round(serviceTimes[0].avgDurationMs / 60000) : 0;

    const managedAttendance = await buildManagedAttendanceAnalytics(
      req,
      scopedWorkforceUsers,
      attendanceDocs,
      dayCount,
    );

    const logHeatmapMatch: any = {
      visitorId: { $in: scopedUserIds },
      date: { $gte: start, $lte: end },
      timeIn: { $ne: null }
    };
    if (subRole === 'dean' && req.user.collegeId) {
      logHeatmapMatch.collegeId = new mongoose.Types.ObjectId(req.user.collegeId);
    }

    const logHeatmap = await VisitLog.aggregate([
      { $match: logHeatmapMatch },
      {
        $project: {
          day: { $dayOfWeek: { date: "$timeIn", timezone: "Asia/Manila" } },
          hour: { $hour: { date: "$timeIn", timezone: "Asia/Manila" } }
        }
      },
      {
        $group: {
          _id: { day: "$day", hour: "$hour" },
          count: { $sum: 1 }
        }
      }
    ]);

    const attendanceHeatmapMatch: any = {
      staffId: { $in: scopedWorkforceUsers.map(u => u._id) },
      date: { $gte: start, $lte: end },
      timeIn: { $ne: null }
    };
    if (subRole === 'dean' && req.user.collegeId) {
      attendanceHeatmapMatch.collegeId = new mongoose.Types.ObjectId(req.user.collegeId);
    } else if (subRole === 'department_head' && req.user.departmentId) {
      attendanceHeatmapMatch.departmentId = new mongoose.Types.ObjectId(req.user.departmentId);
    }

    const attendanceHeatmap = await Attendance.aggregate([
      { $match: attendanceHeatmapMatch },
      {
        $project: {
          day: { $dayOfWeek: { date: "$timeIn", timezone: "Asia/Manila" } },
          hour: { $hour: { date: "$timeIn", timezone: "Asia/Manila" } }
        }
      },
      {
        $group: {
          _id: { day: "$day", hour: "$hour" },
          count: { $sum: 1 }
        }
      }
    ]);

    const heatmapMap = new Map();
    [...logHeatmap, ...attendanceHeatmap].forEach(item => {
      const key = `${item._id.day}-${item._id.hour}`;
      heatmapMap.set(key, (heatmapMap.get(key) || 0) + item.count);
    });

    const heatmapData = Array.from(heatmapMap.entries()).map(([key, count]) => {
      const [day, hour] = key.split("-").map(Number);
      return { day, hour, count };
    });

    res.status(200).json({
      roles: rolesSummary,
      combinedDaily,
      dateRange: dateKeys,
      analyticsView: {
        viewer: {
          effectiveRole,
          subRole,
          college: req.user?.college || null,
          department: req.user?.department || null,
        },
        selfAttendance: {
          ...selfAttendance,
          punctualityScore: selfPunctualityScore,
          avgServiceTimeMinutes
        },
        managedAttendance,
      },
      heatmap: heatmapData,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Analytics computation failed" });
  }
};
