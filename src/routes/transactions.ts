import { startTransaction, endTransaction } from "../controllers/transactionController";
import { authenticateToken, validateRbac } from "../middlewares/auth";
import express from "express";

const router = express.Router();

// POST /api/transactions/start
router.post(
  "/start",
  authenticateToken,
  validateRbac(["Student", "Visitor", "Staff", "TUP"]),
  startTransaction
);

// POST /api/transactions/end
router.post(
  "/end",
  authenticateToken,
  validateRbac(["Student", "Visitor", "Staff", "TUP"]),
  endTransaction
);

export default router;
