import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  loadConfig,
  getChainsResource,
  getConfigResource,
  getPolicyResource,
  getTokensResource,
} from "near-hydra-core";

function jsonResource(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function registerResources(server: McpServer) {
  server.registerResource(
    "chains",
    "near-hydra://chains",
    {
      title: "Supported chains",
      description:
        "List of chains near-hydra can derive addresses on and sign for, with default derivation paths.",
      mimeType: "application/json",
    },
    async () => jsonResource("near-hydra://chains", getChainsResource()),
  );

  server.registerResource(
    "tokens",
    "near-hydra://tokens",
    {
      title: "Cross-chain swap tokens",
      description:
        "1Click-supported tokens for cross-chain swaps. Cached for 5 minutes per (baseUrl, apiKey).",
      mimeType: "application/json",
    },
    async () => jsonResource("near-hydra://tokens", await getTokensResource(loadConfig())),
  );

  server.registerResource(
    "config",
    "near-hydra://config",
    {
      title: "Active configuration",
      description:
        "Current near-hydra configuration summary (network, MPC contract, RPCs). Does not include private keys.",
      mimeType: "application/json",
    },
    async () => jsonResource("near-hydra://config", getConfigResource(loadConfig())),
  );

  server.registerResource(
    "policy",
    "near-hydra://policy",
    {
      title: "Active policy",
      description: "Current safety policy: readOnly flag and optional value caps.",
      mimeType: "application/json",
    },
    async () => jsonResource("near-hydra://policy", getPolicyResource(loadConfig())),
  );
}
