import mongoose from "mongoose";
import College from "../models/College";
import Department from "../models/Department";
import User from "../models/User";

const clean = (value?: string | null) => {
  const trimmed = String(value || "").trim();
  return trimmed || undefined;
};

const normalizeAscii = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s.-]/g, "");

const generateCode = (name: string, maxLength: number = 10): string => {
  const normalized = normalizeAscii(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
  return normalized.substring(0, maxLength) || "DEPT";
};

const generateUniqueCode = async (name: string, Model: mongoose.Model<any>, parentKey?: string): Promise<string> => {
  const baseCode = generateCode(name, 8);
  let code = baseCode;
  let counter = 1;
  
  while (await Model.findOne({ code })) {
    code = `${baseCode}${counter}`.substring(0, 10);
    counter++;
  }
  
  return code;
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
    const existingCollege = await College.findOne({ name: collegeName });
    if (existingCollege) {
      collegeId = existingCollege._id;
    } else {
      const collegeCode = await generateUniqueCode(collegeName, College);
      const college = await College.create({ name: collegeName, code: collegeCode });
      collegeId = college._id;
    }
  }

  if (departmentName) {
    const existingDept = await Department.findOne({ name: departmentName, collegeId: collegeId || null });
    if (existingDept) {
      departmentId = existingDept._id;
    } else {
      const departmentCode = await generateUniqueCode(departmentName, Department);
      const department = await Department.create({ name: departmentName, code: departmentCode, collegeId: collegeId || null });
      departmentId = department._id;
    }
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
