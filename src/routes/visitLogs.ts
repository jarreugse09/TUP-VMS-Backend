import express from "express";
import { authenticateToken } from "../middlewares/auth";
import { getMyVisitLogs, getVisitLogs } from "../controllers/visitLogController";

const router = express.Router();

router.get("/", authenticateToken, getVisitLogs);
router.get("/my", authenticateToken, getMyVisitLogs);

export default router;
