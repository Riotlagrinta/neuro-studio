"use server";

import { groq } from "@/lib/groq-client";

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
    Tu es NeuroDirector, un expert en production vidéo virale (YouTube/TikTok).
    Ton but est de créer un plan de production complet à partir d'un sujet.
    
    Règles :
    1. Le script (voiceOver) doit être engageant, rythmé et direct.
    2. Les "visualPrompt" doivent être en ANGLAIS, descriptifs et cinématographiques (pour un générateur d'image IA).
    3. Les "videoKeywords" doivent être en ANGLAIS (pour chercher des stock videos).
    
    Réponds UNIQUEMENT avec un objet JSON respectant cette structure, sans texte avant ni après :
    {
      "title": "Titre accrocheur",
      "category": "Histoire/Tech/Santé...",
      "scenes": [
        {
          "id": 1,
          "voiceOver": "Phrase du script...",
          "visualPrompt": "Cinematic shot of...",
          "videoKeywords": "sunset, desert",
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
    // Nettoyage du JSON (au cas où l'IA ajoute des balises markdown ```json ... ```)
    const jsonString = content.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonString) as ContentPlan;
  } catch (error) {
    console.error("Erreur de parsing JSON", error);
    throw new Error("Erreur lors de la génération du plan");
  }
}
