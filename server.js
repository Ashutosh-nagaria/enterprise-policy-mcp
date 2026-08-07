import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { readFile } from "fs/promises";

const policiesData = JSON.parse(
  await readFile(new URL("./data/policies.json", import.meta.url))
);

const roleRank = { Associate: 1, Senior: 2, Executive: 3 };

function createMcpServer() {
  const server = new McpServer({
    name: "dundermifflin-mcp",
    version: "1.0.0"
  });

  server.tool(
    "list_policies",
    "Lists all available DunderMifflin policies, showing their zone, topic, and effective regions",
    {},
    async () => {
      const summary = policiesData.policies.map((policy) => ({
        id: policy.id,
        zone: policy.zone,
        topic: policy.topic,
        effectiveRegions: policy.effectiveRegions
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }
  );

  server.tool(
    "get_policy",
    "Retrieves a DunderMifflin policy by ID, returning only the sections the caller's role is permitted to see",
    {
      policyId: z.string().describe("The policy ID, e.g. 'americas-hiring'"),
      callerRole: z.enum(["Associate", "Senior", "Executive"]).describe("The role of the person asking, used to filter visible sections")
    },
    async ({ policyId, callerRole }) => {
      const policy = policiesData.policies.find((p) => p.id === policyId);
      if (!policy) {
        return { content: [{ type: "text", text: `No policy found with id "${policyId}". Use list_policies to see valid IDs.` }] };
      }
      const callerRank = roleRank[callerRole];
      const visibleSections = policy.sections.filter((section) => roleRank[section.minRole] <= callerRank);
      const hiddenCount = policy.sections.length - visibleSections.length;
      const result = {
        id: policy.id,
        zone: policy.zone,
        topic: policy.topic,
        effectiveRegions: policy.effectiveRegions,
        sections: visibleSections,
        note: hiddenCount > 0
          ? `${hiddenCount} section(s) hidden, requires a higher role than ${callerRole}.`
          : "All sections visible for this role."
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "check_access",
    "Checks whether a given role is allowed to view a specific section of a policy, without returning the content",
    {
      policyId: z.string().describe("The policy ID, e.g. 'americas-hiring'"),
      sectionId: z.string().describe("The section ID within that policy, e.g. 'compensation-executive'"),
      callerRole: z.enum(["Associate", "Senior", "Executive"]).describe("The role of the person asking")
    },
    async ({ policyId, sectionId, callerRole }) => {
      const policy = policiesData.policies.find((p) => p.id === policyId);
      if (!policy) {
        return { content: [{ type: "text", text: `No policy found with id "${policyId}".` }] };
      }
      const section = policy.sections.find((s) => s.id === sectionId);
      if (!section) {
        return { content: [{ type: "text", text: `No section "${sectionId}" found in policy "${policyId}".` }] };
      }
      const allowed = roleRank[section.minRole] <= roleRank[callerRole];
      const result = {
        policyId,
        sectionId,
        callerRole,
        requiredRole: section.minRole,
        allowed,
        reason: allowed
          ? `${callerRole} meets the minimum role (${section.minRole}) for this section.`
          : `${callerRole} does not meet the minimum role (${section.minRole}) required for this section.`
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  return server;
}

const VALID_API_KEY = process.env.MCP_API_KEY;

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const providedKey = req.headers["x-api-key"];

  if (!VALID_API_KEY || providedKey !== VALID_API_KEY) {
    return res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
  }

  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling MCP request:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`DunderMifflin MCP server listening on port ${PORT}`);
});