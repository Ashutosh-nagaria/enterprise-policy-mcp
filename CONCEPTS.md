# Understanding This Project: From Zero to PM-Level

This document explains every concept behind this MCP server, starting from the absolute basics. It's written for someone with no coding background who wants to genuinely understand what was built, not just that it works.

Each concept is explained twice: first in plain, everyday language (ELI5), then with the correct technical framing (so you can use the real vocabulary confidently in an interview).

---

## 1. What is MCP?

**ELI5:** Imagine every AI assistant needs to plug into other tools and data sources, a calendar, a database, a company's internal documents. Without a shared standard, every company would invent its own private way of doing this, and every AI would need custom wiring for every single tool. MCP (Model Context Protocol) is a shared plug shape everyone agrees on, like a USB port. Build your tool the MCP way, and any MCP-compatible AI can plug into it, no custom wiring needed.

**Technical:** MCP is an open protocol, created by Anthropic, that standardizes how AI applications (clients) discover and call external functions (tools), read external data (resources), and use pre-written prompt templates. It defines the message format, the discovery process, and the calling convention, so any compliant client and any compliant server can talk to each other without custom integration code.

**PM framing:** This is the same problem enterprise connector platforms (Glean, and similar) solve at a larger scale, standardizing how an AI-native product ingests and permissions access to many different data sources. Understanding MCP gives you the vocabulary and mental model for evaluating connector architecture decisions in a PM role.

---

## 2. Client vs. Server

**ELI5:** Think of a restaurant. The **server** (your `server.js`) is the kitchen, it holds the actual capabilities and does the cooking. The **client** is the customer, it doesn't cook anything itself, it just asks the kitchen for what it wants and waits for the response.

**Technical:** In MCP, the *server* is the program that exposes tools, resources, and prompts. The *client* is the program (an AI application, or a testing tool) that connects to a server and invokes its capabilities. A single client can connect to multiple servers; a single server can be connected to by multiple clients.

**In this project:** `server.js` is always the server. Early testing used the **MCP Inspector** (a tool Anthropic built) as a stand-in client, pretending to be an AI so we could test without needing a real one connected. Later, real clients (Claude Desktop, Gemini CLI) take over that role.

---

## 3. Tools

**ELI5:** A tool is one specific thing your server knows how to do, like "look up a policy" or "check permissions." You describe the tool once; the AI reads that description and decides on its own when to use it, based on what the user actually asked.

**Technical:** A tool is a function exposed to the model with four parts:
1. **Name** — the internal identifier the AI uses to call it (e.g. `get_policy`)
2. **Description** — the sentence the AI reads to decide *when* to use this tool. This is the real product surface; a vague description means the AI never calls it, or calls it wrong.
3. **Schema** — the strict, required shape of the input (built with Zod in this project)
4. **Handler function** — the actual code that runs when the tool is called

**PM framing:** The description field is arguably the most important design decision in a tool-based system. It's the interface between your system and the model's judgment, closer to writing a spec than writing code. This is worth naming explicitly in an interview: tool design is a product design problem, not just an engineering one.

---

## 4. Schemas (and why Zod matters)

**ELI5:** A schema is a strict form the AI has to fill out correctly before your tool will run. It can't just say something vague, it has to give exact, checkable information: the right fields, the right types.

**Technical:** Zod is a schema validation library. In this project, `z.string()`, `z.enum([...])`, and similar functions define exactly what shape each tool's input must take. If a caller sends invalid input, Zod rejects it *before* your tool logic ever runs, this is what caused the correctly-rejected `401`/validation errors we tested in the eval suite.

**Why this matters practically:** this project's `callerRole` field uses `z.enum(["Associate", "Senior", "Executive"])`, meaning only those three exact values are ever accepted. Anything else (a typo, an unexpected role name, a wrong data type) gets rejected automatically, no custom validation code needed.

---

## 5. Local (stdio) vs. Public (HTTP) Transport

**ELI5:** Stdio is like passing notes between two people at the same desk, it only works because they're physically together. HTTP is like mailing a letter, sender and receiver can be anywhere, they just need each other's address.

**Technical:** *stdio* (standard input/output) lets a client and server communicate only when both run as processes on the same machine, useful for local development and testing. *StreamableHTTP* transport lets the server listen on a real network port and accept requests from anywhere on the internet, using the same protocol (HTTP) that powers the web.

**In this project:** Chapters 1–4 used stdio exclusively, only reachable from the same laptop. Chapter 5 swapped this for StreamableHTTP, using Express (a Node.js web framework) to give the server a real, public address.

---

## 6. What Express Actually Does

**ELI5:** Express is the receptionist for your server, it listens at the front door and decides what to do with each visitor who knocks.

**Technical:** Express is a widely-used Node.js framework for building HTTP servers. `app.post("/mcp", ...)` defines a specific address (`/mcp`) and says "handle any POST request that arrives here." `app.listen(PORT, ...)` turns the server on and keeps it actively listening.

