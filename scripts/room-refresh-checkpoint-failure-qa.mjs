#!/usr/bin/env node
// Preview-only integration QA for Room Refresh source-window safety.
//
// This intentionally creates a valid ready archive, changes the live source
// window, proves finalization refuses the stale checkpoint, then records the
// same checkpoint_failed receipt the runtime wrapper would preserve. It never
// touches soren-main or production data.

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the preview branch.");
}

const agent = "soren";
const conversationId = `soren-room-refresh-checkpoint-failure-qa-${randomUUID()}`;
const archiveId = randomUUID();
const checkpointId = randomUUID();
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false }
});

await requireOk(
  supabase.from("conversations").upsert({
    id: conversationId,
    agent,
    token_count: 0,
    compaction_count: 0,
    updated_at: new Date().toISOString()
  }),
  "create isolated QA conversation"
);

await requireOk(
  supabase.from("conversation_messages").insert([
    {
      conversation_id: conversationId,
      position: 0,
      role: "user",
      source: "room_refresh_failure_qa",
      content: "QA source message one."
    },
    {
      conversation_id: conversationId,
      position: 1,
      role: "assistant",
      source: "room_refresh_failure_qa",
      content: "QA source message two."
    }
  ]),
  "seed archive source"
);

await requireOk(
  supabase.from("compaction_archives").insert({
    id: archiveId,
    agent,
    archive_status: "ready",
    conversation_id: conversationId,
    latest_checkpoint_position: null,
    message_count: 2,
    proposal_id: null,
    ready_at: new Date().toISOString(),
    source: "room_refresh_failure_qa",
    source_digest: "preview-qa-source-window-change",
    source_end_position: 1
  }),
  "create ready archive"
);

await requireOk(
  supabase.from("compaction_archive_messages").insert([
    {
      archive_id: archiveId,
      conversation_id: conversationId,
      position: 0,
      role: "user",
      content: "QA source message one."
    },
    {
      archive_id: archiveId,
      conversation_id: conversationId,
      position: 1,
      role: "assistant",
      content: "QA source message two."
    }
  ]),
  "preserve ready archive messages"
);

// This is the only difference between a valid archive and a stale one.
await requireOk(
  supabase.from("conversation_messages").insert({
    conversation_id: conversationId,
    position: 2,
    role: "user",
    source: "room_refresh_failure_qa",
    content: "Late message: the source window moved after archive readiness."
  }),
  "introduce source-window change"
);

const { error: finalizeError } = await supabase.rpc("finalize_compaction_archive", {
  p_agent: agent,
  p_archive_id: archiveId,
  p_checkpoint_content: "This checkpoint must not be written.",
  p_checkpoint_id: checkpointId,
  p_conversation_id: conversationId,
  p_proposal_id: null,
  p_require_agent_approval: false
});

if (!finalizeError || !/source window changed/i.test(finalizeError.message)) {
  throw new Error(
    `Expected source-window refusal, received: ${finalizeError?.message ?? "successful finalization"}`
  );
}

await requireOk(
  supabase
    .from("compaction_archives")
    .update({
      archive_status: "checkpoint_failed",
      failure_reason: `QA source-window refusal: ${finalizeError.message}`
    })
    .eq("id", archiveId)
    .eq("archive_status", "ready"),
  "record checkpoint failure receipt"
);

const [{ data: archive, error: archiveError }, { data: checkpoint, error: checkpointError }] = await Promise.all([
  supabase
    .from("compaction_archives")
    .select("id, archive_status, message_count, source_end_position, failure_reason")
    .eq("id", archiveId)
    .single(),
  supabase
    .from("conversation_messages")
    .select("id")
    .eq("id", checkpointId)
    .maybeSingle()
]);

if (archiveError) {
  throw new Error(`Could not read QA archive receipt: ${archiveError.message}`);
}
if (checkpointError) {
  throw new Error(`Could not inspect forbidden checkpoint: ${checkpointError.message}`);
}
if (checkpoint) {
  throw new Error("Finalization wrote a checkpoint even though the source window changed.");
}

console.log(JSON.stringify({
  ok: true,
  archive,
  checkpoint_written: false,
  refusal: finalizeError.message,
  conversation_id: conversationId
}, null, 2));

async function requireOk(request, label) {
  const { error } = await request;
  if (error) {
    throw new Error(`Could not ${label}: ${error.message}`);
  }
}
