import { 
  getColleges, 
  getCollege, 
  createCollege, 
  updateCollege, 
  deleteCollege 
} from "../controllers/collegeController";
import { authenticateToken, validateRbac } from "../middlewares/auth";
import express from "express";

const router = express.Router();

// GET /api/colleges - List all (accessible to authenticated users)
router.get("/", authenticateToken, getColleges);

// GET /api/colleges/:id - Get single college
router.get("/:id", authenticateToken, getCollege);

// POST /api/colleges - Create (hr_head only)
router.post(
  "/",
  authenticateToken,
  validateRbac(["Staff"], ["hr_head"]),
  createCollege
);

// PUT /api/colleges/:id - Update (hr_head only)
router.put(
  "/:id",
  authenticateToken,
  validateRbac(["Staff"], ["hr_head"]),
  updateCollege
);

// DELETE /api/colleges/:id - Delete (hr_head only)
router.delete(
  "/:id",
  authenticateToken,
  validateRbac(["Staff"], ["hr_head"]),
  deleteCollege
);

export default router;
