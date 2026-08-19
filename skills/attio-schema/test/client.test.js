import test from "node:test";
import assert from "node:assert/strict";

import { AttioClient } from "../src/client.js";

const stub = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [] }) });

test("default base url", () => {
  const api = new AttioClient({ apiKey: "k", baseUrl: "https://api.attio.com" });
  assert.equal(api.baseUrl, "https://api.attio.com");
});

test("a base url carrying the version segment does not double up", () => {
  // Setting ATTIO_API_BASE to ".../v2" is a common and reasonable mistake.
  // Without normalisation every request lands on /v2/v2/... and 404s.
  for (const base of [
    "https://api.attio.com/v2",
    "https://api.attio.com/v2/",
    "https://api.attio.com/v2///",
  ]) {
    const api = new AttioClient({ apiKey: "k", baseUrl: base });
    assert.equal(api.baseUrl, "https://api.attio.com", `failed for ${base}`);
  }
});

test("requests are built against the normalised base", async () => {
  const seen = [];
  const api = new AttioClient({
    apiKey: "k",
    baseUrl: "https://api.attio.com/v2",
    fetchImpl: (url) => {
      seen.push(String(url));
      return stub();
    },
  });

  await api.get("/v2/objects");
  assert.deepEqual(seen, ["https://api.attio.com/v2/objects"]);
});

test("a self-hosted base with a path prefix is left alone", () => {
  const api = new AttioClient({ apiKey: "k", baseUrl: "https://proxy.internal/attio" });
  assert.equal(api.baseUrl, "https://proxy.internal/attio");
});

test("a missing key fails immediately rather than at request time", () => {
  assert.throws(() => new AttioClient({}), /Missing Attio API key/);
});
