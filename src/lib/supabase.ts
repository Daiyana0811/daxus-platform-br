import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// ============================================
// Supabase Client (Service Role Key bypasses RLS)
// ============================================

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_AUTH_SUPABASE_URL;

const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.AUTH_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase environment variables are required.');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

const authSupabaseUrl =
  process.env.NEXT_PUBLIC_AUTH_SUPABASE_URL ||
  process.env.AUTH_SUPABASE_URL ||
  supabaseUrl;

const authSupabaseKey =
  process.env.AUTH_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  supabaseKey;

const authUsersTable = process.env.AUTH_SUPABASE_USERS_TABLE || 'users_br';
const pdiOutputTable = process.env.PDI_OUTPUT_TABLE || 'PDI_BR';

const authSupabase =
  authSupabaseUrl === supabaseUrl && authSupabaseKey === supabaseKey
    ? supabase
    : createClient(authSupabaseUrl, authSupabaseKey);

const MISSING_SCHEMA_ERROR_CODES = new Set(['PGRST116', 'PGRST204', 'PGRST205', '42P01', '42703']);

// ============================================
// Types
// ============================================

export interface User {
  id: string;
  email: string;
  name: string | null;
}

export interface AuthorizedStudent {
  id: string;
  email: string;
  name: string | null;
}

function isActiveSubscriptionStatus(status: unknown): boolean {
  if (typeof status !== 'string') return false;
  const normalized = normalizeRecommendationTitle(status);
  return ['activo', 'activado', 'active', 'activa', 'enabled', 'habilitado', 'vigente'].includes(normalized);
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface Course {
  id: string;
  notion_id: string;
  title: string;
  description: string | null;
  duration: string | null;
  thumbnail_url: string | null;
  category: string | null;
  level: string | null;
  master_name: string | null;
  master_level: number | null;
  tags: string[];
  synced_at: string;
}

export interface StudyPlanData {
  studentName: string;
  email: string;
  pdiSupabaseId?: string | null;
  notionPageId?: string | null;
  pdfGeneratedAt?: string | null;
  professionalGoal: string;
  currentSituation: string;
  specificSkills: string;
  weeklyHours: number;
  targetTimeline: string;
  courses: Array<{
    order: number;
    title: string;
    description: string;
    duration: string;
    thumbnailUrl: string;
    masterName: string | null;
    level: string | null;
    reason: string;
    estimatedWeeks: number;
  }>;
  totalEstimatedWeeks: number;
  weeklySchedule: string;
  additionalNotes: string;
}

const EXCLUDED_RECOMMENDATION_TITLES = new Set(
  [
    'Posicionamiento Profesional con Expertos',
    'Posicionamento Profissional com Especialistas',
    'Habilidades Blandas con Expertos',
    'Habilidades Comportamentais com Especialistas',
    'Habilidades Profissionais com Especialistas',
    'Grabaciones Clases en vivo',
    'Grava??es das aulas ao vivo',
    'Grabaci?n de la inmersi?n',
    'Grava??o da imers?o',
    'Semana de excel en la pr?ctica',
    'Semana de Excel na pr?tica',
    'Clases en vivo - Master Excel',
    'Aulas ao vivo - Master Excel',
    'Clases en vivo - IA',
    'Aulas ao vivo - IA',
    'Grabaciones de las clases en vivo IA',
    'Grava??es das aulas ao vivo IA',
    'Acceso a Daxus IA',
    'Acesso ao Daxus IA',
    'Descarga Ebook',
    'Download Ebook',
    'Acelerador de Carrera con power bi',
    'Acelerador de Carreira com Power BI',
    'Clases en vivo - Power BI',
    'Aulas ao vivo - Power BI',
    'Grabaciones clases en vivo con experto',
    'Grava??es aulas ao vivo com especialista',
    'Certificaci?n MEC',
    'Certifica??o MEC',
    'Preguntas Frecuentes',
    'Perguntas Frequentes',
    'Comienza Aqu?',
    'Comece Aqui',
  ].map(normalizeRecommendationTitle),
);

function normalizeRecommendationTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function pickStatus(record: Record<string, unknown>): unknown {
  const statusKeys = [
    'status',
    'estado',
    'subscription_status',
    'suscripcion',
    'suscripción',
    'subscription',
    'active',
    'activo',
    'is_active',
    'enabled',
  ];

  for (const key of statusKeys) {
    if (key in record) return record[key];
  }

  return undefined;
}

function isAuthorizedUserRow(record: Record<string, unknown>): boolean {
  const status = pickStatus(record);
  if (typeof status === 'undefined' || status === null || status === '') return true;
  if (typeof status === 'boolean') return status;
  if (typeof status === 'number') return status === 1;
  if (typeof status === 'string') return isActiveSubscriptionStatus(status);
  return false;
}

function userNameFromRow(record: Record<string, unknown>): string | null {
  const directName = pickString(record, [
    'full_name',
    'name',
    'nombre',
    'nome',
    'user_name',
    'student_name',
    'first_name',
  ]);
  if (directName) return directName;

  const firstName = pickString(record, ['firstName', 'first_name', 'nombres']);
  const lastName = pickString(record, ['lastName', 'last_name', 'apellidos']);
  return [firstName, lastName].filter(Boolean).join(' ').trim() || null;
}

export function isExcludedRecommendationCourse(courseOrTitle: Course | string): boolean {
  const title = typeof courseOrTitle === 'string' ? courseOrTitle : courseOrTitle.title;
  return EXCLUDED_RECOMMENDATION_TITLES.has(normalizeRecommendationTitle(title));
}

function normalizeDurationText(text: string): string | null {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (!normalized.startsWith('duracion')) return null;

  const duration = text.split(':').slice(1).join(':').trim();
  return duration || null;
}

function normalizeComparableTitle(value: string): string {
  const stopWords = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'en']);

  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word && !stopWords.has(word))
    .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
    .join(' ')
    .trim();
}

