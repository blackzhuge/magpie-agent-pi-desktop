// Runs in magpie's Bun plugin host. The agent module writes the choice to
// ~/.pi-desktop/magpie-agent.json; PI-Desktop keeps providers and the model a
// new conversation starts on in pi.sqlite, so this module mirrors the control
// file into the database and puts the previous rows back when magpie steps out.
import fs from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { homedir } from "node:os"
import { dirname, join, normalize as normalizePath } from "node:path"
import { Database } from "bun:sqlite"
import { agent } from "./pi-desktop.agent.js"

const instance = Symbol.for("magpie.pi-desktop.bridge.v1")
const PROVIDER_NAME = "magpie"
const STATE_VERSION = 1

function expand(p, home = homedir(), env = process.env) {
  const expanded = p.replace(/\$(\w+)|\$\{(\w+)\}/g, (_, a, b) => {
    const name = a || b
    return name === "HOME" ? home : env[name] ?? ""
  })
  return normalizePath(expanded.startsWith("~/") ? join(home, expanded.slice(2)) : expanded)
}

export function pathsFor(env = process.env) {
  const data = env.PI_DESKTOP_DATA_DIR?.trim() || expand("~/.pi-desktop", homedir(), env)
  return {
    control: expand(agent.config, homedir(), env),
    data,
    db: join(data, "pi.sqlite"),
    state: join(data, ".magpie-agent", "state.json"),
    lock: join(data, ".magpie-agent", "lock"),
  }
}

function readText(file) {
  try {
    const st = fs.lstatSync(file)
    if (!st.isFile() || st.isSymbolicLink()) throw new Error(`refuses non-regular file ${file}`)
    return fs.readFileSync(file, "utf8")
  } catch (e) {
    if (e.code === "ENOENT") return null
    throw e
  }
}

function readJson(file) {
  const raw = readText(file)
  if (raw === null || raw.trim() === "") return null
  return JSON.parse(raw)
}

function writeJson(file, value) {
  fs.mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" })
    fs.renameSync(temp, file)
  } finally {
    fs.rmSync(temp, { force: true })
  }
}

function lock(file) {
  fs.mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  try {
    fs.writeFileSync(file, String(process.pid), { mode: 0o600, flag: "wx" })
    return () => fs.rmSync(file, { force: true })
  } catch (e) {
    if (e.code !== "EEXIST") throw e
    const pid = Number(readText(file))
    if (Number.isSafeInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0)
        return null
      } catch (err) {
        if (err.code === "EPERM") return null
      }
    }
    fs.rmSync(file, { force: true })
    return lock(file)
  }
}

function httpUrl(value) {
  if (typeof value !== "string" || value === "") throw new Error("baseURL is missing")
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("baseURL is not a plain http(s) gateway address")
  }
  return url
}

function levels(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((v) => typeof v === "string" && v !== ""))]
}

function oneModel(value) {
  if (!value || typeof value.id !== "string" || value.id === "") return null
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name !== "" ? value.name : value.id,
    context: Number.isSafeInteger(value.context) && value.context > 0 ? value.context : 0,
    output: Number.isSafeInteger(value.output) && value.output > 0 ? value.output : 0,
    images: value.images === true,
    efforts: levels(value.efforts),
  }
}

function desired(control) {
  if (!control || typeof control !== "object") return null
  const url = httpUrl(control.baseURL)
  if (typeof control.model !== "string" || control.model.trim() === "") {
    throw new Error("model is missing; pick one of magpie's models again")
  }
  const model = control.model.trim()
  const catalog = Array.isArray(control.catalog) ? control.catalog.map(oneModel).filter(Boolean) : []
  const picked = oneModel(control.modelInfo) ?? { id: model, name: model, context: 0, output: 0, images: false, efforts: [] }
  if (!catalog.some((m) => m.id === model)) catalog.push(picked)
  return { baseURL: url.toString().replace(/\/$/, ""), model, catalog, picked }
}

function sameGateway(a, b) {
  if (!a || !b) return false
  if (a.replace(/\/+$/, "") === b.replace(/\/+$/, "")) return true
  try {
    const x = new URL(a)
    const y = new URL(b)
    return x.protocol === y.protocol && x.host === y.host
  } catch {
    return false
  }
}

function columns(db, table) {
  return new Set(db.query(`PRAGMA table_info(${table})`).all().map((r) => r.name))
}

