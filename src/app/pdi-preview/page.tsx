import styles from './pdi-preview.module.css';

const samplePlan = {
  studentName: 'Aluno',
  professionalGoal: 'Crescer na empresa usando Python e analise de dados',
  currentSituation: 'Profissional com experiencia operacional e interesse em tecnologia',
  specificSkills: 'Excel intermediario, Python basico e comunicacao',
  weeklyHours: 4,
  targetTimeline: '6 meses',
  totalEstimatedWeeks: 28,
  courses: [
    {
      order: 1,
      title: 'Fundamentos de Python',
      scope: 'Master Python - Nivel 1',
      duration: '10h 5m - ~3 semanas',
      reason:
        'Recomendado para construir a base de programacao antes de avancar para automacoes e projetos com dados.',
      thumbnailUrl:
        'https://cdn.memberkit.com.br/65bmvyc1jg62kxeuwzeus4wzgvwq?width=300&height=420&fit=crop&dpr=2',
    },
    {
      order: 2,
      title: 'LinkedIn Magnetico',
      scope: 'Carreira e posicionamento',
      duration: '2h 28m - ~1 semana',
      reason:
        'Recomendado depois do primeiro curso tecnico para transformar aprendizado em visibilidade profissional.',
      thumbnailUrl:
        'https://cdn.memberkit.com.br/7j73mrzckaj5gg5kxvebctfnswps?width=300&height=420&fit=crop&dpr=2',
    },
    {
      order: 3,
      title: 'Projetos com Python',
      scope: 'Master Python - Nivel 2',
      duration: '8h - ~4 semanas',
      reason:
        'Recomendado para aplicar Python em problemas reais e gerar evidencias praticas para a carreira.',
      thumbnailUrl:
        'https://cdn.memberkit.com.br/l7qsutixnvwyfhvj735vyyi9orl9?width=300&height=420&fit=crop&dpr=2',
    },
  ],
};

function StaticPage({ src, alt }: { src: string; alt: string }) {
  return (
    <section className={styles.page}>
      <img className={styles.fullImage} src={src} alt={alt} />
    </section>
  );
}

function CoverPage() {
  return (
    <section className={styles.page}>
      <img className={styles.fullImage} src="/pdi-br/Portada.png" alt="Capa PDI Daxus" />
      <div className={styles.coverStudentName}>{samplePlan.studentName}</div>
    </section>
  );
}

function RoutePage() {
  return (
    <section className={`${styles.page} ${styles.letterheadPage}`}>
      <img className={styles.fullImage} src="/pdi-br/Membrete.png" alt="Membrete Daxus" />
      <main className={styles.routeContent}>
        <section className={styles.profileBox}>
          <p className={styles.kicker}>Perfil identificado</p>
          <div className={styles.profileGrid}>
            <div>
              <strong>Objetivo</strong>
              <span>{samplePlan.professionalGoal}</span>
            </div>
            <div>
              <strong>Situacao atual</strong>
              <span>{samplePlan.currentSituation}</span>
            </div>
            <div>
              <strong>Habilidades</strong>
              <span>{samplePlan.specificSkills}</span>
            </div>
            <div>
              <strong>Disponibilidade</strong>
              <span>
                {samplePlan.weeklyHours} horas/semana - {samplePlan.targetTimeline}
              </span>
            </div>
          </div>
        </section>

        <h1>
          Trilha recomendada: {samplePlan.courses.length} cursos - ~
          {samplePlan.totalEstimatedWeeks} semanas
        </h1>

        <div className={styles.courseList}>
          {samplePlan.courses.map((course) => (
            <article className={styles.courseCard} key={course.order}>
              <div className={styles.order}>{course.order}</div>
              <div className={styles.thumbWrap}>
                <img src={course.thumbnailUrl} alt="" />
              </div>
              <div className={styles.courseBody}>
                <h2>{course.title}</h2>
                <p className={styles.scope}>{course.scope}</p>
                <p className={styles.duration}>{course.duration}</p>
                <p>{course.reason}</p>
              </div>
            </article>
          ))}
        </div>

        <section className={styles.scheduleBox}>
          <h2>Horario semanal sugerido</h2>
          <p>
            Dedique blocos curtos e constantes: uma sessao para assistir aulas, uma para praticar
            e outra para transformar o aprendizado em evidencia profissional.
          </p>
        </section>
      </main>
    </section>
  );
}

export default function PdiPreviewPage() {
  return (
    <div className={styles.previewShell}>
      <div className={styles.toolbar}>
        <strong>Preview HTML PDI</strong>
        <span>Templates fixos + trilha sobre o membrete</span>
      </div>
      <div className={styles.document}>
        <CoverPage />
        <StaticPage src="/pdi-br/Pagina-2.png" alt="Metodologia PDI Daxus" />
        <StaticPage src="/pdi-br/Pagina-3.png" alt="Dicas importantes PDI Daxus" />
        <RoutePage />
        <StaticPage src="/pdi-br/Final.png" alt="Parabens PDI Daxus" />
      </div>
    </div>
  );
}
