"use server";

import { groq } from "@/lib/groq-client";
import { sql } from "@/lib/db";

import type {
  Character,
  DialogueLine,
  Scene,
  ContentPlan
} from "@/lib/types";

export async function generateContent(
  topic: string, 
  genre: string = "Libre / Tous Genres", 
  format: "16:9" | "9:16" = "16:9",
  userOpenAiKey?: string
) {
  try {
    const hasGroqKey = Boolean(process.env.GROQ_API_KEY?.trim());
    if (!hasGroqKey && !userOpenAiKey?.trim()) {
      return { success: false, error: "CLÉ_MANQUANTE : Fournissez une clé ChatGPT dans Paramètres ou configurez GROQ_API_KEY." };
    }

    const systemPrompt = `
      Tu es NeuroDirector PRO, réalisateur et showrunner IA d'élite capable de diriger TOUS les genres cinématographiques :
      - Science-Fiction & Afrofuturisme (cyberpunk, vaisseaux, néons, technologies d'avant-garde)
      - Action & Thriller (poursuites, espionnage, combats tactiques, braquages)
      - Drames Humains & Moraux (leçons de vie, rivalités, destins croisés, épreuves)
      - Mystère & Enquête (policier noir, suspense psychologique, secrets)
      - Comédie & Satire (quiproquos, dialogues mordants, situations absurdes)
      - Épopée & Légende (royaumes anciens, guerriers, mythologie).

      Tu adaptes la mise en scène, l'ambiance lumineuse et le cadrage au genre demandé : "${genre}".
      Le format de diffusion est : ${format === "16:9" ? "16:9 (Cinéma / YouTube)" : "9:16 (TikTok / Reels / Shorts)"}.

      RÈGLES D'OR DE PRODUCTION POUR GOOGLE FLOW (FORMAT 1M30 MAX) :
      1. LE CASTING VOCAL & VISUEL (2 à 3 personnages clés) :
         - Pour chaque personnage, définis une IDENTITÉ VISUELLE STRICTE (âge précis, taille exacte, silhouette, carnation/teint "dark black skin", coupe de cheveux/barbe, tenue vestimentaire complète méticuleusement décrite de la tête aux pieds).
         - ATTRIBUTION VOCALE OBLIGATOIRE ET DIVERSIFIÉE : Choisis IMPÉRATIVEMENT une voix DISTINCTE et PARFAITEMENT ADAPTÉE pour chaque personnage parmi le catalogue :
           * "fr-FR-HenriNeural" : Homme mature, grave, vieux sage, narrateur, directeur
           * "fr-FR-RemyMultilingualNeural" : Homme jeune, dynamique, héros, stagiaire, livreur
           * "fr-BE-GerardNeural" : Homme posé, autoritaire, sage
           * "fr-CA-AntoineNeural" : Homme jeune adulte, naturel, décontracté
           * "fr-CA-JeanNeural" : Homme profond, dramatique, sérieux
           * "fr-CH-FabriceNeural" : Homme distingué, policier, scientifique
           * "fr-FR-DeniseNeural" : Femme adulte, affirmée, directrice, cadre
           * "fr-FR-EloiseNeural" : Jeune femme, fille, soignante, voix douce ou émue
           * "fr-FR-VivienneMultilingualNeural" : Femme d'action, expressive, tendue
           * "fr-BE-CharlineNeural" : Femme vive, pétillante, jeune
           * "fr-CA-SylvieNeural" : Femme mature, maternelle, chaleureuse
           * "fr-CH-ArianeNeural" : Femme calme, posée, docteure
         ⚠️ RÈGLE ABSOLUE : Attribue TOUJOURS une voix différente à chaque personnage présent pour que l'auditeur distingue immédiatement qui parle !
         - "visualPrompt" : Prompt en anglais pour générer son portrait officiel de référence 8K (First Frame / Ingredient Flow).

      2. LES SCÈNES SÉQUENTIELLES POUR 1M30 (EXACTEMENT 11 À 12 SCÈNES DE 8 SECONDES = ~1M30 TOTAL) :
         - Tu DOIS IMPÉRATIVEMENT générer entre 11 et 12 scènes de 8 secondes ("duration": 8).
         - VRAIS DIALOGUES & RÉPLIQUES :
           * Les personnages DOIVENT SE PARLER ! Si deux personnages sont présents, inclus des dialogues vifs et naturels.
           * "dialogues" : Tableau de répliques identifiées par personnage (1 à 3 répliques par scène de 8s).
             Exemple :
             [
               { "speaker": "Kofi", "characterId": "char_1", "text": "Monsieur, laissez-moi régler vos frais d'urgence." },
               { "speaker": "Le Vieil Homme", "characterId": "char_2", "text": "Mon fils, je n'oublierai jamais ton geste..." }
             ]
           * "voiceOver" : La version continue du dialogue ou de la narration pour la scène.
         - Structure le film en 5 actes continus :
           * Scènes 1-2 (00s-16s) : L'Accroche / The Hook (urgence, problème, dialogue d'ouverture)
           * Scènes 3-5 (16s-40s) : L'Escalade & La Tension (affrontement, refus, dilemme)
           * Scènes 6-8 (40s-64s) : L'Action Décisive & Le Sacrifice (acte de courage, secret)
           * Scènes 9-10 (64s-80s) : Le Plot Twist & Révélation (identité découverte, choc)
           * Scènes 11-12 (80s-92s) : Le Climax Émotionnel & Résolution (clôture forte, émotion)
         - Raccord de montage (Cut-on-action) : La scène N+1 commence exactement là où la scène N s'est achevée.
         - "visualPrompt" : DOIT OBLIGATOIREMENT commencer par :
           "Ultra-realistic cinematic video, 8 seconds. [Lieu et ambiance]. [Description physique et vestimentaire intégrale répétée des personnages présents]. [Action précise dans la continuité de la scène précédente, micro-expressions réalistes des dialogues, aucun regard caméra]. [Arrière-plan actif et naturel]. [Mouvements de caméra : tracking shot, medium shot, over-the-shoulder]. Cinematic lighting, shallow depth of field, 4K ultra detail, natural motion."

      Réponds UNIQUEMENT avec un objet JSON valide structuré comme ceci :
      {
        "title": "Titre du film",
        "genre": "${genre}",
        "tone": "Tonalité (ex: Intense / Épique / Touchant)",
        "logline": "Le pitch en 1 phrase forte",
        "synopsis": "Résumé en 2-3 phrases",
        "characters": [
          {
            "id": "char_1",
            "name": "Kofi",
            "role": "Jeune stagiaire dévoué",
            "age": 22,
            "voiceId": "fr-FR-RemyMultilingualNeural",
            "appearance": {
              "height": "1m75",
              "build": "slim-athletic build",
              "skinTone": "dark black skin",
              "hairBeard": "short neatly trimmed black hair, clean-shaven",
              "outfit": "light-blue long-sleeve shirt, black tie, black trousers, black shoes"
            },
            "visualPrompt": "Ultra-realistic 8k studio character portrait of a 22-year-old African man, dark black skin, 1m75 tall, athletic build, wearing a light-blue long-sleeve shirt, black tie, black trousers, photorealistic, sharp focus, cinematic lighting, 8K."
          }
        ],
        "scenes": [
          {
            "id": 1,
            "title": "Titre de la scène",
            "duration": 8,
            "setting": "Inside a modern luxury bank",
            "charactersInvolved": ["char_1"],
            "dialogues": [
              { "speaker": "Kofi", "characterId": "char_1", "text": "Bonjour monsieur, puis-je faire quelque chose pour vous aider ?" }
            ],
            "voiceOver": "Kofi : Bonjour monsieur, puis-je faire quelque chose pour vous aider ?",
            "visualPrompt": "Ultra-realistic cinematic video, 8 seconds...",
            "cameraStyle": "Medium shot with slow push-in, shallow depth of field, 4K",
            "emotion": "Concern and empathy"
          }
        ]
      }
    `;

    const fallbackModels = [
      "openai/gpt-oss-120b",
      "qwen/qwen3.8-27b",
      "openai/gpt-oss-20b",
    ];

    let content: string | null = null;
    let lastError: Error | null = null;

    if (userOpenAiKey?.trim()) {
      try {
        const openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${userOpenAiKey.trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Sujet / Idée de film [Genre: ${genre}] : ${topic}` },
            ],
            response_format: { type: "json_object" },
          }),
        });

        const openAiData = await openAiRes.json();
        if (!openAiRes.ok) {
          throw new Error(openAiData.error?.message || "Erreur API ChatGPT (OpenAI)");
        }
        content = openAiData.choices[0]?.message?.content || null;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn("⚠️ Échec ChatGPT, basculement vers Groq...", lastError.message);
      }
    }

    if (!content) {
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
 * Synthèse audio multi-voix pour une scène :
 * Fait parler chaque personnage avec sa propre voix neuronale attribuée et fusionne le dialogue.
 */
export async function generateSceneAudio(
  scene: { voiceOver: string; dialogues?: DialogueLine[] },
  characters: Character[] = [],
  defaultVoice: string = "fr-FR-HenriNeural"
) {
  try {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");

    const getVoiceForSpeaker = (speakerName: string, charId?: string): string => {
      if (charId) {
        const found = characters.find((c) => c.id === charId);
        if (found?.voiceId) return found.voiceId;
      }
      const foundByName = characters.find(
        (c) => c.name.toLowerCase().includes(speakerName.toLowerCase()) || speakerName.toLowerCase().includes(c.name.toLowerCase())
      );
      if (foundByName?.voiceId) return foundByName.voiceId;
      return defaultVoice;
    };

    // Cas 1 : La scène comporte des répliques découpées
    if (scene.dialogues && scene.dialogues.length > 0) {
      const audioBuffers: Buffer[] = [];

      for (const line of scene.dialogues) {
        const text = line.text.replace(/["«»]/g, "").trim();
        if (!text) continue;

        if (audioBuffers.length > 0) {
          await new Promise((r) => setTimeout(r, 150));
        }

        const voiceToUse = getVoiceForSpeaker(line.speaker, line.characterId);
        const tts = new MsEdgeTTS();
        await tts.setMetadata(voiceToUse, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

        const { audioStream } = tts.toStream(text);
        const chunks: Buffer[] = [];

        await new Promise<void>((resolve, reject) => {
          audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
          audioStream.on("end", () => resolve());
          audioStream.on("error", (err: Error) => reject(err));
        });

        if (chunks.length > 0) {
          audioBuffers.push(Buffer.concat(chunks));
        }
      }

      if (audioBuffers.length > 0) {
        const mergedBuffer = Buffer.concat(audioBuffers);
        const base64Audio = mergedBuffer.toString("base64");
        const dataUri = `data:audio/mpeg;base64,${base64Audio}`;
        return { success: true, url: dataUri };
      }
    }

    // Cas 2 : Repli sur le texte brut de voiceOver
    return generateVoiceAudio(scene.voiceOver, defaultVoice);
  } catch (error: unknown) {
    console.error("Erreur génération dialogue multi-voix :", error);
    const message = error instanceof Error ? error.message : "ECHEC_AUDIO_SCENE";
    return { success: false, error: message };
  }
}

/**
 * Synthèse vocale unitaire (pour un seul texte avec une voix précise)
 */
export async function generateVoiceAudio(
  text: string, 
  voice: string = "fr-FR-HenriNeural"
) {
  try {
    const cleanText = text.replace(/["«»]/g, "").trim();
    if (!cleanText) return { success: false, error: "TEXTE_VIDE" };

    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
    const tts = new MsEdgeTTS({ connectionTimeoutMs: 3000 });
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

    return { success: true, url: dataUri };
  } catch (error: unknown) {
    console.error("Erreur Edge TTS :", error);
    const message = error instanceof Error ? error.message : "ECHEC_VOIX_GRATUITE";
    return { success: false, error: message };
  }
}

// Rétrocompatibilité
export async function getElevenLabsAudio(text: string, voice?: string) {
  return generateVoiceAudio(text, voice);
}

/**
 * Mode Studio Flow : La génération directe de photos et vidéos est déportée
 * vers Google Flow / Midjourney via les prompts optimisés générés par l'IA.
 */
export async function generateCharacterImage(prompt: string) {
  return { 
    success: false, 
    error: "MODE_PROMPT_FLOW : Copiez le prompt portrait et collez-le dans Google Flow ou Midjourney.",
    prompt 
  };
}

export async function generateImage(prompt: string, ratio: "16:9" | "9:16" = "16:9") {
  return { 
    success: false, 
    error: "MODE_PROMPT_FLOW : Copiez le prompt vidéo et collez-le dans Google Flow ou Sora.",
    prompt,
    ratio 
  };
}

/**
 * Réécrit et affine une scène spécifique avec l'IA selon une consigne du réalisateur.
 * Supporte Groq (par défaut) et ChatGPT (si clé OpenAI fournie).
 */
export async function refineScene(
  scene: Scene,
  instruction: string,
  planContext: { title: string; genre: string },
  userOpenAiKey?: string
) {
  try {
    const prompt = `
      Tu es NeuroDirector PRO, réalisateur et showrunner IA d'élite.
      Tu dois modifier et réécrire la scène n°${scene.id} du film "${planContext.title}" (${planContext.genre}) selon cette instruction précise :
      "${instruction}"

      Voici la scène actuelle à modifier :
      ${JSON.stringify(scene, null, 2)}

      Règles strictes :
      1. Durée impérative : 8 secondes ("duration": 8).
      2. Conserve les identifiants de personnages existants.
      3. Réadapte les dialogues, l'émotion, le décor ("setting"), le style de caméra et le prompt visuel 8K "visualPrompt" pour Google Flow.
      4. Réponds UNIQUEMENT avec un objet JSON valide contenant les champs de la scène modifiée :
      {
        "id": ${scene.id},
        "title": "Titre mis à jour",
        "duration": 8,
        "setting": "Description du lieu",
        "charactersInvolved": ${JSON.stringify(scene.charactersInvolved || [])},
        "dialogues": [
          { "speaker": "Nom", "characterId": "char_id", "text": "Réplique..." }
        ],
        "voiceOver": "Texte voiceover",
        "visualPrompt": "Ultra-realistic cinematic video, 8 seconds...",
        "cameraStyle": "Cadrage et mouvement",
        "emotion": "Ambiance et émotion"
      }
    `;

    let content: string | null = null;

    if (userOpenAiKey?.trim()) {
      const openAiRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${userOpenAiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        }),
      });

      const openAiData = await openAiRes.json();
      if (!openAiRes.ok) {
        throw new Error(openAiData.error?.message || "Erreur API ChatGPT");
      }
      content = openAiData.choices[0]?.message?.content || null;
    } else {
      const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "openai/gpt-oss-120b",
        temperature: 0.7,
        response_format: { type: "json_object" },
      });
      content = completion.choices[0]?.message?.content || null;
    }

    if (!content) {
      return { success: false, error: "L'IA n'a retourné aucune modification." };
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const updated = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    return { success: true, scene: { ...scene, ...updated, id: scene.id } };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erreur de retouche de scène";
    return { success: false, error: msg };
  }
}

/**
 * Synthèse vocale HD directe via ElevenLabs (avec clé utilisateur BYOK ou serveur)
 */
export async function generateElevenLabsAudioWithKey(
  text: string,
  voiceId: string = "pNInz6OB85MvRmPLz5QN",
  userApiKey?: string
) {
  try {
    const key = userApiKey?.trim() || process.env.ELEVENLABS_API_KEY?.trim();
    if (!key) {
      return { success: false, error: "CLÉ_ELEVENLABS_MANQUANTE : Ajoutez votre clé dans les Paramètres." };
    }

    const cleanText = text.replace(/["«»]/g, "").trim();
    if (!cleanText) return { success: false, error: "TEXTE_VIDE" };

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": key,
      },
      body: JSON.stringify({
        text: cleanText,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail?.message || "Erreur de génération vocale ElevenLabs");
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Audio = buffer.toString("base64");
    return { success: true, url: `data:audio/mpeg;base64,${base64Audio}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erreur ElevenLabs";
    return { success: false, error: msg };
  }
}

/**
 * Génération directe de portraits 8K via Nano Banana (Google Gemini Imagen API)
 */
export async function generateNanoBananaImageWithKey(
  prompt: string,
  userApiKey?: string
) {
  try {
    const key = userApiKey?.trim();
    if (!key) {
      return { success: false, error: "CLÉ_NANO_BANANA_MANQUANTE : Renseignez votre clé Google AI Studio dans Paramètres." };
    }

    const cleanPrompt = prompt.replace(/\s+/g, " ").trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: cleanPrompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: "1:1",
          outputMimeType: "image/jpeg",
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || "Erreur de génération Nano Banana / Imagen");
    }

    const base64Bytes = data.predictions?.[0]?.bytesBase64Encoded;
    if (!base64Bytes) {
      throw new Error("Aucune image retournée par l'API Nano Banana.");
    }

    return { success: true, url: `data:image/jpeg;base64,${base64Bytes}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erreur Nano Banana";
    return { success: false, error: msg };
  }
}

/**
 * Génération vidéo directe via xAI Grok Imagine Video API
 */
export async function generateGrokVideoWithKey(
  prompt: string,
  userApiKey?: string,
  ratio: "16:9" | "9:16" = "16:9"
) {
  try {
    const key = userApiKey?.trim();
    if (!key) {
      return { success: false, error: "CLÉ_GROK_MANQUANTE : Renseignez votre clé xAI Grok dans Paramètres." };
    }

    const cleanPrompt = prompt.replace(/\s+/g, " ").trim();

    const response = await fetch("https://api.x.ai/v1/videos/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-imagine-video-1.5",
        prompt: cleanPrompt,
        aspect_ratio: ratio,
        duration: 8,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || "Erreur API xAI Grok Imagine Video");
    }

    const videoUrl = data.video_url || data.url || data.output?.[0];
    if (!videoUrl) {
      return { success: false, error: "Le rendu Grok Video a démarré mais le lien direct est encore en calcul." };
    }

    return { success: true, url: videoUrl };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erreur Grok Video";
    return { success: false, error: msg };
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

export async function deleteProject(id: number) {
  try {
    await sql`DELETE FROM projects WHERE id = ${id}`;
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ECHEC_DELETE";
    return { success: false, error: message };
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
