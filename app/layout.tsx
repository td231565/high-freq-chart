import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ReactNode } from 'react';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: '高頻交易圖表 MVP',
  description: '基於 Web Worker 與 Lightweight Charts 的高效能高頻交易圖表',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-TW">
      <body className={`${inter.className} antialiased`}>{children}</body>
    </html>
  );
}
