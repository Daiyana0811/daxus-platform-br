'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { StudyPlanData } from '@/lib/supabase';

const CS_SUPPORT_URL = 'https://sndflw.com/l/atendimento-cs';
const INVALID_EMAIL_MESSAGE =
  `Este e-mail nao aparece como valido para acessar. Por favor fale conosco no CS.`;

interface EmailGateProps {
  onValidated: (data: {
    userId: string;
    userName: string | null;
    email: string;
    conversationId: string;
    existingMessages: Array<{ role: string; content: string; createdAt: string }>;
    latestStudyPlan?: StudyPlanData | null;
  }) => void;
}

export default function EmailGate({ onValidated }: EmailGateProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const normalizedEmail = email.toLowerCase().trim();

  const renderErrorMessage = () => {
    if (!error.includes('CS')) return error;

    return (
      <span className="email-error-content">
        <span>{error}</span>
        <a className="email-error-link" href={CS_SUPPORT_URL} target="_blank" rel="noreferrer">
          Abrir atendimento CS
        </a>
      </span>
    );
  };

  const validateEmail = async () => {
    setError('');
    setMessage('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const data = await res.json();

      if (!res.ok || !data.valid || !data.verified) {
        setError(INVALID_EMAIL_MESSAGE);
        return;
      }

      onValidated({
        userId: data.userId,
        userName: data.userName,
        email: data.email || normalizedEmail,
        conversationId: data.conversationId,
        existingMessages: data.existingMessages || [],
        latestStudyPlan: data.latestStudyPlan || null,
      });
    } catch {
      setError('Erro de conexao. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await validateEmail();
  };

  return (
    <motion.div
      className="email-gate"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
    >
      <div className="email-gate-card">
        <div className="email-gate-glow" />

        <motion.div
          className="email-gate-icon"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
        >
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="24" fill="url(#grad1)" opacity="0.15" />
            <circle cx="24" cy="24" r="16" fill="url(#grad1)" opacity="0.3" />
            <path
              d="M24 14C18.48 14 14 18.48 14 24C14 29.52 18.48 34 24 34C29.52 34 34 29.52 34 24C34 18.48 29.52 14 24 14ZM24 18C25.93 18 27.5 19.57 27.5 21.5C27.5 23.43 25.93 25 24 25C22.07 25 20.5 23.43 20.5 21.5C20.5 19.57 22.07 18 24 18ZM24 31.2C21.5 31.2 19.29 29.92 18 27.98C18.03 25.99 22 24.9 24 24.9C25.99 24.9 29.97 25.99 30 27.98C28.71 29.92 26.5 31.2 24 31.2Z"
              fill="url(#grad1)"
            />
            <defs>
              <linearGradient id="grad1" x1="0" y1="0" x2="48" y2="48">
                <stop stopColor="#a78bfa" />
                <stop offset="1" stopColor="#7c3aed" />
              </linearGradient>
            </defs>
          </svg>
        </motion.div>

        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          Acesse seu orientador
        </motion.h2>

        <motion.p
          className="email-gate-subtitle"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          Digite o e-mail com o qual voce esta registrado na Daxus.
        </motion.p>

        <motion.form
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <div className="input-wrapper">
            <svg className="input-icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M3 5L10 11L17 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <rect
                x="2"
                y="4"
                width="16"
                height="12"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
            <input
              id="email-input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@email.com"
              required
              disabled={loading}
              autoFocus
            />
          </div>

          <AnimatePresence>
            {message && (
              <motion.div
                className="email-success"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                {message}
              </motion.div>
            )}
            {error && (
              <motion.div
                className="email-error"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M8 5V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
                </svg>
                {renderErrorMessage()}
              </motion.div>
            )}
          </AnimatePresence>

          <button
            id="validate-btn"
            type="submit"
            disabled={loading || !normalizedEmail}
            className="email-submit-btn"
          >
            {loading ? (
              <span className="btn-loading">
                <span className="spinner" />
                Validando...
              </span>
            ) : (
              <>Entrar no chat</>
            )}
          </button>
        </motion.form>
      </div>
    </motion.div>
  );
}
