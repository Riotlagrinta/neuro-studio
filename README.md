# 🎬 NeuroStudio — Motion design IA

**NeuroStudio** est un studio de motion design assisté par IA. Vous décrivez une vidéo ; **Claude Opus** la met en scène (titres animés, formes, transitions, narration), des **voix IA** la racontent, et des **modèles vidéo IA** peuvent générer des plans de fond pour chaque scène. Le résultat s'exporte en vidéo.

L'interface est celle d'un outil de montage façon CapCut : moniteur avec timecode et **manipulation directe** (déplacer, redimensionner, pivoter), **timeline interactive** (scènes, voix, médias, musique, calques et keyframes), couper / dupliquer / réordonner les scènes, texte, formes et **sous-titres animés**, **musique de fond** avec fondus et ducking, import de ses propres images et vidéos, annuler/rétablir, et un **export image par image plus rapide que la lecture** (MP4).

## Montage

Tout ce que Claude a généré se retouche à la main, comme dans un éditeur vidéo.

**Dans le moniteur** (lecture en pause) :

| Geste | Effet |
|---|---|
| Cliquer un élément de l'image | le sélectionne (le fond IA ne se prend pas au clic : il se sélectionne depuis la timeline) |
| Glisser l'élément | le déplace, avec **guides magnétiques** (centre, bords, marges de sécurité, tiers) ; `Alt` désactive l'aimant |
| Glisser un coin | redimensionne |
| Glisser la poignée ronde | pivote ; `Maj` aimante tous les 15° |
| `Échap` pendant un geste | l'annule |

Un geste sur une propriété **animée** écrit une keyframe à l'instant de la tête de lecture (comme le chronomètre d'After Effects) ; sur une propriété fixe, il change simplement la valeur.

**Sur la timeline :**

| Geste | Effet |
|---|---|
| Cliquer / glisser dans la règle | place la tête de lecture |
| Glisser le bloc d'une **scène** | la réordonne (au clavier : `Alt` + `←` / `→` sur le bloc) |
| Glisser le bord d'une scène | change sa durée (les scènes suivantes se décalent) |
| Cliquer une barre de calque | la sélectionne et ouvre l'**inspecteur de calque** |
| Glisser une barre / son bord / un losange ◆ | déplace le calque avec ses keyframes / rogne / décale une pose dans le temps |
| Curseur de zoom, `Ctrl/Cmd` + molette | zoome la timeline (1 à 8×) |

**Barre d'outils :**