---

## 7. Ports

**ELI5:** If your computer is a building, a port number is which specific numbered door your server is listening at.

**Technical:** A port is a numbered communication endpoint on a machine. `PORT = process.env.PORT || 3000` means "use whatever port the hosting environment assigns, or default to 3000 if running locally." Render assigns its own port number in production (we saw port `10000` in the logs), which is why reading it from an environment variable, rather than hardcoding it, matters.

---

## 8. The MCP Inspector

**ELI5:** A testing tool that pretends to be an AI, so you can click buttons and see what your server does, without needing a real AI conversation.

**Technical:** An official tool from Anthropic that starts your server, connects to it as a client would, and provides a web interface for manually invoking tools and inspecting raw protocol messages (`initialize`, `tools/list`, `tools/call`). Useful for local development; not part of the shipped project itself.

---

## 9. Environment Variables and Secrets

**ELI5:** A piece of configuration that lives outside your code, set separately on whatever machine is running it, so a secret value (like a password) never has to be typed directly into a file that gets shared publicly.

**Technical:** `process.env.MCP_API_KEY` reads a value injected into the running process's environment, rather than hardcoded in `server.js`. Locally, this is set by prefixing the run command (`MCP_API_KEY=xyz node server.js`). On Render, it's set in the dashboard's Environment tab. This is why the real API key never appears anywhere in the GitHub repo, only the *logic* that checks for one does.

**PM framing:** this is the standard, industry-correct pattern for handling secrets, and worth naming explicitly if asked about security practices in an interview.

---

## 10. API Key Authentication

**ELI5:** A secret password your server checks on every single request, before doing anything else. No valid password, no response, just a polite "not allowed."

**Technical:** Every request carries the key in an HTTP header (`x-api-key`), a piece of metadata riding alongside the actual request, distinct from the request's actual content. The server compares the provided key against `process.env.MCP_API_KEY` on every incoming request; a mismatch returns `401 Unauthorized` before any tool logic runs.

**Why headers, not the request body:** headers are the conventional place for authentication and metadata, keeping "who is asking" separate from "what are they asking for."

---

## 11. Role-Based Access Control (Section-Level, Not Document-Level)

**ELI5:** Instead of saying "this whole document is for managers only," you tag each *individual paragraph* with who's allowed to see it. Someone reading the same document sees different amounts of it depending on who they are.

**Technical:** Each policy section carries a `minRole` (`Associate`, `Senior`, or `Executive`). A numeric rank (`{ Associate: 1, Senior: 2, Executive: 3 }`) allows simple comparison: a caller's role rank must be greater than or equal to a section's required rank for that section to be included in the response. This filtering happens **before** the response is built, an Associate calling `get_policy` never has the Executive compensation band fetched and then hidden; it's never retrieved for that response at all.

**Why this design choice matters:** this project deliberately caught and fixed the same class of bug found in an earlier project (a RAG-based connector), where document-level permission tags let sensitive role-specific numbers leak because permission was tagged too coarsely. Retelling this specific bug and fix, twice, in two different architectures, is a genuinely strong "I understand access control as a first-class design problem" story for a PM interview, not just a feature you added.

---

## 12. Evaluation Suites (Why "It Works" Isn't Enough)

**ELI5:** Clicking around a few times and confirming things look right proves very little. A benchmark is a big, fixed list of test questions, written down in advance, each with a known correct answer, checked automatically, every time.

**Technical:** This project's eval suite (`eval/test-cases.json` + `eval.js`) contains 39 test cases across three categories:
- **Functional** (23 cases): normal usage, confirming correct behavior across all 9 policies and all 3 roles
- **Safety** (10 cases): invalid inputs, missing data, malformed requests
- **Failure/fallback** (6 cases): unknown tool calls, wrong data types, edge cases like whitespace padding

`eval.js` acts as an automated client: it starts the server, sends all 39 requests programmatically, checks each response against an expected outcome, and prints a pass/fail scoreboard.

**PM framing:** "39/39 passing" is a much stronger, more defensible claim than "I tested it and it worked," because it's repeatable, versioned, and can be re-run after any change to catch regressions. This is the same discipline behind product quality metrics; a number that can be recomputed on demand is more trustworthy than a one-time observation.

---

## 13. The Eval Bug (A Real Debugging Story)

**What happened:** the first run of the eval suite scored 31/39. All 8 failures were cases expecting the server to correctly reject bad input (an invalid role, a missing field, an unknown tool). Debugging revealed the server was rejecting every one of them correctly, the bug was in the eval script's assumptions, not the server.

**The specific mistake:** the eval script assumed a rejected MCP tool call would break the connection (throw an exception in the client code). In reality, MCP returns validation failures as a **normal, successful HTTP response**, with an `isError: true` flag embedded inside it. The fix was checking that flag directly, instead of assuming a dropped connection.

