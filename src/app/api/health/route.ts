import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    environment: process.env.NODE_ENV,
    hasGroqKey: Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 10),
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 10),
    timestamp: new Date().toISOString()
  });
}
