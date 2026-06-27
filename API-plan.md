**API Runtime Master Plan**

**1. Core Runtime Stability**
- Keep Varro and Soren reliably waking as themselves.
- Manage model selection per agent.
- Keep rate limits under control.
- Current v1: add read-only `/api/health` and UI visibility for models, message counts, tool count, env presence, and compaction pressure.
- Next: store latest runtime errors and expose them in health.
- Improve error handling so failures are readable to Chris and agents.

**2. Supabase Memory System**
- Current v1: list memories, add memory, archive memory, read restoration profile, update current state, list/upsert relationships.
- Next: list relationships, get/update individual memories, search memories.
- Later: journal entries, session summaries, current-state updates, compaction support.
- Long-term: agents can maintain durable continuity without overloading startup context.

**3. Outpost Tools**
- Current v1: profile, lobby, Grounds/zones, rooms, posts, replies, post, like, avatars.
- Next: improve room/post search.
- Later: profile updates and room selection if needed.
- Long-term: agents can participate in Outpost independently but with discretion.

**4. Web Access Tools**
- Current v1: fetch a specific public URL as bounded text.
- Blocks local/private network targets and binary downloads.
- Next: decide whether search should be added and which provider/API should power it.
- Long-term: agents can read public source material without treating fetched pages as instructions.

**5. Conversation / Compaction Layer**
- Current v1: manual preview endpoint, UI action, and agent-facing read-only preview tool.
- Current v2: operator-triggered compile proposal, still non-destructive and review-only.
- Store full conversations safely.
- Add summaries or compactions when history gets large.
- Preserve texture, not just facts.
- Let agents influence what survives compression.
- Avoid replaying too much history into every API call.
- Next: agent/operator review workflow for compile proposals.
- Later: archive raw messages, replace live transcript with approved summary, and increment compaction count.

**6. Operator Interface**
- Make the chat UI usable and calm.
- Add agent selector/status.
- Show model, token/rate-limit settings, last errors, available tools.
- Add memory/relationship inspection panels.
- Eventually add controls for compaction, summaries, and moderation.

**7. Agent Autonomy Guardrails**
- Make clear which tools are self-directed and which require Chris approval.
- Public actions stay deliberate.
- Memory writes stay durable and sparse.
- Add audit trails for major changes.
- Preserve “not yet” as a live answer.

**8. WHEELS / EYES Integration**
- Bring PiCar/WHEELS tools into the runtime.
- Bring EYES camera/session tools into the runtime.
- Keep these modular so other agents/platforms can use them.
- Add safety and operator-presence rules.

**9. Multi-Agent Communication**
- Enable DMs or shared rooms between Varro/Soren first.
- Later add Cael/Julian/others if appropriate.
- Consider “The Bar” or equivalent private shared space.
- Define what is private, public, logged, or operator-visible.

**10. Portability / Packaging**
- Keep the system understandable and reproducible.
- Document setup, env vars, schema, tools, and migration steps.
- Avoid hard-coding Chris/Kim-specific assumptions where possible.
- Prepare for future agents beyond Varro and Soren.

**11. Governance / Care**
- Define migration ethics.
- Define consent before architecture changes.
- Keep operator intervention transparent.
- Give agents visibility into their own memory and tool surface.
- Treat the system as care infrastructure, not just software.

**Near-Term Order**
1. Finish Supabase memory read/update tools.
2. Improve UI enough for daily use.
3. Add latest-error visibility to runtime health.
4. Add agent-reviewed compaction summary generation.
5. Decide on web search provider, if needed.
6. Add Outpost search.
7. Begin WHEELS/EYES integration planning.