function insertRow(db, table, values) {
  const have = columns(db, table)
  const keys = Object.keys(values).filter((k) => have.has(k))
  const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`
  db.run(sql, keys.map((k) => values[k]))
}

function findProvider(db, baseURL) {
  const named = db
    .query(
      "SELECT id, name, base_url, default_model_id, config_json, enabled FROM providers WHERE lower(name) = lower(?) ORDER BY enabled DESC, updated_at DESC LIMIT 1",
    )
    .get(PROVIDER_NAME)
  if (named) return named
  const rows = db.query("SELECT id, name, base_url, default_model_id, config_json, enabled FROM providers").all()
  return rows.find((r) => sameGateway(r.base_url, baseURL)) ?? null
}

function providerById(db, id) {
  return db
    .query("SELECT id, name, base_url, default_model_id, config_json, enabled FROM providers WHERE id = ? LIMIT 1")
    .get(id)
}

function providerModel(existing, model) {
  const prev = existing && typeof existing === "object" ? existing : {}
  const entry = { ...prev, id: model.id }
  if (model.context > 0) {
    entry.contextWindow = model.context
    entry.contextWindowSource = typeof prev.contextWindowSource === "string" ? prev.contextWindowSource : "user"
  }
  if (model.output > 0) {
    entry.maxTokens = model.output
    entry.maxTokensSource = typeof prev.maxTokensSource === "string" ? prev.maxTokensSource : "user"
  }
  entry.supportsImages = model.images
  if (model.efforts.length > 0) {
    entry.thinkingLevels = model.efforts
    entry.defaultThinkingLevel = model.efforts.includes(prev.defaultThinkingLevel)
      ? prev.defaultThinkingLevel
      : model.efforts.includes("medium")
        ? "medium"
        : model.efforts[0]
  }
  return entry
}

function configJson(existing, want) {
  let cfg = {}
  try {
    const parsed = typeof existing === "string" ? JSON.parse(existing) : existing
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) cfg = parsed
  } catch {
    // a provider left with invalid JSON is replaced, as magpie does with a config it cannot parse
  }
  const byId = new Map((Array.isArray(cfg.models) ? cfg.models : []).filter((m) => m && typeof m.id === "string").map((m) => [m.id, m]))
  const models = want.catalog.map((m) => providerModel(byId.get(m.id), m))
  if (!models.some((m) => m.id === want.model)) models.push(providerModel(byId.get(want.model), want.picked))
  cfg.models = models
  cfg.compatibility = {
    ...(cfg.compatibility && typeof cfg.compatibility === "object" ? cfg.compatibility : {}),
    supportsReasoning: models.some((m) => Array.isArray(m.thinkingLevels) && m.thinkingLevels.length > 0),
  }
  return JSON.stringify(cfg)
}

function capabilities(model) {
  const caps = ["text", "attachments", "temperature", "tools", "json"]
  if (model.efforts.length > 0) caps.push("reasoning")
  if (model.images) caps.push("vision")
  return JSON.stringify(caps)
}

function upsertModels(db, providerId, want, now) {
  const have = columns(db, "models")
  for (const m of want.catalog) {
    const values = {
      provider_id: providerId,
      model_id: m.id,
      display_name: m.name,
      source: "user",
      capabilities_json: capabilities(m),
      context_window: m.context > 0 ? m.context : null,
      max_output_tokens: m.output > 0 ? m.output : null,
      deprecated: 0,
      discovery_state: "published",
      updated_at: now,
    }
    const keys = Object.keys(values).filter((k) => have.has(k))
    const updates = keys.filter((k) => !["provider_id", "model_id"].includes(k))
    db.run(
      `INSERT INTO models (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})
       ON CONFLICT(provider_id, model_id) DO UPDATE SET ${updates.map((k) => `${k} = excluded.${k}`).join(", ")}`,
      keys.map((k) => values[k]),
    )
  }
}

function readKv(db) {
  const row = db.query("SELECT value_json FROM kv WHERE ns = 'app' AND key = 'app'").get()
  if (!row) return {}
  try {
    const value = JSON.parse(row.value_json)
    return value && typeof value === "object" && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

function writeKv(db, value, now) {
  db.run(
    "INSERT INTO kv (ns, key, value_json, updated_at) VALUES ('app', 'app', ?, ?)\n     ON CONFLICT(ns, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
    [JSON.stringify(value), now],
  )
}

function connectProvider(db, paths, want, state) {
  let provider = findProvider(db, want.baseURL)
  let created = false
  if (!provider) {
    const id = randomUUID()
    const config = configJson("", want)
    insertRow(db, "providers", {
      id,
      name: PROVIDER_NAME,
      vendor_key: "custom",
      type: "openai_compatible",
      protocol: "openai_compatible",
      api_style: null,
      auth_kind: "none",
      base_url: want.baseURL,
      enabled: 1,
      secret_ref: null,
      default_model_id: want.model,
      config_json: config,
      created_at: Date.now(),
      updated_at: Date.now(),
      owner_plugin_id: null,
    })
    provider = { id, name: PROVIDER_NAME, base_url: want.baseURL, default_model_id: want.model, config_json: config }
    created = true
  }
  const next = state ?? {
    version: STATE_VERSION,
    providerId: provider.id,
    createdProvider: created,
    original: {
      provider: created
        ? null
        : {
            default_model_id: provider.default_model_id ?? null,
            config_json: provider.config_json ?? null,
            base_url: provider.base_url ?? null,
            enabled: provider.enabled ?? null,
          },
      kv: (() => {
        const kv = readKv(db)
        return {
          defaultProviderId: kv.defaultProviderId ?? null,
          defaultModelId: kv.defaultModelId ?? null,
        }
      })(),
    },
    applied: {},
  }
  const config = configJson(provider.config_json, want)
  const now = Date.now()
  const updates = { default_model_id: want.model, config_json: config, base_url: want.baseURL, enabled: 1, updated_at: now }
  const have = columns(db, "providers")
  const keys = Object.keys(updates).filter((k) => have.has(k))
  db.run(`UPDATE providers SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => updates[k]), provider.id])
  upsertModels(db, provider.id, want, now)

  const kv = readKv(db)
  const appliedKv = next.applied?.kv
  const magpieMoved = !appliedKv || appliedKv.defaultProviderId !== provider.id || appliedKv.defaultModelId !== want.model
  let wroteKv = appliedKv ?? null
  if (magpieMoved) {
    kv.defaultProviderId = provider.id
    kv.defaultModelId = want.model
    writeKv(db, kv, now)
    wroteKv = { defaultProviderId: provider.id, defaultModelId: want.model }
  }
  if (created) next.createdProvider = true
  next.providerId = provider.id
  next.applied = {
    control: hashControl(want),
    model: want.model,
    provider: { default_model_id: want.model, config_json: config },
    kv: wroteKv,
    at: now,
  }
  writeJson(paths.state, next)
  return created ? "connected (provider added)" : "connected"
}

