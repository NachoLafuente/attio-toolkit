/**
 * Minimal Attio API v2 client. Zero dependencies, uses global fetch (Node >= 18).
 *
 * Handles the two pagination styles the API actually uses:
 *   - limit/offset  : records, list entries, notes, tasks, threads, attributes, webhooks
 *   - limit/cursor  : emails, meetings, views  (response carries pagination.next_cursor)
 */

const BASE_URL = "https://api.attio.com";

export class AttioError extends Error {
  constructor(message, { status, path, body } = {}) {
    super(message);
    this.name = "AttioError";
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AttioClient {
  constructor({
    apiKey,
    baseUrl = process.env.ATTIO_API_BASE || BASE_URL,
    maxRetries = 5,
    fetchImpl = globalThis.fetch,
  } = {}) {
    if (!apiKey) throw new AttioError("Missing Attio API key");
    this.apiKey = apiKey;
    // Tolerate a base URL that already carries the version segment. People set
    // ATTIO_API_BASE to "https://api.attio.com/v2" all the time, and without
    // this every request would go to /v2/v2/... and 404.
    this.baseUrl = String(baseUrl)
      .replace(/\/+$/, "")
      .replace(/\/v\d+$/, "");
    this.maxRetries = maxRetries;
    this.fetch = fetchImpl;
    this.requestCount = 0;
  }

  async request(method, path, { query, body, signal } = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      this.requestCount++;
      let res;
      try {
        res = await this.fetch(url, {
          method,
          signal,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        // Network-level failure. Retry with backoff.
        lastErr = err;
        if (attempt === this.maxRetries) break;
        await sleep(backoffMs(attempt));
        continue;
      }

      if (res.ok) return res.status === 204 ? null : res.json();

      const text = await res.text().catch(() => "");

      // 429: honour Retry-After when present, otherwise back off.
      if (res.status === 429) {
        if (attempt === this.maxRetries) {
          throw new AttioError("Rate limited by Attio after retries", {
            status: 429,
            path,
            body: text,
          });
        }
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : backoffMs(attempt),
        );
        continue;
      }

      // 5xx is worth retrying. Everything else is a real error.
      if (res.status >= 500 && attempt < this.maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }

      throw new AttioError(
        `Attio ${method} ${path} failed with ${res.status}`,
        { status: res.status, path, body: truncate(text, 500) },
      );
    }

    throw new AttioError(`Attio ${method} ${path} failed: ${lastErr?.message}`, {
      path,
    });
  }

  get(path, query) {
    return this.request("GET", path, { query });
  }

  post(path, body) {
    return this.request("POST", path, { body });
  }

  /** Collect every page of a limit/offset endpoint into one array. */
  async collectOffset(method, path, { body, query, pageSize = 500, onPage } = {}) {
    const out = [];
    let offset = 0;
    for (;;) {
      const page =
        method === "POST"
          ? await this.request("POST", path, {
              body: { ...(body || {}), limit: pageSize, offset },
            })
          : await this.request("GET", path, {
              query: { ...(query || {}), limit: pageSize, offset },
            });
      const rows = page?.data ?? [];
      out.push(...rows);
      if (onPage) onPage(out.length);
      if (rows.length < pageSize) break;
      offset += pageSize;
    }
    return out;
  }

  /** Collect every page of a limit/cursor endpoint into one array. */
  async collectCursor(path, { query, pageSize = 50, onPage } = {}) {
    const out = [];
    let cursor;
    for (;;) {
      const page = await this.request("GET", path, {
        query: { ...(query || {}), limit: pageSize, cursor },
      });
      out.push(...(page?.data ?? []));
      if (onPage) onPage(out.length);
      cursor = page?.pagination?.next_cursor;
      if (!cursor) break;
    }
    return out;
  }
}

function backoffMs(attempt) {
  // 400ms, 800ms, 1.6s, 3.2s, 6.4s with jitter.
  return Math.round(400 * 2 ** attempt * (0.75 + Math.random() * 0.5));
}

function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n) + "..." : s;
}

/** Run `fn` over `items` with bounded concurrency, preserving input order. */
export async function pool(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
