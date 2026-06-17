import { Client } from '@notionhq/client';
import type { Course, StudyPlanData } from './supabase';

// ============================================
// Notion Client Configuration
// ============================================

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

export const COURSES_DATABASE_ID = process.env.NOTION_COURSES_DB_ID!;
export const PROFILES_DATABASE_ID =
  process.env.NOTION_CHATS_DB_ID ||
  process.env.NOTION_PROFILES_DB_ID ||
  process.env.NOTION_OUTPUT_DB_ID ||
  '3524f395dfac802b9ec9d76d3c14e23f';

// ============================================
// Helper: Extract text from Notion rich text
// ============================================

function extractRichText(richText: any[]): string {
  if (!richText || !Array.isArray(richText)) return '';
  return richText.map((rt: any) => rt.plain_text || '').join('');
}

// ============================================
// Helper: Extract property value from Notion page
// ============================================

function extractProperty(properties: any, key: string): string {
  const prop = properties[key];
  if (!prop) return '';

  switch (prop.type) {
    case 'title':
      return extractRichText(prop.title);
    case 'rich_text':
      return extractRichText(prop.rich_text);
    case 'number':
      return prop.number?.toString() || '';
    case 'select':
      return prop.select?.name || '';
    case 'multi_select':
      return prop.multi_select?.map((s: any) => s.name).join(', ') || '';
    case 'url':
      return prop.url || '';
    case 'files':
      if (prop.files?.length > 0) {
        const file = prop.files[0];
        return file.file?.url || file.external?.url || '';
      }
      return '';
    default:
      return '';
  }
}

function normalizePlainText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeTitle(value: string): string {
  return normalizePlainText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeComparableTitle(value: string): string {
  const stopWords = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'en']);

  return normalizeTitle(value)
    .split(' ')
    .filter((word) => word && !stopWords.has(word))
    .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
    .join(' ')
    .trim();
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

function extractDurationFromText(text: string): string | null {
  const normalized = normalizePlainText(text);
  if (!/duracion(?:\s+del\s+curso)?\s*:/.test(normalized)) return null;

  const colonIndex = text.indexOf(':');
  if (colonIndex === -1) return null;

  const duration = text
    .slice(colonIndex + 1)
    .split('\n')[0]
    .split('.')[0]
    .trim();

  return duration || null;
}

async function listBlockText(blockId: string): Promise<string[]> {
  const texts: string[] = [];
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: startCursor,
      page_size: 100,
    });

    for (const block of response.results) {
      const typedBlock = block as any;
      const richText = typedBlock[typedBlock.type]?.rich_text || [];
      const text = extractRichText(richText);
      if (text) texts.push(text);
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor || undefined;
  }

  return texts;
}

function inferMasterLevels(
  masters: Array<{ title: string; levelTitles: string[] }>,
  courses: Omit<Course, 'id' | 'synced_at'>[]
) {
  for (const master of masters) {
    for (const levelTitle of master.levelTitles) {
      const levelMatch = levelTitle.match(/nivel\s*(\d+)/i);
      const levelNumber = levelMatch ? Number(levelMatch[1]) : null;
      const normalizedLevelTitle = normalizeTitle(
        levelTitle.replace(/nivel\s*\d+\s*-?/i, '')
      );

      const matchedCourse = courses.find((course) => {
        if (course.title === master.title) return false;
        if (/^nivel\s*\d+\s*-/i.test(course.title)) return false;
        const normalizedCourseTitle = normalizeTitle(course.title);
        return (
          normalizedCourseTitle === normalizedLevelTitle ||
          normalizedCourseTitle.includes(normalizedLevelTitle) ||
          normalizedLevelTitle.includes(normalizedCourseTitle) ||
          titlesMatch(course.title, levelTitle)
        );
      });

      if (matchedCourse) {
        matchedCourse.master_name = master.title;
        matchedCourse.master_level = levelNumber;
        matchedCourse.level = levelMatch?.[0] || null;
      }
    }
  }
}

// ============================================
// Fetch all courses from Notion database
// ============================================

