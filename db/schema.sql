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
--   kind     : motion | refine | voice | image | video
--   cost_usd : coût ESTIMÉ au moment de l'action (voir src/lib/pricing.ts)
--   refunded : l'action a échoué côté fournisseur, elle ne compte plus
--   ref      : identifiant externe (ex. job Replicate), pour vérifier à qui il appartient
CREATE TABLE IF NOT EXISTS usage_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,
  cost_usd   numeric(10,4) NOT NULL DEFAULT 0,
  refunded   boolean NOT NULL DEFAULT false,
  ref        text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_user_time_idx ON usage_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_ref_idx ON usage_events (ref) WHERE ref IS NOT NULL;
