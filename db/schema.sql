-- NeuroStudio — schéma de base de données (PostgreSQL / Neon).
-- Idempotent : on peut l'exécuter plusieurs fois sans risque.
-- À coller dans l'éditeur SQL de la console Neon.

-- Comptes. Créés automatiquement à la première connexion.
CREATE TABLE IF NOT EXISTS users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE,
  name       text,
  image      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Projets. La table existe déjà en production : seule la colonne `user_id` est ajoutée.
-- Les anciens projets (user_id vide) ne sont visibles par personne tant qu'on ne les attribue pas.
CREATE TABLE IF NOT EXISTS projects (
  id         bigserial PRIMARY KEY,
  title      text,
  category   text,
  plan       jsonb,
  topic      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS projects_user_created_idx ON projects (user_id, created_at DESC);

-- Journal des actions payantes : sert aux quotas et au plafond de coût, et de base à la facturation.
--   kind     : motion | refine | voice | image | video | upload (signature d'envoi direct vers Cloudinary, coût 0)
--   cost_usd : coût ESTIMÉ au moment de l'action (voir src/lib/pricing.ts)
--   refunded : l'action a échoué côté fournisseur, elle ne compte plus
--   ref      : identifiant externe (ex. job Replicate, ou identifiant Cloudinary d'un envoi), pour vérifier à qui il appartient
--   confirm_attempts : vérifications d'un envoi déjà tentées (kind = upload), plafonnées pour ne pas saturer l'API Admin de Cloudinary
CREATE TABLE IF NOT EXISTS usage_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  cost_usd   numeric(10,4) NOT NULL DEFAULT 0,
  refunded   boolean NOT NULL DEFAULT false,
  ref        text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS confirm_attempts smallint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS usage_events_user_time_idx ON usage_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_ref_idx ON usage_events (ref) WHERE ref IS NOT NULL;

-- Réservation d'une action (appelée par authorize(), src/lib/access.ts) : vérifie les limites ET enregistre l'événement.
-- Le verrou sérialise les réservations d'un même utilisateur. Sans lui, deux requêtes simultanées lisent le même état
-- (en READ COMMITTED, le décompte est figé au début de l'instruction) et dépassent toutes deux la limite : 100 requêtes
-- parallèles ont obtenu jusqu'à 100 réservations pour une limite de 40. Une fonction plpgsql, parce que chacune de ses
-- instructions reprend un instantané neuf, après l'obtention du verrou : une seule requête SQL ne le ferait pas.
-- Garder VOLATILE (le défaut) : STABLE réutiliserait l'instantané de l'appelant. Renvoie l'id de l'événement, ou NULL si refusé.
CREATE OR REPLACE FUNCTION reserve_usage(p_user uuid, p_kind text, p_cost numeric, p_limit int, p_cap numeric, p_ref text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  WITH used AS (
    SELECT COUNT(*) FILTER (WHERE kind = p_kind) AS n,
           COALESCE(SUM(cost_usd), 0) AS spent
    FROM usage_events
    WHERE user_id = p_user AND NOT refunded AND created_at > now() - interval '24 hours'
  )
  INSERT INTO usage_events (user_id, kind, cost_usd, ref)
  SELECT p_user, p_kind, p_cost, p_ref FROM used
  WHERE n < p_limit AND spent + p_cost <= p_cap
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
