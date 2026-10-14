import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Xyne presents CASH — Collaborative Agent Shell",
  description: "Xyne presents CASH: small agent commands, composed with pipes, run from cron, operated together with tail -f, steer and kill. Built on Vercel, AI Gateway and Neon.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-black antialiased">{children}</body>
    </html>
  );
}
