import express from "express";
import {
  getAnalyticsOverview,
  getHourlyAnalytics,
} from "../controllers/analyticsController";

const router = express.Router();

router.get("/admin", getAnalyticsOverview);
router.get("/hourly", getHourlyAnalytics);

export default router;
