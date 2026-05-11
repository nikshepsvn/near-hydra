import {
  chainBalance,
  deriveAddress,
  DEFAULT_PATHS,
  type SupportedChain,
} from "./chains.js";
import { getSwapQuote, getSwapStatus, submitSwapDeposit } from "./intents.js";
import { sendFt } from "./sends.js";
import { ensureSigningAllowed, ensureNearSigner } from "./policy.js";
import type { HydraConfig } from "./config.js";

export interface EnsureGasArgs {
  chain: SupportedChain;
  predecessor?: string;
  path?: string;
  minBalance?: string;
  sourceAsset?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  dry?: boolean;
}

export interface EnsureGasResult {
  dry: boolean;
  alreadyFunded: boolean;
  address: string;
  currentBalance: string;
  targetMinimum: string;
  finalBalance?: string;
  plan?: {
    kind: "ensure_gas";
    chain: SupportedChain;
    address: string;
    via: "1click";
    sourceAsset: string;
    destinationAsset: string;
  };
  swap?: {
    depositAddress: string;
    quote: unknown;
    sendResult: unknown;
    status: string;
  };
}

// Conservative minimums for native gas across chains.
// Cover ~10 typical txs each so agents have headroom.
export const GAS_DEFAULTS: Record<SupportedChain, string> = {
  ethereum: "2000000000000000", //  0.002  ETH
  polygon: "10000000000000000", //  0.01   POL
  arbitrum: "200000000000000", //   0.0002 ETH
  base: "200000000000000", //       0.0002 ETH
  optimism: "200000000000000", //   0.0002 ETH
  bnb: "1000000000000000", //       0.001  BNB
  avalanche: "10000000000000000", // 0.01  AVAX
  aurora: "200000000000000", //     0.0002 ETH
  bitcoin: "10000", //              10 000 satoshi (gas reserve only — BTC fees vary by feerate)
  solana: "5000000", //             0.005  SOL (covers ATA rent + several fees)
};

// 1Click asset id for the native gas of each chain on the omft.near bridge.
const BRIDGED_NATIVE_ASSET: Partial<Record<SupportedChain, string>> = {
  ethereum: "nep141:eth.omft.near",
  polygon: "nep141:pol.omft.near",
  arbitrum: "nep141:arb.omft.near",
  base: "nep141:base.omft.near",
  optimism: "nep141:op.omft.near",
  bnb: "nep141:bsc.omft.near",
  avalanche: "nep141:avax.omft.near",
  bitcoin: "nep141:btc.omft.near",
  solana: "nep141:sol.omft.near",
  // aurora intentionally omitted — not currently bridged via omft for native gas;
  // fund the derived Aurora address manually for now.
};

