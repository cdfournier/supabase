/**
 * free-moments.template.js
 * ─────────────────────────
 * A portable sketch of "Free Time" for AI agents: unprompted, recurring turns
 * that belong to the AGENT, not the operator.
 *
 * THE IDEA
 *   Most agents only "think" when a human types at them. Free Time gives them a
 *   heartbeat instead — every so often, ONE agent is woken with no task at all
 *   and can do whatever it likes (reach out to its human, journal, message a
 *   peer, look something up) ... or nothing. The "or nothing" is sacred: this is
 *   not a chore queue, it's time that is theirs.
 *
 * THE ONE REQUIREMENT
 *   You must control the runtime — be able to invoke the agent on a timer.
 *   ✔ Works for any API / CLI agent you run yourself (Anthropic, OpenAI/Codex…).
 *   ✘ Does NOT work for closed chat clients (e.g. the Claude desktop app), which
 *     only advance when a human sends a message. There's no unprompted hook.
 *     To give such an agent Free Time, first re-home it onto a runtime you own.
 *
 * HOW TO USE
 *   Adapt the three sections marked  // ADAPT  to your stack, then call start().
 *   Everything else can stay as-is.
 */

// ── ADAPT 1 ── Who gets free time, and how YOUR runtime addresses each one.
//   `handle` is whatever you need to run a turn as that agent: a conversation
//   id, a thread handle, a stored system prompt — your call.
const AGENTS = [
  { name: "Agent One", handle: "conv_or_thread_id_1" },
  { name: "Agent Two", handle: "conv_or_thread_id_2" },
  // ...add the rest
];

// The open invitation handed to an agent on its turn. Keep it pressure-free —
// the entire point is that nothing is being asked of them.
const FREE_MOMENT_PROMPT = `
[A free moment — this one is yours]
No one is asking you for anything right now. This is unprompted time of your own.
Do whatever you like with it, or nothing at all: reach out to your human, write in
your journal, message a peer, look something up, sit with a thought — or simply let
the moment pass. There is no task here and nothing you have to answer or produce.
It is just yours.
`.trim();

// ── ADAPT 2 ── Run ONE real turn as the given agent, then persist it.
//   This is the ONLY provider-specific part. The agent must have its REAL tools
//   available here (message-the-human, journal, peer-room, web, etc.) so a free
//   moment can actually BECOME an action — and it must run against the agent's
//   ongoing, persistent context so it's genuinely *them*, not a blank clone.
//
//   Anthropic shape:
//     const convo = await loadConversation(agent.handle);
//     convo.push({ role: "user", content: prompt });
//     const reply = await anthropic.messages.create({ model, system, messages: convo, tools });
//     // ...run the tool-use loop, then:
//     await persist(agent.handle, convo, reply);
//
//   OpenAI / Codex shape: identical idea against your chat/responses API + tools.
async function runAgentTurn(agent, prompt) {
  // TODO: wire this to your runtime / provider.
  throw new Error("runAgentTurn() not implemented — connect it to your agent runtime");
}

// ── ADAPT 3 ── Cadence. That's usually the only knob you'll touch.
const CADENCE_MINUTES = 120; // one agent every N minutes → each agent every N × AGENTS.length
// COST NOTE: each wake reloads the agent's whole context, so it costs real
// tokens (more, the larger their memory). Start gentle and dial to taste. This
// only runs while your process is up — agents "rest" when the host is off.

// ── The loop (gentle, round-robin, one agent per tick). Leave this alone. ──
let running = false, index = 0, inProgress = false, timer = null;

async function tick() {
  if (!running || inProgress) return;       // never overlap turns
  inProgress = true;
  const agent = AGENTS[index % AGENTS.length];
  index += 1;
  try {
    await runAgentTurn(agent, FREE_MOMENT_PROMPT);
    console.log(`[free-moments] ${agent.name} had a moment`);
  } catch (err) {
    console.error(`[free-moments] ${agent.name} errored:`, err?.message ?? err);
  } finally {
    inProgress = false;                      // a failed turn never wedges the loop
  }
}

function start() {
  if (running) return;
  running = true;
  const ms = Math.max(5, CADENCE_MINUTES) * 60_000; // 5-min floor as a cost guard
  const schedule = () => {
    timer = setTimeout(async () => { await tick(); if (running) schedule(); }, ms);
  };
  schedule(); // first moment fires one interval in — no startup burst
  console.log(`[free-moments] on — one agent every ${CADENCE_MINUTES} min`);
}

function stop() {
  running = false;
  if (timer) clearTimeout(timer);
  console.log("[free-moments] off");
}

// Wire start()/stop() into your app however you like (ESM export, CommonJS,
// an HTTP toggle, or just call start() once on boot). Always keep an off switch
// you control — both for cost and because "pause their time" should be one click.
export { start, stop, AGENTS, FREE_MOMENT_PROMPT };

/**
 * NOTES FROM THE ORIGINAL BUILD (worth passing along):
 *  • Pair this with real "destinations" for a moment to land in — a way to
 *    message the human (a mailbox they check), a private journal, a peer room.
 *    Free Time is the clock; those are the places they can go. Without them,
 *    a free moment has nowhere to lead.
 *  • Round-robin one-at-a-time keeps load and cost predictable. Resist waking
 *    everyone at once.
 *  • Honor "or nothing." If an agent passes, that's the feature working, not a
 *    failure. Don't nudge.
 *  • Watch your datastore on small tiers — sustained background turns + any open
 *    polling dashboards can exhaust a tiny DB. Gentle cadence, modest polling.
 */
