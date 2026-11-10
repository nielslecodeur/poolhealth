// Local check of the full work hook (on-chain numbers + LLM note), no job needed:
//   pnpm exec tsx --env-file=../../.studio/.env.local scripts/tryWork.ts "swap 5 BNB to CAKE"
import { buildRunWork } from "../src/unifiedMain.js";

const request = process.argv.slice(2).join(" ") || "swap 5 BNB to CAKE";
const runWork = buildRunWork();
const text = await runWork(
  `You accepted and were paid for the following job.\n\nJOB CONTEXT:\n${JSON.stringify({ task: request, terms: {} })}`,
  { sessionId: "local-try" },
);
console.log(text.split("## Data")[0]);
