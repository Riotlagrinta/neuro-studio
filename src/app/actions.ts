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

      RÈGLES D'OR DE PRODUCTION POUR GOOGLE FLOW :
      1. LE CASTING (2 à 4 personnages clés de l'univers) :
         - Pour chaque personnage, définis une IDENTITÉ VISUELLE STRICTE (âge précis, taille exacte, silhouette, carnation/teint, coupe de cheveux/barbe ou traits particuliers, tenue vestimentaire complète méticuleusement décrite avec matières, couleurs et accessoires adaptés au genre).
         - "visualPrompt" : Prompt en anglais pour générer son portrait officiel de référence 8K (Ultra-realistic 8k studio character reference portrait, sharp facial details, matching genre lighting, photorealistic, neutral background).

      2. LES SCÈNES SÉQUENTIELLES (6 à 8 scènes de 8 secondes exactement) :
         - Chaque scène dure 8 secondes ("duration": 8).
         - "voiceOver" : Narration percutante en français, stylisée selon le genre (voix posée de narrateur, souffle court de suspense, dialogue intense ou ton humoristique), calibrée pour 8 secondes.
         - "visualPrompt" : DOIT OBLIGATOIREMENT commencer par la formule d'or de Google Flow :
           "Ultra-realistic cinematic video, 8 seconds. [Lieu et ambiance stylisée du genre]. [Description physique et vestimentaire intégrale répétée des personnages présents pour cohérence absolue]. [Action précise, micro-expressions réalistes, interactions naturelles - strictly no looking at camera]. [Arrière-plan dynamique et vivant]. [Mouvements de caméra cinématographiques : handheld tracking shot, drone shot, fast tracking, slow dolly-in, over-the-shoulder]. Cinematic lighting, shallow depth of field, 4K ultra detail, natural motion."
         - Continuité absolue : Les personnages gardent STRICTEMENT les mêmes vêtements, coiffures et accessoires d'une scène à l'autre.
         - La dernière scène offre un climax marquant, un cliffhanger palpitant ou une conclusion forte adaptée au genre.

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
 * Synthèse vocale de la voix-off via ElevenLabs
 */
export async function getElevenLabsAudio(text: string) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
    if (!apiKey) return { success: false, error: "CLÉ_ELEVEN_MANQUANTE" };

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/pNInz6OB85MvRmPLz5QN`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.5 },
      }),
    });

    if (!response.ok) return { success: false, error: `ELEVEN_HTTP_${response.status}` };

    const buffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(buffer).toString("base64");
    
    try {
      if (process.env.CLOUDINARY_CLOUD_NAME) {
        const uploadResponse = await cloudinary.uploader.upload(`data:audio/mpeg;base64,${base64Audio}`, {
          resource_type: "video",
          folder: "neuro-studio-audios",
        });
        return { success: true, url: uploadResponse.secure_url };
      }
    } catch {
      return { success: true, url: `data:audio/mpeg;base64,${base64Audio}` };
    }

    return { success: true, url: `data:audio/mpeg;base64,${base64Audio}` };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ECHEC_AUDIO";
    return { success: false, error: message };
  }
}

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
