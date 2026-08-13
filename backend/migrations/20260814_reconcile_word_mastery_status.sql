begin;

create or replace function public.reconcile_word_mastery_status(
    p_user_id uuid,
    p_word_id uuid,
    p_expected_mastery_status text,
    p_expected_remembered_at timestamptz,
    p_new_mastery_status text,
    p_new_remembered_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_now timestamptz := clock_timestamp();
    v_word public.words%rowtype;
    v_new_version bigint;
    v_crosses_mastered boolean;
begin
    if p_expected_mastery_status not in ('pending', 'recognized', 'consolidating', 'mastered')
       or p_new_mastery_status not in ('pending', 'recognized', 'consolidating', 'mastered') then
        raise exception 'INVALID_MASTERY_STATUS' using errcode = '22023';
    end if;

    select word.*
    into v_word
    from public.words as word
    where word.id = p_word_id
      and word.user_id = p_user_id
    for update;

    if not found
       or v_word.mastery_status::text is distinct from p_expected_mastery_status
       or v_word.remembered_at is distinct from p_expected_remembered_at then
        return false;
    end if;

    v_crosses_mastered := (v_word.mastery_status::text = 'mastered')
        is distinct from (p_new_mastery_status = 'mastered');

    if not v_crosses_mastered then
        update public.words as word
        set mastery_status = p_new_mastery_status::public.mastery_status,
            remembered_at = p_new_remembered_at,
            updated_at = v_now
        where word.id = p_word_id
          and word.user_id = p_user_id;
        return true;
    end if;

    update public.words as word
    set mastery_status = p_new_mastery_status::public.mastery_status,
        remembered_at = p_new_remembered_at,
        question_generation_version = greatest(1, word.question_generation_version) + 1,
        updated_at = v_now
    where word.id = p_word_id
      and word.user_id = p_user_id
    returning word.question_generation_version into v_new_version;

    perform public.retire_or_delete_word_question_cache(p_user_id, p_word_id);

    if p_new_mastery_status = 'mastered' then
        delete from public.question_generation_jobs as job
        where job.user_id = p_user_id
          and job.word_id = p_word_id;
        return true;
    end if;

    insert into public.question_generation_jobs (
        user_id, word_id, word_version, status, reason, attempt_count,
        next_attempt_at, lease_owner, lease_expires_at, lease_token,
        last_error_code, last_error_detail, rejection_reasons, updated_at
    ) values (
        p_user_id, p_word_id, v_new_version, 'pending', 'word_edit', 0,
        v_now, null, null, null, null, null, '{}'::jsonb, v_now
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

revoke all on function public.reconcile_word_mastery_status(
    uuid, uuid, text, timestamptz, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.reconcile_word_mastery_status(
    uuid, uuid, text, timestamptz, text, timestamptz
) to service_role;

notify pgrst, 'reload schema';

commit;
