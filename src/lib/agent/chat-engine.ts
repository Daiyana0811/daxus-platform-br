import { openai, CHAT_MODEL, PLAN_MODEL } from '../openai';
import {
  getAllCourses,
  getConversationMessages,
  getOrCreateConversation,
  isExcludedRecommendationCourse,
  isRecordedStudyContent,
  saveMessage,
  saveStudyPlan,
  type Message,
  type Course,
  type StudyPlanData,
} from '../supabase';
import { buildSystemPrompt, PLAN_EXTRACTION_PROMPT } from './system-prompt';

// ============================================
// Chat Engine — Processes messages with GPT-4o
// ============================================

export interface ChatResponse {
  stream: ReadableStream<Uint8Array>;
  planReady: boolean;
}

type ClientChatMessage = { role: 'user' | 'assistant'; content: string };

function staticAssistantStream(content: string, planReady = false): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ content, done: false })}\n\n`)
      );
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ content: '', done: true, planReady })}\n\n`)
      );
      controller.close();
    },
  });
}

function hasWeeklyStudyHours(text: string): boolean {
  return (
    /horas semanais\s*:\s*(\d+(?:[.,]\d+)?)/i.test(text) ||
    /(\d+(?:[.,]\d+)?)\s*horas?\s*(?:semanais|por semana|diarias|por dia|ao dia|al dia)?/i.test(text)
  );
}

function hasGoalAndTimeline(text: string): boolean {
  const normalized = normalizeForSearch(text);
  const hasGoal =
    /objetivo profissional\s*:/i.test(text) ||
    [
      'quero',
      'meu objetivo',
      'busco',
      'gostaria',
      'me tornar',
      'liderar',
      'aprender',
      'automatizar',
      'quiero',
      'mi objetivo',
      'convertirme',
    ].some((term) => normalized.includes(normalizeForSearch(term)));
  const hasTimeline =
    /timeline\s*:/i.test(text) ||
    /prazo\s*:/i.test(text) ||
    /plazo\s*:/i.test(text) ||
    /(\d+)\s*(mes|meses|semana|semanas|ano|anos)/i.test(text);

  return hasGoal && hasTimeline;
}

function isRouteOrConfirmationMoment(text: string): boolean {
  const normalized = normalizeForSearch(text);
  return [
    'correto',
    'certo',
    'sim',
    'ok',
    'pronto',
    'continua',
    'continue',
    'gerar',
    'trilha',
    'plano',
    'correto',
    'si',
    'trilha',
    'plan',
  ].some((term) => normalized.includes(normalizeForSearch(term)));
}

function shouldAskWeeklyStudyHours(messages: Message[], userMessage: string): boolean {
  const conversationText = getConversationText(messages);
  if (hasWeeklyStudyHours(conversationText)) return false;
  if (!hasGoalAndTimeline(conversationText)) return false;
  return isRouteOrConfirmationMoment(userMessage);
}

function mentionsAutomation(text: string): boolean {
  const normalized = normalizeForSearch(text);
  return [
    'automatizar',
    'automacao',
    'automacoes',
    'otimizar processos',
    'automacao',
    'automacoes',
    'otimizar processos',
    'rpa',
    'agentes',
  ].some((term) => normalized.includes(normalizeForSearch(term)));
}

function hasProgrammingPreference(text: string): boolean {
  const normalized = normalizeForSearch(text);
  return (
    /(com|sem)\s+programa[c?][a?]o/i.test(text) ||
    /(con|sin)\s+programaci[o?]n/i.test(text) ||
    /(quero|me interessa|desejo|prefiro|aceito|sim|quiero|me interesa|deseo|prefiero|acepto|si)[^.\n]*(programar|programa[c?][a?]o|programaci[o?]n|codigo|c[o?]digo)/i.test(text) ||
    /(nao quero|n?o quero|nao desejo|n?o desejo|nao me interessa|n?o me interessa|prefiro nao|prefiro n?o|sem|no quiero|no deseo|no me interesa|prefiero no|sin)[^.\n]*(programar|programa[c?][a?]o|programaci[o?]n|codigo|c[o?]digo)/i.test(text) ||
    normalized.includes('no code') ||
    normalized.includes('nocode') ||
    normalized.includes('low code') ||
    normalized.includes('lowcode')
  );
}

function hasNoCodePreference(text: string): boolean {
  const normalized = normalizeForSearch(text);
  return (
    normalized.includes('sem programacao') ||
    normalized.includes('sin programacion') ||
    normalized.includes('no code') ||
    normalized.includes('nocode') ||
    normalized.includes('low code') ||
    normalized.includes('lowcode') ||
    normalized.includes('sem codigo') ||
    normalized.includes('sin codigo')
  );
}

function extractClosedSkillsAnswer(messages: Message[]): string {
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .reverse();

  for (const content of userMessages) {
    const normalized = normalizeForSearch(content);
    const mentionsExcelBasic =
      normalized.includes('excel basico') ||
      normalized.includes('excel básico') ||
      normalized.includes('excel basic') ||
      normalized.includes('excel iniciante') ||
      normalized.includes('excel inicial');
    const deniesMoreKnowledge =
      normalized.includes('no tengo mas') ||
      normalized.includes('nao tenho mais') ||
      normalized.includes('nao tenho outros') ||
      normalized.includes('no tengo otros') ||
      normalized.includes('nao conheco mais') ||
      normalized.includes('no conozco mas') ||
      normalized.includes('solo excel') ||
      normalized.includes('so excel') ||
      normalized.includes('apenas excel') ||
      normalized.includes('somente excel');

    if (mentionsExcelBasic && deniesMoreKnowledge) return 'Excel basico';
    if (mentionsExcelBasic && content.length < 90) return 'Excel basico';
  }

  return '';
}

function buildConversationFactsNote(messages: Message[]): string | null {
  const conversationText = getConversationText(messages);
  const closedSkills = extractClosedSkillsAnswer(messages);
  const noCodePreference = hasNoCodePreference(conversationText);
  const mandatoryBasicsAnswered =
    hasGoalAndTimeline(conversationText) &&
    hasWeeklyStudyHours(conversationText) &&
    Boolean(closedSkills || inferSpecificSkills(messages, conversationText)) &&
    (!mentionsAutomation(conversationText) || noCodePreference || hasProgrammingPreference(conversationText));

  const facts: string[] = [];
  if (closedSkills) {
    facts.push(
      `O aluno ja respondeu habilidades/conhecimentos especificos: ${closedSkills}. Considere isso suficiente; nao pergunte novamente sobre outras ferramentas como IA, automacao no-code, SQL, Power BI ou programacao.`,
    );
  }
  if (noCodePreference) {
    facts.push(
      'O aluno ja indicou preferencia por automacao sem programacao/no-code/low-code. Nao volte a perguntar se quer programacao.',
    );
  }
  if (mandatoryBasicsAnswered) {
    facts.push(
      'As informacoes obrigatorias para montar a trilha ja estao respondidas. Nao faca novas perguntas de refinamento; avance para resumo do perfil, validacao de realismo e trilha completa.',
    );
  }

  return facts.length ? facts.join('\n') : null;
}

function shouldAskAutomationProgrammingPreference(messages: Message[], userMessage: string): boolean {
  const conversationText = getConversationText(messages);
  if (!mentionsAutomation(userMessage) && !mentionsAutomation(conversationText)) return false;
  if (hasProgrammingPreference(conversationText)) return false;
  if (hasNoCodePreference(conversationText)) return false;
  return true;
}

function isTechnicalCourseSupportQuestion(message: string): boolean {
  const text = normalizeForSearch(message);
  const asksForTechnicalHelp = [
    'me explique',
    'explica',
    'explique',
    'resolva',
    'resolver',
    'me de o codigo',
    'me de o codigo',
    'codigo',
    'erro',
    'error',
    'bug',
    'formula',
    'funcao',
    'funcao',
    'query',
    'consulta sql',
    'pandas',
    'power query',
    'dax',
    'debug',
    'configurar',
    'instalar',
  ].some((term) => text.includes(term));
  const courseContentContext = [
    'curso',
    'aula',
    'aula',
    'exercicio',
    'exercicio',
    'python',
    'excel',
    'power bi',
    'sql',
    'javascript',
    'automacao',
    'automacao',
    'dashboard',
    'banco de dados',
    'base de dados',
  ].some((term) => text.includes(term));

  return asksForTechnicalHelp && courseContentContext;
}

