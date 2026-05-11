import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  loadConfig,
  configSummary,
  viewAccount,
  viewFunction,
  deriveAddress,
  chainBalance,
  DEFAULT_PATHS,
  SUPPORTED_CHAINS,
  listSwapTokens,
  getSwapQuote,
  getSwapStatus,
  submitSwapDeposit,
  sendNear,
  sendFt,
  callContract,
  sendEvm,
  sendBtc,
  sendSolana,
  sendSpl,
  swapExecute,
  createAgentKey,
  signMessage,
  ensureGas,
  type SupportedChain,
  type EvmChain,
  type QuoteRequest,
} from "near-hydra-core";

const ChainEnum = z.enum(SUPPORTED_CHAINS as unknown as [SupportedChain, ...SupportedChain[]]);
const EvmChainEnum = z.enum([
  "ethereum",
  "polygon",
  "arbitrum",
  "base",
  "optimism",
  "bnb",
  "avalanche",
  "aurora",
] as const) as z.ZodEnum<[EvmChain, ...EvmChain[]]>;
const SwapType = z.enum(["EXACT_INPUT", "EXACT_OUTPUT", "FLEX_INPUT", "ANY_INPUT"]);
const AddrType = z.enum(["ORIGIN_CHAIN", "INTENTS"]);
const RecipientType = z.enum(["DESTINATION_CHAIN", "INTENTS"]);
const DepositMode = z.enum(["SIMPLE", "MEMO"]);

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }, null, 2) }],
  };
}

