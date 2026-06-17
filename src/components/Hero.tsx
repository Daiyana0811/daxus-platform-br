'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';

export default function Hero() {
  return (
    <section className="hero">
      <div className="hero-bg">
        <div className="hero-orb hero-orb-1" />
        <div className="hero-orb hero-orb-2" />
        <div className="hero-orb hero-orb-3" />
        <div className="hero-grid" />
      </div>

      <div className="hero-content">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="hero-logo-wrapper"
        >
          <img
            src="/brand/br/Daxus-logo-br.png"
            alt="Daxus"
            className="hero-main-logo"
          />
        </motion.div>

        <motion.div
          className="hero-badge"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <span className="badge-dot" />
          Impulsionado por Inteligencia Artificial
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.7 }}
        >
          <span className="hero-title-line">Sua trilha de estudos</span>
          <span className="hero-title-line hero-gradient-text">personalizada com IA</span>
        </motion.h1>

        <motion.p
          className="hero-subtitle"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          Conte ao Dax seu objetivo profissional e receba um Plano de Desenvolvimento
          Individual com os cursos Daxus mais adequados para a sua jornada.
        </motion.p>

        <motion.div
          className="hero-actions"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
        >
          <Link href="/chat" className="hero-cta-primary" id="cta-hero">
            <span>Criar meu PDI</span>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M7 4L13 10L7 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </motion.div>

        <motion.div
          className="hero-preview"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1, duration: 0.8 }}
        >
          <div className="preview-card preview-card-chat">
            <div className="preview-chat-header">
              <div className="preview-avatar">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="#a78bfa" />
                </svg>
              </div>
              <span>Dax</span>
            </div>
            <div className="preview-message">
              Oi! Sou o Dax, seu orientador profissional. Qual objetivo voce quer alcancar?
            </div>
            <div className="preview-message preview-user-msg">
              Quero crescer na empresa usando Python e dados
            </div>
            <div className="preview-message">
              Excelente objetivo. Vamos montar uma trilha realista para transformar isso em progresso...
            </div>
          </div>

          <div className="preview-card preview-card-plan">
            <div className="preview-plan-header">Seu PDI</div>
            <div className="preview-plan-item">
              <span className="preview-num">1</span>
              <span>Fundamentos de Python</span>
            </div>
            <div className="preview-plan-item">
              <span className="preview-num">2</span>
              <span>LinkedIn Magnetico</span>
            </div>
            <div className="preview-plan-item">
              <span className="preview-num">3</span>
              <span>Projetos com Dados</span>
            </div>
            <div className="preview-plan-bar" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
