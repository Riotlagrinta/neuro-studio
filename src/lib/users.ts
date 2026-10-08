// Creates the account row on first sign-in and returns its id.

export async function upsertUser(profile: { email: string; name?: string | null; image?: string | null }): Promise<string> {
  const { sql } = await import("./db");
  const rows = await sql`
    INSERT INTO users (email, name, image)
    VALUES (${profile.email.trim().toLowerCase()}, ${profile.name ?? null}, ${profile.image ?? null})
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, image = EXCLUDED.image
    RETURNING id
  `;
  return String(rows[0].id);
}
