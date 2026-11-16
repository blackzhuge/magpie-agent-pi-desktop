import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { syncBridge } from "../bridge.mjs"

const SCHEMA = `
CREATE TABLE providers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, vendor_key TEXT NOT NULL DEFAULT 'custom',
  type TEXT NOT NULL DEFAULT 'openai_compatible', protocol TEXT NOT NULL DEFAULT 'openai_compatible',
  api_style TEXT, auth_kind TEXT NOT NULL DEFAULT 'api_key_and_base_url', base_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1, secret_ref TEXT, default_model_id TEXT,
  config_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  owner_plugin_id TEXT
);
CREATE TABLE models (
  provider_id TEXT NOT NULL, model_id TEXT NOT NULL, display_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user', capabilities_json TEXT NOT NULL DEFAULT '[]',
  context_window INTEGER, max_output_tokens INTEGER, deprecated INTEGER NOT NULL DEFAULT 0,
  discovery_state TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (provider_id, model_id)
) WITHOUT ROWID;
CREATE TABLE kv (ns TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (ns, key)) WITHOUT ROWID;
`

const CONTROL = {
  model: "group/flash",
  baseURL: "http://127.0.0.1:3425/v1",
  modelInfo: { id: "group/flash", name: "Flash", context: 700000, output: 128000, images: true, efforts: ["low", "high"] },
  catalog: [
    { id: "group/flash", name: "Flash", context: 700000, output: 128000, images: true, efforts: ["low", "high"] },
    { id: "zhuge/next", name: "Next", context: 100000, output: 8192, images: false, efforts: [] },
  ],
}

let root
let paths

const db = () => new Database(paths.db)
const row = (sql, ...args) => {
  const d = db()
  try {
    return d.query(sql).get(...args)
  } finally {
    d.close()
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), "pi-desktop-bridge-"))
  paths = {
    control: join(root, "magpie-agent.json"),
    db: join(root, "pi.sqlite"),
    state: join(root, ".magpie-agent", "state.json"),
    lock: join(root, ".magpie-agent", "lock"),
  }
  const d = new Database(paths.db)
  d.run(SCHEMA)
  d.run(
    "INSERT INTO providers (id,name,base_url,default_model_id,config_json,created_at,updated_at) VALUES ('p1','magpie','http://127.0.0.1:3425/v1','old/model',?,1,1)",
    [JSON.stringify({ keep: true, models: [{ id: "old/model", contextWindow: 1000, custom: "kept" }] })],
  )
  d.run("INSERT INTO kv (ns,key,value_json,updated_at) VALUES ('app','app',?,1)", [
    JSON.stringify({ theme: "system", defaultProviderId: "p1", defaultModelId: "old/model" }),
  ])
  d.close()
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe("pi-desktop bridge", () => {
  test("writes the picked model into the magpie provider and restores it", () => {
    fs.writeFileSync(paths.control, JSON.stringify(CONTROL))
    expect(syncBridge(paths)).toBe("connected")

    const provider = row("SELECT default_model_id, config_json FROM providers WHERE id = 'p1'")
    expect(provider.default_model_id).toBe("group/flash")
    const cfg = JSON.parse(provider.config_json)
    expect(cfg.keep).toBe(true)
    expect(cfg.models.map((m) => m.id)).toEqual(["group/flash", "zhuge/next"])
    expect(cfg.models[1]).toMatchObject({ contextWindow: 100000, supportsImages: false })

    expect(JSON.parse(row("SELECT value_json FROM kv").value_json)).toMatchObject({
      theme: "system",
      defaultProviderId: "p1",
      defaultModelId: "group/flash",
    })
    expect(row("SELECT count(*) n FROM models").n).toBe(2)

    fs.rmSync(paths.control)
    expect(syncBridge(paths)).toBe("disconnected")
    expect(row("SELECT default_model_id FROM providers WHERE id = 'p1'").default_model_id).toBe("old/model")
    expect(JSON.parse(row("SELECT config_json FROM providers WHERE id = 'p1'").config_json).models).toEqual([
      { id: "old/model", contextWindow: 1000, custom: "kept" },
    ])
    expect(JSON.parse(row("SELECT value_json FROM kv").value_json).defaultModelId).toBe("old/model")
    expect(fs.existsSync(paths.state)).toBe(false)
  })

  test("adds a provider when PI-Desktop has none, and removes it on disconnect", () => {
    const d = new Database(paths.db)
    d.run("DELETE FROM providers")
    d.run("DELETE FROM models")
    d.run("DELETE FROM kv")
    d.close()

    fs.writeFileSync(paths.control, JSON.stringify({ ...CONTROL, catalog: [CONTROL.modelInfo] }))
    expect(syncBridge(paths)).toBe("connected (provider added)")

    const provider = row("SELECT id, name, auth_kind, default_model_id FROM providers")
    expect(provider).toMatchObject({ name: "magpie", auth_kind: "none", default_model_id: "group/flash" })
    expect(JSON.parse(row("SELECT value_json FROM kv").value_json)).toMatchObject({
      defaultProviderId: provider.id,
      defaultModelId: "group/flash",
    })

    fs.rmSync(paths.control)
    expect(syncBridge(paths)).toBe("disconnected")
    expect(row("SELECT count(*) n FROM providers").n).toBe(0)
    expect(row("SELECT count(*) n FROM models").n).toBe(0)
    expect(JSON.parse(row("SELECT value_json FROM kv").value_json).defaultProviderId).toBeUndefined()
  })

  test("leaves a selection made in PI-Desktop alone while the control file is unchanged", () => {
    fs.writeFileSync(paths.control, JSON.stringify(CONTROL))
    syncBridge(paths)

    const d = new Database(paths.db)
    d.run("UPDATE kv SET value_json = ?", [JSON.stringify({ defaultProviderId: "p1", defaultModelId: "zhuge/next" })])
    d.close()

    expect(syncBridge(paths)).toBe("connected")
    expect(JSON.parse(row("SELECT value_json FROM kv").value_json).defaultModelId).toBe("zhuge/next")

    fs.rmSync(paths.control)
    syncBridge(paths)
    expect(JSON.parse(row("SELECT value_json FROM kv").value_json).defaultModelId).toBe("zhuge/next")
  })
})
