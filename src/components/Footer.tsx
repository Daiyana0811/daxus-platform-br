'use client';

import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-brand">
          <img
            src="/brand/br/Daxus-logo-br.png"
            alt="Daxus"
            className="footer-logo-img"
          />
          <p>Educacao digital pensada para transformar sua carreira profissional.</p>
        </div>

        <div className="footer-links">
          <div className="footer-col">
            <h4>Plataforma</h4>
            <Link href="/chat">Criar meu PDI</Link>
            <a href="https://daxus.com" target="_blank" rel="noopener noreferrer">Ver cursos</a>
          </div>
          <div className="footer-col">
            <h4>Suporte</h4>
            <a href="mailto:soporte@daxus.com">Contato</a>
            <a href="#">Perguntas frequentes</a>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <p>&copy; {new Date().getFullYear()} Daxus. Todos os direitos reservados.</p>
      </div>
    </footer>
  );
}
