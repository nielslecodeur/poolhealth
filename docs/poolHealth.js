// app/agent/src/poolHealth.ts
var RPC_URLS = ((typeof process !== "undefined" ? process.env.POOLHEALTH_RPC_URLS : undefined) ?? "https://bsc-dataseed.bnbchain.org,https://bsc-rpc.publicnode.com,https://bsc-dataseed1.binance.org").split(",").map((u) => u.trim()).filter(Boolean);
var RPC_TIMEOUT_MS = 8000;
var ZERO = "0x0000000000000000000000000000000000000000";
var DEAD = "0x000000000000000000000000000000000000dead";
var DEXES = [
  { name: "PancakeSwap V2", factory: "0xca143ce32fe78f1f7019d7d551a6402fc5350c73", feeBps: 25 },
  { name: "BiSwap", factory: "0x858e3312ed3a876947ea49d572a7c42de08af7ee", feeBps: 20 },
  { name: "ApeSwap", factory: "0x0841bd0b734e4f5853f0dd8d7ea041c241fb0da6", feeBps: 20 },
  { name: "MDEX", factory: "0x3cd1c46068daea5ebb0d3f55f6915b10648062b8", feeBps: 30 }
];
var KNOWN_TOKENS = {
  WBNB: { address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", symbol: "WBNB", decimals: 18 },
  USDT: { address: "0x55d398326f99059ff775485246999027b3197955", symbol: "USDT", decimals: 18 },
  USDC: { address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", symbol: "USDC", decimals: 18 },
  BUSD: { address: "0xe9e7cea3dedca5984780bafc599bd69add087d56", symbol: "BUSD", decimals: 18 },
  CAKE: { address: "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82", symbol: "CAKE", decimals: 18 },
  ETH: { address: "0x2170ed0880ac9a755fd29b2688956bd959f933f8", symbol: "ETH", decimals: 18 },
  BTCB: { address: "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", symbol: "BTCB", decimals: 18 }
};
var SYMBOL_ALIASES = { BNB: "WBNB", WETH: "ETH", BTC: "BTCB" };
var HUBS = [KNOWN_TOKENS.WBNB, KNOWN_TOKENS.USDT];

class RpcRevert extends Error {
}
var rpcId = 0;
async function ethCall(to, data) {
  let lastErr = new Error("no RPC endpoint configured");
  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++rpcId,
          method: "eth_call",
          params: [{ to, data }, "latest"]
        }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS)
      });
      if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.error)
        throw new RpcRevert(body.error.message ?? "rpc error");
      if (typeof body.result !== "string")
        throw new Error("malformed RPC reply");
      const hex = body.result.replace(/^0x/, "");
      return hex.length === 0 ? null : hex;
    } catch (e) {
      if (e instanceof RpcRevert)
        return null;
      lastErr = e;
    }
  }
  throw new Error(`BSC RPC unreachable: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}
var pad = (addr) => addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
var word = (hex, i) => hex.slice(i * 64, (i + 1) * 64);
var wordToAddr = (w) => `0x${w.slice(24)}`.toLowerCase();
var wordToBig = (w) => w.length === 0 ? 0n : BigInt(`0x${w}`);
async function callAddr(to, selector) {
  const hex = await ethCall(to, selector);
  return hex !== null && hex.length >= 64 ? wordToAddr(word(hex, 0)) : null;
}
async function callUint(to, data) {
  const hex = await ethCall(to, data);
  return hex !== null && hex.length >= 64 ? wordToBig(word(hex, 0)) : null;
}
function decodeString(hex) {
  let bytes;
  if (hex.length >= 192 && wordToBig(word(hex, 0)) === 32n) {
    const len = Number(wordToBig(word(hex, 1)));
    bytes = hex.slice(128, 128 + len * 2);
  } else {
    bytes = hex.slice(0, 64);
  }
  let out = "";
  for (let i = 0;i + 1 < bytes.length; i += 2) {
    const c = Number.parseInt(bytes.slice(i, i + 2), 16);
    if (c >= 32 && c < 127)
      out += String.fromCharCode(c);
  }
  return out.trim();
}
var tokenCache = new Map(Object.values(KNOWN_TOKENS).map((t) => [t.address, t]));
async function loadToken(address) {
  const addr = address.toLowerCase();
  const cached = tokenCache.get(addr);
  if (cached)
    return cached;
  const [dec, sym] = await Promise.all([
    callUint(addr, "0x313ce567"),
    ethCall(addr, "0x95d89b41")
  ]);
  if (dec === null || dec > 36n)
    return null;
  const token = {
    address: addr,
    symbol: (sym ? decodeString(sym) : "") || `${addr.slice(0, 6)}…${addr.slice(-4)}`,
    decimals: Number(dec)
  };
  tokenCache.set(addr, token);
  return token;
}
function parseUnits(value, decimals) {
  const [whole = "0", frac = ""] = value.replace(",", ".").split(".");
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}
function formatUnits(value, decimals, maxFrac = 6) {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  let frac = (value % base).toString().padStart(decimals, "0").slice(0, maxFrac);
  frac = frac.replace(/0+$/, "");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${wholeStr}.${frac}` : wholeStr;
}
var round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
function verdictFor(impactPct) {
  if (impactPct < 1)
    return "GREEN";
  if (impactPct < 5)
    return "ORANGE";
  return "RED";
}
async function findPair(dex, a, b) {
  const pair = await callAddr(dex.factory, `0xe6a43905${pad(a)}${pad(b)}`);
  return pair !== null && pair !== ZERO ? pair : null;
}
async function quotePool(dexName, feeBps, pair, tokenIn, tokenOut, amountIn, withLpBurn) {
  const reserves = await ethCall(pair, "0x0902f1ac");
  if (reserves === null || reserves.length < 128)
    return null;
  const r0 = wordToBig(word(reserves, 0));
  const r1 = wordToBig(word(reserves, 1));
  const inIsToken0 = BigInt(tokenIn.address) < BigInt(tokenOut.address);
  const rIn = inIsToken0 ? r0 : r1;
  const rOut = inIsToken0 ? r1 : r0;
  if (rIn === 0n || rOut === 0n)
    return null;
  const inWithFee = amountIn * BigInt(1e4 - feeBps);
  const denom = rIn * 10000n + inWithFee;
  const out = inWithFee * rOut / denom;
  if (out === 0n)
    return null;
  const priceImpactPct = Number(inWithFee) / Number(denom) * 100;
  const idealOut = Number(amountIn) * Number(rOut) / Number(rIn);
  const totalLossPct = idealOut > 0 ? (1 - Number(out) / idealOut) * 100 : 100;
  const maxIn = rIn / 99n * 10000n / BigInt(1e4 - feeBps);
  let lpBurnedPct = null;
  if (withLpBurn) {
    const [supply, dead, zero] = await Promise.all([
      callUint(pair, "0x18160ddd"),
      callUint(pair, `0x70a08231${pad(DEAD)}`),
      callUint(pair, `0x70a08231${pad(ZERO)}`)
    ]);
    if (supply !== null && supply > 0n) {
      const burned = (dead ?? 0n) + (zero ?? 0n);
      lpBurnedPct = round(Number(burned) / Number(supply) * 100, 2);
    }
  }
  return {
    dex: dexName,
    pair,
    feeBps,
    reserveIn: `${formatUnits(rIn, tokenIn.decimals, 2)} ${tokenIn.symbol}`,
    reserveOut: `${formatUnits(rOut, tokenOut.decimals, 2)} ${tokenOut.symbol}`,
    amountOut: `${formatUnits(out, tokenOut.decimals)} ${tokenOut.symbol}`,
    amountOutRaw: out,
    priceImpactPct: round(priceImpactPct, 3),
    totalLossPct: round(totalLossPct, 3),
    maxInUnder1Pct: `${formatUnits(maxIn, tokenIn.decimals, 4)} ${tokenIn.symbol}`,
    lpBurnedPct,
    verdict: verdictFor(priceImpactPct)
  };
}
var PANCAKE_V3_QUOTER = "0xb048bbc1ee6b733fffcfb9e9cef7375518e25997";
var V3_FEE_TIERS = [100, 500, 2500, 1e4];
async function v3Out(tokenIn, tokenOut, amountIn, fee) {
  const data = "0xc6a5026a" + pad(tokenIn.address) + pad(tokenOut.address) + amountIn.toString(16).padStart(64, "0") + fee.toString(16).padStart(64, "0") + "0".repeat(64);
  const out = await callUint(PANCAKE_V3_QUOTER, data);
  return out !== null && out > 0n ? out : null;
}
async function quoteV3(tokenIn, tokenOut, amountIn) {
  const probe = amountIn / 1000n > 0n ? amountIn / 1000n : amountIn;
  const quotes = await Promise.all(V3_FEE_TIERS.map(async (fee) => {
    try {
      const [out, outProbe] = await Promise.all([
        v3Out(tokenIn, tokenOut, amountIn, fee),
        v3Out(tokenIn, tokenOut, probe, fee)
      ]);
      if (out === null || outProbe === null)
        return null;
      const ratio = Number(out) / Number(amountIn) / (Number(outProbe) / Number(probe));
      const priceImpactPct = Math.max(0, (1 - ratio) * 100);
      return {
        dex: `PancakeSwap V3 (${fee / 1e4}% tier)`,
        pair: "",
        feeBps: fee / 100,
        reserveIn: "n/a (V3)",
        reserveOut: "n/a (V3)",
        amountOut: `${formatUnits(out, tokenOut.decimals)} ${tokenOut.symbol}`,
        amountOutRaw: out,
        priceImpactPct: round(priceImpactPct, 3),
        totalLossPct: round(priceImpactPct + fee / 1e4, 3),
        maxInUnder1Pct: "n/a (V3)",
        lpBurnedPct: null,
        verdict: verdictFor(priceImpactPct)
      };
    } catch {
      return null;
    }
  }));
  return quotes.filter((q) => q !== null);
}
async function quoteAllDexes(tokenIn, tokenOut, amountIn, withLpBurn) {
  const v3 = quoteV3(tokenIn, tokenOut, amountIn);
  const v2 = await Promise.all(DEXES.map(async (dex) => {
    try {
      const pair = await findPair(dex, tokenIn.address, tokenOut.address);
      if (pair === null)
        return null;
      return await quotePool(dex.name, dex.feeBps, pair, tokenIn, tokenOut, amountIn, withLpBurn);
    } catch {
      return null;
    }
  }));
  const all = [...v2.filter((q) => q !== null), ...await v3].sort((a, b) => a.amountOutRaw > b.amountOutRaw ? -1 : 1);
  const usable = all.filter((q) => q.priceImpactPct < 99);
  return usable.length > 0 ? usable : all;
}
var STOPWORDS = new Set(("swap swaps swapping sell buy trade trading exchange convert change to into " + "for from of on in with and or the a an my me i want how much is it can " + "check pool pools pair amount tokenin tokenout token tokens liquidity route " + "best price impact please what if en vers contre pour de du des le la les un " + "une mon ma mes je veux combien est ce que avec sur et ou dans par echanger " + "échanger vendre acheter convertir analyse analyser verifier vérifier " + "chain smart dex v2 v3 you your we our are was were be been accepted paid " + "following job produce deliverable deliverables now complete self contained " + "context task terms report health data live quality standards safe at size " + "this that will would should give get need using use").split(/\s+/));
function parseRequest(text) {
  const cleaned = text.replace(/\bBNB\s+(Smart\s+)?Chain\b/gi, " ");
  const found = [];
  for (const m of cleaned.matchAll(/0x[a-fA-F0-9]{40}(?![a-fA-F0-9])/g)) {
    found.push({ index: m.index ?? 0, ref: m[0].toLowerCase() });
  }
  const noAddr = cleaned.replace(/0x[a-fA-F0-9]{40}/g, (s) => " ".repeat(s.length));
  for (const m of noAddr.matchAll(/(?<![A-Za-z])([A-Za-z$][A-Za-z0-9$]{1,14})(?![A-Za-z0-9])/g)) {
    const word = m[1].replace(/^\$/, "");
    const upper = word.toUpperCase();
    let ref = null;
    if (SYMBOL_ALIASES[upper])
      ref = SYMBOL_ALIASES[upper];
    else if (KNOWN_TOKENS[upper])
      ref = upper;
    else if (!STOPWORDS.has(word.toLowerCase()) && word.length >= 2)
      ref = `?${upper}`;
    if (ref)
      found.push({ index: m.index ?? 0, ref });
  }
  found.sort((a, b) => a.index - b.index);
  const refs = [];
  for (const f of found)
    if (!refs.includes(f.ref))
      refs.push(f.ref);
  const num = "(\\d+(?:[.,]\\d+)?)";
  const amount = noAddr.match(new RegExp(`amount\\w*["'\\s:=]*${num}`, "i"))?.[1] ?? noAddr.match(new RegExp(`${num}\\s*[A-Za-z$]`))?.[1] ?? noAddr.match(new RegExp(`(?:swap|sell|trade|buy)\\w*\\s+${num}`, "i"))?.[1] ?? noAddr.match(/(\d+(?:[.,]\d+)?)/)?.[1] ?? null;
  return { refs, amount };
}
async function searchSymbol(symbol) {
  const queries = [`${symbol} WBNB`, `${symbol} USDT`, symbol];
  const liq = new Map;
  await Promise.all(queries.map(async (q) => {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(RPC_TIMEOUT_MS) });
      if (!res.ok)
        return;
      const body = await res.json();
      const seen = new Set;
      for (const p of body.pairs ?? []) {
        if (p.chainId !== "bsc" || !p.pairAddress || seen.has(p.pairAddress))
          continue;
        seen.add(p.pairAddress);
        for (const side of [p.baseToken, p.quoteToken]) {
          if (side?.address && side.symbol?.toUpperCase() === symbol) {
            const a = side.address.toLowerCase();
            liq.set(a, Math.max(liq.get(a) ?? 0, 0) + (p.liquidity?.usd ?? 0));
          }
        }
      }
    } catch {}
  }));
  if (liq.size === 0)
    return null;
  const ranked = [...liq.entries()].sort((a, b) => b[1] - a[1]);
  const [address, liquidityUsd] = ranked[0];
  return {
    address,
    candidates: ranked.length,
    liquidityUsd,
    others: ranked.slice(1, 4).map(([a, l]) => ({ address: a, liquidityUsd: l }))
  };
}
var usd = (n) => n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`;
async function resolveRef(ref, notes) {
  if (ref.startsWith("0x"))
    return loadToken(ref);
  if (!ref.startsWith("?"))
    return KNOWN_TOKENS[ref] ?? null;
  const symbol = ref.slice(1);
  const match = await searchSymbol(symbol);
  if (!match)
    return null;
  const token = await loadToken(match.address);
  if (!token)
    return null;
  if (match.candidates > 1) {
    notes.push(`${symbol} matches ${match.candidates} different tokens on BSC. Using ` + `${match.address} (the most liquid, about ${usd(match.liquidityUsd)} listed). ` + `Others: ${match.others.map((o) => `${o.address} (${usd(o.liquidityUsd)})`).join(", ")}. ` + "Copycat tokens reuse popular names: check the address before you trade.");
  } else {
    notes.push(`${symbol} resolved to ${match.address} (about ${usd(match.liquidityUsd)} listed on BSC).`);
  }
  return token;
}
var USAGE = 'Send a token pair and an amount, e.g. "swap 5 BNB to CAKE", ' + '"tokenIn 0x… tokenOut 0x… amount 1000", or a single V2 pool address with ' + "an amount. Any BSC token symbol works (it is looked up by liquidity); a " + "token address is the most precise.";
async function analyzeRequest(text) {
  const parsed = parseRequest(text);
  let tokenIn = null;
  let tokenOut = null;
  let requestedPool;
  let requestedFactory = null;
  const notes = [];
  for (const ref of parsed.refs.filter((r) => r.startsWith("0x")).slice(0, 2)) {
    const [t0, t1, factory] = await Promise.all([
      callAddr(ref, "0x0dfe1681"),
      callAddr(ref, "0xd21220a7"),
      callAddr(ref, "0xc45a0155")
    ]);
    if (t0 === null || t1 === null || t0 === ZERO || t1 === ZERO)
      continue;
    requestedPool = ref;
    requestedFactory = factory;
    const named = parsed.refs.filter((r) => r !== ref).map((r) => r.startsWith("0x") ? r : KNOWN_TOKENS[r]?.address).find((a) => a === t0 || a === t1);
    const sell = named ?? t0;
    [tokenIn, tokenOut] = await Promise.all([
      loadToken(sell),
      loadToken(sell === t0 ? t1 : t0)
    ]);
    break;
  }
  if (!requestedPool) {
    const resolved = [];
    for (const ref of parsed.refs.slice(0, 5)) {
      const t = await resolveRef(ref, notes);
      if (t && !resolved.some((r) => r.address === t.address))
        resolved.push(t);
      if (resolved.length === 2)
        break;
    }
    if (resolved.length === 2)
      [tokenIn, tokenOut] = resolved;
  }
  if (tokenIn === null || tokenOut === null) {
    return {
      ok: false,
      error: `Could not identify two tokens (or one V2 pool) in the request. ` + (notes.length ? `${notes.join(" ")} ` : "") + USAGE
    };
  }
  if (tokenIn.address === tokenOut.address) {
    return { ok: false, error: `Both tokens are the same (${tokenIn.symbol}). ${USAGE}` };
  }
  const amountStr = parsed.amount ?? "1";
  const amountIn = parseUnits(amountStr, tokenIn.decimals);
  if (amountIn <= 0n) {
    return { ok: false, error: `The swap amount must be greater than zero. ${USAGE}` };
  }
  const pools = await quoteAllDexes(tokenIn, tokenOut, amountIn, true);
  if (requestedPool && !pools.some((p) => p.pair === requestedPool)) {
    const known = DEXES.find((d) => d.factory === requestedFactory);
    const q = await quotePool(known?.name ?? "Unlisted DEX (fee assumed 0.25%)", known?.feeBps ?? 25, requestedPool, tokenIn, tokenOut, amountIn, true);
    if (q)
      pools.push(q);
    pools.sort((a, b) => a.amountOutRaw > b.amountOutRaw ? -1 : 1);
  }
  const best = pools[0];
  let twoHop = null;
  if (!best || best.verdict !== "GREEN") {
    for (const hub of HUBS) {
      if (hub.address === tokenIn.address || hub.address === tokenOut.address)
        continue;
      const leg1 = (await quoteAllDexes(tokenIn, hub, amountIn, false))[0];
      if (!leg1 || leg1.amountOutRaw === 0n)
        continue;
      const leg2 = (await quoteAllDexes(hub, tokenOut, leg1.amountOutRaw, false))[0];
      if (!leg2)
        continue;
      if (twoHop === null || leg2.amountOutRaw > twoHop.amountOutRaw) {
        twoHop = {
          via: hub.symbol,
          legs: [leg1, leg2].map((l) => ({
            dex: l.dex,
            pair: l.pair,
            priceImpactPct: l.priceImpactPct
          })),
          amountOut: leg2.amountOut,
          amountOutRaw: leg2.amountOutRaw
        };
      }
    }
  }
  const swapLabel = `${amountStr} ${tokenIn.symbol} → ${tokenOut.symbol}`;
  let verdict;
  let recommendation;
  const hopBeatsDirect = twoHop !== null && (!best || twoHop.amountOutRaw > best.amountOutRaw);
  if (!best && !twoHop) {
    verdict = "RED";
    recommendation = `No pool with liquidity was found for ${tokenIn.symbol}/${tokenOut.symbol} ` + `on ${DEXES.map((d) => d.name).join(", ")}, directly or through ` + `${HUBS.map((h) => h.symbol).join(" / ")}. Do not swap ${swapLabel} on these DEXes.`;
  } else if (hopBeatsDirect && twoHop) {
    const worst = Math.max(...twoHop.legs.map((l) => l.priceImpactPct));
    verdict = verdictFor(worst);
    recommendation = `Route through ${twoHop.via}: ${twoHop.legs.map((l) => l.dex).join(" then ")} ` + `returns ${twoHop.amountOut}` + (best ? `, more than the best direct pool (${best.dex}: ${best.amountOut}).` : "; there is no direct pool.");
  } else if (best) {
    verdict = best.verdict;
    const other = pools.find((p) => p.pair !== best.pair);
    recommendation = `Use ${best.dex}${best.pair ? ` (${best.pair})` : ""}: ${swapLabel} returns ${best.amountOut} ` + `with ${best.priceImpactPct}% price impact.` + (other ? ` Next best is ${other.dex} with ${other.amountOut}.` : " It is the only pool found.") + (best.verdict !== "GREEN" && !best.maxInUnder1Pct.startsWith("n/a") ? ` To stay under 1% impact, keep each order below ${best.maxInUnder1Pct}.` : best.verdict !== "GREEN" ? " Consider splitting the order into smaller swaps." : "");
  } else {
    verdict = "RED";
    recommendation = "No usable route.";
  }
  if (requestedPool && best && best.pair !== requestedPool && !hopBeatsDirect) {
    const asked = pools.find((p) => p.pair === requestedPool);
    if (asked) {
      recommendation += ` The pool you asked about (${asked.dex}) returns ${asked.amountOut} ` + `at ${asked.priceImpactPct}% impact — a replacement pool is better.`;
    }
  }
  const [priceUsd, ownerChecks] = await Promise.all([
    tokenUsdPrice(tokenIn).catch(() => null),
    Promise.all([tokenIn, tokenOut].map((t) => ownerCheck(t).catch(() => null)))
  ]);
  const amountInUsd = priceUsd !== null ? Number(amountStr.replace(",", ".")) * priceUsd : null;
  const bestOut = pools[0]?.amountOutRaw;
  for (const p of pools) {
    p.lossUsd = amountInUsd !== null && bestOut !== undefined && bestOut > 0n ? round(amountInUsd * (1 - Number(p.amountOutRaw) / Number(bestOut)), 2) : null;
  }
  let execution = null;
  const chosenOut = hopBeatsDirect && twoHop ? twoHop.amountOutRaw : best?.amountOutRaw;
  if (chosenOut !== undefined && chosenOut > 0n && verdict !== "RED") {
    const slippagePct = verdict === "GREEN" ? 0.5 : 1;
    const minOut = chosenOut * BigInt(Math.round((100 - slippagePct) * 100)) / 10000n;
    const routeLossPct = hopBeatsDirect || !best ? null : best.totalLossPct;
    execution = {
      slippagePct,
      minimumReceived: `${formatUnits(minOut, tokenOut.decimals)} ${tokenOut.symbol}`,
      amountInUsd: amountInUsd !== null ? round(amountInUsd, 2) : null,
      costUsd: amountInUsd !== null && routeLossPct !== null ? round(amountInUsd * routeLossPct / 100, 2) : null,
      pancakeSwapUrl: pancakeSwapUrl(tokenIn, tokenOut, amountStr)
    };
  }
  return {
    ok: true,
    swap: { tokenIn, tokenOut, amountIn: amountStr, amountAssumed: parsed.amount === null },
    requestedPool,
    pools,
    best,
    twoHop,
    verdict,
    recommendation,
    execution,
    tokenChecks: ownerChecks.filter((c) => c !== null),
    generatedAt: new Date().toISOString(),
    notes
  };
}
var STABLES = new Set([KNOWN_TOKENS.USDT, KNOWN_TOKENS.USDC, KNOWN_TOKENS.BUSD].map((t) => t.address));
async function tokenUsdPrice(token) {
  if (STABLES.has(token.address))
    return 1;
  const usdt = KNOWN_TOKENS.USDT;
  const wbnb = KNOWN_TOKENS.WBNB;
  const unit = 10n ** BigInt(token.decimals);
  const probe = unit / 100n > 0n ? unit / 100n : 1n;
  const toUsd = (out) => Number(out) / 10 ** usdt.decimals / (Number(probe) / 10 ** token.decimals);
  const direct = (await quoteAllDexes(token, usdt, probe, false))[0];
  if (direct && direct.priceImpactPct < 5)
    return toUsd(direct.amountOutRaw);
  if (token.address === wbnb.address)
    return direct ? toUsd(direct.amountOutRaw) : null;
  const leg1 = (await quoteAllDexes(token, wbnb, probe, false))[0];
  if (!leg1)
    return direct ? toUsd(direct.amountOutRaw) : null;
  const leg2 = (await quoteAllDexes(wbnb, usdt, leg1.amountOutRaw, false))[0];
  return leg2 ? toUsd(leg2.amountOutRaw) : null;
}
async function ownerCheck(token) {
  if (Object.values(KNOWN_TOKENS).some((t) => t.address === token.address))
    return null;
  const owner = await callAddr(token.address, "0x8da5cb5b");
  if (owner === null) {
    return {
      token: token.symbol,
      address: token.address,
      owner: "none",
      message: `${token.symbol} exposes no owner() function: ownership could not be checked.`
    };
  }
  if (owner === ZERO || owner === DEAD) {
    return {
      token: token.symbol,
      address: token.address,
      owner: "renounced",
      message: `${token.symbol} ownership is renounced: no admin can change the contract settings.`
    };
  }
  return {
    token: token.symbol,
    address: token.address,
    owner: "active",
    ownerAddress: owner,
    message: `${token.symbol} still has an owner (${owner}). Depending on the contract, ` + "the owner may be able to change fees, pause trading or blacklist wallets."
  };
}
function pancakeSwapUrl(tokenIn, tokenOut, amount) {
  const id = (t) => t.address === KNOWN_TOKENS.WBNB.address ? "BNB" : t.address;
  return "https://pancakeswap.finance/swap?chain=bsc" + `&inputCurrency=${id(tokenIn)}&outputCurrency=${id(tokenOut)}` + `&exactAmount=${encodeURIComponent(amount.replace(",", "."))}&exactField=input`;
}
var ICON = { GREEN: "\uD83D\uDFE2", ORANGE: "\uD83D\uDFE0", RED: "\uD83D\uDD34" };
var money = (n) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;
function reportData(report) {
  return JSON.parse(JSON.stringify(report, (key, value) => key === "amountOutRaw" || typeof value === "bigint" ? undefined : value));
}
function renderReport(report, analystNote) {
  if (!report.ok || !report.swap || !report.verdict) {
    return `# poolhealth — request not understood

