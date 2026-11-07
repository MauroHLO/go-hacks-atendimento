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
  title: "Agente de atendimento: Gocase e GoBeauté",
  description: "GoHacks Talent 2026: o modelo classifica e redige; o código decide o que se resolve sozinho e o que precisa de uma pessoa.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${poppins.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
