# Magpie MCP for PI-Desktop

A PI-Desktop plugin that contributes one HTTP MCP server, `magpie`, pointing at
magpie's per-agent MCP hub endpoint
(`http://127.0.0.1:3425/mcp/magpie/hub/pi-desktop-app`). That endpoint serves
exactly the servers ticked for PI-Desktop in magpie's Library, so the Library
stays the only place servers are added, edited, switched off or assigned.

`manifest.json` declares `net.domains: ["127.0.0.1"]`; PI-Desktop refuses a
remote MCP endpoint that is not on the plugin's egress allowlist, loopback
included.

## Requirements

- PI-Desktop 0.22 or newer.
- magpie's MCP hub on. In `~/.config/magpie/library.json` that is `"mcpHub": true`.
  With the Library's router switch off, the hub connects but lists no tools.
- At least one server ticked for PI-Desktop on Library › MCP. A custom agent is
  given `find_tools` / `call_tool` rather than the full tool list; that is the
  router's on-demand loading.

## Install

Quit PI-Desktop, then:

```sh
node install.mjs
```

Or copy this folder to `~/.pi-desktop/plugins/installed/blackzhuge.magpie-mcp`
and add its row to `~/.pi-desktop/plugins/registry.json` while PI-Desktop is
closed. PI-Desktop's own “install from folder” action does the same and needs no
restart afterwards.

`main.js` has no behaviour; the server is declared in `manifest.json`.

## Uninstall

With PI-Desktop quit, delete the plugin folder and its row from
`~/.pi-desktop/plugins/registry.json`.
