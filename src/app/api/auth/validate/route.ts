import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  findAuthorizedStudentByEmail,
  getConversationMessages,
  getOrCreateConversation,
  getLatestStudyPlan,
} from '@/lib/supabase';

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().trim() : '';
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildConversationId(): string {
  return `conv_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}

async function validateEmail(email: string) {
  const student = await findAuthorizedStudentByEmail(email);
  if (!student) {
    return NextResponse.json(
      {
        valid: false,
        message: 'Este e-mail nao aparece como valido para acessar. Por favor fale conosco no CS.',
      },
      { status: 403 },
    );
  }

  const conversationId = await getOrCreateConversation(
    buildConversationId(),
    email,
    student.name,
  );
  const messages = await getConversationMessages(conversationId);
  const latestStudyPlan = await getLatestStudyPlan(email);

  return NextResponse.json({
    valid: true,
    verified: true,
    userId: student.id || conversationId,
    userName: student.name,
    email,
    conversationId,
    existingMessages: messages.map((message) => ({
      role: message.role,
      content: message.content,
      createdAt: message.created_at,
    })),
    latestStudyPlan,
  });
}

export async function POST(request: NextRequest) {
  try {
    const { email: rawEmail } = await request.json();
    const email = normalizeEmail(rawEmail);

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { valid: false, message: 'Digite um e-mail valido.' },
        { status: 400 },
      );
    }

    return validateEmail(email);
  } catch (error) {
    console.error('Auth validation error:', error);
    return NextResponse.json(
      {
        valid: false,
        message: 'Erro ao validar o e-mail. Tente novamente.',
      },
      { status: 500 },
    );
  }
}
