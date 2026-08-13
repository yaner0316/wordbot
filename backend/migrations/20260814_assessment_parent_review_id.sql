begin;

-- Restore the review-chain column from the accepted assessment schema without
-- changing existing rows, constraints, RLS, or table privileges.
alter table if exists public.assessments
  add column if not exists parent_review_id text;

do $$
begin
  if to_regclass('public.assessments') is not null then
    execute $index$
      create index if not exists assessments_parent_review_idx
        on public.assessments (user_id, parent_review_id, review_status)
        where parent_review_id is not null
    $index$;
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
