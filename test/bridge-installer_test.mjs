import assert from "node:assert/strict";
import test from "node:test";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bridgeDataRoot,
  createBridgeInstaller,
  selectBridgeNodeRuntime
} from "../integration/com.ulanzi.codexmicro.ulanziPlugin/plugin/bridge-installer.js";

const pluginRoot = fileURLToPath(new URL(
  "../integration/com.ulanzi.codexmicro.ulanziPlugin/",
  import.meta.url
));

test("bundled installer creates and launches Codex Bridge without a repository path", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-micro-installer-"));
  const systemNode = join(home, "bin", "node");
  await mkdir(join(home, "bin"), { recursive: true });
  await writeFile(systemNode, "#!/bin/sh\n", { mode: 0o755 });
  await chmod(systemNode, 0o755);
  const resolvedSystemNode = await realpath(systemNode);
  const commands = [];
  const health = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true, codexConnected: false }));
  });
  await new Promise(resolve => health.listen(0, "127.0.0.1", resolve));

  const execute = async (command, args) => {
    commands.push([command, args]);
    if (args[0] === "--version") return { stdout: "v22.14.0\n", stderr: "" };
    if (command === "/bin/launchctl" && args[0] === "bootout") {
      throw new Error("not loaded");
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
  await mkdir(bin, { recursive: true });
  await writeFile(systemNode, "fake node");
  const commands = [];
  const children = [];
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
    return { stdout: "", stderr: "" };
  };
  const spawnProcess = (command, args, options) => {
    children.push({ command, args, options });
    return { unref() {} };
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
    fetchImpl: async () => { throw new Error("offline fixture"); }
  });

  try {
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
    assert.match((await installer.authorizationHeaders()).Authorization, /^Bearer /);
    assert.equal(children[0].command, await realpath(systemNode));
    assert.equal(children[0].options.windowsHide, true);
    assert.equal(children[0].options.env.CODEX_BRIDGE_TOKEN, token);

    await installer.launch();
    assert.equal(children[1].command, codexExecutable);
    assert.deepEqual(children[1].args, [
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=9222",
      "--remote-allow-origins=http://127.0.0.1:9222"
    ]);
    assert.equal(children[1].options.windowsHide, false);
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
    const powershellCommands = commands.filter(([command]) => command === "powershell.exe");
    assert.ok(powershellCommands.length >= 4);
    assert.ok(powershellCommands.every(([, , options]) => options?.windowsHide === true));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
