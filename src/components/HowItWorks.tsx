'use client';

import { motion } from 'framer-motion';

const steps = [
  {
    number: '01',
    title: 'Acesse o orientador',
    description: 'Entre com o e-mail cadastrado na Daxus e inicie a conversa com o Dax.',
  },
  {
    number: '02',
    title: 'Compartilhe seu contexto',
    description: 'Conte sua experiencia, estudos, conhecimentos previos, objetivo e disponibilidade semanal.',
  },
  {
    number: '03',
    title: 'Receba seu PDI em PDF',
    description: 'Baixe uma trilha personalizada com cursos, ordem recomendada e duracao estimada para o seu ritmo.',
  },
];

function StepIcon({ index }: { index: number }) {
  const paths = [
    'M12 16L15 19L20 13',
    'M12 12H20M12 16H17',
    'M10 14H22M10 18H18M10 22H14',
  ];

  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
      <path d="M16 4C22.627 4 28 9.373 28 16C28 22.627 22.627 28 16 28C9.373 28 4 22.627 4 16C4 9.373 9.373 4 16 4Z" stroke="url(#stepGrad)" strokeWidth="2" />
      <path d={paths[index]} stroke="url(#stepGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <defs>
        <linearGradient id="stepGrad" x1="4" y1="4" x2="28" y2="28">
          <stop stopColor="#34AEEE" />
          <stop offset="1" stopColor="#6DE2C3" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function HowItWorks() {
  return (
    <section className="how-it-works" id="how-it-works">
      <div className="section-container">
        <motion.div
          className="section-header"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
        >
          <span className="section-tag">Como funciona</span>
          <h2>
            Seu plano de estudos em
            <span className="hero-gradient-text"> 3 passos simples</span>
          </h2>
          <p>Sem complicacao. Converse, descubra e comece a aprender.</p>
        </motion.div>

        <div className="steps-grid">
          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              className="step-card"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ delay: i * 0.15, duration: 0.5 }}
            >
              <div className="step-number">{step.number}</div>
              <div className="step-icon"><StepIcon index={i} /></div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
