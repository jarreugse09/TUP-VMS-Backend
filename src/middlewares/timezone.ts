import { Request, Response, NextFunction } from "express";

// Timezone Enforcement Middleware
// Overrides the standard date representation to strictly follow Asia/Manila.
export const enforceAsiaManila = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Sets process timezone for this application instance
  process.env.TZ = "Asia/Manila";
  next();
};
