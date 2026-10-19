# Gemini CLI provider

Select Gemini CLI in agent creation or send `provider: "gemini"` to the agent or MCP spawn API. Settings > Providers configures its model list and complexity mapping. Built-in defaults are `gemini-3.8-flash` for every complexity tier; custom model IDs are supported.

Install `@google/gemini-cli` with npm and run `gemini` once to authenticate, or provide `GEMINI_API_KEY` / Vertex environment credentials to the Keera process. Login and folder trust dialogs remain interactive in the agent terminal. Missing and incompatible executables produce actionable startup errors. Integration was checked against CLI 0.63.0.

Keera runs Gemini interactively in its existing PTY transport. Model selection uses `--model`, permission modes use `--approval-mode`, and restarts use `--resume latest`. With worktrees enabled, Keera prepares the worktree and launches Gemini in that directory. Existing work is reused. The MCP endpoint is configured as a Streamable HTTP `httpUrl`; messaging, task updates and reports use the existing tools unchanged.

Each agent has a persistent `GEMINI_CLI_HOME` under Keera's `storage/gemini/agent-<id>`. Keera copies user settings, merges its MCP server and command hooks, and links existing cached authentication and configuration assets. Original settings files are preserved. Session history stays separate per agent, including agents sharing a project directory. Authentication completed inside an agent's isolated home stays with that agent. System and project settings still follow Gemini's precedence rules and can override user-level integration settings.

BeforeAgent supplies role/identity context without replacing Gemini's built-in system prompt and marks the agent running. AfterTool clears attention, ToolPermission notifications request attention, and AfterAgent invokes the existing completion/relay lifecycle. Tool allow/deny entries use Gemini's native tool names, such as `read_file`, `write_file` and `run_shell_command`; permission expressions from other providers are not translated. Gemini usage appears in project totals and agent cards from the local session history, including cached input, thinking output and subagent sessions. The usage tooltip includes a Gemini 3.8 Flash standard API token-cost estimate, using the published rates for each message date (including the January 2027 price change). This is not an account bill: subscription/free-tier pricing, grounding fees, cache-storage charges and non-standard service tiers are not inferred. Custom model usage remains visible without an invented price. Deleted local session history no longer contributes to totals.

Gemini's headless `stream-json` events (`init`, `message`, `tool_use`, `tool_result`, `error`, `result`) differ from other provider event protocols. They are not parsed by this interactive PTY integration. Missing prior sessions use Keera's existing fresh-session fallback. Authenticated model execution still requires an available account and quota; CLI/MCP discovery can be checked without model credentials.

Primary references:

- [API token pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [CLI session recording format](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts)
- [Gemini 3.8 Flash model code](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)

- [Configuration, flags and GEMINI_CLI_HOME](https://geminicli.com/docs/reference/configuration/)
- [Authentication](https://geminicli.com/docs/get-started/authentication/)
- [MCP transports](https://geminicli.com/docs/tools/mcp-server/)
- [Hooks](https://geminicli.com/docs/hooks/reference/)
- [Session resume](https://geminicli.com/docs/cli/session-management/)
- [Headless event protocol](https://geminicli.com/docs/cli/headless/)
