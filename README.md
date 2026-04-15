# TUP VMS Backend

Express + TypeScript backend for the TUP Visitation Management System (VMS). This service handles authentication, users, attendance, visit logs, transactions, analytics, QR/photo requests, alerts, chat, and WebSocket delivery for real-time notifications.

## Tech Stack

- Node.js
- Express
- TypeScript
- MongoDB + Mongoose
- JWT authentication
- WebSocket via `ws`
- node-cron (scheduled jobs)

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

Create a `.env` file in this folder:

```env
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret_at_least_32_chars
PORT=5000
FRONTEND_URL=http://localhost:5173
CCTV_API_KEY=your_shared_cctv_api_key
RESTORE_CONFIRM_TOKEN=your_backup_restore_token
NODE_ENV=development
```

Notes:

- `FRONTEND_URL` can be a comma-separated list in production.
- `CCTV_API_KEY` must match Hawkeye’s `AMS_API_KEY`.
- `/api/photo/:filename` is authenticated; `/uploads` is not publicly exposed.

## Run Locally

Install dependencies: `npm install`

Start dev server: `npm run dev`

Build: `npm run build`

Start production build: `npm start`

Seed demo data: `npm run seed:full`

## API Base

Local base URL: `http://localhost:5000/api`

## Route Structure

- `/api/auth` Authentication (login, refresh, role-scoped registration)
- `/api/users` User management, consent, QR requests, profile photo requests
- `/api/attendance` Attendance logs and reports
- `/api/visit-logs` Visit logs (own or global by role)
- `/api/transaction-logs` Transactions (own or global by role)
- `/api/action-logs` Action logs (own or global by role)
- `/api/analytics` Analytics endpoints
- `/api/alerts` Alert management and CCTV webhook
- `/api/chat` Security group chat
- `/api/scan` QR scanning
- `/api/colleges` College CRUD
- `/api/departments` Department CRUD
- `/api/work-schedules` Work schedule management
- `/api/special-schedules` WFH, holiday, exemption management
- `/api/backup` Backup and restore
- `/api/csv-upload` CSV import tools
- `/api/reports` Docx/zip reporting
- `/api/admin/archive` Restore soft-deleted resources

## Authentication Flow (JWT)

- `POST /api/auth/login` issues access + refresh tokens.
- Access tokens are validated in `authenticateToken`.
- Refresh tokens are validated via `POST /api/auth/refresh`.
- Invalid or blocked access attempts write to `ActionLog`.

## RBAC

Role taxonomy:

| Role | subRole |
|------|---------|
| TUP | superadmin, top_management, dean, department_head, non_academic, hr_head, hr_staff |
| Staff | faculty, security_head, security_staff, maintenance |
| Student | (none) |
| Visitor | (none) |

Role checks:

- `validateRbac(roles, subRoles)` for role or subRole access
- `requireScopeAccess` for dean and department_head data isolation
- `authorizeAlertAudience` and `authorizeChatAccess` for security-only domains

## Logging System

Domain-specific logs:

- `ActionLog` for auditing actions
- `VisitLog` for visitor/student entries
- `TransactionLog` for service transactions
- `CsvUploadLog` and `BackupLog` for maintenance tasks

## Cron Jobs

- Daily attendance computation at 18:00 Asia/Manila
- End-of-day incomplete-exit checker at 23:00 Asia/Manila
- Monthly data retention flagging at 01:00 on the 1st

## Security Measures

- JWT minimum length enforced at boot
- API key auth for Hawkeye webhook (`X-API-Key`)
- Fail-closed scope guards for dean and department_head
- `ObjectId` validation before `findById` access
- Authenticated photo access via `/api/photo/:filename`

## Deployment Notes

- Set `FRONTEND_URL` to your deployed frontend origin.
- Keep `CCTV_API_KEY` and `JWT_SECRET` private.
- Ensure the backend is exposed over HTTPS for secure WebSocket usage.