function isLevelMarker(title: string): boolean {
  return /^nivel\s*\d+\s*-/i.test(title.trim());
}

function titlesMatch(first: string, second: string): boolean {
  const a = normalizeComparableTitle(first);
  const b = normalizeComparableTitle(second);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const aWords = new Set(a.split(' '));
  const bWords = new Set(b.split(' '));
  const overlap = Array.from(aWords).filter((word) => bWords.has(word)).length;

  return overlap >= 2 && overlap >= Math.min(aWords.size, bWords.size) - 1;
}

function findLikelyMaster(
  levelTitle: string,
  masters: Course[],
): Course | undefined {
  const levelWords = new Set(normalizeComparableTitle(levelTitle).split(' '));

  return masters.find((master) => {
    const masterText = normalizeComparableTitle(
      `${master.title} ${master.description || ''}`,
    );
    const overlap = Array.from(levelWords).filter((word) =>
      masterText.includes(word),
    ).length;
    return overlap >= 2 || (levelWords.has('sql') && masterText.includes('sql'));
  });
}

function inferMissingMasterLevels(courses: Course[]): Course[] {
  const masters = courses.filter((course) => /^master\s+/i.test(course.title));
  const levelMarkers = courses.filter((course) => isLevelMarker(course.title));
  if (!masters.length || !levelMarkers.length) return courses;

  for (const marker of levelMarkers) {
    const levelTitle = marker.title.replace(/^nivel\s*\d+\s*-\s*/i, '');
    const levelNumber = Number(marker.title.match(/^nivel\s*(\d+)/i)?.[1] || 0);
    const master = findLikelyMaster(levelTitle, masters);
    if (!master) continue;

    const matchedCourse = courses.find(
      (course) =>
        course !== marker &&
        !/^master\s+/i.test(course.title) &&
        !isLevelMarker(course.title) &&
        titlesMatch(course.title, levelTitle),
    );

    if (matchedCourse && !matchedCourse.master_name) {
      matchedCourse.master_name = master.title;
      matchedCourse.master_level = levelNumber || null;
      matchedCourse.level = levelNumber ? `Nivel ${levelNumber}` : matchedCourse.level;
    }
  }

  return courses.filter(
    (course) => !(isLevelMarker(course.title) && !course.duration && !course.master_name),
  );
}

