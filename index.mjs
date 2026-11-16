// magpie treats every exported function of a package's main module as a
// plugin entry, so the bridge lives in bridge.mjs and only this default is
// exported here.
import { pathsFor, startBridge } from "./bridge.mjs"

export default async function PiDesktopBridge() {
  startBridge(pathsFor(), {
    onError: (message) => console.error(`pi-desktop bridge paused: ${message}`),
  })
  return {}
}