${report.error ?? USAGE}
`;
  }
  const { tokenIn, tokenOut, amountIn, amountAssumed } = report.swap;
  const lines = [];
  lines.push(`# poolhealth — ${amountIn} ${tokenIn.symbol} → ${tokenOut.symbol}`);
  lines.push("");
  lines.push(`**Verdict: ${ICON[report.verdict]} ${report.verdict}**`);
  lines.push("");
  lines.push(report.recommendation ?? "");
  for (const n of report.notes ?? []) {
    lines.push("");
    lines.push(`> ${n}`);
  }
  if (amountAssumed) {
    lines.push("");
    lines.push(`_No amount was given, so 1 ${tokenIn.symbol} was assumed._`);
  }
  const ex = report.execution;
  const checks = report.tokenChecks ?? [];
  if (ex || checks.length > 0) {
    lines.push("");
    lines.push("## Before you sign");
    lines.push("");
    if (ex) {
      if (ex.amountInUsd !== null) {
        lines.push(`- Order value: about ${money(ex.amountInUsd)}.`);
      }
      if (ex.costUsd !== null) {
        lines.push(`- Cost of this swap on the recommended pool (fees + price impact): about ${money(ex.costUsd)}.`);
      }
      lines.push(`- Set your slippage tolerance to **${ex.slippagePct}%**: minimum received **${ex.minimumReceived}**. Price impact is already in the quote; the tolerance only covers price moves before you sign.`);
      lines.push(`- Open this swap on PancakeSwap: ${ex.pancakeSwapUrl}`);
    }
    for (const c of checks) {
      lines.push(`- ${c.owner === "active" ? "⚠ " : ""}${c.message}`);
    }
  }
  lines.push("");
  lines.push("## Direct pools");
  lines.push("");
  if (report.pools && report.pools.length > 0) {
    lines.push("| DEX | You receive | Price impact | Lost vs best pool (USD) | Total loss vs spot | Max order under 1% | LP burned | Pool liquidity |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const p of report.pools) {
      lines.push(`| ${ICON[p.verdict]} ${p.dex} | ${p.amountOut} | ${p.priceImpactPct}% | ` + `${p.lossUsd == null ? "n/a" : money(p.lossUsd)} | ` + `${p.totalLossPct}% | ${p.maxInUnder1Pct} | ` + `${p.lpBurnedPct === null ? "n/a" : `${p.lpBurnedPct}%`} | ` + `${p.reserveIn} / ${p.reserveOut} |`);
    }
    lines.push("");
    for (const p of report.pools)
      if (p.pair)
        lines.push(`- ${p.dex}: \`${p.pair}\``);
  } else {
    lines.push("None found.");
  }
  if (report.twoHop) {
    lines.push("");
    lines.push("## Two-hop route");
    lines.push("");
    lines.push(`Via ${report.twoHop.via}: ` + report.twoHop.legs.map((l) => `${l.dex} (${l.priceImpactPct}% impact)`).join(" → ") + ` → **${report.twoHop.amountOut}**`);
  }
  if (analystNote) {
    lines.push("");
    lines.push("## In plain words");
    lines.push("");
    lines.push(analystNote);
  }
  lines.push("");
  lines.push("## How to read this");
  lines.push("");
  lines.push("- Verdict: GREEN under 1% price impact, ORANGE from 1% to 5%, RED above 5% or no route.");
  lines.push("- LP burned: share of the pool's LP tokens sent to a dead address. A low share means liquidity can be withdrawn; liquidity held in a lock contract is not detected.");
  lines.push("- V2 pools are read from their reserves; PancakeSwap V3 is quoted through its on-chain quoter (no reserves, max-order or LP-burned figures for V3).");
  lines.push(`- Read live from BSC mainnet at ${report.generatedAt}. Fees are each DEX's nominal fee. Not financial advice.`);
  lines.push("");
  lines.push("## Data");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(reportData(report), null, 2));
  lines.push("```");
  return lines.join(`
`);
}
export {
  analyzeRequest,
  parseRequest,
  renderReport,
  reportData
};
