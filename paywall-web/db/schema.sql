create table if not exists skill_versions (
  skill_id text not null,
  content_sha256 text not null,
  title text not null,
  summary text not null,
  price_sats bigint not null,
  blob_path text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (skill_id, content_sha256)
);

create index if not exists skill_versions_active_idx
  on skill_versions (skill_id, is_active);

create table if not exists l402_challenges (
  payment_hash text primary key,
  skill_id text not null,
  content_sha256 text not null,
  price_sats bigint not null,
  invoice text not null,
  created_at timestamptz not null default now()
);

create table if not exists l402_receipts (
  payment_hash text primary key,
  skill_id text not null,
  content_sha256 text not null,
  first_verified_at timestamptz not null default now(),
  settled_at timestamptz null
);
