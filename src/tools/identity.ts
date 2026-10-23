import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ok, safe, type Context } from "../akahu.js";

export function registerIdentityTools(server: McpServer, ctx: Context) {
  server.registerTool(
    "get_me",
    {
      title: "Get Akahu user",
      description: "Returns the Akahu user whose bank accounts are connected (name, email, when access was granted).",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(async () => {
      const u = await ctx.akahu.users.get(ctx.token);
      const name = u.preferred_name ?? [u.first_name, u.last_name].filter(Boolean).join(" ");
      return ok(`Connected Akahu user: ${name || "(no name on file)"}`, {
        id: u._id,
        preferred_name: u.preferred_name,
        first_name: u.first_name,
        last_name: u.last_name,
        email: u.email,
        access_granted_at: u.access_granted_at,
      });
    }),
  );
}
