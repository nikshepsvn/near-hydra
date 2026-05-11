// Boots the MCP server in-process, registers all tools against a fresh
// McpServer, and asserts the registration count and names. No network.
// Used by CI as a fast structural test.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../packages/mcp-server/dist/tools.js";

const EXPECTED = [
  "hydra_config_show",
  "hydra_account_view",
  "hydra_contract_view",
  "hydra_address_derive",
  "hydra_address_balance",
  "hydra_account_balance_all_chains",
  "hydra_swap_tokens",
  "hydra_swap_quote",
  "hydra_swap_status",
  "hydra_swap_submit_deposit",
  "hydra_send_near",
  "hydra_send_ft",
  "hydra_contract_call",
  "hydra_send_evm",
  "hydra_send_btc",
  "hydra_send_solana",
  "hydra_send_spl",
  "hydra_create_agent_key",
  "hydra_sign_message",
  "hydra_ensure_gas",
  "hydra_swap_execute",
];

const server = new McpServer({ name: "smoke", version: "0.0.0" });
const seen = [];
const original = server.registerTool.bind(server);
server.registerTool = (name, ...rest) => {
  seen.push(name);
  return original(name, ...rest);
};

registerTools(server);

const missing = EXPECTED.filter((n) => !seen.includes(n));
if (missing.length > 0) {
  console.error(`✗ missing tools: ${missing.join(", ")}`);
  process.exit(1);
}
if (seen.length !== EXPECTED.length) {
  console.error(`✗ expected ${EXPECTED.length} tools, got ${seen.length}: ${seen.join(", ")}`);
  process.exit(1);
}
console.log(`✓ ${seen.length} MCP tools registered: ${seen.join(", ")}`);
