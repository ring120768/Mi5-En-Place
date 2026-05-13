-- =====================================================================
-- MI5 EN PLACE — Sprint 1 initial schema
-- Sites + applications + signals + opportunities
-- =====================================================================

-- gen_random_uuid() is built into Postgres 13+ — no extension needed

-- =====================================================================
-- SITES — one row per physical address
-- =====================================================================
create table public.sites (
  id            uuid primary key default gen_random_uuid(),
  postcode      text not null,
  address_line  text,
  borough       text not null default 'westminster',
  geocode_lat   numeric(9, 6),
  geocode_lng   numeric(9, 6),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index sites_postcode_idx on public.sites(postcode);
create index sites_borough_idx  on public.sites(borough);

-- =====================================================================
-- APPLICATIONS — raw planning application metadata
-- =====================================================================
create table public.applications (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references public.sites(id) on delete restrict,
  source          text not null,        -- e.g. 'westminster_planning'
  planning_ref    text not null,        -- council application reference
  title           text,
  description     text,
  applicant       text,
  agent           text,
  use_class       text,
  status          text,
  received_date   date,
  decided_date    date,
  source_url      text,
  raw_html_path   text,                  -- Supabase Storage path
  raw_hash        text,                  -- content hash for change detection
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (source, planning_ref)          -- idempotent ingestion
);

create index applications_site_idx     on public.applications(site_id);
create index applications_received_idx on public.applications(received_date desc);
create index applications_status_idx   on public.applications(status);

-- =====================================================================
-- SIGNALS — typed event extracted from an application
-- =====================================================================
create type signal_tier as enum ('1', '2', '3', '4', '5');

create type signal_type as enum (
  -- Tier 1 — planning (Sprint 1)
  'external_flue',
  'extraction_ventilation',
  'basement_kitchen',
  'change_of_use_a3',
  'change_of_use_a4',
  'bar_installation',
  'new_build_hospitality',
  'rooftop_plant',
  'outdoor_kitchen',
  'kitchen_canopy_mention',
  -- Tier 2-5 — placeholders for later sprints
  'licensing',
  'building_control',
  'environmental_health',
  'architect_appearance',
  'tender'
);

create table public.signals (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid references public.applications(id) on delete restrict,
  tier              signal_tier not null,
  type              signal_type not null,
  weight            integer not null,           -- base weight at detection
  lead_time_months  integer,
  source_phrase     text,                       -- matched phrase from source
  confidence        numeric(3, 2) not null default 1.0,
  created_at        timestamptz not null default now()
);

create index signals_application_idx on public.signals(application_id);
create index signals_tier_idx        on public.signals(tier);
create index signals_type_idx        on public.signals(type);

-- =====================================================================
-- OPPORTUNITIES — the lead. One per site.
-- =====================================================================
create type opportunity_state as enum (
  'surveillance',
  'confirmed_activity',
  'high_priority_target',
  'active_operation',
  'mission_critical',
  'closed'
);

create table public.opportunities (
  id                  uuid primary key default gen_random_uuid(),
  site_id             uuid not null references public.sites(id) on delete restrict,
  opportunity_score   numeric(6, 2) not null default 0,
  state               opportunity_state not null default 'surveillance',
  first_detected_at   timestamptz not null default now(),
  last_updated_at     timestamptz not null default now(),
  notes               text,                     -- Ian's annotations
  saved               boolean not null default false,
  ignored             boolean not null default false,
  unique (site_id)
);

create index opportunities_score_idx   on public.opportunities(opportunity_score desc);
create index opportunities_state_idx   on public.opportunities(state);
create index opportunities_updated_idx on public.opportunities(last_updated_at desc);

-- =====================================================================
-- updated_at triggers
-- =====================================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger sites_set_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();

create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();
