-- IkLearnEdge Database Schema
-- Run this file to create all tables

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'teacher', 'student')),
  profile_picture VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subjects table
CREATE TABLE IF NOT EXISTS subjects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  image VARCHAR(500) DEFAULT '/subject-default.jpg',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pricing tiers table (admin-controlled pricing)
CREATE TABLE IF NOT EXISTS pricing_tiers (
  id SERIAL PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  grade_level VARCHAR(100) NOT NULL,
  price_per_hour DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(subject_id, grade_level)
);

-- Teachers table
CREATE TABLE IF NOT EXISTS teachers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT,
  verification_status VARCHAR(20) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'approved', 'rejected')),
  verification_notes TEXT,
  is_live BOOLEAN DEFAULT false,
  meeting_link VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Teacher subjects (many-to-many)
CREATE TABLE IF NOT EXISTS teacher_subjects (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  UNIQUE(teacher_id, subject_id)
);

-- Documents table (degrees, certificates, IDs)
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('degree', 'certificate', 'identity')),
  file_url VARCHAR(500) NOT NULL,
  file_name VARCHAR(255),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Availability table
CREATE TABLE IF NOT EXISTS availability (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  day VARCHAR(20) NOT NULL CHECK (day IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN DEFAULT true
);

-- Students table
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grade_level VARCHAR(100),
  parent_contact VARCHAR(50),
  location VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Top verified teachers table (for featured teacher section)
CREATE TABLE IF NOT EXISTS top_verified_teachers (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(teacher_id)
);

-- Bookings table
CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  grade_level VARCHAR(100) NOT NULL,
  scheduled_date TIMESTAMP NOT NULL,
  duration INTEGER NOT NULL, -- in minutes
  price_per_hour DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'payment_under_review', 'confirmed', 'completed', 'cancelled')),
  meeting_link VARCHAR(500),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payment proofs table
CREATE TABLE IF NOT EXISTS payment_proofs (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  file_url VARCHAR(500) NOT NULL,
  file_name VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes TEXT,
  reviewed_at TIMESTAMP,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Class sessions table
CREATE TABLE IF NOT EXISTS class_sessions (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMP NOT NULL,
  duration INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  meeting_link VARCHAR(500) NOT NULL,
  recording_url VARCHAR(500),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(20) DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error')),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers(user_id);
CREATE INDEX IF NOT EXISTS idx_teachers_verification ON teachers(verification_status);
CREATE INDEX IF NOT EXISTS idx_teachers_is_live ON teachers(is_live);
CREATE INDEX IF NOT EXISTS idx_students_user_id ON students(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_student_id ON bookings(student_id);
CREATE INDEX IF NOT EXISTS idx_bookings_teacher_id ON bookings(teacher_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payment_proofs(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payment_proofs(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_teachers_updated_at ON teachers;
CREATE TRIGGER update_teachers_updated_at BEFORE UPDATE ON teachers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_students_updated_at ON students;
CREATE TRIGGER update_students_updated_at BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_subjects_updated_at ON subjects;
CREATE TRIGGER update_subjects_updated_at BEFORE UPDATE ON subjects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_bookings_updated_at ON bookings;
CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default admin user (password: admin123)
-- In production, use proper password hashing
INSERT INTO users (email, password_hash, name, role)
VALUES ('admin@iklearnedge.com', '$2a$10$YourHashedPasswordHere', 'Admin User', 'admin')
ON CONFLICT (email) DO NOTHING;

-- Insert default subjects
INSERT INTO subjects (name, description, image) VALUES
('Math', 'From basic arithmetic to advanced calculus, our math tutors make numbers make sense.', '/subject-math.jpg'),
('Physics', 'Understand the laws of the universe with our expert Physics tutors.', '/subject-physics.jpg'),
('Chemistry', 'Learn Chemistry from qualified professionals. Organic, inorganic, and physical chemistry.', '/subject-chemistry.jpg'),
('English', 'Master English language skills with expert tutors. Grammar, literature, and communication.', '/subject-english.jpg'),
('Science', 'Comprehensive science tutoring covering biology, earth science, and general science.', '/subject-science.jpg'),
('IELTS', 'Prepare for your IELTS exam with certified trainers. Achieve your target band score.', '/subject-ielts.jpg'),
('SAT', 'Comprehensive SAT preparation to help you get into your dream university.', '/subject-sat.jpg'),
('Biology', 'Learn about living organisms, from cells to ecosystems.', '/subject-science.jpg'),
('Computer Science', 'Programming, algorithms, and computer fundamentals.', '/subject-physics.jpg')
ON CONFLICT DO NOTHING;

-- Insert default pricing tiers
INSERT INTO pricing_tiers (subject_id, grade_level, price_per_hour) VALUES
-- Math
(1, 'Grade 1-5 (Primary)', 15),
(1, 'Grade 6-8 (Middle)', 18),
(1, 'Grade 9-10 (Secondary)', 22),
(1, 'O-Level', 28),
(1, 'A-Level', 35),
(1, 'University/College', 40),
-- Physics
(2, 'Grade 6-8 (Middle)', 18),
(2, 'Grade 9-10 (Secondary)', 22),
(2, 'O-Level', 28),
(2, 'A-Level', 35),
(2, 'University/College', 42),
-- Chemistry
(3, 'Grade 6-8 (Middle)', 18),
(3, 'Grade 9-10 (Secondary)', 22),
(3, 'O-Level', 28),
(3, 'A-Level', 35),
(3, 'University/College', 42),
-- English
(4, 'Grade 1-5 (Primary)', 14),
(4, 'Grade 6-8 (Middle)', 17),
(4, 'Grade 9-10 (Secondary)', 20),
(4, 'O-Level', 25),
(4, 'A-Level', 30),
(4, 'University/College', 35),
(4, 'Adult Learning', 28),
-- Science
(5, 'Grade 1-5 (Primary)', 14),
(5, 'Grade 6-8 (Middle)', 17),
(5, 'Grade 9-10 (Secondary)', 20),
-- IELTS
(6, 'Adult Learning', 35),
-- SAT
(7, 'Grade 9-10 (Secondary)', 38),
(7, 'A-Level', 42),
-- Biology
(8, 'Grade 6-8 (Middle)', 17),
(8, 'Grade 9-10 (Secondary)', 21),
(8, 'O-Level', 27),
(8, 'A-Level', 34),
-- Computer Science
(9, 'Grade 6-8 (Middle)', 20),
(9, 'Grade 9-10 (Secondary)', 25),
(9, 'O-Level', 30),
(9, 'A-Level', 38),
(9, 'University/College', 45)
ON CONFLICT DO NOTHING;
