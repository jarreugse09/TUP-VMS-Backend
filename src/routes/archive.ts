import express from "express";
import { authenticateToken, validateRbac } from "../middlewares/auth";
import { getArchivedRecords, restoreRecord } from "../controllers/archiveController";

const router = express.Router();

router.get("/", authenticateToken, validateRbac(["TUP"], ["superadmin"]), getArchivedRecords);
router.patch("/restore/:type/:id", authenticateToken, validateRbac(["TUP"], ["superadmin"]), restoreRecord);

export default router;