function isStudyPlanRelatedMessage(message: string): boolean {
  const text = normalizeForSearch(message);
  if (!text) return true;
  if (/^\[arquivo:/i.test(message.trim())) return true;

  const inScopeTerms = [
    'pdi',
    'plano de desenvolvimento',
    'plano de estudo',
    'plano de estudos',
    'plan de estudio',
    'plan de estudios',
    'trilha',
    'ruta',
    'rota',
    'curso',
    'cursos',
    'daxus',
    'pdf',
    'download',
    'baixar',
    'descargar',
    'objetivo',
    'meta',
    'carreira',
    'carrera',
    'profissional',
    'profesional',
    'experiencia',
    'estudos',
    'estudios',
    'habilidades',
    'conhecimentos',
    'conocimientos',
    'curriculo',
    'curriculum',
    'cv',
    'perfil',
    'disponibilidade',
    'disponibilidad',
    'horas',
    'prazo',
    'plazo',
    'meses',
    'semanas',
    'linkedin',
    'excel',
    'power bi',
    'sql',
    'python',
    'ia',
    'inteligencia artificial',
    'automacao',
    'automatizar',
    'no code',
    'nocode',
    'low code',
    'lideranca',
    'liderazgo',
    'comunicacao',
    'comunicacion',
  ];

  if (inScopeTerms.some((term) => text.includes(normalizeForSearch(term)))) {
    return true;
  }

  const shortConversationalAnswer =
    text.length <= 90 &&
    !/[?¿]/.test(message) &&
    !/^(dime|me diga|cuentame|conte|explique|explica|haz|faca|escreva|escribe|traduce|traduza|resume|resuma)\b/i.test(text);

  return shortConversationalAnswer;
}

function isOutOfScopeRequest(message: string): boolean {
  if (isStudyPlanRelatedMessage(message)) return false;

  const text = normalizeForSearch(message);
  const looksLikeQuestion =
    /[?¿]/.test(message) ||
    /^(que|quem|quien|como|qual|cu[aá]l|cuando|cu[aá]ndo|donde|d[oó]nde|por que|porque|why|what|how|when|where)\b/i.test(text);
  const offTopicRequestTerms = [
    'chiste',
    'piada',
    'joke',
    'receta',
    'receita',
    'clima',
    'weather',
    'noticias',
    'news',
    'politica',
    'futbol',
    'pelicula',
    'filme',
    'musica',
    'poema',
    'cuento',
    'historia',
    'capital de',
    'traduce',
    'traduza',
    'resuelve',
    'resolva',
    'calcula',
    'codigo',
    'programa',
    'email de ventas',
    'copy',
  ];
  const looksLikeOffTopicCommand = offTopicRequestTerms.some((term) =>
    text.includes(normalizeForSearch(term)),
  );

  return looksLikeQuestion || looksLikeOffTopicCommand;
}

function clientMessagesToMessages(
  conversationId: string,
  clientMessages?: ClientChatMessage[]
): Message[] {
  return (clientMessages || []).map((message, index) => ({
    id: `client_${index}`,
    conversation_id: conversationId,
    role: message.role,
    content: message.content,
    created_at: new Date().toISOString(),
  }));
}

function selectBestConversationMessages(
  conversationId: string,
  savedMessages: Message[],
  clientMessages?: ClientChatMessage[]
): Message[] {
  const clientHistory = clientMessagesToMessages(conversationId, clientMessages);
  if (!clientHistory.length) return savedMessages;
  if (!savedMessages.length) return clientHistory;

  const savedAssistantCount = savedMessages.filter((message) => message.role === 'assistant').length;
  const clientAssistantCount = clientHistory.filter((message) => message.role === 'assistant').length;
  const savedHasRoute = savedMessages.some(
    (message) => message.role === 'assistant' && /trilha de estudos|master|duraci[oó]n/i.test(message.content)
  );
  const clientHasRoute = clientHistory.some(
    (message) => message.role === 'assistant' && /trilha de estudos|master|duraci[oó]n/i.test(message.content)
  );

  if (clientHasRoute && !savedHasRoute) return clientHistory;
  if (clientAssistantCount > savedAssistantCount) return clientHistory;
  if (clientHistory.length > savedMessages.length) return clientHistory;

  return savedMessages;
}

function ensureCurrentUserMessage(
  conversationId: string,
  messages: Message[],
  content: string,
): Message[] {
  const normalizedContent = content.trim();
  if (!normalizedContent) return messages;

  const alreadyPresent = messages.some(
    (message) =>
      message.role === 'user' &&
      message.content.trim() === normalizedContent,
  );
  if (alreadyPresent) return messages;

  return [
    ...messages,
    {
      id: `current_${Date.now()}`,
      conversation_id: conversationId,
      role: 'user',
      content: normalizedContent,
      created_at: new Date().toISOString(),
    },
  ];
}

/**
 * Process a user message and return a streaming response from GPT-4o.
 * Loads conversation history, courses, and builds context for the AI agent.
 */
export async function processMessage(
  conversationId: string,
  userMessage: string,
  userId: string,
  userName: string | null,
  userEmail: string,
  fileContent?: string,
  fileName?: string,
  clientMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<ReadableStream<Uint8Array>> {
  // 1. Ensure conversation exists in Supabase (creates it if not)
  await getOrCreateConversation(conversationId, userEmail, userName);

  // 2. Save the user's message
  const messageToSave = [
    fileContent ? `[Arquivo: ${fileName}]` : '',
    userMessage,
  ]
    .filter(Boolean)
    .join('\n\n');

  await saveMessage(conversationId, 'user', messageToSave);

  if (isTechnicalCourseSupportQuestion(userMessage)) {
    const redirectMessage =
      'Essa duvida tecnica do conteudo do curso deve ser revisada na comunidade Circle ou no espaco academico do curso, onde podem ajudar com codigo, exercicios, erros e configuracoes. Eu posso ajudar a ajustar seu PDI se essa dificuldade mudar seu objetivo, nivel atual ou ordem da trilha. Voce quer ajustar seu PDI a partir dessa duvida?';
    await saveMessage(conversationId, 'assistant', redirectMessage);
    return staticAssistantStream(redirectMessage);
  }

  if (isOutOfScopeRequest(userMessage)) {
    const scopeMessage =
      'Posso ajudar apenas com o seu PDI: diagnostico do perfil, trilha de estudos, cursos Daxus, disponibilidade, PDF ou ajustes do plano. Se quiser, me diga o que deseja ajustar na sua trilha de estudos.';
    await saveMessage(conversationId, 'assistant', scopeMessage);
    return staticAssistantStream(scopeMessage);
  }

  // 3. Load conversation history
  const savedMessages = await getConversationMessages(conversationId);
  const messages = ensureCurrentUserMessage(
    conversationId,
    selectBestConversationMessages(
      conversationId,
      savedMessages,
      clientMessages
    ),
    messageToSave,
  );

  if (shouldAskAutomationProgrammingPreference(messages, userMessage)) {
    const automationQuestion =
      'Para orientar bem uma trilha de automacao, voce quer aprender a automatizar com programacao ou prefere fazer sem programacao usando ferramentas no-code/low-code?';
    await saveMessage(conversationId, 'assistant', automationQuestion);
    return staticAssistantStream(automationQuestion);
  }

  if (shouldAskWeeklyStudyHours(messages, userMessage)) {
    const weeklyHoursQuestion =
      'Antes de montar sua trilha, preciso de um dado chave para calcular a duracao realista: quantas horas por semana voce pode dedicar aos estudos?';
    await saveMessage(conversationId, 'assistant', weeklyHoursQuestion);
    return staticAssistantStream(weeklyHoursQuestion);
  }

  // 4. Load available courses
  const courses = await getAllCourses();

  // 5. Check for previous profile data from past conversations
  // (extracted_profile from previous completed conversations)
  let previousProfile = null;
  // This is handled by the system prompt if profile data exists

  // 6. Build system prompt with courses catalog
  const systemPrompt = buildSystemPrompt(courses, previousProfile, {
    name: userName,
    email: userEmail,
  });
  const conversationFactsNote = buildConversationFactsNote(messages);

  // 7. Build message array for OpenAI
  const openaiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];
  if (conversationFactsNote) {
    openaiMessages.push({
      role: 'system',
      content: `FATOS JA RESPONDIDOS NESTA CONVERSA:\n${conversationFactsNote}`,
    });
  }

  // Add conversation history
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'system') continue;
    
    let content = msg.content;
    
    // If it's the last message and has file context, inject it for the LLM.
    if (i === messages.length - 1 && msg.role === 'user' && fileContent) {
      content = `EL ESTUDIANTE HA CARGADO UN ARCHIVO (${fileName}):\n\n--- INICIO DEL CONTENIDO DEL ARCHIVO ---\n${fileContent}\n--- FIN DEL CONTENIDO DEL ARCHIVO ---\n\nMENSAJE DEL ESTUDIANTE: ${userMessage}`;
    }

    openaiMessages.push({
      role: msg.role as 'user' | 'assistant',
      content: content,
    });
  }

  // 8. Call GPT-4o with streaming
  const completion = await openai.chat.completions.create({
    model: CHAT_MODEL,
    messages: openaiMessages,
    temperature: 0.7,
    ...(CHAT_MODEL.startsWith('gpt-5')
      ? { max_completion_tokens: 3500 }
      : { max_tokens: 3500 }),
    stream: true,
  });

  // 9. Create a transform stream that collects the full response and saves it
  let fullResponse = '';
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of completion) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullResponse += content;
            // Send as SSE format
            const data = JSON.stringify({ content, done: false });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
        }

        // Check if plan is ready
        const planReady = fullResponse.includes('[PLAN_READY]');

        // Send completion signal
        const doneData = JSON.stringify({ content: '', done: true, planReady });
        controller.enqueue(encoder.encode(`data: ${doneData}\n\n`));

        // Save the assistant's full response (strip the [PLAN_READY] marker)
        const cleanResponse = fullResponse.replace('[PLAN_READY]', '').trim();
        await saveMessage(conversationId, 'assistant', cleanResponse);

        controller.close();
      } catch (error) {
        console.error('Stream error:', error);
        const errorData = JSON.stringify({ error: 'Error en la conversación', done: true });
        controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
        controller.close();
      }
    },
  });

  return stream;
}

