import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DeckCast — 讓簡報開口說話',
  description: 'AI 簡報語音生成器，PDF 一鍵轉 Podcast + AI 歌曲 + PPTX',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <head>
        {/* favicon: slide deck + broadcast wave, brand emerald */}
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%23047857'/><rect x='4' y='9' width='15' height='11' rx='2' fill='white'/><rect x='6' y='12' width='8' height='1.5' rx='.75' fill='%23047857' opacity='.45'/><rect x='6' y='15' width='5' height='1.5' rx='.75' fill='%23047857' opacity='.45'/><path d='M22 13.5 Q25.5 16 22 18.5' stroke='white' stroke-width='2' fill='none' stroke-linecap='round'/><path d='M24.5 11 Q29.5 16 24.5 21' stroke='white' stroke-width='1.8' fill='none' stroke-linecap='round' opacity='.55'/></svg>" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-white text-slate-800 antialiased mint-glow"
        style={{ fontFamily: "'Inter', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
