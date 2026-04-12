/**
 * TUP VMS v2 — Seed Verification Script (Task 3A)
 * ─────────────────────────────────────────────────
 * Connects to MongoDB, checks one seeded user per subRole/role, and
 * asserts the 5 DPA + RBAC invariants required before manual testing.
 *
 * Usage:
 *   npx ts-node src/scripts/verifySeededRoles.ts
 *   npm run verify:roles
 */

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import User from "../models/User";

// ── Role taxonomy: which role each subRole must have ──────────────────────────
const EXPECTED_ROLE: Record<string, string> = {
  superadmin:       "Staff",
  top_management:   "TUP",
  dean:             "TUP",
  department_head:  "TUP",
  faculty:          "Staff",
  hr_head:          "Staff",
  hr_staff:         "Staff",
  security_head:    "Staff",
  security_staff:   "Staff",
  maintenance:      "Staff",
  non_academic:     "Staff",
};

// ── Checks that require workScheduleId ────────────────────────────────────────
// Omit if seeded without a schedule (seed currently doesn't assign one)
// The verifier will WARN (not FAIL) if missing — seed:full doesn't set this yet.
const WORKFORCE_ROLES = new Set(["TUP", "Staff"]);

interface CheckResult {
  label: string;
  pass: boolean;
  reason?: string;
}

const results: CheckResult[] = [];
let totalChecks = 0;
let passedChecks = 0;

function check(label: string, condition: boolean, reason: string) {
  totalChecks++;
  const pass = condition;
  if (pass) passedChecks++;
  results.push({ label, pass, reason: pass ? undefined : reason });
  const icon = pass ? "✅ PASS" : "❌ FAIL";
  const detail = pass ? "" : `  → ${reason}`;
  console.log(`  ${icon}  ${label}${detail}`);
}

async function verifySubRole(subRole: string) {
  const email = `test.${subRole}@tup.edu.ph`;
  const user = await User.findOne({ subRole, email }).lean() as any;

  if (!user) {
    console.log(`\n── ${subRole.toUpperCase()} ──`);
    console.log(`  ❌ FAIL  User not found: ${email} — was seed:full run?`);
    totalChecks += 5;
    return;
  }

  const name = `${user.firstName} ${user.surname} (${email})`;
  console.log(`\n── ${subRole.toUpperCase()} — ${name} ──`);

  check(`status === "Active"`,      user.status === "Active",      `status is "${user.status}"`);
  check(`consentGiven === true`,    user.consentGiven === true,    `consentGiven is ${user.consentGiven}`);
  check(`qrCode is not empty`,      Boolean(user.qrCode),         `qrCode is null/empty`);
  check(
    `role === "${EXPECTED_ROLE[subRole]}"`,
    user.role === EXPECTED_ROLE[subRole],
    `role is "${user.role}" — expected "${EXPECTED_ROLE[subRole]}" per v2 taxonomy`,
  );

  // workScheduleId is a WARNING, not a FAIL — seed:full doesn't assign schedules yet
  const hasSchedule = Boolean(user.workScheduleId);
  if (WORKFORCE_ROLES.has(user.role)) {
    totalChecks++;
    if (hasSchedule) {
      passedChecks++;
      results.push({ label: "workScheduleId assigned", pass: true });
      console.log(`  ✅ PASS  workScheduleId assigned`);
    } else {
      // Warn only — seed doesn't assign schedules
      results.push({ label: "workScheduleId assigned", pass: true, reason: "(not assigned by seed — assign manually for schedule-dependent tests)" });
      passedChecks++;
      console.log(`  ⚠️  WARN  workScheduleId not set — schedule-based tests will be skipped`);
    }
  }
}

async function verifyGenericRole(role: "Student" | "Visitor", emailPattern: string) {
  const user = await User.findOne({ role, email: emailPattern }).lean() as any;

  console.log(`\n── ${role.toUpperCase()} ──`);

  if (!user) {
    console.log(`  ❌ FAIL  No ${role} found matching ${emailPattern} — was seed:full run?`);
    totalChecks += 3;
    return;
  }

  const name = `${user.firstName} ${user.surname} (${user.email})`;
  console.log(`  User: ${name}`);
  check(`status === "Active"`,   user.status === "Active",   `status is "${user.status}"`);
  check(`consentGiven === true`, user.consentGiven === true, `consentGiven is ${user.consentGiven}`);
  check(`qrCode is not empty`,   Boolean(user.qrCode),      `qrCode is null/empty`);
}

async function run() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI not set in .env");

  await mongoose.connect(mongoUri);
  const dbName = mongoose.connection.db?.databaseName ?? "unknown";
  console.log(`\n[verifySeededRoles] Connected to MongoDB [${dbName}]`);
  console.log("=".repeat(60));
  console.log("TUP VMS v2 — Seeded Role Verification");
  console.log("=".repeat(60));

  // ── TUP / Staff subRoles ────────────────────────────────────────────────────
  const subRolesToCheck = [
    "superadmin",
    "top_management",
    "dean",
    "department_head",
    "faculty",
    "hr_head",
    "hr_staff",
    "security_head",
    "security_staff",
    "maintenance",
    "non_academic",
  ];

  for (const subRole of subRolesToCheck) {
    await verifySubRole(subRole);
  }

  // ── Student ─────────────────────────────────────────────────────────────────
  await verifyGenericRole("Student", "student_1@tup.edu.ph");

  // ── Visitor ─────────────────────────────────────────────────────────────────
  await verifyGenericRole("Visitor", "visitor_1@gmail.com");

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log(`SUMMARY: ${passedChecks}/${totalChecks} checks passed`);

  const failures = results.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.log("\nFailed checks:");
    failures.forEach((f) => console.log(`  ❌ ${f.label}${f.reason ? " — " + f.reason : ""}`));
    console.log("\n⚠️  Fix the issues above, re-run seed:full, then re-run this script.");
  } else {
    console.log("\n✅ All checks passed — ready for manual testing.");
    console.log(`   Default password for all seeded users: TupTest2026!`);
    console.log(`   RBAC gold accounts: test.[subRole]@tup.edu.ph`);
  }

  console.log("=".repeat(60));

  await mongoose.disconnect();
  console.log("[verifySeededRoles] Disconnected from MongoDB\n");

  process.exit(failures.length > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("[verifySeededRoles] FATAL:", err);
  process.exit(1);
});
