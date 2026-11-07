import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

// Brandbook Gogroup: Poppins (ExtraBold nos títulos, SemiBold nos subtítulos).
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "800"],
});

export const metadata: Metadata = {
  title: "Ponta Firme",
  description: "Ponta Firme: o agente de atendimento que resolve sozinho onde é seguro e chama uma pessoa só onde ela faz diferença. GoHacks Talent 2026, Gocase e GoBeauté.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${poppins.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
