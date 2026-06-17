'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MessageBubble from './MessageBubble';
import type { StudyPlanData } from '@/lib/supabase';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatWindowProps {
  userId: string;
  userName: string | null;
  userEmail: string;
  conversationId: string;
  existingMessages: Array<{ role: string; content: string; createdAt: string }>;
  latestStudyPlan?: StudyPlanData | null;
  onNewConversation?: () => void;
}

type StoredMessage = Array<{ role: string; content: string; createdAt: string }>;

const SERVER_UPLOAD_LIMIT = 4 * 1024 * 1024;
const MAX_CLIENT_TEXT_LENGTH = 20000;

function getFileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

function cleanExtractedFileText(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CLIENT_TEXT_LENGTH);
}

async function extractPdfTextInBrowser(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist/build/pdf');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.js',
    import.meta.url,
  ).toString();

  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => item.str || '')
        .join(' ')
        .trim();
      if (pageText) pages.push(pageText);
    }
  } finally {
    await document.destroy();
  }

  return cleanExtractedFileText(pages.join('\n\n'));
}

async function extractFileForChat(file: File): Promise<{ fileName: string; text: string }> {
  const extension = getFileExtension(file.name);

  if (extension === 'pdf' || file.type === 'application/pdf') {
    const text = await extractPdfTextInBrowser(file);
    if (!text) {
      throw new Error('No pude extraer texto del PDF. Intenta subir una versión con texto seleccionable.');
    }
    return { fileName: file.name, text };
  }

  if (['txt', 'csv', 'json', 'md'].includes(extension) || file.type.startsWith('text/')) {
    const text = cleanExtractedFileText(await file.text());
    if (!text) throw new Error('Nao consegui extrair texto do arquivo.');
    return { fileName: file.name, text };
  }

  if (file.size > SERVER_UPLOAD_LIMIT) {
    throw new Error('Este arquivo e grande demais para enviar ao servidor. Para DOCX grandes, exporte para PDF com texto selecionavel ou cole as informacoes principais no chat.');
  }

  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/files/extract', {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();

  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Nao foi possivel analisar o arquivo.');
  }

  return { fileName: data.fileName || file.name, text: data.text };
}

function formatCourseLine(course: StudyPlanData['courses'][number], index: number): string {
  const masterInfo = [course.masterName, course.level].filter(Boolean).join(' - ');
  const durationInfo = course.duration ? ` (${course.duration})` : '';
  const reason = course.reason || course.description || 'Recomendado para seu objetivo profissional.';
  return `${index + 1}. **${course.title}**${masterInfo ? ` - ${masterInfo}` : ''}${durationInfo}: ${reason}`;
}

function normalizeIntentText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isNewStudyPlanRequest(value: string): boolean {
  const normalized = normalizeIntentText(value);
  return [
    'si',
    'sim quero',
    'quero gerar um novo plano',
    'novo plano',
    'generar novo plano',
    'crear novo plano',
    'comecar de novo',
    'yes',
    'new plan',
    'novo plano',
  ].some((intent) => normalized === intent || normalized.includes(intent));
}

function buildLatestPlanRecommendationMessage(plan: StudyPlanData): string {
  const courses = plan.courses.length
    ? plan.courses.map(formatCourseLine).join('\n')
    : 'Nao encontrei cursos guardados no plano anterior.';

  return [
    `Carreguei seu ultimo plano de estudos recomendado para que voce possa retoma-lo daqui.`,
    '',
    `**Objetivo:** ${plan.professionalGoal || 'Nao especificado'}`,
    `**Situacao atual:** ${plan.currentSituation || 'Nao especificada'}`,
    `**Habilidades identificadas:** ${plan.specificSkills || 'Nao especificadas'}`,
    `**Disponibilidade:** ${plan.weeklyHours || 0} horas/semana - ${plan.targetTimeline || 'sem prazo definido'}`,
    '',
    `**Trilha recomendada:**`,
    '',
    courses,
    '',
    plan.weeklySchedule ? `**Horario sugerido:** ${plan.weeklySchedule}` : '',
    plan.additionalNotes ? `**Notas:** ${plan.additionalNotes}` : '',
  ].filter(Boolean).join('\n');
}