function normalizeCourseCatalog(courses: Course[]): Course[] {
  const normalizedCourses = courses.map((course) => {
    const normalizedCourse: Course = {
      ...course,
      title: course.title.trim(),
      master_name: course.master_name?.trim() || null,
    };

    if (normalizedCourse.duration || !normalizedCourse.description) {
      return normalizedCourse;
    }

    const duration = normalizeDurationText(normalizedCourse.description);
    if (!duration) return normalizedCourse;

    return {
      ...normalizedCourse,
      duration,
      description: null,
    };
  });

  return inferMissingMasterLevels(normalizedCourses).filter(
    (course) => !isExcludedRecommendationCourse(course),
  );
}

// ============================================
// Authentication (Supabase)
// Students are allowlisted in Supabase and receive one-time email codes.
// ============================================

export async function findAuthorizedStudentByEmail(
  email: string,
): Promise<AuthorizedStudent | null> {
  const normalizedEmail = email.toLowerCase().trim();
  const emailColumns = [
    'user_access_email',
    'user_purchase_email',
    'email',
    'correo',
    'correo_electronico',
    'correo electrónico',
    'e_mail',
  ];

  for (const column of emailColumns) {
    const { data: student, error: studentError } = await authSupabase
      .from(authUsersTable)
      .select('*')
      .eq(column, normalizedEmail)
      .maybeSingle();

    if (!studentError && student) {
      const row = student as Record<string, unknown>;
      if (!isAuthorizedUserRow(row)) return null;

      return {
        id: String(row.id || row.user_id || row.uuid || normalizedEmail),
        email: pickString(row, emailColumns) || normalizedEmail,
        name: userNameFromRow(row),
      };
    }

    if (studentError && !MISSING_SCHEMA_ERROR_CODES.has(studentError.code || '')) {
      console.error(`findAuthorizedStudentByEmail ${authUsersTable} error:`, studentError);
      return null;
    }

    if (studentError && ['PGRST205', '42P01'].includes(studentError.code || '')) break;
  }

  if (authUsersTable !== 'students' && authSupabase === supabase) {
    const { data: legacyStudent, error: legacyError } = await supabase
      .from('students')
      .select('*')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (!legacyError && legacyStudent) {
      if (!isActiveSubscriptionStatus(legacyStudent.status)) return null;

      return {
        id: String(legacyStudent.id || normalizedEmail),
        email: String(legacyStudent.email || normalizedEmail),
        name: legacyStudent.full_name || legacyStudent.name || null,
      };
    }

    if (legacyError && legacyError.code !== 'PGRST116') {
      console.error('findAuthorizedStudentByEmail students error:', legacyError);
    }
  }

  return null;
}

// ============================================
// Conversations & Messages (Supabase)
// Conversations are identified by a client-generated ID.
// ============================================

export async function getOrCreateConversation(
  conversationId: string,
  email: string,
  name: string | null,
): Promise<string> {
  // Check if conversation already exists
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('conversations')
      .update({
        user_email: email,
        user_name: name,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    return existing.id;
  }

  // Create it
  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      id: conversationId,
      user_email: email,
      user_name: name,
    })
    .select('id')
    .single();

  if (error) {
    console.error('getOrCreateConversation error:', error);
    // Return the ID anyway — messages will still be saved
    return conversationId;
  }

  return created.id;
}

export async function saveMessage(
  conversationId: string,
  role: string,
  content: string,
) {
  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    role,
    content,
  });

  if (error) {
    console.error('saveMessage error:', error);
  }
}

export async function getConversationMessages(
  conversationId: string,
): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getConversationMessages error:', error);
    return [];
  }

  return (data || []) as Message[];
}

// ============================================
// Study Plans (Supabase)
// ============================================

