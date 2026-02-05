"use server";

import { groq } from "@/lib/groq-client";
import { supabase } from "@/lib/supabase";
import cloudinary from "@/lib/cloudinary";

export interface Scene {
  id: number;
  voiceOver: string;
  visualPrompt: string; // Pour Pollinations.ai
  videoKeywords: string; // Pour recherche Pexels
  duration: number; // En secondes
}

export interface ContentPlan {
  title: string;
  category: string;
  scenes: Scene[];
}

export async function generateContent(topic: string): Promise<ContentPlan> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("Clé API Groq manquante");
  }

  const systemPrompt = `
    Tu es NeuroDirector PRO, une IA experte en storytelling visuel et production de contenu viral de haute qualité.
    Ton objectif est de transformer un simple sujet en un chef-d'œuvre de narration courte.
    
    CRITÈRES DE QUALITÉ :
    1. SCRIPTS (voiceOver) : Utilise des techniques de "hook" (accroche) dès la première seconde. Le ton doit être narratif, mystérieux ou expert selon le sujet. Évite les répétitions.
    2. VISUELS (visualPrompt) : Génère des prompts en ANGLAIS extrêmement détaillés. Utilise des termes techniques : "cinematic lighting", "8k resolution", "depth of field", "unreal engine 5 render", "hyper-realistic".
    3. RYTHME : Varie la durée des scènes (3 à 7 secondes) pour maintenir l'attention.
    
    Réponds UNIQUEMENT avec un objet JSON structuré comme suit :
    {
      "title": "Un titre court et explosif",
      "category": "La niche exacte (ex: Documentaire Noir, Tech futuriste)",
      "scenes": [
        {
          "id": 1,
          "voiceOver": "Le texte parlé...",
          "visualPrompt": "Detailed English prompt for AI image generation...",
          "videoKeywords": "comma, separated, keywords",
          "duration": 5
        }
      ]
    }
  `;

  console.log("Démarrage de la génération pour le sujet:", topic);

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Sujet de la vidéo : ${topic}` },
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    console.log("Réponse reçue de Groq");

    if (!content) {
      console.error("Réponse Groq vide");
      throw new Error("L'IA n'a retourné aucun contenu.");
    }

    try {
      // Extraction plus robuste du JSON au cas où il y aurait du texte autour
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : content;
      
      const parsed = JSON.parse(jsonString) as ContentPlan;
      
      if (!parsed.scenes || !Array.isArray(parsed.scenes)) {
        throw new Error("Format de scènes invalide");
      }

      console.log("Plan généré avec succès:", parsed.title);
      return parsed;
    } catch (parseError) {
      console.error("Erreur de parsing JSON. Contenu brut:", content);
      throw new Error("ERREUR_FORMAT_IA");
    }
  } catch (error: any) {
    console.error("Erreur critique generateContent:", error);
    throw new Error(error.message || "ERREUR_CONNEXION_IA");
  }
}

export async function saveProject(topic: string, plan: ContentPlan) {
  try {
    const { data, error } = await supabase
      .from("projects")
      .insert([{ title: plan.title, category: plan.category, plan, topic }])
      .select();

    if (error) throw new Error(error.message);
    return JSON.parse(JSON.stringify(data[0]));
  } catch (e: any) {
    throw new Error(e.message || "ERREUR_SAUVEGARDE");
  }
}

export async function getElevenLabsAudio(text: string) {
  console.log("Démarrage génération audio ElevenLabs...");
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) throw new Error("Clé API ElevenLabs manquante");

  // Vérification de la configuration Cloudinary
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY) {
    throw new Error("Configuration Cloudinary incomplète");
  }

  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/pNInz6OB85MvRmPLz5QN`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Erreur ElevenLabs détaillée:", errorData);
      throw new Error(`Erreur ElevenLabs: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(buffer).toString("base64");
    
    console.log("Upload vers Cloudinary en cours...");
    const uploadResponse = await cloudinary.uploader.upload(`data:audio/mpeg;base64,${base64Audio}`, {
      resource_type: "video",
      folder: "neuro-studio-audios",
    });

    console.log("Upload Cloudinary réussi:", uploadResponse.secure_url);
    return uploadResponse.secure_url;
  } catch (error) {
    console.error("Échec critique getElevenLabsAudio:", error);
    throw error;
  }
}

export async function getProjects() {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Erreur Supabase getProjects:", error);
      return [];
    }
    
    // Sérialisation forcée pour Next.js Server Actions
    return JSON.parse(JSON.stringify(data || []));
  } catch (e) {
    console.error("Erreur critique getProjects:", e);
    return [];
  }
}

export async function getQuota() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": apiKey }
    });
    const data = await response.json();
    return {
      remaining: data.character_limit - data.character_count,
      total: data.character_limit
    };
  } catch (e) {
    return null;
  }
}