function buildInitialMessages(
  existingMessages: StoredMessage,
  latestStudyPlan?: StudyPlanData | null,
): ChatMessage[] {
  const storedMessages = existingMessages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  if (!latestStudyPlan) return storedMessages;

  return [
    ...storedMessages,
    {
      role: 'assistant',
      content: buildLatestPlanRecommendationMessage(latestStudyPlan),
    },
    {
      role: 'assistant',
      content: 'Voce quer gerar um novo plano de estudos? Se preferir continuar com o anterior, pode baixar o PDI em PDF pelo botao inferior.',
    },
  ];
}

export default function ChatWindow({
  userId,
  userName,
  userEmail,
  conversationId,
  existingMessages,
  latestStudyPlan,
  onNewConversation,
}: ChatWindowProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(
    buildInitialMessages(existingMessages, latestStudyPlan)
  );
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [planReady, setPlanReady] = useState(Boolean(latestStudyPlan));
  const [studyPlan, setStudyPlan] = useState<StudyPlanData | null>(latestStudyPlan || null);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Auto-start conversation if no messages
  useEffect(() => {
    if (!initialized.current && messages.length === 0) {
      initialized.current = true;
      sendMessage('Ola, quero criar meu PDI personalizado');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Always focus input
  useEffect(() => {
    const focusInput = () => {
      if (inputRef.current && !isStreaming) {
        inputRef.current.focus();
      }
    };
    focusInput();
    // Add event listener to refocus when clicking anywhere in the chat
    const chatContainer = chatContainerRef.current;
    if (chatContainer) {
      chatContainer.addEventListener('click', focusInput);
    }
    return () => {
      if (chatContainer) {
        chatContainer.removeEventListener('click', focusInput);
      }
    };
  }, [isStreaming]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
  };

  // Send message
  const sendMessage = async (messageText?: string, fileData?: { name: string; content: string }) => {
    const text = messageText || input.trim();
    if (!text && !fileData) return;
    if (isStreaming) return;

    if (!messageText) {
      setInput('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
    }

    // Add user message (only if not auto-start)
    const isAutoStart = messageText === 'Ola, quero criar meu PDI personalizado' && messages.length === 0;
    const userDisplayContent = fileData
      ? `[Arquivo anexado: ${fileData.name}]\n\nHe cargado un documento para que lo analices. Por favor, revísalo para responder a mis preguntas de perfil.\n\n${text}`
      : text;
    const isStartingNewPlanFromHistory =
      Boolean(studyPlan && planReady && !fileData && isNewStudyPlanRequest(text));
    const requestClientMessages: ChatMessage[] = isStartingNewPlanFromHistory
      ? [{ role: 'user', content: userDisplayContent }]
      : [
        ...messages,
        { role: 'user', content: userDisplayContent },
      ];

    if (!isAutoStart) {
      const content = fileData 
        ? `[Arquivo anexado: ${fileData.name}]\n\nHe cargado un documento para que lo analices. Por favor, revísalo para responder a mis preguntas de perfil.\n\n${text}`
        : text;
      if (isStartingNewPlanFromHistory) {
        setStudyPlan(null);
        setPlanReady(false);
        setMessages([{ role: 'user', content }]);
      } else {
        setMessages((prev) => [...prev, { role: 'user', content: userDisplayContent }]);
      }
    }

    setIsStreaming(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          message: text,
          userId,
          userName,
          userEmail,
          fileContent: fileData?.content,
          fileName: fileData?.name,
          clientMessages: requestClientMessages,
        }),
      });

      if (!res.ok) throw new Error('Erro no chat');

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No stream available');

      const decoder = new TextDecoder();
      let assistantMessage = '';

      // Add empty assistant message
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.replace('data: ', '');

          try {
            const data = JSON.parse(jsonStr);

            if (data.content) {
              assistantMessage += data.content;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: 'assistant',
                  content: assistantMessage,
                };
                return updated;
              });
            }

            if (data.done && data.planReady) {
              setPlanReady(true);
            }
          } catch (e) {
            // Skip malformed JSON
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Desculpe, ocorreu um erro. Por favor, tente novamente.' },
      ]);
    } finally {
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  // Generate study plan
  const generatePlan = async (): Promise<StudyPlanData> => {
    setGeneratingPlan(true);
    try {
      const res = await fetch('/api/study-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          userId,
          userName,
          userEmail,
          clientMessages: messages,
        }),
      });

      const data = await res.json();
      if (data.success && data.plan) {
        setStudyPlan(data.plan);
        return data.plan;
      } else {
        throw new Error(data.error || 'Error generating plan');
      }
    } catch (error) {
      console.error('Plan generation error:', error);
      throw error;
    } finally {
      setGeneratingPlan(false);
    }
  };

  // Download PDF
  const handleDownloadPDF = async () => {
    setGeneratingPDF(true);
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write('<p style="font-family:Arial,sans-serif;padding:24px">Preparando seu PDI personalizado...</p>');
      printWindow.document.close();
    }

    try {
      const plan = studyPlan || await generatePlan();
      const res = await fetch('/api/pdf/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planData: plan }),
      });

      if (!res.ok) throw new Error('Erro ao gerar o PDF.');

      const pdfBlob = await res.blob();
      const pdfUrl = URL.createObjectURL(pdfBlob);

      if (printWindow) {
        printWindow.location.href = pdfUrl;
        setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
      } else {
        const link = document.createElement('a');
        link.href = pdfUrl;
        link.download = `pdi-daxus-${Date.now()}.pdf`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
      }
    } catch (error) {
      console.error('PDF error:', error);
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write('<p style="font-family:Arial,sans-serif;padding:24px">Nao foi possivel gerar o PDF. Tente novamente.</p>');
        printWindow.document.close();
      }
      alert('Erro ao gerar o PDF. Por favor, tente novamente.');
    } finally {
      setGeneratingPDF(false);
    }
  };

  // File Upload Handling
  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const extracted = await extractFileForChat(file);

      await sendMessage(
        'Anexei meu curriculo. Analise as informacoes do documento e pergunte apenas o que faltar para criar meu PDI personalizado.',
        { name: extracted.fileName, content: extracted.text }
      );
    } catch (error) {
      console.error('File upload error:', error);
      alert(error instanceof Error ? error.message : 'Erro ao carregar o arquivo.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Start new conversation
  const handleNewConversation = () => {
    if (onNewConversation) {
      onNewConversation();
      return;
    }

    setMessages([]);
    setStudyPlan(null);
    setPlanReady(false);
    window.location.reload();
  };

  return (
    <div className="chat-container" ref={chatContainerRef}>
      {/* Chat Header */}
      <div className="chat-header">
        <div className="chat-header-info">
          <div className="chat-agent-avatar">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
                fill="url(#headerStar)"
              />
              <defs>
                <linearGradient id="headerStar" x1="2" y1="2" x2="22" y2="22">
                  <stop stopColor="#a78bfa" />
                  <stop offset="1" stopColor="#7c3aed" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div>
            <h3>Dax</h3>
            <span className="chat-status">
              <span className="status-dot" />
              Orientador profissional Daxus
            </span>
          </div>
        </div>
        <button className="chat-new-btn" onClick={handleNewConversation} title="Nova conversa">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Messages Area */}
      <div className="chat-messages">
        <div className="chat-messages-inner">
          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              role={msg.role}
              content={msg.content}
              isStreaming={isStreaming && i === messages.length - 1 && msg.role === 'assistant'}
              index={i}
            />
          ))}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Plan Ready Banner */}
      <AnimatePresence>
        {planReady && (
          <motion.div
            className="plan-ready-banner plan-ready-download"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <button
              className="plan-generate-btn plan-download-btn"
              onClick={handleDownloadPDF}
              disabled={generatingPlan || generatingPDF}
            >
              {generatingPlan || generatingPDF ? (
                <span className="btn-loading">
                  <span className="spinner" />
                  Preparando PDF...
                </span>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path
                      d="M10 3V13M10 13L6 9M10 13L14 9M3 17H17"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Baixar PDI em PDF
                </>
              )}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
            accept=".pdf,.docx,.txt,.csv,.json,.md"
          />
          <button 
            className="chat-upload-btn" 
            onClick={handleFileClick}
            disabled={isStreaming || isUploading}
            title="Anexar curriculo ou arquivo"
          >
            {isUploading ? (
              <span className="spinner spinner-sm" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
          <textarea
            ref={inputRef}
            id="chat-input"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={isUploading ? "Carregando arquivo..." : "Escreva sua mensagem..."}
            rows={1}
            disabled={isStreaming || isUploading}
          />
          <button
            id="send-btn"
            className="chat-send-btn"
            onClick={() => sendMessage()}
            disabled={(!input.trim() && !isUploading) || isStreaming || isUploading}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M18 2L9 11M18 2L12 18L9 11M18 2L2 8L9 11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <p className="chat-disclaimer">
          Dax pode cometer erros. Verifique as informacoes dos cursos na plataforma.
        </p>
      </div>
    </div>
  );
}