// ============================================
// Generate Structured Study Plan from Conversation
// ============================================

const PLACEHOLDER_PATTERNS = [
  'objetivo profissional identificado',
  'situacao atual do aluno',
  'habilidades, ferramentas e conhecimentos',
  'nome exato do curso',
  'nome do master se aplica',
  'duracao real segundo notion',
  'por que este curso e recomendado',
  'descricao do horario semanal',
  'notas adicionais ou recomendacoes',
  'no identificada',
  'no identificado',
  'nao identificada',
  'nao identificado',
  'sem duracao',
];

function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isPlaceholderValue(value?: string | null): boolean {
  if (!value) return false;
  const normalized = normalizeForSearch(value);
  return PLACEHOLDER_PATTERNS.some((pattern) =>
    normalized.includes(normalizeForSearch(pattern))
  );
}

function parseJsonObject(content: string): any {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(trimmed);
}

function normalizeTitleForMatch(value: string): string {
  return normalizeForSearch(value)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokens(value: string): string[] {
  const stopWords = new Set(['com', 'de', 'do', 'da', 'dos', 'das', 'em', 'e', 'ou', 'um', 'uma', 'con', 'del', 'la', 'el', 'los', 'las']);
  return normalizeTitleForMatch(value)
    .split(' ')
    .filter((word) => word.length > 2 && !stopWords.has(word));
}

function scoreCourseTitleMatch(rawTitle: string, courseTitle: string): number {
  const raw = normalizeTitleForMatch(rawTitle);
  const candidate = normalizeTitleForMatch(courseTitle);
  if (!raw || !candidate) return 0;
  if (raw === candidate) return 1000 + candidate.length;
  if (raw.includes(candidate)) return 700 + candidate.length;
  if (candidate.includes(raw)) return 600 + raw.length;

  const rawTokens = new Set(titleTokens(rawTitle));
  const candidateTokens = titleTokens(courseTitle);
  const overlap = candidateTokens.filter((token) => rawTokens.has(token)).length;
  if (overlap < 2) return 0;

  const coverage = overlap / Math.max(candidateTokens.length, 1);
  const rawCoverage = overlap / Math.max(rawTokens.size, 1);
  return Math.round((coverage + rawCoverage) * 100) + candidate.length;
}

function findCourseInCatalog(rawTitle: string, courses: Course[]): Course | undefined {
  return courses
    .map((course) => ({ course, score: scoreCourseTitleMatch(rawTitle, course.title) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.course;
}

function extractLevelText(value: string): string | null {
  const completeMatch = value.match(/master\s+completo|completo/i);
  if (completeMatch) return 'Master completo';

  const levelsMatch = value.match(/niveles?\s*\d+(?:\s*[-–]\s*\d+)?/i);
  if (levelsMatch) return levelsMatch[0].replace(/\s+/g, ' ').trim();

  const levelMatch = value.match(/nivel\s*\d+(?:\s*[:\-–]\s*[^\n\r]+)?/i);
  return levelMatch?.[0]?.replace(/\s+/g, ' ').trim() || null;
}

function extractFirstMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1]
        .replace(/\*\*/g, '')
        .replace(/^[-–—:\s]+/, '')
        .trim();
    }
  }
  return '';
}

function estimatedWeeksFromDuration(duration: string, weeklyHours: number): number {
  const hoursMatch = duration.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hora)/i);
  const minutesMatch = duration.match(/(\d+)\s*(?:m|minuto)/i);
  const hours = hoursMatch ? Number(hoursMatch[1].replace(',', '.')) : 0;
  const minutes = minutesMatch ? Number(minutesMatch[1]) / 60 : 0;
  const totalHours = hours + minutes;
  if (!totalHours || !weeklyHours) return 0;
  return Math.max(1, Math.ceil((totalHours * 2) / weeklyHours));
}

type SupportCategory = 'linkedin' | 'career' | 'soft' | 'leadership';

function supportCategoryForTitle(title: string): SupportCategory | null {
  const text = normalizeForSearch(title);
  if (text.includes('linkedin')) return 'linkedin';
  if (text.includes('lideranca') || text.includes('motivar') || text.includes('desarrollar personas')) {
    return 'leadership';
  }
  if (
    text.includes('comunicacao') ||
    text.includes('inteligencia emocional') ||
    text.includes('oratoria') ||
    text.includes('habilidades blandas')
  ) {
    return 'soft';
  }
  return [
    'networking',
    'productividad',
    'gestion del tiempo',
    'procesos selectivos',
    'preparacion',
    'empleabilidad',
    'posicionamento',
    'carreira',
  ].some((term) => text.includes(term))
    ? 'career'
    : null;
}

function isCareerSupportTitle(title: string): boolean {
  return Boolean(supportCategoryForTitle(title));
}

function isMasterOrMasterLevelCourse(course?: Course | null): boolean {
  if (!course) return false;
  return Boolean(/^master\s+/i.test(course.title) || course.master_name || course.master_level);
}

function hasExplicitCourseRequest(contextText: string, title: string): boolean {
  const context = normalizeForSearch(contextText);
  const normalizedTitle = normalizeForSearch(title);
  if (!context || !normalizedTitle) return false;
  if (context.includes(normalizedTitle)) return true;

  const terms = normalizedTitle
    .split(/\s+/)
    .filter((term) => term.length > 3 && !['nivel', 'curso', 'master', 'fundamentos'].includes(term));
  if (!terms.length) return false;
  return terms.every((term) => context.includes(term));
}

