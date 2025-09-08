// Jest setup file for test environment configuration

// Extend global type
declare global {
  var createMockEventBus: () => any;
}

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce noise in tests

// Mock timers for better control in tests
beforeEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
});

// Cleanup after each test
afterEach(() => {
  jest.restoreAllMocks();
});

// Global test utilities
global.createMockEventBus = () => {
  const EventEmitter = require('eventemitter3');
  return new EventEmitter();
};

// Mock console methods to reduce test output noise
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  // Keep error for debugging failed tests
  error: console.error,
};

// Set longer timeout for integration tests
if (process.env.TEST_TYPE === 'integration') {
  jest.setTimeout(30000);
}

// Mock external services
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() }
    }
  })),
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn(),
  patch: jest.fn()
}));

// Export test helpers
export const waitFor = async (condition: () => boolean, timeout = 5000): Promise<void> => {
  const startTime = Date.now();
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};

export const flushPromises = (): Promise<void> => {
  return new Promise(resolve => setImmediate(resolve));
};