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

-- ---------------------------------------------------------------------------------------------------------------
-- Crédits prépayés (actifs seulement avec BILLING_ENABLED=true ; sinon ces objets restent inutilisés).
-- 1 crédit = 1 $ de PRIX FACTURÉ à l'utilisateur (coût estimé x marge). Le grand livre est en ajout seul : on ne
-- modifie ni ne supprime jamais une ligne ; le solde est la somme des deltas.
--   topup      : recharge (ref = identifiant de la transaction mobile money, ce qui évite de créditer deux fois)
--   bonus      : crédit offert (ref = 'signup' pour le bonus de bienvenue : une seule fois par utilisateur)
--   adjustment : correction manuelle
--   debit      : consommation (ref = id de l'événement usage_events), negatif
--   refund     : annulation d'un débit (ref = id du même événement), positif, une seule fois
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_ledger (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NaN est plus grand que tout nombre en PostgreSQL : une ligne NaN rendrait le solde infini. Refusé dès la table.
  delta      numeric(12,4) NOT NULL CHECK (delta <> 'NaN'::numeric AND delta <> 0),
  reason     text NOT NULL CHECK (reason IN ('topup', 'debit', 'refund', 'bonus', 'adjustment')),
  ref        text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Un même motif + une même référence ne s'applique qu'une fois : c'est ce qui rend recharges et remboursements idempotents.
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_once ON credit_ledger (reason, ref) WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger (user_id, id DESC);

CREATE OR REPLACE FUNCTION credit_balance(p_user uuid) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE user_id = p_user
$$;

-- Ajouter des crédits : la SEULE voie. Renvoie l'id de la ligne, ou NULL si ce (motif, ref) a déjà été appliqué.
-- Exemple (recharge manuelle après un paiement mobile money reçu) :
--   SELECT credit_user((SELECT id FROM users WHERE email = 'client@exemple.com'), 5, 'topup', 'momo-TXN123');
CREATE OR REPLACE FUNCTION credit_user(p_user uuid, p_amount numeric, p_reason text, p_ref text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_id bigint;
BEGIN
  IF p_amount IS NULL OR p_amount = 'NaN'::numeric OR p_amount <= 0 OR p_amount > 100000 THEN RAISE EXCEPTION 'montant invalide'; END IF;
  IF p_reason NOT IN ('topup', 'bonus', 'adjustment') THEN RAISE EXCEPTION 'motif invalide'; END IF;
  INSERT INTO credit_ledger (user_id, delta, reason, ref) VALUES (p_user, p_amount, p_reason, p_ref)
  ON CONFLICT (reason, ref) WHERE ref IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;

-- Réserve une action ET la facture, en une seule étape atomique. Même verrou par utilisateur que reserve_usage, pris
-- AVANT toute lecture : des requêtes parallèles ne peuvent ni dépasser un quota ni faire passer le solde sous zéro.
-- Renvoie (id de l'événement, 'ok') ou (NULL, 'quota' | 'balance') selon ce qui refuse. Garder VOLATILE (le défaut).
CREATE OR REPLACE FUNCTION reserve_charged(p_user uuid, p_kind text, p_cost numeric, p_charge numeric, p_limit int, p_cap numeric, p_ref text DEFAULT NULL)
RETURNS TABLE (out_event bigint, out_status text) LANGUAGE plpgsql AS $$
DECLARE
  v_count int;
  v_spent numeric;
  v_balance numeric;
  v_id bigint;
BEGIN
  -- Un coût ou un prix NaN, négatif ou absent n'est jamais une action gratuite : refus.
  IF p_cost IS NULL OR p_cost = 'NaN'::numeric OR p_cost < 0 OR p_charge IS NULL OR p_charge = 'NaN'::numeric OR p_charge < 0 THEN
    RETURN QUERY SELECT NULL::bigint, 'quota'::text;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  SELECT COUNT(*) FILTER (WHERE kind = p_kind), COALESCE(SUM(cost_usd), 0)
    INTO v_count, v_spent
    FROM usage_events
    WHERE user_id = p_user AND NOT refunded AND created_at > now() - interval '24 hours';
  IF v_count >= p_limit OR v_spent + p_cost > p_cap THEN
    RETURN QUERY SELECT NULL::bigint, 'quota'::text;
    RETURN;
  END IF;
  SELECT COALESCE(SUM(delta), 0) INTO v_balance FROM credit_ledger WHERE user_id = p_user;
  IF v_balance < p_charge THEN
    RETURN QUERY SELECT NULL::bigint, 'balance'::text;
    RETURN;
  END IF;
  INSERT INTO usage_events (user_id, kind, cost_usd, ref) VALUES (p_user, p_kind, p_cost, p_ref) RETURNING id INTO v_id;
  IF p_charge > 0 THEN
    INSERT INTO credit_ledger (user_id, delta, reason, ref) VALUES (p_user, -p_charge, 'debit', v_id::text);
  END IF;
  RETURN QUERY SELECT v_id, 'ok'::text;
END
$$;

-- Annule une action : l'événement ne compte plus ET le débit est rendu, exactement une fois (appel répété sans effet).
-- Renvoie le montant rendu (0 si rien à rendre).
CREATE OR REPLACE FUNCTION refund_event(p_event bigint) RETURNS numeric
LANGUAGE plpgsql AS $$
DECLARE
  v_user uuid;
  v_amount numeric;
BEGIN
  UPDATE usage_events SET refunded = true WHERE id = p_event RETURNING user_id INTO v_user;
  IF v_user IS NULL THEN RETURN 0; END IF;
  INSERT INTO credit_ledger (user_id, delta, reason, ref)
  SELECT user_id, -delta, 'refund', ref FROM credit_ledger WHERE reason = 'debit' AND ref = p_event::text
  ON CONFLICT (reason, ref) WHERE ref IS NOT NULL DO NOTHING
  RETURNING delta INTO v_amount;
  RETURN COALESCE(v_amount, 0);
END
$$;

-- Idem pour les événements rattachés à un identifiant externe (ex. un job Replicate qui a échoué).
CREATE OR REPLACE FUNCTION refund_by_ref(p_user uuid, p_ref text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_event bigint;
BEGIN
  FOR v_event IN SELECT id FROM usage_events WHERE user_id = p_user AND ref = p_ref LOOP
    PERFORM refund_event(v_event);
  END LOOP;
END
$$;
