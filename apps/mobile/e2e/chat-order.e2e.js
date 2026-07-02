const { expect: jestExpect } = require('@jest/globals');

const describeIfFixture =
  process.env.EXPO_PUBLIC_E2E_CHAT_ORDER_FIXTURE === 'true' ? describe : describe.skip;

const yPosition = (attributes) => {
  const frame = Array.isArray(attributes) ? attributes[0]?.frame : attributes.frame;
  if (!frame || typeof frame.y !== 'number') {
    throw new Error(`Expected element attributes to include a numeric frame.y: ${JSON.stringify(attributes)}`);
  }
  return frame.y;
};

describeIfFixture('Chat message order', () => {
  it('renders prompt and reply in chronological visual order', async () => {
    await device.launchApp({
      newInstance: true,
      delete: true,
      ...(process.env.EXPO_DETOX_URL ? { url: process.env.EXPO_DETOX_URL } : {}),
    });

    const userQuestion = element(by.text('E2E User Question'));
    const reply = element(by.text('E2E Agent Reply'));

    await waitFor(userQuestion).toBeVisible().withTimeout(30000);
    await expect(reply).toBeVisible();

    const userY = yPosition(await userQuestion.getAttributes());
    const replyY = yPosition(await reply.getAttributes());

    jestExpect(userY).toBeLessThan(replyY);
  });
});