export async function fetchCoursesFromNotion(): Promise<Omit<Course, 'id' | 'synced_at'>[]> {
  const courses: Omit<Course, 'id' | 'synced_at'>[] = [];
  const masters: Array<{ title: string; levelTitles: string[] }> = [];
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: COURSES_DATABASE_ID,
      start_cursor: startCursor,
      page_size: 100,
    });

    for (const page of response.results) {
      if (!('properties' in page)) continue;

      const props = page.properties;
      const blockTexts = await listBlockText(page.id);
      const title =
        extractProperty(props, 'Nome do recurso') ||
        extractProperty(props, 'Nome do curso') ||
        extractProperty(props, 'Nome') ||
        extractProperty(props, 'Titulo') ||
        extractProperty(props, 'Titulo') ||
        extractProperty(props, 'Nombre del recurso') ||
        extractProperty(props, 'Nombre') ||
        'Sem titulo';
      const description =
        extractProperty(props, 'Descricao') ||
        extractProperty(props, 'Descricao') ||
        extractProperty(props, 'Descripcao') ||
        extractProperty(props, 'Descripcion') ||
        blockTexts.find((blockText) => !extractDurationFromText(blockText) && blockText.length > 20) ||
        null;
      const duration =
        extractProperty(props, 'Duracao') ||
        extractProperty(props, 'Duracao') ||
        extractProperty(props, 'Duracion') ||
        blockTexts.map(extractDurationFromText).find(Boolean) ||
        null;

      // Map Notion properties to our Course type
      // NOTE: Adjust these property names to match your actual Notion database columns
      const course: Omit<Course, 'id' | 'synced_at'> = {
        notion_id: page.id,
        title,
        description,
        duration,
        thumbnail_url: extractProperty(props, 'Arquivos e midia') || extractProperty(props, 'Imagem') || extractProperty(props, 'Archivos y multimedia') || extractProperty(props, 'Imagen') || null,
        category: extractProperty(props, 'Categoria') || extractProperty(props, 'Selecionar') || extractProperty(props, 'Categoria') || extractProperty(props, 'Seleccionar') || null,
        level: extractProperty(props, 'Nivel') || null,
        master_name: extractProperty(props, 'Master') || null,
        master_level: null,
        tags: [],
      };

      if (course.title) {
        if (/^master\s+/i.test(course.title)) {
          masters.push({
            title: course.title.trim(),
            levelTitles: blockTexts.filter((text) => /^nivel\s*\d+/i.test(text)),
          });
        }
        courses.push(course);
      }
    }

    hasMore = response.has_more;
    startCursor = response.next_cursor || undefined;
  }

  inferMasterLevels(masters, courses);

  return courses;
}

// ============================================
// Save generated student profiles and plans
// ============================================

function truncateText(value: string, maxLength = 1900): string {
  if (!value) return '';
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function notionText(value: string) {
  return [{ type: 'text', text: { content: truncateText(value) } }];
}

function paragraphBlock(value: string) {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: notionText(value),
    },
  };
}

function headingBlock(value: string) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: notionText(value),
    },
  };
}

function bulletBlock(value: string) {
  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: notionText(value),
    },
  };
}

