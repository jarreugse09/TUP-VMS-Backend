import cron from "node-cron";
import VisitLog from "../models/VisitLog";
import Attendance from "../models/Attendance";
import ActionLog from "../models/ActionLog";
import User from "../models/User";
import { getManilaTime } from "./dateUtils";

// 23:00 Cron job for end-of-day missing exits
export const scheduleEndOfDayCheckout = () => {
  cron.schedule("0 23 * * *", async () => {
    console.log("Running End of Day Checkout Job at 23:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endOfDayTime = new Date();
    endOfDayTime.setHours(23, 0, 0, 0);

    try {
      // VisitLogs missing timeOut today
      const incompleteVisits = await VisitLog.find({
        date: { $gte: today, $lte: endOfDayTime },
        timeOut: null,
      });

      for (const visit of incompleteVisits) {
        visit.timeOut = endOfDayTime;
        visit.incompleteExit = true;
        await visit.save();
      }

      // Attendances missing timeOut today
      const incompleteAttendances = await Attendance.find({
        date: { $gte: today, $lte: endOfDayTime },
        timeOut: null,
      });

      for (const attendance of incompleteAttendances) {
        attendance.timeOut = endOfDayTime;
        await attendance.save();
      }

      console.log(`End of Day Job complete: auto-checked out ${incompleteVisits.length} visits and ${incompleteAttendances.length} attendances.`);
      
      await ActionLog.create({
        action: "CRON_END_OF_DAY_CHECKOUT",
        details: `Auto-checked out ${incompleteVisits.length} visits and ${incompleteAttendances.length} attendances.`,
        severity: "info",
      });

    } catch (err) {
      console.error("Error in End of Day Checkout Job:", err);
    }
  }, {
    timezone: "Asia/Manila"
  });

  cron.schedule("0 1 1 * *", async () => {
    console.log("[Retention] Running monthly data retention check...");
    try {
      const now = getManilaTime();
      const users = await User.find({ status: "Inactive" });
      let flagged = 0;

      for (const user of users) {
        const retentionDays = user.dataRetentionDays ?? 1825;
        const retentionMs = retentionDays * 86_400_000;
        const elapsed = now.getTime() - user.updatedAt.getTime();

        if (elapsed > retentionMs) {
          await ActionLog.create({
            performedBy: null,
            action: "DATA_RETENTION_FLAG",
            targetModel: "User",
            targetId: user._id,
            details: `User ${user.email} has been Inactive for ${Math.floor(elapsed / 86_400_000)} days, exceeding retention of ${retentionDays} days. Manual DPO review required.`,
            ipAddress: "system",
            userAgent: "CronJob/RetentionCheck",
            severity: "warning",
          });
          flagged += 1;
        }
      }

      console.log(`[Retention] Flagged ${flagged} user(s) for DPO review.`);
    } catch (err) {
      console.error("[Retention] Cron error:", err);
    }
  }, { timezone: "Asia/Manila" });
};
