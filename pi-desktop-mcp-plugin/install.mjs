#!/usr/bin/env node
// Install this folder as a PI-Desktop plugin. PI-Desktop must be quit: it
// keeps the plugin registry in memory and would write its copy back over ours.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const dataDir = process.env.PI_DESKTOP_DATA_DIR || join(homedir(), ".pi-desktop");
const installed = join(dataDir, "plugins", "installed", manifest.id);
const registryPath = join(dataDir, "plugins", "registry.json");

const running = spawnSync("pgrep", ["-f", "/Applications/PI-Desktop.app/Contents/MacOS/PI-Desktop"], { encoding: "utf8" });
if (running.status === 0) {
  console.error("PI-Desktop is running. Quit it, run this again, then start it.");
  process.exit(1);
}

mkdirSync(join(dataDir, "plugins", "installed"), { recursive: true });
mkdirSync(join(dataDir, "plugins", "data", manifest.id), { recursive: true });

if (existsSync(registryPath)) {
  writeFileSync(`${registryPath}.bak`, readFileSync(registryPath));
  console.log(`backed up ${registryPath}.bak`);
}

if (resolve(here) !== resolve(installed)) {
  rmSync(installed, { recursive: true, force: true });
  cpSync(here, installed, { recursive: true });
}

const rows = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : [];
const now = new Date().toISOString();
const row = {
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  enabled: true,
  scope: { mode: "global", projects: [] },
  source: "installed",
  bundled: false,
  status: "ready",
  permissions: manifest.permissions ?? [],
  path: installed,
  capabilities: ["mcp"],
  description: manifest.description,
  author: manifest.author,
  installedAt: rows.find((r) => r.id === manifest.id)?.installedAt ?? now,
  updatedAt: now,
};
const next = [...rows.filter((r) => r.id !== manifest.id), row];
writeFileSync(`${registryPath}.tmp`, JSON.stringify(next, null, 2));
renameSync(`${registryPath}.tmp`, registryPath);

console.log(`installed ${manifest.id} ${manifest.version} -> ${installed}`);
console.log("start PI-Desktop; the Magpie Library MCP server joins the agent's tools.");