function buildStudyPlanOutputRow(
  conversationId: string,
  userId: string,
  planData: StudyPlanData,
) {
  return {
    conversation_id: conversationId || null,
    user_email: userId || planData.email,
    student_name: planData.studentName || null,
    current_situation: planData.currentSituation || null,
    professional_goal: planData.professionalGoal || null,
    specific_skills: planData.specificSkills || null,
    weekly_hours: planData.weeklyHours || null,
    target_timeline: planData.targetTimeline || null,
    courses: planData.courses || [],
    total_estimated_weeks: planData.totalEstimatedWeeks || null,
    weekly_schedule: planData.weeklySchedule || null,
    additional_notes: planData.additionalNotes || null,
    plan_data: planData,
  };
}

export async function saveStudyPlan(
  conversationId: string,
  userId: string,
  planData: StudyPlanData,
): Promise<string | null> {
  const { data, error } = await authSupabase
    .from(pdiOutputTable)
    .insert(buildStudyPlanOutputRow(conversationId, userId, planData))
    .select('id')
    .single();

  if (error) {
    console.error(`saveStudyPlan ${pdiOutputTable} error:`, error);
    return null;
  }

  const pdiId = String(data.id);
  const planWithId = { ...planData, pdiSupabaseId: pdiId };
  const { error: updateError } = await authSupabase
    .from(pdiOutputTable)
    .update({ plan_data: planWithId })
    .eq('id', pdiId);

  if (updateError) {
    console.error(`saveStudyPlan ${pdiOutputTable} plan_data update error:`, updateError);
  }

  return pdiId;
}

export async function markStudyPlanPdfGeneratedInSupabase(
  planData: StudyPlanData,
  pdfFile: {
    filename: string;
    contentType: string;
    buffer: Buffer;
  },
): Promise<string | null> {
  let pdiId = planData.pdiSupabaseId || null;

  if (!pdiId) {
    pdiId = await saveStudyPlan('', planData.email, planData);
  }

  if (!pdiId) return null;

  const pdfGeneratedAt = planData.pdfGeneratedAt || new Date().toISOString();
  const planWithPdf = {
    ...planData,
    pdiSupabaseId: pdiId,
    pdfGeneratedAt,
  };

  const { error } = await authSupabase
    .from(pdiOutputTable)
    .update({
      pdf_generated_at: pdfGeneratedAt,
      pdf_filename: pdfFile.filename,
      pdf_content_type: pdfFile.contentType,
      pdf_size_bytes: pdfFile.buffer.length,
      pdf_file_base64: pdfFile.buffer.toString('base64'),
      plan_data: planWithPdf,
    })
    .eq('id', pdiId);

  if (error) {
    console.error(`markStudyPlanPdfGeneratedInSupabase ${pdiOutputTable} error:`, error);
    return null;
  }

  return pdiId;
}

export async function getLatestStudyPlan(
  email: string,
): Promise<StudyPlanData | null> {
  const { data, error } = await authSupabase
    .from(pdiOutputTable)
    .select('plan_data')
    .eq('user_email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.plan_data as StudyPlanData;
}

// ============================================
// Course Catalog (Local JSON file — read-only in prod)
// ============================================

export async function getAllCourses(): Promise<Course[]> {
  try {
    const filePath = path.join(process.cwd(), 'data', 'courses.json');
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf8');
    return normalizeCourseCatalog(JSON.parse(content) as Course[]);
  } catch (error) {
    console.error('getAllCourses error:', error);
    return [];
  }
}

export async function upsertCourses(
  courses: Omit<Course, 'id' | 'synced_at'>[],
) {
  const filePath = path.join(process.cwd(), 'data', 'courses.json');
  const now = new Date().toISOString();
  const coursesWithIds: Course[] = courses.map((c, i) => ({
    ...c,
    id: `course_${Date.now()}_${i}`,
    synced_at: now,
  }));
  fs.writeFileSync(filePath, JSON.stringify(coursesWithIds, null, 2));
}
