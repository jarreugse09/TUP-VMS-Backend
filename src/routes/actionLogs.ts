import express from "express";
import { authenticateToken, validateRbac } from "../middlewares/auth";
import { getActionLogs, getMyActionLogs } from "../controllers/actionLogController";

const router = express.Router();

router.get("/", authenticateToken, validateRbac([], ["superadmin"]), getActionLogs);
router.get("/my", authenticateToken, getMyActionLogs);

export default router;
