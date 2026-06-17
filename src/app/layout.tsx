import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Daxus - Seu PDI Personalizado com IA',
  description:
    'Descubra seu caminho de aprendizagem ideal. Converse com Dax, conte seu objetivo profissional e receba um Plano de Desenvolvimento Individual com os cursos Daxus mais adequados.',
  keywords: ['educacao', 'cursos online', 'PDI', 'plano de estudos', 'IA', 'aprendizagem personalizada', 'Daxus'],
  openGraph: {
    title: 'Daxus - Seu PDI Personalizado com IA',
    description: 'Converse com Dax, nosso orientador com IA, e receba um PDI desenhado para voce.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Orbitron:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
