import mongoose from "mongoose";
import User from "../models/User";
import { getNormalizedRole, getNormalizedSubRole } from "./rbac";

type ViewerLike = {
  id?: string;
  _id?: string | mongoose.Types.ObjectId;
  role?: string | null;
  subRole?: string | null;
  collegeId?: string | mongoose.Types.ObjectId | null;
  departmentId?: string | mongoose.Types.ObjectId | null;
};

const WORKFORCE_ROLES = ["Staff", "TUP"];

const toIdString = (value?: string | mongoose.Types.ObjectId | null) =>
  value ? String(value) : null;

const getViewerId = (viewer?: ViewerLike | null) =>
  String(viewer?.id || viewer?._id || "");

export const canViewAllUsers = (viewer?: ViewerLike | null) => {
  const role = getNormalizedRole(viewer);
  const subRole = getNormalizedSubRole(viewer);

  return (
    role === "tup" ||
    subRole === "hr_head" ||
    subRole === "hr_staff" ||
    subRole === "security_head" ||
    subRole === "security_staff"
  );
};

export const canViewAnalytics = (viewer?: ViewerLike | null) => {
  const role = getNormalizedRole(viewer);
  const subRole = getNormalizedSubRole(viewer);

  return (
    role === "tup" ||
    subRole === "hr_head" ||
    subRole === "hr_staff" ||
    subRole === "security_head" ||
    subRole === "security_staff"
  );
};

export const isDean = (viewer?: ViewerLike | null) =>
  getNormalizedSubRole(viewer) === "dean";

export const isDepartmentHead = (viewer?: ViewerLike | null) =>
  getNormalizedSubRole(viewer) === "department_head";

const getScopeBaseQuery = (viewer?: ViewerLike | null) => {
  if (!viewer) return { _id: null };

  if (canViewAllUsers(viewer)) {
    return {};
  }

  const collegeId = toIdString(viewer.collegeId);
  if (isDean(viewer) && collegeId) {
    return { collegeId };
  }

  const departmentId = toIdString(viewer.departmentId);
  if (isDepartmentHead(viewer) && departmentId) {
    return { departmentId };
  }

  const viewerId = getViewerId(viewer);
  return viewerId ? { _id: viewerId } : { _id: null };
};

export const getScopedUserQuery = async (
  viewer?: ViewerLike | null,
  options?: { workforceOnly?: boolean; includeSubordinates?: boolean },
) => {
  const scopeQuery = getScopeBaseQuery(viewer);
  const filters: any[] = [];

  if (Object.keys(scopeQuery).length > 0) {
    filters.push(scopeQuery);
  }

  if (options?.includeSubordinates) {
    const subordinateIds = await getSubordinateUserIds(viewer);
    if (subordinateIds.length > 0) {
      filters.push({ _id: { $in: subordinateIds } });
    }
  }

  const finalQuery =
    filters.length === 0 ? {} : filters.length === 1 ? filters[0] : { $or: filters };

  if (options?.workforceOnly) {
    return {
      ...finalQuery,
      role: { $in: WORKFORCE_ROLES },
    };
  }

  return finalQuery;
};

export const getScopedUserIds = async (
  viewer?: ViewerLike | null,
  options?: { workforceOnly?: boolean; includeSubordinates?: boolean },
) => {
  const query = await getScopedUserQuery(viewer, options);
  return User.find(query).distinct("_id");
};

export const getSubordinateUserIds = async (viewer?: ViewerLike | null) => {
  const viewerId = getViewerId(viewer);
  if (!viewerId) return [];

  const seen = new Set<string>();
  const queue = [viewerId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const directReports = await User.find({ supervisorId: currentId })
      .select("_id")
      .lean();

    for (const report of directReports) {
      const reportId = String(report._id);
      if (seen.has(reportId)) continue;
      seen.add(reportId);
      queue.push(reportId);
    }
  }

  return Array.from(seen);
};