function isAllowedTechnicalCourse(course: Course | undefined, contextText: string): boolean {
  if (!course) return false;
  if (isCareerSupportTitle(course.title)) return true;
  if (isMasterOrMasterLevelCourse(course)) return true;
  return hasExplicitCourseRequest(contextText, course.title);
}

function isSupportCourseRelevant(
  course: Course,
  category: SupportCategory,
  contextText: string,
): boolean {
  if (category === 'linkedin' || category === 'career') return true;

  const context = normalizeForSearch(contextText);
  const courseText = normalizeForSearch(`${course.title} ${course.description || ''}`);
  const sharedTerms = courseText
    .split(/\s+/)
    .filter((term) => term.length > 5)
    .some((term) => context.includes(term));

  if (sharedTerms) return true;

  if (category === 'leadership') {
    return [
      'lider',
      'lideranca',
      'liderazgo',
      'equipe',
      'equipo',
      'gerencia',
      'gestao',
      'coordinar',
      'direcao',
      'estrategia',
    ].some((term) => context.includes(term));
  }

  return [
    'comunicacao',
    'comunicacion',
    'apresentar',
    'presentar',
    'stakeholder',
    'cliente',
    'equipe',
    'equipo',
    'lider',
    'lideranca',
    'negociacao',
    'oratoria',
  ].some((term) => context.includes(term));
}

function buildCareerSupportCourse(
  course: Course,
  order: number,
  weeklyHours: number,
  category: SupportCategory = supportCategoryForTitle(course.title) || 'career',
): StudyPlanData['courses'][number] {
  const reasons: Record<SupportCategory, string> = {
    linkedin:
      'Complementa a trilha tecnica fortalecendo sua marca profissional e visibilidade no LinkedIn desde o inicio.',
    career:
      'Reforca seu posicionamento profissional para transformar o aprendizado tecnico em oportunidades concretas.',
    soft:
      'Desenvolve habilidades comportamentais para comunicar avancos, colaborar melhor e sustentar o crescimento profissional.',
    leadership:
      'Fortalece criterio de lideranca para aplicar o aprendizado com mais influencia, autonomia e visao estrategica.',
  };

  return {
    order,
    title: course.title,
    description: course.description || 'Formacao de carreira para fortalecer seu perfil profissional.',
    duration: course.duration || '',
    thumbnailUrl: course.thumbnail_url || '',
    masterName: null,
    level: null,
    reason: reasons[category],
    estimatedWeeks: estimatedWeeksFromDuration(course.duration || '', weeklyHours) || 1,
  };
}

function findPreferredSupportCourse(
  catalogCourses: Course[],
  category: SupportCategory,
  usedTitles: Set<string>,
  contextText = '',
): Course | undefined {
  const preferred: Record<SupportCategory, string[]> = {
    linkedin: ['linkedin magnetico'],
    career: [
      'networking con proposito como hablar y conectar en espacios sociales',
      'productividad y gestion del tiempo',
      'curso de oratoria',
    ],
    soft: ['comunicacao', 'inteligencia emocional', 'curso de oratoria'],
    leadership: ['lideranca personal', 'motivar y desarrollar personas'],
  };

  const candidates = catalogCourses.filter((course) => {
    const normalizedTitle = normalizeForSearch(course.title);
    return (
      supportCategoryForTitle(course.title) === category &&
      !isExcludedRecommendationCourse(course.title) &&
      isRecordedStudyContent(course) &&
      isSupportCourseRelevant(course, category, contextText) &&
      !usedTitles.has(normalizedTitle)
    );
  });

  for (const title of preferred[category]) {
    const found = candidates.find((course) => normalizeForSearch(course.title) === title);
    if (found) return found;
  }

  return candidates[0];
}

function isProgrammingRelatedTitle(title: string): boolean {
  const text = normalizeForSearch(title);
  return [
    'python',
    'javascript',
    'programacao',
    'automacao',
    'agentes',
    'web scraping',
    'macros',
    'vba',
  ].some((term) => text.includes(term));
}

function hasBasicProgrammingContext(contextText: string): boolean {
  const text = normalizeForSearch(contextText);
  return (
    /programaci[oó]n[^.\n]*(basico|basica|cero|nulo|nula|inicial|ningun|ninguna|no tengo|nunca)/i.test(text) ||
    /(basico|basica|cero|nulo|nula|inicial|ningun|ninguna|no tengo|nunca)[^.\n]*programaci[oó]n/i.test(text)
  );
}

function ensureProgrammingFoundation(
  planCourses: StudyPlanData['courses'],
  catalogCourses: Course[],
  weeklyHours: number,
  contextText: string,
): StudyPlanData['courses'] {
  if (!hasBasicProgrammingContext(contextText)) return planCourses;
  if (!planCourses.some((course) => isProgrammingRelatedTitle(course.title))) return planCourses;
  if (planCourses.some((course) => normalizeForSearch(course.title) === 'fundamentos de python')) {
    return planCourses;
  }

  const fundamentos = catalogCourses.find(
    (course) =>
      normalizeForSearch(course.title) === 'fundamentos de python' &&
      !isExcludedRecommendationCourse(course.title),
  );
  if (!fundamentos) return planCourses;

  const firstProgrammingIndex = planCourses.findIndex((course) =>
    isProgrammingRelatedTitle(course.title)
  );
  const foundationCourse = {
    ...buildCareerSupportCourse(fundamentos, 1, weeklyHours, 'career'),
    description: fundamentos.description || 'Fundamentos de programacao com Python.',
    masterName: fundamentos.master_name || 'Master Python',
    level: fundamentos.level || 'Nivel 1',
    reason:
      'Recomendado antes de cursos avancados porque sua base de programacao e inicial e voce precisa dominar logica, sintaxe e pratica guiada com Python.',
  };

  const copy = [...planCourses];
  copy.splice(Math.max(0, firstProgrammingIndex), 0, foundationCourse);
  return copy;
}

const TECHNICAL_FALLBACK_RULES = [
  {
    triggers: [
      'analitica',
      'analise de dados',
      'dados',
      'data',
      'power bi',
      'dashboard',
      'indicadores',
      'relatorios',
      'bi',
    ],
    titles: [
      'Fundamentos de Power BI',
      'Design de Dashboards',
      'Fundamentos de DAX',
      'Dominando o Power Query e Modelagem de Dados',
      'Fundamentos de SQL',
      'Analise de Dados com Excel',
    ],
  },
  {
    triggers: ['automacao', 'automatizar', 'otimizar processos', 'ia', 'inteligencia artificial', 'agentes'],
    titles: [
      'Primeiros Passos na Inteligencia Artificial',
      'ChatGPT Descomplicado',
      'Aplicacoes com Inteligencia Artificial',
      'Prompts na Pratica',
      'Automacoes e Agentes de IA',
    ],
  },
  {
    triggers: ['excel', 'planilhas'],
    titles: ['Fundamentos de Excel', 'Analise de Dados com Excel', 'Dashboards profissionais com Excel'],
  },
  {
    triggers: ['sql', 'bancos de dados', 'base de dados', 'consultas'],
    titles: ['Nocoes da Linguagem SQL', 'Fundamentos de SQL', 'SQL Avancado', 'Administracao de Bancos de Dados'],
  },
  {
    triggers: ['python', 'programacao', 'programar', 'codigo', 'desenvolvimento'],
    titles: [
      'Primeiros passos com Python',
      'Analise de Dados com Python',
      'Automacao de Tarefas com Python',
      'Dominando a linguagem Python',
    ],
  },
];

