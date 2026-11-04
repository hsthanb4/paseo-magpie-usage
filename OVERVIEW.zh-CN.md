在 Paseo 的用量（usage）视图中显示本机 Magpie 网关里每个账号的剩余额度，与内置的 Codex、Claude 等用量来源并列。

插件在 daemon 所在主机上读取 `http://127.0.0.1:3425/v1/magpie/quotas`。每个 Magpie 账号（Codex、Kiro、Antigravity、WorkBuddy、Qoder、OpenRouter 等）对应一条用量报告，包括各个窗口（7 天、5 小时、分池限额）、积分余额、套餐名和重置时间。Magpie 报告为过期或被封禁的账号会显示 Magpie 给出的错误信息。AI Studio 的代理出口、管理页这类说明性条目会被过滤掉。

对于经由 Magpie 路由的会话，会话内的用量只显示对应 Provider 的账号。识别方式：模型 ID 为 `magpie/<provider>/<model>`（Pi、OpenCode），或会话环境里某个 `*_BASE_URL` 指向 Magpie 网关。

前提：Magpie 需在 Paseo daemon 同一台机器上运行。网关不在默认地址时，在 daemon 环境中设置 `MAGPIE_BASE_URL`。结果缓存 10 秒，除本机网关外不向任何地方发送数据。
