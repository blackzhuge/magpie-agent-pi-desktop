# Magpie MCP for PI-Desktop

A PI-Desktop plugin that contributes one HTTP MCP server, `magpie`, pointing at
magpie's MCP hub (`http://127.0.0.1:3425/mcp/magpie/hub`). The hub serves every
server in magpie's Library, so the Library stays the only place servers are
added, edited or turned off.

## Requirements

- PI-Desktop 0.22 or newer.
- magpie's MCP hub on. In `~/.config/magpie/library.json` that is `"mcpHub": true`.
  With the Library's router switch off, the hub connects but lists no tools.

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
