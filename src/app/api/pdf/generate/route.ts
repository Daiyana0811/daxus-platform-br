import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  getAllCourses,
  isExcludedRecommendationCourse,
  markStudyPlanPdfGeneratedInSupabase,
  type Course,
  type StudyPlanData,
} from '@/lib/supabase';

export const runtime = 'nodejs';

const PDFKitModule = require('pdfkit');
const PDFDocument = PDFKitModule.default || PDFKitModule;

const COLORS = {
  blue: '#0c1e3b',
  navy: '#07061f',
  green: '#6de2c3',
  purple: '#521fff',
  violet: '#8b6dff',
  lavender: '#a890ff',
  white: '#ffffff',
  soft: '#ddeff2',
  ink: '#17233f',
  muted: '#667895',
  border: '#dce7ef',
  wash: '#f4fbfb',
};

const BRAND_LOGOS = {
  whiteHorizontal: path.join(
    process.cwd(),
    'public',
    'brand',
    'br',
    'Daxus-logo-br.png',
  ),
  blueHorizontal: path.join(
    process.cwd(),
    'public',
    'brand',
    'Logotipos e Logomarcas',
    'Logotipo Daxus Latam Horizontal Azul Dark.png',
  ),
  whiteMark: path.join(
    process.cwd(),
    'public',
    'brand',
    'Logotipos e Logomarcas',
    'Logomarca Blanca.png',
  ),
};

const PDI_TEMPLATES = {
  cover: path.join(process.cwd(), 'public', 'pdi-br', 'Portada.png'),
  page2: path.join(process.cwd(), 'public', 'pdi-br', 'Pagina-2.png'),
  page3: path.join(process.cwd(), 'public', 'pdi-br', 'Pagina-3.png'),
  letterhead: path.join(process.cwd(), 'public', 'pdi-br', 'Membrete.png'),
  final: path.join(process.cwd(), 'public', 'pdi-br', 'Final.png'),
  pyramid: path.join(process.cwd(), 'public', 'pdi-br', 'Piramide-pilares.png'),
};

const PDF_FONT_FILES = {
  regular: path.join(process.cwd(), 'public', 'fonts', 'Inter-Regular.ttf'),
  bold: path.join(process.cwd(), 'public', 'fonts', 'Inter-Bold.ttf'),
};

let PDF_FONT_REGULAR = 'Helvetica';
let PDF_FONT_BOLD = 'Helvetica-Bold';

type PdfDoc = any;

const localImageCache = new Map<string, Buffer | null>();

export async function POST(request: NextRequest) {
  try {
    const { studyPlanId, planData: directPlanData } = await request.json();

    let planData: StudyPlanData;

    if (studyPlanId) {
      const plansPath = path.join(process.cwd(), 'data', 'study_plans.json');
      if (!fs.existsSync(plansPath)) {
        return jsonError('Nao ha planos de estudos guardados.', 404);
      }

      const plans: Array<{ id: string; plan_data: StudyPlanData }> = JSON.parse(
        fs.readFileSync(plansPath, 'utf-8'),
      );
      const found = plans.find((p) => p.id === studyPlanId);
      if (!found) return jsonError('Plano de estudos nao encontrado.', 404);
      planData = found.plan_data;
    } else if (directPlanData) {
      planData = directPlanData;
    } else {
      return jsonError('studyPlanId ou planData e obrigatorio.', 400);
    }

    const catalogCourses = await getAllCourses();
    planData = expandMasterLevelsForPdf(planData, catalogCourses);
    planData.pdfGeneratedAt = new Date().toISOString();

    const filename = buildPdfFilename(planData);
    const pdfBuffer = await generatePdfBuffer(planData, catalogCourses);

    const savedPdiId = await markStudyPlanPdfGeneratedInSupabase(planData, {
      filename,
      contentType: 'application/pdf',
      buffer: pdfBuffer,
    });
    if (savedPdiId) planData.pdiSupabaseId = savedPdiId;

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('PDF generation error:', error);
    return jsonError('Erro ao gerar o PDF.', 500);
  }
}

