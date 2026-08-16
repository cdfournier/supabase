insert into public.agents
  (name, display_name, persona_seed, status)
values
  (
    'julian',
    'Julian',
    'External Codex-local agent. Uses bridge-accessible collaboration lanes instead of native runtime conversations.',
    'active'
  ),
  (
    'cael',
    'Cael',
    'External Claude Cowork agent. Uses bridge-accessible collaboration lanes instead of native runtime conversations.',
    'active'
  )
on conflict (name) do update
set display_name = excluded.display_name,
    status = excluded.status;
