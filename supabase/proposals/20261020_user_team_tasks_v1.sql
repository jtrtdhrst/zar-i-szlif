-- DESIGN PROPOSAL ONLY. NOT AN EXECUTABLE/APPROVED PRODUCTION MIGRATION.
-- KOMAA-1120/P1-P2: Reconcile actual live Supabase schema (KOMAA-1110/1122)
-- before moving into supabase/migrations. Never run this without a reviewer.
-- No user legal name/email is stored in this contract or returned through MCP.
-- Supabase Auth auth.users.email is managed and must never be exposed via MCP.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app_private TO authenticated;

CREATE TABLE public.product_user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  onboarding_state text NOT NULL DEFAULT 'started'
    CHECK (onboarding_state IN ('started','in_progress','complete')),
  preferred_species text CHECK (preferred_species IS NULL OR preferred_species NOT IN ('fox','raven')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Private experience settings and app-owned encrypted identities belong to the
-- separate KOMAA-1111 trust boundary, not a model-readable profile table.
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','archived')),
  created_by uuid NOT NULL REFERENCES public.product_user_profiles(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.team_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id),
  user_id uuid NOT NULL REFERENCES public.product_user_profiles(user_id),
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner','admin','member')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','left','removed')),
  avatar_species text CHECK (avatar_species IS NULL OR avatar_species NOT IN ('fox','raven')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  CHECK ((status <> 'active') OR (left_at IS NULL AND avatar_species IS NOT NULL)),
  CHECK ((status = 'active') OR (left_at IS NOT NULL))
);
-- Product invariant: exactly ZERO OR ONE currently active team per account.
CREATE UNIQUE INDEX uq_one_active_team_per_user
  ON public.team_memberships(user_id) WHERE status = 'active';
CREATE UNIQUE INDEX uq_one_active_species_per_team
  ON public.team_memberships(team_id,avatar_species) WHERE status = 'active';
CREATE UNIQUE INDEX uq_one_active_team_owner
  ON public.team_memberships(team_id) WHERE status = 'active' AND role = 'owner';
CREATE INDEX idx_members_by_team_status ON public.team_memberships(team_id,status);
CREATE TABLE public.team_function_catalog (
  code text PRIMARY KEY,
  label_pl text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.team_member_functions (
  membership_id uuid NOT NULL REFERENCES public.team_memberships(id) ON DELETE CASCADE,
  function_code text NOT NULL REFERENCES public.team_function_catalog(code),
  PRIMARY KEY(membership_id,function_code)
);
-- Codes/invite destinations are private, not available to authenticated SQL
-- clients and NEVER projected to product MCP. Generate/validate/rotate in app
-- identity backend using separate secret HMAC key and constant-time comparison.
CREATE TABLE app_private.team_join_codes (
  team_id uuid PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  code_hmac bytea NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id),
  invitee_email_blind_index bytea NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','accepted','rejected','expired','revoked')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.team_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id),
  requested_by uuid NOT NULL REFERENCES public.product_user_profiles(user_id),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','approved','rejected','withdrawn')),
  reviewed_by uuid REFERENCES public.product_user_profiles(user_id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR state <> 'pending')
);
CREATE UNIQUE INDEX uq_pending_join_per_team_user
  ON public.team_join_requests(team_id,requested_by) WHERE state='pending';
CREATE TABLE public.product_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('personal','team')),
  team_id uuid REFERENCES public.teams(id),
  owner_user_id uuid NOT NULL REFERENCES public.product_user_profiles(user_id),
  assigned_to_user_id uuid REFERENCES public.product_user_profiles(user_id),
  parent_task_id uuid REFERENCES public.product_tasks(id) DEFERRABLE INITIALLY IMMEDIATE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 240),
  description text,
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('backlog','todo','in_progress','blocked','done','cancelled')),
  due_at timestamptz,
  source_activity_id uuid, -- map to ACTUAL Stół Wypraw activity FK at P1
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope='personal' AND team_id IS NULL
       AND (assigned_to_user_id IS NULL OR assigned_to_user_id=owner_user_id))
    OR (scope='team' AND team_id IS NOT NULL)),
  CHECK (parent_task_id IS NULL OR parent_task_id <> id)
);
CREATE INDEX idx_tasks_team_state_due ON public.product_tasks(team_id,status,due_at)
  WHERE team_id IS NOT NULL;
