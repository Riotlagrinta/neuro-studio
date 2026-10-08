// Error codes returned by the server actions → something a person can act on.

const MESSAGES: Record<string, string> = {
  CLÉ_ANTHROPIC_MANQUANTE: "Clé ANTHROPIC_API_KEY manquante : ajoutez-la dans les variables d'environnement.",
  CLÉ_ANTHROPIC_INVALIDE: "La clé ANTHROPIC_API_KEY est refusée par Anthropic.",
  ANTHROPIC_LIMITE_ATTEINTE: "Limite de débit Anthropic atteinte : réessayez dans un instant.",
  REFUS_IA: "Claude a décliné cette demande. Reformulez le sujet.",
  RÉPONSE_TROP_LONGUE: "L'animation demandée est trop longue : visez moins de scènes ou une durée plus courte.",
  RÉPONSE_INVALIDE: "Claude a renvoyé une animation inexploitable. Réessayez.",
  IA_VIDE: "Claude n'a rien renvoyé. Réessayez.",
  SUJET_TROP_COURT: "Décrivez un peu plus votre vidéo.",
  CLÉ_ELEVEN_MANQUANTE: "Clé ELEVENLABS_API_KEY manquante.",
  CLÉ_OPENAI_MANQUANTE: "Clé OPENAI_API_KEY manquante.",
  CLÉ_REPLICATE_MANQUANTE: "Clé REPLICATE_API_TOKEN manquante.",
  VOIX_INVALIDE: "Voix inconnue pour ce fournisseur.",
  NON_CONNECTÉ: "Connectez-vous pour utiliser cette fonction.",
  ACCÈS_REFUSÉ: "Votre compte n'a pas accès : l'accès est sur invitation.",
  QUOTA_ATTEINTE: "Limite atteinte sur les dernières 24 h (nombre d'actions ou budget). Réessayez plus tard.",
  SOLDE_INSUFFISANT: "Crédits insuffisants pour cette action. Rechargez votre compte pour continuer.",
  SERVICE_INDISPONIBLE: "Service momentanément indisponible : réessayez dans un instant. Cette tentative n'a pas été comptée.",
  PROJET_TROP_GROS: "Ce projet est trop volumineux pour être sauvegardé.",
  TROP_DE_PROJETS: "Vous avez atteint le nombre maximal de projets sauvegardés : supprimez-en avant d'en ajouter.",
  JOB_INVALIDE: "Ce plan vidéo n'existe pas ou ne vous appartient pas.",
  PROMPT_VIDE: "Le prompt de la scène est vide.",
  TEXTE_VIDE: "La narration de la scène est vide.",
  VIDEO_TIMEOUT: "La génération du plan vidéo prend trop de temps : réessayez.",
  IMAGE_REQUISE: "Ce moteur vidéo part d'une image : générez d'abord l'image de la scène.",
  ECHEC_IMAGE: "Échec de la génération d'image (Pollinations / Cloudinary).",
  ECHEC_INSERTION_NEON: "La sauvegarde a échoué.",
  PROJET_INTROUVABLE: "Projet introuvable.",
};

export function explain(code: string | undefined): string {
  if (!code) return "Erreur inconnue.";
  if (MESSAGES[code]) return MESSAGES[code];
  if (/^(ELEVEN|OPENAI)_HTTP_401$/.test(code)) return "Clé d'API refusée par le fournisseur de voix.";
  if (/^(ELEVEN|OPENAI)_HTTP_429$/.test(code)) return "Quota du fournisseur de voix atteint.";
  return code;
}
