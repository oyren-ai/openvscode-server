// URI gate tests: everything the plan's "Stable URI format" section says must be rejected, is —
// BEFORE any HTTP. One accepted shape per class, every rejection explicit.
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { parseSessionResource, durablePath, KINDS } = require("./sessionResource")
const { resource } = require("./fakes")

const U = "6bf52dd0-8b2b-4a2d-bd17-25352e3ab7ea"

test("durable resources round-trip for every contributed kind", () => {
  for (const { type } of KINDS) {
    assert.deepEqual(parseSessionResource(resource(type, U), type), { kind: type, id: U, untitled: false })
    assert.equal(durablePath(U), `/${U}`)
  }
})

test("untitled resources derive the durable UUID (idempotent retries)", () => {
  assert.deepEqual(parseSessionResource(resource("codex-cli", U, true), "codex-cli"),
    { kind: "codex-cli", id: U, untitled: true })
})

test("kind mismatch and unknown schemes are rejected", () => {
  assert.equal(parseSessionResource(resource("gemini-cli", U), "codex-cli"), null)
  assert.equal(parseSessionResource(resource("not-an-agent", U)), null)
  assert.equal(parseSessionResource(null, "codex-cli"), null)
})

test("authority, query, and fragment are rejected", () => {
  assert.equal(parseSessionResource({ ...resource("codex-cli", U), authority: "evil.example" }, "codex-cli"), null)
  assert.equal(parseSessionResource({ ...resource("codex-cli", U), query: "x=1" }, "codex-cli"), null)
  assert.equal(parseSessionResource({ ...resource("codex-cli", U), fragment: "f" }, "codex-cli"), null)
})

test("non-canonical ids are rejected: uppercase, junk, truncation", () => {
  for (const bad of [U.toUpperCase(), "not-a-uuid", U.slice(1), `${U}0`, `untitled-${U.toUpperCase()}`])
    assert.equal(parseSessionResource({ ...resource("codex-cli", U), path: `/${bad}` }, "codex-cli"), null)
})

test("extra segments, separators, traversal, and encoding tricks are rejected", () => {
  for (const path of [`/${U}/x`, `/a/${U}`, `/${U}%2fx`, `/..%2f${U}`, `/../${U}`, U, "/", ""])
    assert.equal(parseSessionResource({ ...resource("codex-cli", U), path }, "codex-cli"), null)
})

test("durablePath refuses to build a path from a non-canonical id", () => {
  assert.throws(() => durablePath("=;evil"), /canonical/)
  assert.throws(() => durablePath(U.toUpperCase()), /canonical/)
})
