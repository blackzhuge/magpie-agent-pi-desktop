// PI-Desktop (net.aiuo.pi-desktop) keeps its providers and the model a new
// conversation starts on in ~/.pi-desktop/pi.sqlite, a format magpie's writer
// cannot edit. magpie therefore writes only this JSON control file; the
// package's Bun module (index.mjs) mirrors the choice into the database.
export const agent = {
  // magpie already knows a usage-only client called "pi-desktop" (its
  // requests carry a pi-desktop User-Agent), and a plugin agent cannot take
  // that id, so this agent's id says it is the app magpie sets up.
  id: "pi-desktop-app",
  name: "PI-Desktop",
  icon: "https://raw.githubusercontent.com/blackzhuge/magpie-agent-pi-desktop/main/assets/icon.png",
  dir: "~/.pi-desktop",
  config: "~/.pi-desktop/magpie-agent.json",
  format: "json",
  model: "model",
  // PI-Desktop scans ~/.agents/skills for user skills (host-core's
  // capability_dir: global level is <home>/.agents/<kind>). Instructions are
  // left out: its only global instruction file is the same ~/.pi/agent/AGENTS.md
  // magpie's built-in Pi writes. mcp is a control file: it makes PI-Desktop a
  // target on Library › MCP so servers can be ticked for it, which magpie's
  // MCP router then serves at /mcp/magpie/hub/pi-desktop-app. PI-Desktop
  // itself does not read it; it reads one JSON per server under
  // ~/.agents/servers, which magpie's single-file MCP writer cannot express.
  library: {
    mcp: "~/.pi-desktop/magpie-agent-mcp.json",
    mcpFormat: "claude",
    skills: "~/.agents/skills",
  },
  notice:
    "Quit PI-Desktop before switching, then start it again: new conversations use the selected model. 切换前请退出 PI-Desktop，切换后重新打开，新会话生效。",
}

export function connect({ gateway, model, models }) {
  if (!model?.id || !gateway?.v1) {
    throw new Error("Choose a model with a configured Magpie gateway first.")
  }
  const one = (m) => ({
    id: m.id,
    name: m.name || m.id,
    context: Number.isSafeInteger(m.context) && m.context > 0 ? m.context : 0,
    output: Number.isSafeInteger(m.output) && m.output > 0 ? m.output : 0,
    images: m.images === true,
    efforts: Array.isArray(m.efforts) ? m.efforts.filter((e) => typeof e === "string") : [],
  })
  const catalog = Array.isArray(models) ? models.map(one) : []
  const picked = catalog.find((m) => m.id === model.id) ?? one(model)
  if (!catalog.some((m) => m.id === picked.id)) catalog.push(picked)
  return {
    baseURL: gateway.v1,
    modelInfo: picked,
    catalog,
  }
}
