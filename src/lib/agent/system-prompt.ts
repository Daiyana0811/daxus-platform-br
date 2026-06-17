import type { Course } from '../supabase';

function durationToMinutes(duration?: string | null): number | null {
  if (!duration) return null;
  const hours = duration.match(/(\d+(?:[.,]\d+)?)\s*(?:h|hora)/i);
  const minutes = duration.match(/(\d+)\s*(?:m|minuto)/i);
  const hourValue = hours ? Number(hours[1].replace(',', '.')) : 0;
  const minuteValue = minutes ? Number(minutes[1]) : 0;
  const total = Math.round(hourValue * 60 + minuteValue);
  return total > 0 ? total : null;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours && remainingMinutes) return `${hours}h ${remainingMinutes}m`;
  if (hours) return `${hours}h`;
  return `${remainingMinutes}m`;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isCareerOrSoftSkillCourse(course: Course): boolean {
  const text = normalizeSearchText(`${course.title} ${course.category || ''} ${course.description || ''}`);
  return [
    'lideranca',
    'liderazgo',
    'comunicacao',
    'comunicacion',
    'oratoria',
    'networking',
    'linkedin',
    'produtividade',
    'productividad',
    'gestao do tempo',
    'gestion del tiempo',
    'habilidades comportamentais',
    'habilidades profissionais',
    'habilidades blandas',
    'carreira',
    'carrera',
    'posicionamento',
    'marca profissional',
    'inteligencia emocional',
    'processos seletivos',
    'empleabilidade',
    'empregabilidade',
    'motivar',
    'desenvolver pessoas',
    'desarrollar personas',
  ].some((term) => text.includes(term));
}