**Why this is worth including in the README rather than hiding it:** finding this required adding a debug print statement, reading the raw response structure, forming a hypothesis, and testing it, real debugging methodology, not guesswork. A clean-looking 39/39 with no story behind it is less convincing than "I got 31/39, found the real cause, fixed the right thing."

---

## 14. Git and GitHub, From Scratch

**ELI5:** Git is a system for saving snapshots of your project's history, so you can always see what changed and when. GitHub is a website that hosts a copy of that history online, so others can see it, or your own different machines can stay in sync.

**Technical, the core commands used in this project:**

| Command | What it does |
|---|---|
| `git init` | Turns a normal folder into one Git can track (once, ever, per project) |
| `git add <file>` | Stages a file, marking it ready to be included in the next snapshot |
| `git commit -m "..."` | Saves a permanent snapshot of everything staged, with a description |
| `git push` | Uploads local commits to GitHub |
| `git pull` | Downloads commits from GitHub that your local copy doesn't have yet |
| `git clone <url>` | Downloads a full copy of a GitHub repo to a new folder |
| `git status` | Shows what's changed, staged, or out of sync |
| `.gitignore` | A file listing patterns Git should never track (e.g. `node_modules/`, `.DS_Store`) |

**A real mistake worth remembering:** a malformed `.gitignore` line (`*.log.DS_Store` instead of two separate lines) silently failed to ignore macOS system files for several commits, until the pattern was spotted and fixed. Small formatting details in config files have real consequences.

---

## 15. Deployment (Render)

**ELI5:** Your laptop only runs your server while it's open and you've typed the start command. Render rents you a small, always-on computer somewhere on the internet, and keeps your server running there permanently, with a real public address.

**Technical:** Render connects to your GitHub repo, runs your **Build Command** (`npm install`, downloading dependencies) and **Start Command** (`node server.js`, starting the server), and exposes it on a public HTTPS URL. Environment variables (like `MCP_API_KEY`) are set in Render's dashboard, never in the code itself. The free tier spins the service down after inactivity; the first request after idle time can take 20–30 seconds while it wakes back up.

---

## 16. The Shared-State Bug (The Real Production Debugging Story)

**What happened:** after deploying, the server worked on the *first* request, then returned `500 Internal Server Error` on the next one, consistently, every time after the first.

**Root cause:** the server and transport objects were created **once**, when the process started, and reused for every incoming request. A single `StreamableHTTPServerTransport` connected to a single `McpServer` instance can only cleanly handle one active connection lifecycle; reusing it across separate, unrelated HTTP requests corrupts its internal state.

**The fix:** wrap tool registration in a function (`createMcpServer()`) and call it **fresh, inside the request handler, for every single incoming request**, building a brand-new server and transport pair each time, with no state carried between requests.

**Why this is a legitimate production-grade lesson:** "stateless per request" is a standard, correct pattern for HTTP servers handling independent requests. Hitting this bug, diagnosing it through logs and a formed hypothesis, applying a first (incomplete) fix, discovering it still failed, and finding the *actual* root cause is a stronger, more honest debugging narrative than a deployment that worked cleanly on the first try.

---

## 17. Putting It All Together: The System in One Paragraph

A person's AI client (Claude, Gemini) connects over HTTPS to a live server, presenting an API key in a request header. The server checks that key before doing anything else. If valid, it builds a fresh internal server instance, registers three tools (each with a name, description, and strict input schema), and hands the request to the matching tool. Two of those tools filter a JSON dataset of enterprise policies by comparing the caller's role against a `minRole` tag on each individual section, only returning what that role is permitted to see. Every piece of this, the tool logic, the permission filtering, the auth check, is covered by an automated 39-case test suite that runs as a real HTTP client against a running server and can be re-run at any time to catch regressions. All of it is deployed, versioned in Git, and publicly documented.

---

## What this project actually demonstrates

- **Connector architecture.** Filtering happens at the point of retrieval, not after the fact, the same principle behind enterprise ACL-scoped systems.
- **Tool design as product design.** The tool description is the real interface between the system and the AI's judgment, closer to a spec than an implementation detail.
- **Evaluation discipline.** A 39-case automated benchmark, split across functional, safety, and failure-handling categories, that connects over the same transport the server actually runs, not a shortcut that only worked by accident.
- **Real debugging, more than once.** The same class of permission-tagging bug showed up in two separate projects. A genuine production bug (shared state across HTTP requests) got diagnosed by reading logs, forming a hypothesis, and testing it. A silently-hanging eval script, after the stdio-to-HTTP migration, got caught and rewritten rather than left broken with a stale passing claim in the README.
- **Security practices.** Secrets never touch the codebase, they're injected via environment variables, checked on every request before any tool logic runs.

---

*This document was written to accompany [enterprise-policy-mcp](https://github.com/Ashutosh-nagaria/enterprise-policy-mcp), built end-to-end in a single hands-on session covering MCP fundamentals, tool design, permission-aware retrieval, automated evaluation, Git/GitHub workflows, and live HTTP deployment with authentication.*
