type UserLike = {
  role?: string | null;
  subRole?: string | null;
  staffType?: string | null;
};

const normalize = (value?: string | null) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const SECURITY_KEYS = new Set(["security", "security_head", "security_staff"]);
const SUPERADMIN_KEYS = new Set(["", "admin", "superadmin"]);

export const getNormalizedRole = (user?: UserLike | null) => normalize(user?.role);

export const getNormalizedSubRole = (user?: UserLike | null) =>
  normalize(user?.subRole);

export const getNormalizedStaffType = (user?: UserLike | null) =>
  normalize(user?.staffType);

export const isSecurityAccount = (user?: UserLike | null): boolean => {
  if (!user) return false;
  const role = getNormalizedRole(user);
  const subRole = getNormalizedSubRole(user);
  const staffType = getNormalizedStaffType(user);

  return (
    role === "security" ||
    (role === "staff" &&
      (SECURITY_KEYS.has(subRole) || SECURITY_KEYS.has(staffType)))
  );
};

export const isTupSuperAdmin = (user?: UserLike | null): boolean => {
  if (!user) return false;

  const role = getNormalizedRole(user);
  const subRole = getNormalizedSubRole(user);

  return role === "tup" && SUPERADMIN_KEYS.has(subRole);
};

export const getEffectiveRole = (user?: UserLike | null): string => {
  if (isSecurityAccount(user)) return "Security";

  const role = getNormalizedRole(user);
  if (role === "tup") return "TUP";
  if (role === "staff") return "Staff";
  if (role === "student") return "Student";
  if (role === "visitor") return "Visitor";

  return String(user?.role || "");
};

export const matchesRoleToken = (
  user: UserLike | null | undefined,
  token: string,
): boolean => {
  const normalizedToken = normalize(token);
  if (!normalizedToken) return false;

  if (normalizedToken === "security") {
    return isSecurityAccount(user);
  }

  return (
    getNormalizedRole(user) === normalizedToken ||
    getNormalizedSubRole(user) === normalizedToken ||
    getNormalizedStaffType(user) === normalizedToken
  );
};

export const isAlertAudience = (user?: UserLike | null): boolean => {
  return isTupSuperAdmin(user) || isSecurityAccount(user);
};

export const buildSecurityAudienceQuery = () => ({
  $or: [
    { role: "Security" },
    {
      role: "Staff",
      $or: [
        { staffType: "Security" },
        { staffType: { $in: ["security_head", "security_staff"] } },
        { subRole: { $in: ["security_head", "security_staff"] } },
      ],
    },
  ],
});

export const buildAlertAudienceQuery = () => ({
  $or: [
    {
      role: "TUP",
      $or: [
        { subRole: { $exists: false } },
        { subRole: null },
        { subRole: "" },
        { subRole: { $in: ["admin", "superadmin"] } },
      ],
    },
    buildSecurityAudienceQuery(),
  ],
});
