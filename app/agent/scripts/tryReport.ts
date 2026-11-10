// Local check of the deterministic part (no wallet, no LLM):
//   pnpm exec tsx scripts/tryReport.ts "swap 5 BNB to CAKE"
import { analyzeRequest, renderReport } from "../src/poolHealth.js";

const request = process.argv.slice(2).join(" ") || "swap 5 BNB to USDT";
const report = await analyzeRequest(request);
console.log(renderReport(report, ""));