CREATE INDEX idx_tasks_owner_state_due ON public.product_tasks(owner_user_id,status,due_at);
CREATE INDEX idx_tasks_assignment ON public.product_tasks(assigned_to_user_id,status);
CREATE TABLE public.product_task_dependencies (
  blocked_task_id uuid NOT NULL REFERENCES public.product_tasks(id) ON DELETE CASCADE,
  blocker_task_id uuid NOT NULL REFERENCES public.product_tasks(id) ON DELETE CASCADE,
  relation_type text NOT NULL DEFAULT 'blocks' CHECK (relation_type='blocks'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(blocked_task_id,blocker_task_id),
  CHECK (blocked_task_id<>blocker_task_id)
);
CREATE INDEX idx_task_reverse_blocking ON public.product_task_dependencies(blocker_task_id);
CREATE TABLE public.spark_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  beneficiary_user_id uuid REFERENCES public.product_user_profiles(user_id),
  beneficiary_team_id uuid REFERENCES public.teams(id),
  related_task_id uuid REFERENCES public.product_tasks(id),
  amount integer NOT NULL CHECK (amount <> 0),
  event_type text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((beneficiary_user_id IS NOT NULL) <> (beneficiary_team_id IS NOT NULL))
);

-- DO NOT rely on RLS on its own when privileged service-role DB credentials
-- bypass RLS. Product MCP must NOT have service_role or decrypt connections.
CREATE OR REPLACE FUNCTION app_private.is_active_team_member(p_team uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $body$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.team_memberships m
    WHERE m.team_id=p_team AND m.user_id=auth.uid() AND m.status='active'
  );
$body$;
CREATE OR REPLACE FUNCTION app_private.is_team_admin(p_team uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $body$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.team_memberships m
    WHERE m.team_id=p_team AND m.user_id=auth.uid()
      AND m.status='active' AND m.role IN ('owner','admin')
  );
$body$;
REVOKE ALL ON FUNCTION app_private.is_active_team_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.is_team_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.is_active_team_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_team_admin(uuid) TO authenticated;

ALTER TABLE public.product_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_function_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_member_functions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spark_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.team_join_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.team_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.product_user_profiles,public.organizations,public.teams,
  public.team_memberships,public.team_function_catalog,public.team_member_functions,
  public.team_join_requests,public.product_tasks,public.product_task_dependencies,
  public.spark_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.product_user_profiles,public.organizations,public.teams,
  public.team_memberships,public.team_function_catalog,public.team_member_functions,
  public.team_join_requests,public.product_tasks,public.product_task_dependencies,
  public.spark_ledger TO authenticated;

CREATE POLICY p_profile_self ON public.product_user_profiles FOR SELECT TO authenticated
  USING (user_id=auth.uid());
CREATE POLICY p_team_member ON public.teams FOR SELECT TO authenticated
  USING (app_private.is_active_team_member(id));
CREATE POLICY p_org_member ON public.organizations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.teams t WHERE t.organization_id=id));
CREATE POLICY p_membership_on_team ON public.team_memberships FOR SELECT TO authenticated
  USING (user_id=auth.uid() OR app_private.is_team_admin(team_id));
CREATE POLICY p_functions_catalog ON public.team_function_catalog FOR SELECT TO authenticated
  USING (true);
CREATE POLICY p_member_functions ON public.team_member_functions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.team_memberships m
    WHERE m.id=membership_id AND (m.user_id=auth.uid() OR app_private.is_team_admin(m.team_id))));
CREATE POLICY p_request_owner_or_admin ON public.team_join_requests FOR SELECT TO authenticated
  USING (requested_by=auth.uid() OR app_private.is_team_admin(team_id));
CREATE POLICY p_task_owner_or_team_member ON public.product_tasks FOR SELECT TO authenticated
  USING ((scope='personal' AND owner_user_id=auth.uid())
    OR (scope='team' AND app_private.is_active_team_member(team_id)));
CREATE POLICY p_dependency_with_visible_ends ON public.product_task_dependencies FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.product_tasks a
      JOIN public.product_tasks b ON b.id=blocker_task_id
      WHERE a.id=blocked_task_id));
CREATE POLICY p_sparks_self_or_team ON public.spark_ledger FOR SELECT TO authenticated
  USING ((beneficiary_user_id IS NOT NULL AND beneficiary_user_id=auth.uid())
    OR (beneficiary_team_id IS NOT NULL AND app_private.is_active_team_member(beneficiary_team_id)));

-- UNFINISHED SECURITY CONTRACT (must be implemented before this file may
-- become a migration): first-class DB trigger for same-scope parent and blocking
-- edges, concurrency-safe no-cycle checks (both DAGs separately), task assignment
-- member check, owner continuity, HMAC rotation/write handlers, invitation handling,
-- app-managed identity encryption from KOMAA-1111, account linking & backfill.
-- No raw table writes granted: a trusted authorized backend must implement
-- atomic create/approval/delete and immutable ledger-only Spark mutations.
-- Team/task free-text is potentially PII; product MCP may return it ONLY after
-- classifying and sanitizing it server-side under KOMAA-1113.
-- These proposed policies are provisional until real Supabase staging tests show
-- exact effective database roles, RLS behavior and non-PII readback.
ROLLBACK;
-- ROLLBACK is intentional: this draft never persists data if pasted into psql.
