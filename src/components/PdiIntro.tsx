'use client';

import { motion } from 'framer-motion';

export default function PdiIntro() {
  return (
    <section className="pdi-intro" aria-labelledby="pdi-intro-title">
      <div className="section-container">
        <motion.div
          className="pdi-intro-panel"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
        >
          <div className="pdi-intro-copy">
            <span className="section-tag">Plano de Desenvolvimento Individual</span>
            <h2 id="pdi-intro-title">O que e o PDI</h2>
            <p>
              Este Plano de Desenvolvimento Individual sera o guia para ajudar voce a atualizar
              suas habilidades e alinhar seu perfil as novas demandas do mercado, aumentando suas
              possibilidades de conquistar novas oportunidades.
            </p>
            <p>
              Dominar novas tecnologias nao e mais um diferencial, e uma necessidade. As empresas
              buscam profissionais que saibam usar essas ferramentas de forma estrategica para
              resolver problemas, otimizar processos e inovar.
            </p>
          </div>

          <div className="pdi-intro-pillars" aria-label="Pilares do PDI">
            <img
              src="/pdi-br/Piramide-pilares.png"
              alt="Piramide dos pilares do PDI: aprendizado tecnico, posicionamento e habilidades comportamentais"
            />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
