import OpenAI from 'openai';

// ============================================
// OpenAI Client Configuration
// ============================================

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const CHAT_MODEL = 'gpt-5.4-mini';
export const PLAN_MODEL = 'gpt-4o';
