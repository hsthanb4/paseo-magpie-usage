Displays real-time quotas for local Magpie gateway accounts in Paseo's Usage views and as a composer pill directly inside the agent input toolbar.

Features:
1. **Composer Pill**: A persistent pill on the agent composer track bar displaying the active session model's quota percentage (e.g. `Gemini 14%`, `Codex 96%`) and cooling status. Clicking the pill opens a detailed quota popover.
2. **Native Usage Source**: Integrates directly into Settings → Usage and sidebar usage views alongside built-in providers.
3. **Session Awareness**: Automatically matches and highlights the active agent's provider with a `Current session` indicator.
4. **Detailed Windows**: Displays 7-day cycles, 5-hour limits, credit balances, and reset countdowns.
5. **Interactive Controls**: Toggle between used vs. remaining percentages, and mask sensitive email addresses.

Requirements:
Magpie must be running on the same machine as the Paseo daemon (`http://127.0.0.1:3425` by default, or set via `MAGPIE_BASE_URL`).
