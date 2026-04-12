import TransactionLog from "../models/TransactionLog";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { requireValidObjectId } from "../utils/validate";

interface AuthRequest extends Request {
  user?: any;
}

// GET /api/transaction-logs/own - Get own transactions (as client or staff)
export const getMyTransactions = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const {
      role,
      dateFrom,
      dateTo,
    } = req.query as {
      role?: "client" | "provider";
      dateFrom?: string;
      dateTo?: string;
    };

    const query: Record<string, unknown> = {};

    if (role === "client") {
      query.clientId = userId;
    } else if (role === "provider") {
      query.staffId = userId;
    } else {
      query.$or = [{ clientId: userId }, { staffId: userId }];
    }

    if (dateFrom || dateTo) {
      query.transactionStart = {};
      if (dateFrom) {
        (query.transactionStart as Record<string, Date>).$gte = new Date(dateFrom);
      }
      if (dateTo) {
        (query.transactionStart as Record<string, Date>).$lte = new Date(dateTo);
      }
    }

    const transactions = await TransactionLog.find(query)
      .populate("clientId", "firstName surname role")
      .populate("staffId", "firstName surname role")
      .sort({ transactionStart: -1 })
      .lean();

    res.status(200).json({ data: transactions });
  }
);

// GET /api/transaction-logs/all - Get all transactions (security, hr)
export const getAllTransactions = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const {
      dateFrom,
      dateTo,
      page = "1",
      limit = "200",
    } = req.query as {
      dateFrom?: string;
      dateTo?: string;
      page?: string;
      limit?: string;
    };

    const query: Record<string, unknown> = {};
    if (dateFrom || dateTo) {
      query.transactionStart = {};
      if (dateFrom) {
        (query.transactionStart as Record<string, Date>).$gte = new Date(dateFrom);
      }
      if (dateTo) {
        (query.transactionStart as Record<string, Date>).$lte = new Date(dateTo);
      }
    }

    const pageNum = Math.max(parseInt(page as string, 10) || 1, 1);
    const limitNum = Math.min(
      Math.max(parseInt(limit as string, 10) || 200, 1),
      1000,
    );
    const skip = (pageNum - 1) * limitNum;

    const transactions = await TransactionLog.find(query)
      .populate("clientId", "firstName surname role")
      .populate("staffId", "firstName surname role")
      .sort({ transactionStart: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean();

    res.status(200).json({ data: transactions, page: pageNum, limit: limitNum });
  }
);

// GET /api/transaction-logs/:id - Get single transaction
export const getTransaction = catchAsync(
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    const userId = new mongoose.Types.ObjectId(req.user.id);

    if (!requireValidObjectId(req.params.id, res)) return;
    
    const transaction = await TransactionLog.findById(req.params.id)
      .populate("clientId", "firstName surname role")
      .populate("staffId", "firstName surname role")
      .lean();

    if (!transaction) {
      return next(new AppError("Transaction not found", 404));
    }

    // Check if user is involved in this transaction
    const isClient = transaction.clientId._id.toString() === userId.toString();
    const isStaff = transaction.staffId._id.toString() === userId.toString();
    const isAuthorized = req.user.subRole === "security_head" || 
                         req.user.subRole === "security_staff" ||
                         req.user.subRole === "hr_head" ||
                         req.user.subRole === "hr_staff" ||
                         req.user.subRole === "top_management" ||
                         req.user.subRole === "superadmin";

    if (!isClient && !isStaff && !isAuthorized) {
      return next(new AppError("Access denied", 403));
    }

    res.status(200).json({ transaction });
  }
);
