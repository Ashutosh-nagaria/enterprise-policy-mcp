import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFile } from "fs/promises";

const testFile = JSON.parse(
  await readFile(new URL("./eval/test-cases.json", import.meta.url))
);

const SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:3000/mcp";
const API_KEY = process.env.MCP_API_KEY;

if (!API_KEY) {
  console.error("Set MCP_API_KEY to the same value the server is running with, then re-run this.");
  process.exit(1);
}

const transport = new StreamableHTTPClientTransport(new URL(SERVER_URL), {
  requestInit: { headers: { "x-api-key": API_KEY } }
});

const client = new Client({ name: "eval-client", version: "1.0.0" });
await client.connect(transport);

let passed = 0;
let failed = 0;
const failures = [];

function checkExpectation(test, resultText) {
  const expect = test.expect;

  if (expect.type === "policyCount") {
    const parsed = JSON.parse(resultText);
    return Array.isArray(parsed) && parsed.length === expect.value;
  }

  if (expect.type === "sectionCount") {
    const parsed = JSON.parse(resultText);
    return parsed.sections && parsed.sections.length === expect.value;
  }

  if (expect.type === "allowed") {
    const parsed = JSON.parse(resultText);
    return parsed.allowed === expect.value;
  }

  if (expect.type === "notFoundMessage") {
    return resultText.includes(expect.contains);
  }

  return false;
}

for (const test of testFile.cases) {
  try {
    const response = await client.callTool({
      name: test.tool,
      arguments: test.arguments
    });

    const resultText = response.content[0].text;

    if (test.expect.type === "schemaError" || test.expect.type === "clientError") {
      if (response.isError) {
        passed++;
      } else {
        failed++;
        failures.push({ id: test.id, reason: "Expected an error, but the call succeeded." });
      }
      continue;
    }

    const ok = checkExpectation(test, resultText);
    if (ok) {
      passed++;
    } else {
      failed++;
      failures.push({ id: test.id, reason: `Unexpected result: ${resultText.slice(0, 150)}` });
    }
  } catch (err) {
    if (test.expect.type === "schemaError" || test.expect.type === "clientError") {
      passed++;
    } else {
      failed++;
      failures.push({ id: test.id, reason: `Unexpected error: ${err.message}` });
    }
  }
}

console.log(`\n=== Results: ${passed}/${testFile.cases.length} passed ===\n`);

if (failures.length > 0) {
  console.log("Failures:");
  for (const f of failures) {
    console.log(`  ${f.id}: ${f.reason}`);
  }
}

await client.close();
process.exit(failed > 0 ? 1 : 0);
