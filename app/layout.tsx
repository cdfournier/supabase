import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Varro / Soren Chat",
  description: "Minimal local chat for seeded Supabase agents"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
