# 🎬 NeuroStudio — Motion design IA

**NeuroStudio** est un studio de motion design assisté par IA. Vous décrivez une vidéo ; **Claude Opus** la met en scène (titres animés, formes, transitions, narration), des **voix IA** la racontent, et des **modèles vidéo IA** peuvent générer des plans de fond pour chaque scène. Le résultat s'exporte en vidéo.

L'interface est celle d'un outil de motion design : moniteur avec timecode, **timeline** (scènes, voix, médias, calques et keyframes), inspecteur de scène, zones de sécurité, lecture en boucle.

## Comment ça marche

| Étape | Outil | Détail |
|---|---|---|
| Motion design | **Claude Opus 5.5** (API Anthropic) | Écrit une *spec de motion* JSON : calques (formes, texte, fond IA), keyframes, easings, transitions, narration. |
| Aperçu & export | Canvas 2D + MediaRecorder | Le même moteur (`src/lib/motion/render.ts`) sert à l'aperçu, au scrub et à l'export WebM. |
| Voix | **ElevenLabs** ou **OpenAI TTS** | Au choix dans l'interface. La durée de chaque scène s'ajuste sur la narration. |
| Plans vidéo IA | **Seedance 1 Lite** ou **Wan 2.2 Fast** (Replicate) | Un clic par scène, jamais automatique (ça coûte). |
| Images de fond | Pollinations → Cloudinary | Gratuit. |
| Retouche | Claude Opus | « Plus dynamique, texte jaune, transition zoom… » sur une scène à la fois. |

La **démo** (bouton « Voir la démo ») fonctionne sans aucune clé ni compte.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Framer Motion · Neon (PostgreSQL) · Auth.js · Cloudinary · `@anthropic-ai/sdk` · Replicate

## Installation

```bash
npm install
npm run dev
```

### 1. Variables d'environnement (`.env.local`)

```env
# --- Génération ---
ANTHROPIC_API_KEY=...            # requis pour la génération par Claude (clé d'API, voir « Coûts »)
ELEVENLABS_API_KEY=...           # voix (au moins un des deux)
OPENAI_API_KEY=...
REPLICATE_API_TOKEN=...          # plans vidéo IA (optionnel)

# --- Médias générés (voix, images, vidéos) ---
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# --- Base de données ---
DATABASE_URL=postgres://...      # Neon

# --- Comptes (obligatoires pour générer) ---
AUTH_SECRET=...                  # openssl rand -base64 32
AUTH_GOOGLE_ID=...               # voir « Connexion Google »
AUTH_GOOGLE_SECRET=...
AUTH_TRUST_HOST=true             # hors Vercel uniquement
ALLOWED_EMAILS=moi@exemple.com,collegue@exemple.com   # qui a le droit de générer (voir « Accès »)

# --- Limites (optionnel) ---
MAX_VIDEO_SECONDS=60             # durée max d'une vidéo (10–120)
DAILY_COST_CAP_USD=3             # dépense max estimée par utilisateur sur 24 h

# --- Coût / qualité (optionnel, valeurs par défaut ci-dessous) ---
MOTION_MODEL=claude-opus-5-5     # mise en scène d'une vidéo entière (aussi : claude-opus-5, claude-sonnet-5-5)
MOTION_EFFORT=high               # low | medium | high | xhigh | max
REFINE_MODEL=claude-sonnet-5-5   # retouche d'une scène : moitié moins cher qu'Opus
REFINE_EFFORT=medium
VIDEO_DEFAULT_QUALITY=eco        # qualité vidéo IA présélectionnée : eco | standard | premium
```

Une valeur de modèle ou d'effort non reconnue est ignorée (avertissement dans les logs) et le défaut s'applique.

Chaque fonctionnalité est désactivée proprement si sa clé manque (l'interface l'indique).

### 2. Base de données

Collez le contenu de [`db/schema.sql`](db/schema.sql) dans l'éditeur SQL de la console Neon. Il est **idempotent** (on peut le rejouer) et il ajoute à votre table `projects` existante la colonne `user_id`, plus les tables `users` et `usage_events`.

> Les projets créés **avant** les comptes n'ont pas de propriétaire : **personne ne les voit** tant qu'on ne les attribue pas. Pour vous les attribuer (après vous être connecté une première fois) :
> ```sql
> UPDATE projects SET user_id = (SELECT id FROM users WHERE email = 'moi@exemple.com') WHERE user_id IS NULL;
> ```

### 3. Connexion Google

Console Google Cloud → *API et services* → *Identifiants* → *ID client OAuth* (application Web). Ajoutez l'URI de redirection :
`https://VOTRE-DOMAINE/api/auth/callback/google` (et `http://localhost:3000/api/auth/callback/google` en local). Reportez l'ID et le secret dans `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`.

## Sécurité et accès

