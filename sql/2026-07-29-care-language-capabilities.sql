-- Align live Agent Capability Profile copy with Room Review / Room Refresh language.
-- This changes wording only; access levels, approval gates, and tool behavior stay the same.

update public.agent_capabilities
set
  default_bias = 'review before Room Refresh',
  notes = 'Agents may draft and approve Room Notes; sending housekeeping remains Operator action.'
where surface = 'compaction';