export function registerTools(server: McpServer) {
  server.registerTool(
    "hydra_config_show",
    {
      description:
        "Show the active near-hydra configuration: network, account, MPC contract, RPC endpoints. Read-only.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(configSummary(loadConfig()));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_account_view",
    {
      description:
        "View a NEAR account's on-chain state: balance (total/available/locked/storage), storage usage, code hash. Example: hydra_account_view({accountId: 'near.near'}).",
      inputSchema: { accountId: z.string().describe("NEAR account id, e.g. alice.near") },
    },
    async ({ accountId }) => {
      try {
        return ok(await viewAccount(loadConfig(), accountId));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_contract_view",
    {
      description:
        "Call a read-only view method on a NEAR smart contract. Returns parsed JSON when possible. Example: hydra_contract_view({contractId: 'wrap.near', method: 'ft_balance_of', args: {account_id: 'alice.near'}}).",
      inputSchema: {
        contractId: z.string(),
        method: z.string(),
        args: z.record(z.unknown()).optional().describe("JSON args for the view method"),
      },
    },
    async ({ contractId, method, args }) => {
      try {
        return ok(await viewFunction(loadConfig(), contractId, method, args ?? {}));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_address_derive",
    {
      description:
        "Derive a foreign-chain address (Bitcoin, EVM, Solana) from a NEAR account using Chain Signatures (MPC). Same NEAR account + path → same address every time. " +
        "Supported chains: ethereum, polygon, arbitrum, base, optimism, bnb, avalanche, aurora, bitcoin, solana. " +
        "Example: hydra_address_derive({chain: 'bitcoin', predecessor: 'alice.near'}) → bc1q....",
      inputSchema: {
        chain: ChainEnum,
        predecessor: z.string().describe("NEAR account id whose MPC keys derive the address"),
        path: z.string().optional().describe("Derivation path. Defaults to '<chain>-1'."),
      },
    },
    async ({ chain, predecessor, path }) => {
      try {
        const cfg = loadConfig();
        return ok(await deriveAddress(cfg, chain, predecessor, path ?? DEFAULT_PATHS[chain]));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_address_balance",
    {
      description: "Get the native-asset balance of an address on a foreign chain.",
      inputSchema: { chain: ChainEnum, address: z.string() },
    },
    async ({ chain, address }) => {
      try {
        return ok(await chainBalance(loadConfig(), chain, address));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_account_balance_all_chains",
    {
      description:
        "For a NEAR account, derive its addresses on every supported foreign chain and return all native-asset balances in one call. Errors on individual chains are reported per-chain — partial success is normal.",
      inputSchema: { accountId: z.string() },
    },
    async ({ accountId }) => {
      try {
        const cfg = loadConfig();
        const results = await Promise.all(
          SUPPORTED_CHAINS.map(async (chain) => {
            try {
              const derived = await deriveAddress(cfg, chain, accountId, DEFAULT_PATHS[chain]);
              const bal = await chainBalance(cfg, chain, derived.address);
              return { chain, address: derived.address, balance: bal.balance, decimals: bal.decimals };
            } catch (err) {
              return { chain, error: err instanceof Error ? err.message : String(err) };
            }
          }),
        );
        return ok({ accountId, derived: results });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_swap_tokens",
    {
      description:
        "List all tokens supported by NEAR Intents 1Click for cross-chain swaps. Each entry includes assetId, blockchain, contractAddress, symbol, decimals, USD price.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await listSwapTokens(loadConfig()));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_swap_quote",
    {
      description:
        "Get a NEAR Intents 1Click cross-chain swap quote. Set dry=true to simulate (no deposit address); dry=false returns a deposit address you must send the input asset to. Asset IDs come from hydra_swap_tokens. Example: " +
        "hydra_swap_quote({originAsset: 'nep141:wrap.near', destinationAsset: 'nep141:eth.bridge.near', amount: '1000000000000000000000000', recipient: '0x...', refundTo: 'alice.near', refundType: 'INTENTS', recipientType: 'DESTINATION_CHAIN', swapType: 'EXACT_INPUT', slippageTolerance: 100, depositType: 'INTENTS'}).",
      inputSchema: {
        originAsset: z.string().describe("Source asset id (see hydra_swap_tokens.assetId)"),
        destinationAsset: z.string().describe("Destination asset id"),
        amount: z.string().describe("Amount in base units of the origin asset (e.g. wei for ETH)"),
        recipient: z.string().describe("Recipient address; format must match recipientType"),
        recipientType: RecipientType.default("DESTINATION_CHAIN"),
        refundTo: z.string().describe("Where to refund if swap fails"),
        refundType: AddrType.default("ORIGIN_CHAIN"),
        depositType: AddrType.default("ORIGIN_CHAIN").describe("ORIGIN_CHAIN gives you a deposit address on the source chain; INTENTS uses an Intents account."),
        swapType: SwapType.default("EXACT_INPUT"),
        slippageTolerance: z.number().int().min(0).max(10000).default(100).describe("Basis points (100 = 1%)"),
        depositMode: DepositMode.optional(),
        dry: z.boolean().default(true),
        sessionId: z.string().optional(),
      },
    },
    async (input) => {
      try {
        return ok(await getSwapQuote(loadConfig(), input as unknown as QuoteRequest));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_swap_status",
    {
      description: "Check the execution status of a 1Click swap by its deposit address.",
      inputSchema: {
        depositAddress: z.string(),
        depositMemo: z.string().optional().describe("Required if the chain uses MEMO deposit mode"),
      },
    },
    async ({ depositAddress, depositMemo }) => {
      try {
        return ok(await getSwapStatus(loadConfig(), depositAddress, depositMemo));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_swap_submit_deposit",
    {
      description:
        "Notify 1Click that the deposit transaction has been broadcast. depositAddress comes from a non-dry quote; txHash is the transaction hash on the chain you sent funds on.",
      inputSchema: { depositAddress: z.string(), txHash: z.string() },
    },
    async ({ depositAddress, txHash }) => {
      try {
        return ok(await submitSwapDeposit(loadConfig(), depositAddress, txHash));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_send_near",
    {
      description:
        "Send native NEAR from the configured account. SAFE BY DEFAULT: dry=true returns the plan without broadcasting. Set dry=false to actually send. Requires policy.readOnly=false. amountYocto is in yocto (1 NEAR = 10^24 yocto).",
      inputSchema: {
        to: z.string(),
        amountYocto: z.string().describe("Amount in yoctoNEAR. 10^24 yocto = 1 NEAR"),
        dry: z.boolean().default(true),
      },
    },
    async ({ to, amountYocto, dry }) => {
      try {
        return ok(await sendNear(loadConfig(), { to, amountYocto, dry }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_send_ft",
    {
      description:
        "Send a NEP-141 fungible token from the configured account. Calls ft_transfer with 1 yoctoNEAR deposit. SAFE: dry=true by default. Example: send wNEAR via tokenContract='wrap.near'.",
      inputSchema: {
        tokenContract: z.string().describe("FT contract account, e.g. 'wrap.near'"),
        to: z.string().describe("Recipient NEAR account id"),
        amount: z.string().describe("Amount in the token's base units"),
        memo: z.string().optional(),
        dry: z.boolean().default(true),
      },
    },
    async ({ tokenContract, to, amount, memo, dry }) => {
      try {
        return ok(await sendFt(loadConfig(), { tokenContract, to, amount, memo, dry }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_contract_call",
    {
      description:
        "Call a state-changing method on a NEAR smart contract from the configured account. SAFE: dry=true by default. depositYocto is attached NEAR; gas is in TGas units (default 30 TGas).",
      inputSchema: {
        contractId: z.string(),
        method: z.string(),
        args: z.record(z.unknown()).optional(),
        depositYocto: z.string().optional(),
        gas: z.string().optional().describe("Gas in absolute units (10^12 = 1 TGas)"),
        dry: z.boolean().default(true),
      },
    },
    async (input) => {
      try {
        return ok(await callContract(loadConfig(), input));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_send_evm",
    {
      description:
        "Send a transaction on an EVM chain from a Chain-Signature-derived address. Supports native value (valueWei) or ERC-20 transfer (erc20). SAFE: dry=true returns the prepared unsigned transaction for inspection; dry=false signs via MPC and broadcasts. Requires the derived address to have funds + gas. predecessor defaults to the configured NEAR account.",
      inputSchema: {
        chain: EvmChainEnum,
        predecessor: z.string().optional(),
        path: z.string().optional().describe("Derivation path. Defaults to '<chain>-1'"),
        to: z.string().describe("Recipient 0x address (ignored if erc20 is set)"),
        valueWei: z.string().optional().describe("Native value in wei"),
        dataHex: z.string().optional().describe("Calldata as 0x-prefixed hex"),
        erc20: z
          .object({ token: z.string(), recipient: z.string(), amount: z.string() })
          .optional()
          .describe("ERC-20 transfer: builds calldata and sets to=token, value=0"),
        dry: z.boolean().default(true),
      },
    },
    async (input) => {
      try {
        return ok(await sendEvm(loadConfig(), input as never));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_send_btc",
    {
      description:
        "Send BTC from a Chain-Signature-derived Bitcoin address. UTXO selection via Mempool API. SAFE: dry=true returns the plan; dry=false signs via MPC and broadcasts. Amount in satoshis (1 BTC = 100,000,000 satoshi). Requires the derived address to have spendable UTXOs.",
      inputSchema: {
        predecessor: z.string().optional().describe("NEAR account; defaults to configured account"),
        path: z.string().optional().describe("Derivation path; defaults to 'bitcoin-1'"),
        to: z.string().describe("Recipient Bitcoin address"),
        satoshi: z.string().describe("Amount in satoshis as a string"),
        dry: z.boolean().default(true),
      },
    },
    async (input) => {
      try {
        return ok(await sendBtc(loadConfig(), input as never));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_send_solana",
    {
      description:
        "Send native SOL from a Chain-Signature-derived Solana address. SAFE: dry=true returns the plan. Amount in lamports (1 SOL = 1,000,000,000 lamports). Requires the derived address to have SOL.",
      inputSchema: {
        predecessor: z.string().optional(),
        path: z.string().optional().describe("Derivation path; defaults to 'solana-1'"),
        to: z.string().describe("Recipient Solana address (base58)"),
        lamports: z.string().describe("Amount in lamports as a string"),
        dry: z.boolean().default(true),
      },
    },
    async (input) => {
      try {
        return ok(await sendSolana(loadConfig(), input as never));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_send_spl",
    {
      description:
        "Send a Solana SPL token from a Chain-Signature-derived Solana address. Auto-derives source + destination ATAs and creates the destination ATA on-the-fly if it doesn't exist (sender pays ~0.002 SOL rent). SAFE: dry=true returns the plan including ATAs and whether the destination needs creating. Amount in token base units (use mint's decimals). Decimals are looked up on-chain if not supplied.",
      inputSchema: {
        predecessor: z.string().optional(),
        path: z.string().optional().describe("Derivation path; defaults to 'solana-1'"),
        mint: z.string().describe("SPL mint address (base58)"),
        to: z.string().describe("Recipient wallet address (base58). Hydra derives the destination ATA from this."),
        amount: z.string().describe("Amount in token base units (e.g. for USDC/6 decimals, 1 USDC = '1000000')"),
        decimals: z.number().int().min(0).max(18).optional().describe("If known; otherwise looked up on-chain"),
        dry: z.boolean().default(true),
      },
    },
    async (input) => {
      try {
        return ok(await sendSpl(loadConfig(), input as never));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_create_agent_key",
    {
      description:
        "Mint NEAR function-call access keys scoped to specific contracts (with a NEAR allowance cap) for autonomous agent use. Generates one fresh ed25519 keypair per receiverContract (NEAR's protocol allows only one access key per public_key, so multi-contract requests yield multiple keypairs). dry=true returns the plan + the new public keys without writing to chain. dry=false adds the keys and returns the private keys ONCE — save them immediately.",
      inputSchema: {
        receiverContracts: z
          .array(z.string())
          .min(1)
          .describe("NEAR account IDs the key may call (e.g. 'v1.signer' for Chain Signatures)"),
        methods: z
          .array(z.string())
          .default([])
          .describe("Method allowlist on each contract. Empty = any method."),
        allowanceYocto: z
          .string()
          .describe("Gas allowance cap per key, in yoctoNEAR. e.g. '1000000000000000000000000' = 1 NEAR"),
        dry: z.boolean().default(true),
      },
    },
    async (input) => {
      try {
        return ok(await createAgentKey(loadConfig(), input as never));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_sign_message",
    {
      description:
        "Sign an arbitrary message (EIP-191 'personal_sign') or EIP-712 typed data from a Chain-Signature-derived address. EVM chains return a 65-byte 0x... signature; Solana returns a base58 Ed25519 signature. Unlocks Sign-In-With-Ethereum / Sign-In-With-Solana / EIP-712 typed-data signing for any dApp that takes (address, signature). Bitcoin (BIP-322) is not yet supported.",
      inputSchema: {
        chain: ChainEnum,
        predecessor: z.string().optional(),
        path: z.string().optional(),
        message: z.string().optional().describe("UTF-8 message for EIP-191 or Solana Ed25519"),
        typedData: z
          .record(z.unknown())
          .optional()
          .describe("EIP-712 typed data object: { domain, types, primaryType, message }. EVM only."),
      },
    },
    async (input) => {
      try {
        return ok(await signMessage(loadConfig(), input as never));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_ensure_gas",
    {
      description:
        "Top up the derived foreign-chain address with native gas, via a small NEAR Intents 1Click swap. Checks current balance; if below minBalance, swaps a NEAR-side asset (default wNEAR) to the chain's native asset, sends to the derived address, polls until delivered. SAFE: dry=true returns the plan without spending. Bitcoin reports balance only (no gas concept). Aurora not supported (no omft bridge).",
      inputSchema: {
        chain: ChainEnum,
        predecessor: z.string().optional(),
        path: z.string().optional(),
        minBalance: z
          .string()
          .optional()
          .describe("Target minimum balance in chain's base units. Defaults to GAS_DEFAULTS."),
        sourceAsset: z
          .string()
          .default("nep141:wrap.near")
          .describe("NEAR-side asset to swap from (must be nep141:*.near, not omft-bridged)"),
        timeoutMs: z.number().int().positive().default(120_000),
        pollIntervalMs: z.number().int().positive().default(4_000),
        dry: z.boolean().default(true),
      },
    },
    async (input) => {
      try {
        return ok(await ensureGas(loadConfig(), input as never));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "hydra_swap_execute",
    {
      description:
        "Execute an end-to-end cross-chain swap via NEAR Intents 1Click. Auto-routes the origin send by asset: NEAR-side FTs use ft_transfer; bridged EVM (ETH/ARB/BASE/POL/BSC/OP/AVAX/Aurora) routes through send_evm using a derived foreign-chain address; native BTC and SOL use their native sends; SPL tokens (nep141:sol-{mint}.omft.near) route through send_spl with auto-ATA creation. SAFE: dry=true returns the inferred route + previewed quote request. Set dry=false to fetch a non-dry quote, send the origin asset to the depositAddress, and submit the deposit hash. Pre-conditions: derived address must hold the origin asset + native gas on its chain; NEAR account pays for the MPC sign request.",
      inputSchema: {
        originAsset: z.string().describe("nep141:<asset>. NEAR-side: nep141:wrap.near. Bridged: nep141:eth-0x...omft.near, nep141:btc.omft.near, nep141:sol.omft.near, etc."),
        destinationAsset: z.string(),
        amount: z.string().describe("Amount in originAsset's base units"),
        recipient: z.string().describe("Destination-chain address"),
        recipientType: RecipientType.default("DESTINATION_CHAIN"),
        refundTo: z.string().optional().describe("Defaults to configured NEAR account"),
        refundType: AddrType.default("INTENTS"),
        depositType: AddrType.default("ORIGIN_CHAIN"),
        swapType: SwapType.default("EXACT_INPUT"),
        slippageTolerance: z.number().int().min(0).max(10000).default(100),
        depositMode: DepositMode.optional(),
        dry: z.boolean().default(true),
      },
    },
    async (input) => {
      try {
        return ok(await swapExecute(loadConfig(), input as never));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
