# magpie-agent-pi-desktop

PI-Desktop ([vastsa/PI-Desktop](https://github.com/vastsa/PI-Desktop),
`net.aiuo.pi-desktop`) on [magpie](https://usemagpie.ai)'s Agents page: pick
one of magpie's models in its row, and new PI-Desktop conversations start on
that model.

PI-Desktop keeps its providers and the model a new conversation starts on in
`~/.pi-desktop/pi.sqlite`, which magpie's config writer cannot edit. The
package therefore has two parts:

- `pi-desktop.agent.js` — the agent descriptor. magpie writes the choice to
  `~/.pi-desktop/magpie-agent.json` and the file is stashed and restored as
  for any other agent.
- `index.mjs` — a module in magpie's Bun plugin host that mirrors that file
  into `pi.sqlite`, and puts the previous rows back when magpie steps out.

## Install

```sh
magpie plugin add github:blackzhuge/magpie-agent-pi-desktop
```

From a checkout:

```sh
magpie plugin add ./magpie-agent-pi-desktop
```

The row appears as **PI-Desktop** when `~/.pi-desktop` exists. Its id is
`pi-desktop-app`: magpie already knows a usage-only client called
`pi-desktop` (requests carrying a `pi-desktop` User-Agent), and a plugin
agent cannot take that id.

## Use

1. Quit PI-Desktop first — it caches settings and can write them back on
   exit.
2. Pick a model for PI-Desktop on magpie's Agents page.
3. Start PI-Desktop again; new conversations use the selected model.

The package reuses PI-Desktop's provider named `magpie` (case-insensitive),
or one whose base URL is the same gateway. If there is none, it adds a local
`auth_kind=none` provider pointing at magpie's gateway. Disconnecting
(`magpie pi-desktop-app default`) restores the reused provider and the
default model, and removes a provider the package added.

## API keys

The package never reads or writes PI-Desktop's secret store. A local magpie
gateway does not require a key. If you enabled `magpie gateway-key`, set the
gateway key once in PI-Desktop's provider settings.

## Compatibility

- PI-Desktop 0.22 (Electron; providers, models and settings in `pi.sqlite`,
  defaults in `kv(ns='app', key='app')`).
- Uses Bun's built-in `bun:sqlite`; no runtime dependencies.
- The restore snapshot lives in `~/.pi-desktop/.magpie-agent/state.json`
  (0600). If PI-Desktop changed the same provider after magpie wrote it, the
  package leaves that change alone on disconnect.

## Uninstall

```sh
magpie pi-desktop-app default
magpie plugin rm magpie-agent-pi-desktop
```

## Development

```sh
bun test
```

The tests build a temporary PI-Desktop-shaped database and exercise connect,
restore and provider creation without touching a real profile.

---

## 中文说明

把 PI-Desktop 加到 magpie 的 Agents 页面。PI-Desktop 把 provider 和默认模型
存在 `~/.pi-desktop/pi.sqlite`，magpie 的文件写入器改不了，所以插件用
`pi-desktop.agent.js` 写控制文件，再由 `index.mjs` 在 magpie 的 Bun 插件宿主
里同步进 SQLite。

安装：

```sh
magpie plugin add github:blackzhuge/magpie-agent-pi-desktop
```

使用：先退出 PI-Desktop，在 magpie 的 Agents 页面给它选一个模型，再启动
PI-Desktop 新建会话即可。选 Default 断开时恢复原来的 provider 和默认模型。

插件不读写 PI-Desktop 的密钥库；本机 magpie 网关默认不校验 key。如果启用了
`magpie gateway-key`，在 PI-Desktop 的 provider 设置里填一次网关 key。

Agent id 是 `pi-desktop-app`：magpie 已内置一个只做用量归因的 `pi-desktop`
客户端，插件不能占用同名 id。

卸载：

```sh
magpie pi-desktop-app default
magpie plugin rm magpie-agent-pi-desktop
```
