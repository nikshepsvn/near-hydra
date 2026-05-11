import { configSummary, type HydraConfig } from "./config.js";
import { listSwapTokens } from "./intents.js";
import { getPolicy } from "./policy.js";
import { SUPPORTED_CHAINS, DEFAULT_PATHS } from "./chains.js";

export function getChainsResource() {
  return {
    supported: SUPPORTED_CHAINS.map((chain) => ({
      chain,
      defaultPath: DEFAULT_PATHS[chain],
    })),
    note: "Use chain + path (default '<chain>-1') with hydra_address_derive to get a foreign-chain address. Same NEAR account + same path → same address every time.",
  };
}

export function getConfigResource(cfg: HydraConfig) {
  return configSummary(cfg);
}

export function getPolicyResource(cfg: HydraConfig) {
  return getPolicy(cfg);
}

let tokensCache: { fetchedAt: number; key: string; data: unknown } | null = null;
const TOKENS_TTL_MS = 5 * 60 * 1000;

export async function getTokensResource(cfg: HydraConfig) {
  const cacheKey = `${cfg.oneClick.baseUrl}::${cfg.oneClick.apiKey ?? ""}`;
  if (
    tokensCache &&
    tokensCache.key === cacheKey &&
    Date.now() - tokensCache.fetchedAt < TOKENS_TTL_MS
  ) {
    return tokensCache.data;
  }
  const data = await listSwapTokens(cfg);
  tokensCache = { fetchedAt: Date.now(), key: cacheKey, data };
  return data;
}
