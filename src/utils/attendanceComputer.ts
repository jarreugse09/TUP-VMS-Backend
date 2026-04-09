import Attendance from "../models/Attendance";
import SpecialSchedule from "../models/SpecialSchedule";
import User from "../models/User";
import WorkSchedule from "../models/WorkSchedule";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const normalize = (value?: string | null) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const parseTimeToMinutes = (value?: string | null) => {
  const [hours, minutes] = String(value || "00:00")
    .split(":")
    .map((part) => parseInt(part, 10));

  return (hours || 0) * 60 + (minutes || 0);
};

const isDateInRange = (date: Date, start: Date, end?: Date | null) => {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const rangeStart = new Date(start);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(end || start);
  rangeEnd.setHours(23, 59, 59, 999);
  return target >= rangeStart && target <= rangeEnd;
};

const getApplicableSpecialSchedule = (
  schedules: any[],
  user: any,
  date: Date,
) => {
  return schedules.find((schedule) => {
    if (!isDateInRange(date, schedule.date, schedule.dateEnd)) return false;

    switch (schedule.scope) {
      case "all":
        return true;
      case "individual":
        return String(schedule.targetId) === String(user._id);
      case "department":
        return (
          user.departmentId &&
          String(schedule.targetId) === String(user.departmentId)
        );
      case "college":
        return user.collegeId && String(schedule.targetId) === String(user.collegeId);
      default:
        return false;
    }
  });
};

export const computeDailyAttendance = async (dateInput: Date, computedBy?: string) => {
  const date = new Date(dateInput);
  date.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  const dayLabel = DAY_LABELS[date.getDay()];

  const workforceUsers = await User.find({
    role: { $in: ["TUP", "Staff"] },
  })
    .select("_id role subRole workScheduleId collegeId departmentId")
    .lean();

  const workScheduleIds = Array.from(
    new Set(
      workforceUsers
        .map((user: any) => user.workScheduleId?.toString())
        .filter(Boolean),
    ),
  );

  const workSchedules = workScheduleIds.length
    ? await WorkSchedule.find({ _id: { $in: workScheduleIds } }).lean()
    : [];
  const scheduleById = new Map(
    workSchedules.map((schedule: any) => [String(schedule._id), schedule]),
  );

  const specialSchedules = await SpecialSchedule.find({
    $or: [
      { date: { $lte: endOfDay }, dateEnd: { $gte: date } },
      { date: { $gte: date, $lte: endOfDay } },
    ],
  }).lean();

  const existingAttendance = await Attendance.find({
    staffId: { $in: workforceUsers.map((user: any) => user._id) },
    date: { $gte: date, $lte: endOfDay },
  }).lean();

  const attendanceByUserId = new Map(
    existingAttendance.map((record: any) => [String(record.staffId), record]),
  );

  const operations = workforceUsers.flatMap((user: any) => {
    const existing = attendanceByUserId.get(String(user._id));
    const specialSchedule = getApplicableSpecialSchedule(specialSchedules, user, date);
    const schedule = user.workScheduleId
      ? scheduleById.get(String(user.workScheduleId))
      : null;
    const isScheduledToday = Boolean(
      schedule &&
        Array.isArray(schedule.days) &&
        schedule.days.some((day: string) => normalize(day) === normalize(dayLabel)),
    );

    let status: "present" | "late" | "absent" | "wfh" | "holiday" | "exempt" | null = null;
    let notes: string | null = null;

    if (specialSchedule) {
      status =
        specialSchedule.type === "wfh"
          ? "wfh"
          : specialSchedule.type === "holiday"
            ? "holiday"
            : "exempt";
      notes = specialSchedule.reason || null;
    } else if (existing?.timeIn) {
      if (schedule && !schedule.isFlexible && isScheduledToday) {
        const actualMinutes =
          new Date(existing.timeIn).getHours() * 60 +
          new Date(existing.timeIn).getMinutes();
        const scheduledMinutes =
          parseTimeToMinutes(schedule.timeIn) + Number(schedule.graceMinutes || 0);
        status = actualMinutes > scheduledMinutes ? "late" : "present";
      } else {
        status = "present";
      }
    } else if (schedule && isScheduledToday) {
      status = "absent";
      notes = "Computed absent due to missing time-in";
    }

    if (!status) {
      return [];
    }

    return [
      {
        updateOne: {
          filter: {
            staffId: user._id,
            date: { $gte: date, $lte: endOfDay },
          },
          update: {
            $set: {
              status,
              notes,
              scannedBy: existing?.scannedBy || computedBy || null,
            },
            $setOnInsert: {
              staffId: user._id,
              date,
              timeIn: existing?.timeIn || null,
              timeOut: existing?.timeOut || null,
              totalHours: existing?.totalHours || null,
            },
          },
          upsert: true,
        },
      },
    ];
  });

  if (operations.length > 0) {
    await Attendance.bulkWrite(operations);
  }

  return {
    computedDate: date,
    processedUsers: workforceUsers.length,
    updatedRecords: operations.length,
  };
};
