-- Persist in-progress quiz answers so a learner can resume on another device.
alter table public.quiz_sessions
    add column if not exists session_state jsonb not null default '{}'::jsonb;

comment on column public.quiz_sessions.session_state is 'Client-safe draft progress: currentQuestion and answers.';

notify pgrst, 'reload schema';
