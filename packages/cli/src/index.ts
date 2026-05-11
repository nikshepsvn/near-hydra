#!/usr/bin/env node
import { Command } from "commander";
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

const EVM_CHAINS: readonly EvmChain[] = [
  "ethereum",
  "polygon",
  "arbitrum",
  "base",
  "optimism",
  "bnb",
  "avalanche",
  "aurora",
];

function evmChainOpt(value: string): EvmChain {
  if (!EVM_CHAINS.includes(value as EvmChain)) {
    throw new Error(`Unsupported EVM chain '${value}'. Supported: ${EVM_CHAINS.join(", ")}`);
  }
  return value as EvmChain;
}


const program = new Command();
program
  .name("near-hydra")
  .description("Unofficial all-in-one CLI for the NEAR stack: accounts, Chain Signatures, Intents.")
  .version("0.0.1");

function out(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function fail(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function chainOpt(value: string): SupportedChain {
  if (!SUPPORTED_CHAINS.includes(value as SupportedChain)) {
    throw new Error(`Unsupported chain '${value}'. Supported: ${SUPPORTED_CHAINS.join(", ")}`);
  }
  return value as SupportedChain;
}

program
  .command("config")
  .description("Show active configuration")
  .action(() => {
    try {
      out(configSummary(loadConfig()));
    } catch (e) {
      fail(e);
    }
  });

const account = program.command("account").description("NEAR account operations");
account
  .command("view <accountId>")
  .description("View NEAR account state")
  .action(async (accountId: string) => {
    try {
      out(await viewAccount(loadConfig(), accountId));
    } catch (e) {
      fail(e);
    }
  });

account
  .command("balance-all <accountId>")
  .description("Derive addresses on every supported foreign chain and return balances")
  .action(async (accountId: string) => {
    try {
      const cfg = loadConfig();
      const rows = await Promise.all(
        SUPPORTED_CHAINS.map(async (chain) => {
          try {
            const d = await deriveAddress(cfg, chain, accountId, DEFAULT_PATHS[chain]);
            const b = await chainBalance(cfg, chain, d.address);
            return { chain, address: d.address, balance: b.balance, decimals: b.decimals };
          } catch (err) {
            return { chain, error: err instanceof Error ? err.message : String(err) };
          }
        }),
      );
      out({ accountId, derived: rows });
    } catch (e) {
      fail(e);
    }
  });

const contract = program.command("contract").description("NEAR contract operations");
contract
  .command("view <contractId> <method>")
  .description("Call a view method (read-only)")
  .option("-a, --args <json>", "JSON args object", "{}")
  .action(async (contractId: string, method: string, opts: { args: string }) => {
    try {
      const args = JSON.parse(opts.args);
      out(await viewFunction(loadConfig(), contractId, method, args));
    } catch (e) {
      fail(e);
    }
  });

const address = program.command("address").description("Cross-chain address operations");
address
  .command("derive")
  .description("Derive a foreign-chain address from a NEAR account via Chain Signatures")
  .requiredOption("-c, --chain <chain>", "ethereum|polygon|arbitrum|base|bitcoin|solana")
  .requiredOption("-p, --predecessor <accountId>", "NEAR account id")
  .option("--path <path>", "Derivation path (defaults to chain default)")
  .action(async (opts: { chain: string; predecessor: string; path?: string }) => {
    try {
      const chain = chainOpt(opts.chain);
      const cfg = loadConfig();
      out(
        await deriveAddress(
          cfg,
          chain,
          opts.predecessor,
          opts.path ?? DEFAULT_PATHS[chain],
        ),
      );
    } catch (e) {
      fail(e);
    }
  });

address
  .command("balance")
  .description("Native-asset balance of an address on a foreign chain")
  .requiredOption("-c, --chain <chain>")
  .requiredOption("-a, --address <address>")
  .action(async (opts: { chain: string; address: string }) => {
    try {
      out(await chainBalance(loadConfig(), chainOpt(opts.chain), opts.address));
    } catch (e) {
      fail(e);
    }
  });

const swap = program.command("swap").description("Cross-chain swaps via NEAR Intents 1Click");
swap
  .command("tokens")
  .description("List supported tokens")
  .action(async () => {
    try {
      out(await listSwapTokens(loadConfig()));
    } catch (e) {
      fail(e);
    }
  });

swap
  .command("quote")
  .description("Get a 1Click cross-chain swap quote")
  .requiredOption("--from <assetId>", "originAsset (e.g. nep141:wrap.near)")
  .requiredOption("--to <assetId>", "destinationAsset")
  .requiredOption("--amount <baseUnits>", "amount in origin's smallest units")
  .requiredOption("--recipient <addr>", "recipient address")
  .requiredOption("--refund-to <addr>", "where to refund on failure")
  .option("--swap-type <t>", "EXACT_INPUT | EXACT_OUTPUT | FLEX_INPUT | ANY_INPUT", "EXACT_INPUT")
  .option("--deposit-type <t>", "ORIGIN_CHAIN | INTENTS", "ORIGIN_CHAIN")
  .option("--refund-type <t>", "ORIGIN_CHAIN | INTENTS", "ORIGIN_CHAIN")
  .option("--recipient-type <t>", "DESTINATION_CHAIN | INTENTS", "DESTINATION_CHAIN")
  .option("--slippage-bps <n>", "slippage tolerance, basis points (100 = 1%)", "100")
  .option("--dry <bool>", "dry run", "true")
  .option("--extra <json>", "additional fields merged into the request", "{}")
  .action(
    async (opts: {
      from: string;
      to: string;
      amount: string;
      recipient: string;
      refundTo: string;
      swapType: string;
      depositType: string;
      refundType: string;
      recipientType: string;
      slippageBps: string;
      dry: string;
      extra: string;
    }) => {
      try {
        const extra = JSON.parse(opts.extra);
        const request = {
          originAsset: opts.from,
          destinationAsset: opts.to,
          amount: opts.amount,
          recipient: opts.recipient,
          refundTo: opts.refundTo,
          swapType: opts.swapType,
          depositType: opts.depositType,
          refundType: opts.refundType,
          recipientType: opts.recipientType,
          slippageTolerance: Number(opts.slippageBps),
          dry: opts.dry !== "false",
          ...extra,
        } as unknown as QuoteRequest;
        out(await getSwapQuote(loadConfig(), request));
      } catch (e) {
        fail(e);
      }
    },
  );

swap
  .command("status <depositAddress>")
  .description("Check swap execution status")
  .option("--memo <memo>")
  .action(async (depositAddress: string, opts: { memo?: string }) => {
    try {
      out(await getSwapStatus(loadConfig(), depositAddress, opts.memo));
    } catch (e) {
      fail(e);
    }
  });

swap
  .command("submit-deposit <depositAddress> <txHash>")
  .description("Notify 1Click of the broadcast deposit tx")
  .action(async (depositAddress: string, txHash: string) => {
    try {
      out(await submitSwapDeposit(loadConfig(), depositAddress, txHash));
    } catch (e) {
      fail(e);
    }
  });

const send = program.command("send").description("Sign and send transactions");
send
  .command("near <to> <amountYocto>")
  .description("Send native NEAR (dry=true by default)")
  .option("--broadcast", "Actually broadcast (default is dry-run)")
  .action(async (to: string, amountYocto: string, opts: { broadcast?: boolean }) => {
    try {
      out(await sendNear(loadConfig(), { to, amountYocto, dry: !opts.broadcast }));
    } catch (e) {
      fail(e);
    }
  });

send
  .command("ft <tokenContract> <to> <amount>")
  .description("Send a NEP-141 fungible token")
  .option("--memo <memo>")
  .option("--broadcast", "Actually broadcast (default is dry-run)")
  .action(
    async (
      tokenContract: string,
      to: string,
      amount: string,
      opts: { memo?: string; broadcast?: boolean },
    ) => {
      try {
        out(
          await sendFt(loadConfig(), {
            tokenContract,
            to,
            amount,
            memo: opts.memo,
            dry: !opts.broadcast,
          }),
        );
      } catch (e) {
        fail(e);
      }
    },
  );

send
  .command("btc <to> <satoshi>")
  .description("Send BTC via Chain Signatures from your derived Bitcoin address")
  .option("--predecessor <id>")
  .option("--path <s>")
  .option("--broadcast", "Actually broadcast")
  .action(async (to: string, satoshi: string, opts: { predecessor?: string; path?: string; broadcast?: boolean }) => {
    try {
      out(await sendBtc(loadConfig(), { to, satoshi, predecessor: opts.predecessor, path: opts.path, dry: !opts.broadcast }));
    } catch (e) {
      fail(e);
    }
  });

send
  .command("sol <to> <lamports>")
  .description("Send SOL via Chain Signatures from your derived Solana address")
  .option("--predecessor <id>")
  .option("--path <s>")
  .option("--broadcast", "Actually broadcast")
  .action(async (to: string, lamports: string, opts: { predecessor?: string; path?: string; broadcast?: boolean }) => {
    try {
      out(await sendSolana(loadConfig(), { to, lamports, predecessor: opts.predecessor, path: opts.path, dry: !opts.broadcast }));
    } catch (e) {
      fail(e);
    }
  });

send
  .command("spl <mint> <to> <amount>")
  .description("Send a Solana SPL token via Chain Signatures (auto-creates destination ATA if needed)")
  .option("--decimals <n>", "Token decimals (else looked up on-chain)")
  .option("--predecessor <id>")
  .option("--path <s>")
  .option("--broadcast", "Actually broadcast")
  .action(
    async (
      mint: string,
      to: string,
      amount: string,
      opts: { decimals?: string; predecessor?: string; path?: string; broadcast?: boolean },
    ) => {
      try {
        out(
          await sendSpl(loadConfig(), {
            mint,
            to,
            amount,
            decimals: opts.decimals !== undefined ? Number(opts.decimals) : undefined,
            predecessor: opts.predecessor,
            path: opts.path,
            dry: !opts.broadcast,
          }),
        );
      } catch (e) {
        fail(e);
      }
    },
  );

send
  .command("evm")
  .description("Send a transaction on an EVM chain via Chain Signatures")
  .requiredOption("-c, --chain <chain>", `${EVM_CHAINS.join("|")}`)
  .requiredOption("--to <address>", "Recipient (0x...) or token contract for ERC-20")
  .option("--value-wei <wei>", "Native value in wei", "0")
  .option("--data <hex>", "Calldata 0x...", "0x")
  .option("--erc20-token <addr>", "ERC-20 token contract")
  .option("--erc20-recipient <addr>")
  .option("--erc20-amount <baseUnits>")
  .option("--predecessor <id>", "NEAR account whose MPC keys derive the sender")
  .option("--path <s>", "Derivation path")
  .option("--broadcast", "Actually broadcast")
  .action(
    async (opts: {
      chain: string;
      to: string;
      valueWei: string;
      data: string;
      erc20Token?: string;
      erc20Recipient?: string;
      erc20Amount?: string;
      predecessor?: string;
      path?: string;
      broadcast?: boolean;
    }) => {
      try {
        const erc20 =
          opts.erc20Token && opts.erc20Recipient && opts.erc20Amount
            ? { token: opts.erc20Token, recipient: opts.erc20Recipient, amount: opts.erc20Amount }
            : undefined;
        out(
          await sendEvm(loadConfig(), {
            chain: evmChainOpt(opts.chain),
            to: opts.to,
            valueWei: opts.valueWei,
            dataHex: opts.data as `0x${string}`,
            erc20,
            predecessor: opts.predecessor,
            path: opts.path,
            dry: !opts.broadcast,
          }),
        );
      } catch (e) {
        fail(e);
      }
    },
  );

const contractCmd = program
  .command("call <contractId> <method>")
  .description("Call a state-changing method on a NEAR contract")
  .option("-a, --args <json>", "Args as JSON", "{}")
  .option("--deposit-yocto <yocto>")
  .option("--gas <units>")
  .option("--broadcast", "Actually broadcast");
contractCmd.action(
  async (
    contractId: string,
    method: string,
    opts: { args: string; depositYocto?: string; gas?: string; broadcast?: boolean },
  ) => {
    try {
      out(
        await callContract(loadConfig(), {
          contractId,
          method,
          args: JSON.parse(opts.args),
          depositYocto: opts.depositYocto,
          gas: opts.gas,
          dry: !opts.broadcast,
        }),
      );
    } catch (e) {
      fail(e);
    }
  },
);

swap
  .command("execute")
  .description("Execute a NEAR-origin cross-chain swap end-to-end (dry by default)")
  .requiredOption("--from <assetId>", "Origin asset (must start with nep141:)")
  .requiredOption("--to <assetId>", "Destination asset")
  .requiredOption("--amount <baseUnits>")
  .requiredOption("--recipient <addr>", "Destination-chain address")
  .option("--refund-to <id>", "NEAR account for refunds")
  .option("--swap-type <t>", "EXACT_INPUT|EXACT_OUTPUT|FLEX_INPUT|ANY_INPUT", "EXACT_INPUT")
  .option("--slippage-bps <n>", "Slippage in basis points", "100")
  .option("--broadcast", "Actually execute (default is dry-run)")
  .action(
    async (opts: {
      from: string;
      to: string;
      amount: string;
      recipient: string;
      refundTo?: string;
      swapType: string;
      slippageBps: string;
      broadcast?: boolean;
    }) => {
      try {
        out(
          await swapExecute(loadConfig(), {
            originAsset: opts.from,
            destinationAsset: opts.to,
            amount: opts.amount,
            recipient: opts.recipient,
            refundTo: opts.refundTo,
            swapType: opts.swapType as never,
            slippageTolerance: Number(opts.slippageBps),
            dry: !opts.broadcast,
          }),
        );
      } catch (e) {
        fail(e);
      }
    },
  );

const key = program.command("key").description("NEAR access-key operations");
key
  .command("create-agent")
  .description("Mint scoped function-call access keys for an autonomous agent")
  .option(
    "--receiver <id...>",
    "Contracts the key may call (repeat: --receiver v1.signer --receiver wrap.near)",
  )
  .option("--methods <m...>", "Method allowlist (empty = any). Repeat or comma-separate.")
  .requiredOption("--allowance-yocto <y>", "Gas cap per key, in yoctoNEAR")
  .option("--broadcast", "Actually add the keys (default is dry-run)")
  .action(
    async (opts: {
      receiver?: string[];
      methods?: string[];
      allowanceYocto: string;
      broadcast?: boolean;
    }) => {
      try {
        const methods = (opts.methods ?? []).flatMap((m) => m.split(","));
        out(
          await createAgentKey(loadConfig(), {
            receiverContracts: opts.receiver ?? [],
            methods,
            allowanceYocto: opts.allowanceYocto,
            dry: !opts.broadcast,
          }),
        );
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("sign-message")
  .description("Sign a message via Chain Signatures (EIP-191 or Solana Ed25519)")
  .requiredOption("-c, --chain <chain>")
  .option("-m, --message <msg>", "UTF-8 message (EIP-191 / Ed25519)")
  .option("--typed-data <json>", "EIP-712 typed-data JSON (EVM only)")
  .option("--predecessor <id>")
  .option("--path <p>")
  .action(
    async (opts: {
      chain: string;
      message?: string;
      typedData?: string;
      predecessor?: string;
      path?: string;
    }) => {
      try {
        const typedData = opts.typedData ? JSON.parse(opts.typedData) : undefined;
        out(
          await signMessage(loadConfig(), {
            chain: chainOpt(opts.chain),
            message: opts.message,
            typedData,
            predecessor: opts.predecessor,
            path: opts.path,
          }),
        );
      } catch (e) {
        fail(e);
      }
    },
  );

program
  .command("ensure-gas")
  .description("Top up a derived foreign-chain address with native gas via 1Click")
  .requiredOption("-c, --chain <chain>")
  .option("--min-balance <baseUnits>")
  .option("--source-asset <assetId>", "Default: nep141:wrap.near")
  .option("--timeout-ms <n>", "Default: 120000")
  .option("--predecessor <id>")
  .option("--path <p>")
  .option("--broadcast", "Actually fund (default is dry-run)")
  .action(
    async (opts: {
      chain: string;
      minBalance?: string;
      sourceAsset?: string;
      timeoutMs?: string;
      predecessor?: string;
      path?: string;
      broadcast?: boolean;
    }) => {
      try {
        out(
          await ensureGas(loadConfig(), {
            chain: chainOpt(opts.chain),
            minBalance: opts.minBalance,
            sourceAsset: opts.sourceAsset,
            timeoutMs: opts.timeoutMs ? Number(opts.timeoutMs) : undefined,
            predecessor: opts.predecessor,
            path: opts.path,
            dry: !opts.broadcast,
          }),
        );
      } catch (e) {
        fail(e);
      }
    },
  );

program.parseAsync(process.argv).catch(fail);
