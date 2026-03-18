<<<<<<< HEAD
# iklearnedge_backend
# IkLearnEdge Backend API

Complete backend API for the IkLearnEdge Tutoring Platform.

## 📁 Project Structure

```
backend/
├── src/
│   ├── server.js           # Main server entry
│   ├── routes/             # API routes
│   │   ├── auth.js         # Authentication
│   │   ├── teachers.js     # Teacher management
│   │   ├── students.js     # Student management
│   │   ├── bookings.js     # Booking system
│   │   ├── payments.js     # Payment verification
│   │   ├── subjects.js     # Subject & pricing management
│   │   ├── admin.js        # Admin dashboard
│   │   └── upload.js       # File uploads
│   ├── middleware/
│   │   └── auth.js         # JWT authentication
│   └── models/
│       └── database.js     # Database connection
├── database/
│   └── migrations/
│       └── 001_initial_schema.sql
├── .env.example            # Environment template
└── package.json
```

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Environment
```bash
cp .env.example .env
# Edit .env with your settings
```

### 3. Setup Database
```bash
# Create PostgreSQL database
createdb iklearnedge

# Run migrations
psql -d iklearnedge -f database/migrations/001_initial_schema.sql
```

### 4. Start Server
```bash
# Development
npm run dev

# Production
npm start
```

## 📚 API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login user |
| GET | `/api/auth/me` | Get current user |
| PUT | `/api/auth/profile` | Update profile |
| POST | `/api/auth/change-password` | Change password |

### Subjects
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/subjects` | Get all active subjects |
| GET | `/api/subjects/:id` | Get subject by ID |
| GET | `/api/subjects/:id/price` | Get price for grade |
| POST | `/api/subjects` | Create subject (Admin) |
| PUT | `/api/subjects/:id` | Update subject (Admin) |
| PUT | `/api/subjects/:id/pricing` | Update pricing (Admin) |
| DELETE | `/api/subjects/:id` | Delete subject (Admin) |

### Teachers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/teachers` | Get all live teachers |
| GET | `/api/teachers/:id` | Get teacher by ID |
| GET | `/api/teachers/profile` | Get my profile |
| PUT | `/api/teachers/profile` | Update profile |
| PUT | `/api/teachers/availability` | Update availability |
| PUT | `/api/teachers/:id/verify` | Verify teacher (Admin) |

### Students
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/students/profile` | Get my profile |
| PUT | `/api/students/profile` | Update profile |
| GET | `/api/students/my-teachers` | Get my teachers |
| GET | `/api/students/stats` | Get my stats |

### Bookings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/bookings` | Get my bookings |
| GET | `/api/bookings/:id` | Get booking by ID |
| POST | `/api/bookings` | Create booking |
| PUT | `/api/bookings/:id/status` | Update status |
| GET | `/api/bookings/upcoming/classes` | Get upcoming classes |

### Payments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/payments` | Get my payments |
| GET | `/api/payments/pending` | Get pending (Admin) |
| POST | `/api/payments` | Upload proof |
| PUT | `/api/payments/:id/verify` | Verify payment (Admin) |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | Dashboard stats |
| GET | `/api/admin/recent-activity` | Recent activity |
| GET | `/api/admin/users` | All users |
| PUT | `/api/admin/users/:id` | Update user |
| DELETE | `/api/admin/users/:id` | Delete user |
| GET | `/api/admin/revenue` | Revenue report |

### Upload
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload/profile-picture` | Upload avatar |
| POST | `/api/upload/document` | Upload document |
| POST | `/api/upload/payment-proof` | Upload payment |

## 🔐 Authentication

All protected endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

Get token from `/api/auth/login` response.

## 🗄️ Database Schema

See `database/migrations/001_initial_schema.sql` for complete schema.

## 🌐 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NODE_ENV` | environment (development/production) | Yes |
| `PORT` | server port | Yes |
| `FRONTEND_URL` | allowed CORS origin | Yes |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | JWT signing secret | Yes |
| `JWT_EXPIRE` | JWT expiration time | No |
| `CLOUDINARY_*` | Cloudinary credentials | Yes |

## 🧪 Testing

```bash
# Test health endpoint
curl http://localhost:5000/api/health

# Test login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@iklearnedge.com","password":"admin123"}'
```

## 📦 Deployment

### Railway (Recommended)
```bash
# Install CLI
npm install -g @railway/cli

# Login
railway login

# Initialize
railway init

# Deploy
railway up
```

### Render
1. Connect GitHub repo
2. Set environment variables
3. Deploy automatically

## 📝 License

MIT