function buildTechnicalCourseReason(course: Course, contextText: string): string {
  const title = course.title;
  const context = normalizeForSearch(contextText);

  if (context.includes('analitica') || context.includes('dados') || context.includes('power bi')) {
    return `Recomendado porque ${title} fortalece uma habilidade tecnica chave para analisar dados, construir evidencias e comunicar decisoes com clareza.`;
  }

  if (context.includes('automacao') || context.includes('ia') || context.includes('inteligencia artificial')) {
    return `Recomendado porque ${title} ajuda voce a otimizar tarefas e transformar ferramentas digitais em melhorias praticas para seu trabalho.`;
  }

  if (context.includes('programacao') || context.includes('python')) {
    return `Recomendado porque ${title} constroi uma base pratica para resolver problemas com logica, codigo e projetos aplicaveis.`;
  }

  return `Recomendado porque ${title} contribui com uma habilidade tecnica concreta para avancar rumo ao seu objetivo profissional.`;
}

function buildTechnicalStudyCourse(
  course: Course,
  order: number,
  weeklyHours: number,
  contextText: string,
): StudyPlanData['courses'][number] {
  const duration = course.duration || '';
  return {
    order,
    title: course.title,
    description: course.description || '',
    duration,
    thumbnailUrl: course.thumbnail_url || '',
    masterName: course.master_name || null,
    level: course.level || (course.master_level ? `Nivel ${course.master_level}` : null),
    reason: buildTechnicalCourseReason(course, contextText),
    estimatedWeeks: estimatedWeeksFromDuration(duration, weeklyHours) || 1,
  };
}

function isArtificialIntelligenceContext(contextText: string): boolean {
  const text = normalizeForSearch(contextText);
  return (
    text.includes('inteligencia artificial') ||
    /\bia\b/.test(text) ||
    text.includes('chatgpt') ||
    text.includes('agentes')
  );
}

function resolveAiCoursePreference(
  course: Course | undefined,
  catalogCourses: Course[],
  contextText: string,
): Course | undefined {
  if (!course) return undefined;
  if (!isArtificialIntelligenceContext(contextText)) return course;
  if (normalizeForSearch(course.title) !== 'inteligencia artificial') return course;

  return (
    catalogCourses.find(
      (candidate) =>
        normalizeForSearch(candidate.title) === 'primeros pasos en inteligencia artificial' &&
        !isExcludedRecommendationCourse(candidate.title),
    ) || course
  );
}

function findExactCatalogCourse(title: string, courses: Course[]): Course | undefined {
  const normalizedTitle = normalizeForSearch(title);
  return courses.find((course) => normalizeForSearch(course.title) === normalizedTitle);
}

function buildTechnicalFallbackCourses(
  contextText: string,
  catalogCourses: Course[],
  weeklyHours: number,
  usedTitles: Set<string>,
): StudyPlanData['courses'] {
  const normalizedContext = normalizeForSearch(contextText);
  const selectedTitles: string[] = [];

  for (const rule of TECHNICAL_FALLBACK_RULES) {
    const matchesContext = rule.triggers.some((trigger) =>
      normalizedContext.includes(normalizeForSearch(trigger))
    );
    if (!matchesContext) continue;

    for (const title of rule.titles) {
      if (!selectedTitles.some((selected) => normalizeForSearch(selected) === normalizeForSearch(title))) {
        selectedTitles.push(title);
      }
    }
  }

  return selectedTitles
    .map((title) => findExactCatalogCourse(title, catalogCourses))
    .map((course) => course && resolveAiCoursePreference(course, catalogCourses, contextText))
    .filter((course): course is Course =>
      Boolean(
        course &&
        !usedTitles.has(normalizeForSearch(course.title)) &&
        !isCareerSupportTitle(course.title) &&
        isRecordedStudyContent(course) &&
        isAllowedTechnicalCourse(course, contextText)
      )
    )
    .filter((course) => !isExcludedRecommendationCourse(course.title))
    .slice(0, 6)
    .map((course, index) => buildTechnicalStudyCourse(course, index + 1, weeklyHours, contextText));
}

function ensureCareerSupportCourse(
  planCourses: StudyPlanData['courses'],
  catalogCourses: Course[],
  weeklyHours: number,
  contextText = '',
): StudyPlanData['courses'] {
  const withProgrammingFoundation = ensureProgrammingFoundation(
    planCourses,
    catalogCourses,
    weeklyHours,
    contextText,
  );

  const catalogBackedCourses = withProgrammingFoundation.filter((course) => {
    if (!course.title || isExcludedRecommendationCourse(course.title)) return false;
    const catalogCourse = findCourseInCatalog(course.title, catalogCourses);
    if (!catalogCourse) return false;
    if (!isRecordedStudyContent(catalogCourse)) return false;
    if (isCareerSupportTitle(course.title)) return true;
    return isAllowedTechnicalCourse(catalogCourse, contextText);
  });

  const usedTitles = new Set(catalogBackedCourses.map((course) => normalizeForSearch(course.title)));
  let technicalCourses = catalogBackedCourses.filter((course) => !isCareerSupportTitle(course.title));

  if (!technicalCourses.length) {
    technicalCourses = buildTechnicalFallbackCourses(contextText, catalogCourses, weeklyHours, usedTitles);
    technicalCourses.forEach((course) => usedTitles.add(normalizeForSearch(course.title)));
  }

  const requiredCategories: SupportCategory[] = ['linkedin', 'career', 'soft', 'leadership'];
  const supportCourses = requiredCategories.flatMap((category) => {
    const existing = catalogBackedCourses.find(
      (course) => supportCategoryForTitle(course.title) === category
    );
    if (existing) return [existing];

    const catalogCourse = findPreferredSupportCourse(catalogCourses, category, usedTitles, contextText);
    if (!catalogCourse) return [];
    usedTitles.add(normalizeForSearch(catalogCourse.title));
    return [buildCareerSupportCourse(catalogCourse, 1, weeklyHours, category)];
  });

  if (!technicalCourses.length) {
    return (supportCourses.length ? supportCourses : catalogBackedCourses).map((course, index) => ({
      ...course,
      order: index + 1,
    }));
  }

  const finalCourses: StudyPlanData['courses'] = [];
  finalCourses.push(technicalCourses[0]);
  const linkedinCourse = supportCourses.find((course) => supportCategoryForTitle(course.title) === 'linkedin');
  const remainingSupportCourses = supportCourses.filter(
    (course) => supportCategoryForTitle(course.title) !== 'linkedin',
  );
  if (linkedinCourse) finalCourses.push(linkedinCourse);
  if (technicalCourses[1]) finalCourses.push(technicalCourses[1]);
  if (remainingSupportCourses[0]) finalCourses.push(remainingSupportCourses[0]);
  if (technicalCourses[2]) finalCourses.push(technicalCourses[2]);
  if (remainingSupportCourses[1]) finalCourses.push(remainingSupportCourses[1]);
  if (technicalCourses[3]) finalCourses.push(technicalCourses[3]);
  if (remainingSupportCourses[2]) finalCourses.push(remainingSupportCourses[2]);
  finalCourses.push(...technicalCourses.slice(4));

  return finalCourses.map((course, index) => ({ ...course, order: index + 1 }));
}

function hasInvalidPlanPlaceholders(plan: StudyPlanData): boolean {
  return (
    isPlaceholderValue(plan.professionalGoal) ||
    isPlaceholderValue(plan.currentSituation) ||
    isPlaceholderValue(plan.specificSkills) ||
    isPlaceholderValue(plan.weeklySchedule) ||
    plan.courses.length === 0 ||
    plan.courses.some(
      (course) =>
        isPlaceholderValue(course.title) ||
        isPlaceholderValue(course.duration) ||
        isPlaceholderValue(course.reason)
    )
  );
}

