begin;

create or replace function public.enqueue_question_generation_job_if_needed(
    p_user_id uuid,
    p_word_id uuid,
    p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_word public.words%rowtype;
    v_ready_fingerprints integer := 0;
    v_ready_questions integer := 0;
    v_affected integer := 0;
begin
    select word.*
    into v_word
    from public.words as word
    where word.id = p_word_id
      and word.user_id = p_user_id
    for update;
    if not found then
        return false;
    end if;

    if v_word.mastery_status = 'mastered'
       or lower(btrim(v_word.word)) = 'genaine'
       or btrim(v_word.word) !~* '^[a-z]+([ ''-][a-z]+)*$' then
        return false;
    end if;

    select
        count(distinct question_fingerprint),
        count(distinct regexp_replace(lower(btrim(question_text)), '\s+', ' ', 'g'))
    into v_ready_fingerprints, v_ready_questions
    from public.question_cache
    where user_id = p_user_id
      and word_id = p_word_id
      and round_type = 'primary'
      and quality_status = 'ready'
      and cache_state in ('active', 'reserved_next_day')
      and question_type = '1'
      and lower(btrim(ai_audit_status)) = 'approved'
      and jsonb_typeof(options) = 'array'
      and jsonb_array_length(options) = 4
      and jsonb_typeof(option_meanings) = 'array'
      and jsonb_array_length(option_meanings) = 4
      and answer in ('A', 'B', 'C', 'D')
      and btrim(question_text) <> ''
      and not exists (
          select 1
          from jsonb_array_elements_text(options) as option_value(value)
          where option_value.value !~ '^[A-D]\.\s+\S'
      )
      and not exists (
          select 1
          from jsonb_array_elements_text(option_meanings) as meaning_value(value)
          where btrim(meaning_value.value) = ''
             or meaning_value.value !~ U&'[\4E00-\9FFF]'
      )
      and btrim(correct_meaning) <> ''
      and question_fingerprint is not null;

    if coalesce(nullif(p_reason, ''), '') = 'cache_backfill'
       or v_ready_fingerprints < 2
       or v_ready_questions < 2 then
        insert into public.question_generation_jobs (
            user_id, word_id, word_version, status, reason, next_attempt_at
        ) values (
            p_user_id,
            p_word_id,
            v_word.question_generation_version,
            'pending',
            coalesce(nullif(p_reason, ''), 'backfill'),
            clock_timestamp()
        )
        on conflict (word_id) do update
        set user_id = excluded.user_id,
            word_version = excluded.word_version,
            status = 'pending',
            reason = excluded.reason,
            attempt_count = 0,
            next_attempt_at = clock_timestamp(),
            lease_owner = null,
            lease_expires_at = null,
            lease_token = null,
            last_error_code = null,
            last_error_detail = null,
            rejection_reasons = '{}'::jsonb,
            updated_at = clock_timestamp()
        where question_generation_jobs.word_version <> excluded.word_version
           or question_generation_jobs.status = 'ready';
        get diagnostics v_affected = row_count;
    end if;
    return v_affected > 0;
end;
$$;

revoke all on function public.enqueue_question_generation_job_if_needed(uuid, uuid, text)
    from public, anon, authenticated, service_role;
grant execute on function public.enqueue_question_generation_job_if_needed(uuid, uuid, text)
    to service_role;

notify pgrst, 'reload schema';

commit;
