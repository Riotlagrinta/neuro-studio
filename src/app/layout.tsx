import type { Metadata } from "next";
import { Anton, Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Serif + display faces for the motion canvas (see src/lib/motion/fonts.ts).
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

const anton = Anton({
  variable: "--font-anton",
  weight: "400",
  subsets: ["latin"],
});

// Generating a motion project with Opus can take a minute or two; applies to the server actions too.
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "NeuroStudio — Motion design IA",
  description: "Créez des vidéos motion design : animations dirigées par Claude Opus, voix IA et plans vidéo générés.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} ${anton.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
