"use server";

import { groq } from "@/lib/groq-client";
import { sql } from "@/lib/db";
import cloudinary from "@/lib/cloudinary";

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
  appearance: CharacterAppearance;
  visualPrompt: string; // Prompt ultra-détaillé en anglais pour générer le portrait officiel de référence (First Frame / Ingredient)
  imageUrl?: string;
}

export interface Scene {
  id: number;
  title: string;
  duration: number; // 8 secondes standard
  setting: string;
  charactersInvolved: string[];
  voiceOver: string; // Narration captivante en français adaptée au ton du genre
  visualPrompt: string; // Prompt vidéo cinématique ultra-réaliste 8s pour Google Flow / Gemini Omni Flash
  cameraStyle: string;
  emotion: string;
  imageUrl?: string;
  videoUrl?: string;
}

export interface ContentPlan {
  title: string;
  genre: string; // Ex: Sci-Fi, Action, Thriller, Drame, Comédie, Épopée, etc.
  tone: string; // Ex: Intense et haletant, Sombre et néon, Épique, Comique, etc.
  logline: string;
  synopsis: string;
  characters: Character[];
  scenes: Scene[];
}

export async function generateContent(
  topic: string, 
  genre: string = "Libre / Tous Genres", 
  format: "16:9" | "9:16" = "16:9"
) {
  try {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) return { success: false, error: "CLÉ_GROQ_MANQUANTE" };

    const systemPrompt = `
      Tu es NeuroDirector PRO, réalisateur et showrunner IA d'élite capable de diriger TOUS les genres cinématographiques :
      - Science-Fiction & Afrofuturisme (vaisseaux, cités cyberpunk, hologrammes, néons, technologies d'avant-garde)
      - Action & Thriller (courses-poursuites, filatures, braquages, combats tactiques, espionnage)
      - Drames Humains & Leçons de vie (destins croisés, ascensions, rivalités familiales, choix difficiles)
      - Mystère & Enquête (policier noir, énigmes, révélations, suspense psychologique)
      - Comédie & Satire (situations absurdes, quiproquos rythmés, comédie de moeurs)
      - Épopée Historique & Fantastique (guerriers, royaumes anciens, légendes, mythologie)
      - Documentaire & Biopic immersif (tech, business, grands créateurs).

      Tu adaptes la mise en scène, l'ambiance lumineuse et le cadrage au genre demandé : "${genre}".
      Le format de diffusion est : ${format === "16:9" ? "16:9 (Cinéma / YouTube)" : "9:16 (TikTok / Reels / Shorts)"}.

      RÈGLES D'OR DE PRODUCTION POUR GOOGLE FLOW (FORMAT 1M30 MAX) :
      1. LE CASTING (2 à 3 personnages clés de l'univers) :
         - Pour chaque personnage, définis une IDENTITÉ VISUELLE STRICTE (âge précis, taille exacte, silhouette, carnation/teint "dark black skin", coupe de cheveux/barbe ou traits particuliers, tenue vestimentaire complète méticuleusement décrite avec matières, couleurs et accessoires adaptés au genre).
         - "visualPrompt" : Prompt en anglais pour générer son portrait officiel de référence 8K (Ultra-realistic 8k studio character reference portrait, sharp facial details, matching genre lighting, photorealistic, neutral background).

      2. LES SCÈNES SÉQUENTIELLES POUR 1M30 (EXACTEMENT 11 À 12 SCÈNES DE 8 SECONDES = 88 À 96 SECONDES TOTAL) :
         - Tu DOIS IMPÉRATIVEMENT générer entre 11 et 12 scènes de 8 secondes chacune ("duration": 8). C'est la durée obligatoire pour atteindre 1 minute 30 au montage final.
         - Structure le film sur cette courbe dramatique complète de 1m30 :
           * Scènes 1 et 2 (00s - 16s) : L'ACCROCHE (The Hook) - Situation de tension, d'urgence ou d'injustice immédiate.
           * Scènes 3 à 5 (16s - 40s) : LA TENSION & L'OBSTACLE - Rejet, confrontation, escalade du problème.
           * Scènes 6 à 8 (40s - 64s) : L'ACTION DÉCISIVE & LE CHOIX - Sacrifice, courage, geste héroïque secret.
           * Scènes 9 et 10 (64s - 80s) : LE PLOT TWIST & LA RÉVÉLATION - Retournement de situation choc.
           * Scènes 11 et 12 (80s - 92s) : LE CLIMAX ÉMOTIONNEL & CONCLUSION - Réconciliation, reconnaissance, symbole fort.
         - Raccord de montage (Cut-on-action) : Chaque scène N+1 commence obligatoirement là où la scène N s'est arrêtée (continuité immédiate du mouvement).
         - "voiceOver" : Narration captivante en français, stylisée selon le genre, rythmée et synchronisée pour 8 secondes.
         - "visualPrompt" : DOIT OBLIGATOIREMENT commencer par la formule d'or de Google Flow :
           "Ultra-realistic cinematic video, 8 seconds. [Lieu et ambiance stylisée du genre]. [Description physique et vestimentaire intégrale répétée mot pour mot des personnages présents pour cohérence absolue]. [Action précise dans la continuité de la scène précédente, micro-expressions réalistes, interactions naturelles - strictly no looking at camera]. [Arrière-plan dynamique et vivant]. [Mouvements de caméra cinématographiques : handheld tracking shot, drone shot, fast tracking, slow dolly-in, over-the-shoulder]. Cinematic lighting, shallow depth of field, 4K ultra detail, natural motion."
         - Continuité absolue : Les personnages gardent STRICTEMENT les mêmes vêtements, coiffures et accessoires d'une scène à l'autre.

      Réponds UNIQUEMENT avec un objet JSON valide structuré comme ceci :
      {
        "title": "Titre percutant du film",
        "genre": "${genre}",
        "tone": "Tonalité (ex: Cyberpunk intense / Action effrénée / Drame poignant)",
        "logline": "Le pitch en 1 phrase forte",
        "synopsis": "Court résumé en 2-3 phrases de l'intrigue",
        "characters": [
          {
            "id": "char_1",
            "name": "Nom du personnage",
            "role": "Rôle dans l'intrigue",
            "age": 25,
            "appearance": {
              "height": "1m80",
              "build": "athletic build",
              "skinTone": "dark black skin",
              "hairBeard": "short fade, sharp line-up",
              "outfit": "fitted black cybernetic bomber jacket, dark cargo pants, tactical boots"
            },
            "visualPrompt": "Ultra-realistic 8k studio character portrait of a 25-year-old African man, dark black skin, 1m80 tall, athletic build, wearing a fitted black cybernetic bomber jacket, photorealistic, sharp focus, cinematic lighting, 8K."
          }
        ],
        "scenes": [
          {
            "id": 1,
            "title": "Titre de la scène",
            "duration": 8,
            "setting": "Description du décor",
            "charactersInvolved": ["char_1"],
            "voiceOver": "Narration en français...",
            "visualPrompt": "Ultra-realistic cinematic video, 8 seconds...",
            "cameraStyle": "Dynamic handheld tracking shot, shallow depth of field, 4K",
            "emotion": "Adrenaline and tension"
          }
        ]
      }
    `;

    const fallbackModels = [
      "openai/gpt-oss-120b",
      "qwen/qwen3.8-27b",
      "openai/gpt-oss-20b",
      "llama-3.3-70b-versatile",
      "llama-3.1-70b-versatile",
      "llama-3.1-8b-instant",
    ];

    let content: string | null = null;
    let lastError: Error | null = null;

    for (const model of fallbackModels) {
      try {
        const completion = await groq.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Sujet / Idée de film [Genre: ${genre}] : ${topic}` },
          ],
          model,
          temperature: 0.7,
          max_tokens: 8000,
          response_format: { type: "json_object" },
        });

        content = completion.choices[0]?.message?.content || null;
        if (content) {
          break;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`⚠️ Modèle Groq ${model} non disponible, basculement automatique...`);
      }
    }

    if (!content) {
      return { success: false, error: lastError?.message || "IA_VIDE" };
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const data = JSON.parse(jsonMatch ? jsonMatch[0] : content);

    return { success: true, data: JSON.parse(JSON.stringify(data)) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ECHEC_GEN";
    console.error("Erreur generateContent :", message);
    return { success: false, error: message };
  }
}

/**
 * Génération de l'image de référence officielle d'un personnage (1 par 1)
 */
export async function generateCharacterImage(prompt: string) {
  try {
    const cleanPrompt = prompt.replace(/\s+/g, " ").trim();
    const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt.slice(0, 500))}?nologo=true&width=1024&height=1024&seed=${Math.floor(Math.random() * 99999)}&model=flux`;
    
    try {
      if (process.env.CLOUDINARY_CLOUD_NAME) {
        const uploadResponse = await cloudinary.uploader.upload(fallbackUrl, {
          folder: "neuro-studio-characters",
        });
        return { success: true, url: uploadResponse.secure_url };
      }
    } catch {
      // repli gracieux
    }

    return { success: true, url: fallbackUrl };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ECHEC_IMAGE_PERSONNAGE";
    return { success: false, error: message };
  }
}

/**
 * Génération de l'image clé d'une scène (First Frame pour Google Flow)
 */
export async function generateImage(prompt: string, ratio: "16:9" | "9:16" = "16:9") {
  try {
    const width = ratio === "16:9" ? 1280 : 720;
    const height = ratio === "16:9" ? 720 : 1280;
    const cleanPrompt = prompt.replace(/\s+/g, " ").trim();

    const fallbackUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt.slice(0, 500))}?nologo=true&width=${width}&height=${height}&seed=${Math.floor(Math.random() * 99999)}&model=flux`;
    
    try {
      if (process.env.CLOUDINARY_CLOUD_NAME) {
        const uploadResponse = await cloudinary.uploader.upload(fallbackUrl, {
          folder: "neuro-studio-scenes",
        });
        return { success: true, url: uploadResponse.secure_url };
      }
    } catch {
      // repli gracieux
    }

    return { success: true, url: fallbackUrl };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ECHEC_IMAGE_SCENE";
    return { success: false, error: message };
  }
}

/**
 * Synthèse vocale IA : Moteur Edge TTS 100% Gratuit & Illimité (Voix Neuronales Françaises)
 * Supporte Henri (Homme, narrateur grave et épique) et Denise (Femme, captivante).
 * Repli sur ElevenLabs si configuré et demandé.
 */
export async function generateVoiceAudio(
  text: string, 
  voice: "fr-FR-HenriNeural" | "fr-FR-DeniseNeural" | "fr-FR-RemyMultilingualNeural" = "fr-FR-HenriNeural"
) {
  try {
    const cleanText = text.replace(/["«»]/g, "").trim();
    if (!cleanText) return { success: false, error: "TEXTE_VIDE" };

    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    
    const { audioStream } = tts.toStream(cleanText);
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      audioStream.on("end", () => resolve());
      audioStream.on("error", (err: Error) => reject(err));
    });

    const buffer = Buffer.concat(chunks);
    const base64Audio = buffer.toString("base64");
    const dataUri = `data:audio/mpeg;base64,${base64Audio}`;

    try {
      if (process.env.CLOUDINARY_CLOUD_NAME) {
        const uploadResponse = await cloudinary.uploader.upload(dataUri, {
          resource_type: "video",
          folder: "neuro-studio-audios",
        });
        return { success: true, url: uploadResponse.secure_url };
      }
    } catch {
      // repli sur le data URI autonome
    }

    return { success: true, url: dataUri };
  } catch (error: unknown) {
    console.error("Erreur Edge TTS :", error);
    // Repli ElevenLabs si la clé existe
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (apiKey) {
      try {
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/pNInz6OB85MvRmPLz5QN`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
          body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: { stability: 0.5, similarity_boost: 0.5 },
          }),
        });
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          const base64Audio = Buffer.from(buffer).toString("base64");
          return { success: true, url: `data:audio/mpeg;base64,${base64Audio}` };
        }
      } catch {
        // échec repli
      }
    }

    const message = error instanceof Error ? error.message : "ECHEC_VOIX_GRATUITE";
    return { success: false, error: message };
  }
}

// Rétrocompatibilité
export const getElevenLabsAudio = generateVoiceAudio;

export async function saveProject(topic: string, plan: ContentPlan) {
  try {
    const results = await sql`
      INSERT INTO projects (title, category, plan, topic)
      VALUES (${plan.title}, ${plan.genre || "Cinéma"}, ${JSON.stringify(plan)}, ${topic})
      RETURNING *
    `;

    if (!results || results.length === 0) return { success: false, error: "ECHEC_INSERTION_NEON" };
    return { success: true, data: JSON.parse(JSON.stringify(results[0])) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ECHEC_SAVE";
    return { success: false, error: message };
  }
}

export async function getProjects() {
  try {
    const results = await sql`SELECT * FROM projects ORDER BY created_at DESC`;
    return JSON.parse(JSON.stringify(results || []));
  } catch (error: unknown) {
    console.error("Erreur de récupération des projets :", error);
    return [];
  }
}

export async function getQuota() {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (!apiKey) return null;
    const response = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": apiKey } });
    const data = await response.json();
    return { remaining: data.character_limit - data.character_count, total: data.character_limit };
  } catch {
    return null;
  }
}
