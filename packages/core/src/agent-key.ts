import { KeyPair } from "@near-js/crypto";
import { nearAccount } from "./near.js";
import { ensureSigningAllowed, ensureNearSigner } from "./policy.js";
import type { HydraConfig } from "./config.js";

export interface CreateAgentKeyArgs {
  receiverContracts: string[];
  methods?: string[];
  allowanceYocto: string;
  dry?: boolean;
}

export interface AgentKeyEntry {
  publicKey: string;
  privateKey: string;
  contractId: string;
  methods: string[];
  txHash?: string;
}

export interface CreateAgentKeyResult {
  dry: boolean;
  plan: {
    kind: "create_agent_key";
    accountId: string;
    existingKeyCount: number;
    allowanceYocto: string;
    methods: string[];
    keys: Array<{ contractId: string; publicKey: string }>;
  };
  warning?: string;
  keys?: AgentKeyEntry[];
}

export async function createAgentKey(
  cfg: HydraConfig,
  args: CreateAgentKeyArgs,
): Promise<CreateAgentKeyResult> {
  ensureSigningAllowed(cfg);
  ensureNearSigner(cfg);

  if (!args.receiverContracts || args.receiverContracts.length === 0) {
    throw new Error("receiverContracts must have at least one entry");
  }
  const methods = args.methods ?? [];
  const allowanceYocto = args.allowanceYocto;
  if (!allowanceYocto) {
    throw new Error("allowanceYocto is required (caps the gas the key can spend)");
  }

  const acct = nearAccount(cfg);
  const list = await acct.getAccessKeyList();
  const existingKeyCount = list.keys?.length ?? 0;

  // Generate one fresh keypair per receiver contract. NEAR allows only one
  // access key per (account, public_key), so reusing a public_key across
  // contracts wouldn't work — N contracts → N keypairs.
  const generated = args.receiverContracts.map((contractId) => {
    const kp = KeyPair.fromRandom("ED25519");
    return {
      contractId,
      methods,
      publicKey: kp.getPublicKey().toString(),
      privateKey: kp.toString(),
    };
  });

  const plan = {
    kind: "create_agent_key" as const,
    accountId: cfg.account!.id,
    existingKeyCount,
    allowanceYocto,
    methods,
    keys: generated.map((g) => ({ contractId: g.contractId, publicKey: g.publicKey })),
  };

  if (args.dry !== false) {
    return { dry: true, plan };
  }

  const allowance = BigInt(allowanceYocto);
  const out: AgentKeyEntry[] = [];
  for (const g of generated) {
    const result = (await acct.addFunctionCallAccessKey({
      publicKey: g.publicKey,
      contractId: g.contractId,
      methodNames: g.methods,
      allowance,
    })) as { transaction?: { hash?: string } };
    out.push({
      publicKey: g.publicKey,
      privateKey: g.privateKey,
      contractId: g.contractId,
      methods: g.methods,
      txHash: result?.transaction?.hash,
    });
  }

  return {
    dry: false,
    plan,
    warning:
      "Save these private keys NOW — they are not stored by near-hydra and will not be shown again. Set one as NEAR_HYDRA_PRIVATE_KEY for an agent runtime that should be scoped to this contract.",
    keys: out,
  };
}
