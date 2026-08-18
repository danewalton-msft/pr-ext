import assert from "node:assert/strict";
import test from "node:test";

import {
  isServiceWorkerShutdownError,
  runExtensionEvent
} from "../src/lib/extension-events.js";

test("isServiceWorkerShutdownError recognizes Edge's transient error", () => {
  assert.equal(isServiceWorkerShutdownError(new Error("No SW")), true);
  assert.equal(isServiceWorkerShutdownError("No SW"), true);
  assert.equal(isServiceWorkerShutdownError(new Error("Denied")), false);
});

test("runExtensionEvent handles worker shutdown without an unhandled rejection", async () => {
  const messages = [];
  const logger = {
    debug(message) {
      messages.push(message);
    },
    error() {
      assert.fail("The transient shutdown error should not be logged as a failure.");
    }
  };

  await runExtensionEvent(
    "Extension setup",
    async () => {
      throw new Error("No SW");
    },
    logger
  );

  assert.deepEqual(messages, [
    "Extension setup stopped because Edge unloaded the service worker."
  ]);
});

test("runExtensionEvent logs unexpected event failures", async () => {
  const failure = new Error("Denied");
  const calls = [];
  const logger = {
    debug() {
      assert.fail("Unexpected failures should not be logged as shutdowns.");
    },
    error(...args) {
      calls.push(args);
    }
  };

  await runExtensionEvent(
    "Alarm sync",
    async () => {
      throw failure;
    },
    logger
  );

  assert.deepEqual(calls, [["Alarm sync failed.", failure]]);
});
