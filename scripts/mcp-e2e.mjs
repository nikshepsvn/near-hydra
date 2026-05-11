// Spawns the MCP server as a subprocess, speaks MCP over stdio, and verifies
// initialize + tools/list + a read-only tool call (hydra_config_show) end-to-end.
// This is what Claude Code or any MCP client does — if this passes, real
// integration works.
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SERVER = join(__dirname, "..", "packages", "mcp-server", "dist", "index.js");

function rpcMessage(id, method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}

async function run() {
  const proc = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"], env: process.env });

  let buf = "";
  const responses = new Map();
  const ready = new Map();
  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined) {
          responses.set(msg.id, msg);
          const r = ready.get(msg.id);
          if (r) r();
        }
      } catch {
        /* ignore non-JSON lines */
      }
    }
  });

  let stderrBuf = "";
  proc.stderr.on("data", (c) => (stderrBuf += c.toString()));

  function call(id, method, params) {
    return new Promise((resolve) => {
      ready.set(id, () => resolve(responses.get(id)));
      proc.stdin.write(rpcMessage(id, method, params));
    });
  }

  const init = await call(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "near-hydra-e2e", version: "1.0" },
  });
  if (!init?.result) throw new Error("initialize failed: " + JSON.stringify(init));
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const list = await call(2, "tools/list", {});
  const toolNames = (list?.result?.tools ?? []).map((t) => t.name).sort();
  // Source of truth for the tool count is scripts/smoke-tools.mjs, which is
  // the in-process registration test wired into CI alongside this stdio test.
  // We intentionally check ≥ a minimum here so adding a tool only requires
  // updating one file (smoke-tools.mjs).
  const MIN_TOOLS = 21;
  if (toolNames.length < MIN_TOOLS) {
    throw new Error(
      `Expected at least ${MIN_TOOLS} tools, got ${toolNames.length}: ${toolNames.join(", ")}`,
    );
  }
  console.log(`✓ tools/list returned ${toolNames.length} tools`);

  const cfg = await call(3, "tools/call", { name: "hydra_config_show", arguments: {} });
  const cfgText = cfg?.result?.content?.[0]?.text;
  if (!cfgText || !cfgText.includes("network")) {
    throw new Error(`hydra_config_show response unexpected: ${JSON.stringify(cfg)}`);
  }
  const cfgJson = JSON.parse(cfgText);
  console.log(`✓ hydra_config_show → network=${cfgJson.network}, mpcContract=${cfgJson.mpcContract}`);

  const acct = await call(4, "tools/call", {
    name: "hydra_account_view",
    arguments: { accountId: "near" },
  });
  const acctText = acct?.result?.content?.[0]?.text;
  if (!acctText) throw new Error("hydra_account_view returned no content");
  const acctJson = JSON.parse(acctText);
  if (!acctJson.balance?.totalNear) throw new Error(`Unexpected: ${acctText.slice(0, 200)}`);
  console.log(`✓ hydra_account_view 'near' → ${acctJson.balance.totalNear} NEAR total`);

  const derive = await call(5, "tools/call", {
    name: "hydra_address_derive",
    arguments: { chain: "bitcoin", predecessor: "near" },
  });
  const dText = derive?.result?.content?.[0]?.text;
  if (!dText) throw new Error("derive returned no content");
  const dJson = JSON.parse(dText);
  if (!dJson.address?.startsWith("bc1")) {
    throw new Error(`Unexpected derived BTC address: ${dText.slice(0, 200)}`);
  }
  console.log(`✓ hydra_address_derive(bitcoin, near) → ${dJson.address}`);

  const resList = await call(6, "resources/list", {});
  const resources = resList?.result?.resources ?? [];
  const expectedResources = ["chains", "tokens", "config", "policy"];
  for (const name of expectedResources) {
    if (!resources.find((r) => r.name === name)) {
      throw new Error(
        `Missing resource '${name}'. Got: ${resources.map((r) => r.name).join(", ")}`,
      );
    }
  }
  console.log(`✓ resources/list returned ${resources.length} resources: ${resources.map((r) => r.name).join(", ")}`);

  const chainsRead = await call(7, "resources/read", { uri: "near-hydra://chains" });
  const chainsText = chainsRead?.result?.contents?.[0]?.text;
  if (!chainsText) throw new Error("resources/read near-hydra://chains returned no content");
  const chainsJson = JSON.parse(chainsText);
  if (!Array.isArray(chainsJson.supported) || chainsJson.supported.length < 10) {
    throw new Error(`Unexpected chains resource shape: ${chainsText.slice(0, 200)}`);
  }
  console.log(`✓ resources/read near-hydra://chains → ${chainsJson.supported.length} chains`);

  proc.kill();
  console.log("\n✓ MCP end-to-end test passed. Server speaks correct protocol; real LLM clients will work.");
}

run().catch((err) => {
  console.error("✗ MCP e2e failed:", err);
  process.exit(1);
});
