import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { NextFunction, Request, Response } from "express";
import TransactionLog from "../models/TransactionLog";
import User from "../models/User";

const getManilaTime = () => {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
};

const VALID_PROVIDERS = [
  "hr_head", "hr_staff", "non_academic", "department_head", "dean", "top_management"
];

export const startTransaction = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { providerQrCode, transactionType, notes } = req.body;
  const clientId = (req as any).user.id;

  if (!providerQrCode || !transactionType) {
    return next(new AppError("providerQrCode and transactionType are required", 400));
  }

  const provider = await User.findOne({ qrCode: providerQrCode, status: "Active" }).lean();
  if (!provider) return next(new AppError("Invalid Provider QR Code", 404));

  if (!VALID_PROVIDERS.includes(provider.subRole?.toLowerCase() || "")) {
    return next(new AppError("This user is not authorized to act as a Service Provider", 403));
  }

  const transactionStart = getManilaTime();

  const transaction = new TransactionLog({
    clientId,
    staffId: provider._id, // Equivalent to serviceProviderId in current mongoose schemas
    transactionStart,
    transactionType,
    notes,
    scannedBy: "self",
  });

  await transaction.save();

  res.status(200).json({
    success: true,
    message: `Transaction started with ${provider.firstName} ${provider.surname}`,
    data: { transactionId: transaction._id, transactionStart },
  });
});

export const endTransaction = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { providerQrCode, notes } = req.body;
  const clientId = (req as any).user.id;

  if (!providerQrCode) {
    return next(new AppError("providerQrCode is required", 400));
  }

  const provider = await User.findOne({ qrCode: providerQrCode }).lean();
  if (!provider) return next(new AppError("Invalid Provider QR Code", 404));

  const transaction = await TransactionLog.findOne({
    clientId,
    staffId: provider._id,
    transactionEnd: null,
  }).sort({ transactionStart: -1 });

  if (!transaction) return next(new AppError("No ongoing transaction found with this provider", 404));

  const transactionEnd = getManilaTime();
  transaction.transactionEnd = transactionEnd;
  if (notes) transaction.notes = notes;

  const durationMs = transactionEnd.getTime() - new Date(transaction.transactionStart).getTime();
  const durationMinutes = Math.round(durationMs / 60000);

  await transaction.save();

  res.status(200).json({
    success: true,
    message: `Transaction completed with ${provider.firstName} ${provider.surname}. Duration: ${durationMinutes} mins`,
    data: { transactionId: transaction._id, duration: durationMinutes, status: "completed" },
  });
});
