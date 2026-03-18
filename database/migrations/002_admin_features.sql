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
