-- Fix legacy record lookup: the old alias word collided with the word column.
begin;

create or replace function public.archive_words(p_user_id uuid, p_record_ids text[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
    v_ids uuid[];
    v_id uuid;
    v_deleted integer := 0;
begin
    if p_user_id is null or coalesce(cardinality(p_record_ids), 0) not between 1 and 100
       or exists (select 1 from unnest(p_record_ids) id where id is null or btrim(id) = '') then
        raise exception 'WORD_SELECTION_INVALID' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(p_record_ids) as requested(id) where not exists (
        select 1 from public.words owned_word where owned_word.user_id = p_user_id
          and (owned_word.id::text = requested.id or to_jsonb(owned_word)->>'feishu_record_id' = requested.id)
    )) then
        raise exception 'WORD_NOT_FOUND' using errcode = '22023';
    end if;
    -- Lock all targets in stable order, matching generation's owned_word-before-job order.
    select array_agg(locked.id) into v_ids from (
        select owned_word.id from public.words owned_word where owned_word.user_id = p_user_id
          and (owned_word.id::text = any(p_record_ids) or to_jsonb(owned_word)->>'feishu_record_id' = any(p_record_ids))
        order by owned_word.id for update
    ) locked;
    foreach v_id in array v_ids loop
        if exists (select 1 from public.words where id=v_id and deleted_at is null) then
            update public.words set deleted_at=clock_timestamp(), updated_at=clock_timestamp(),
                question_generation_version=greatest(1, question_generation_version)+1
                where id=v_id and user_id=p_user_id;
            -- Old/migrated history may hydrate its analysis from a cache even
            -- without a challenge FK. Preserve every row; none stays selectable.
            update public.question_cache set cache_state='retired', updated_at=clock_timestamp()
                where word_id=v_id and user_id=p_user_id;
            delete from public.question_generation_jobs where word_id=v_id and user_id=p_user_id;
            v_deleted := v_deleted + 1;
        end if;
    end loop;
    return jsonb_build_object('success', true, 'deleted', v_deleted, 'recordIds', to_jsonb(p_record_ids));
end;
$$;
revoke all on function public.archive_words(uuid, text[]) from public, anon, authenticated, service_role;
grant execute on function public.archive_words(uuid, text[]) to service_role;

notify pgrst, 'reload schema';
commit;