interface GeneratedPdfFile {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

function fileUploadBlock(fileUploadId: string, caption: string) {
  return {
    object: 'block',
    type: 'file',
    file: {
      caption: notionText(caption),
      type: 'file_upload',
      file_upload: {
        id: fileUploadId,
      },
    },
  };
}

function notionApiHeaders(contentType = 'application/json') {
  return {
    Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
    'Notion-Version': '2026-03-11',
    ...(contentType ? { 'Content-Type': contentType } : {}),
  };
}

async function notionApiRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      ...notionApiHeaders(),
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`Notion API ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function uploadPdfFileToNotion(file: GeneratedPdfFile): Promise<string> {
  const created = await notionApiRequest('/file_uploads', {
    method: 'POST',
    body: JSON.stringify({
      mode: 'single_part',
      filename: file.filename,
      content_type: file.contentType,
    }),
  });

  const fileUploadId = created.id;
  const uploadUrl = created.upload_url;
  if (!fileUploadId || !uploadUrl) {
    throw new Error('Notion did not return a file upload URL.');
  }

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([new Uint8Array(file.buffer)], { type: file.contentType }),
    file.filename,
  );

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'Notion-Version': '2026-03-11',
    },
    body: formData,
  });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(`Notion file upload ${uploadResponse.status}: ${text}`);
  }

  return fileUploadId;
}

function blockPlainText(block: any): string {
  const richText = block?.[block.type]?.rich_text || [];
  return extractRichText(richText);
}

async function archiveExistingPdfGeneratedSection(pageId: string) {
  const response = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });
  const firstPdfBlockIndex = response.results.findIndex((block: any) => {
    const text = blockPlainText(block);
    return (
      text === 'PDF generado' ||
      text === 'PDF generado: Pendiente' ||
      text === 'Contenido del PDF generado'
    );
  });

  if (firstPdfBlockIndex === -1) return;

  for (const block of response.results.slice(firstPdfBlockIndex)) {
    await notion.blocks.update({
      block_id: block.id,
      archived: true,
    } as any);
  }
}

function findTitleProperty(properties: Record<string, any>): string {
  const found = Object.entries(properties).find(([, prop]) => prop.type === 'title');
  return found?.[0] || 'Nombre';
}

function findEmailProperty(properties: Record<string, any>): string | null {
  const found = Object.entries(properties).find(([name, prop]) => {
    const normalized = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return ['email', 'correo', 'correo electronico'].includes(normalized) ||
      prop.type === 'email';
  });

  return found?.[0] || null;
}

function emailPropertyValue(property: any, email: string): any {
  if (property?.type === 'email') return { email };
  return { rich_text: notionText(email) };
}

function buildPlanBlocks(
  conversationId: string,
  email: string,
  plan: StudyPlanData
): any[] {
  const blocks: any[] = [
    headingBlock('Perfil identificado'),
    paragraphBlock(`Conversation ID: ${conversationId}`),
    paragraphBlock(`Email/sesion: ${email}`),
    paragraphBlock(`Nome: ${plan.studentName || 'Aluno'}`),
    paragraphBlock(`Situacao atual: ${plan.currentSituation || 'Nao identificada'}`),
    paragraphBlock(`Objetivo profissional: ${plan.professionalGoal || 'Nao identificado'}`),
    paragraphBlock(`Habilidades especificas: ${plan.specificSkills || 'No identificadas'}`),
    paragraphBlock(`Disponibilidad: ${plan.weeklyHours || 0} horas por semana`),
    paragraphBlock(`Timeline objetivo: ${plan.targetTimeline || 'No identificado'}`),
    headingBlock('Trilha recomendada'),
  ];

  for (const course of plan.courses || []) {
    blocks.push(
      bulletBlock(
        `${course.order}. ${course.title} (${course.duration || 'sin duracion'}) - ${
          course.reason || 'Recomendado para esta trilha personalizada.'
        }`
      )
    );
  }

  blocks.push(
    headingBlock('Horario y notas'),
    paragraphBlock(plan.weeklySchedule || 'Sin horario sugerido.'),
    paragraphBlock(plan.additionalNotes || 'Sin notas adicionales.')
  );

  return blocks;
}

export async function saveStudyPlanToNotion(
  conversationId: string,
  email: string,
  plan: StudyPlanData
): Promise<string | null> {
  if (!process.env.NOTION_TOKEN || !PROFILES_DATABASE_ID) {
    console.warn('Notion profile database is not configured.');
    return null;
  }

  try {
    const database = await notion.databases.retrieve({
      database_id: PROFILES_DATABASE_ID,
    });
    const properties = (database as any).properties || {};
    const titleProperty = findTitleProperty(properties);
    const emailProperty = findEmailProperty(properties);
    const pageTitle = plan.studentName || email || 'Aluno Daxus';
    const pageProperties: Record<string, any> = {
      [titleProperty]: {
        title: notionText(pageTitle),
      },
    };

    if (emailProperty) {
      pageProperties[emailProperty] = emailPropertyValue(properties[emailProperty], email);
    }

    const page = await notion.pages.create({
      parent: { database_id: PROFILES_DATABASE_ID },
      properties: pageProperties,
      children: buildPlanBlocks(conversationId, email, plan).slice(0, 90),
    } as any);

    return 'id' in page ? page.id : null;
  } catch (error) {
    console.error('saveStudyPlanToNotion error:', error);
    return null;
  }
}

export async function markStudyPlanPdfGeneratedInNotion(
  pageId: string | null | undefined,
  plan: StudyPlanData,
  pdfFile?: GeneratedPdfFile
) {
  if (!pageId) return;

  try {
    await archiveExistingPdfGeneratedSection(pageId);

    const children: any[] = [headingBlock('PDF generado')];

    if (pdfFile) {
      const fileUploadId = await uploadPdfFileToNotion(pdfFile);
      children.push(
        fileUploadBlock(
          fileUploadId,
          `Generado el ${plan.pdfGeneratedAt || new Date().toISOString()}`,
        ),
      );
    } else {
      children.push(
        paragraphBlock(
          `Archivo generado el ${plan.pdfGeneratedAt || new Date().toISOString()}.`,
        ),
      );
    }

    await notionApiRequest(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: JSON.stringify({ children }),
    });
  } catch (error) {
    console.error('markStudyPlanPdfGeneratedInNotion error:', error);
  }
}
