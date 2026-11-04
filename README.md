# paseo-magpie-usage

Paseo 插件：把本机 Magpie 网关（`127.0.0.1:3425`）的各账号额度接入 Paseo 原生的用量（usage）系统。功能对应 [dsh-magpie-usage](https://github.com/hsthanb4/dsh-magpie-usage)。

实现上它是一个 usage source（`server.registerUsageSource`），所以显示位置、圆环、刷新都由 Paseo 自己的用量 UI 负责，不需要客户端代码。

## 安装

```bash
# Paseo 默认关闭插件，需先在 ~/.paseo/config.json 里设置 "pluginsEnabled": true
paseo plugin install /path/to/paseo-magpie-usage   # 或 git:hsthanb4/paseo-magpie-usage
paseo usage ls                                     # 查看全部 Magpie 账号
paseo usage ls --agent <agent-id>                  # 只看该会话所用 Provider 的账号
```

## 开发

```bash
npm install
npm run typecheck
paseo plugin reload magpie-usage-source
paseo plugin logs magpie-usage-source
```

环境变量 `MAGPIE_BASE_URL` 可覆盖网关地址。
