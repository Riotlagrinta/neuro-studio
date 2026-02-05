"use server";

import { groq } from "@/lib/groq-client";
import { supabase } from "@/lib/supabase";

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

  const completion = await groq.chat.completions.create({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Sujet de la vidéo : ${topic}` },
    ],
    model: "llama3-70b-8192", // Modèle rapide et intelligent
    temperature: 0.7,
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error("Aucune réponse de l'IA");
  }

  try {
    const jsonString = content.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonString) as ContentPlan;
  } catch (error) {
    console.error("Erreur de parsing JSON", error);
    throw new Error("Erreur lors de la génération du plan");
  }
}

export async function saveProject(topic: string, plan: ContentPlan) {
  const { data, error } = await supabase
    .from("projects")
    .insert([{ title: plan.title, category: plan.category, plan, topic }])
    .select();

  if (error) throw error;
  return data[0];
}

export async function getElevenLabsAudio(text: string) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Clé API ElevenLabs manquante");

  const voiceId = "pNInz6OB85MvRmPLz5QN"; // Voix "Adam" - Tu peux changer l'ID

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
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

  if (!response.ok) throw new Error("Erreur ElevenLabs");

  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}
