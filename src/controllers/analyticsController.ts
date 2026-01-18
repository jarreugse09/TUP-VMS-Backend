import { Request, Response } from "express";
import User from "../models/User";
import Log from "../models/Log";
import Attendance from "../models/Attendance";

export const getHourlyAnalytics = async (req: Request, res: Response) => {
  try {
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

    const roles = ["Student", "Staff", "Visitor", "TUP"];

    // For each role, aggregate logs by hour
    const hourlyData: Record<number, any> = {};
    for (let h = 0; h < 24; h++) {
      hourlyData[h] = { hour: h, Student: 0, Staff: 0, Visitor: 0, TUP: 0 };
    }

    for (const role of roles) {
      const ids = await User.find({ role }).distinct("_id");

      let logs: any[];
      if (role === "Staff") {
        logs = await Attendance.aggregate([
          {
            $match: {
              staffId: { $in: ids },
              date: { $gte: start, $lte: end },
              timeIn: { $ne: null },
            },
          },
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
        logs = await Log.aggregate([
          {
            $match: {
              userId: { $in: ids },
              date: { $gte: start, $lte: end },
              timeIn: { $ne: null },
            },
          },
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
        const h = item._id;
        if (h >= 0 && h < 24) {
          hourlyData[h][role] = item.count;
        }
      });
    }

    const result = Object.values(hourlyData);
    res.status(200).json({ hourly: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Hourly analytics computation failed" });
  }
};

export const getAnalyticsOverview = async (req: Request, res: Response) => {
  try {
    // parse startDate / endDate from query params
    let { startDate, endDate } = req.query as {
      startDate?: string;
      endDate?: string;
    };

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date();

    // normalize time
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    /* ================================
           VISITOR ANALYTICS
        ================================= */

    const visitorIds = await User.find({ role: "Visitor" }).distinct("_id");

    // TOTAL VISITORS
    const [result] = await Log.aggregate([
      {
        $match: {
          userId: { $in: visitorIds },
          date: { $gte: start, $lte: end },
        },
      },
      {
        $count: "total",
      },
    ]);

    const totalVisitors = result?.total || 0;

    const visitorCheckedOutCount = await Log.countDocuments({
      userId: { $in: visitorIds },
      date: { $gte: start, $lte: end },
      timeOut: { $ne: null },
    });

    const visitorCurrentlyInside = await Log.countDocuments({
      userId: { $in: visitorIds },
      timeIn: { $ne: null },
      date: { $gte: start, $lte: end },
      timeOut: null,
    });

    // AVERAGE VISIT DURATION
    // Average visitors per hour
    const hourlyCounts = await Log.aggregate([
      {
        $match: {
          userId: { $in: visitorIds },
          timeIn: { $ne: null },
          date: { $gte: start, $lte: end },
        },
      },
      {
        $project: {
          hour: { $hour: "$timeIn" },
          date: 1,
        },
      },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
            hour: "$hour",
          },
          count: { $sum: 1 },
        },
      },
    ]);

    // Compute average per hour across the period
    const hoursMap: Record<number, number[]> = {}; // hour -> array of daily counts

    hourlyCounts.forEach((item) => {
      const hour = item._id.hour;
      if (!hoursMap[hour]) hoursMap[hour] = [];
      hoursMap[hour].push(item.count);
    });

    const avgPerHour: { _id: number; hour: number; avgCount: number }[] =
      Object.entries(hoursMap).map(([hour, counts]) => ({
        _id: Number(hour), // use hour as the _id
        hour: Number(hour),
        avgCount: counts.reduce((a, b) => a + b, 0) / counts.length,
      }));

    // Average VISITORS PER DAY
    const dailyVisitors = await Log.aggregate([
      {
        $match: {
          userId: { $in: visitorIds },
          date: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // 2. Compute average
    const averageVisitorsPerDay =
      dailyVisitors.length > 0 ? totalVisitors / dailyVisitors.length : 0;

    /* ================================
           STAFF ATTENDANCE
        ================================= */

    const staffIds = await User.find({ role: "Staff" }).distinct("_id");

    const totalPresentToday = await Attendance.countDocuments({
      staffId: { $in: staffIds },
      date: { $gte: start, $lte: end },
      timeIn: { $ne: null },
    });

    const checkedOutCount = await Attendance.countDocuments({
      staffId: { $in: staffIds },
      date: { $gte: start, $lte: end },
      timeOut: { $ne: null },
    });

    const currentlyInside = await Attendance.countDocuments({
      staffId: { $in: staffIds },
      timeIn: { $ne: null },
      date: { $gte: start, $lte: end },
      timeOut: null,
    });

    const dailyAttendance = await Attendance.aggregate([
      {
        $match: {
          staffId: { $in: staffIds },
          date: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
          present: { $sum: { $cond: [{ $ne: ["$timeIn", null] }, 1, 0] } },
          checkedOut: { $sum: { $cond: [{ $ne: ["$timeOut", null] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    /* ================================
           BUILD ROLES SUMMARY & COMBINED DAILY
        ================================= */

    // roles array
    const roles = ["Student", "Staff", "Visitor", "TUP"];

    // helper to get date keys from dailyAttendance / visitor daily
    const dateKeys = Array.from(
      new Set([
        ...dailyAttendance.map((d: any) => d._id),
        ...dailyVisitors.map((d: any) => d._id),
      ]),
    ).sort();

    // prepare result per role
    const rolesSummary: Record<string, any> = {};

    for (const role of roles) {
      const ids = await User.find({ role }).distinct("_id");

      if (role === "Staff") {
        const usersCurrentlyInside = await Attendance.countDocuments({
          staffId: { $in: ids },
          date: { $gte: start, $lte: end },
          timeIn: { $ne: null },
          timeOut: null,
        });

        const usersCheckedOut = await Attendance.countDocuments({
          staffId: { $in: ids },
          date: { $gte: start, $lte: end },
          timeOut: { $ne: null },
        });

        const daily = await Attendance.aggregate([
          {
            $match: { staffId: { $in: ids }, date: { $gte: start, $lte: end } },
          },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
              count: { $sum: { $cond: [{ $ne: ["$timeIn", null] }, 1, 0] } },
            },
          },
          { $sort: { _id: 1 } },
        ]);

        const map = new Map(daily.map((d: any) => [d._id, d.count]));

        rolesSummary[role] = {
          totalUsers: await User.countDocuments({ role }),
          usersCurrentlyInside,
          usersCheckedOut,
          dailyCounts: dateKeys.map((d) => ({
            _id: d,
            count: map.get(d) || 0,
          })),
        };
      } else {
        const usersCurrentlyInside = await Log.countDocuments({
          userId: { $in: ids },
          date: { $gte: start, $lte: end },
          timeIn: { $ne: null },
          timeOut: null,
        });

        const usersCheckedOut = await Log.countDocuments({
          userId: { $in: ids },
          date: { $gte: start, $lte: end },
          timeOut: { $ne: null },
        });

        const daily = await Log.aggregate([
          {
            $match: {
              userId: { $in: ids },
              date: { $gte: start, $lte: end },
              timeIn: { $ne: null },
            },
          },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]);

        const map = new Map(daily.map((d: any) => [d._id, d.count]));

        rolesSummary[role] = {
          totalUsers: await User.countDocuments({ role }),
          usersCurrentlyInside,
          usersCheckedOut,
          dailyCounts: dateKeys.map((d) => ({
            _id: d,
            count: map.get(d) || 0,
          })),
        };
      }
    }

    // built combinedDaily using dateKeys
    const combinedDaily = dateKeys.map((d) => {
      const row: any = { _id: d };
      for (const role of roles) {
        row[role] =
          rolesSummary[role].dailyCounts.find((x: any) => x._id === d)?.count ||
          0;
      }
      return row;
    });

    res.status(200).json({
      roles: rolesSummary,
      combinedDaily,
      dateRange: dateKeys,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Analytics computation failed" });
  }
};
