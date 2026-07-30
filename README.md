# Optimus - Call & Auth API (`call-auth-api`)

This service is the backend API for the Optimus platform, responsible for authentication, authorization, session management, LiveKit token minting, database interactions (MongoDB & DynamoDB), and role-based gatekeeping (student, faculty, parent, admin).

---

## 🏗 Directory & Work Structure

The service is structured as a clean Node.js Express application:

```text
call-auth-api/
├── db/                       # Database clients setup
│   ├── dynamo.js             # AWS DynamoDB client configuration
│   └── mongo.js              # Mongoose client initialization
├── models/                   # Mongoose (MongoDB) schemas
│   ├── User.js               # User accounts schema (hashed passwords, roles)
│   ├── Class.js              # Classes configuration schema
│   ├── CallLog.js            # Outgoing calls and session summaries logger
│   └── ModerationEvent.js    # Real-time microphone audio moderation events logger
├── middleware/               # Express routing middlewares
│   ├── auth.js               # JWT-based session verification
│   └── requireRole.js        # Role validation gatekeeper (faculty, student, parent)
├── routes/                   # API Route endpoints
│   ├── authRoutes.js         # /api/auth endpoints (login, logout, active profile)
│   ├── studentRoutes.js      # /api/student endpoints (parents, classes schedules)
│   ├── classRoutes.js        # /api/class endpoints (start class, tokens, status, kick)
│   ├── callRoutes.js         # /api/call endpoints (1:1 calling sessions)
│   └── micRoutes.js          # /api/mic endpoints (moderation and logging)
├── scripts/                  # DB seed and initialization helpers
│   ├── seed-dynamo.js        # Creates DynamoDB tables & seeds test schedules
│   └── seed-mongo.js         # Seeds test user profiles (students, faculty, admin)
├── tests/                    # Automated testing suites
│   └── api.test.js           # API token minting and role validation rule tests
├── Dockerfile                # Production Docker build spec
└── index.js                  # Application entrypoint & Express setup
```

---

## 🚀 Installation & Run Guide

### 📋 Prerequisites
- **Node.js**: v18.0.0 or higher
- **NPM**: v9.0.0 or higher
- **Running Database Services**: DynamoDB Local and MongoDB (usually launched via Docker)

---

### 💻 Local Run (Mac & Linux)

#### 1. Install Dependencies
Run from the `call-auth-api` directory:
```bash
npm install
```

#### 2. Configure Environment Variables
Create a `.env` file in the `call-auth-api` folder:
```env
PORT=8080
MONGO_URI=mongodb://localhost:27017/optimus
DYNAMODB_ENDPOINT=http://localhost:8000
DYNAMODB_REGION=us-east-1
DYNAMODB_ACCESS_KEY=local
DYNAMODB_SECRET_KEY=local
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
SESSION_SECRET=optimus_session_secret
```

#### 3. Database Seeding
Initialize both local databases with development schemas and test credentials:
```bash
# Seed DynamoDB tables and class schedules
node scripts/seed-dynamo.js

# Seed MongoDB test users and roles (including admin)
node scripts/seed-mongo.js
```

#### 4. Run API Server
Start the Express API:
```bash
# Run in development mode
npm run dev

# Or run directly
node index.js
```
The backend API will be available at `http://localhost:8080`.

---

### 🐳 Running via Docker Compose (Mac & Linux)

To build and run this service containerized together with all database dependencies, run from the root `Optimus` project directory:
```bash
# Build and start services
docker compose up -d --build auth-api

# Seed databases inside the container
docker exec optimus-api node scripts/seed-dynamo.js
docker exec optimus-api node scripts/seed-mongo.js
```

---

## 🧪 Running Tests
To run unit and validation tests:
```bash
npm test
```
