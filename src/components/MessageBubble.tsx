'use client';

import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';

interface MessageBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  index: number;
}

export default function MessageBubble({ role, content, isStreaming, index }: MessageBubbleProps) {
  const isUser = role === 'user';

  // Strip [PLAN_READY] marker from display
  const displayContent = content.replace('[PLAN_READY]', '').trim();

  return (
    <motion.div
      className={`message-row ${isUser ? 'message-user' : 'message-assistant'}`}
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.05, 0.3), ease: 'easeOut' }}
    >
      {!isUser && (
        <div className="message-avatar">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
              fill="url(#starGrad)"
            />
            <defs>
              <linearGradient id="starGrad" x1="2" y1="2" x2="22" y2="22">
                <stop stopColor="#a78bfa" />
                <stop offset="1" stopColor="#7c3aed" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      )}

      <div className={`message-bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
        {isUser ? (
          <p>{displayContent}</p>
        ) : (
          <div className="markdown-content">
            <ReactMarkdown>{displayContent}</ReactMarkdown>
          </div>
        )}
        {isStreaming && (
          <span className="typing-cursor">
            <span className="cursor-dot" />
            <span className="cursor-dot" />
            <span className="cursor-dot" />
          </span>
        )}
      </div>
    </motion.div>
  );
}