function normalizePlanData(
  parsed: any,
  userName: string | null,
  userEmail: string,
  courses: Course[]
): StudyPlanData {
  const weeklyHours = Number(parsed.weeklyHours || 0);

  const parsedCourses = Array.isArray(parsed.courses) ? parsed.courses : [];
  const normalizedCourses = parsedCourses.flatMap((course: any, index: number) => {
    const rawTitle = String(course.title || '').trim();
    const rawContext = `${rawTitle}\n${course.description || ''}\n${course.level || ''}`;
    const catalogCourse = resolveAiCoursePreference(
      findCourseInCatalog(rawTitle, courses),
      courses,
      JSON.stringify(parsed),
    );
    if (!catalogCourse) return [];

    const title = catalogCourse?.title || rawTitle;
    const duration = course.duration || catalogCourse?.duration || '';
    const level = course.level || extractLevelText(rawContext);

    return [{
      order: Number(course.order || index + 1),
      title,
      description: course.description || '',
      duration,
      thumbnailUrl: course.thumbnailUrl || catalogCourse?.thumbnail_url || '',
      masterName:
        course.masterName ||
        (catalogCourse?.title && /^master\s+/i.test(catalogCourse.title) ? catalogCourse.title : catalogCourse?.master_name || null),
      level: level || null,
      reason: course.reason || '',
      estimatedWeeks:
        Number(course.estimatedWeeks || 0) ||
        estimatedWeeksFromDuration(duration, weeklyHours),
    }];
  });

  const finalCourses = ensureCareerSupportCourse(
    normalizedCourses,
    courses,
    weeklyHours,
    JSON.stringify(parsed),
  );

  const totalEstimatedWeeks =
    finalCourses.reduce((sum: number, course: any) => sum + Number(course.estimatedWeeks || 0), 0) ||
    Number(parsed.totalEstimatedWeeks || 0);

  return {
    studentName: parsed.studentName || userName || 'Aluno',
    email: userEmail,
    professionalGoal: parsed.professionalGoal || '',
    currentSituation: parsed.currentSituation || '',
    specificSkills: parsed.specificSkills || '',
    weeklyHours,
    targetTimeline: parsed.targetTimeline || '',
    courses: finalCourses,
    totalEstimatedWeeks,
    weeklySchedule: parsed.weeklySchedule || '',
    additionalNotes: parsed.additionalNotes || '',
  };
}

function getConversationText(messages: Message[]): string {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => `${message.role === 'user' ? 'Aluno' : 'Dax'}: ${message.content}`)
    .join('\n\n');
}

function findLastRouteMessage(messages: Message[]): string {
  return [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && /trilha de estudos|trilha recomendada|trilha personalizada|plano de estudos|master|duraci[oó]n/i.test(message.content))
    ?.content || '';
}

