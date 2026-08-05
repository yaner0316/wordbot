begin;

create table if not exists public.question_generation_jobs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    word_id uuid not null,
    status text not null default 'pending',
    reason text not null default 'word_entry',
    attempt_count integer not null default 0,
    next_attempt_at timestamptz not null default now(),
    lease_owner text,
    lease_expires_at timestamptz,
    last_error_code text,
    last_error_detail text,
    rejection_reasons jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint question_generation_jobs_word_owner_fk
        foreign key (word_id, user_id)
        references public.words(id, user_id)
        on delete cascade,
    constraint question_generation_jobs_word_unique unique (word_id),
    constraint question_generation_jobs_attempt_nonnegative check (attempt_count >= 0),
    constraint question_generation_jobs_status_check check (status in (
        'pending',
        'generating',
        'validating',
        'repairing',
        'retry_wait',
        'ready',
        'needs_manual_review'
    ))
);

create index if not exists question_generation_jobs_due_idx
    on public.question_generation_jobs (status, next_attempt_at, created_at)
    where status in ('pending', 'retry_wait');

create index if not exists question_generation_jobs_user_idx
    on public.question_generation_jobs (user_id, status, updated_at desc);

alter table public.question_generation_jobs enable row level security;
revoke all on table public.question_generation_jobs from anon, authenticated;
grant select, insert, update, delete on table public.question_generation_jobs to service_role;

alter table public.question_cache
    add column if not exists variant_slot integer not null default 1,
    add column if not exists cache_state text not null default 'active',
    add column if not exists available_from timestamptz,
    add column if not exists question_fingerprint text,
    add column if not exists rejection_reasons jsonb not null default '{}'::jsonb;

create index if not exists question_cache_word_variant_idx
    on public.question_cache (user_id, word_id, round_type, quality_status, cache_state, variant_slot);

create unique index if not exists question_cache_ready_fingerprint_unique_idx
    on public.question_cache (user_id, word_id, question_fingerprint)
    where quality_status = 'ready' and question_fingerprint is not null;

create unique index if not exists question_cache_fingerprint_upsert_unique_idx
    on public.question_cache (user_id, word_id, question_fingerprint);

create or replace function public.enqueue_question_generation_job_for_new_word()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if lower(btrim(new.word)) = 'genaine'
       or btrim(new.word) !~* '^[a-z]+([ ''-][a-z]+)*$' then
        return new;
    end if;

    insert into public.question_generation_jobs (
        user_id,
        word_id,
        status,
        reason,
        next_attempt_at
    ) values (
        new.user_id,
        new.id,
        'pending',
        'word_entry',
        now()
    ) on conflict (word_id) do nothing;
    return new;
end;
$$;

revoke all on function public.enqueue_question_generation_job_for_new_word() from public, anon, authenticated;

drop trigger if exists words_enqueue_question_generation_job on public.words;
create trigger words_enqueue_question_generation_job
after insert on public.words
for each row execute function public.enqueue_question_generation_job_for_new_word();

notify pgrst, 'reload schema';

commit;
