import express from "express";
import {
  scanQR,
  recordActivity,
  getLogs,
  getActivities,
} from "../controllers/logController";
import { authenticateToken, authorizeRoles } from "../middlewares/auth";

const router = express.Router();

router.post("/scan", authenticateToken, authorizeRoles("TUP"), scanQR);
router.post("/activity", authenticateToken, recordActivity);
router.get("/logs", authenticateToken, authorizeRoles("TUP"), getLogs);
router.get("/activities", authenticateToken, getActivities);

export default router;
