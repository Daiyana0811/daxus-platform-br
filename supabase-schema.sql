-- ============================================
-- DAXUS PLATFORM - Supabase schema
-- Ejecutar en Supabase SQL Editor
-- ============================================

-- 1. Estudiantes autorizados para entrar al orientador.
CREATE TABLE IF NOT EXISTS students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_students_email
  ON students (lower(email));

-- Tabla legacy compatible con versiones anteriores del proyecto.
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Conversaciones. El correo verificado queda registrado en cada chat.
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  user_name TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  extracted_profile JSONB
);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS user_email TEXT;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS user_name TEXT;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 3. Mensajes.
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id, created_at);

-- 4. Planes de estudio generados.
CREATE TABLE IF NOT EXISTS study_plans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id TEXT REFERENCES conversations(id),
  user_email TEXT NOT NULL,
  plan_data JSONB NOT NULL,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE study_plans
  ADD COLUMN IF NOT EXISTS user_email TEXT;

-- 5. Cursos cacheados desde Notion.
CREATE TABLE IF NOT EXISTS courses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  notion_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  duration TEXT,
  thumbnail_url TEXT,
  category TEXT,
  level TEXT,
  master_name TEXT,
  master_level INT,
  tags TEXT[],
  synced_at TIMESTAMPTZ DEFAULT now()
);

-- Ejemplo de estudiante autorizado.
INSERT INTO students (email, full_name, status) VALUES
  ('test@daxus.com', 'Usuario de Prueba', 'active')
ON CONFLICT (email) DO NOTHING;
