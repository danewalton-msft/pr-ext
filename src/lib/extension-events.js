export function isServiceWorkerShutdownError(error) {
  return error === "No SW" || error?.message === "No SW";
}

export async function runExtensionEvent(label, task, logger = console) {
  try {
    await task();
  } catch (error) {
    if (isServiceWorkerShutdownError(error)) {
      logger.debug(`${label} stopped because Edge unloaded the service worker.`);
      return;
    }

    logger.error(`${label} failed.`, error);
  }
}
