/**
 * Jest setup file for SDK unit tests
 */

// Import reflect-metadata polyfill for decorators
import '../../../sdk/src/decorators/reflect-polyfill';

// Set test environment
process.env.NODE_ENV = 'test';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  // Keep error for debugging failed tests
  error: console.error
};

// Mock timers
jest.useFakeTimers();

// Global test utilities
global.createMockProtocol = () => ({
  registerAgent: jest.fn(),
  getOrchestrator: jest.fn(() => ({
    registerWorkflow: jest.fn(),
    executeWorkflow: jest.fn(),
    executeTask: jest.fn()
  })),
  getLLMService: jest.fn(() => ({
    chat: jest.fn().mockResolvedValue('Mock response'),
    complete: jest.fn().mockResolvedValue('Mock completion')
  })),
  getPersistence: jest.fn(() => ({
    save: jest.fn(),
    load: jest.fn(),
    delete: jest.fn(),
    exists: jest.fn()
  })),
  getProtocol: jest.fn(),
  initialize: jest.fn(),
  shutdown: jest.fn()
});

global.createMockAgent = () => ({
  id: 'mock-agent-id',
  name: 'MockAgent',
  description: 'Mock agent for testing',
  capabilities: ['test-capability'],
  tools: ['test-tool'],
  respond: jest.fn().mockResolvedValue('Mock response'),
  think: jest.fn().mockResolvedValue('Mock thought'),
  execute: jest.fn().mockResolvedValue({ success: true }),
  addCapability: jest.fn(),
  addTool: jest.fn(),
  enableMemory: jest.fn(),
  communicate: jest.fn().mockResolvedValue({ response: 'ok' }),
  getState: jest.fn().mockReturnValue({ status: 'idle' }),
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn()
});

global.createMockWorkflow = () => ({
  id: 'mock-workflow-id',
  name: 'MockWorkflow',
  description: 'Mock workflow for testing',
  start: jest.fn(),
  stop: jest.fn(),
  execute: jest.fn().mockResolvedValue({ result: 'success' }),
  getState: jest.fn().mockReturnValue({
    status: 'idle',
    currentStep: null,
    completedSteps: [],
    errors: []
  }),
  onComplete: jest.fn(),
  onError: jest.fn(),
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn()
});

// Custom matchers
expect.extend({
  toBeValidAgent(received) {
    const pass =
      received &&
      typeof received.id === 'string' &&
      typeof received.name === 'string' &&
      Array.isArray(received.capabilities) &&
      typeof received.respond === 'function';

    return {
      pass,
      message: () => pass
        ? `expected ${received} not to be a valid agent`
        : `expected ${received} to be a valid agent with id, name, capabilities, and respond method`
    };
  },

  toBeValidWorkflow(received) {
    const pass =
      received &&
      typeof received.id === 'string' &&
      typeof received.name === 'string' &&
      typeof received.execute === 'function' &&
      typeof received.getState === 'function';

    return {
      pass,
      message: () => pass
        ? `expected ${received} not to be a valid workflow`
        : `expected ${received} to be a valid workflow with id, name, execute, and getState methods`
    };
  },

  toBeValidUUID(received) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const pass = typeof received === 'string' && uuidRegex.test(received);

    return {
      pass,
      message: () => pass
        ? `expected ${received} not to be a valid UUID`
        : `expected ${received} to be a valid UUID`
    };
  }
});

// TypeScript declarations for custom matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidAgent(): R;
      toBeValidWorkflow(): R;
      toBeValidUUID(): R;
    }
  }

  var createMockProtocol: () => any;
  var createMockAgent: () => any;
  var createMockWorkflow: () => any;
}

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
  jest.clearAllTimers();
});

// Clean up after all tests
afterAll(() => {
  jest.restoreAllMocks();
});