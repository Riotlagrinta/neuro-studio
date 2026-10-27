import { NextRequest, NextResponse } from "next/server";
import { generateContent } from "@/app/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { 
          success: false, 
          error: "CLÉ_GROQ_MANQUANTE : Veuillez ajouter GROQ_API_KEY dans les variables d'environnement Vercel." 
        },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { topic, genre, format } = body;

    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return NextResponse.json(
        { success: false, error: "SUJET_MANQUANT : Veuillez fournir une idée ou un sujet de film." },
        { status: 400 }
      );
    }

    const result = await generateContent(topic.trim(), genre || "Libre / Tous Genres", format || "16:9");

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "ECHEC_GENERATION" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "ERREUR_SERVEUR_INCONNUE";
    console.error("API /api/generate Error:", err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
