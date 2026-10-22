import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

function getDb(): NeonQueryFunction<false, false> | null {
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    return null;
  }
  return neon(dbUrl);
}

/**
 * Client SQL Neon sécurisé avec proxy paresseux (lazy proxy).
 * Ne plante JAMAIS l'application au démarrage si DATABASE_URL n'est pas encore défini.
 */
export const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
  const db = getDb();
  if (!db) {
    console.warn("⚠️ Requête SQL ignorée : DATABASE_URL n'est pas configuré dans les variables d'environnement.");
    return Promise.resolve([]);
  }
  return db(strings, ...values);
}) as unknown as NeonQueryFunction<false, false>;
