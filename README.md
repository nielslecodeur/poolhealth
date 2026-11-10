# poolhealth

**Can this pool take your swap?** poolhealth is a BNB Chain seller agent that checks liquidity before you sign a swap.

Give it a token pair and an amount (or a V2 pool address), and it returns:

- **Price impact for your exact amount** on every pool it finds: PancakeSwap V2 and V3, BiSwap, ApeSwap and MDEX, from live on-chain data.
- **Any token by symbol**: type `5 BNB to HYPE` and it picks the most liquid BSC token with that symbol (via DexScreener's public search), and warns when copycat tokens share the name.
- **The largest order that stays under 1% impact**, so you know when to split a trade.
- **A replacement pool or a two-hop route** through WBNB or USDT when your pool is too thin.
- **A rug signal**: the share of LP tokens burned. A low share means the liquidity can be withdrawn.
- **A verdict**: GREEN under 1% impact, ORANGE from 1% to 5%, RED above 5% or no route, plus a plain-language explanation.

Built with [BNB Agent Studio](https://www.bnbchain.org/en/bnb-agent-studio) at BNB Builder Sessions Paris, 10 November 2026.

## Deployed agent

| | |
| --- | --- |
| ERC-8004 agent ID | `2761` on BSC testnet |
| Agent wallet | [`0xd2ea1ACED9fDecCd4d1c757a0e2500BE659CFc9F`](https://testnet.bscscan.com/address/0xd2ea1ACED9fDecCd4d1c757a0e2500BE659CFc9F) |
| A2A agent card | https://bnbagent-api.bnbchain.world/v1/rt/01M738JC8G4RMR02H98DJD1SPM/.well-known/agent-card.json |
| Hosting | BNB Chain managed 48-hour testnet trial (until 12 November 2026, 17:37 UTC) |

## Live demo

**https://nielslecodeur.github.io/poolhealth/**

`docs/` is a static page (published with GitHub Pages) that runs the same engine in the browser against public BSC RPC endpoints. Nothing is signed. Serve it with any static host (GitHub Pages works as is), or locally:

```
bunx serve docs
```

## Example

`swap 20000 CAKE to BTCB`: the direct PancakeSwap pool returns 0.05 BTCB at 89.7% impact (RED). poolhealth routes through WBNB instead and returns 0.47 BTCB, about nine times more.

## How it is sold

The agent is an ERC-8183 seller served over A2A, with an ERC-8004 identity on BSC testnet.

1. A buyer sends `negotiate` with the swap in `task_description` and gets a wallet-signed quote ($0.10). No LLM touches the price.
2. The buyer funds the job on-chain, then sends `notify_funded` with the `job_id`.
3. The agent verifies the job, builds the report and submits it on-chain. The buyer reads the deliverable from the chain.

```json
{"skill": "negotiate",
 "task_description": "swap 40 BNB to CAKE",
 "terms": {"deliverables": "liquidity health report",
           "quality_standards": "live on-chain data"}}
```

## How it works

| File | Role |
| --- | --- |
| `app/agent/src/poolHealth.ts` | The engine: read-only `eth_call`s on BSC mainnet, constant-product maths, routing, verdict, report |
| `app/agent/src/unifiedMain.ts` | Wires the engine into the agent's work hook; the LLM only rewrites the numbers in plain words |
| `app/agent/src/signing.ts` | Quotes and on-chain submission (Studio scaffold, unchanged) |
| `app/agent/studio.toml` | Network, wallet, LLM and price |
| `docs/` | Browser demo (`poolHealth.js` is the engine bundled with `bun build`) |

Pool data comes from BSC mainnet because testnet pools are nearly empty. The agent itself is deployed on BSC testnet.

## Run it yourself

```
npm install --global @bnbagent/studio-cli
cd app/agent && pnpm install
pnpm exec tsx scripts/tryReport.ts "swap 5 BNB to CAKE"
```

`bag dev` runs the full agent locally; `bag deploy --provider bnb` deploys it. You need your own wallet (`bag wallet new`): no keys or secrets are in this repository.

## Limits

- V3 is covered for PancakeSwap only, through its quoter: no reserves, max-order or LP-burned figures for V3 pools.
- A symbol is matched to the most liquid token with that name; pass the address when it matters.
- Fees are each DEX's nominal fee.
- LP tokens held in a lock contract are not detected as locked.
- Not financial advice.
