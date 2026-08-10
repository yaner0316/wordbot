begin;

-- Formal challenge rows keep a restricted FK to question_cache so their
-- snapshots remain addressable after a word is edited. Retire those rows;
-- only unreferenced cache rows are eligible for physical deletion.
create or replace function public.retire_or_delete_word_question_cache(
    p_user_id uuid,
    p_word_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.question_cache as cache
    set cache_state = 'retired',
        updated_at = clock_timestamp()
    where cache.user_id = p_user_id
      and cache.word_id = p_word_id
      and exists (
          select 1
          from public.quiz_challenge_questions as challenge_question
          where challenge_question.cache_question_id = cache.id
      );

    delete from public.question_cache as cache
    where cache.user_id = p_user_id
      and cache.word_id = p_word_id
      and not exists (
          select 1
          from public.quiz_challenge_questions as challenge_question
          where challenge_question.cache_question_id = cache.id
      );
end;
$$;

create or replace function public.fence_word_question_generation(
    p_user_id uuid,
    p_word_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_version bigint;
begin
    perform 1
    from public.words as word
    where word.id = p_word_id
      and word.user_id = p_user_id
    for update;
    if not found then
        return null;
    end if;

    update public.words as word
    set question_generation_version = greatest(1, word.question_generation_version) + 1,
        updated_at = v_now
    where word.id = p_word_id
      and word.user_id = p_user_id
    returning word.question_generation_version into v_version;

    insert into public.question_generation_jobs (
        user_id, word_id, word_version, status, reason, attempt_count,
        next_attempt_at, lease_owner, lease_expires_at, last_error_code,
        last_error_detail, rejection_reasons, updated_at
    ) values (
        p_user_id, p_word_id, v_version, 'pending', 'word_edit', 0,
        timestamptz '9999-12-31 23:59:59.999+00', null, null, null,
        null, '{}'::jsonb, v_now
    )
    on conflict (word_id) do update
    set user_id = excluded.user_id,
        word_version = excluded.word_version,
        status = excluded.status,
        reason = excluded.reason,
        attempt_count = excluded.attempt_count,
        next_attempt_at = excluded.next_attempt_at,
        lease_owner = null,
        lease_expires_at = null,
        lease_token = null,
        last_error_code = null,
        last_error_detail = null,
        rejection_reasons = '{}'::jsonb,
        updated_at = excluded.updated_at;

    perform public.retire_or_delete_word_question_cache(p_user_id, p_word_id);
    return v_version;
end;
$$;

create or replace function public.finalize_word_question_generation_edit(
    p_user_id uuid,
    p_word_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_word public.words%rowtype;
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
        perform public.retire_or_delete_word_question_cache(p_user_id, p_word_id);
        delete from public.question_generation_jobs as job
        where job.user_id = p_user_id
          and job.word_id = p_word_id;
        return false;
    end if;

    insert into public.question_generation_jobs (
        user_id, word_id, word_version, status, reason, attempt_count,
        next_attempt_at, lease_owner, lease_expires_at, last_error_code,
        last_error_detail, rejection_reasons, updated_at
    ) values (
        p_user_id, p_word_id, v_word.question_generation_version, 'pending',
        'word_edit', 0, v_now, null, null, null, null, '{}'::jsonb, v_now
    )
    on conflict (word_id) do update
    set user_id = excluded.user_id,
        word_version = excluded.word_version,
        status = excluded.status,
        reason = excluded.reason,
        attempt_count = excluded.attempt_count,
        next_attempt_at = excluded.next_attempt_at,
        lease_owner = null,
        lease_expires_at = null,
        lease_token = null,
        last_error_code = null,
        last_error_detail = null,
        rejection_reasons = '{}'::jsonb,
        updated_at = excluded.updated_at;
    return true;
end;
$$;

revoke all on function public.retire_or_delete_word_question_cache(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.retire_or_delete_word_question_cache(uuid, uuid)
    to service_role;

revoke all on function public.fence_word_question_generation(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.fence_word_question_generation(uuid, uuid)
    to service_role;

revoke all on function public.finalize_word_question_generation_edit(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.finalize_word_question_generation_edit(uuid, uuid)
    to service_role;

commit;
