import { NextRequest, NextResponse } from 'next/server';
import { fetchCoursesFromNotion } from '@/lib/notion';
import { upsertCourses } from '@/lib/supabase';

// ============================================
// GET /api/courses/sync
// Syncs courses from Notion to Supabase
// Used by Vercel Cron Job (monthly)
// ============================================

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret for security (Vercel Cron Jobs send this)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch courses from Notion
    const courses = await fetchCoursesFromNotion();

    // Upsert to local store
    await upsertCourses(courses);

    return NextResponse.json({
      success: true,
      message: `${courses.length} cursos sincronizados com sucesso.`,
      count: courses.length,
    });
  } catch (error) {
    console.error('Course sync error:', error);
    return NextResponse.json(
      { error: 'Erro ao sincronizar cursos.' },
      { status: 500 }
    );
  }
}

// Also allow POST for manual sync
export async function POST(request: NextRequest) {
  return GET(request);
}
