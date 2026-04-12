import { 
  getMyTransactions, 
  getAllTransactions,
  getTransaction 
} from "../controllers/transactionLogController";
import { startTransaction, endTransaction } from "../controllers/transactionController";
import { authenticateToken, validateRbac } from "../middlewares/auth";
import express from "express";

const router = express.Router();

// GET /api/transaction-logs/own - Get own transactions (as client or staff)
router.get(
  "/own",
  authenticateToken,
  getMyTransactions
);

// GET /api/transaction-logs/all - Get all transactions (security, hr)
router.get(
  "/all",
  authenticateToken,
  validateRbac([], ["hr_head", "hr_staff", "top_management"]),
  getAllTransactions
);

// GET /api/transaction-logs/:id - Get single transaction
router.get(
  "/:id",
  authenticateToken,
  getTransaction
);

export default router;
