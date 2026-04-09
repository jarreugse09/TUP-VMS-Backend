import College from "../models/College";
import Department from "../models/Department";
import User from "../models/User";

const clean = (value?: string | null) => {
  const trimmed = String(value || "").trim();
  return trimmed || undefined;
};

export const resolveOrganizationRefs = async (input: {
  college?: string | null;
  department?: string | null;
}) => {
  const collegeName = clean(input.college);
  const departmentName = clean(input.department);

  let collegeId = null;
  let departmentId = null;

  if (collegeName) {
    const college = await College.findOneAndUpdate(
      { name: collegeName },
      { $setOnInsert: { name: collegeName } },
      { new: true, upsert: true },
    );
    collegeId = college._id;
  }

  if (departmentName) {
    const department = await Department.findOneAndUpdate(
      { name: departmentName, collegeId: collegeId || null },
      {
        $setOnInsert: {
          name: departmentName,
          collegeId: collegeId || null,
        },
      },
      { new: true, upsert: true },
    );
    departmentId = department._id;
  }

  return {
    college: collegeName,
    collegeId,
    department: departmentName,
    departmentId,
  };
};

export const resolveSupervisorId = async (input: {
  supervisorEmail?: string | null;
}) => {
  const supervisorEmail = clean(input.supervisorEmail)?.toLowerCase();
  if (!supervisorEmail) return null;

  const supervisor = await User.findOne({ email: supervisorEmail }).select("_id");
  return supervisor?._id || null;
};
