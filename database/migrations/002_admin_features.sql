-- Additional database tables for admin features

-- Top verified teachers table
CREATE TABLE IF NOT EXISTS top_verified_teachers (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(teacher_id)
);

-- Index for top verified teachers
CREATE INDEX IF NOT EXISTS idx_top_verified_teachers_position ON top_verified_teachers(position);

-- Site settings table for admin configuration
CREATE TABLE IF NOT EXISTS site_settings (
  id SERIAL PRIMARY KEY,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT,
  setting_type VARCHAR(20) DEFAULT 'string',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT INTO site_settings (setting_key, setting_value, setting_type) VALUES
  ('primary_color', '#f5a623', 'color'),
  ('secondary_color', '#4a4a4a', 'color'),
  ('accent_color', '#3498db', 'color'),
  ('currency', 'AED', 'string'),
  ('currency_symbol', 'د.إ', 'string'),
  ('site_name', 'IkLearnEdge', 'string')
ON CONFLICT (setting_key) DO NOTHING;

-- Bank details table
CREATE TABLE IF NOT EXISTS bank_details (
  id SERIAL PRIMARY KEY,
  bank_name VARCHAR(100) NOT NULL DEFAULT 'Dubai Islamic Bank',
  account_number VARCHAR(50) NOT NULL,
  iban VARCHAR(50) NOT NULL,
  account_holder_name VARCHAR(100) NOT NULL,
  swift_code VARCHAR(20),
  branch_address TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default bank details
INSERT INTO bank_details (bank_name, account_number, iban, account_holder_name, swift_code, branch_address)
SELECT 'Dubai Islamic Bank', '1234567890', 'AE123456789012345678901', 'IkLearnEdge', 'DIB AEA S', 'Dubai, UAE'
WHERE NOT EXISTS (SELECT 1 FROM bank_details LIMIT 1);

-- Availability table for teacher schedules
CREATE TABLE IF NOT EXISTS availability (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  day VARCHAR(20) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(teacher_id, day, start_time, end_time)
);

-- Create index for availability lookups
CREATE INDEX IF NOT EXISTS idx_availability_teacher_day ON availability(teacher_id, day);

-- Payment proofs table
CREATE TABLE IF NOT EXISTS payment_proofs (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  public_id VARCHAR(255),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add is_demo column to bookings if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'is_demo') THEN
    ALTER TABLE bookings ADD COLUMN is_demo BOOLEAN DEFAULT false;
  END IF;
END $$;

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  user_role VARCHAR(20),
  target_role VARCHAR(20),
  title VARCHAR(255) NOT NULL,
  message TEXT,
  type VARCHAR(50) DEFAULT 'info',
  link VARCHAR(255),
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = false;
