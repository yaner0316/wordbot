-- Track the two type-one variants and their lifecycle.
alter table public.question_cache
    add column if not exists cache_state text not null default 'active',
    add column if not exists variant_slot smallint not null default 1,
    add column if not exists available_from timestamptz;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.question_cache'::regclass
          and conname = 'question_cache_state_valid'
    ) then
        alter table public.question_cache
            add constraint question_cache_state_valid
            check (cache_state in ('active', 'reserved_next_day', 'replace_pending', 'retired'));
    end if;
    if not exists (
        select 1 from pg_constraint
        where conrelid = 'public.question_cache'::regclass
          and conname = 'question_cache_variant_slot_valid'
    ) then
        alter table public.question_cache
            add constraint question_cache_variant_slot_valid
            check (variant_slot > 0);
    end if;
end
$$;

create index if not exists question_cache_selectable_variant_idx
    on public.question_cache (user_id, level, round_type, cache_state, available_from, used_count)
    where quality_status = 'ready';

notify pgrst, 'reload schema';