function hashControl(want) {
  return createHash("sha256").update(JSON.stringify(want)).digest("hex")
}

function restore(db, state) {
  const applied = state.applied ?? {}
  const provider = state.providerId ? providerById(db, state.providerId) : null
  const kvNow = readKv(db)
  if (provider && state.createdProvider) {
    const pickedInApp = kvNow.defaultProviderId === provider.id && kvNow.defaultModelId !== applied.model
    if (!pickedInApp && String(provider.name).toLowerCase() === PROVIDER_NAME) {
      db.run("DELETE FROM models WHERE provider_id = ?", [provider.id])
      db.run("DELETE FROM providers WHERE id = ?", [provider.id])
    }
  } else if (provider && state.original?.provider) {
    const untouched =
      provider.default_model_id === applied.provider?.default_model_id &&
      provider.config_json === applied.provider?.config_json
    if (untouched) {
      const original = state.original.provider
      const updates = {
        default_model_id: original.default_model_id,
        config_json: original.config_json,
        base_url: original.base_url,
        enabled: original.enabled ?? 1,
        updated_at: Date.now(),
      }
      const have = columns(db, "providers")
      const keys = Object.keys(updates).filter((k) => have.has(k))
      db.run(`UPDATE providers SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => updates[k]), provider.id])
    }
  }
  const kv = readKv(db)
  if (applied.kv && kv.defaultProviderId === applied.kv.defaultProviderId && kv.defaultModelId === applied.kv.defaultModelId) {
    const original = state.original?.kv ?? {}
    if (original.defaultProviderId == null) delete kv.defaultProviderId
    else kv.defaultProviderId = original.defaultProviderId
    if (original.defaultModelId == null) delete kv.defaultModelId
    else kv.defaultModelId = original.defaultModelId
    writeKv(db, kv, Date.now())
  }
}

export function syncBridge(paths = pathsFor()) {
  const control = readJson(paths.control)
  const state = readJson(paths.state)
  if (!control && !state) return "idle"
  if (!fs.existsSync(paths.db)) return "waiting for pi.sqlite"
  const unlock = lock(paths.lock)
  if (!unlock) return "busy"
  try {
    const db = new Database(paths.db)
    try {
      db.run("PRAGMA busy_timeout = 4000")
      const want = desired(control)
      if (!want) {
        if (!state) return "idle"
        const run = db.transaction(() => restore(db, state))
        run()
        fs.rmSync(paths.state, { force: true })
        return "disconnected"
      }
      if (state?.applied?.control === hashControl(want)) return "connected"
      const run = db.transaction(() => connectProvider(db, paths, want, state))
      return run()
    } finally {
      db.close()
    }
  } finally {
    unlock()
  }
}

export function startBridge(paths = pathsFor(), { interval = 1000, onError = () => {} } = {}) {
  const key = paths.state
  if (globalThis[instance]?.has(key)) return globalThis[instance].get(key)
  const active = globalThis[instance] ?? new Map()
  globalThis[instance] = active
  let previous = ""
  const tick = () => {
    try {
      syncBridge(paths)
      previous = ""
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message !== previous) onError(message)
      previous = message
    }
  }
  tick()
  const timer = setInterval(tick, interval)
  timer.unref?.()
  const stop = () => {
    clearInterval(timer)
    active.delete(key)
  }
  active.set(key, stop)
  return stop
}
