#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAkahuClient } from "./akahu.js";
import { loadConfig, type Config } from "./config.js";
import { buildServer } from "./server.js";

async function main() {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    // stdout is the MCP channel, so diagnostics go to stderr.
    console.error((err as Error).message);
    console.error("See README.md for how to get your Akahu App and User tokens.");
    return process.exit(1);
  }

  const server = buildServer({ akahu: createAkahuClient(config), token: config.userToken, config });
  await server.connect(new StdioServerTransport());
  console.error(`Akahu MCP server running (payments ${config.enablePayments ? "ENABLED" : "disabled"}).`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
