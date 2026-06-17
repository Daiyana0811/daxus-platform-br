import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_SIZE = 24 * 1024 * 1024;
const MAX_TEXT_LENGTH = 20000;

interface UploadedFile {
  name: string;
  size: number;
  type: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

function isUploadedFile(value: unknown): value is UploadedFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'size' in value &&
    'arrayBuffer' in value &&
    typeof (value as UploadedFile).arrayBuffer === 'function'
  );
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  const result = await pdfParse(buffer);
  return result.text || '';
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const extractRawText = mammoth.default?.extractRawText || mammoth.extractRawText;
  const result = await extractRawText({ buffer });
  return result.value || '';
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!isUploadedFile(file)) {
      return NextResponse.json(
        { success: false, error: 'No se recibió ningún arquivo.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { success: false, error: 'El arquivo supera el límite de 24 MB.' },
        { status: 413 }
      );
    }

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const buffer = Buffer.from(await file.arrayBuffer());
    let text = '';

    if (extension === 'pdf' || file.type === 'application/pdf') {
      text = await extractPdfText(buffer);
    } else if (
      extension === 'docx' ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      text = await extractDocxText(buffer);
    } else if (['txt', 'csv', 'json', 'md'].includes(extension) || file.type.startsWith('text/')) {
      text = buffer.toString('utf8');
    } else {
      return NextResponse.json(
        {
          success: false,
          error: 'Formato no soportado. Sube tu hoja de vida en PDF, DOCX, TXT, CSV, JSON o Markdown.',
        },
        { status: 415 }
      );
    }

    const cleanedText = cleanExtractedText(text);

    if (!cleanedText) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Nao consegui extrair texto do arquivo. Tente enviar uma versao com texto selecionavel ou cole as informacoes principais no chat.',
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      fileName: file.name,
      text: cleanedText,
      truncated: text.length > MAX_TEXT_LENGTH,
    });
  } catch (error) {
    console.error('File extraction error:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao analisar o arquivo.' },
      { status: 500 }
    );
  }
}