function parseNumberedRouteItems(routeText: string): Array<{ order: number; title: string; body: string }> {
  const items: Array<{ order: number; title: string; body: string }> = [];
  let current: { order: number; title: string; bodyLines: string[] } | null = null;

  for (const line of routeText.split('\n')) {
    const match = line.match(/^\s*(?:#{1,6}\s*)?(?:[-*]\s*)?(?:\*\*)?(\d+)[\.)]\s+(.*)$/);
    if (match) {
      if (current) {
        items.push({
          order: current.order,
          title: current.title,
          body: current.bodyLines.join('\n'),
        });
      }

      current = {
        order: Number(match[1]),
        title: match[2]
          .replace(/\*\*/g, '')
          .replace(/^["'“”]+|["'“”]+$/g, '')
          .trim(),
        bodyLines: [],
      };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }

  if (current) {
    items.push({
      order: current.order,
      title: current.title,
      body: current.bodyLines.join('\n'),
    });
  }

  return items;
}

function extractWeeklyHoursFromConversation(conversationText: string): number {
  const labeled = Number(
    extractFirstMatch(conversationText, [
      /Horas semanais:\s*(\d+(?:[.,]\d+)?)/i,
      /(\d+(?:[.,]\d+)?)\s*horas?\s*(?:semanais|por semana|por semana)/i,
    ])?.replace(',', '.') || 0,
  );
  if (labeled) return labeled;

  const daily = Number(
    extractFirstMatch(conversationText, [
      /(\d+(?:[.,]\d+)?)\s*horas?\s*(?:diarias|al dia|al día)/i,
    ])?.replace(',', '.') || 0,
  );
  if (daily) return Math.round(daily * 7);

  return Number(
    extractFirstMatch(conversationText, [/(\d+(?:[.,]\d+)?)\s*horas?/i])?.replace(',', '.') || 0,
  );
}

function buildFallbackPlanFromConversation(
  messages: Message[],
  courses: Course[],
  userName: string | null,
  userEmail: string
): StudyPlanData {
  const conversationText = getConversationText(messages);
  const routeText = findLastRouteMessage(messages);
  const weeklyHours = extractWeeklyHoursFromConversation(conversationText);

  const routeItems = parseNumberedRouteItems(routeText);
  const planCourses = routeItems
    .flatMap((item) => {
      const catalogCourse = findCourseInCatalog(item.title, courses);
      if (!catalogCourse) return [];

      const level = extractLevelText(`${item.title}\n${item.body}`);
      const duration =
        extractFirstMatch(item.body, [
          /Duraci[oó]n(?:\s+total|\s+real)?\s*:\s*([^\n\r]+)/i,
          /Duraci[oó]n\s+real\s*:\s*([^\n\r]+)/i,
        ]) || catalogCourse?.duration || '';
      const estimatedWeeks = Number(
        extractFirstMatch(item.body, [
          /(?:Tiempo estimado|Estimaci[oó]n)\s*:\s*(?:Aproximadamente\s*)?(\d+)/i,
          /~\s*(\d+)\s*semanas?/i,
        ]) || 0
      );

      return [{
        order: item.order,
        title: catalogCourse?.title || item.title,
        description: extractFirstMatch(item.body, [/Qu[eé]\s+aprender[aá]s\s*:\s*([^\n\r]+)/i]),
        duration,
        thumbnailUrl: catalogCourse?.thumbnail_url || '',
        masterName:
          catalogCourse?.title && /^master\s+/i.test(catalogCourse.title)
            ? catalogCourse.title
            : catalogCourse?.master_name || null,
        level,
        reason: extractFirstMatch(item.body, [/Por qu[eé]\s*:\s*([^\n\r]+)/i]) || 'Recomendado para esta trilha personalizada.',
        estimatedWeeks: estimatedWeeks || estimatedWeeksFromDuration(duration, weeklyHours),
      }];
    })
    .filter((course) => course.title && !isPlaceholderValue(course.title));

  const finalCourses = ensureCareerSupportCourse(planCourses, courses, weeklyHours, conversationText);

  const totalEstimatedWeeks = finalCourses.reduce(
    (sum, course) => sum + Number(course.estimatedWeeks || 0),
    0
  );

  return {
    studentName:
      extractFirstMatch(conversationText, [/Nome:\s*([^\n\r]+)/i]) ||
      userName ||
      'Aluno',
    email: userEmail,
    professionalGoal: extractFirstMatch(conversationText, [/Objetivo profissional:\s*([^\n\r]+)/i]),
    currentSituation: extractFirstMatch(conversationText, [/Situaci[oó]n actual:\s*([^\n\r]+)/i]),
    specificSkills:
      extractFirstMatch(conversationText, [/Habilidades espec[ií]ficas(?: del objetivo)?:\s*([^\n\r]+)/i]) ||
      extractFirstMatch(conversationText, [/Conhecimento previo:\s*([^\n\r]+)/i]),
    weeklyHours,
    targetTimeline:
      extractFirstMatch(conversationText, [/Timeline:\s*([^\n\r]+)/i]) ||
      extractFirstMatch(conversationText, [/(\d+\s*meses?)/i]),
    courses: finalCourses,
    totalEstimatedWeeks,
    weeklySchedule: weeklyHours
      ? `Dedique ${weeklyHours} horas semanais distribuidas em blocos de estudo, pratica e revisao.`
      : 'Distribua seu estudo semanal entre teoria, pratica e revisao.',
    additionalNotes: 'Trilha gerada a partir da recomendacao personalizada do orientador profissional Daxus.',
  };
}

function courseIdentity(course: StudyPlanData['courses'][number]): string {
  return [
    normalizeForSearch(course.title || '').replace(/[^a-z0-9]+/g, ' ').trim(),
    normalizeForSearch(course.level || '').replace(/[^a-z0-9]+/g, ' ').trim(),
  ].join('|');
}

function routePlanHasMoreCompleteCourses(
  extractedPlan: StudyPlanData,
  routePlan: StudyPlanData
): boolean {
  if (!routePlan.courses.length) return false;
  if (routePlan.courses.length >= 2) return true;
  if (routePlan.courses.length > extractedPlan.courses.length) return true;

  const extractedKeys = new Set(extractedPlan.courses.map(courseIdentity));
  return routePlan.courses.some((course) => !extractedKeys.has(courseIdentity(course)));
}

function fillMissingPlanText(primary: string, fallback: string): string {
  if (primary && !isPlaceholderValue(primary)) return primary;
  return fallback || primary || '';
}

function choosePlanText(primary: string, fallback: string, invalid?: (value: string) => boolean): string {
  const cleanedPrimary = cleanExtractedFact(primary || '');
  if (
    cleanedPrimary &&
    !isPlaceholderValue(cleanedPrimary) &&
    !isAttachmentInstructionFact(cleanedPrimary) &&
    !invalid?.(cleanedPrimary)
  ) {
    return cleanedPrimary;
  }

  const cleanedFallback = cleanExtractedFact(fallback || '');
  if (cleanedFallback && !isAttachmentInstructionFact(cleanedFallback)) return cleanedFallback;
  return cleanedFallback || cleanedPrimary || '';
}

function cleanExtractedFact(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/^\[(?:Archivo|Arquivo|Attached file)[^\]]+\]\s*/i, '')
    .replace(/^[-•*\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAttachmentInstructionFact(value: string): boolean {
  const text = normalizeForSearch(value);
  return [
    'archivo adjunto',
    'arquivo anexado',
    'attached file',
    'he cargado un documento',
    'carreguei um documento',
    'i uploaded a document',
    'analiza la informacion del documento',
    'analise as informacoes do documento',
    'preguntame unicamente lo que falte',
    'pergunte apenas o que faltar',
  ].some((term) => text.includes(normalizeForSearch(term)));
}

function isUsefulExtractedFact(value?: string | null): boolean {
  if (!value) return false;
  const cleaned = cleanExtractedFact(value);
  if (cleaned.length < 3) return false;
  if (isPlaceholderValue(cleaned)) return false;
  if (isAttachmentInstructionFact(cleaned)) return false;
  return !/^(si|sí|ok|okay|correcto|correcta|listo|continua|continúa|confirmo)$/i.test(cleaned);
}

function extractLabeledFact(conversationText: string, labels: string[]): string {
  for (const line of conversationText.split('\n')) {
    const cleanedLine = cleanExtractedFact(line);
    const separatorIndex = cleanedLine.indexOf(':');
    if (separatorIndex < 0) continue;

    const rawLabel = cleanedLine.slice(0, separatorIndex);
    const rawValue = cleanedLine.slice(separatorIndex + 1);
    const normalizedLabel = normalizeForSearch(rawLabel).replace(/[^a-z0-9]+/g, ' ').trim();

    const matches = labels.some((label) => {
      const normalizedTarget = normalizeForSearch(label).replace(/[^a-z0-9]+/g, ' ').trim();
      return normalizedLabel === normalizedTarget || normalizedLabel.endsWith(normalizedTarget);
    });

    const value = cleanExtractedFact(rawValue);
    if (matches && isUsefulExtractedFact(value)) return value;
  }

  return '';
}

function isMostlyTimelineOrAvailability(value: string): boolean {
  const text = normalizeForSearch(value);
  return (
    /^\s*(?:en\s*)?\d+\s*(?:mes|meses|semanas|anos|años)\s*$/i.test(value) ||
    /^\s*\d+\s*horas?(?:\s*(?:semanais|por semana|por semana|diarias|al dia|al día))?\s*$/i.test(value) ||
    (text.includes('horas') && value.length < 45)
  );
}

function userAnswerAfterQuestion(
  messages: Message[],
  questionMatcher: (assistantText: string) => boolean,
): string {
  for (let index = 0; index < messages.length - 1; index += 1) {
    const message = messages[index];
    if (message.role !== 'assistant' || !questionMatcher(message.content)) continue;

    const answer = messages.slice(index + 1).find((candidate) => candidate.role === 'user');
    if (!answer) continue;

    const value = cleanExtractedFact(answer.content.replace(/^\[Arquivo:[^\]]+\]\s*/i, ''));
    if (isUsefulExtractedFact(value) && !isMostlyTimelineOrAvailability(value)) {
      return value.length > 220 ? `${value.slice(0, 217).trim()}...` : value;
    }
  }

  return '';
}

function inferProfessionalGoal(messages: Message[], conversationText: string): string {
  const labeled = extractLabeledFact(conversationText, [
    'Objetivo profissional',
    'Objetivo',
    'Meta profissional',
    'Objetivo de carreira',
    'O que quer alcancar',
  ]);
  if (labeled) return labeled;

  const directAnswer = userAnswerAfterQuestion(messages, (assistantText) => {
    const text = normalizeForSearch(assistantText);
    return (
      text.includes('objetivo profissional') ||
      text.includes('qual objetivo') ||
      text.includes('que objetivo') ||
      text.includes('o que voce quer alcancar') ||
      text.includes('em quanto tempo quer alcancar') ||
      text.includes('prazo')
    );
  });
  if (directAnswer) return directAnswer;

  return messages
    .filter((message) => message.role === 'user')
    .map((message) => cleanExtractedFact(message.content))
    .reverse()
    .find((content) => {
      if (!isUsefulExtractedFact(content) || isMostlyTimelineOrAvailability(content)) return false;
      const text = normalizeForSearch(content);
      return [
        'quero',
        'quiero',
        'objetivo',
        'meta',
        'lider',
        'crescer',
        'promocao',
        'migrar',
        'aprender',
        'trabalhar com',
        'ser ',
        'tornar',
      ].some((term) => text.includes(normalizeForSearch(term)));
    }) || '';
}

function isLikelyCurrentSituation(value: string): boolean {
  const text = normalizeForSearch(value);
  return [
    'estudei',
    'estudie',
    'estudo',
    'estudios',
    'formacao',
    'formacion',
    'graduacao',
    'governo',
    'gobierno',
    'relacoes internacionais',
    'relaciones internacionales',
    'coordenador',
    'coordinadora',
    'coordenadora',
    'trabalho',
    'trabajo',
    'empresa',
    'teatro',
    'projetos',
    'alianzas',
    'aliancas',
    'experiencia',
    'profissional',
    'profesional',
  ].some((term) => text.includes(normalizeForSearch(term)));
}

function isLikelySpecificSkills(value: string): boolean {
  const text = normalizeForSearch(value);
  return [
    'excel',
    'power bi',
    'sql',
    'python',
    'dax',
    'power query',
    'programacao',
    'programacion',
    'inteligencia artificial',
    'ia',
    'n8n',
    'automacao',
    'automatizacion',
    'dashboard',
    'dados',
    'datos',
    'analise',
    'analisis',
    'comunicacao',
    'comunicacion',
    'lideranca',
    'liderazgo',
    'negociacao',
    'negociacion',
  ].some((term) => text.includes(normalizeForSearch(term)));
}

function inferCurrentSituation(messages: Message[], conversationText: string): string {
  const labeled = extractLabeledFact(conversationText, [
    'Situacao atual',
    'Situacao atual',
    'Contexto profissional',
    'Experiencia profissional',
    'Estudos e experiencia profissional',
    'Estudos e experiencia',
    'Formacao e experiencia',
    'Formacao e experiencia',
  ]);
  if (labeled) return labeled;

  const directAnswer = userAnswerAfterQuestion(messages, (assistantText) => {
    const text = normalizeForSearch(assistantText);
    return text.includes('experiencia profissional') && text.includes('estudos');
  });
  if (directAnswer) return directAnswer;

  return messages
    .filter((message) => message.role === 'user')
    .map((message) => cleanExtractedFact(message.content.replace(/^\[Arquivo:[^\]]+\]\s*/i, '')))
    .find((content) => {
      if (!isUsefulExtractedFact(content) || isMostlyTimelineOrAvailability(content)) return false;
      const text = normalizeForSearch(content);
      return [
        'profissional',
        'experiencia',
        'estudo',
        'estudos',
        'trabalho',
        'trabalho em',
        'atualmente',
        'coordin',
        'analista',
        'gerente',
        'governo',
        'relacoes internacionais',
        'parcerias',
        'projetos',
      ].some((term) => text.includes(term));
    }) || '';
}

function inferSpecificSkills(messages: Message[], conversationText: string): string {
  const labeled = extractLabeledFact(conversationText, [
    'Habilidades especificas',
    'Habilidades específicas',
    'Habilidades especificas do objetivo',
    'Habilidades especificas do objetivo',
    'Conhecimento previo',
    'Conhecimentos previos',
    'Habilidades',
    'Ferramentas',
  ]);
  if (labeled) return labeled;

  const directAnswer = userAnswerAfterQuestion(messages, (assistantText) => {
    const text = normalizeForSearch(assistantText);
    return (
      text.includes('habilidades especificas') ||
      text.includes('conhecimentos previos') ||
      (text.includes('excel') && (text.includes('sql') || text.includes('power bi') || text.includes('programacao')))
    );
  });
  if (directAnswer) return directAnswer;

  return messages
    .filter((message) => message.role === 'user')
    .map((message) => cleanExtractedFact(message.content))
    .find((content) => {
      if (!isUsefulExtractedFact(content) || isMostlyTimelineOrAvailability(content)) return false;
      const text = normalizeForSearch(content);
      return [
        'power bi',
        'excel',
        'sql',
        'python',
        'programacao',
        'programacao',
        'estatistica',
        'estatistica',
        'comunicacao',
        'comunicacao',
        'lideranca',
        'negociacao',
        'negociacao',
      ].some((term) => text.includes(normalizeForSearch(term)));
    }) || '';
}

function enrichPlanProfileFromConversation(
  plan: StudyPlanData,
  messages: Message[],
  userName: string | null,
): StudyPlanData {
  const conversationText = getConversationText(messages);
  const inferredGoal = inferProfessionalGoal(messages, conversationText);
  const inferredCurrentSituation = inferCurrentSituation(messages, conversationText);
  const inferredSpecificSkills = inferSpecificSkills(messages, conversationText);

  const currentSituation = choosePlanText(
    plan.currentSituation,
    inferredCurrentSituation,
    (value) => normalizeForSearch(value) === normalizeForSearch(plan.specificSkills || '') && isLikelySpecificSkills(value),
  );
  const specificSkills = choosePlanText(
    plan.specificSkills,
    inferredSpecificSkills,
    (value) =>
      normalizeForSearch(value) === normalizeForSearch(currentSituation || '') ||
      (isLikelyCurrentSituation(value) && !isLikelySpecificSkills(value)),
  );

  return {
    ...plan,
    studentName: fillMissingPlanText(plan.studentName, userName || ''),
    professionalGoal: choosePlanText(plan.professionalGoal, inferredGoal),
    currentSituation,
    specificSkills: specificSkills || 'Nao identificadas',
  };
}

function reconcilePlanWithVisibleRoute(
  extractedPlan: StudyPlanData,
  routePlan: StudyPlanData,
  catalogCourses: Course[]
): StudyPlanData {
  if (!routePlanHasMoreCompleteCourses(extractedPlan, routePlan)) {
    return extractedPlan;
  }

  const weeklyHours = extractedPlan.weeklyHours || routePlan.weeklyHours;
  const courses = ensureCareerSupportCourse(
    routePlan.courses,
    catalogCourses,
    weeklyHours,
    `${extractedPlan.professionalGoal}\n${extractedPlan.specificSkills}\n${routePlan.professionalGoal}\n${routePlan.specificSkills}`,
  );
  const totalEstimatedWeeks =
    courses.reduce((sum, course) => sum + Number(course.estimatedWeeks || 0), 0) ||
    routePlan.totalEstimatedWeeks ||
    extractedPlan.totalEstimatedWeeks;

  return {
    ...extractedPlan,
    studentName: fillMissingPlanText(extractedPlan.studentName, routePlan.studentName) || routePlan.studentName,
    professionalGoal: fillMissingPlanText(extractedPlan.professionalGoal, routePlan.professionalGoal),
    currentSituation: fillMissingPlanText(extractedPlan.currentSituation, routePlan.currentSituation),
    specificSkills: fillMissingPlanText(extractedPlan.specificSkills, routePlan.specificSkills),
    weeklyHours,
    targetTimeline: fillMissingPlanText(extractedPlan.targetTimeline, routePlan.targetTimeline),
    courses,
    totalEstimatedWeeks,
    weeklySchedule: fillMissingPlanText(extractedPlan.weeklySchedule, routePlan.weeklySchedule),
    additionalNotes: fillMissingPlanText(extractedPlan.additionalNotes, routePlan.additionalNotes),
  };
}

/**
 * Extracts a structured study plan from the conversation history using GPT-4o.
 * Called when the user clicks "Download PDF".
 */
export async function generateStudyPlan(
  conversationId: string,
  userId: string,
  userName: string | null,
  userEmail: string,
  clientMessages?: ClientChatMessage[]
): Promise<StudyPlanData> {
  // 1. Load conversation history
  const savedMessages = await getConversationMessages(conversationId);
  const messages = selectBestConversationMessages(
    conversationId,
    savedMessages,
    clientMessages
  );

  // 2. Load courses for reference
  const courses = await getAllCourses();

  // 3. Build conversation context for extraction
  const conversationText = getConversationText(messages);

  const coursesReference = courses
    .filter((c) => isRecordedStudyContent(c))
    .map((c) => {
      const levelInfo = c.master_name
        ? ` | Master: ${c.master_name}${c.master_level ? ` nivel ${c.master_level}` : ''}`
        : '';
      return `- "${c.title}" (${c.duration || 'sem duracao'})${levelInfo}${c.thumbnail_url ? ` [IMG: ${c.thumbnail_url}]` : ''}`;
    })
    .join('\n');

  // 4. Call GPT-4o to extract structured plan
  const response = await openai.chat.completions.create({
    model: PLAN_MODEL,
    messages: [
      {
        role: 'system',
        content: PLAN_EXTRACTION_PROMPT + `\n\nCATALOGO DE CURSOS (use estes dados para duracoes, niveis, masters e thumbnails):\n${coursesReference}`,
      },
      {
        role: 'user',
        content: `Conversa completa:\n\n${conversationText}\n\nNome do aluno: ${userName || 'Aluno'}\nEmail: ${userEmail}`,
      },
    ],
    temperature: 0.3,
    max_tokens: 3000,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content || '';

  // 5. Parse JSON response
  let planData: StudyPlanData;
  try {
    const parsed = parseJsonObject(content);
    planData = normalizePlanData(parsed, userName, userEmail, courses);
    if (hasInvalidPlanPlaceholders(planData)) {
      planData = buildFallbackPlanFromConversation(messages, courses, userName, userEmail);
    }
  } catch (e) {
    planData = buildFallbackPlanFromConversation(messages, courses, userName, userEmail);
  }

  const visibleRoutePlan = buildFallbackPlanFromConversation(messages, courses, userName, userEmail);
  planData = reconcilePlanWithVisibleRoute(planData, visibleRoutePlan, courses);
  planData = enrichPlanProfileFromConversation(planData, messages, userName);

  if (hasInvalidPlanPlaceholders(planData) || planData.courses.length === 0) {
    throw new Error('Erro ao gerar o plano de estudos. Por favor, tente novamente.');
  }

  // 6. Save to the Supabase output table used by Daxus Brasil.
  const pdiSupabaseId = await saveStudyPlan(conversationId, userEmail || userId, planData);
  if (!pdiSupabaseId) {
    throw new Error('Nao foi possivel salvar o PDI personalizado no Supabase.');
  }
  planData.pdiSupabaseId = pdiSupabaseId;

  return planData;
}
