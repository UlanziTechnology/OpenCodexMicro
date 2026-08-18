import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();
const uid = process.getuid();
const appRoot = join(home, "Library", "Application Support", "openCodexMicro");
const bridgeApp = join(home, "Applications", "Codex Bridge.app");
const agentsRoot = join(home, "Library", "LaunchAgents");
const plugin = join(
  home,
  "Library",
  "Application Support",
  "Ulanzi",
  "UlanziDeck",
  "Plugins",
  "com.ulanzi.codexmicro.ulanziPlugin"
);
await mkdir(agentsRoot, { recursive: true });
const agents = [
  join(agentsRoot, "io.opencodexmicro.bridge.plist")
];

for (const agent of agents) {
  try {
    execFileSync("/bin/launchctl", ["bootout", `gui/${uid}`, agent], {
      stdio: "ignore"
    });
  } catch {
    // Already stopped or never installed.
  }
  await rm(agent, { force: true });
}
await rm(appRoot, { recursive: true, force: true });
await rm(bridgeApp, { recursive: true, force: true });
await rm(plugin, { recursive: true, force: true });
console.log("openCodexMicro removed.");
