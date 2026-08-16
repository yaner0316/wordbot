begin;

-- Apply the runtime RPC grant after every function-replacement migration so
-- historical or partially applied ACL state cannot survive deployment.
revoke all on function public.enqueue_question_generation_job_if_needed(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_question_generation_job_if_needed(uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
