import {
  hashMessage,
  hashTypedData,
  recoverMessageAddress,
  recoverTypedDataAddress,
  type TypedDataDefinition,
  type Hex,
  type Address,
} from "viem";
import bs58 from "bs58";
import { deriveAddress, mpcContract, DEFAULT_PATHS, type SupportedChain } from "./chains.js";
import { nearAccount } from "./near.js";
import { ensureSigningAllowed, ensureNearSigner } from "./policy.js";
import type { HydraConfig } from "./config.js";

export type SignScheme = "eip191" | "eip712" | "ed25519";

export interface SignMessageArgs {
  chain: SupportedChain;
  predecessor?: string;
  path?: string;
  message?: string;
  typedData?: TypedDataDefinition;
}

export interface SignMessageResult {
  chain: SupportedChain;
  address: string;
  scheme: SignScheme;
  signature: string;
  digestHex?: string;
  recoveredAddress?: string;
}

const EVM_CHAINS: ReadonlySet<SupportedChain> = new Set([
  "ethereum",
  "polygon",
  "arbitrum",
  "base",
  "optimism",
  "bnb",
  "avalanche",
  "aurora",
]);

export async function signMessage(
  cfg: HydraConfig,
  args: SignMessageArgs,
): Promise<SignMessageResult> {
  ensureSigningAllowed(cfg);
  ensureNearSigner(cfg);

  if (args.chain === "bitcoin") {
    throw new Error("BIP-322 message signing on Bitcoin is not supported in v0.5.");
  }

  const predecessor = args.predecessor ?? cfg.account!.id;
  const path = args.path ?? DEFAULT_PATHS[args.chain];
  const derived = await deriveAddress(cfg, args.chain, predecessor, path);

  const signerAccount = nearAccount(cfg);
  const contract = mpcContract(cfg);

  if (args.chain === "solana") {
    if (!args.message) {
      throw new Error("message is required for Solana message signing");
    }
    const payload = Array.from(Buffer.from(args.message, "utf8"));
    const sigs = (await contract.sign({
      payloads: [payload],
      path,
      keyType: "Eddsa",
      signerAccount,
    })) as unknown as Array<{ signature: number[] }>;
    return {
      chain: args.chain,
      address: derived.address,
      scheme: "ed25519",
      signature: bs58.encode(Buffer.from(sigs[0].signature)),
    };
  }

  if (!EVM_CHAINS.has(args.chain)) {
    throw new Error(`signMessage does not support chain: ${args.chain}`);
  }

  // EVM: EIP-191 personal_sign or EIP-712 typed data
  let digestHex: Hex;
  let scheme: SignScheme;
  if (args.typedData) {
    digestHex = hashTypedData(args.typedData);
    scheme = "eip712";
  } else {
    if (!args.message) {
      throw new Error("message or typedData is required for EVM message signing");
    }
    digestHex = hashMessage(args.message);
    scheme = "eip191";
  }
  const digestBytes = Array.from(Buffer.from(digestHex.slice(2), "hex"));

  const sigs = (await contract.sign({
    payloads: [digestBytes],
    path,
    keyType: "Ecdsa",
    signerAccount,
  })) as unknown as Array<{ r: string; s: string; v: number }>;
  const sig = sigs[0];

  // chainsig.js toRSV returns v as recovery_id + 27 (canonical for personal_sign).
  // Build (r || s || v) and verify by recovery. If wrong, flip v 27 ↔ 28 and retry.
  const candidate = (v: number): Hex => {
    const vHex = v.toString(16).padStart(2, "0");
    return `0x${sig.r}${sig.s}${vHex}` as Hex;
  };

  let signature = candidate(sig.v);
  const recover = async (s: Hex): Promise<Address> => {
    if (scheme === "eip191") {
      return recoverMessageAddress({ message: args.message!, signature: s });
    }
    return recoverTypedDataAddress({ ...args.typedData!, signature: s });
  };

  let recovered: Address = (await recover(signature).catch(() => "0x0")) as Address;
  if (recovered.toLowerCase() !== derived.address.toLowerCase()) {
    const flipped = candidate(sig.v === 27 ? 28 : 27);
    const flippedRecovered = (await recover(flipped).catch(() => "0x0")) as Address;
    if (flippedRecovered.toLowerCase() === derived.address.toLowerCase()) {
      signature = flipped;
      recovered = flippedRecovered;
    }
  }

  return {
    chain: args.chain,
    address: derived.address,
    scheme,
    signature,
    digestHex,
    recoveredAddress: recovered,
  };
}
