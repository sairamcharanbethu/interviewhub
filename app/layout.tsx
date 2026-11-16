import './globals.css';
import type { Metadata } from 'next';
import { AppProvider } from '@/components/context';
import Shell from '@/components/Shell';

export const metadata: Metadata = { title: 'InterviewHub', description: 'Candidate, resume, application and interview-prep hub' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        <AppProvider><Shell>{children}</Shell></AppProvider>
      </body>
    </html>
  );
}
