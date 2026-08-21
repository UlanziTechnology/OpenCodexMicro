import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

const nativeRoot = fileURLToPath(new URL(
  "../integration/com.ulanzi.codexmicro.ulanziPlugin/installer/native-runtime/",
  import.meta.url
));

test("the self-contained Windows native focus runtime resolves outside repository dependencies", {
  skip: process.platform !== "win32"
}, async () => {
  process.env.CODEX_BRIDGE_NATIVE_ROOT = nativeRoot;
  try {
    const { initializeWindowsFocusRuntime } = await import("../src/bridge/windows-focus.mjs");
    assert.equal(await initializeWindowsFocusRuntime(), true);
  } finally {
    delete process.env.CODEX_BRIDGE_NATIVE_ROOT;
  }
});
