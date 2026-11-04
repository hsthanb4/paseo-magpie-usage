Shows the remaining quota of every account in your local Magpie gateway inside Paseo's usage view, next to the built-in Codex, Claude and other usage sources.

The plugin reads `http://127.0.0.1:3425/v1/magpie/quotas` on the daemon host. Each Magpie account (Codex, Kiro, Antigravity, WorkBuddy, Qoder, OpenRouter and so on) becomes one usage report with its windows (7 days, 5 hours, per-pool limits), credit balances, plan name and reset times. Accounts that Magpie reports as expired or blocked show Magpie's error text. Informational rows such as AI Studio's proxy and admin page links are skipped.

For an agent that routes through Magpie, the agent's usage shows only the matching provider's accounts. This is recognised from a `magpie/<provider>/<model>` model id (Pi, OpenCode) or from a `*_BASE_URL` environment variable pointing at the Magpie gateway.

Setup: Magpie must be running on the same machine as the Paseo daemon. Set `MAGPIE_BASE_URL` in the daemon environment if the gateway listens elsewhere. Results are cached for 10 seconds; nothing is sent anywhere except the local gateway.
