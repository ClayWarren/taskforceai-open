const STARTUP_TIMEOUT_MS = 30000;
describe('Startup performance', () => {
  it('shows the chat input within the startup budget', async () => {
    const startedAt = Date.now();

    await device.launchApp({
      newInstance: true,
      delete: true,
      ...(process.env.EXPO_DETOX_URL ? { url: process.env.EXPO_DETOX_URL } : {}),
    });
    await waitFor(element(by.id('message-input')))
      .toBeVisible()
      .withTimeout(STARTUP_TIMEOUT_MS);

    const durationMs = Date.now() - startedAt;
    console.log(`[startup] launch_to_message_input_ms=${durationMs}`);
    if (durationMs > STARTUP_TIMEOUT_MS) {
      throw new Error(`Expected startup within ${STARTUP_TIMEOUT_MS}ms, got ${durationMs}ms`);
    }
  });
});
