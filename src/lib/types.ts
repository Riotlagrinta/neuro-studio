export interface VoiceOption {
  id: string;
  name: string;
  gender: string;
  tag: string;
}

export const AVAILABLE_VOICES: VoiceOption[] = [
  // Hommes
  { id: "fr-FR-HenriNeural", name: "Henri (France)", gender: "Homme", tag: "Grave / Mature / Narrateur / Autorité" },
  { id: "fr-FR-RemyMultilingualNeural", name: "Rémy (France)", gender: "Homme", tag: "Jeune / Dynamique / Héros / Stagiaire" },
  { id: "fr-BE-GerardNeural", name: "Gérard (Belgique)", gender: "Homme", tag: "Posé / Chaleureux / Directeur" },
  { id: "fr-CA-AntoineNeural", name: "Antoine (Canada)", gender: "Homme", tag: "Naturel / Moderne / Décontracté" },
  { id: "fr-CA-JeanNeural", name: "Jean (Canada)", gender: "Homme", tag: "Profond / Sérieux / Dramatique" },
  { id: "fr-CH-FabriceNeural", name: "Fabrice (Suisse)", gender: "Homme", tag: "Distingué / Précis / Policier" },

  // Femmes
  { id: "fr-FR-DeniseNeural", name: "Denise (France)", gender: "Femme", tag: "Affirmée / Directrice / Élégante" },
  { id: "fr-FR-EloiseNeural", name: "Éloïse (France)", gender: "Femme", tag: "Douce / Jeune / Émotive / Soignante" },
  { id: "fr-FR-VivienneMultilingualNeural", name: "Vivienne (France)", gender: "Femme", tag: "Expressive / Action / Tension / Narratrice" },
  { id: "fr-BE-CharlineNeural", name: "Charline (Belgique)", gender: "Femme", tag: "Lumineuse / Pétillante / Espiègle" },
  { id: "fr-CA-SylvieNeural", name: "Sylvie (Canada)", gender: "Femme", tag: "Maternelle / Chaleureuse / Réconfortante" },
  { id: "fr-CH-ArianeNeural", name: "Ariane (Suisse)", gender: "Femme", tag: "Calme / Réfléchie / Scientifique" },
];

export interface CharacterAppearance {
  height: string;
  build: string;
  skinTone: string;
  hairBeard: string;
  outfit: string;
}

export interface Character {
  id: string;
  name: string;
  role: string;
  age: number;
  voiceId: string;
  appearance: CharacterAppearance;
  visualPrompt: string;
  imageUrl?: string;
}

export interface DialogueLine {
  speaker: string;
  characterId?: string;
  text: string;
}

export interface Scene {
  id: number;
  title: string;
  duration: number;
  setting: string;
  charactersInvolved: string[];
  voiceOver: string;
  dialogues?: DialogueLine[];
  visualPrompt: string;
  cameraStyle: string;
  emotion: string;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
}

export interface ContentPlan {
  title: string;
  genre: string;
  tone: string;
  logline: string;
  synopsis: string;
  characters: Character[];
  scenes: Scene[];
}
