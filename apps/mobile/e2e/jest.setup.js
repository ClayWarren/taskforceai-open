const adapter = require('detox/runners/jest/adapter');
const specReporter = require('detox/runners/jest/reporter');
const { detox } = require('detox');

jasmine.getEnv().addReporter(specReporter);

beforeAll(async () => {
  await detox.init();
}, 120000);

beforeEach(async () => {
  await adapter.beforeEach();
});

afterAll(async () => {
  await adapter.afterAll();
  await detox.cleanup();
});