export async function ensureGas(
  cfg: HydraConfig,
  args: EnsureGasArgs,
): Promise<EnsureGasResult> {
  const predecessor = args.predecessor ?? cfg.account?.id;
  if (!predecessor) {
    throw new Error("ensureGas needs a NEAR account (predecessor or config.account.id)");
  }
  const path = args.path ?? DEFAULT_PATHS[args.chain];
  const minBalance = BigInt(args.minBalance ?? GAS_DEFAULTS[args.chain]);
  const sourceAsset = args.sourceAsset ?? "nep141:wrap.near";

  // sourceAsset must be a NEAR-side nep141 (not an omft-bridged foreign asset).
  // Permissive: any nep141:<account-id> on NEAR is allowed (wrap.near, USDC variants,
  // bridged-ETH-on-NEAR like eth.bridge.near, etc.). Rejection only when shape is
  // wrong or it's clearly a foreign-bridged omft token.
  if (!sourceAsset.startsWith("nep141:") || sourceAsset.includes(".omft.near")) {
    throw new Error(
      `sourceAsset must be a NEAR-side nep141: token (e.g. nep141:wrap.near), not an omft.near foreign-bridged asset. Got: ${sourceAsset}`,
    );
  }

  const { address } = await deriveAddress(cfg, args.chain, predecessor, path);

  // Bitcoin special case: there is no "gas" — fees come out of UTXOs. We can
  // still report whether the address has enough balance to cover the minimum.
  if (args.chain === "bitcoin") {
    const bal = await chainBalance(cfg, args.chain, address);
    return {
      dry: args.dry !== false,
      alreadyFunded: BigInt(bal.balance) >= minBalance,
      address,
      currentBalance: bal.balance,
      targetMinimum: minBalance.toString(),
    };
  }

  const destinationAsset = BRIDGED_NATIVE_ASSET[args.chain];
  if (!destinationAsset) {
    throw new Error(
      `ensure_gas is not supported for chain '${args.chain}' in v0.5. Fund the derived address (${address}) manually.`,
    );
  }

  const bal = await chainBalance(cfg, args.chain, address);
  const currentBalance = BigInt(bal.balance);

  if (currentBalance >= minBalance) {
    return {
      dry: args.dry !== false,
      alreadyFunded: true,
      address,
      currentBalance: bal.balance,
      targetMinimum: minBalance.toString(),
    };
  }

  const plan = {
    kind: "ensure_gas" as const,
    chain: args.chain,
    address,
    via: "1click" as const,
    sourceAsset,
    destinationAsset,
  };

  if (args.dry !== false) {
    return {
      dry: true,
      alreadyFunded: false,
      address,
      currentBalance: bal.balance,
      targetMinimum: minBalance.toString(),
      plan,
    };
  }

  // Broadcast path
  ensureSigningAllowed(cfg);
  ensureNearSigner(cfg);

  const quote = (await getSwapQuote(cfg, {
    dry: false,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: 200, // 2% — gas swaps are tiny, can be volatile
    originAsset: sourceAsset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset,
    amount: minBalance.toString(),
    refundTo: cfg.account!.id,
    refundType: "INTENTS",
    recipient: address,
    recipientType: "DESTINATION_CHAIN",
  } as never)) as { quote: { depositAddress?: string; depositMemo?: string; amountIn: string } };

  const depositAddress = quote.quote.depositAddress;
  if (!depositAddress) {
    throw new Error("1Click did not return a depositAddress for the ensure_gas quote");
  }

  const tokenContract = sourceAsset.slice("nep141:".length);
  const sendResult = await sendFt(cfg, {
    tokenContract,
    to: depositAddress,
    amount: quote.quote.amountIn,
    memo: quote.quote.depositMemo,
    dry: false,
  });

  if (sendResult.txHash) {
    try {
      await submitSwapDeposit(cfg, depositAddress, sendResult.txHash);
    } catch {
      // Best-effort — solvers also monitor the deposit address directly.
    }
  }

  const timeoutMs = args.timeoutMs ?? 120_000;
  const pollIntervalMs = args.pollIntervalMs ?? 4_000;
  const deadline = Date.now() + timeoutMs;
  let status = "UNKNOWN";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    try {
      const s = (await getSwapStatus(cfg, depositAddress, quote.quote.depositMemo)) as {
        status?: string;
      };
      status = s.status ?? "UNKNOWN";
      if (status === "SUCCESS") break;
      if (status === "FAILED" || status === "REFUNDED") {
        throw new Error(`ensure_gas swap ended with status ${status}`);
      }
    } catch (err) {
      // Status endpoint can be transiently flaky; keep polling.
      if (err instanceof Error && err.message.startsWith("ensure_gas swap ended")) throw err;
    }
  }

  const finalBal = await chainBalance(cfg, args.chain, address);
  return {
    dry: false,
    alreadyFunded: BigInt(finalBal.balance) >= minBalance,
    address,
    currentBalance: bal.balance,
    finalBalance: finalBal.balance,
    targetMinimum: minBalance.toString(),
    plan,
    swap: { depositAddress, quote, sendResult, status },
  };
}
