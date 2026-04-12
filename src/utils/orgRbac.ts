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
const NO_RESULTS_FILTER = { _id: null };

const toIdString = (value?: string | mongoose.Types.ObjectId | null) =>
  value ? String(value) : null;

const getViewerId = (viewer?: ViewerLike | null) =>
  String(viewer?.id || viewer?._id || "");

export const canViewAllUsers = (viewer?: ViewerLike | null) => {
  const subRole = getNormalizedSubRole(viewer);

  return (
    subRole === "superadmin" ||
    subRole === "hr_head" ||
    subRole === "hr_staff"
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
  if (!viewer) return NO_RESULTS_FILTER;

  const subRole = getNormalizedSubRole(viewer);
  if (subRole === "superadmin" || subRole === "hr_head" || subRole === "hr_staff") {
    return {};
  }

  if (subRole === "dean") {
    const collegeId = toIdString(viewer.collegeId);
    return collegeId
      ? { collegeId }
      : NO_RESULTS_FILTER;
  }

  if (subRole === "department_head") {
    const departmentId = toIdString(viewer.departmentId);
    return departmentId
      ? { departmentId }
      : NO_RESULTS_FILTER;
  }

  if (subRole === "security_head") {
    return {
      $or: [
        { role: { $in: ["Student", "Visitor"] } },
        { subRole: "security_staff" },
      ],
    };
  }

  if (subRole === "security_staff") {
    return { role: { $in: ["Student", "Visitor"] } };
  }

  if (subRole === "top_management" || subRole === "faculty") {
    return NO_RESULTS_FILTER;
  }

  return NO_RESULTS_FILTER;
};

export const getScopedUserQuery = async (
  viewer?: ViewerLike | null,
  options?: { workforceOnly?: boolean; includeSubordinates?: boolean },
) => {
  const scopeBase = getScopeBaseQuery(viewer);
  const subRole = getNormalizedSubRole(viewer);
  
  const filters: any[] = [];
  if (Object.keys(scopeBase).length > 0) {
    filters.push(scopeBase);
  }

  if (options?.includeSubordinates) {
    const subordinateIds = await getSubordinateUserIds(viewer);
    if (subordinateIds.length > 0) {
      filters.push({ _id: { $in: subordinateIds } });
    }
  }

  let finalQuery =
    filters.length === 0 ? NO_RESULTS_FILTER : filters.length === 1 ? filters[0] : { $or: filters };

  // ─── Apply Strict Silo Gating (Global for the result set) ──────────────────────────────────
  if (subRole === "dean") {
    // Deans see college-scoped users only and never fail open on missing college assignment.
    finalQuery = {
      $and: [
        finalQuery,
        { subRole: { $in: ["department_head", "faculty"] } },
      ]
    };
  } else if (subRole === "department_head") {
    finalQuery = {
      $and: [
        finalQuery,
        { subRole: "faculty" },
      ]
    };
  }

  if (options?.workforceOnly) {
    finalQuery = {
      $and: [finalQuery, { role: { $in: WORKFORCE_ROLES } }],
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
