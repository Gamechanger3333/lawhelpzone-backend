# LawHelpZone — Backend

<div align="center">

![LawHelpZone](https://img.shields.io/badge/LawHelpZone-Legal%20Services%20Platform-0A1A3F?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=node.js)
![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose-47A248?style=for-the-badge&logo=mongodb)
![Stripe](https://img.shields.io/badge/Stripe-Connect-635BFF?style=for-the-badge&logo=stripe)
![Socket.io](https://img.shields.io/badge/Socket.io-Real--time-010101?style=for-the-badge&logo=socket.io)
![Railway](https://img.shields.io/badge/Deployed-Railway-0B0D0E?style=for-the-badge&logo=railway)

**REST API + WebSocket server for the LawHelpZone legal marketplace.**  
Built with Node.js, Express, MongoDB, Stripe Connect, and Socket.io.

🚀 **Live API:**    https://lawhelpzone-backend-production.up.railway.app

</div>

---

## 🎬 Demo Access

Want to explore LawHelpZone without signing up? Use the **"Try Demo Account"** button on the login page, or log in manually with:

```
Email:    demo@lawhelpzone.com
Password: Demo@1234
```

**Notes:**
- Demo data (cases, messages, proposals) automatically resets to a clean, realistic state every time the demo account logs in — so it's always safe to explore and never gets messy from other visitors.
- Real payments are disabled for this account — everything else (browsing lawyers, creating cases, messaging, AI assistant) works normally.
- A real signup is also available if you'd like to test the full flow, including email verification.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Payment System](#payment-system)
- [Database Models](#database-models)
- [Authentication](#authentication)
- [Socket.io Events](#socketio-events)
- [Deployment](#deployment)

---

## Overview

The LawHelpZone backend is a Node.js/Express REST API that powers:

- **JWT Authentication** with cookie + Bearer token support
- **Role-based access control** (client / lawyer / admin)
- **Stripe Connect** marketplace payments with automatic 80/20 fee splitting
- **Real-time messaging** and notifications via Socket.io
- **Case management** with proposals, assignment, and status tracking
- **Video call** signalling via WebSockets

---

## Architecture

```
Client Request
     ↓
Express Router
     ↓
Auth Middleware (JWT verify)
     ↓
Role Middleware (restrictTo)
     ↓
Controller
     ↓
Mongoose Model ←→ MongoDB Atlas
     ↓
Stripe API (payments only)
     ↓
Socket.io (real-time events)
     ↓
Response
```

---

## Tech Stack

| Technology | Version | Purpose |
|---|---|---|
| **Node.js** | 18+ | Runtime |
| **Express** | 5 | HTTP framework |
| **MongoDB** | Atlas | Database |
| **Mongoose** | 8 | ODM |
| **Stripe** | Latest | Payment processing |
| **Socket.io** | 4 | Real-time events |
| **JWT** | jsonwebtoken | Authentication |
| **bcryptjs** | Latest | Password hashing |
| **nodemailer** | Latest | Email notifications |
| **helmet** | Latest | Security headers |
| **express-rate-limit** | Latest | Rate limiting |
| **cors** | Latest | Cross-origin requests |

---

## Project Structure

```
lawhelpzone-backend/
├── src/
│   ├── controllers/
│   │   ├── authController.js         # Login, register, forgot password
│   │   ├── dashboardController.js    # Role-aware dashboard data
│   │   ├── lawyerController.js       # Lawyer profiles & verification
│   │   ├── paymentController.js      # Stripe payments & history ← NEW
│   │   ├── stripeController.js       # Stripe Connect onboarding ← NEW
│   │   ├── notificationController.js # In-app notifications
│   │   ├── profileController.js      # Profile updates (all roles)
│   │   └── searchController.js       # Lawyer & case search
│   │
│   ├── models/
│   │   ├── User.js                   # User (client / lawyer / admin)
│   │   ├── Case.js                   # Legal cases
│   │   ├── Message.js                # Chat messages
│   │   ├── Notification.js           # In-app notifications
│   │   └── Payment.js                # Payment records ← NEW
│   │
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── caseRoutes.js
│   │   ├── chatRoutes.js
│   │   ├── dashboardRoutes.js
│   │   ├── lawyerRoutes.js
│   │   ├── notificationRoutes.js
│   │   ├── paymentRoutes.js          # ← NEW
│   │   ├── stripeRoutes.js           # ← NEW
│   │   ├── adminroute.js
│   │   ├── profileRoutes.js
│   │   └── searchRoutes.js
│   │
│   ├── middleware/
│   │   ├── authMiddleware.js         # protect + restrictTo
│   │   ├── roleMiddleware.js         # clientOnly, lawyerOnly, adminOnly
│   │   ├── rateLimiter.js            # API & auth rate limits
│   │   └── security.js              # Helmet, XSS, NoSQL injection
│   │
│   ├── services/
│   │   └── stripeService.js          # Lazy Stripe singleton ← NEW
│   │
│   ├── utils/
│   │   ├── feeCalculator.js          # 80/20 fee calculation ← NEW
│   │   └── socket.js                 # Socket.io helpers
│   │
│   ├── database.js                   # MongoDB connection
│   └── server.js                     # Express app entry point
│
├── .env
└── package.json
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB Atlas account (or local MongoDB)
- Stripe account (test mode)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/lawhelpzone-backend.git
cd lawhelpzone-backend

# Install dependencies
npm install

# Install Stripe
npm install stripe

# Copy environment file
cp .env.example .env
# Fill in your values (see Environment Variables section)

# Start development server
npm run dev
```

Server runs on [http://localhost:5000](http://localhost:5000)

### Health Check

```bash
curl http://localhost:5000/health
# → { "status": "healthy", "database": "connected", "uptime": 123 }
```

---

## Environment Variables

Create a `.env` file in the root:

```env
# ── Server ──────────────────────────────────────────
PORT=5000
NODE_ENV=development

# ── MongoDB ─────────────────────────────────────────
MONGO_URI=mongodb+srv://username:password@cluster.mongodb.net/lawhelpzone

# ── JWT ─────────────────────────────────────────────
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_SECRET=your_refresh_token_secret
REFRESH_TOKEN_EXPIRES=30d

# ── Stripe ──────────────────────────────────────────
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxx
PLATFORM_FEE_PERCENTAGE=20

# ── Frontend ─────────────────────────────────────────
CLIENT_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000

# ── Email (nodemailer) ───────────────────────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_password
FROM_EMAIL=noreply@lawhelpzone.com
```

### Railway Environment Variables (Production)

Set these in **Railway → Project → Variables**:

```env
MONGO_URI=mongodb+srv://...
JWT_SECRET=...
STRIPE_SECRET_KEY=sk_live_... (or sk_test_...)
STRIPE_WEBHOOK_SECRET=whsec_...
PLATFORM_FEE_PERCENTAGE=20
CLIENT_URL=https://lawhelpzone-frontend-4fq6.vercel.app
FRONTEND_URL=https://lawhelpzone-frontend-4fq6.vercel.app
NODE_ENV=production
```

---

## API Reference

### Base URL
```
Development: http://localhost:5000
Production:  https://lawhelpzone-backend-production.up.railway.app
```

### Authentication Header
```
Authorization: Bearer <jwt_token>
```

---

### Auth Routes `/api/auth`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/sign-up` | No | Register new user |
| `POST` | `/login` | No | Login user |
| `POST` | `/logout` | Yes | Logout user |
| `GET` | `/check-auth` | Yes | Verify token / get current user |
| `GET` | `/me` | Yes | Get full profile |
| `PUT` | `/profile` | Yes | Update profile |
| `POST` | `/forgot-password` | No | Send reset email |
| `POST` | `/reset-password/:token` | No | Reset password |
| `POST` | `/change-password` | Yes | Change password |

**Register Request:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123",
  "role": "client"
}
```

**Login Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "client"
  }
}
```

---

### Cases Routes `/api/cases`

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/` | Yes | All | List cases (filterable) |
| `POST` | `/` | Yes | Client | Create new case |
| `GET` | `/:id` | Yes | All | Get case by ID |
| `PUT` | `/:id` | Yes | Client/Admin | Update case |
| `DELETE` | `/:id` | Yes | Client/Admin | Delete case |
| `POST` | `/:id/proposals` | Yes | Lawyer | Submit proposal |
| `POST` | `/:id/accept` | Yes | Client | Accept a proposal |
| `POST` | `/:id/assign` | Yes | Admin | Assign lawyer |
| `POST` | `/:id/notes` | Yes | All | Add case note |
| `GET` | `/stats` | Yes | All | Case statistics |

**Query Parameters for `GET /api/cases`:**
```
?status=open|in-progress|closed
?category=Criminal Law
?page=1
?limit=10
```

---

### Messages Routes `/api/messages`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/contacts` | Yes | Get all contacts with unread counts |
| `GET` | `/:contactId` | Yes | Get messages with a contact |
| `POST` | `/` | Yes | Send a message |
| `PATCH` | `/:contactId/read` | Yes | Mark messages as read |

---

### Notifications Routes `/api/notifications`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/` | Yes | Get notifications (paginated) |
| `GET` | `/unread-count` | Yes | Get unread count only |
| `PATCH` | `/:id/read` | Yes | Mark one as read |
| `PATCH` | `/read-all` | Yes | Mark all as read |
| `DELETE` | `/:id` | Yes | Delete notification |

---

### Lawyers Routes `/api/lawyers`

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/` | Yes | All | List verified lawyers |
| `GET` | `/:id` | Yes | All | Get lawyer profile |
| `GET` | `/pending` | Yes | Admin | List pending verification |
| `PUT` | `/:id/verify` | Yes | Admin | Approve/reject lawyer |
| `PUT` | `/profile/me` | Yes | Lawyer | Update own profile |

---

### Payment Routes `/api/payments`

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `POST` | `/create-payment-intent` | Yes | Client | Create Stripe PaymentIntent |
| `POST` | `/webhook` | No | Internal | Stripe webhook handler |
| `GET` | `/history` | Yes | All | Get payment history (role-aware) |
| `GET` | `/lawyer/earnings` | Yes | Lawyer | Earnings summary |
| `GET` | `/admin/revenue` | Yes | Admin | Platform revenue stats |
| `POST` | `/:id/refund` | Yes | Admin | Refund a payment |
| `GET` | `/:id` | Yes | All | Get single payment |

**Create Payment Intent Request:**
```json
{
  "lawyerId": "507f1f77bcf86cd799439011",
  "amount": 150,
  "caseId": "507f1f77bcf86cd799439022"
}
```

**Response:**
```json
{
  "clientSecret": "pi_3xxx_secret_xxx",
  "paymentId": "507f1f77bcf86cd799439033",
  "amount": 15000,
  "platformFee": 3000,
  "lawyerAmount": 12000
}
```

> ⚠️ All amounts are in **cents**. The backend always calculates fees — never trust client-side amounts.

---

### Stripe Connect Routes `/api/stripe`

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `POST` | `/connect-account` | Yes | Lawyer | Start Stripe onboarding |
| `GET` | `/account-status` | Yes | Lawyer | Check onboarding status |
| `GET` | `/dashboard-link` | Yes | Lawyer | Stripe Express login link |
| `GET` | `/refresh` | Yes | Lawyer | Refresh expired onboarding link |

---

### Dashboard Routes `/api/dashboard`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/` | Yes | Role-aware dashboard data |

**Response shape varies by role:**
```json
{
  "stats": {
    "activeCases": 5,
    "totalCases": 12,
    "resolvedCases": 7,
    "unreadMessages": 3,
    "unreadNotifications": 1
  },
  "recentCases": [...],
  "myLawyers": [...],
  "allLawyers": [...],
  "recentNotifications": [...]
}
```

---

### Admin Routes `/api/admin`

| Method | Endpoint | Auth | Role | Description |
|---|---|---|---|---|
| `GET` | `/users` | Yes | Admin | Get all users |
| `PUT` | `/users/:id` | Yes | Admin | Edit user |
| `DELETE` | `/users/:id` | Yes | Admin | Delete user |
| `POST` | `/broadcast` | Yes | Admin | Notify all users |

---

## Payment System

### Fee Calculation

All fee math happens **server-side only** in `src/utils/feeCalculator.js`:

```js
calculateFees(amountDollars) {
  // amountDollars = 150
  const amountCents      = 150 * 100       // = 15000
  const platformFeeCents = 15000 * 0.20    // = 3000  (20%)
  const lawyerAmountCents = 15000 - 3000   // = 12000 (80%)

  return { amountCents, platformFeeCents, lawyerAmountCents }
}
```

**Constraints:**
- Minimum payment: $0.50
- Maximum payment: $999,999.99

### Stripe Connect Flow

```
1. Lawyer → POST /api/stripe/connect-account
        ← { url: "https://connect.stripe.com/setup/..." }

2. Lawyer completes Stripe onboarding on Stripe's hosted page

3. Stripe redirects to:
   https://frontend.vercel.app/dashboard/lawyer/stripe-setup

4. Frontend → GET /api/stripe/account-status
        ← { connected: true, onboarded: true, accountId: "acct_xxx" }

5. Client → POST /api/payments/create-payment-intent
        ← { clientSecret, paymentId, amount, platformFee, lawyerAmount }

6. Frontend confirms payment with Stripe.js

7. Stripe → POST /api/payments/webhook (payment_intent.succeeded)
        → Payment record updated in DB
        → Notifications sent to client + lawyer
        → 80% automatically transferred to lawyer's Stripe account
```

### Stripe Webhook Setup

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/test/webhooks)
2. Add endpoint: `https://lawhelpzone-backend-production.up.railway.app/api/payments/webhook`
3. Select events:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `account.updated`
4. Copy the `whsec_...` signing secret → add to `STRIPE_WEBHOOK_SECRET`

> ⚠️ The webhook route uses `express.raw()` — it **must** be registered **before** `express.json()` in `server.js`.

---

## Database Models

### User Model

```js
{
  name: String,
  email: String,           // unique
  password: String,        // bcrypt hashed
  role: "client|lawyer|admin",
  profileImage: String,
  phone: String,
  bio: String,
  city: String,
  country: String,
  isOnline: Boolean,
  lastSeen: Date,
  suspended: Boolean,
  emailVerified: Boolean,

  // Lawyer only
  lawyerProfile: {
    barNumber: String,
    specializations: [String],
    hourlyRate: Number,
    consultationFee: Number,  // ← Used for pay button amount
    isAvailable: Boolean,
    rating: Number,
    stripeAccountId: String,  // ← Stripe Connect account
    stripeConnected: Boolean,
    stripeOnboarded: Boolean,
  },

  // Client only
  clientProfile: {
    legalNeeds: [String],
    preferredLanguage: String,
  }
}
```

### Payment Model

```js
{
  clientId: ObjectId,           // ref: User
  lawyerId: ObjectId,           // ref: User
  caseId: ObjectId,             // ref: Case (optional)
  amount: Number,               // cents (e.g. 15000 = $150)
  platformFee: Number,          // cents (20%)
  lawyerAmount: Number,         // cents (80%)
  stripePaymentIntentId: String,
  paymentStatus: "pending|succeeded|failed|refunded|disputed|cancelled",
  refundId: String,
  refundReason: String,
  refundedAt: Date,
  createdAt: Date,
}
```

### Case Model

```js
{
  title: String,
  description: String,
  category: "Business Law|Criminal Law|...",
  location: String,
  country: String,
  budget: Number,
  deadline: Date,
  urgency: "low|medium|high|urgent",
  status: "open|in-progress|closed|cancelled",
  clientId: ObjectId,
  assignedLawyerId: ObjectId,
  proposals: [{
    lawyerId: ObjectId,
    message: String,
    fee: Number,
    createdAt: Date,
  }]
}
```

---

## Authentication

### JWT Flow

```
POST /api/auth/login
    → Returns JWT token (15 min expiry)
    → Sets httpOnly cookie: accessToken
    → Returns token in response body (for localStorage)

All protected routes:
    → Check cookie: req.cookies.accessToken
    → Fallback: Authorization: Bearer <token>
    → Attach req.user for downstream handlers
```

### Middleware

```js
// Protect any route
router.get("/profile", protect, handler);

// Restrict to specific roles
router.post("/create", protect, restrictTo("client"), handler);
router.get("/admin", protect, restrictTo("admin"), handler);
router.post("/proposal", protect, restrictTo("lawyer"), handler);
```

---

## Socket.io Events

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `newMessage` | `{ message, senderId }` | New chat message |
| `notification` | `{ title, body, type, link }` | In-app notification |
| `onlineUsers` | `[userId, ...]` | Online users list |
| `userTyping` | `{ userId }` | Typing indicator |
| `badge_update` | `{ type, delta }` | Unread count change |
| `caseUpdated` | `{ caseId }` | Case status changed |

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `sendMessage` | `{ receiverId, content }` | Send chat message |
| `typing` | `{ receiverId }` | Start typing |
| `stopTyping` | `{ receiverId }` | Stop typing |
| `joinCase` | `caseId` | Join case room |
| `callUser` | `{ to, offer, from }` | Initiate video call |
| `answerCall` | `{ to, answer }` | Answer video call |
| `endCall` | `{ to }` | End video call |

### Authentication

Socket connections are authenticated via JWT:

```js
// Client sends:
io.connect(SERVER_URL, {
  auth: { token: localStorage.getItem("token") }
});

// Server verifies:
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  socket.userId = decoded.id;
  next();
});
```

---

## Deployment

The backend is deployed on **Railway** with automatic deployments on every push to `main`.

```bash
# Push to deploy
git add .
git commit -m "your message"
git push origin main
```

Railway auto-detects Node.js and runs `npm start`.

### server.js Route Order (Critical)

```js
// ⚠️ MUST be before express.json() — Stripe needs raw body
app.use("/api/payments/webhook", express.raw({ type: "application/json" }));

// Then JSON parser
app.use(express.json({ limit: "10mb" }));

// Then routes
app.use("/api/auth",          authRoutes);
app.use("/api/cases",         caseRoutes);
app.use("/api/messages",      chatRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/lawyers",       lawyerRoutes);
app.use("/api/dashboard",     dashboardRoutes);
app.use("/api/payments",      paymentRoutes);   // ← NEW
app.use("/api/stripe",        stripeRoutes);    // ← NEW
app.use("/api/admin",         adminRoutes);
app.use("/api/search",        searchRoutes);
```

### Health Check Endpoint

```
GET /health

Response:
{
  "status": "healthy",
  "database": "connected",
  "uptime": 3600,
  "timestamp": "2026-03-16T10:00:00.000Z"
}
```

---

## Security

- ✅ **Helmet** — HTTP security headers
- ✅ **CORS** — Restricted to frontend URL
- ✅ **Rate limiting** — 500 req/15min general, 50 req/15min auth
- ✅ **bcryptjs** — Password hashing (12 rounds)
- ✅ **JWT** — Short-lived access tokens (15 min)
- ✅ **NoSQL injection** protection
- ✅ **XSS** protection
- ✅ **Stripe signature verification** on webhooks
- ✅ **Server-side fee calculation** — clients cannot manipulate payment amounts

---

<div align="center">

Made with ❤️ by the Razia

</div>
