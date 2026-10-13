# Provider usage

Project token totals combine the existing session readers with Gemini agent history. Codex reads `CODEX_HOME/sessions` and `CODEX_HOME/archived_sessions` (default home: `~/.codex`); `KEERA_CODEX_SESSIONS_DIR` remains an explicit sessions-directory override. Gemini reads the persistent agent homes created by Keera. Both readers leave transcripts unchanged.

Codex quota snapshots were previously ignored. The usage response now exposes `provider_limits`, keeping each provider separate and retaining the legacy `limits` field. Codex windows come from the latest matching project rollout snapshot, including rate-limit updates that contain no token counts. Only reported 300-minute and 10080-minute windows are labelled as 5h and weekly limits. Expired windows disappear. With no recorded snapshot, no quota is invented.

The status bar shows percentages remaining, a local clock time for a 5h reset, and normalized days/hours for a weekly reset, for example `Codex: 5h limit 30% left · resets at 6:35 PM` and `Codex: Weekly limit 33% left · resets in 2d 3h`. It refreshes while visible. Subscription allowance is distinct from project token totals; Gemini does not expose comparable quota windows through the session recording format.

Gemini standard API token-price estimates are labelled separately from bills. See [Gemini provider setup](gemini-provider.md) for included token categories and pricing limitations.

References:

- [Codex configuration and state locations](https://learn.chatgpt.com/docs/config-file/config-advanced)
- [Codex rate-limit fields](https://learn.chatgpt.com/docs/app-server)
