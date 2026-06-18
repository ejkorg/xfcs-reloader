# XFCS Reloader Full Stack

This workspace now contains:
- `backend/` Spring Boot XFCS API service
- `frontend/` Angular XFCS UI service
- `plan.md` implementation and rollout plan

## Current auth model
- Login is delegated to DTP auth endpoints (`/resender/api/auth/*`).
- XFCS backend validates JWT and enforces roles.

## Shared schema direction
- Same-schema compatibility is retained as the target model.
- Current scaffold is prepared for DB-backed session/reload persistence in next phase.

## Local run order
1. Start DTP backend auth service (`dtp-resender-fullstack/backend`).
2. Start XFCS backend (`xfcs-reloader-fullstack/backend`).
3. Start XFCS frontend (`xfcs-reloader-fullstack/frontend`).
