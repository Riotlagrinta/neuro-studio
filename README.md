# 🧠 Neuro-Studio v4.0

**Neuro-Studio** est un studio de production vidéo intelligent conçu pour les créateurs de contenu. Il transforme des idées brutes en storyboards cinématographiques complets avec scripts, voix-off professionnelles et visuels synchronisés.

## 🚀 Fonctionnalités Clés

- **Scripting IA (Groq) :** Génération ultra-rapide de scripts structurés avec `llama-3.3-70b`.
- **Voix-off (ElevenLabs) :** Synthèse vocale multilingue haute fidélité.
- **Storyboard Vidéo (Replicate) :** Génération de visuels et clips vidéo synchronisés sur la durée de l'audio.
- **Stockage Cloud (Cloudinary) :** Hébergement optimisé des ressources audio et vidéo.
- **Base de Données (Neon) :** Persistance des projets sur PostgreSQL (Serverless).
- **Exportation PDF :** Génération de fiches de production professionnelles.

## 🛠️ Stack Technique

- **Framework :** Next.js 16 (App Router)
- **Langage :** TypeScript
- **Style :** Tailwind CSS 4 & Framer Motion
- **Base de Données :** Neon (PostgreSQL)
- **IA & Médias :**
  - Groq (LLM)
  - ElevenLabs (TTS)
  - Replicate (Génération Vidéo/Image)
  - Cloudinary (Stockage)

## 📦 Installation

1. Clonez le dépôt :
```bash
git clone https://github.com/votre-repo/neuro-studio.git
```

2. Installez les dépendances :
```bash
npm install
```

3. Configurez les variables d'environnement (`.env.local`) :
```env
DATABASE_URL=postgres://... (Neon)
GROQ_API_KEY=...
ELEVENLABS_API_KEY=...
CLOUDINARY_URL=...
REPLICATE_API_TOKEN=...
```

4. Lancez le serveur de développement :
```bash
npm run dev
```

## 📜 Licence

Propriété de **Kelvix Digital Agency**. Tous droits réservés.
