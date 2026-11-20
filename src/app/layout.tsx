import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NeuroStudio | Studio de Production Vidéo IA & Google Flow",
  description: "Créez vos films IA de 1m30 avec continuité des personnages 8K, découpage cinématique et montage pro.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
