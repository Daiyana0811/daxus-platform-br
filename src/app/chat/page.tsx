'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import ChatWindow from '@/components/ChatWindow';
import EmailGate from '@/components/EmailGate';
import Link from 'next/link';
import type { StudyPlanData } from '@/lib/supabase';

type VerifiedSession = {
  userId: string;
  userName: string | null;
  email: string;
  conversationId: string;
  existingMessages: Array<{ role: string; content: string; createdAt: string }>;
  latestStudyPlan?: StudyPlanData | null;
};

const SESSION_KEY = 'dax_br_verified_session';

export default function ChatPage() {
  const [sessionReady, setSessionReady] = useState(false);
  const [verifiedSession, setVerifiedSession] = useState<VerifiedSession | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as VerifiedSession;
        if (parsed.email && parsed.conversationId) {
          setVerifiedSession({
            ...parsed,
            existingMessages: parsed.existingMessages || [],
            latestStudyPlan: parsed.latestStudyPlan || null,
          });
        }
      } catch {
        sessionStorage.removeItem(SESSION_KEY);
      }
    }
    setSessionReady(true);
  }, []);

  const handleValidated = (session: VerifiedSession) => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setVerifiedSession(session);
  };

  const handleNewConversation = () => {
    if (!verifiedSession) return;

    const nextSession: VerifiedSession = {
      ...verifiedSession,
      conversationId: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      existingMessages: [],
      latestStudyPlan: null,
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    setVerifiedSession(nextSession);
  };

  return (
    <div className="chat-page">
      {/* Navigation */}
      <nav className="chat-nav">
        <Link href="/" className="chat-nav-logo">
          <img
            src="/brand/br/Daxus-logo-br.png"
            alt="Daxus"
            className="chat-nav-logo-img"
          />
        </Link>
        {verifiedSession?.email && (
          <span className="chat-nav-email">{verifiedSession.email}</span>
        )}
      </nav>

      {/* Main Content */}
      <div className="chat-page-content">
        {sessionReady && (
          <motion.div
            className={verifiedSession ? 'chat-wrapper' : 'email-wrapper'}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            {verifiedSession ? (
              <ChatWindow
                key={verifiedSession.conversationId}
                userId={verifiedSession.userId}
                userName={verifiedSession.userName}
                userEmail={verifiedSession.email}
                conversationId={verifiedSession.conversationId}
                existingMessages={verifiedSession.existingMessages}
                latestStudyPlan={verifiedSession.latestStudyPlan || null}
                onNewConversation={handleNewConversation}
              />
            ) : (
              <EmailGate onValidated={handleValidated} />
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
