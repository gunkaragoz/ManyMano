// How the MCP endpoint is advertised (AI catalog + llms.txt) while
// MCP_ENABLED is "true". Kept free of the MCP SDK so these public routes
// don't pull it into the page bundle. Never includes admin links.

export const MCP_PATH = "/mcp";

export const MCP_TOOL_SUMMARIES = [
  { name: "create_signup_sheet", summary: "create a sign-up sheet with tasks and capacities" },
  { name: "create_poll", summary: "create a meeting poll with proposed days or times" },
  { name: "get_event", summary: "read an event's public results (counts only)" },
] as const;

export function isMcpEnabled(env: { MCP_ENABLED?: string }): boolean {
  return env.MCP_ENABLED === "true";
}

export function mcpEndpoint(siteUrl: string): string {
  return `${siteUrl}${MCP_PATH}`;
}

/** One ARD ai-catalog entry: an inline server card for the remote endpoint. */
export function mcpCatalogEntry(site: { siteUrl: string; siteName: string }) {
  const host = new URL(site.siteUrl).hostname;
  const description =
    `Create ${site.siteName} sign-up sheets and meeting polls, and read their public results. ` +
    "No account or API key. Creation returns a public link and a private admin link; no email is sent.";
  return {
    identifier: `urn:air:${host}:mcp:events`,
    displayName: `${site.siteName} MCP server`,
    type: "application/mcp-server-card+json",
    description,
    data: {
      name: `${host}/events`,
      title: `${site.siteName}`,
      description,
      remotes: [{ type: "streamable-http", url: mcpEndpoint(site.siteUrl) }],
      tools: MCP_TOOL_SUMMARIES.map((t) => t.name),
    },
  };
}

/** Lines for llms.txt. */
export function mcpLlmsSection(siteUrl: string): string[] {
  return [
    "## MCP server",
    "",
    `Agents can use the MCP server at ${mcpEndpoint(siteUrl)} (Streamable HTTP, POST only, no auth):`,
    "",
    ...MCP_TOOL_SUMMARIES.map((t) => `- \`${t.name}\`: ${t.summary}.`),
    "",
    "Creating an event sends no email. The result has a public link to share and a private admin link for the organizer only.",
    "",
  ];
}