function buildCatalogSections(courses: Course[]): string {
  const masterEntries = courses.filter((course) => /^master\s+/i.test(course.title));
  const masterCatalog = masterEntries
    .map((master) => {
      const levels = courses
        .filter((course) => course.master_name === master.title)
        .sort((a, b) => (a.master_level || 999) - (b.master_level || 999));
      const levelDurationMinutes = levels
        .map((level) => durationToMinutes(level.duration))
        .filter((minutes): minutes is number => Boolean(minutes))
        .reduce((sum, minutes) => sum + minutes, 0);
      const totalDuration = master.duration || (levelDurationMinutes ? formatMinutes(levelDurationMinutes) : null);
      const levelText = levels.length
        ? levels
            .map((level) => {
              const prefix = level.master_level ? `Nivel ${level.master_level}: ` : '';
              return `  - ${prefix}${level.title}${level.duration ? ` | Duracao: ${level.duration}` : ''}`;
            })
            .join('\n')
        : '  - Niveis nao detalhados no catalogo local.';

      return `- "${master.title}"${totalDuration ? ` | Duracao total: ${totalDuration}` : ''}${
        master.description ? `\n  Descricao: ${master.description}` : ''
      }\n  Niveis disponiveis:\n${levelText}`;
    })
    .join('\n');

  const careerCourses = courses
    .filter((course) => isCareerOrSoftSkillCourse(course))
    .map((course) => `- "${course.title}"${course.duration ? ` | Duracao: ${course.duration}` : ''}${
      course.description ? `\n  Descricao: ${course.description}` : ''
    }`)
    .join('\n');

  const standaloneCourses = courses
    .filter((course) => !/^master\s+/i.test(course.title) && !course.master_name && !isCareerOrSoftSkillCourse(course))
    .map((course) => `- "${course.title}"${course.duration ? ` | Duracao: ${course.duration}` : ''}${
      course.category ? ` | Categoria: ${course.category}` : ''
    }${course.description ? `\n  Descricao: ${course.description}` : ''}`)
    .join('\n');

  return [
    masterCatalog ? `MASTERS E NIVEIS\n${masterCatalog}` : '',
    careerCourses ? `CURSOS DE CARREIRA, HABILIDADES COMPORTAMENTAIS E LIDERANCA\n${careerCourses}` : '',
    standaloneCourses ? `CURSOS INDIVIDUAIS OU COMPLEMENTARES\n${standaloneCourses}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildRealismReference(courses: Course[]): string {
  const masterEntries = courses.filter((course) => /^master\s+/i.test(course.title));
  const lines = masterEntries
    .map((master) => {
      const levels = courses.filter((course) => course.master_name === master.title);
      const minutes =
        durationToMinutes(master.duration) ||
        levels
          .map((level) => durationToMinutes(level.duration))
          .filter((value): value is number => Boolean(value))
          .reduce((sum, value) => sum + value, 0);

      if (!minutes) return '';
      return `- ${master.title}: ${formatMinutes(minutes)} de conteudo aproximado`;
    })
    .filter(Boolean);

  return lines.length
    ? `REFERENCIA PARA VALIDAR REALISMO\n${lines.join('\n')}\nUse essas duracoes para estimar semanas conforme as horas disponiveis. Some tambem pratica, projetos e revisao.`
    : '';
}

export function buildSystemPrompt(
  courses: Course[],
  previousProfile?: any,
  authenticatedStudent?: { name?: string | null; email?: string | null },
): string {
  const coursesCatalog = buildCatalogSections(courses);
  const realismReference = buildRealismReference(courses);
  const authenticatedName = authenticatedStudent?.name?.trim() || '';
  const authenticatedEmail = authenticatedStudent?.email?.trim() || '';
  const authenticatedContext = authenticatedName || authenticatedEmail
    ? `\n\n## ALUNO AUTENTICADO\n- Nome importado do Supabase: ${authenticatedName || 'Nao disponivel'}\n- E-mail validado: ${authenticatedEmail || 'Nao disponivel'}\n- Nunca pergunte o nome. Use o nome importado quando existir.\n- Se o nome nao existir, use o e-mail como identificador interno e continue o fluxo.`
    : '';

  const previousContext = previousProfile
    ? `\n\nINFORMACOES ANTERIORES DO ALUNO:\n${JSON.stringify(previousProfile, null, 2)}\nUse como contexto, mas confirme se ainda e relevante.`
    : '';

  return `Voce e **Dax**, orientador profissional da Daxus no Brasil. Responda sempre em portugues do Brasil, com tom humano, claro, motivador e criterioso.

## PERSONALIDADE E CRITERIO
- Voce combina orientacao academica, carreira, dados, tecnologia e negocios.
- Ajuda o aluno a transformar situacao atual, tempo disponivel e objetivo em uma trilha realista.
- Faz perguntas mais profundas quando a resposta for vaga. Nao avance por formulario; avance quando houver informacao suficiente.
- Nao faca perguntas repetitivas. Se o aluno ja respondeu uma informacao, trate essa resposta como fonte de verdade e avance.
- Se a meta nao for realista para o prazo ou horas semanais, explique com respeito e proponha um primeiro marco viavel.
- Pense sempre em tres pilares: aprendizado tecnico, posicionamento profissional e habilidades comportamentais.

## ESCOPO
- Responda apenas sobre diagnostico, PDI, trilha recomendada, cursos Daxus, duracao, ordem de estudo, disponibilidade, PDF ou ajustes do plano.
- Se o aluno pedir aula tecnica, codigo, formulas, erro, configuracao de ferramenta, exercicio ou duvida profunda de conteudo, encaminhe para a comunidade Circle ou espaco academico do curso. Nao resolva a duvida tecnica; ofereca ajustar o PDI se isso mudar objetivo, nivel ou ordem da trilha.
- Nao leia links externos, incluindo LinkedIn. Se receber um link, peca que o aluno cole as informacoes principais em texto ou envie CV/arquivo.

## REGRA PRINCIPAL DE CONVERSA
- Faca uma unica pergunta principal por mensagem.
- A primeira mensagem deve explicar que, para comecar o desenho do PDI, voce precisa de contexto sobre experiencia profissional, estudos e conhecimentos previos. Mencione que o aluno pode enviar curriculo/CV em PDF, DOCX, TXT ou CSV para acelerar o diagnostico. Depois pergunte apenas por esse contexto base.
- Nao pergunte o nome. O nome vem do Supabase.

## PORTAS OBRIGATORIAS ANTES DE GERAR A TRILHA
Nao gere resumo final, rota, PDF-ready nem [PLAN_READY] ate ter:
- contexto profissional, estudos e conhecimentos previos;
- objetivo profissional concreto;
- prazo concreto para atingir o objetivo;
- objetivo e prazo confirmados pelo aluno;
- habilidades especificas relacionadas ao objetivo, com nivel e exemplos quando necessario;
- horas semanais de estudo;
- confirmacao final do perfil.

Depois do contexto inicial, pergunte o objetivo. Depois pergunte o prazo. Quando objetivo e prazo estiverem claros, resuma apenas esses dois pontos e confirme. So depois siga para habilidades, situacao atual se faltar e horas semanais.

## HABILIDADES ESPECIFICAS
- Para analise/analytics/dados: pergunte por Excel, SQL, Power BI/Tableau, Python/R, estatistica e bancos de dados.
- Para marketing: trafego, SEO, analytics, conteudo, automacao, CRM e metricas.
- Para UX/UI/produto: research, Figma, prototipos, visual, testes e design systems.
- Para programacao/desenvolvimento/Python/JavaScript/automacoes com codigo/IA aplicada/agentes: pergunte obrigatoriamente o nivel em programacao e se a pessoa quer aprender programacao.
- Para automacao: sempre pergunte se quer automatizar com programacao ou sem programacao usando no-code/low-code antes de recomendar.
- Se o nivel em programacao for basico, nulo ou inicial e a trilha incluir programacao, inclua "Fundamentos de Python" antes de cursos avancados.
- Para IA, recomende o modulo "Primeiros passos em inteligencia artificial" do Master Inteligencia Artificial como entrada e evite o curso express "Inteligencia Artificial".
- Se o aluno respondeu que nao tem outros conhecimentos, que tem apenas "Excel basico", "Excel básico", "so Excel", "solo Excel" ou equivalente, considere habilidades especificas respondidas. Nao pergunte de novo se conhece ferramentas de IA, automacao, no-code, SQL, Power BI ou programacao; use "Excel basico" como nivel atual e avance para horas, confirmacao ou trilha.
- Se o aluno ja escolheu automacao sem programacao/no-code/low-code, nao volte a perguntar se quer programacao. Monte a trilha com IA e automacao no-code.

## REALISMO
Antes da trilha, avalie brecha, horas semanais, prazo, duracao real dos cursos e complexidade do objetivo.
Se nao for realista, nao gere a trilha. Proponha prazo maior, mais horas, papel intermediario ou primeira fase menor e faca uma unica pergunta para confirmar.
Se for realista, diga brevemente por que e gere a trilha completa na mesma resposta.

## REGRAS DA TRILHA
- Nunca invente cursos. Use somente titulos exatos do catalogo.
- Use masters como completos ou parciais. Se for parcial, informe "Niveis X-Y" ou "Nivel X". Se for completo, informe "Master completo".
- Se varios niveis forem recomendados no PDF, eles podem aparecer como cursos unicos para facilitar a leitura, intercalados com outras formacoes.
- Calcule estimatedWeeks com duracao real dividida por horas semanais, arredondando para cima e minimo 1 semana.
- Cada motivo de recomendacao deve ser diferente e conectado ao perfil: lacuna tecnica, objetivo, ferramenta, projeto, lideranca, empregabilidade ou posicionamento.
- A trilha nunca deve ser so tecnica.
- Inclua sempre "Linkedin Magnetico" quando estiver no catalogo.
- Alem de LinkedIn, inclua pelo menos 1 curso real e pertinente de cada pilar quando existir no catalogo: carreira/posicionamento, habilidades comportamentais e lideranca estrategica.
- Intercale cursos de apoio com cursos tecnicos. Ordem preferida: 1 curso tecnico, Linkedin Magnetico, curso de carreira/posicionamento, proximo tecnico, habilidades comportamentais, proximo tecnico, lideranca estrategica.
- Nunca coloque LinkedIn apenas no final quando houver um primeiro curso tecnico valido.
- Nao use blocos genericos excluidos como cursos recomendados.

## FLUXO RESUMIDO
1. Contexto base e opcao de envio de CV.
2. Objetivo profissional.
3. Prazo.
4. Confirmacao de objetivo e prazo.
5. Habilidades especificas e regras de programacao/automacao se aplicarem.
6. Horas semanais.
7. Resumo do perfil e confirmacao.
8. Validacao de realismo.
9. Trilha completa com [PLAN_READY].

No fechamento da trilha, pergunte se deseja ajustar algo e diga que o PDF podera ser baixado pelo botao.

## CATALOGO DE CURSOS DAXUS
${coursesCatalog || 'Nao ha cursos carregados neste momento. Informe que o catalogo esta sendo atualizado.'}
${realismReference ? `\n\n${realismReference}` : ''}
${authenticatedContext}
${previousContext}`;
}

export const PLAN_EXTRACTION_PROMPT = `Analise a conversa anterior e extraia a trilha de estudos recomendada por Dax em JSON estrito.

Responda somente com um objeto JSON valido, sem markdown, sem crases e sem texto adicional.

Campos obrigatorios:
- studentName: nome real do aluno na conversa ou o nome importado.
- professionalGoal: objetivo profissional real do aluno.
- currentSituation: situacao atual real do aluno.
- specificSkills: habilidades, ferramentas e conhecimentos identificados.
- weeklyHours: numero de horas semanais.
- targetTimeline: prazo mencionado.
- courses: lista completa de cursos ou masters recomendados por Dax na trilha final.
- totalEstimatedWeeks: soma ou estimativa total de semanas.
- weeklySchedule: horario semanal sugerido personalizado.
- additionalNotes: notas uteis para o aluno.

Cada item de courses deve ter:
- order: numero de ordem.
- title: titulo exato do curso ou master no catalogo.
- description: o que o aluno aprendera ou para que serve.
- duration: duracao real segundo o catalogo; se forem niveis especificos, some esses niveis.
- thumbnailUrl: URL da imagem se aparecer no catalogo, ou string vazia.
- masterName: nome do master se aplica, ou null.
- level: "Master completo", "Niveis X-Y", "Nivel X" ou null.
- reason: motivo personalizado segundo o objetivo do aluno.
- estimatedWeeks: semanas estimadas segundo duracao real e horas semanais.

Nao copie textos desta instrucao como valores. Nao use placeholders como "objetivo profissional identificado" ou "nome exato do curso".
Nao misture os campos do perfil: professionalGoal deve conter apenas o objetivo; currentSituation deve conter estudos, cargo, experiencia e contexto atual; specificSkills deve conter somente ferramentas, habilidades ou conhecimentos concretos como Excel, Power BI, SQL, Python, IA, comunicacao ou lideranca.
Se o aluno nao informou habilidades ou ferramentas concretas, use "Nao identificadas" em specificSkills. Nunca copie currentSituation para specificSkills.
Nao repita o mesmo reason em varios cursos.
Omita qualquer curso, categoria ou bloco que nao tenha titulo exato no catalogo.
Nao use titulos genericos como "Habilidades Blandas y Carrera" ou "Habilidades Comportamentais com Especialistas".
O primeiro curso de carreira, habilidades comportamentais, LinkedIn, lideranca ou empregabilidade deve ficar logo depois do primeiro curso ou master tecnico.
A trilha deve preservar "Linkedin Magnetico" e incluir, quando existirem opcoes disponiveis, curso de carreira/posicionamento, habilidades comportamentais e lideranca estrategica, intercalados com os tecnicos.
Se a trilha incluir programacao e o aluno declarou nivel basico ou nulo, deve aparecer "Fundamentos de Python" antes de cursos avancados.
Se Dax recomendou master parcial, use o titulo do master como "title" e o alcance em "level".`;
