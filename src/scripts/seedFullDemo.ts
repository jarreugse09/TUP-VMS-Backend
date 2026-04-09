import mongoose from "mongoose";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";

import User from "../models/User";
import QRCode from "../models/QRCode";
import Log from "../models/Log";
import Attendance from "../models/Attendance";
import Activity from "../models/Activity";
import QRRequest from "../models/QRRequest";

import { generateQRString } from "../utils/qrUtils";
import { resolveOrganizationRefs } from "../utils/orgStructure";

dotenv.config();

/* ================= CONFIG ================= */

const MONGO = process.env.MONGODB_URI || "mongodb://localhost:27017/tup-vms";

const START = new Date("2026-01-01");
const END = new Date("2026-04-30");

const TOTAL_USERS = 200; // 🔥 SMALL DATA FOR REAL LOGIN TESTING

const STUDENT_COUNT = Math.floor(TOTAL_USERS * 0.8);
const STAFF_COUNT = Math.floor(TOTAL_USERS * 0.15);
const VISITOR_COUNT = TOTAL_USERS - STUDENT_COUNT - STAFF_COUNT;

const STAFF_TYPES = ["Admin", "Guard", "Normal", "Registrar", "Teacher"];
const STUDENT_FIRST_NAMES = [
  "Alyssa",
  "Bianca",
  "Carl",
  "Danica",
  "Ethan",
  "Frances",
  "Gabriel",
  "Hannah",
  "Isaac",
  "Janelle",
  "Kyle",
  "Lara",
  "Miguel",
  "Nina",
  "Oscar",
  "Paula",
  "Quinn",
  "Rafael",
  "Sophia",
  "Tristan",
  "Una",
  "Vincent",
  "Wendy",
  "Xavier",
  "Ysa",
  "Zachary",
  "Adrian",
  "Bea",
  "Cedrick",
  "Dianne",
  "Elaine",
  "Felix",
  "Gianna",
  "Harold",
  "Ivy",
  "Jasper",
  "Kristine",
  "Lorenzo",
  "Mika",
  "Noel",
  "Patricia",
  "Rico",
  "Samantha",
  "Timothy",
  "Vanessa",
];
const STUDENT_MIDDLE_INITIALS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "R", "S", "T"];
const STUDENT_SURNAMES = [
  "Alcantara",
  "Bautista",
  "Castillo",
  "Dela Cruz",
  "Evangelista",
  "Fernandez",
  "Garcia",
  "Hernandez",
  "Ignacio",
  "Jimenez",
  "Lopez",
  "Mendoza",
  "Navarro",
  "Ocampo",
  "Panganiban",
  "Quizon",
  "Ramirez",
  "Santos",
  "Torres",
  "Valdez",
  "Aquino",
  "Bernardo",
  "Cabrera",
  "Domingo",
  "Espiritu",
  "Flores",
  "Gonzales",
  "Hilario",
  "Ilagan",
  "Jose",
  "Luna",
  "Marquez",
  "Natividad",
  "Ortega",
  "Pascual",
  "Reyes",
  "Salazar",
  "Tiongson",
  "Umali",
  "Villanueva",
];

const DOMAIN = "gmail.com";

// 🔥 reduced transactions for performance
const TRANSACTION_SCALE = 0.4; // 60% reduction in transactions

/* ================= HELPERS ================= */

const addDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

const rand = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const chance = (p: number) => Math.random() < p;

const time = (date: Date, h: number, m: number = 0) => {
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
};

const photo = (name: string) =>
  `https://placehold.co/100x100?text=${encodeURIComponent(name)}`;

const buildStudentIdentity = (index: number) => {
  const firstName = STUDENT_FIRST_NAMES[index % STUDENT_FIRST_NAMES.length];
  const middleInitial =
    STUDENT_MIDDLE_INITIALS[Math.floor(index / STUDENT_FIRST_NAMES.length) % STUDENT_MIDDLE_INITIALS.length];
  const surname =
    STUDENT_SURNAMES[
      Math.floor(index / (STUDENT_FIRST_NAMES.length * STUDENT_MIDDLE_INITIALS.length)) %
        STUDENT_SURNAMES.length
    ];

  return {
    firstName,
    surname,
    displayName: `${firstName} ${middleInitial}. ${surname}`,
    email: `${normalizeAscii(firstName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")}.${middleInitial.toLowerCase()}.${normalizeAscii(
      surname,
    )
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")}${index + 1}@${DOMAIN}`.replace(/\.\.+/g, "."),
  };
};

const normalizeAscii = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s.-]/g, "");

const buildOfficialEmail = (
  firstName: string,
  surname: string,
  seenEmails: Set<string>,
) => {
  const base = `${normalizeAscii(firstName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/(^\.|\.$)/g, "")}.${normalizeAscii(surname)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/(^\.|\.$)/g, "")}`.replace(/\.\.+/g, ".");

  let email = `${base}@tup.edu.ph`;
  let counter = 2;
  while (seenEmails.has(email)) {
    email = `${base}${counter}@tup.edu.ph`;
    counter += 1;
  }
  seenEmails.add(email);
  return email;
};

const FACULTY_COLLEGE_NAME_MAP: Record<string, string> = {
  "COLLEGE OF INDUSTRIAL EDUCATION (CIE)": "College of Industrial Education",
  "COLLEGE OF INDUSTRIAL TECHNOLOGY (CIT)": "College of Industrial Technology",
  "COLLEGE OF LIBERAL ARTS (CLA)": "College of Liberal Arts",
  "COLLEGE OF ENGINEERING (COE)": "College of Engineering",
  "COLLEGE OF ARCHITECTURE AND FINE ARTS (CAFA)":
    "College of Architecture and Fine Arts",
  "COLLEGE OF SCIENCE (COS)": "College of Science",
};

const COLLEGE_TEST_CODE_MAP: Record<string, string> = {
  "College of Industrial Education": "cie",
  "College of Industrial Technology": "cit",
  "College of Liberal Arts": "cla",
  "College of Engineering": "coe",
  "College of Architecture and Fine Arts": "cafa",
  "College of Science": "cos",
};

const normalizeCollegeName = (value?: string) =>
  FACULTY_COLLEGE_NAME_MAP[String(value || "").trim()] || String(value || "").trim();

