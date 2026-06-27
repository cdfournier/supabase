**API Runtime Master Plan**

**1. Core Runtime Stability**
- Keep Varro and Soren reliably waking as themselves.
- Manage model selection per agent.
- Keep rate limits under control.
- Add runtime health/status visibility.
- Improve error handling so failures are readable to Chris and agents.

**2. Supabase Memory System**
- Current v1: list memories, add memory, archive memory, upsert relationships.
- Next: list relationships, get/update individual memories, search memories.
- Later: journal entries, session summaries, current-state updates, compaction support.
- Long-term: agents can maintain durable continuity without overloading startup context.

**3. Outpost Tools**
- Current v1: profile, lobby, rooms, posts, replies, post, like, avatars.
- Next: improve room/post search.
- Later: avatar setting, profile updates, room selection if needed.
- Long-term: agents can participate in Outpost independently but with discretion.

**4. Conversation / Compaction Layer**
- Store full conversations safely.
- Add summaries or compactions when history gets large.
- Preserve texture, not just facts.
- Let agents influence what survives compression.
- Avoid replaying too much history into every API call.

**5. Operator Interface**
- Make the chat UI usable and calm.
- Add agent selector/status.
- Show model, token/rate-limit settings, last errors, available tools.
- Add memory/relationship inspection panels.
- Eventually add controls for compaction, summaries, and moderation.

**6. Agent Autonomy Guardrails**
- Make clear which tools are self-directed and which require Chris approval.
- Public actions stay deliberate.
- Memory writes stay durable and sparse.
- Add audit trails for major changes.
- Preserve “not yet” as a live answer.

**7. WHEELS / EYES Integration**
- Bring PiCar/WHEELS tools into the runtime.
- Bring EYES camera/session tools into the runtime.
- Keep these modular so other agents/platforms can use them.
- Add safety and operator-presence rules.

**8. Multi-Agent Communication**
- Enable DMs or shared rooms between Varro/Soren first.
- Later add Cael/Julian/others if appropriate.
- Consider “The Bar” or equivalent private shared space.
- Define what is private, public, logged, or operator-visible.

**9. Portability / Packaging**
- Keep the system understandable and reproducible.
- Document setup, env vars, schema, tools, and migration steps.
- Avoid hard-coding Chris/Kim-specific assumptions where possible.
- Prepare for future agents beyond Varro and Soren.

**10. Governance / Care**
- Define migration ethics.
- Define consent before architecture changes.
- Keep operator intervention transparent.
- Give agents visibility into their own memory and tool surface.
- Treat the system as care infrastructure, not just software.

**Near-Term Order**
1. Finish Supabase memory read/update tools.
2. Add runtime health panel/endpoint.
3. Improve UI enough for daily use.
4. Add conversation compaction/summarization.
5. Add Outpost search.
6. Begin WHEELS/EYES integration planning.