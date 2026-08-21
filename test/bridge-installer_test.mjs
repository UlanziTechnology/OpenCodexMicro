import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  acquireFilesystemLock,
  bridgeDataRoot,
  createBridgeInstaller,
  selectBridgeNodeRuntime
} from "../integration/com.ulanzi.codexmicro.ulanziPlugin/plugin/bridge-installer.js";

const pluginRoot = fileURLToPath(new URL(
  "../integration/com.ulanzi.codexmicro.ulanziPlugin/",
  import.meta.url
));
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const execFileAsync = promisify(execFile);
const bundledNativeRuntimeHash = JSON.parse(await readFile(
  join(pluginRoot, "installer", "native-runtime", "native-runtime.json"),
  "utf8"
)).runtimeHash;

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

test("filesystem locks stay owned and live owners are not treated as stale", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-micro-lock-owner-"));
  const lockPath = join(root, "lifecycle.lock");
  try {
    const releaseFirst = await acquireFilesystemLock({ lockPath });
    await assert.rejects(
      acquireFilesystemLock({ lockPath, timeoutMs: 20, staleMs: 0, wait: () => Promise.resolve() }),
      /still running/
    );

    await rm(lockPath, { recursive: true, force: true });
    const releaseSecond = await acquireFilesystemLock({ lockPath });
    await releaseFirst();
    await access(lockPath);
    await releaseSecond();
    await assert.rejects(access(lockPath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent plugin installers serialize destination replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-micro-plugin-install-lock-"));
  const appData = join(root, "AppData");
  const localAppData = join(root, "LocalAppData");
  const environment = {
    ...process.env,
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    CODEX_BRIDGE_URL: "http://127.0.0.1:59995"
  };
  try {
    await Promise.all([
      execFileAsync(process.execPath, [join(repositoryRoot, "scripts", "install-plugin.mjs")], {
        cwd: repositoryRoot,
        env: environment
      }),
      execFileAsync(process.execPath, [join(repositoryRoot, "scripts", "install-plugin.mjs")], {
        cwd: repositoryRoot,
        env: environment
      })
    ]);
    const pluginsRoot = join(appData, "Ulanzi", "UlanziDeck", "Plugins");
    const installedManifest = JSON.parse(await readFile(
      join(pluginsRoot, "com.ulanzi.codexmicro.ulanziPlugin", "manifest.json"),
      "utf8"
    ));
    assert.equal(installedManifest.Version, "0.6.1");
    assert.deepEqual(
      (await readdir(pluginsRoot)).filter(name => name.includes("installing-") || name.includes("backup-") || name.endsWith(".install.lock")),
      []
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundled installer creates and launches Codex Bridge without a repository path", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-micro-installer-"));
  const systemNode = join(home, "bin", "node");
  await mkdir(join(home, "bin"), { recursive: true });
  await writeFile(systemNode, "#!/bin/sh\n", { mode: 0o755 });
  await chmod(systemNode, 0o755);
  const resolvedSystemNode = await realpath(systemNode);
  const commands = [];
  const bundledRuntimeHash = await sha256(join(pluginRoot, "installer", "bridge.mjs"));
  let serviceOnline = false;
  let runningVersion = "9.8.7";
  let runningRuntimeHash = bundledRuntimeHash;
  const health = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (!serviceOnline) {
      response.statusCode = 503;
      response.end(JSON.stringify({ ok: false, error: "offline fixture" }));
      return;
    }
    response.end(JSON.stringify({
      ok: true,
      bridgeVersion: runningVersion,
      runtimeHash: runningRuntimeHash,
      codexConnected: false
    }));
  });
  await new Promise(resolve => health.listen(0, "127.0.0.1", resolve));

  const execute = async (command, args) => {
    commands.push([command, args]);
    if (args[0] === "--version") return { stdout: "v22.14.0\n", stderr: "" };
    if (command === "/bin/launchctl" && args[0] === "bootout") {
      serviceOnline = false;
      return { stdout: "", stderr: "" };
    }
    if (command === "/bin/launchctl" && args[0] === "bootstrap") {
      serviceOnline = true;
      runningVersion = "9.8.7";
      runningRuntimeHash = bundledRuntimeHash;
    }
    return { stdout: "", stderr: "" };
  };
  const installer = createBridgeInstaller({
    pluginRoot,
    bridgeUrl: `http://127.0.0.1:${health.address().port}`,
    version: "9.8.7",
    home,
    uid: 501,
    platform: "darwin",
    nodeExecutable: process.execPath,
    environmentPath: join(home, "bin"),
    execute
  });

  try {
    const before = await installer.status();
    assert.equal(before.installed, false);

    const installed = await installer.install();
    assert.equal(installed.installed, true);
    assert.equal(installed.installedVersion, "9.8.7");
    await access(join(home, "Applications", "Codex Bridge.app", "Contents", "MacOS", "Codex Bridge"));
    await access(join(home, "Library", "Application Support", "OpenCodexMicro", "bridge.mjs"));
    const plist = await readFile(
      join(home, "Library", "LaunchAgents", "io.opencodexmicro.bridge.plist"),
      "utf8"
    );
    assert.match(plist, new RegExp(resolvedSystemNode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const metadata = JSON.parse(await readFile(
      join(home, "Library", "Application Support", "OpenCodexMicro", "install.json"),
      "utf8"
    ));
    assert.equal(metadata.nodeExecutable, resolvedSystemNode);
    assert.equal(metadata.nodeVersion, "22.14.0");
    assert.equal(metadata.nodeSource, "system");
    assert.ok(commands.some(([command, args]) => command === "/bin/launchctl" && args[0] === "bootstrap"));

    runningVersion = "1.0.0";
    runningRuntimeHash = "stale-runtime";
    const updated = await installer.ensureCurrent();
    assert.equal(updated.needsUpdate, false);
    assert.ok(commands.filter(([command, args]) => command === "/bin/launchctl" && args[0] === "bootout").length >= 1);
    assert.ok(commands.filter(([command, args]) => command === "/bin/launchctl" && args[0] === "bootstrap").length >= 2);

    await installer.launch();
    assert.ok(commands.some(([command]) => command === "/usr/bin/open"));

    const uninstalled = await installer.uninstall();
    assert.equal(uninstalled.installed, false);
    await assert.rejects(access(join(home, "Applications", "Codex Bridge.app")));
    await assert.rejects(access(join(home, "Library", "Application Support", "OpenCodexMicro")));
    await assert.rejects(access(join(home, "Library", "LaunchAgents", "io.opencodexmicro.bridge.plist")));
    assert.ok(commands.some(([command, args]) => command === "/bin/launchctl" && args[0] === "bootout"));
  } finally {
    health.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("bundled installer falls back when the system Node is older than version 20", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-micro-node-selection-"));
  const fallbackNode = await realpath(process.execPath);
  const oldNode = join(home, "bin", "node");
  await mkdir(join(home, "bin"), { recursive: true });
  await writeFile(oldNode, "#!/bin/sh\n", { mode: 0o755 });
  await chmod(oldNode, 0o755);
  try {
    const runtime = await selectBridgeNodeRuntime({
      home,
      fallbackNodeExecutable: process.execPath,
      environmentPath: join(home, "bin"),
      platform: "linux",
      execute: async command => ({
        stdout: command === fallbackNode ? "v20.18.0\n" : "v18.20.0\n",
        stderr: ""
      })
    });
    assert.equal(runtime.executable, fallbackNode);
    assert.equal(runtime.source, "ulanzi");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Windows installer uses LocalAppData, a capability token, and user-level processes", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-micro-windows-installer-"));
  const localAppData = join(home, "LocalAppData");
  const bin = join(home, "bin");
  const systemNode = join(bin, "node.exe");
  const codexExecutable = join(home, "WindowsApps", "OpenAI.Codex_1.2.3.4_x64", "app", "ChatGPT.exe");
  const bridgeRuntime = join(localAppData, "OpenCodexMicro", "bridge.mjs");
  const bundledRuntimeHash = await sha256(join(pluginRoot, "installer", "bridge.mjs"));
  await mkdir(bin, { recursive: true });
  await writeFile(systemNode, "fake node");
  const commands = [];
  const children = [];
  let serviceOnline = false;
  let runningVersion = "9.8.7";
  let runningRuntimeHash = bundledRuntimeHash;
  let runningNativeRuntimeHash = bundledNativeRuntimeHash;
  const execute = async (command, args, options) => {
    commands.push([command, args, options]);
    if (args[0] === "--version") return { stdout: "v22.14.0\n", stderr: "" };
    if (command === "powershell.exe" && args.join(" ").includes("Get-AppxPackage")) {
      return {
        stdout: JSON.stringify({
          channel: "stable",
          packageName: "OpenAI.Codex",
          packageFullName: "OpenAI.Codex_1.2.3.4_x64__test",
          executable: codexExecutable
        }),
        stderr: ""
      };
    }
    if (command === "powershell.exe" && args.join(" ").includes("CODEX_BRIDGE_TARGET_RUNTIME")) {
      serviceOnline = false;
    }
    return { stdout: "", stderr: "" };
  };
  const spawnProcess = (command, args, options) => {
    children.push({ command, args, options });
    if (args[0] === bridgeRuntime) {
      serviceOnline = true;
      runningVersion = "9.8.7";
      runningRuntimeHash = bundledRuntimeHash;
      runningNativeRuntimeHash = bundledNativeRuntimeHash;
    }
    return { pid: 1000 + children.length, unref() {} };
  };
  const installer = createBridgeInstaller({
    pluginRoot,
    bridgeUrl: "http://127.0.0.1:59999",
    version: "9.8.7",
    home,
    localAppData,
    platform: "win32",
    nodeExecutable: process.execPath,
    environmentPath: bin,
    execute,
    spawnProcess,
    fetchImpl: async url => {
      if (String(url).endsWith("/health") && serviceOnline) {
        return {
          ok: true,
          async json() {
            return {
              ok: true,
              bridgeVersion: runningVersion,
              runtimeHash: runningRuntimeHash,
              nativeRuntimeHash: runningNativeRuntimeHash,
              codexConnected: false
            };
          }
        };
      }
      throw new Error("offline fixture");
    },
    serviceStartTimeoutMs: 500
  });

  try {
    assert.deepEqual(await installer.authorizationHeaders(), {});
    assert.equal(
      bridgeDataRoot({ platform: "win32", home, localAppData }),
      join(localAppData, "OpenCodexMicro")
    );
    const installed = await installer.install();
    assert.equal(installed.supported, true);
    assert.equal(installed.installed, true);
    const dataRoot = join(localAppData, "OpenCodexMicro");
    await access(join(dataRoot, "bridge.mjs"));
    const token = (await readFile(join(dataRoot, "bridge-token"), "utf8")).trim();
    assert.match(token, /^[A-Za-z0-9_-]{40,}$/);
    assert.deepEqual(await installer.authorizationHeaders(), { Authorization: `Bearer ${token}` });
    assert.equal(children[0].command, await realpath(systemNode));
    assert.equal(children[0].options.windowsHide, true);
    assert.equal(children[0].options.env.CODEX_BRIDGE_TOKEN, token);
    assert.equal(await readFile(join(dataRoot, "bridge.pid"), "utf8"), "1001\n");
    const metadata = JSON.parse(await readFile(join(dataRoot, "install.json"), "utf8"));
    assert.equal(metadata.runtimeHash, bundledRuntimeHash);
    assert.equal(metadata.nativeRuntimeHash, bundledNativeRuntimeHash);

    runningVersion = "0.5.0";
    runningRuntimeHash = "stale-runtime";
    const reconciled = await installer.ensureCurrent();
    assert.equal(reconciled.needsUpdate, false);
    assert.equal(children[1].command, await realpath(systemNode));
    assert.equal(await readFile(join(dataRoot, "bridge.pid"), "utf8"), "1002\n");
    assert.ok(commands.some(([command, args]) =>
      command === "powershell.exe" && args.join(" ").includes("CODEX_BRIDGE_TARGET_RUNTIME")
    ));

    await installer.launch();
    assert.equal(children[2].command, codexExecutable);
    assert.deepEqual(children[2].args, [
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=9222",
      "--remote-allow-origins=http://127.0.0.1:9222"
    ]);
    assert.equal(children[2].options.windowsHide, false);
    assert.ok(commands.some(([command, args]) =>
      command === "powershell.exe" && args.join(" ").includes("Stop-Process")
    ));
    assert.ok(commands.some(([command, args, options]) =>
      command === "powershell.exe" &&
      args.join(" ").includes("Wait-Process") &&
      options?.env?.CODEX_BRIDGE_TARGET_EXECUTABLE === codexExecutable
    ));

    const uninstalled = await installer.uninstall();
    assert.equal(uninstalled.installed, false);
    await assert.rejects(access(dataRoot));
    assert.deepEqual(await installer.authorizationHeaders(), {});
    const powershellCommands = commands.filter(([command]) => command === "powershell.exe");
    assert.ok(powershellCommands.length >= 4);
    assert.ok(powershellCommands.every(([, , options]) => options?.windowsHide === true));

    await installer.install();
    const replacementToken = (await readFile(join(dataRoot, "bridge-token"), "utf8")).trim();
    assert.notEqual(replacementToken, token);
    assert.deepEqual(await installer.authorizationHeaders(), {
      Authorization: `Bearer ${replacementToken}`
    });
    await installer.uninstall();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a failed Windows Bridge restart restores the previous runtime and metadata", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-micro-windows-rollback-"));
  const localAppData = join(home, "LocalAppData");
  const dataRoot = join(localAppData, "OpenCodexMicro");
  const bridgeRuntime = join(dataRoot, "bridge.mjs");
  const systemNode = join(home, "bin", "node.exe");
  const oldRuntime = Buffer.from("previous bridge runtime");
  const oldRuntimeHash = createHash("sha256").update(oldRuntime).digest("hex");
  let serviceOnline = true;
  let runningVersion = "1.0.0";
  let runningRuntimeHash = oldRuntimeHash;
  let runningNativeRuntimeHash = null;
  let bridgeStarts = 0;

  await mkdir(join(home, "bin"), { recursive: true });
  await mkdir(dataRoot, { recursive: true });
  await writeFile(systemNode, "fake node");
  const resolvedNode = await realpath(systemNode);
  await writeFile(bridgeRuntime, oldRuntime);
  await writeFile(join(dataRoot, "bridge-token"), "synthetic-test-token\n");
  const previousMetadata = {
    version: "1.0.0",
    runtimeHash: oldRuntimeHash,
    platform: "win32",
    codexChannel: "stable",
    nodeExecutable: resolvedNode,
    nodeVersion: "22.14.0",
    nodeSource: "system",
    installedAt: "2026-01-01T00:00:00.000Z"
  };
  await writeFile(join(dataRoot, "install.json"), "malformed previous metadata\n");

  const installer = createBridgeInstaller({
    pluginRoot,
    bridgeUrl: "http://127.0.0.1:59998",
    version: "9.8.7",
    home,
    localAppData,
    platform: "win32",
    nodeExecutable: process.execPath,
    environmentPath: join(home, "bin"),
    execute: async (command, args) => {
      if (args[0] === "--version") return { stdout: "v22.14.0\n", stderr: "" };
      if (command === "powershell.exe" && args.join(" ").includes("CODEX_BRIDGE_TARGET_RUNTIME")) {
        serviceOnline = false;
      }
      return { stdout: "", stderr: "" };
    },
    spawnProcess: (_command, args) => {
      if (args[0] === bridgeRuntime) {
        bridgeStarts += 1;
        serviceOnline = true;
        if (bridgeStarts === 1) {
          runningVersion = "9.8.7";
          runningRuntimeHash = "unexpected-runtime";
          runningNativeRuntimeHash = bundledNativeRuntimeHash;
        } else {
          runningVersion = "1.0.0";
          runningRuntimeHash = oldRuntimeHash;
          runningNativeRuntimeHash = null;
        }
      }
      return { pid: 2000 + bridgeStarts, unref() {} };
    },
    fetchImpl: async url => {
      if (String(url).endsWith("/health") && serviceOnline) {
        return {
          ok: true,
          async json() {
            return {
              ok: true,
              bridgeVersion: runningVersion,
              runtimeHash: runningRuntimeHash,
              nativeRuntimeHash: runningNativeRuntimeHash,
              codexConnected: false
            };
          }
        };
      }
      throw new Error("offline fixture");
    },
    serviceStartTimeoutMs: 20,
    wait: () => new Promise(resolve => setTimeout(resolve, 1))
  });

  try {
    await assert.rejects(installer.install(), /Previous runtime restored/);
    assert.deepEqual(await readFile(bridgeRuntime), oldRuntime);
    const recoveredMetadata = JSON.parse(await readFile(join(dataRoot, "install.json"), "utf8"));
    assert.equal(recoveredMetadata.version, previousMetadata.version);
    assert.equal(recoveredMetadata.runtimeHash, previousMetadata.runtimeHash);
    assert.equal(recoveredMetadata.nodeExecutable, previousMetadata.nodeExecutable);
    assert.equal(recoveredMetadata.recovered, true);
    assert.equal(bridgeStarts, 2);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("separate installer instances serialize the same Windows Bridge update", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-micro-windows-lock-"));
  const localAppData = join(home, "LocalAppData");
  const dataRoot = join(localAppData, "OpenCodexMicro");
  const bridgeRuntime = join(dataRoot, "bridge.mjs");
  const systemNode = join(home, "bin", "node.exe");
  const oldRuntime = Buffer.from("stale bridge runtime");
  const oldRuntimeHash = createHash("sha256").update(oldRuntime).digest("hex");
  const bundledRuntimeHash = await sha256(join(pluginRoot, "installer", "bridge.mjs"));
  let serviceOnline = true;
  let runningVersion = "1.0.0";
  let runningRuntimeHash = oldRuntimeHash;
  let runningNativeRuntimeHash = null;
  let bridgeStarts = 0;

  await mkdir(join(home, "bin"), { recursive: true });
  await mkdir(dataRoot, { recursive: true });
  await writeFile(systemNode, "fake node");
  const resolvedNode = await realpath(systemNode);
  await writeFile(bridgeRuntime, oldRuntime);
  await writeFile(join(dataRoot, "bridge-token"), "synthetic-test-token\n");
  await writeFile(join(dataRoot, "install.json"), `${JSON.stringify({
    version: "1.0.0",
    runtimeHash: oldRuntimeHash,
    platform: "win32",
    codexChannel: "stable",
    nodeExecutable: resolvedNode,
    nodeVersion: "22.14.0",
    nodeSource: "system",
    installedAt: "2026-01-01T00:00:00.000Z"
  }, null, 2)}\n`);

  const dependencies = {
    pluginRoot,
    bridgeUrl: "http://127.0.0.1:59997",
    version: "9.8.7",
    home,
    localAppData,
    platform: "win32",
    nodeExecutable: process.execPath,
    environmentPath: join(home, "bin"),
    execute: async (command, args) => {
      if (args[0] === "--version") return { stdout: "v22.14.0\n", stderr: "" };
      if (command === "powershell.exe" && args.join(" ").includes("CODEX_BRIDGE_TARGET_RUNTIME")) {
        serviceOnline = false;
      }
      return { stdout: "", stderr: "" };
    },
    spawnProcess: () => {
      bridgeStarts += 1;
      serviceOnline = true;
      runningVersion = "9.8.7";
      runningRuntimeHash = bundledRuntimeHash;
      runningNativeRuntimeHash = bundledNativeRuntimeHash;
      return { pid: 3000 + bridgeStarts, unref() {} };
    },
    fetchImpl: async url => {
      if (String(url).endsWith("/health") && serviceOnline) {
        return {
          ok: true,
          async json() {
            return {
              ok: true,
              bridgeVersion: runningVersion,
              runtimeHash: runningRuntimeHash,
              nativeRuntimeHash: runningNativeRuntimeHash,
              codexConnected: false
            };
          }
        };
      }
      throw new Error("offline fixture");
    },
    serviceStartTimeoutMs: 500
  };

  try {
    const first = createBridgeInstaller(dependencies);
    const second = createBridgeInstaller(dependencies);
    const results = await Promise.all([first.ensureCurrent(), second.ensureCurrent()]);
    assert.ok(results.every(result => result.needsUpdate === false));
    assert.equal(bridgeStarts, 1);
    assert.equal(await readFile(join(dataRoot, "bridge.pid"), "utf8"), "3001\n");

    await rm(join(dataRoot, "bridge-token"), { force: true });
    const repaired = await first.ensureCurrent();
    assert.equal(repaired.needsUpdate, false);
    assert.equal(bridgeStarts, 2);
    assert.match((await readFile(join(dataRoot, "bridge-token"), "utf8")).trim(), /^[A-Za-z0-9_-]{40,}$/);
    await assert.rejects(access(join(localAppData, ".OpenCodexMicro.lifecycle.lock")));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("an interrupted Windows update restores both backups when the new runtime cannot restart", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-micro-windows-interrupted-"));
  const localAppData = join(home, "LocalAppData");
  const dataRoot = join(localAppData, "OpenCodexMicro");
  const bridgeRuntime = join(dataRoot, "bridge.mjs");
  const installMetadata = join(dataRoot, "install.json");
  const systemNode = join(home, "bin", "node.exe");
  const bundledRuntime = await readFile(join(pluginRoot, "installer", "bridge.mjs"));
  const bundledRuntimeHash = createHash("sha256").update(bundledRuntime).digest("hex");
  const oldRuntime = Buffer.from("runtime before interrupted update");
  const oldRuntimeHash = createHash("sha256").update(oldRuntime).digest("hex");
  let serviceOnline = false;
  let runningVersion = null;
  let runningRuntimeHash = null;
  let runningNativeRuntimeHash = null;
  let bridgeStarts = 0;

  await mkdir(join(home, "bin"), { recursive: true });
  await mkdir(dataRoot, { recursive: true });
  await writeFile(systemNode, "fake node");
  const resolvedNode = await realpath(systemNode);
  const metadata = (version, runtimeHash, nativeRuntimeHash = null) => ({
    version,
    runtimeHash,
    nativeRuntimeHash,
    platform: "win32",
    codexChannel: "stable",
    nodeExecutable: resolvedNode,
    nodeVersion: "22.14.0",
    nodeSource: "system",
    installedAt: "2026-01-01T00:00:00.000Z"
  });
  const oldMetadata = metadata("1.0.0", oldRuntimeHash);
  await cp(
    join(pluginRoot, "installer", "native-runtime"),
    join(dataRoot, "native-runtimes", bundledNativeRuntimeHash),
    { recursive: true }
  );
  await writeFile(bridgeRuntime, bundledRuntime);
  await writeFile(
    installMetadata,
    `${JSON.stringify(metadata("9.8.7", bundledRuntimeHash, bundledNativeRuntimeHash), null, 2)}\n`
  );
  await writeFile(join(dataRoot, ".bridge.mjs.previous"), oldRuntime);
  await writeFile(join(dataRoot, ".install.json.previous"), `${JSON.stringify(oldMetadata, null, 2)}\n`);
  await writeFile(join(dataRoot, "bridge-token"), "synthetic-test-token\n");

  const installer = createBridgeInstaller({
    pluginRoot,
    bridgeUrl: "http://127.0.0.1:59996",
    version: "9.8.7",
    home,
    localAppData,
    platform: "win32",
    nodeExecutable: process.execPath,
    environmentPath: join(home, "bin"),
    execute: async (command, args) => {
      if (args[0] === "--version") return { stdout: "v22.14.0\n", stderr: "" };
      if (command === "powershell.exe" && args.join(" ").includes("CODEX_BRIDGE_TARGET_RUNTIME")) {
        serviceOnline = false;
      }
      return { stdout: "", stderr: "" };
    },
    spawnProcess: () => {
      bridgeStarts += 1;
      serviceOnline = true;
      if (bridgeStarts === 1) {
        runningVersion = "9.8.7";
        runningRuntimeHash = "failed-new-runtime";
        runningNativeRuntimeHash = bundledNativeRuntimeHash;
      } else if (bridgeStarts === 2) {
        runningVersion = "1.0.0";
        runningRuntimeHash = oldRuntimeHash;
        runningNativeRuntimeHash = null;
      } else {
        runningVersion = "9.8.7";
        runningRuntimeHash = bundledRuntimeHash;
        runningNativeRuntimeHash = bundledNativeRuntimeHash;
      }
      return { pid: 4000 + bridgeStarts, unref() {} };
    },
    fetchImpl: async url => {
      if (String(url).endsWith("/health") && serviceOnline) {
        return {
          ok: true,
          async json() {
            return {
              ok: true,
              bridgeVersion: runningVersion,
              runtimeHash: runningRuntimeHash,
              nativeRuntimeHash: runningNativeRuntimeHash,
              codexConnected: false
            };
          }
        };
      }
      throw new Error("offline fixture");
    },
    serviceStartTimeoutMs: 20,
    wait: () => new Promise(resolve => setTimeout(resolve, 1))
  });

  try {
    const reconciled = await installer.ensureCurrent();
    assert.equal(reconciled.needsUpdate, false);
    assert.deepEqual(await readFile(bridgeRuntime), bundledRuntime);
    assert.equal(JSON.parse(await readFile(installMetadata, "utf8")).version, "9.8.7");
    assert.equal(bridgeStarts, 3);
    await assert.rejects(access(join(dataRoot, ".bridge.mjs.previous")));
    await assert.rejects(access(join(dataRoot, ".install.json.previous")));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