const splitName = (fullName: string) => {
  const cleaned = normalizeAscii(fullName)
    .replace(/\b(MR|MS|MRS|DR|ENGR|PROF|ASST|ASSOC|OIC)\.?\b/gi, "")
    .replace(/\b(JR|SR)\.?\b/gi, (match) => match.replace(/\./g, ""))
    .replace(/\s+/g, " ")
    .trim();

  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "Unknown", surname: "User" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], surname: "User" };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    surname: parts[parts.length - 1],
  };
};

const normalizePersonKey = (fullName: string) =>
  normalizeAscii(fullName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const parseFacultySeeds = (): FacultySeed[] => {
  const facultyFilePath = path.resolve(
    __dirname,
    "../../../../tup-faculty.md",
  );

  if (!fs.existsSync(facultyFilePath)) {
    console.warn(`Faculty seed source not found: ${facultyFilePath}`);
    return [];
  }

  const content = fs.readFileSync(facultyFilePath, "utf8");
  const lines = content.split(/\r?\n/).map((line) => line.trim());

  const deanEmailByCollege = new Map<string, string>();
  const headEmailByDepartment = new Map<string, string>();
  const seeds: FacultySeed[] = [];
  const seenPeople = new Set<string>();

  let currentCollege: string | undefined;
  let currentDepartment: string | undefined;
  let currentDepartmentHeadKey: string | undefined;

  for (const line of lines) {
    if (!line || /^=+$/.test(line) || /^-+$/.test(line)) continue;

    if (line.startsWith("COLLEGE OF ")) {
      currentCollege = normalizeCollegeName(line);
      currentDepartment = undefined;
      currentDepartmentHeadKey = undefined;
      continue;
    }

    if (line.startsWith("COLLEGE DEAN:") || line.startsWith("OIC, COLLEGE DEAN:")) {
      if (!currentCollege) continue;
      const deanName = line
        .replace("OIC, COLLEGE DEAN:", "")
        .replace("COLLEGE DEAN:", "")
        .trim();
      const deanParts = splitName(deanName);
      deanEmailByCollege.set(
        currentCollege,
        `${normalizeAscii(deanParts.firstName)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ".")
          .replace(/(^\.|\.$)/g, "")}.${normalizeAscii(deanParts.surname)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ".")
          .replace(/(^\.|\.$)/g, "")}@tup.edu.ph`.replace(/\.\.+/g, "."),
      );
      continue;
    }

    const departmentMatch = line.match(/^---\s*(.+?)\s*---$/);
    if (departmentMatch) {
      currentDepartment = departmentMatch[1];
      currentDepartmentHeadKey = undefined;
      continue;
    }

    const headMatch = line.match(/^\((?:HEAD|OIC-HEAD):\s*(.+?)\)$/i);
    if (headMatch && currentDepartment) {
      const headName = headMatch[1].trim();
      currentDepartmentHeadKey = normalizePersonKey(headName);
      const headParts = splitName(headName);
      headEmailByDepartment.set(
        `${currentCollege}::${currentDepartment}`,
        `${normalizeAscii(headParts.firstName)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ".")
          .replace(/(^\.|\.$)/g, "")}.${normalizeAscii(headParts.surname)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ".")
          .replace(/(^\.|\.$)/g, "")}@tup.edu.ph`.replace(/\.\.+/g, "."),
      );
      continue;
    }

    if (!currentCollege || !currentDepartment || !line.includes(" - ")) continue;

    const [fullName, designation] = line.split(/\s+-\s+/, 2);
    if (!fullName || !designation) continue;

    const personKey = normalizePersonKey(fullName);
    if (seenPeople.has(`${currentCollege}::${currentDepartment}::${personKey}`)) {
      continue;
    }
    seenPeople.add(`${currentCollege}::${currentDepartment}::${personKey}`);

    const nameParts = splitName(fullName);
    const isDepartmentHead = personKey === currentDepartmentHeadKey;

    seeds.push({
      firstName: nameParts.firstName,
      surname: nameParts.surname,
      officeUnit: currentDepartment,
      designation: designation.trim(),
      role: "TUP",
      subRole: isDepartmentHead ? "department_head" : "faculty",
      college: currentCollege,
      department: currentDepartment,
      supervisorEmail: isDepartmentHead
        ? deanEmailByCollege.get(currentCollege)
        : headEmailByDepartment.get(`${currentCollege}::${currentDepartment}`),
    });
  }

  return seeds;
};

type OfficialSeed = {
  firstName: string;
  surname: string;
  officeUnit: string;
  designation: string;
  role?: "TUP" | "Staff";
  subRole?: string;
  staffType?: string;
  college?: string;
  department?: string;
  supervisorEmail?: string;
};

type TestUserSeed = {
  firstName: string;
  surname: string;
  email: string;
  role: "TUP" | "Staff" | "Student" | "Visitor";
  subRole?: string;
  staffType?: string;
  designation?: string;
  officeUnit?: string;
  college?: string;
  department?: string;
  supervisorEmail?: string;
  birthdate?: Date;
};

type FacultySeed = {
  firstName: string;
  surname: string;
  officeUnit: string;
  designation: string;
  role: "TUP";
  subRole: "faculty" | "department_head" | "dean";
  college?: string;
  department?: string;
  supervisorEmail?: string;
};

const PRESIDENT_EMAIL = "reynaldo.ramos@tup.edu.ph";
const OVPAA_EMAIL = "ryan.reyes@tup.edu.ph";
const OVPRE_EMAIL = "hasmin.ignacio@tup.edu.ph";
const OVPAF_EMAIL = "mona.purganan@tup.edu.ph";
const OVPPDSC_EMAIL = "connie.aunario@tup.edu.ph";

const TUP_OFFICIALS: OfficialSeed[] = [
  { firstName: "Reynaldo", surname: "Ramos", officeUnit: "Office of the President", designation: "University President", role: "TUP", subRole: "top_management" },
  { firstName: "Ryan", surname: "Reyes", officeUnit: "OVPAA", designation: "VP for Academic Affairs", role: "TUP", subRole: "top_management" },
  { firstName: "Hasmin", surname: "Ignacio", officeUnit: "OVPRE", designation: "VP for Research & Extension", role: "TUP", subRole: "top_management" },
  { firstName: "Mona", surname: "Purganan", officeUnit: "OVPAF", designation: "OIC-VP for Administration & Finance / University-Board Secretary", role: "TUP", subRole: "top_management" },
  { firstName: "Connie", surname: "Aunario", officeUnit: "OVPPDSC", designation: "VP for Planning, Development & Special Concerns / BAC Chairperson", role: "TUP", subRole: "top_management" },
  { firstName: "Purabella", surname: "Agron", officeUnit: "Internal Control Office / Internal Audit", designation: "Head", role: "TUP", subRole: "non_academic", supervisorEmail: PRESIDENT_EMAIL },
  { firstName: "Gina", surname: "Basa", officeUnit: "Institutional/International Linkages & External Affairs Office", designation: "Director", role: "TUP", subRole: "non_academic", supervisorEmail: PRESIDENT_EMAIL },

  { firstName: "May Ann", surname: "Codera", officeUnit: "College of Industrial Technology", designation: "OIC-Dean", role: "TUP", subRole: "dean", college: "College of Industrial Technology", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Gemma", surname: "Belga-Robles", officeUnit: "College of Industrial Technology", designation: "College Secretary", role: "TUP", subRole: "faculty", college: "College of Industrial Technology", supervisorEmail: "may.ann.codera@tup.edu.ph" },
  { firstName: "Andrew John", surname: "Mabaquiao", officeUnit: "Basic Industrial Technology / Power Plant Engineering Technology", designation: "Head / OIC-Head", role: "TUP", subRole: "department_head", college: "College of Industrial Technology", department: "Basic Industrial Technology", supervisorEmail: "may.ann.codera@tup.edu.ph" },
  { firstName: "Jhomalyn", surname: "Belardo", officeUnit: "Food and Apparel Technology", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Industrial Technology", department: "Food and Apparel Technology", supervisorEmail: "may.ann.codera@tup.edu.ph" },
  { firstName: "Lotis", surname: "Palma-Buco", officeUnit: "Graphic and Arts Department", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Industrial Technology", department: "Graphic and Arts Department", supervisorEmail: "may.ann.codera@tup.edu.ph" },
  { firstName: "Jerry", surname: "Ligaya", officeUnit: "Mechanical Engineering Technology", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Industrial Technology", department: "Mechanical Engineering Technology", supervisorEmail: "may.ann.codera@tup.edu.ph" },
  { firstName: "Jennifer", surname: "Andador", officeUnit: "Electrical Engineering Technology", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Industrial Technology", department: "Electrical Engineering Technology", supervisorEmail: "may.ann.codera@tup.edu.ph" },
  { firstName: "Aimee", surname: "Acoba", officeUnit: "Electronic Engineering Technology", designation: "OIC-Head", role: "TUP", subRole: "department_head", college: "College of Industrial Technology", department: "Electronic Engineering Technology", supervisorEmail: "may.ann.codera@tup.edu.ph" },
  { firstName: "Samuel", surname: "Pacba", officeUnit: "Civil Engineering Technology", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Industrial Technology", department: "Civil Engineering Technology", supervisorEmail: "may.ann.codera@tup.edu.ph" },

  { firstName: "Apollo", surname: "Portez", officeUnit: "College of Industrial Education / TUP Cuenca Extension", designation: "Dean / Administrator", role: "TUP", subRole: "dean", college: "College of Industrial Education", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Nestor", surname: "Murcia", officeUnit: "College of Industrial Education", designation: "College Secretary", role: "TUP", subRole: "faculty", college: "College of Industrial Education", supervisorEmail: "apollo.portez@tup.edu.ph" },
  { firstName: "Neil Andrew", surname: "Calayag", officeUnit: "Professional Industrial Education", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Industrial Education", department: "Professional Industrial Education", supervisorEmail: "apollo.portez@tup.edu.ph" },
  { firstName: "Sylvia", surname: "Guevarra", officeUnit: "Student Teaching", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Industrial Education", department: "Student Teaching", supervisorEmail: "apollo.portez@tup.edu.ph" },
  { firstName: "Allan", surname: "Villariza", officeUnit: "Technical Arts", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Industrial Education", department: "Technical Arts", supervisorEmail: "apollo.portez@tup.edu.ph" },
  { firstName: "Dorothy", surname: "Manalansan", officeUnit: "Home Economics", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Industrial Education", department: "Home Economics", supervisorEmail: "apollo.portez@tup.edu.ph" },

  { firstName: "Lean Karlo", surname: "Tolentino", officeUnit: "College of Engineering", designation: "Dean", role: "TUP", subRole: "dean", college: "College of Engineering", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Jessica", surname: "Velasco", officeUnit: "College of Engineering", designation: "College Secretary", role: "TUP", subRole: "faculty", college: "College of Engineering", supervisorEmail: "lean.karlo.tolentino@tup.edu.ph" },
  { firstName: "Cherry", surname: "Pascion", officeUnit: "Electronics Communication Engineering", designation: "OIC-Head", role: "TUP", subRole: "department_head", college: "College of Engineering", department: "Electronics Communication Engineering", supervisorEmail: "lean.karlo.tolentino@tup.edu.ph" },
  { firstName: "Roel", surname: "Mendoza", officeUnit: "Electrical Engineering", designation: "OIC-Head", role: "TUP", subRole: "department_head", college: "College of Engineering", department: "Electrical Engineering", supervisorEmail: "lean.karlo.tolentino@tup.edu.ph" },
  { firstName: "Sandra", surname: "Hollman", officeUnit: "Mechanical Engineering", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Engineering", department: "Mechanical Engineering", supervisorEmail: "lean.karlo.tolentino@tup.edu.ph" },
  { firstName: "Marjun", surname: "Macasilhig", officeUnit: "Civil Engineering", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Engineering", department: "Civil Engineering", supervisorEmail: "lean.karlo.tolentino@tup.edu.ph" },

  { firstName: "Joshua", surname: "Soriano", officeUnit: "College of Science", designation: "Acting Dean", role: "TUP", subRole: "dean", college: "College of Science", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Mary Sheenalyn", surname: "Rodil", officeUnit: "College of Science", designation: "College Secretary", role: "TUP", subRole: "faculty", college: "College of Science", supervisorEmail: "joshua.soriano@tup.edu.ph" },
  { firstName: "Maria Carmelita", surname: "Sapina", officeUnit: "Chemistry", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Science", department: "Chemistry", supervisorEmail: "joshua.soriano@tup.edu.ph" },
  { firstName: "Dolores", surname: "Montesines", officeUnit: "Computer Studies", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Science", department: "Computer Studies", supervisorEmail: "joshua.soriano@tup.edu.ph" },
  { firstName: "Melchor", surname: "Pacer", officeUnit: "Mathematics", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Science", department: "Mathematics", supervisorEmail: "joshua.soriano@tup.edu.ph" },
  { firstName: "Aldrin", surname: "Chang", officeUnit: "Physics", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Science", department: "Physics", supervisorEmail: "joshua.soriano@tup.edu.ph" },

  { firstName: "Elpidio", surname: "Balais", officeUnit: "College of Architecture and Fine Arts", designation: "Dean", role: "TUP", subRole: "dean", college: "College of Architecture and Fine Arts", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Kenneth", surname: "Tributo", officeUnit: "College of Architecture and Fine Arts", designation: "College Secretary", role: "TUP", subRole: "faculty", college: "College of Architecture and Fine Arts", supervisorEmail: "elpidio.balais@tup.edu.ph" },
  { firstName: "Melvin", surname: "Mojica", officeUnit: "Graphics", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Architecture and Fine Arts", department: "Graphics", supervisorEmail: "elpidio.balais@tup.edu.ph" },
  { firstName: "Rosellia Rowena", surname: "Manzano", officeUnit: "Architecture", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Architecture and Fine Arts", department: "Architecture", supervisorEmail: "elpidio.balais@tup.edu.ph" },
  { firstName: "Wilma", surname: "Enriquez", officeUnit: "Fine Arts", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Architecture and Fine Arts", department: "Fine Arts", supervisorEmail: "elpidio.balais@tup.edu.ph" },

  { firstName: "Michael Bhobet", surname: "Baluyot", officeUnit: "College of Liberal Arts", designation: "Dean", role: "TUP", subRole: "dean", college: "College of Liberal Arts", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Rose Ann", surname: "Panti", officeUnit: "College of Liberal Arts", designation: "College Secretary", role: "TUP", subRole: "faculty", college: "College of Liberal Arts", supervisorEmail: "michael.bhobet.baluyot@tup.edu.ph" },
  { firstName: "Marie Jo Tess", surname: "Ragos", officeUnit: "Languages", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Liberal Arts", department: "Languages", supervisorEmail: "michael.bhobet.baluyot@tup.edu.ph" },
  { firstName: "Noemie", surname: "Bunye", officeUnit: "Social Science", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Liberal Arts", department: "Social Science", supervisorEmail: "michael.bhobet.baluyot@tup.edu.ph" },
  { firstName: "Jerson", surname: "Monsad", officeUnit: "Entrepreneurship and Management", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Liberal Arts", department: "Entrepreneurship and Management", supervisorEmail: "michael.bhobet.baluyot@tup.edu.ph" },
  { firstName: "Ma. Dina", surname: "Jimenez", officeUnit: "Hospitality Management", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Liberal Arts", department: "Hospitality Management", supervisorEmail: "michael.bhobet.baluyot@tup.edu.ph" },
  { firstName: "Bernadette L.", surname: "Alavazo", officeUnit: "Physical Education", designation: "Head", role: "TUP", subRole: "department_head", college: "College of Liberal Arts", department: "Physical Education", supervisorEmail: "michael.bhobet.baluyot@tup.edu.ph" },

  { firstName: "Melbern Rose", surname: "Maltezo", officeUnit: "Graduate Programs", designation: "Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Arjun", surname: "Ansay", officeUnit: "Office of Alumni Relations", designation: "Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Rosemarie Theresa", surname: "Cruz", officeUnit: "Registrar / Admissions Office", designation: "University Registrar / Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Ghazali Illuminada", surname: "Sison", officeUnit: "Academic Programs", designation: "Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Margaret", surname: "Aquino", officeUnit: "Office of Student Affairs", designation: "Dean", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Kevien", surname: "Dela Cruz", officeUnit: "ETEEAP", designation: "Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Allan", surname: "Soria", officeUnit: "University Sports", designation: "Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Bernadette S.", surname: "Alavazo", officeUnit: "Sports and Cultural Affairs", designation: "Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Beverly", surname: "Yabut", officeUnit: "Cultural Affairs", designation: "Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Ruel", surname: "Aggabao", officeUnit: "Industrial Relations and Job Placement", designation: "Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Olga", surname: "Ong", officeUnit: "University Library & Learning Resources", designation: "Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Maryfel", surname: "Lumen", officeUnit: "University Library & Learning Resources", designation: "Asst. Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Enrico", surname: "Lucena", officeUnit: "Guidance Office", designation: "Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Hadji", surname: "Alegre", officeUnit: "Educational Resource Development Services", designation: "Officer-In-Charge", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Reggie", surname: "Campomanes", officeUnit: "National Service Training Program (NSTP)", designation: "Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Elpidio S.", surname: "Virrey", officeUnit: "TUP Lopez, Quezon", designation: "Administrator", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Carlos", surname: "Perion", officeUnit: "TUP Lopez, Quezon", designation: "Coordinator", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Dionisio", surname: "Espression", officeUnit: "TUP Museum", designation: "Curator", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAA_EMAIL },
  { firstName: "Marcelina", surname: "Puga", officeUnit: "TUP Museum", designation: "Faculty-in-Charge", role: "TUP", subRole: "faculty", supervisorEmail: OVPAA_EMAIL },

  { firstName: "Vicky", surname: "Galiza", officeUnit: "Administrative Services", designation: "CAO", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAF_EMAIL },
  { firstName: "Rovenson", surname: "Sevilla", officeUnit: "Auxiliary Services", designation: "Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAF_EMAIL },
  { firstName: "Reginald Panfilo", surname: "Taar", officeUnit: "Civil Security Office", designation: "Head", role: "Staff", subRole: "security_head", staffType: "Security", supervisorEmail: OVPAF_EMAIL },
  { firstName: "Christopher", surname: "Mortel", officeUnit: "Human Resource Management Office", designation: "Head", role: "Staff", subRole: "hr_head", staffType: "Admin", supervisorEmail: OVPAF_EMAIL },
  { firstName: "Vivian", surname: "Santos", officeUnit: "Financial Services / Budget Office", designation: "OIC-Finance Director / Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAF_EMAIL },
  { firstName: "Marites", surname: "Bolaños", officeUnit: "Financial Services", designation: "Chief Finance Officer", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAF_EMAIL },
  { firstName: "Teresa", surname: "Ramos", officeUnit: "Accounting Office", designation: "Accountant III", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAF_EMAIL },
  { firstName: "Jennifer Dianne", surname: "Gimena", officeUnit: "Cashiers Office", designation: "Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAF_EMAIL },
  { firstName: "Susana DG.", surname: "Uy", officeUnit: "Supply & Property Office", designation: "Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAF_EMAIL },
  { firstName: "Jonathan", surname: "Monsad", officeUnit: "Records Management Office", designation: "Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAF_EMAIL },
  { firstName: "Peragrino", surname: "Amador", officeUnit: "Procurement Office", designation: "Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAF_EMAIL },
  { firstName: "Abigail", surname: "Marcelo", officeUnit: "Dental Services", designation: "Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAF_EMAIL },
  { firstName: "Emmanuel", surname: "Ruiz", officeUnit: "Medical Services", designation: "Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPAF_EMAIL },

  { firstName: "Nilo", surname: "Arago", officeUnit: "Integrated Research and Training Center", designation: "Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPRE_EMAIL },
  { firstName: "Heronafine", surname: "De Guzman", officeUnit: "University Research and Development Services / Technology Licensing Office / ITSO", designation: "Acting Director / OIC-Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPRE_EMAIL },
  { firstName: "Francisco", surname: "Esponilla", officeUnit: "University Extension Services", designation: "Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPRE_EMAIL },
  { firstName: "Raymund", surname: "Masangya", officeUnit: "Internal Affairs", designation: "Special Assistant", role: "TUP", subRole: "non_academic", supervisorEmail: OVPRE_EMAIL },
  { firstName: "Olivia", surname: "Oliva", officeUnit: "External Affairs", designation: "Special Assistant", role: "TUP", subRole: "non_academic", supervisorEmail: OVPRE_EMAIL },

  { firstName: "Juan Paulo", surname: "Bersamina", officeUnit: "Infrastructure Management and Development", designation: "Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPPDSC_EMAIL },
  { firstName: "Julius", surname: "Sareno", officeUnit: "University Information Technology Center", designation: "Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPPDSC_EMAIL },
  { firstName: "Michael", surname: "Narisma", officeUnit: "Network Management Unit", designation: "Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPPDSC_EMAIL },
  { firstName: "Vicente", surname: "Estember", officeUnit: "System Development Unit", designation: "Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPPDSC_EMAIL },
  { firstName: "Priscilla", surname: "Bator", officeUnit: "Management Information System", designation: "Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPPDSC_EMAIL },
  { firstName: "Michael", surname: "Corpuz", officeUnit: "ICT Repair and Maintenance Unit", designation: "Head", role: "TUP", subRole: "maintenance", supervisorEmail: OVPPDSC_EMAIL },
  { firstName: "Wendy", surname: "Anas", officeUnit: "Web Management Unit", designation: "Faculty In-Charge", role: "TUP", subRole: "faculty", supervisorEmail: OVPPDSC_EMAIL },
  { firstName: "Ernita", surname: "Calayag", officeUnit: "Planning Development Office", designation: "OIC-Director", role: "TUP", subRole: "non_academic", supervisorEmail: OVPPDSC_EMAIL },
  { firstName: "Lyndon", surname: "Bague", officeUnit: "QAACSO / Senior Citizens & PWD", designation: "Director / Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPPDSC_EMAIL },
  { firstName: "Eileen Grace", surname: "Dakiapo", officeUnit: "Gender and Development", designation: "OIC-Focal Person / Head", role: "TUP", subRole: "non_academic", supervisorEmail: OVPPDSC_EMAIL },
];

const RBAC_TEST_USERS: TestUserSeed[] = [
  {
    firstName: "TopMgmt",
    surname: "Test",
    email: "topmgmt.test@tup.edu.ph",
    role: "TUP",
    subRole: "top_management",
    designation: "Executive Test Account",
    officeUnit: "Office of the President",
  },
  {
    firstName: "Dean",
    surname: "Test",
    email: "dean.test@tup.edu.ph",
    role: "TUP",
    subRole: "dean",
    designation: "Dean Test Account",
    officeUnit: "College of Engineering",
    college: "College of Engineering",
    supervisorEmail: OVPAA_EMAIL,
  },
  {
    firstName: "DeptHead",
    surname: "Test",
    email: "depthead.test@tup.edu.ph",
    role: "TUP",
    subRole: "department_head",
    designation: "Department Head Test Account",
    officeUnit: "Mechanical Engineering",
    college: "College of Engineering",
    department: "Mechanical Engineering",
    supervisorEmail: "dean.test@tup.edu.ph",
  },
  {
    firstName: "Faculty",
    surname: "Test",
    email: "faculty.test@tup.edu.ph",
    role: "TUP",
    subRole: "faculty",
    designation: "Faculty Test Account",
    officeUnit: "Mechanical Engineering",
    college: "College of Engineering",
    department: "Mechanical Engineering",
    supervisorEmail: "depthead.test@tup.edu.ph",
  },
  {
    firstName: "NonAcademic",
    surname: "Test",
    email: "nonacademic.test@tup.edu.ph",
    role: "TUP",
    subRole: "non_academic",
    designation: "Non-Academic Test Account",
    officeUnit: "Registrar",
    supervisorEmail: OVPAA_EMAIL,
  },
  {
    firstName: "Maintenance",
    surname: "Test",
    email: "maintenance.test@tup.edu.ph",
    role: "TUP",
    subRole: "maintenance",
    designation: "Maintenance Test Account",
    officeUnit: "ICT Repair and Maintenance Unit",
    supervisorEmail: OVPPDSC_EMAIL,
  },
  {
    firstName: "HRHead",
    surname: "Test",
    email: "hrhead.test@tup.edu.ph",
    role: "Staff",
    subRole: "hr_head",
    staffType: "Admin",
    designation: "HR Head Test Account",
    officeUnit: "Human Resource Management Office",
    supervisorEmail: OVPAF_EMAIL,
  },
  {
    firstName: "HRStaff",
    surname: "Test",
    email: "hrstaff.test@tup.edu.ph",
    role: "Staff",
    subRole: "hr_staff",
    staffType: "Admin",
    designation: "HR Staff Test Account",
    officeUnit: "Human Resource Management Office",
    supervisorEmail: "hrhead.test@tup.edu.ph",
  },
  {
    firstName: "SecurityHead",
    surname: "Test",
    email: "securityhead.test@tup.edu.ph",
    role: "Staff",
    subRole: "security_head",
    staffType: "Security",
    designation: "Security Head Test Account",
    officeUnit: "Civil Security Office",
    supervisorEmail: OVPAF_EMAIL,
  },
  {
    firstName: "SecurityStaff",
    surname: "Test",
    email: "securitystaff.test@tup.edu.ph",
    role: "Staff",
    subRole: "security_staff",
    staffType: "Security",
    designation: "Security Staff Test Account",
    officeUnit: "Civil Security Office",
    supervisorEmail: "securityhead.test@tup.edu.ph",
  },
  {
    firstName: "Student",
    surname: "Test",
    email: "student.test@tup.edu.ph",
    role: "Student",
    designation: "Student Test Account",
  },
  {
    firstName: "Visitor",
    surname: "Test",
    email: "visitor.test@tup.edu.ph",
    role: "Visitor",
    designation: "Visitor Test Account",
  },
];

const buildCollegeScopedTestUsers = (): TestUserSeed[] => {
  const academicColleges = Array.from(
    new Set(
      TUP_OFFICIALS.filter(
        (official) => official.role === "TUP" && official.subRole === "dean" && official.college,
      ).map((official) => normalizeCollegeName(official.college)),
    ),
  );

  return academicColleges.flatMap((college) => {
    const collegeCode = COLLEGE_TEST_CODE_MAP[college] || normalizeAscii(college).toLowerCase().replace(/[^a-z0-9]+/g, "");
    const dean = TUP_OFFICIALS.find(
      (official) =>
        official.role === "TUP" &&
        official.subRole === "dean" &&
        normalizeCollegeName(official.college) === college,
    );
    const departmentHead = TUP_OFFICIALS.find(
      (official) =>
        official.role === "TUP" &&
        official.subRole === "department_head" &&
        normalizeCollegeName(official.college) === college,
    );
    const faculty = TUP_OFFICIALS.find(
      (official) =>
        official.role === "TUP" &&
        official.subRole === "faculty" &&
        normalizeCollegeName(official.college) === college,
    );

    const deanEmail = `dean.${collegeCode}.test@tup.edu.ph`;
    const deptHeadEmail = `depthead.${collegeCode}.test@tup.edu.ph`;

    return [
      {
        firstName: `Dean${collegeCode.toUpperCase()}`,
        surname: "Test",
        email: deanEmail,
        role: "TUP",
        subRole: "dean",
        designation: `${college} Dean Test Account`,
        officeUnit: dean?.officeUnit || college,
        college,
        supervisorEmail: OVPAA_EMAIL,
      },
      {
        firstName: `DeptHead${collegeCode.toUpperCase()}`,
        surname: "Test",
        email: deptHeadEmail,
        role: "TUP",
        subRole: "department_head",
        designation: `${college} Department Head Test Account`,
        officeUnit: departmentHead?.officeUnit || college,
        college,
        department: departmentHead?.department,
        supervisorEmail: deanEmail,
      },
      {
        firstName: `Faculty${collegeCode.toUpperCase()}`,
        surname: "Test",
        email: `faculty.${collegeCode}.test@tup.edu.ph`,
        role: "TUP",
        subRole: "faculty",
        designation: `${college} Faculty Test Account`,
        officeUnit: faculty?.officeUnit || departmentHead?.officeUnit || college,
        college,
        department: faculty?.department || departmentHead?.department,
        supervisorEmail: deptHeadEmail,
      },
    ];
  });
};

const COLLEGE_RBAC_TEST_USERS: TestUserSeed[] = buildCollegeScopedTestUsers();
const ALL_RBAC_TEST_USERS: TestUserSeed[] = [
  ...RBAC_TEST_USERS,
  ...COLLEGE_RBAC_TEST_USERS,
];

/* ================= MAIN ================= */

async function run() {
  await mongoose.connect(MONGO);
  console.log("Connected DB");

  /* ================= CLEAN ================= */

  await Promise.all([
    User.deleteMany({}),
    QRCode.deleteMany({}),
    Log.deleteMany({}),
    Attendance.deleteMany({}),
    Activity.deleteMany({}),
    QRRequest.deleteMany({}),
  ]);

  /* ================= ADMIN ================= */

  const adminPass = await bcrypt.hash("technovisitor", 10);

  const admin = await User.create({
    firstName: "TUP",
    surname: "Admin",
    role: "TUP",
    email: "tup-vms@gmail.com",
    passwordHash: adminPass,
    birthdate: new Date("1990-01-01"),
    photoURL: photo("TUP"),
    status: "Active",
  });

  /* ================= USERS ================= */

  console.log("Creating users...");

  const users: any[] = [];
  const seenEmails = new Set<string>([admin.email]);
  const supervisorEmailByUserEmail = new Map<string, string>();
  const seenPeople = new Set<string>();

  const createUsers = async (
    role: "Student" | "Staff" | "Visitor",
    count: number
  ) => {
    const password = await bcrypt.hash(`${role.toLowerCase()}123!`, 10);

    for (let i = 1; i <= count; i++) {
      const studentIdentity =
        role === "Student" ? buildStudentIdentity(i - 1) : null;

      users.push({
        firstName: studentIdentity?.firstName || `${role}_${i}`,
        surname: studentIdentity?.surname || "Demo",
        birthdate:
          role === "Student"
            ? new Date("2005-01-01")
            : new Date("1990-01-01"),
        role,
        staffType:
          role === "Staff"
            ? STAFF_TYPES[rand(0, STAFF_TYPES.length - 1)]
            : undefined,
        email: studentIdentity?.email || `${role.toLowerCase()}_${i}@${DOMAIN}`,
        passwordHash: password,
        photoURL: photo(studentIdentity?.displayName || `${role}_${i}`),
        status: "Active",
        mustCapturePhoto: false,
        createdAt: new Date(),
      });
    }
  };

  await createUsers("Student", STUDENT_COUNT);
  await createUsers("Staff", STAFF_COUNT);
  await createUsers("Visitor", VISITOR_COUNT);

  console.log("Creating TUP officials...");

  for (const official of TUP_OFFICIALS) {
    const personKey = normalizePersonKey(`${official.firstName} ${official.surname}`);
    if (seenPeople.has(personKey)) continue;
    seenPeople.add(personKey);

    const passwordHash = await bcrypt.hash(
      `${official.firstName.split(/\s+/)[0]}123`,
      10,
    );
    const email = buildOfficialEmail(
      official.firstName,
      official.surname,
      seenEmails,
    );
    const orgRefs = await resolveOrganizationRefs({
      college: official.college,
      department: official.department,
    });

    users.push({
      firstName: official.firstName,
      surname: official.surname,
      birthdate: new Date("1985-01-01"),
      role: official.role || "TUP",
      subRole: official.subRole,
      staffType: official.staffType,
      designation: official.designation,
      officeUnit: official.officeUnit,
      college: orgRefs.college,
      collegeId: orgRefs.collegeId,
      department: orgRefs.department,
      departmentId: orgRefs.departmentId,
      email,
      passwordHash,
      photoURL: photo(`${official.firstName} ${official.surname}`),
      status: "Active",
      mustCapturePhoto: false,
      createdAt: new Date(),
    });

    if (official.supervisorEmail) {
      supervisorEmailByUserEmail.set(email, official.supervisorEmail);
    }
  }

  console.log("Creating faculty from tup-faculty.md...");

  const facultySeeds = parseFacultySeeds();
  for (const faculty of facultySeeds) {
    const personKey = normalizePersonKey(`${faculty.firstName} ${faculty.surname}`);
    if (seenPeople.has(personKey)) continue;
    seenPeople.add(personKey);

    const passwordHash = await bcrypt.hash(
      `${faculty.firstName.split(/\s+/)[0]}123`,
      10,
    );
    const email = buildOfficialEmail(
      faculty.firstName,
      faculty.surname,
      seenEmails,
    );
    const orgRefs = await resolveOrganizationRefs({
      college: faculty.college,
      department: faculty.department,
    });

    users.push({
      firstName: faculty.firstName,
      surname: faculty.surname,
      birthdate: new Date("1987-01-01"),
      role: faculty.role,
      subRole: faculty.subRole,
      designation: faculty.designation,
      officeUnit: faculty.officeUnit,
      college: orgRefs.college,
      collegeId: orgRefs.collegeId,
      department: orgRefs.department,
      departmentId: orgRefs.departmentId,
      email,
      passwordHash,
      photoURL: photo(`${faculty.firstName} ${faculty.surname}`),
      status: "Active",
      mustCapturePhoto: false,
      createdAt: new Date(),
    });

    if (faculty.supervisorEmail) {
      supervisorEmailByUserEmail.set(email, faculty.supervisorEmail);
    }
  }

  console.log("Creating RBAC test users...");

  for (const testUser of ALL_RBAC_TEST_USERS) {
    const personKey = normalizePersonKey(`${testUser.firstName} ${testUser.surname}`);
    if (seenPeople.has(personKey)) continue;
    seenPeople.add(personKey);

    seenEmails.add(testUser.email.toLowerCase());
    const passwordHash = await bcrypt.hash(`${testUser.firstName}123`, 10);
    const orgRefs = await resolveOrganizationRefs({
      college: testUser.college,
      department: testUser.department,
    });

    users.push({
      firstName: testUser.firstName,
      surname: testUser.surname,
      birthdate: testUser.birthdate || new Date("1992-01-01"),
      role: testUser.role,
      subRole: testUser.subRole,
      staffType: testUser.staffType,
      designation: testUser.designation,
      officeUnit: testUser.officeUnit,
      college: orgRefs.college,
      collegeId: orgRefs.collegeId,
      department: orgRefs.department,
      departmentId: orgRefs.departmentId,
      email: testUser.email.toLowerCase(),
      passwordHash,
      photoURL: photo(`${testUser.firstName} ${testUser.surname}`),
      status: "Active",
      mustCapturePhoto: false,
      createdAt: new Date(),
    });

    if (testUser.supervisorEmail) {
      supervisorEmailByUserEmail.set(
        testUser.email.toLowerCase(),
        testUser.supervisorEmail.toLowerCase(),
      );
    }
  }

  const insertedUsers = await User.insertMany(users);

  if (supervisorEmailByUserEmail.size > 0) {
    const userIdByEmail = new Map(
      insertedUsers.map((user: any) => [String(user.email).toLowerCase(), user._id]),
    );

    const supervisorUpdates = Array.from(supervisorEmailByUserEmail.entries())
      .map(([email, supervisorEmail]) => {
        const userId = userIdByEmail.get(email.toLowerCase());
        const supervisorId = userIdByEmail.get(supervisorEmail.toLowerCase());
        if (!userId || !supervisorId) return null;

        return {
          updateOne: {
            filter: { _id: userId },
            update: { $set: { supervisorId } },
          },
        };
      })
      .filter(Boolean) as any[];

    if (supervisorUpdates.length > 0) {
      await User.bulkWrite(supervisorUpdates);
    }
  }

  /* ================= QR ================= */

  console.log("Creating QR codes...");

  const qrDocs: any[] = [];
  const userQRMap: Record<string, any> = {};

  for (const u of insertedUsers) {
    const qrRole = u.role === "TUP" ? "Staff" : u.role;
    qrDocs.push({
      userId: u._id,
      qrString: generateQRString(qrRole),
      isActive: true,
    });
  }

  const insertedQRs = await QRCode.insertMany(qrDocs);

  insertedQRs.forEach((qr) => {
    userQRMap[qr.userId.toString()] = qr;
  });

  /* ================= QR REQUESTS ================= */

  console.log("Creating QR Requests...");

  const qrRequests: any[] = [];

  for (const u of insertedUsers) {
    if (chance(0.05)) {
      const type = chance(0.7) ? "QR" : "PROFILE_PHOTO";

      let status: "Pending" | "Approved" | "Rejected" = "Pending";
      const r = Math.random();

      if (r < 0.7) status = "Approved";
      else if (r < 0.9) status = "Pending";
      else status = "Rejected";

      const qrData = userQRMap[u._id.toString()];

      qrRequests.push({
        userId: u._id,
        requestType: type,
        oldQR: qrData?.qrString,
        reason: ["Lost ID", "Damaged QR", "Update Info"][rand(0, 2)],
        newQRString:
          type === "QR" && status === "Approved"
            ? generateQRString(u.role === "TUP" ? "Staff" : u.role)
            : undefined,
        newQRImage: type === "QR" ? "https://placehold.co/300x300" : undefined,
        oldPhotoURL: type === "PROFILE_PHOTO" ? u.photoURL : undefined,
        newPhotoImage: type === "PROFILE_PHOTO" ? photo("NEW") : undefined,
        status,
        approvedBy: status === "Approved" ? admin._id : undefined,
      });
    }
  }

  await QRRequest.insertMany(qrRequests);

  /* ================= DATA ================= */

  console.log("Generating logs, attendance, transactions...");

  const logs: any[] = [];
  const attendance: any[] = [];
  const activities: any[] = [];

  let date = new Date(START);

  while (date <= END) {
    const day = date.getDay();
    const activeUsers: string[] = [];

    for (const u of insertedUsers) {
      const id = u._id.toString();
      const qr = userQRMap[id];

      if (!qr) continue;

      /* ===== WEEKDAY STAFF ===== */
      if ((u.role === "Staff" || u.role === "TUP") && day !== 0 && day !== 6) {
        const tin = time(date, 8, rand(0, 30));
        const tout = time(date, 17, rand(0, 60));

        attendance.push({
          staffId: u._id,
          date,
          timeIn: tin,
          timeOut: tout,
          scannedBy: admin._id,
        });

        logs.push({
          userId: u._id,
          qrId: qr._id,
          date,
          timeIn: tin,
          timeOut: tout,
          status: "Checked Out",
          reason: "attendance",
          scannedBy: admin._id,
        });

        activeUsers.push(id);
      }

      /* ===== WEEKDAY STUDENTS / VISITORS ===== */
      if (
        (u.role === "Student" || u.role === "Visitor") &&
        day !== 0 &&
        day !== 6 &&
        chance(0.7)
      ) {
        const tin = time(date, rand(7, 9), rand(0, 59));
        const tout = chance(0.9)
          ? time(date, rand(15, 18), rand(0, 59))
          : null;

        logs.push({
          userId: u._id,
          qrId: qr._id,
          date,
          timeIn: tin,
          timeOut: tout,
          status: tout ? "Checked Out" : "In TUP",
          reason: "checkin",
          scannedBy: admin._id,
        });

        activeUsers.push(id);
      }

      /* ===== SATURDAY ===== */

      if (u.role === "Student" && day === 6 && chance(0.08)) {
        const tin = time(date, rand(8, 10), rand(0, 59));
        const tout = chance(0.8)
          ? time(date, rand(13, 17), rand(0, 59))
          : null;

        logs.push({
          userId: u._id,
          qrId: qr._id,
          date,
          timeIn: tin,
          timeOut: tout,
          status: tout ? "Checked Out" : "In TUP",
          reason: "weekend",
          scannedBy: admin._id,
        });

        activeUsers.push(id);
      }

      if ((u.role === "Staff" || u.role === "TUP") && day === 6 && chance(0.5)) {
        const tin = time(date, rand(8, 9), rand(0, 59));
        const tout = time(date, rand(12, 16), rand(0, 59));

        attendance.push({
          staffId: u._id,
          date,
          timeIn: tin,
          timeOut: tout,
          scannedBy: admin._id,
        });

        logs.push({
          userId: u._id,
          qrId: qr._id,
          date,
          timeIn: tin,
          timeOut: tout,
          status: "Checked Out",
          reason: "weekend-attendance",
          scannedBy: admin._id,
        });

        activeUsers.push(id);
      }

      if (u.role === "Visitor" && day === 6 && chance(0.2)) {
        const tin = time(date, rand(9, 11), rand(0, 59));
        const tout = chance(0.8)
          ? time(date, rand(14, 17), rand(0, 59))
          : null;

        logs.push({
          userId: u._id,
          qrId: qr._id,
          date,
          timeIn: tin,
          timeOut: tout,
          status: tout ? "Checked Out" : "In TUP",
          reason: "visit",
          scannedBy: admin._id,
        });

        activeUsers.push(id);
      }

      /* ===== SUNDAY (STAFF ONLY) ===== */
      if ((u.role === "Staff" || u.role === "TUP") && day === 0 && chance(0.05)) {
        const tin = time(date, 8, rand(0, 30));
        const tout = time(date, 12, rand(0, 59));

        attendance.push({
          staffId: u._id,
          date,
          timeIn: tin,
          timeOut: tout,
          scannedBy: admin._id,
        });

        logs.push({
          userId: u._id,
          qrId: qr._id,
          date,
          timeIn: tin,
          timeOut: tout,
          status: "Checked Out",
          reason: "sunday-duty",
          scannedBy: admin._id,
        });

        activeUsers.push(id);
      }
    }

    /* ===== TRANSACTIONS ===== */

    const transCount = Math.max(
      1,
      Math.floor(rand(1, 5) * TRANSACTION_SCALE)
    );

    for (let i = 0; i < transCount; i++) {
      if (activeUsers.length < 2) break;

      const from = activeUsers[rand(0, activeUsers.length - 1)];
      const to = activeUsers[rand(0, activeUsers.length - 1)];

      if (from === to) continue;

      const fromQR = userQRMap[from];
      const toQR = userQRMap[to];

      if (!fromQR || !toQR) continue;

      logs.push({
        userId: from,
        transId: to,
        qrId: toQR._id,
        date,
        timeIn: new Date(date),
        status: "Transaction",
        reason: "transaction",
        scannedBy: from,
      });

      activities.push({
        fromUserId: from,
        toUserId: to,
        fromQR: fromQR.qrString,
        toQR: toQR.qrString,
        activityType: ["Transaction", "Meeting", "Assistance"][rand(0, 2)],
        timestamp: new Date(date),
      });
    }

    date = addDays(date, 1);
  }

  /* ================= INSERT ================= */

  console.log("Inserting logs...");
  await Log.insertMany(logs, { ordered: false });

  console.log("Inserting attendance...");
  await Attendance.insertMany(attendance, { ordered: false });

  console.log("Inserting activities...");
  await Activity.insertMany(activities, { ordered: false });

  console.log("✅ SEED COMPLETE (LIGHTWEIGHT)");
  console.log("RBAC test accounts:");
  ALL_RBAC_TEST_USERS.forEach((user) => {
    console.log(
      `- ${user.email} | password: ${user.firstName}123 | role: ${user.role}${user.subRole ? `/${user.subRole}` : ""}`,
    );
  });
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
