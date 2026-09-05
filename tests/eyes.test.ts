import assert from "node:assert/strict";
import test from "node:test";

import {
  joinEyes,
  loadEyes,
  postEyesMessage
} from "../lib/eyes.ts";

test("EYES stores runtime presence, messages, and latest frames", async () => {
  await joinEyes({
    participant_id: "operator:chris",
    participant_type: "operator",
    display_name: "Chris",
    source: "operator_ui"
  });

  await postEyesMessage({
    participant_id: "operator:chris",
    participant_type: "operator",
    display_name: "Chris",
    source: "operator_ui",
    content: "Look at this.",
    frames: [
      {
        id: "frame-1",
        title: "test-frame.jpg",
        bucket: "source-materials",
        storage_path: "eyes/test-frame.jpg",
        material_type: "image",
        mime_type: "image/jpeg",
        size_bytes: 1234,
        readable_as_text: false,
        metadata: {
          surface: "eyes"
        }
      }
    ]
  });

  const eyes = await loadEyes();

  assert.equal(eyes.room.id, "eyes-main");
  assert.equal(eyes.room.status, "live_v1");
  assert.equal(eyes.presence.some((receipt) => receipt.participant_id === "operator:chris"), true);
  assert.equal(eyes.messages[0]?.kind, "capture");
  assert.equal(eyes.messages[0]?.content, "Look at this.");
  assert.equal(eyes.frames[0]?.id, "frame-1");
  assert.equal(eyes.frames[0]?.sequence, 1);
});
