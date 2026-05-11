#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { registerResources } from "./resources.js";

async function main() {
  const server = new McpServer(
    { name: "near-hydra", version: "0.5.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerTools(server);
  registerResources(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[near-hydra-mcp] fatal:", err);
  process.exit(1);
});