- **Ajouter** : texte, forme, cercle, **sous-titres** (générés depuis la narration de la scène : karaoké, pop, boîte ou contour ; le minutage suit la longueur des mots, ce n'est pas un alignement mot à mot réel), et « Sous-titrer tout ».
- **Scène** : couper à la tête de lecture (la durée totale, les poses animées, la narration et le plan vidéo se poursuivent à l'identique de chaque côté de la coupe, 0,3 s minimum de chaque côté), dupliquer, supprimer, ajouter (60 scènes au plus).
- **Calque** : dupliquer, supprimer, ordre (premier plan / arrière-plan).
- **Inspecteur** : texte, police, couleur, effets d'apparition, début/fin, et un bloc **Transformation** (X, Y, échelle, rotation, opacité) qui écrit à la tête de lecture.

**Musique de fond** (panneau « Musique de fond ») : envoi d'un fichier audio (MP3, M4A, WAV, OGG, OPUS, AAC, FLAC ; 30 Mo), volume, fondu d'entrée et de sortie, et **ducking** (la musique baisse pendant la narration). Elle boucle jusqu'à la fin de la vidéo. **Import de médias** : « Importer une image » (JPG, PNG, WebP ; 10 Mo, réduite automatiquement si elle est trop grande) ou « Importer une vidéo » (MP4, MOV, WebM ; 100 Mo) sur chaque scène. Les envois vont directement du navigateur vers Cloudinary, avec une signature émise par le serveur (voir « Sécurité »).

Les déplacements s'alignent sur les images (1/30 s). **Un glissement entier = un seul pas d'annulation**, et la frappe dans un champ est regroupée. Les voix, images et vidéos générées ou importées ne sont **jamais** retirées par « Annuler ».

| Raccourci | Action |
|---|---|
| `Ctrl/Cmd + Z` · `Ctrl/Cmd + Maj + Z` (ou `Y`) | annuler · rétablir |
| `Espace` | lecture / pause |
| `←` `→` (avec `Maj`) | une image (une seconde) |
| `T` | ajouter un texte |
| `S` | couper la scène à la tête de lecture |
| `Ctrl/Cmd + D` | dupliquer le calque sélectionné, sinon la scène |
| `Suppr` · `Échap` | supprimer le calque sélectionné · désélectionner |

Les raccourcis sont ignorés pendant la saisie dans un champ. Le code d'édition est dans `src/lib/motion/` (`edit.ts`, `scenes.ts`, `layers.ts`, `manipulate.ts`, `captions.ts`, `audio-mix.ts` : opérations pures, testées) et `src/lib/history.ts` (annuler/rétablir).

## Comment ça marche

| Étape | Outil | Détail |
|---|---|---|
| Motion design | **Claude Opus 5.5** (API Anthropic) | Écrit une *spec de motion* JSON : calques (formes, texte, fond IA), keyframes, easings, transitions, narration. |
| Aperçu & export | Canvas 2D + WebCodecs (Mediabunny) | Le même moteur (`src/lib/motion/render.ts`) sert à l'aperçu, au scrub et à l'export. L'export encode image par image, plus vite que la lecture (voir « Export »). |
| Voix | **ElevenLabs** ou **OpenAI TTS** | Au choix dans l'interface. La durée de chaque scène s'ajuste sur la narration. |
| Plans vidéo IA | **Seedance 1.5 Pro**, **Wan 3**, **Kling 2.5 Turbo Pro**, **Veo 3.1 Lite**, **Grok Imagine** ou **Wan 2.2 Fast** (Replicate) | Un clic par scène, jamais automatique (ça coûte). Le prix de chaque niveau est affiché avant de dépenser. |
| Images de fond | Pollinations → Cloudinary | Gratuit. |
| Retouche | Claude Opus | « Plus dynamique, texte jaune, transition zoom… » sur une scène à la fois. |

La **démo** (bouton « Voir la démo ») fonctionne sans aucune clé ni compte.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Framer Motion · Neon (PostgreSQL) · Auth.js · Cloudinary · `@anthropic-ai/sdk` · Replicate · WebCodecs + Mediabunny (export)

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
CLOUDINARY_DYNAMIC_FOLDERS=      # optionnel : « true » si votre compte Cloudinary est en mode de dossiers dynamique (créé après juin 2024)

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

# --- Crédits prépayés (optionnel ; désactivés par défaut) ---
BILLING_ENABLED=true             # chaque action est facturée sur le solde de l'utilisateur (voir « Crédits prépayés »)
BILLING_MARKUP=1.5               # prix facturé = coût estimé x marge (>= 1, 1.5 par défaut)
SIGNUP_BONUS_USD=0               # crédits offerts une seule fois à chaque nouvel utilisateur (0 par défaut)
BILLING_TOPUP_INSTRUCTIONS="Envoyez le montant par Orange Money au ..., puis indiquez votre e-mail."   # affiché sur /credits

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

Collez le contenu de [`db/schema.sql`](db/schema.sql) dans l'éditeur SQL de la console Neon. Il est **idempotent** (on peut le rejouer) et il ajoute à votre table `projects` existante la colonne `user_id`, plus les tables `users` et `usage_events` et les fonctions `reserve_usage`, `reserve_charged`, `credit_user`, `refund_event`…

> **À rejouer après chaque mise à jour du dépôt.** Les fonctions `reserve_usage` et `reserve_charged` réservent les quotas de façon atomique : sans elle, toute action payante (génération, voix, image, vidéo, envoi) est refusée par sécurité. Elle remplace une requête qui laissait passer des appels simultanés au-delà des limites.

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
- **Quotas par utilisateur** (fenêtre glissante de 24 h) : 6 générations, 40 retouches, 60 voix, 80 images, 8 plans vidéo, 40 envois de fichiers, et un plafond de coût estimé (`DAILY_COST_CAP_USD`). L'action est réservée *avant* l'appel au fournisseur, **atomiquement** (verrou par utilisateur dans `reserve_usage`), et **remboursée** s'il échoue.
- **Envois de fichiers** : le navigateur n'envoie que `{type, taille}` ; le serveur décide de tout ce qui est signé (identifiant unique préfixé par l'utilisateur, formats autorisés, pas d'écrasement). Chaque identifiant émis est enregistré : un utilisateur ne peut vérifier que les siens, et le nombre de vérifications est plafonné. Les URL d'images transmises à Replicate doivent appartenir à **notre** compte Cloudinary.
- **Projets privés** : chaque projet appartient à un utilisateur ; celui d'un autre ressemble à un projet inexistant. Un plan vidéo ne peut être relevé que par celui qui l'a lancé.
- **En cas de doute, on refuse** : si la base est injoignable, aucun appel payant ne part.
- Auth.js v5 est encore en version **bêta** (version épinglée, `next-auth@5.0.0-beta.32`) et fait désormais partie de Better Auth. Sessions JWT, PKCE activé.
- Limites connues : les projets enregistrés acceptent n'importe quelle URL `https` pour leurs médias (ils sont privés, mais il faudra la restreindre à notre Cloudinary avant d'ajouter le partage) ; la taille d'un envoi n'est contrôlée qu'après coup (le plafond réel est celui de votre offre Cloudinary).

## Crédits prépayés

« Chaque utilisateur paie ce qu'il utilise » : avec `BILLING_ENABLED=true`, chaque action payante (génération, retouche, voix, plan vidéo) est **débitée du solde de l'utilisateur** avant d'être exécutée, et **rendue** si elle échoue.

- **1 crédit = 1 $ de prix facturé.** Le prix facturé est le coût estimé du fournisseur multiplié par `BILLING_MARKUP` (1,5 par défaut : la marge couvre les frais de paiement et les écarts d'estimation), arrondi *au-dessus* à 4 décimales. Le studio affiche ce prix avant chaque dépense ; le solde est dans l'en-tête, la page `/credits` donne l'historique.
- **Atomique.** Vérification des quotas, du solde et débit se font en un seul appel SQL (`reserve_charged`, verrou par utilisateur) : 100 requêtes simultanées contre un solde qui couvre 10 actions en acceptent exactement 10 et le solde ne passe jamais sous zéro (testé sur un vrai PostgreSQL avec `pgbench`, voir `tests/billing.test.ts`). Les limites quotidiennes et le plafond `DAILY_COST_CAP_USD` restent un second filet.
- **Grand livre en ajout seul** (`credit_ledger`) : on ne modifie ni ne supprime jamais une ligne, le solde est la somme. Un remboursement ou une recharge porte une référence unique : l'appliquer deux fois est sans effet.
- **Sans `BILLING_ENABLED`**, rien ne change : liste d'invités et plafonds quotidiens seulement, aucune écriture dans le grand livre.
- Avec la facturation, `OPEN_SIGNUP=true` devient raisonnable : un compte sans crédits ne peut rien dépenser (les actions gratuites, comme les images de fond, restent soumises aux quotas).

### Recharger un compte (pour l'instant à la main)

Il n'y a **pas encore de paiement en ligne** : l'utilisateur vous paie (Orange Money, MTN, Wave… selon votre pays), puis vous créditez son compte dans la console SQL Neon, avec l'identifiant de la transaction comme référence (ce qui empêche de créditer deux fois la même) :

```sql
SELECT credit_user((SELECT id FROM users WHERE email = 'client@exemple.com'), 5, 'topup', 'orange-TXN123');
-- Solde d'un utilisateur :
SELECT credit_balance((SELECT id FROM users WHERE email = 'client@exemple.com'));
```

`BILLING_TOPUP_INSTRUCTIONS` est le texte affiché sur la page `/credits` pour expliquer comment payer. Le paiement automatique (page de paiement du fournisseur, notification signée, crédit immédiat) est la prochaine étape : le grand livre est prêt à le recevoir (`credit_user` est la seule porte d'entrée de l'argent).

## Qualité et coûts

**Qualité vidéo IA**, au choix de l'utilisateur, avec le prix de chaque niveau affiché avant de dépenser (« Économique » est présélectionné). Les prix sont des **estimations** vérifiées sur les pages des modèles Replicate le 8 octobre 2026 ; elles servent aussi aux plafonds de coût.

| Moteur | Économique | Standard | Premium | Remarques |
|---|---|---|---|---|
| **Seedance 1.5 Pro** (par défaut) | 480p — 0,013 $/s | 720p — 0,026 $/s | **1080p** — 0,06 $/s | sans le son (qui doublerait le prix) ; 2 à 12 s |
| **Wan 3** | 480p — 0,05 $/s | 720p — 0,10 $/s | **1080p** — 0,20 $/s | qualité maximale, lent (≈ 5 min en 1080p) ; prix du pire cas, le tarif affiché par Replicate est actuellement moitié moindre |
| **Kling 2.5 Turbo Pro** | 0,07 $/s | idem | idem | clips de 5 ou 10 s, un seul niveau |
| **Veo 3.1 Lite** (Google) | 720p — 0,05 $/s | idem | **1080p** — 0,08 $/s | clips de 4, 6 ou 8 s ; le 1080p impose 8 s |
| **Grok Imagine** | 480p — 0,05 $/s | 720p — 0,05 $/s | idem | rapide (≈ 30 s), 720p maximum |
| **Wan 2.2 Fast** (image → vidéo) | 480p — 0,05 $ le clip | 720p — 0,11 $ | 720p à **30 images/s** — 0,145 $ | clip fixe ≈ 5 s ; image requise |

**Export** : HD 720p ou **Full HD 1080p**, 30 images/s (les titres et formes sont vectoriels : ils gagnent en netteté même si le plan vidéo reste en 480p).

- **MP4 (H.264 + AAC)** quand le navigateur sait encoder les deux (Chrome et Edge sur Windows/macOS, Safari 26) : lisible partout.
- **WebM (VP9 + Opus)** sinon (Firefox, Chrome sur Linux : pas d'encodeur AAC) : lisible sur le web.
- **Repli en temps réel** (enregistrement de l'onglet) si le navigateur ne sait pas encoder image par image ou si le fichier ne tiendrait pas en mémoire (256 Mo, soit environ 2 min 30 en 1080p) : l'onglet doit alors rester visible.
- Le format du fichier est indiqué d'après le résultat réel. Un export peut être annulé à tout moment.

Le code est dans `src/lib/motion/export-mp4.ts` (navigateur) et `export-plan.ts` (décisions pures, testées). Il s'appuie sur [Mediabunny](https://mediabunny.dev) (licence MPL-2.0, utilisée sans modification, chargée seulement au moment d'exporter).

## Coûts

L'application utilise l'**API** d'Anthropic (facturation à l'usage). Un abonnement personnel Claude (Pro/Max) ne peut pas servir à alimenter un produit proposé à d'autres : Anthropic n'autorise pas les développeurs tiers à proposer une connexion claude.ai ou ses limites dans leurs produits. Ordres de grandeur (tarifs publics à vérifier) :

| Poste | 1 min | 2 min |
|---|---|---|
| Claude Opus 5.5 (4 $ / 20 $ par million de tokens)¹ | ≈ 0,2 – 0,5 $ | ≈ 0,4 – 0,9 $ |
| Voix ElevenLabs (0,08 $ / 1 000 caractères) | ≈ 0,08 $ | ≈ 0,16 $ |
| Plans vidéo Seedance 1.5 Pro 480p / 720p / 1080p, toutes les scènes | ≈ 0,78 / 1,56 / 3,60 $ | ≈ 1,56 / 3,12 / 7,20 $ |
| Plans vidéo Kling 2.5, Grok ou Veo 720p, toutes les scènes | ≈ 3 – 4,20 $ | ≈ 6 – 8,40 $ |
| Plans vidéo Wan 3 480p / 720p / 1080p (pire cas), toutes les scènes | ≈ 3 / 6 / 12 $ | ≈ 6 / 12 / 24 $ |
| Plans vidéo Wan 2.2 Fast 720p (0,11 $ / clip), toutes les scènes | ≈ 1,32 $ | ≈ 2,64 $ |

¹ Estimation (~180 tokens de spec par seconde de vidéo, plus la réflexion). La vidéo IA représente la grande majorité de la facture, d'autant plus aux niveaux Standard et Premium. Les sous-titres, la musique, l'import de médias et l'export n'ont **aucun coût de génération** (le stockage et la bande passante Cloudinary comptent dans votre offre).

Pour réduire la facture : `MOTION_EFFORT` / `MOTION_MODEL` / `REFINE_*` (voir plus haut) et `VIDEO_DEFAULT_QUALITY`. Les retouches de scène passent par Sonnet 5.5 par défaut (la qualité de ce choix n'a pas été mesurée sur de vraies générations : à vérifier). Les estimations servant aux plafonds, et affichées dans l'interface, sont dans `src/lib/pricing.ts` et `src/lib/video-models.ts`.

## Limites connues et prochaines étapes

- **Paiement en ligne non encore branché.** Les crédits, le débit atomique et les remboursements sont en place ; la recharge se fait à la main (voir « Crédits prépayés »). Reste à brancher un fournisseur de paiement mobile money (page de paiement hébergée + notification signée) : il faut d'abord choisir le fournisseur et ouvrir un compte marchand chez lui.
- **Vidéos de plus de 60 s** : non supportées proprement (12 scènes max à la génération, `max_tokens` partagé avec la réflexion, 300 s par action serveur). Il faudra générer en deux temps (plan puis scènes).
- **Non vérifié sans clés ni navigateurs réels** : les appels réels à Anthropic, Cloudinary, ElevenLabs, OpenAI, Replicate et Google OAuth (vérifiés contre des simulations et les schémas publics), l'encodage H.264/AAC natif (testé avec Chrome 155 sous Linux, qui n'a pas d'encodeur AAC, et avec un polyfill), Safari et Firefox. À tester une fois sur Windows/macOS Chrome et Safari 26 avant de promettre le MP4 partout.
- **Les sous-titres suivent la longueur des mots**, pas un alignement réel de la voix : la synchronisation peut dériver de quelques centaines de millisecondes.
- **Tactile** : les gestes de montage utilisent les événements pointeur ; le réordonnancement des scènes au doigt n'est pas encore au point (utiliser `Alt` + flèches ou la souris). Sur iOS Safari, le volume de la musique ne se règle pas dans l'aperçu (il est correct à l'export).
- Les médias doivent être servis avec des en-têtes CORS pour que le canvas reste exportable : c'est le cas de Cloudinary, qui héberge toutes les ressources générées et importées.
- La sortie de Claude est validée et bornée avant d'être jouée (`src/lib/motion/sanitize.ts`) : types de calques, couleurs, nombre de scènes/calques/keyframes, URLs.

## Ajouter un fournisseur

- **Voix** : une entrée dans `src/lib/voice-providers.ts` (avec son tarif estimé).
- **Modèle vidéo** : une entrée dans `src/lib/video-models.ts` (le schéma d'entrée du modèle Replicate doit être respecté, avec son coût estimé).

## 📜 Licence

Propriété de **Kelvix Digital Agency**. Tous droits réservés.
