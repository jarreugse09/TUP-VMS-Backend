# TUP VMS Backend

Express + TypeScript backend for the TUP Visitation Management System (VMS). This service handles authentication, users, attendance/logs, analytics, QR change requests, alerts, chat, uploads, and WebSocket delivery for real-time alert and messaging features.

## Tech Stack

- Node.js
- Express
- TypeScript
- MongoDB + Mongoose
- JWT authentication
- WebSocket via `ws`

## Core Features

- Authentication and JWT login
- User profile and admin user management
- Attendance and visit log APIs
- Analytics endpoints
- QR/profile photo request workflow
- Real-time alert notification system
- Real-time chat system
- CCTV webhook endpoint for Hawkeye alert ingestion

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

Main route groups:

- `/api/auth`
- `/api/users`
- `/api/logs`
- `/api/attendance`
- `/api/analytics`
- `/api/alerts`
- `/api/chat`

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
