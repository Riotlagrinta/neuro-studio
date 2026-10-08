# 🎬 NeuroStudio — Motion design IA

**NeuroStudio** est un studio de motion design assisté par IA. Vous décrivez une vidéo ; **Claude Opus** la met en scène (titres animés, formes, transitions, narration), des **voix IA** la racontent, et des **modèles vidéo IA** peuvent générer des plans de fond pour chaque scène. Le résultat s'exporte en vidéo.

## Comment ça marche

| Étape | Outil | Détail |
|---|---|---|
| Motion design | **Claude Opus 5.5** | Écrit une *spec de motion* JSON : calques (formes, texte, fond IA), keyframes, easings, transitions, narration. |
| Aperçu & export | Canvas 2D + MediaRecorder | Le même moteur (`src/lib/motion/render.ts`) sert à l'aperçu, au scrub et à l'export WebM. |
| Voix | **ElevenLabs** ou **OpenAI TTS** | Au choix dans l'interface. La durée de chaque scène s'ajuste sur la narration. |
| Plans vidéo IA | **Seedance 1 Lite** ou **Wan 2.2 Fast** (Replicate) | Un clic par scène, jamais automatique (ça coûte). |
| Images de fond | Pollinations → Cloudinary | Gratuit. |
| Retouche | Claude Opus | « Plus dynamique, texte jaune, transition zoom… » sur une scène à la fois. |

La **démo** (bouton « Voir une démo ») fonctionne sans aucune clé d'API.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Neon (PostgreSQL) · Cloudinary · SDK `@anthropic-ai/sdk` · Replicate

## Installation

```bash
npm install
npm run dev
```

Variables d'environnement (`.env.local`) :

```env
# Requis pour la génération par Claude
ANTHROPIC_API_KEY=...

# Voix (au moins un des deux)
ELEVENLABS_API_KEY=...
OPENAI_API_KEY=...

# Plans vidéo IA (optionnel)
REPLICATE_API_TOKEN=...

# Hébergement des médias générés (voix, images, vidéos)
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# Sauvegarde des projets
DATABASE_URL=postgres://...   # Neon
```

Chaque fonctionnalité est désactivée proprement si sa clé manque (l'interface l'indique). La table `projects` attend les colonnes `id`, `title`, `category`, `plan`, `topic`, `created_at` ; le projet entier est stocké dans `plan`. Les anciens projets « biopic » restent lisibles.

## Coûts

Chaque appel passe par vos clés. Ordres de grandeur (tarifs publics à vérifier) :

- **Claude Opus 5.5** : 4 $ / 20 $ par million de tokens (entrée / sortie). La génération d'un projet utilise l'effort `high` ; pour réduire la facture, baissez l'effort (`output_config` dans `src/app/actions.ts`) ou changez le modèle (`MOTION_MODEL` dans `src/lib/anthropic-client.ts`).
- **Seedance 1 Lite** : 0,018 $/s en 480p, 0,036 $/s en 720p (le réglage actuel, voir `src/lib/video-models.ts`).
- **Wan 2.2 Fast** : de 0,05 $ à 0,11 $ par clip selon la résolution.

> ⚠️ L'application n'a **pas d'authentification** : une fois déployée publiquement, n'importe qui peut consommer vos crédits. Protégez-la avant de la partager.

## Limites connues

- **L'export est enregistré en temps réel** (une vidéo de 30 s prend 30 s) et au format **WebM** ; l'onglet doit rester visible pendant l'export.
- Les médias doivent être servis avec des en-têtes CORS pour que le canvas reste exportable : c'est le cas de Cloudinary, qui héberge toutes les ressources générées.
- La sortie de Claude est validée et bornée avant d'être jouée (`src/lib/motion/sanitize.ts`) : types de calques, couleurs, nombre de scènes/calques, URLs.

## Ajouter un fournisseur

- **Voix** : une entrée dans `src/lib/voice-providers.ts`.
- **Modèle vidéo** : une entrée dans `src/lib/video-models.ts` (le schéma d'entrée du modèle Replicate doit être respecté).

## 📜 Licence

Propriété de **Kelvix Digital Agency**. Tous droits réservés.
