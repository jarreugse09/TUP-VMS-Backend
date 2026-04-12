import mongoose from "mongoose";
import type { Response } from "express";

export const isValidObjectId = (id: string): boolean =>
  mongoose.Types.ObjectId.isValid(id);

export const requireValidObjectId = (
  id: string,
  res: Response
): boolean => {
  if (!isValidObjectId(id)) {
    res.status(400).json({ error: "Invalid ID format." });
    return false;
  }
  return true;
};
