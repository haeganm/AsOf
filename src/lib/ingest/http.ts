/**
 * The only place AsOf talks to the network.
 *
 * Both sources used are free and keyless, but they have conditions. SEC requires
 * a descriptive User-Agent and asks for under 10 requests a second; Yahoo's
 * endpoints are undocumented and should be treated as a courtesy. So: one
 * request at a time, a floor on the gap between them, a couple of retries, and a
 * hard rule that a failure here can never break a page render.
 */

const MIN_GAP_MS = 350;
let lastCallAt = 0;

/**
 * SEC requires automated requests to identify themselves with a contact address,
 * and enforces it: a User-Agent carrying a URL instead of an email is refused
 * with 403, while an email-shaped one is accepted. Verified against
 * sec.gov/files/company_tickers.json.
 *
 * Read from the environment so no real address is ever committed. Set
 * ASOF_USER_AGENT in .env.local to your own contact if you use this heavily —
 * that is SEC's stated expectation, not ours.
 */
function userAgent() {
  return process.env.ASOF_USER_AGENT ?? "AsOf/0.1 (local research tool; contact: asof-user@example.com)";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FetchFailed extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "FetchFailed";
  }
}

/** Serialised, rate-limited, retried GET returning parsed JSON. */
export async function getJson<T>(url: string, opts: { retries?: number } = {}): Promise<T> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const wait = Math.max(0, lastCallAt + MIN_GAP_MS - Date.now());
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": userAgent(), Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        // 4xx other than rate limiting will not improve on retry.
        if (res.status !== 429 && res.status < 500) {
          throw new FetchFailed(url, res.status, `${res.status} ${res.statusText}`);
        }
        throw new Error(`${res.status} ${res.statusText}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (err instanceof FetchFailed) throw err;
      if (attempt < retries) await sleep(600 * (attempt + 1));
    }
  }
  throw new FetchFailed(url, 0, `gave up after ${retries + 1} attempts: ${String(lastErr)}`);
}
