# TUP VMS Backend

Express + TypeScript backend for the TUP Visitation Management System (VMS). This service handles authentication, users, attendance/logs, analytics, QR change requests, alerts, chat, uploads, and WebSocket delivery for real-time alert and messaging features.

## Tech Stack

- Node.js
- Express
- TypeScript
- MongoDB + Mongoose
- JWT authentication
- WebSocket via `ws`
- node-cron (scheduled jobs)

## Core Features

- Authentication and JWT login
- User profile and admin user management
- Attendance and visit log APIs
- QR scanning endpoint for time-in/out, breaks, go-out, transactions
- Analytics endpoints
- QR/profile photo request workflow
- Real-time alert notification system
- Real-time chat system
- CCTV webhook endpoint for Hawkeye alert ingestion
- Role-Based Access Control (RBAC) with subRole hierarchy
- Automatic daily attendance computation (Late/Absent/WFH/Exemption)

## Project Structure

```text
src/
├── controllers/
├── middlewares/
├── models/
├── routes/
├── scripts/
├── utils/
├── websocket.ts
└── server.ts
```

## Environment Variables

Create a `.env` file in this folder with:

```env
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
PORT=5000
CCTV_API_KEY=your_shared_cctv_api_key
FRONTEND_URL=http://localhost:5173
```

Notes:

- `CCTV_API_KEY` must match Hawkeye's `AMS_API_KEY`
- `FRONTEND_URL` can be a comma-separated list in production when allowing multiple frontend origins
- uploads are served from `/uploads`

## Run Locally

Install dependencies:

```bash
npm install
```

Start development server:

```bash
npm run dev
```

Build production bundle:

```bash
npm run build
```

Run production build:

```bash
npm start
```

Seed demo data:

```bash
npm run seed:full
```

## API Base

Default local base URL:

```text
http://localhost:5000/api
```

### Route Groups (Updated)

- `/api/auth` - Authentication (login, register)
- `/api/users` - User management
- `/api/logs` - Visit/activity logs
- `/api/attendance` - Attendance logs (scoped by role)
- `/api/analytics` - Analytics endpoints
- `/api/alerts` - Alert management
- `/api/chat` - Chat system
- `/api/scan` - QR scanning (time-in/out, breaks, go-out, transactions)
- `/api/colleges` - College CRUD (HR only)
- `/api/departments` - Department CRUD (HR, Dean, DeptHead)
- `/api/transaction-logs` - Transaction logs (client/staff view)
- `/api/work-schedules` - Work schedule management
- `/api/special-schedules` - WFH, holiday, exemption management

## RBAC Implementation

### Role Hierarchy

| Role | subRole |
|------|---------|
| TUP | top_management, dean, department_head, faculty, non_academic, maintenance |
| Staff | hr_head, hr_staff, security_head, security_staff |
| Student | (none) |
| Visitor | (none) |

### New Middleware

- `requireRoleOrSubRole(roles, subRoles)` - Checks role OR subRole
- `requireScopeAccess(scopeType)` - Data isolation for dean/department_head

### Attendance Scoping

- `GET /api/attendance/logs` - Role-scoped (own/dept/college)
- `GET /api/attendance/all` - HR/Security only
- `GET /api/attendance/dept/:id` - DepartmentHead only
- `GET /api/attendance/college/:id` - Dean only

### Archive & Recovery (Superadmin Only)

- `GET /api/admin/archive` - Retrieve soft-deleted/rejected records (Users, QR, Photos)
- `PATCH /api/admin/archive/restore/:type/:id` - Restore a record with a mandatory reason

### Attendance Computation

- Cron job runs daily at 6PM to compute Late/Absent status
- Manual trigger: `POST /api/attendance/compute` (hr_head only)

## Security Architecture (DPA 2012)

### Silo Isolation
The system employs `getSiloedUserFilter` middleware to enforce academic and organizational silos. 
- **Deans/Dept Heads** are restricted to users within their assigned `collegeId` or `departmentId`.
- **HR/Security Head** have university-wide visibility for their respective domains (Workforce vs Security).
- **Fail-Closed**: If a user's scope cannot be determined, the API defaults to returning zero results rather than all results.

### Forensic Auditing
Every administrative action (restoration, status change, schedule override) is logged in the `ActionLog` collection with:
- PerformedBy (User ID)
- IP Address & User Agent
- Exact detail of the mutation
- Severity level (Info/Warning/Critical)


## User Model Updates

New fields added:
- `qrCode` - Unique UUID v4 per user (static QR)
- `platesNumber` - Vehicle plate number
- `isWFH` - Work from home flag
- `subRole` - Specific position within role
- `collegeId` / `college` - Associated college
- `departmentId` / `department` - Associated department
- `supervisorId` - Direct supervisor reference
- `workScheduleId` - Assigned work schedule

## Real-Time Features

The backend starts a WebSocket server alongside HTTP in [server.ts](./src/server.ts).

Used for:

- new alert delivery
- alert read/update events
- new chat message delivery
- live notification updates

## Hawkeye Alert Integration

Hawkeye sends alerts into:

```text
POST /api/alerts
```

This route is protected by `X-API-Key`, using `CCTV_API_KEY`.

Expected payload shape:

```json
{
  "type": "weapon",
  "title": "Weapon Detected: gun",
  "message": "A gun was detected at hawkeye-cam-01 with 95.0% confidence",
  "cameraSource": "hawkeye-cam-01",
  "detectionLabel": "gun",
  "detectedObjects": ["gun"],
  "confidence": 0.95,
  "severity": "critical",
  "imageUrl": null
}
```

Current behavior:

- per-user alert notification state for the alert audience
- per-user system chat delivery for security users
- incident workflow statuses: `new`, `acknowledged`, `in_progress`, `resolved`

## Deployment Notes

For Render:

- set all environment variables in Render dashboard
- expose the backend over HTTPS
- set `FRONTEND_URL` to your deployed frontend origin
- keep `CCTV_API_KEY` secret

If Hawkeye is local and VMS backend is hosted, Hawkeye should point `AMS_API_URL` to your public Render backend URL, for example:

```env
AMS_API_URL=https://your-backend.onrender.com/api/alerts
```

## Known Dev Note

The backend build is currently expected to pass with:

```bash
npm run build
```
