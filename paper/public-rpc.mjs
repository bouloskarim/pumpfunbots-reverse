// Read-only public RPC. Broadcast and account-signing methods are refused.

export const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
export const READ_METHODS = new Set(["getSlot", "getSignaturesForAddress", "getTransaction"]);

export function assertReadMethod(method) {
  if (!READ_METHODS.has(method)) {
    const err = new Error(`paper RPC refuses ${method}`);
    err.code = "PAPER_RPC_FORBIDDEN";
    throw err;
  }
}

export async function publicRpc(method, params, opts = {}) {
  assertReadMethod(method);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const endpoint = opts.endpoint || DEFAULT_RPC;
  const maxAttempts = opts.maxAttempts ?? 4;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts.charge && !opts.charge()) {
      const err = new Error("paper RPC call budget exhausted");
      err.code = "PAPER_RPC_BUDGET";
      throw err;
    }
    let res;
    let body;
    try {
      res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      body = await res.json();
    } catch (error) {
      lastError = error;
      await sleep(400 * (attempt + 1));
      continue;
    }
    if (res.status === 429 || body?.error?.code === 429) {
      lastError = new Error("429");
      lastError.code = "PAPER_RPC_429";
      await sleep(800 * (attempt + 1));
      continue;
    }
    if (body?.error) {
      const err = new Error(body.error.message || "rpc error");
      err.code = body.error.code;
      throw err;
    }
    return body.result;
  }
  const err = lastError || new Error("rpc failed");
  if (!err.code) err.code = "PAPER_RPC_FAILED";
  throw err;
}
