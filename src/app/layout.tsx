import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "agentsh — a unix shell for agents that keep working",
  description: "Small single-purpose agent commands, composed with pipes, run from cron, operated with tail -f, kill and steer. Built on Vercel, AI Gateway and Neon by the Xyne team.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-black antialiased">{children}</body>
    </html>
  );
}
