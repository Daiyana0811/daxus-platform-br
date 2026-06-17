'use client';

import { motion } from 'framer-motion';
import type { StudyPlanData } from '@/lib/supabase';

interface StudyPlanCardProps {
  plan: StudyPlanData;
  onDownloadPDF: () => void;
  generatingPDF: boolean;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isCareerCourse(course: StudyPlanData['courses'][number]): boolean {
  const text = normalizeText(`${course.title} ${course.description || ''}`);
  return [
    'linkedin',
    'networking',
    'lideranca',
    'comunicacao',
    'oratoria',
    'inteligencia emocional',
    'empregabilidade',
    'produtividade',
    'gestao do tempo',
    'carreira',
    'posicionamento',
  ].some((term) => text.includes(term));
}

function orderCoursesForDisplay(plan: StudyPlanData): StudyPlanData['courses'] {
  const careerCourse = plan.courses.find(isCareerCourse);
  const technicalCourses = plan.courses.filter((course) => !isCareerCourse(course));

  if (!careerCourse || !technicalCourses.length) {
    return plan.courses.map((course, index) => ({ ...course, order: index + 1 }));
  }

  return [
    technicalCourses[0],
    careerCourse,
    ...technicalCourses.slice(1),
  ].map((course, index) => ({ ...course, order: index + 1 }));
}

export default function StudyPlanCard({ plan, onDownloadPDF, generatingPDF }: StudyPlanCardProps) {
  const orderedCourses = orderCoursesForDisplay(plan);

  return (
    <div className="study-plan-card">
      <div className="study-plan-header">
        <div className="study-plan-icon">PDI</div>
        <div>
          <h3>Sua Trilha de Estudos Personalizada</h3>
          <p>{orderedCourses.length} cursos · ~{plan.totalEstimatedWeeks} semanas</p>
        </div>
      </div>

      <div className="study-plan-profile">
        <div className="profile-pill">
          <span>{plan.professionalGoal}</span>
        </div>
        <div className="profile-pill">
          <span>{plan.targetTimeline} · {plan.weeklyHours}h/semana</span>
        </div>
      </div>

      <div className="study-plan-timeline">
        {orderedCourses.map((course, i) => (
          <motion.div
            key={`${course.title}-${i}`}
            className="timeline-course"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1, duration: 0.4 }}
          >
            <div className="timeline-connector">
              <div className="timeline-number">{i + 1}</div>
              {i < orderedCourses.length - 1 && <div className="timeline-line" />}
            </div>

            <div className="timeline-content">
              <div className="timeline-course-card">
                {course.thumbnailUrl && (
                  <img
                    src={course.thumbnailUrl}
                    alt={course.title}
                    className="timeline-thumb"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                <div className="timeline-info">
                  <h4>{course.title}</h4>
                  {course.masterName && (
                    <span className="timeline-master">
                      {course.masterName}
                      {course.level && ` - ${course.level}`}
                    </span>
                  )}
                  <div className="timeline-meta">
                    <span>{course.duration || '-'}</span>
                    <span>~{course.estimatedWeeks} semanas</span>
                  </div>
                  <p className="timeline-reason">{course.reason}</p>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {plan.weeklySchedule && (
        <div className="study-plan-schedule">
          <h4>Horario semanal sugerido</h4>
          <p>{plan.weeklySchedule}</p>
        </div>
      )}

      <motion.button
        className="pdf-download-btn"
        onClick={onDownloadPDF}
        disabled={generatingPDF}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {generatingPDF ? (
          <span className="btn-loading">
            <span className="spinner" />
            Gerando PDF...
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
      </motion.button>
    </div>
  );
}