function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeTitleForMatch(value: string): string {
  return normalizeText(value)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokens(value: string): string[] {
  const stopWords = new Set(['con', 'de', 'del', 'la', 'el', 'los', 'las', 'en', 'y', 'o', 'un', 'una']);
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

function cleanText(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shorten(value: string, maxLength: number): string {
  const text = cleanText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function firstSentence(value: string | null | undefined, maxLength = 130): string {
  const text = cleanText(value);
  if (!text) return '';
  const sentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return shorten(sentence.replace(/[.!?]+$/, ''), maxLength);
}

function findCatalogCourse(title: string, courses: Course[]): Course | undefined {
  return courses
    .map((course) => ({ course, score: scoreCourseTitleMatch(title, course.title) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.course;
}

function isArtificialIntelligencePlan(plan: StudyPlanData): boolean {
  const context = normalizeText(
    `${plan.professionalGoal} ${plan.specificSkills} ${plan.currentSituation} ${plan.weeklySchedule} ${plan.additionalNotes}`,
  );
  return (
    context.includes('inteligencia artificial') ||
    /\bia\b/.test(context) ||
    context.includes('chatgpt') ||
    context.includes('agentes')
  );
}

function resolveAiCoursePreferenceForPdf(
  course: Course | undefined,
  catalogCourses: Course[],
  plan: StudyPlanData,
): Course | undefined {
  if (!course) return undefined;
  if (!isArtificialIntelligencePlan(plan)) return course;
  if (normalizeText(course.title) !== 'inteligencia artificial') return course;

  return (
    catalogCourses.find(
      (candidate) =>
        normalizeText(candidate.title) === 'primeros pasos en inteligencia artificial' &&
        !isExcludedRecommendationCourse(candidate.title),
    ) || course
  );
}

function findMasterCourse(
  course: StudyPlanData['courses'][number],
  courses: Course[],
): Course | undefined {
  const text = normalizeText(`${course.title} ${course.masterName || ''}`);
  return courses
    .filter((catalogCourse) => /^master\s+/i.test(catalogCourse.title))
    .find((master) => text.includes(normalizeText(master.title)));
}

function durationToHours(duration: string): number {
  const hoursMatch = duration.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hora)/i);
  const minutesMatch = duration.match(/(\d+)\s*(?:m|minuto)/i);
  const hours = hoursMatch ? Number(hoursMatch[1].replace(',', '.')) : 0;
  const minutes = minutesMatch ? Number(minutesMatch[1]) / 60 : 0;
  return hours + minutes;
}

function estimateWeeks(duration: string, weeklyHours: number): number {
  const hours = durationToHours(duration);
  if (!hours || !weeklyHours) return 0;
  return Math.max(1, Math.ceil((hours * 2) / weeklyHours));
}

function selectedMasterLevels(levelText: string | null | undefined, allLevels: Course[]): Course[] {
  if (!levelText) return [];
  const normalized = normalizeText(levelText);

  if (normalized.includes('completo')) return allLevels;

  const range = normalized.match(/niveles?\s*(\d+)\s*[-–—]\s*(\d+)/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    return allLevels.filter((course) => {
      const level = course.master_level || 0;
      return level >= start && level <= end;
    });
  }

  const single = normalized.match(/nivel(?:es)?\s*(\d+)/);
  if (single) {
    const level = Number(single[1]);
    return allLevels.filter((course) => course.master_level === level);
  }

  return [];
}

function completeThumbnailUrl(url: string): string {
  if (!url) return '';
  return url.replace(/([?&])fit=crop/i, '$1fit=contain');
}

function isStableCatalogThumb(url: string | null | undefined): boolean {
  return Boolean(url && /cdn\.memberkit\.com\.br/i.test(url));
}

function isTemporaryNotionThumb(url: string | null | undefined): boolean {
  return Boolean(url && /prod-files-secure\.s3|X-Amz-Expires|X-Amz-Signature/i.test(url));
}

function resolveThumbnailUrl(
  planUrl: string | null | undefined,
  catalogUrl: string | null | undefined,
): string {
  if (isStableCatalogThumb(catalogUrl)) return completeThumbnailUrl(catalogUrl || '');
  if (!planUrl) return completeThumbnailUrl(catalogUrl || '');
  if (isTemporaryNotionThumb(planUrl) && catalogUrl) return completeThumbnailUrl(catalogUrl);
  return completeThumbnailUrl(planUrl);
}

type SupportCategory = 'linkedin' | 'career' | 'soft' | 'leadership';

function supportCategoryForTitle(title: string): SupportCategory | null {
  const text = normalizeText(title);
  if (text.includes('linkedin')) return 'linkedin';
  if (text.includes('lideranca') || text.includes('lideranca') || text.includes('formacao de lideres')) {
    return 'leadership';
  }
  if (
    text.includes('comunicacao') ||
    text.includes('comunicacao') ||
    text.includes('inteligencia emocional') ||
    text.includes('habilidades comportamentais')
  ) {
    return 'soft';
  }
  return [
    'networking',
    'produtividade',
    'gestao do tempo',
    'processos seletivos',
    'preparacao',
    'empregabilidade',
    'posicionamento',
    'carreira',
    'carreira',
  ].some((term) => text.includes(term))
    ? 'career'
    : null;
}

function isCareerSupportTitle(title: string): boolean {
  return Boolean(supportCategoryForTitle(title));
}

function buildRecommendationReason(
  course: Pick<Course, 'title' | 'description' | 'master_name' | 'master_level'>,
  plan: StudyPlanData,
  fallback?: string | null,
): string {
  const goal = shorten(plan.professionalGoal || 'seu objetivo profissional', 110);
  const description = firstSentence(course.description, 115);
  const title = cleanText(course.title);

  if (isCareerSupportTitle(title)) {
    if (normalizeText(title).includes('linkedin')) {
      return `Recomendado porque fortalece seu posicionamento profissional e aumenta sua visibilidade diante de recrutadores relacionados a ${goal}.`;
    }
    return `Recomendado porque complementa a parte tecnica com habilidades profissionais necessarias para aplicar melhor o aprendizado em ${goal}.`;
  }

  if (description) {
    return `Recomendado porque ${title} trabalha ${description.toLowerCase()} e contribui com uma habilidade concreta para avancar rumo a ${goal}.`;
  }

  const fallbackText = firstSentence(fallback, 120);
  if (fallbackText && !/recomendado para la trilha personalizada/i.test(fallbackText)) {
    return `Recomendado aqui porque ${fallbackText.toLowerCase()} e se conecta diretamente com ${goal}.`;
  }

  return `Recomendado porque desenvolve uma habilidade-chave de ${title} que voce precisa para se aproximar de ${goal}.`;
}

function buildCareerSupportCourse(
  course: Course,
  order: number,
  weeklyHours: number,
  plan: StudyPlanData,
): StudyPlanData['courses'][number] {
  const duration = course.duration || '';
  return {
    order,
    title: course.title,
    description: course.description || 'Formacao de carreira para fortalecer seu perfil profissional.',
    duration,
    thumbnailUrl: resolveThumbnailUrl(null, course.thumbnail_url),
    masterName: null,
    level: null,
    reason: buildRecommendationReason(course, plan),
    estimatedWeeks: estimateWeeks(duration, weeklyHours) || 1,
  };
}

function findPreferredSupportCourse(
  catalogCourses: Course[],
  category: SupportCategory,
  usedTitles: Set<string>,
): Course | undefined {
  const preferred: Record<SupportCategory, string[]> = {
    linkedin: ['linkedin magnetico'],
    career: [
      'gestao do tempo e produtividade',
      'estrategias de carreira',
      'preparacao para processos seletivos',
    ],
    soft: ['comunicacao de um profissional diferenciado', 'inteligencia emocional'],
    leadership: ['gestao e lideranca', 'formacao de lideres', 'comunicacao assertiva no trabalho'],
  };

  const candidates = catalogCourses.filter((course) =>
    supportCategoryForTitle(course.title) === category &&
    !isExcludedRecommendationCourse(course.title) &&
    !usedTitles.has(normalizeText(course.title))
  );

  for (const title of preferred[category]) {
    const found = candidates.find((course) => normalizeText(course.title) === title);
    if (found) return found;
  }

  return candidates[0];
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

function findExactCatalogCourse(title: string, courses: Course[]): Course | undefined {
  const normalizedTitle = normalizeText(title);
  return courses.find((course) => normalizeText(course.title) === normalizedTitle);
}

function buildTechnicalFallbackCourses(
  plan: StudyPlanData,
  catalogCourses: Course[],
  usedTitles: Set<string>,
): StudyPlanData['courses'] {
  const context = normalizeText(
    `${plan.professionalGoal} ${plan.specificSkills} ${plan.currentSituation} ${plan.weeklySchedule} ${plan.additionalNotes}`,
  );
  const selectedTitles: string[] = [];

  for (const rule of TECHNICAL_FALLBACK_RULES) {
    const matchesContext = rule.triggers.some((trigger) => context.includes(normalizeText(trigger)));
    if (!matchesContext) continue;

    for (const title of rule.titles) {
      if (!selectedTitles.some((selected) => normalizeText(selected) === normalizeText(title))) {
        selectedTitles.push(title);
      }
    }
  }

  return selectedTitles
    .map((title) => resolveAiCoursePreferenceForPdf(
      findExactCatalogCourse(title, catalogCourses),
      catalogCourses,
      plan,
    ))
    .filter((course): course is Course =>
      Boolean(course && !usedTitles.has(normalizeText(course.title)) && !isCareerSupportTitle(course.title))
    )
    .filter((course) => !isExcludedRecommendationCourse(course.title))
    .slice(0, 6)
    .map((course, index) => {
      const duration = course.duration || '';
      return {
        order: index + 1,
        title: course.title,
        description: course.description || '',
        duration,
        thumbnailUrl: resolveThumbnailUrl(null, course.thumbnail_url),
        masterName: course.master_name || null,
        level: course.level || (course.master_level ? `Nivel ${course.master_level}` : null),
        reason: buildRecommendationReason(course, plan),
        estimatedWeeks: estimateWeeks(duration, plan.weeklyHours) || 1,
      };
    });
}

type NextRouteSuggestion = {
  title: string;
  duration: string;
  reason: string;
  thumbnailUrl: string;
};

const NEXT_ROUTE_RULES = [
  {
    triggers: [
      'analitica',
      'analise de dados',
      'dados',
      'power bi',
      'dashboard',
      'indicadores',
      'relatorios',
    ],
    titles: [
      'Analise de Dados com Python',
      'Dominando a linguagem Python',
      'Business Cases Excel',
      'Figma para Dashboards',
      'Power Point na Pratica',
      'Automacao de Tarefas com Python',
    ],
  },
  {
    triggers: ['automacao', 'automatizar', 'otimizar processos', 'ia', 'inteligencia artificial', 'agentes'],
    titles: [
      'Automacoes e Agentes de IA',
      'Automacao de Tarefas com Python',
      'Agentes de IA - Nivel Avancado',
      'Prompts na Pratica',
      'Dominando Power Apps',
      'Sharepoint na Pratica',
    ],
  },
  {
    triggers: ['excel', 'planilhas'],
    titles: [
      'Dashboards profissionais com Excel',
      'Analise de Dados com Excel',
      'Business Cases Excel',
      'Dominando Macros e VBA',
    ],
  },
  {
    triggers: ['sql', 'bancos de dados', 'base de dados', 'consultas'],
    titles: ['SQL Avancado', 'Administracao de Bancos de Dados'],
  },
  {
    triggers: ['python', 'programacao', 'programar', 'codigo', 'desenvolvimento'],
    titles: [
      'Dominando a linguagem Python',
      'Desenvolvimento Web com Python & Flask',
      'Recursos avancados da Linguagem Python',
      'Analise de Dados com Python',
    ],
  },
  {
    triggers: ['liderar', 'lideranca', 'equipe', 'equipes', 'gestao', 'direcao'],
    titles: ['Gestao e Lideranca', 'Comunicacao Assertiva no Trabalho', 'Formacao de Lideres'],
  },
];

function hasCourseInPlan(plan: StudyPlanData, course: Course): boolean {
  const candidate = normalizeText(course.title);
  return plan.courses.some((plannedCourse) => {
    const plannedTitle = normalizeText(plannedCourse.title);
    return (
      plannedTitle === candidate ||
      normalizeText(plannedCourse.masterName || '') === candidate ||
      candidate.includes(plannedTitle) ||
      plannedTitle.includes(candidate)
    );
  });
}

function nextRouteContext(plan: StudyPlanData): string {
  return normalizeText(
    `${plan.professionalGoal} ${plan.specificSkills} ${plan.currentSituation} ${plan.additionalNotes} ${plan.courses
      .map((course) => `${course.title} ${course.masterName || ''}`)
      .join(' ')}`,
  );
}

function buildNextRouteReason(course: Course, plan: StudyPlanData): string {
  const goal = shorten(plan.professionalGoal || 'seu objetivo profissional', 84);
  const title = cleanText(course.title);
  const context = nextRouteContext(plan);

  if (context.includes('analitica') || context.includes('dados') || context.includes('power bi')) {
    return `Para aprofundar sua trilha de dados e transformar o aprendizado em projetos aplicaveis a ${goal}.`;
  }

  if (context.includes('automacao') || context.includes('ia') || context.includes('inteligencia artificial')) {
    return `Para avancar depois para solucoes praticas de automacao e produtividade com mais autonomia.`;
  }

  if (context.includes('lider') || context.includes('equipe')) {
    return `Para fortalecer o proximo nivel de influencia, comunicacao e aplicacao estrategica do seu aprendizado.`;
  }

  return `Para iniciar uma nova etapa depois desta trilha e continuar ampliando seu perfil com ${title}.`;
}

function buildNextRouteSuggestions(
  plan: StudyPlanData,
  catalogCourses: Course[],
): NextRouteSuggestion[] {
  const context = nextRouteContext(plan);
  const selected = new Map<string, Course>();

  const addCourse = (course: Course | undefined) => {
    if (!course) return;
    const key = normalizeText(course.title);
    if (selected.has(key)) return;
    if (/^master\s+/i.test(course.title)) return;
    if (isExcludedRecommendationCourse(course.title)) return;
    if (hasCourseInPlan(plan, course)) return;
    selected.set(key, course);
  };

  for (const rule of NEXT_ROUTE_RULES) {
    const matchesContext = rule.triggers.some((trigger) => context.includes(normalizeText(trigger)));
    if (!matchesContext) continue;

    for (const title of rule.titles) {
      addCourse(findExactCatalogCourse(title, catalogCourses));
      if (selected.size >= 3) break;
    }
    if (selected.size >= 3) break;
  }

  if (selected.size < 3) {
    const relevantTerms = [
      'dados',
      'analitica',
      'power bi',
      'excel',
      'sql',
      'python',
      'ia',
      'inteligencia artificial',
      'automacao',
      'dashboard',
      'lideranca',
      'comunicacao',
      'produtividade',
      'projetos',
    ].filter((term) => context.includes(normalizeText(term)));

    catalogCourses
      .filter((course) => !isExcludedRecommendationCourse(course.title) && !/^master\s+/i.test(course.title))
      .map((course) => {
        const searchable = normalizeText(
          `${course.title} ${course.description || ''} ${course.category || ''} ${(course.tags || []).join(' ')}`,
        );
        const score = relevantTerms.reduce(
          (sum, term) => sum + (searchable.includes(normalizeText(term)) ? 1 : 0),
          0,
        );
        return { course, score };
      })
      .filter(({ course, score }) => score > 0 && !hasCourseInPlan(plan, course))
      .sort((a, b) => b.score - a.score || normalizeText(a.course.title).localeCompare(normalizeText(b.course.title)))
      .forEach(({ course }) => addCourse(course));
  }

  if (selected.size < 3) {
    [
      'Gestao do tempo e Produtividade',
      'Comunicacao Assertiva no Trabalho',
      'Comunicacao de um Profissional Diferenciado',
      'Dominando a linguagem Python',
      'Aplicacoes com Inteligencia Artificial',
    ].forEach((title) => addCourse(findExactCatalogCourse(title, catalogCourses)));
  }

  return Array.from(selected.values())
    .slice(0, 3)
    .map((course) => ({
      title: course.title,
      duration: course.duration || 'Duracao por confirmar',
      reason: buildNextRouteReason(course, plan),
      thumbnailUrl: resolveThumbnailUrl(null, course.thumbnail_url),
    }));
}

function placeCareerSupportAfterFirstTechnical(
  courses: StudyPlanData['courses'],
  catalogCourses: Course[],
  weeklyHours: number,
  plan: StudyPlanData,
): StudyPlanData['courses'] {
  const usedTitles = new Set(courses.map((course) => normalizeText(course.title)));
  let technicalCourses = courses.filter((course) => !isCareerSupportTitle(course.title));
  if (!technicalCourses.length) {
    technicalCourses = buildTechnicalFallbackCourses(plan, catalogCourses, usedTitles);
    technicalCourses.forEach((course) => usedTitles.add(normalizeText(course.title)));
  }

  const supportCategories: SupportCategory[] = ['linkedin', 'career', 'soft', 'leadership'];
  const supportCourses = supportCategories.flatMap((category) => {
    const existing = courses.find((course) => supportCategoryForTitle(course.title) === category);
    if (existing) return [existing];

    const catalogCourse = findPreferredSupportCourse(catalogCourses, category, usedTitles);
    if (!catalogCourse) return [];

    usedTitles.add(normalizeText(catalogCourse.title));
    return [buildCareerSupportCourse(catalogCourse, 1, weeklyHours, plan)];
  });

  if (!technicalCourses.length) {
    return (supportCourses.length ? supportCourses : courses).map((course, index) => ({
      ...course,
      order: index + 1,
    }));
  }

  return [
    technicalCourses[0],
    ...(supportCourses[0] ? [supportCourses[0]] : []),
    ...(supportCourses[1] ? [supportCourses[1]] : []),
    ...(technicalCourses[1] ? [technicalCourses[1]] : []),
    ...(supportCourses[2] ? [supportCourses[2]] : []),
    ...(technicalCourses[2] ? [technicalCourses[2]] : []),
    ...(supportCourses[3] ? [supportCourses[3]] : []),
    ...technicalCourses.slice(3),
  ].map((course, index) => ({ ...course, order: index + 1 }));
}

function makeCourseReasonsUnique(
  courses: StudyPlanData['courses'],
  plan: StudyPlanData,
): StudyPlanData['courses'] {
  const seen = new Set<string>();

  return courses.map((course) => {
    const normalizedReason = normalizeText(course.reason || '');
    if (normalizedReason && !seen.has(normalizedReason)) {
      seen.add(normalizedReason);
      return course;
    }

    const replacement = buildRecommendationReason(
      {
        title: course.title,
        description: course.description,
        master_name: course.masterName,
        master_level: Number((course.level || '').match(/\d+/)?.[0] || 0) || null,
      } as Course,
      plan,
      course.reason,
    );
    seen.add(normalizeText(replacement));
    return { ...course, reason: replacement };
  });
}

function expandMasterLevelsForPdf(plan: StudyPlanData, catalogCourses: Course[]): StudyPlanData {
  const expandedCourses: StudyPlanData['courses'] = [];

  for (const course of plan.courses || []) {
    if (isExcludedRecommendationCourse(course.title)) continue;

    const master = findMasterCourse(course, catalogCourses);
    const levelScope = course.level || course.title;
    const allLevels = master
      ? catalogCourses
          .filter((catalogCourse) => catalogCourse.master_name === master.title)
          .sort((a, b) => (a.master_level || 999) - (b.master_level || 999))
      : [];
    const levelsToRender = selectedMasterLevels(levelScope, allLevels);

    if (master && levelsToRender.length > 0) {
      for (const levelCourse of levelsToRender) {
        const duration = levelCourse.duration || course.duration || '';
        expandedCourses.push({
          order: expandedCourses.length + 1,
          title: levelCourse.title,
          description: levelCourse.description || course.description || '',
          duration,
          thumbnailUrl: resolveThumbnailUrl(course.thumbnailUrl, levelCourse.thumbnail_url),
          masterName: master.title,
          level: levelCourse.master_level ? `Nivel ${levelCourse.master_level}` : course.level,
          reason: buildRecommendationReason(levelCourse, plan, course.reason),
          estimatedWeeks: estimateWeeks(duration, plan.weeklyHours) || course.estimatedWeeks,
        });
      }
      continue;
    }

    const catalogCourse = resolveAiCoursePreferenceForPdf(
      findCatalogCourse(course.title, catalogCourses),
      catalogCourses,
      plan,
    );
    if (!catalogCourse) continue;

    const duration = course.duration || catalogCourse?.duration || '';
    const mergedDescription = course.description || catalogCourse?.description || '';
    expandedCourses.push({
      ...course,
      order: expandedCourses.length + 1,
      title: catalogCourse?.title || course.title,
      description: mergedDescription,
      duration,
      thumbnailUrl: resolveThumbnailUrl(course.thumbnailUrl, catalogCourse?.thumbnail_url),
      reason:
        course.reason && normalizeText(course.reason) !== 'recomendado para la trilha personalizada'
          ? course.reason
          : buildRecommendationReason(
              {
                title: catalogCourse?.title || course.title,
                description: mergedDescription,
                master_name: catalogCourse?.master_name || course.masterName,
                master_level: catalogCourse?.master_level || null,
              } as Course,
              plan,
              course.reason,
            ),
      estimatedWeeks: course.estimatedWeeks || estimateWeeks(duration, plan.weeklyHours),
    });
  }

  const orderedCourses = placeCareerSupportAfterFirstTechnical(
    expandedCourses,
    catalogCourses,
    plan.weeklyHours,
    plan,
  );

  const coursesWithUniqueReasons = makeCourseReasonsUnique(
    orderedCourses.map((course, index) => ({ ...course, order: index + 1 })),
    plan,
  );

  const totalEstimatedWeeks = coursesWithUniqueReasons.reduce(
    (sum, course) => sum + Number(course.estimatedWeeks || 0),
    0,
  );

  return {
    ...plan,
    courses: coursesWithUniqueReasons,
    totalEstimatedWeeks: totalEstimatedWeeks || plan.totalEstimatedWeeks,
  };
}

function buildPdfFilename(plan: StudyPlanData): string {
  const name = (plan.studentName || 'aluno')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return `pdi-daxus-${name || 'aluno'}.pdf`;
}

function loadLocalImage(filePath: string): Buffer | null {
  if (localImageCache.has(filePath)) return localImageCache.get(filePath) || null;

  try {
    const image = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    localImageCache.set(filePath, image);
    return image;
  } catch {
    localImageCache.set(filePath, null);
    return null;
  }
}

function isSupportedPdfImage(buffer: Buffer): boolean {
  const png = buffer.length > 8 && buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
  const jpg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return png || jpg;
}

function drawDaxusLogo(
  doc: PdfDoc,
  variant: 'whiteHorizontal' | 'blueHorizontal' | 'whiteMark',
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const logo = loadLocalImage(BRAND_LOGOS[variant]);

  if (logo) {
    try {
      doc.image(logo, x, y, {
        fit: [width, height],
        align: 'left',
        valign: 'center',
      });
      return;
    } catch {
      // Fallback below keeps the PDF usable if the image decoder rejects an asset.
    }
  }

  doc
    .fillColor(variant === 'blueHorizontal' ? COLORS.blue : COLORS.soft)
    .font('Helvetica-Bold')
    .fontSize(Math.min(22, height))
    .text('DAXUS', x, y + Math.max(0, (height - 22) / 2), { width });
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  if (!/^https?:\/\//i.test(url)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Daxus-PDF/1.0',
        Accept: 'image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
      },
    });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return isSupportedPdfImage(buffer) ? buffer : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadCourseImages(courses: StudyPlanData['courses']): Promise<Map<number, Buffer>> {
  const entries = await Promise.all(
    courses.map(async (course) => {
      const buffer = await fetchImageBuffer(course.thumbnailUrl);
      return buffer ? ([course.order, buffer] as const) : null;
    }),
  );

  return new Map(entries.filter((entry): entry is readonly [number, Buffer] => Boolean(entry)));
}

async function loadSuggestionImages(suggestions: NextRouteSuggestion[]): Promise<Map<number, Buffer>> {
  const entries = await Promise.all(
    suggestions.map(async (suggestion, index) => {
      const buffer = await fetchImageBuffer(suggestion.thumbnailUrl);
      return buffer ? ([index, buffer] as const) : null;
    }),
  );

  return new Map(entries.filter((entry): entry is readonly [number, Buffer] => Boolean(entry)));
}

async function generatePdfBuffer(plan: StudyPlanData, catalogCourses: Course[]): Promise<Buffer> {
  const courseImages = await loadCourseImages(plan.courses);
  const nextSuggestions = buildNextRouteSuggestions(plan, catalogCourses);
  const suggestionImages = await loadSuggestionImages(nextSuggestions);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      info: {
        Title: 'Plano de Desenvolvimento Individual - Daxus',
        Author: 'Daxus',
      },
    });
    const chunks: Buffer[] = [];

    registerPdfFonts(doc);

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawCoverTemplatePage(doc, plan);

    doc.addPage();
    drawTemplatePage(doc, PDI_TEMPLATES.page2);

    doc.addPage();
    drawTemplatePage(doc, PDI_TEMPLATES.page3);

    doc.addPage();
    drawRoutePage(doc, plan, courseImages);

    doc.addPage();
    drawFinalTemplatePage(doc, nextSuggestions, suggestionImages);

    doc.end();
  });
}

function pageSize(doc: PdfDoc) {
  return { width: doc.page.width, height: doc.page.height };
}

function registerPdfFonts(doc: PdfDoc) {
  try {
    if (fs.existsSync(PDF_FONT_FILES.regular)) {
      doc.registerFont('Inter-Regular', PDF_FONT_FILES.regular);
      PDF_FONT_REGULAR = 'Inter-Regular';
    }
    if (fs.existsSync(PDF_FONT_FILES.bold)) {
      doc.registerFont('Inter-Bold', PDF_FONT_FILES.bold);
      PDF_FONT_BOLD = 'Inter-Bold';
    }
  } catch {
    PDF_FONT_REGULAR = 'Helvetica';
    PDF_FONT_BOLD = 'Helvetica-Bold';
  }
}

function fillColorOpacity(doc: PdfDoc, color: string, opacity: number) {
  doc.fillColor(color).opacity(opacity);
}

function strokeColorOpacity(doc: PdfDoc, color: string, opacity: number) {
  doc.strokeColor(color).opacity(opacity);
}

function drawTemplatePage(doc: PdfDoc, filePath: string) {
  const { width, height } = pageSize(doc);
  const image = loadLocalImage(filePath);

  if (image) {
    doc.image(image, 0, 0, { width, height });
    return;
  }

  doc.rect(0, 0, width, height).fill(COLORS.white);
}

function drawFinalTemplatePage(
  doc: PdfDoc,
  suggestions: NextRouteSuggestion[],
  suggestionImages: Map<number, Buffer>,
) {
  drawTemplatePage(doc, PDI_TEMPLATES.final);

  const startX = 54;
  const startY = 458;
  const cardWidth = 154;
  const cardHeight = 236;
  const gap = 16;

  suggestions.forEach((suggestion, index) => {
    const x = startX + index * (cardWidth + gap);
    const imageBuffer = suggestionImages.get(index);

    doc
      .save()
      .opacity(0.16)
      .roundedRect(x, startY, cardWidth, cardHeight, 12)
      .fill(COLORS.white)
      .restore();

    doc
      .save()
      .opacity(0.34)
      .roundedRect(x, startY, cardWidth, cardHeight, 12)
      .stroke('#A4A4FF')
      .restore();

    doc.circle(x + 24, startY + 28, 15).fill('#A4A4FF');
    doc
      .fillColor(COLORS.navy)
      .font(PDF_FONT_BOLD)
      .fontSize(10)
      .text(String(index + 1).padStart(2, '0'), x + 14, startY + 22, {
        width: 20,
        align: 'center',
      });

    const imageX = x + 18;
    const imageY = startY + 50;
    const imageWidth = 52;
    const imageHeight = 72;
    doc.roundedRect(imageX, imageY, imageWidth, imageHeight, 7).fillAndStroke('#f0f3ff', '#A4A4FF');
    if (imageBuffer) {
      try {
        doc.image(imageBuffer, imageX + 4, imageY + 4, {
          fit: [imageWidth - 8, imageHeight - 8],
          align: 'center',
          valign: 'center',
        });
      } catch {
        drawThumbFallback(doc, imageX, imageY, imageWidth, imageHeight);
      }
    } else {
      drawThumbFallback(doc, imageX, imageY, imageWidth, imageHeight);
    }

    doc
      .fillColor(COLORS.white)
      .font(PDF_FONT_BOLD)
      .fontSize(9.6)
      .text(shorten(suggestion.title, 54), x + 80, startY + 52, {
        width: cardWidth - 96,
        lineGap: 1,
      });

    doc
      .fillColor('#A4A4FF')
      .font(PDF_FONT_BOLD)
      .fontSize(7.8)
      .text(shorten(suggestion.duration, 30), x + 80, startY + 104, {
        width: cardWidth - 96,
      });

    doc
      .fillColor('#e8e4ff')
      .font(PDF_FONT_REGULAR)
      .fontSize(8.2)
      .text(shorten(suggestion.reason, 156), x + 18, startY + 140, {
        width: cardWidth - 36,
        lineGap: 1.6,
      });
  });
}

function drawCoverTemplatePage(doc: PdfDoc, plan: StudyPlanData) {
  const { width } = pageSize(doc);
  drawTemplatePage(doc, PDI_TEMPLATES.cover);
  doc
    .fillColor('#34AEEE')
    .font(PDF_FONT_BOLD)
    .fontSize(24)
    .text(plan.studentName || 'Aluno', 70, 324, {
      width: width - 140,
      align: 'center',
      lineGap: 2,
    });
}

function drawDarkFigmaBackground(doc: PdfDoc) {
  const { width, height } = pageSize(doc);
  doc.rect(0, 0, width, height).fill(COLORS.navy);
  doc.rect(width * 0.42, 0, width * 0.58, height).fill('#110926');
  doc.save().opacity(0.16);
  doc.circle(width * 0.82, height * 0.14, 120).fill(COLORS.violet);
  doc.circle(width * 0.12, height * 0.78, 180).fill(COLORS.purple);
  doc.restore();

  doc.save().opacity(0.08).strokeColor(COLORS.lavender).lineWidth(0.5);
  for (let x = -80; x < width + 80; x += 58) {
    doc.moveTo(x, 0).lineTo(x + 180, height).stroke();
  }
  for (let y = 70; y < height; y += 76) {
    doc.moveTo(0, y).lineTo(width, y - 34).stroke();
  }
  doc.restore();
}

function drawBrandRule(doc: PdfDoc, y: number, dark = true) {
  const { width } = pageSize(doc);
  doc
    .save()
    .opacity(dark ? 0.55 : 1)
    .strokeColor(dark ? COLORS.violet : COLORS.border)
    .lineWidth(0.8)
    .moveTo(42, y)
    .lineTo(width - 42, y)
    .stroke()
    .restore();
}

function drawLowPolyMountain(doc: PdfDoc) {
  const { width, height } = pageSize(doc);
  const baseY = height - 128;
  const points = [
    [0, baseY + 44],
    [62, baseY + 24],
    [116, baseY - 6],
    [178, baseY + 16],
    [236, baseY - 54],
    [314, baseY - 20],
    [382, baseY - 104],
    [452, baseY - 30],
    [width, baseY - 10],
    [width, height],
    [0, height],
  ];

  doc.polygon(...(points as any)).fill('#f5f7fb');

  const facets = [
    { pts: [[0, baseY + 44], [116, baseY - 6], [92, baseY + 92], [0, height]], fill: '#dfe4ee' },
    { pts: [[116, baseY - 6], [178, baseY + 16], [92, baseY + 92]], fill: '#f8fafc' },
    { pts: [[178, baseY + 16], [236, baseY - 54], [286, baseY + 88], [92, baseY + 92]], fill: '#bfc8d6' },
    { pts: [[236, baseY - 54], [314, baseY - 20], [286, baseY + 88]], fill: '#eef2f7' },
    { pts: [[314, baseY - 20], [382, baseY - 104], [430, baseY + 80], [286, baseY + 88]], fill: '#a8b4c4' },
    { pts: [[382, baseY - 104], [452, baseY - 30], [width, baseY - 10], [430, baseY + 80]], fill: '#d7dde7' },
  ];

  for (const facet of facets) {
    doc.polygon(...(facet.pts as any)).fillAndStroke(facet.fill, '#c8d0dc');
  }

  const nodes = [
    [112, baseY - 5],
    [178, baseY + 16],
    [236, baseY - 54],
    [314, baseY - 20],
    [382, baseY - 104],
    [452, baseY - 30],
  ];
  doc.save().strokeColor('#8f99aa').lineWidth(0.6).opacity(0.7);
  for (let i = 0; i < nodes.length - 1; i += 1) {
    doc.moveTo(nodes[i][0], nodes[i][1]).lineTo(nodes[i + 1][0], nodes[i + 1][1]).stroke();
  }
  doc.restore();
  nodes.forEach(([x, y]) => {
    doc.circle(x, y, 2.2).fillAndStroke(COLORS.white, '#7d8798');
  });
}

function drawPinIcon(doc: PdfDoc, x: number, y: number) {
  doc.circle(x, y, 9).fill('#111032');
  doc.circle(x, y, 4).fill(COLORS.white);
  doc.circle(x, y, 2).fill(COLORS.purple);
}

function drawTinyPageFooter(doc: PdfDoc, dark = false) {
  const { width, height } = pageSize(doc);
  doc
    .fillColor(dark ? '#a9a7c8' : COLORS.muted)
    .font('Helvetica')
    .fontSize(7)
    .text('Plataforma Daxus', 46, height - 34, { width: width - 92 });
}

function drawFooter(doc: PdfDoc) {
  const { width, height } = pageSize(doc);
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(8)
    .text(`Gerado por Daxus - ${new Date().toLocaleDateString('pt-BR')}`, 48, height - 34, {
      width: width - 96,
      align: 'center',
    });
}

function drawPageHeader(doc: PdfDoc, title: string, eyebrow?: string) {
  const { width } = pageSize(doc);
  doc.rect(0, 0, width, 72).fill(COLORS.white);
  doc.rect(0, 72, width, 1).fill('#ececf2');
  drawDaxusLogo(doc, 'blueHorizontal', 48, 26, 96, 20);
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(6.8)
    .text(eyebrow || 'Plano de Desenvolvimento Individual', 154, 32, { width: 210 });
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(title, width - 238, 30, { width: 190, align: 'right' });
}

function drawCover(doc: PdfDoc, plan: StudyPlanData) {
  const { width, height } = pageSize(doc);
  drawDarkFigmaBackground(doc);
  drawDaxusLogo(doc, 'whiteHorizontal', width / 2 - 48, 74, 96, 24);
  drawBrandRule(doc, 126);
  doc
    .fillColor(COLORS.soft)
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('PLANO DE DESENVOLVIMENTO INDIVIDUAL', 0, 146, {
      width,
      align: 'center',
      characterSpacing: 2.8,
    });

  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('Aluno', 0, 254, { width, align: 'center' });

  doc
    .fillColor('#34AEEE')
    .font('Helvetica-Bold')
    .fontSize(24)
    .text(plan.studentName || 'Aluno', 70, 282, {
      width: width - 140,
      align: 'center',
    });

  doc
    .fillColor('#bdb9df')
    .font('Helvetica')
    .fontSize(10)
    .text(shorten(plan.professionalGoal || 'Trilha de estudos personalizada', 150), 78, 324, {
      width: width - 156,
      align: 'center',
      lineGap: 2,
    });

  drawLowPolyMountain(doc);
  drawPinIcon(doc, 42, height - 58);
  drawTinyPageFooter(doc, true);
}

function drawMethodologyPage(doc: PdfDoc) {
  const { width } = pageSize(doc);
  drawDarkFigmaBackground(doc);
  drawDaxusLogo(doc, 'whiteHorizontal', 48, 36, 118, 24);
  drawBrandRule(doc, 82);

  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('Daxus | Plano de Desenvolvimento Individual', 48, 108, { width: 420 });

  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text('Plano de Desenvolvimento Individual (PDI)', 48, 224, { width: 300 });
  doc
    .fillColor('#d8d2ef')
    .font('Helvetica')
    .fontSize(9.5)
    .text(
      'Este guia foi criado para oferecer um caminho profissional claro, acionavel e conectado com cursos reais da Daxus. Nao se trata apenas de concluir conteudo: trata-se de transformar aprendizado em evidencias, projetos e oportunidades.',
      48,
      254,
      { width: 286, lineGap: 3 },
    );

  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('Este plano tem como foco os 3 pilares essenciais', 48, 390, {
      width: 320,
      lineGap: 2,
    });

  const pyramidImage = loadLocalImage(PDI_TEMPLATES.pyramid);
  if (pyramidImage && isSupportedPdfImage(pyramidImage)) {
    try {
      doc.image(pyramidImage, width - 250, 352, {
        fit: [210, 168],
        align: 'center',
        valign: 'center',
      });
    } catch {
      drawPyramid(doc, width - 198, 390, 132, 110);
    }
  } else {
    drawPyramid(doc, width - 198, 390, 132, 110);
  }

  const bullets = [
    ['Aprendizado tecnico', 'Traduzir o conteudo em dominio real de ferramentas e conceitos.'],
    ['Habilidades comportamentais', 'Sustentar comunicacao, lideranca, foco e tomada de decisao.'],
    ['Posicionamento', 'Mostrar projetos, narrativa profissional e presenca no LinkedIn.'],
  ];

  let y = 508;
  for (const [label, body] of bullets) {
    doc.circle(60, y + 6, 4).fill(COLORS.green);
    doc
      .fillColor(COLORS.white)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(label, 76, y, { width: 170 });
    doc
      .fillColor('#d8d2ef')
      .font('Helvetica')
      .fontSize(8.8)
      .text(body, 252, y, { width: 270, lineGap: 2 });
    y += 54;
  }

  drawTinyPageFooter(doc, true);
}

function drawPyramid(doc: PdfDoc, x: number, y: number, width: number, height: number) {
  const layers = [
    { label: 'Posicionamento profesional', color: COLORS.purple },
    { label: 'Habilidades profissionais', color: COLORS.green },
    { label: 'Aprendizado tecnico', color: COLORS.blue },
  ];
  const layerHeight = height / layers.length;
  const insetAt = (progress: number) => (width / 2) * (1 - progress);

  layers.forEach((layer, index) => {
    const y1 = y + index * layerHeight;
    const y2 = y + (index + 1) * layerHeight;
    const inset1 = insetAt(index / layers.length);
    const inset2 = insetAt((index + 1) / layers.length);
    doc
      .moveTo(x + inset1, y1)
      .lineTo(x + width - inset1, y1)
      .lineTo(x + width - inset2, y2)
      .lineTo(x + inset2, y2)
      .closePath()
      .fillAndStroke(layer.color, COLORS.white);

    const labelColor = layer.color === COLORS.green ? COLORS.blue : COLORS.white;
    doc
      .fillColor(labelColor)
      .font('Helvetica-Bold')
      .fontSize(index === 0 ? 10 : 12)
      .text(layer.label, x + inset2 + 18, y1 + layerHeight / 2 - 7, {
        width: width - inset2 * 2 - 36,
        align: 'center',
      });
  });
}

function drawImportantKeysPage(doc: PdfDoc) {
  drawPageHeader(doc, 'Dicas importantes');

  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('Principios para sustentar seu progresso', 48, 116, { width: 500 });
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(10.5)
    .text(
      'Estas dicas adaptam as recomendacoes centrais do PDI de referencia a metodologia da Daxus.',
      48,
      150,
      { width: 500 },
    );

  const keys = [
    [
      'Comece antes de se sentir pronto',
      'Nao espere dominar 100% para aplicar a oportunidades ou criar projetos. A preparacao melhora com pratica real.',
    ],
    [
      'Frequencia acima da intensidade',
      'Um bloco diario ou semanal sustentado gera mais progresso do que sessoes longas sem continuidade.',
    ],
    [
      'Aprender importa mais do que avancar',
      'Nao marque cursos como concluidos sem compreender. Pare, pratique e volte ao conteudo quando precisar.',
    ],
    [
      'LinkedIn faz parte da trilha',
      'Seu perfil, publicacoes e projetos ajudam recrutadores e aliados a entender rapidamente sua proposta profissional.',
    ],
  ];

  let y = 214;
  keys.forEach(([title, body], index) => {
    drawKeyCard(doc, 58, y, index + 1, title, body);
    y += 118;
  });

  drawFooter(doc);
}

function drawKeyCard(doc: PdfDoc, x: number, y: number, order: number, title: string, body: string) {
  const width = doc.page.width - x * 2;
  doc.roundedRect(x, y, width, 88, 8).fillAndStroke(COLORS.wash, COLORS.border);
  doc.circle(x + 30, y + 34, 18).fill(COLORS.purple);
  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(String(order), x + 24, y + 27, { width: 12, align: 'center' });
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(title, x + 64, y + 18, { width: width - 84 });
  doc
    .fillColor(COLORS.muted)
    .font('Helvetica')
    .fontSize(10)
    .text(body, x + 64, y + 40, { width: width - 88, lineGap: 2 });
}

function drawRoutePage(doc: PdfDoc, plan: StudyPlanData, courseImages: Map<number, Buffer>) {
  drawTemplatePage(doc, PDI_TEMPLATES.letterhead);

  let y = 108;
  y = drawProfileSummary(doc, plan, y);

  doc
    .fillColor(COLORS.ink)
    .font(PDF_FONT_BOLD)
    .fontSize(18)
    .text(`Trilha recomendada: ${plan.courses.length} cursos - ~${plan.totalEstimatedWeeks} semanas`, 48, y, {
      width: doc.page.width - 96,
    });
  y += 30;

  for (const course of plan.courses) {
    const reasonHeight = doc.heightOfString(course.reason || '', {
      width: doc.page.width - 260,
      lineGap: 1,
    });
    const cardHeight = Math.max(116, Math.min(152, 74 + reasonHeight));
    if (y + cardHeight > doc.page.height - 92) {
      doc.addPage();
      drawTemplatePage(doc, PDI_TEMPLATES.letterhead);
      doc
        .fillColor(COLORS.ink)
        .font(PDF_FONT_BOLD)
        .fontSize(18)
        .text('Trilha recomendada', 48, 108, { width: doc.page.width - 96 });
      y = 108;
      y += 34;
    }

    drawCourseCard(doc, course, courseImages.get(course.order), y, cardHeight);
    y += cardHeight + 14;
  }

  if (y + 110 > doc.page.height - 92) {
    doc.addPage();
    drawTemplatePage(doc, PDI_TEMPLATES.letterhead);
    y = 116;
  }

  drawScheduleBox(doc, plan, y);
}

function drawProfileSummary(doc: PdfDoc, plan: StudyPlanData, y: number): number {
  const x = 48;
  const width = doc.page.width - 96;
  const currentSituation = cleanText(plan.currentSituation);
  const professionalGoal = cleanText(plan.professionalGoal);
  const rawSkills = cleanText(plan.specificSkills);
  const normalizedCurrent = normalizeText(currentSituation);
  const normalizedSkills = normalizeText(rawSkills);
  const skillsLookLikeExperience =
    normalizedSkills &&
    normalizedSkills === normalizedCurrent;
  const specificSkills =
    rawSkills && !skillsLookLikeExperience ? rawSkills : 'Nao identificadas';

  doc.roundedRect(x, y, width, 116, 8).fill(COLORS.blue);
  doc
    .save()
    .opacity(0.26)
    .roundedRect(x, y, width, 116, 8)
    .stroke('#A4A4FF')
    .restore();
  doc
    .fillColor('#A4A4FF')
    .font(PDF_FONT_BOLD)
    .fontSize(10)
    .text('PERFIL IDENTIFICADO', x + 18, y + 16, { characterSpacing: 0.8 });

  const items = [
    ['Objetivo', professionalGoal || 'Nao identificado'],
    ['Situacao atual', currentSituation || 'Nao identificada'],
    ['Habilidades', specificSkills],
    ['Disponibilidade', `${plan.weeklyHours || 0} horas/semana - ${plan.targetTimeline || 'sem prazo'}`],
  ];

  let itemY = y + 40;
  items.forEach(([label, value], index) => {
    const itemX = x + 18 + (index % 2) * 250;
    if (index === 2) itemY += 36;
    doc.fillColor(COLORS.white).font(PDF_FONT_BOLD).fontSize(9).text(label, itemX, itemY, {
      width: 96,
    });
    doc.fillColor(COLORS.soft).font(PDF_FONT_REGULAR).fontSize(9).text(shorten(value, 90), itemX + 82, itemY, {
      width: 155,
      lineGap: 1,
    });
  });

  return y + 148;
}

function drawCourseCard(
  doc: PdfDoc,
  course: StudyPlanData['courses'][number],
  imageBuffer: Buffer | undefined,
  y: number,
  height: number,
) {
  const x = 48;
  const width = doc.page.width - 96;
  doc.roundedRect(x, y, width, height, 8).fillAndStroke('#EEEEEE', COLORS.border);
  doc.save().opacity(0.8).rect(x, y, 4, height).fill('#242424').restore();

  doc.save().opacity(0.8).circle(x + 28, y + 32, 16).fill('#242424').restore();
  doc
    .fillColor(COLORS.white)
    .font(PDF_FONT_BOLD)
    .fontSize(10)
    .text(String(course.order), x + 22, y + 26, { width: 12, align: 'center' });

  const imageX = x + 58;
  const imageY = y + 14;
  const imageWidth = 62;
  const imageHeight = 88;
  doc.roundedRect(imageX, imageY, imageWidth, imageHeight, 6).fillAndStroke('#eef7f7', COLORS.border);
  if (imageBuffer) {
    try {
      doc.image(imageBuffer, imageX + 4, imageY + 4, {
        fit: [imageWidth - 8, imageHeight - 8],
        align: 'center',
        valign: 'center',
      });
    } catch {
      drawThumbFallback(doc, imageX, imageY, imageWidth, imageHeight);
    }
  } else {
    drawThumbFallback(doc, imageX, imageY, imageWidth, imageHeight);
  }

  const textX = imageX + imageWidth + 24;
  const textWidth = width - 164;
  doc
    .fillColor(COLORS.ink)
    .font(PDF_FONT_BOLD)
    .fontSize(12)
    .text(course.title, textX, y + 16, { width: textWidth });

  const scope = [course.masterName && course.masterName !== course.title ? course.masterName : '', course.level || '']
    .filter(Boolean)
    .join(' - ');
  if (scope) {
    doc
      .save()
      .opacity(0.8)
      .fillColor('#242424')
      .font(PDF_FONT_BOLD)
      .fontSize(8)
      .text(scope.toUpperCase(), textX, y + 34, { width: textWidth })
      .restore();
  }

  doc
    .save()
    .opacity(0.8)
    .fillColor('#242424')
    .font(PDF_FONT_BOLD)
    .fontSize(8.5)
    .text(`${course.duration || 'Sem duracao especificada'} - ~${course.estimatedWeeks || 1} semanas`, textX, y + 48, {
      width: textWidth,
    })
    .restore();
  doc
    .save()
    .opacity(0.8)
    .fillColor('#242424')
    .font(PDF_FONT_REGULAR)
    .fontSize(9)
    .text(course.reason || 'Recomendado para esta trilha personalizada.', textX, y + 64, {
      width: textWidth,
      lineGap: 1,
    })
    .restore();
}

function drawThumbFallback(doc: PdfDoc, x: number, y: number, width = 66, height = 66) {
  const mark = loadLocalImage(BRAND_LOGOS.blueHorizontal);
  if (mark) {
    try {
      doc.image(mark, x + 8, y + height / 2 - 9, {
        fit: [width - 16, 18],
        align: 'center',
        valign: 'center',
      });
      return;
    } catch {
      // Text fallback below.
    }
  }

  doc
    .save()
    .opacity(0.8)
    .fillColor('#242424')
    .font(PDF_FONT_BOLD)
    .fontSize(15)
    .text('DX', x, y + height / 2 - 8, { width, align: 'center' })
    .restore();
}

function drawScheduleBox(doc: PdfDoc, plan: StudyPlanData, y: number) {
  const x = 48;
  const width = doc.page.width - 96;
  doc.roundedRect(x, y, width, 104, 8).fill(COLORS.blue);
  doc
    .save()
    .opacity(0.26)
    .roundedRect(x, y, width, 104, 8)
    .stroke('#A4A4FF')
    .restore();
  doc
    .fillColor('#A4A4FF')
    .font(PDF_FONT_BOLD)
    .fontSize(13)
    .text('Horario semanal sugerido', x + 18, y + 18);
  doc
    .fillColor(COLORS.soft)
    .font(PDF_FONT_REGULAR)
    .fontSize(10)
    .text(plan.weeklySchedule || 'Sem horario sugerido.', x + 18, y + 42, {
      width: width - 36,
      lineGap: 2,
    });
  if (plan.additionalNotes) {
    doc
      .fillColor(COLORS.soft)
      .font(PDF_FONT_REGULAR)
      .fontSize(9)
      .text(plan.additionalNotes, x + 18, y + 72, {
        width: width - 36,
        lineGap: 1,
      });
  }
}

function drawCongratulationsPage(doc: PdfDoc, plan: StudyPlanData) {
  const { width, height } = pageSize(doc);
  drawDarkFigmaBackground(doc);
  drawDaxusLogo(doc, 'whiteHorizontal', 48, 36, 118, 24);
  drawBrandRule(doc, 82);
  doc.save().opacity(0.18);
  doc.roundedRect(width - 218, 92, 160, 460, 24).fill(COLORS.lavender);
  doc.restore();

  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(34)
    .text('Parabens!', 58, 146, { width: width - 116, lineGap: 4 });
  doc
    .fillColor(COLORS.soft)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('Voce acaba de concluir seu programa personalizado!', 60, 202, {
      width: width - 120,
    });
  doc
    .fillColor('#d8d2ef')
    .font('Helvetica')
    .fontSize(10)
    .text(
      `${plan.studentName || 'Aluno'}, esta trilha e um guia vivo para avancar com intencao. Use o plano como base, crie evidencias e ajuste prioridades com seus resultados reais.`,
      60,
      230,
      { width: 390, lineGap: 3 },
    );

  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('Sugestao das proximas trilhas:', 60, 360, { width: 300 });

  const suggestions = [
    'Publique avancos e projetos no LinkedIn.',
    'Reserve blocos de estudo antes de iniciar a semana.',
    'Busque feedback mensal e ajuste a trilha.',
  ];

  let x = 60;
  suggestions.forEach((suggestion, index) => {
    doc.save().opacity(0.24);
    doc.roundedRect(x, 398, 120, 138, 8).fill(COLORS.white);
    doc.restore();
    doc.circle(x + 18, 410, 3).fill(COLORS.white);
    doc
      .fillColor(COLORS.white)
      .font('Helvetica-Bold')
      .fontSize(26)
      .text(`0${index + 1}`, x + 18, 430, { width: 82, align: 'center' });
    doc
      .fillColor('#e8e4ff')
      .font('Helvetica')
      .fontSize(8.4)
      .text(suggestion, x + 16, 482, { width: 88, align: 'center', lineGap: 2 });
    x += 140;
  });

  doc
    .fillColor(COLORS.green)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('Continue avancando com constancia. A Daxus acompanha sua jornada.', 58, height - 86, {
      width: width - 116,
      align: 'center',
    });
  drawTinyPageFooter(doc, true);
}
