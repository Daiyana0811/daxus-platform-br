import { NextRequest } from 'next/server';
import { processMessage } from '@/lib/agent/chat-engine';

// ============================================
// POST /api/chat
// Processes chat messages with GPT-4o streaming
// ============================================

export async function POST(request: NextRequest) {
  try {
    const { conversationId, message, userId, userName, userEmail, fileContent, fileName, clientMessages } = await request.json();

    if (!conversationId || !message || !userId || !userEmail || userEmail === 'anonimo@daxus.com') {
      return new Response(
        JSON.stringify({ error: 'Faltan parámetros requeridos.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Process message and get streaming response
    const stream = await processMessage(
      conversationId,
      message,
      userId,
      userName,
      userEmail,
      fileContent,
      fileName,
      clientMessages
    );

    // Return as Server-Sent Events stream
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Chat error:', error);
    return new Response(
      JSON.stringify({ error: 'Error en el chat. Por favor intenta de nuevo.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
