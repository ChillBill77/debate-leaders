import assert from "node:assert/strict";
import { test } from "node:test";

import { checkpointPath, questionHash } from "../src/debate/checkpoint.js";

test("questionHash: deterministic and 12 hex chars", () => {
  const q = "Is BYD buying Volkswagen inevitable?";
  const h1 = questionHash(q);
  const h2 = questionHash(q);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{12}$/);
});

test("questionHash: different questions → different hashes", () => {
  assert.notEqual(questionHash("question A"), questionHash("question B"));
});

test("checkpointPath: lands in debates/ and embeds the hash", () => {
  const q = "some question";
  const p = checkpointPath(q);
  assert.match(p, /\/debates\/debate-checkpoint-[0-9a-f]{12}\.md$/);
  assert.ok(p.includes(questionHash(q)));
});

