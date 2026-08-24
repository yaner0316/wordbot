begin;

create table if not exists public.game_states (
    user_id uuid primary key references public.users(id) on delete cascade,
    game_time_minutes integer not null default 0 check (game_time_minutes >= 0),
    reward_claim_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(reward_claim_ids) = 'array'),
    garden_state jsonb not null default '{}'::jsonb check (jsonb_typeof(garden_state) = 'object'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.game_states enable row level security;

revoke all on table public.game_states from public, anon, authenticated, service_role;
grant select, insert, update on table public.game_states to service_role;

notify pgrst, 'reload schema';

commit;
