import { NextRequest, NextResponse } from 'next/server';
import { generateStudyPlan } from '@/lib/agent/chat-engine';

// ============================================
// POST /api/study-plan
// Generates structured study plan from conversation
// ============================================

export async function POST(request: NextRequest) {
  try {
    const { conversationId, userId, userName, userEmail, clientMessages } = await request.json();

    if (!conversationId || !userId || !userEmail || userEmail === 'anonimo@daxus.com') {
      return NextResponse.json(
        { error: 'Faltan parámetros requeridos.' },
        { status: 400 }
      );
    }

    const planData = await generateStudyPlan(
      conversationId,
      userId,
      userName,
      userEmail,
      clientMessages
    );

    return NextResponse.json({ success: true, plan: planData });
  } catch (error) {
    console.error('Study plan error:', error);
    return NextResponse.json(
      { error: 'Erro ao gerar o plano de estudos. Por favor, tente novamente.' },
      { status: 500 }
    );
  }
}