- **Rien de payant ne s'exécute sans compte.** Chaque action serveur vérifie la session avant tout appel à Anthropic, ElevenLabs, OpenAI, Replicate ou Cloudinary (`src/lib/access.ts`). Les fonctions exportées d'un fichier `"use server"` sont des points d'accès publics : elles se protègent donc elles-mêmes.
- **Accès sur invitation, fermé par défaut.** Sans `ALLOWED_EMAILS`, personne ne peut générer. `OPEN_SIGNUP=true` ouvre l'inscription à tout compte Google vérifié : à ne faire que lorsque la facturation existe. Retirer une adresse prend effet immédiatement, même si la session est encore valide.
- **Quotas par utilisateur** (fenêtre glissante de 24 h) : 6 générations, 40 retouches, 60 voix, 80 images, 8 plans vidéo, et un plafond de coût estimé (`DAILY_COST_CAP_USD`). L'action est réservée *avant* l'appel au fournisseur et **remboursée** s'il échoue.
- **Projets privés** : chaque projet appartient à un utilisateur ; celui d'un autre ressemble à un projet inexistant. Un plan vidéo ne peut être relevé que par celui qui l'a lancé.
- **En cas de doute, on refuse** : si la base est injoignable, aucun appel payant ne part.
- Auth.js v5 est encore en version **bêta** (version épinglée, `next-auth@5.0.0-beta.32`) et fait désormais partie de Better Auth. Sessions JWT, PKCE activé.
- Limite connue : deux requêtes strictement simultanées peuvent dépasser un quota d'une unité. Pour les crédits prépayés, le débit devra être atomique.

## Qualité et coûts

**Qualité vidéo IA**, au choix de l'utilisateur, avec le prix de chaque niveau affiché avant de dépenser (« Économique » est présélectionné) :

| Niveau | Seedance 1 Lite | Wan 2.2 Fast |
|---|---|---|
| Économique | 480p — 0,018 $/s | 480p — 0,05 $ le clip |
| Standard | 720p — 0,036 $/s | 720p — 0,11 $ |
| Premium | **1080p** — 0,072 $/s | 720p à **30 images/s** — 0,145 $ |

**Qualité d'export** : HD 720p ou **Full HD 1080p** (les titres et formes sont vectoriels : ils gagnent en netteté même si le plan vidéo reste en 480p). L'export se fait en temps réel dans le navigateur, en WebM.

## Coûts

L'application utilise l'**API** d'Anthropic (facturation à l'usage). Un abonnement personnel Claude (Pro/Max) ne peut pas servir à alimenter un produit proposé à d'autres : Anthropic n'autorise pas les développeurs tiers à proposer une connexion claude.ai ou ses limites dans leurs produits. Ordres de grandeur (tarifs publics à vérifier) :

| Poste | 1 min | 2 min |
|---|---|---|
| Claude Opus 5.5 (4 $ / 20 $ par million de tokens)¹ | ≈ 0,2 – 0,5 $ | ≈ 0,4 – 0,9 $ |
| Voix ElevenLabs (0,08 $ / 1 000 caractères) | ≈ 0,08 $ | ≈ 0,16 $ |
| Plans vidéo Seedance 480p, toutes les scènes | ≈ 1,08 $ | ≈ 2,16 $ |
| Plans vidéo Seedance 720p, toutes les scènes | ≈ 2,16 $ | ≈ 4,32 $ |
| Plans vidéo Seedance 1080p, toutes les scènes | ≈ 4,32 $ | ≈ 8,64 $ |
| Plans vidéo Wan 720p (0,11 $ / clip), toutes les scènes | ≈ 1,32 $ | ≈ 2,64 $ |

¹ Estimation (~180 tokens de spec par seconde de vidéo, plus la réflexion). La vidéo IA représente la grande majorité de la facture, d'autant plus aux niveaux Standard et Premium.

Pour réduire la facture : `MOTION_EFFORT` / `MOTION_MODEL` / `REFINE_*` (voir plus haut) et `VIDEO_DEFAULT_QUALITY`. Les retouches de scène passent par Sonnet 5.5 par défaut (la qualité de ce choix n'a pas été mesurée sur de vraies générations : à vérifier). Les estimations servant aux plafonds, et affichées dans l'interface, sont dans `src/lib/pricing.ts` et `src/lib/video-models.ts`.

## Limites connues et prochaines étapes

- **Pas encore de paiement.** Prévu : crédits prépayés (mobile money), débit atomique avant chaque action, remboursement en cas d'échec. `usage_events` est la base de ce journal.
- **Vidéos de plus de 60 s** : non supportées proprement (12 scènes max, `max_tokens` partagé avec la réflexion, 300 s par action serveur). Il faudra générer en deux temps (plan puis scènes).
- **L'export est enregistré en temps réel** (une vidéo de 30 s prend 30 s) et au format **WebM** ; l'onglet doit rester visible pendant l'export.
- Les médias doivent être servis avec des en-têtes CORS pour que le canvas reste exportable : c'est le cas de Cloudinary, qui héberge toutes les ressources générées.
- La sortie de Claude est validée et bornée avant d'être jouée (`src/lib/motion/sanitize.ts`) : types de calques, couleurs, nombre de scènes/calques, URLs.

## Ajouter un fournisseur

- **Voix** : une entrée dans `src/lib/voice-providers.ts` (avec son tarif estimé).
- **Modèle vidéo** : une entrée dans `src/lib/video-models.ts` (le schéma d'entrée du modèle Replicate doit être respecté, avec son coût estimé).

## 📜 Licence

Propriété de **Kelvix Digital Agency**. Tous droits réservés.
