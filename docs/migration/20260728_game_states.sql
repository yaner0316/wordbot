create table if not exists public.game_states (
    user_id uuid primary key references public.users(id) on delete cascade,
    game_time_minutes integer not null default 0,
    reward_claim_ids jsonb not null default '[]'::jsonb,
    garden_state jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    constraint game_states_minutes_nonnegative check (game_time_minutes >= 0),
    constraint game_states_claim_ids_array check (jsonb_typeof(reward_claim_ids) = 'array'),
    constraint game_states_garden_object check (jsonb_typeof(garden_state) = 'object')
);

alter table public.game_states enable row level security;
revoke all on table public.game_states from anon, authenticated;
grant all on table public.game_states to service_role;