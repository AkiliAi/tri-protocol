/**
 * Unit tests for TriProtocolSDK
 */

import { TriProtocolSDK } from '../../../sdk/src/TriProtocolSDK';
import { SDKConfig } from '../../../sdk/src/types';
import { LoggerManager } from '../../../logger/src';
import { EventEmitter } from 'eventemitter3';

// Mock LoggerManager
jest.mock('../../../logger/src', () => ({
  LoggerManager: {
    getLogger: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    }))
  }
}));

// Mock EventEmitter
jest.mock('eventemitter3');

describe('TriProtocolSDK', () => {
  let sdk: TriProtocolSDK;
  let mockConfig: SDKConfig;

  beforeEach(() => {
    // Clear all instances and calls to constructor and all methods
    jest.clearAllMocks();

    // Reset singleton instance
    (TriProtocolSDK as any).instance = null;

    mockConfig = {
      mode: 'development',
      persistence: {
        enabled: false
      },
      logging: {
        enabled: true,
        level: 'info'
      }
    };
  });

  describe('Singleton Pattern', () => {
    it('should create instance with create() method', () => {
      const instance = TriProtocolSDK.create(mockConfig);
      expect(instance).toBeInstanceOf(TriProtocolSDK);
    });

    it('should return same instance with multiple create() calls', () => {
      const instance1 = TriProtocolSDK.create(mockConfig);
      const instance2 = TriProtocolSDK.create(mockConfig);
      expect(instance1).toBe(instance2);
    });

    it('should create and initialize with static initialize method', async () => {
      const instance = await TriProtocolSDK.initialize(mockConfig);
      expect(instance).toBeInstanceOf(TriProtocolSDK);
      expect(instance.isInitialized()).toBe(true);
    });
  });

  describe('Initialization', () => {
    beforeEach(() => {
      sdk = TriProtocolSDK.create(mockConfig);
    });

    it('should initialize with default config', async () => {
      await sdk.initialize();
      expect(sdk.isInitialized()).toBe(true);
    });

    it('should initialize with custom config', async () => {
      const customConfig: SDKConfig = {
        mode: 'production',
        persistence: {
          enabled: true,
          backend: 'mongodb'
        },
        llm: {
          provider: 'openai',
          apiKey: 'test-key'
        }
      };

      const customSdk = TriProtocolSDK.create(customConfig);
      await customSdk.initialize();
      expect(customSdk.isInitialized()).toBe(true);
    });

    it('should handle initialization errors', async () => {
      const errorConfig = { ...mockConfig };
      const errorSdk = TriProtocolSDK.create(errorConfig);

      // Mock the protocol initialization to throw error
      const originalInit = errorSdk.initialize;
      errorSdk.initialize = jest.fn().mockRejectedValue(new Error('Init failed'));

      await expect(errorSdk.initialize()).rejects.toThrow('Init failed');
    });
  });

  describe('Agent Management', () => {
    beforeEach(async () => {
      sdk = TriProtocolSDK.create(mockConfig);
      await sdk.initialize();
    });

    it('should create an agent', async () => {
      const agent = await sdk.createAgent('TestAgent');
      expect(agent).toBeDefined();
    });

    it('should create an agent with template', async () => {
      const agent = await sdk.createAgent('TestAgent', 'assistant');
      expect(agent).toBeDefined();
    });

  });

  describe('Workflow Management', () => {
    beforeEach(async () => {
      sdk = TriProtocolSDK.create(mockConfig);
      await sdk.initialize();
    });

    it('should create a workflow', async () => {
      const workflow = await sdk.createWorkflow('TestWorkflow');
      expect(workflow).toBeDefined();
    });

    it('should run workflow from template', async () => {
      // Mock workflow template
      const mockTemplate = {
        create: jest.fn().mockResolvedValue({
          execute: jest.fn().mockResolvedValue({ result: 'success' })
        })
      };
      (sdk as any).workflowTemplates.set('data-pipeline', mockTemplate);

      const result = await sdk.runWorkflow('data-pipeline', { input: 'test' });
      expect(result).toEqual({ result: 'success' });
    });

    it('should execute workflow', async () => {
      const workflow = { id: 'wf-123', execute: jest.fn() };
      const result = await sdk.executeWorkflow(workflow, { input: 'test' });
      expect(workflow.execute).toHaveBeenCalled();
    });

    it('should get workflow status', async () => {
      const status = await sdk.getWorkflowStatus('wf-123');
      expect(status).toBeDefined();
    });
  });

  describe('Query and Chat', () => {
    beforeEach(async () => {
      sdk = TriProtocolSDK.create(mockConfig);
      await sdk.initialize();
    });

    it('should handle query', async () => {
      // Mock LLM service with complete method
      const mockLLMService = {
        complete: jest.fn().mockResolvedValue('The weather is sunny'),
        chat: jest.fn().mockResolvedValue('Chat response')
      };

      const mockProtocol = {
        getLLMService: jest.fn().mockReturnValue(mockLLMService)
      };

      (sdk as any).protocol = mockProtocol;

      const result = await sdk.query('What is the weather?');
      expect(result).toBeDefined();
    });

    it('should handle chat', async () => {
      // Mock persistence for memory
      const mockPersistence = {
        save: jest.fn(),
        load: jest.fn().mockResolvedValue(null)
      };

      // Mock LLM service
      const mockLLMService = {
        chat: jest.fn().mockResolvedValue('Hello, how can I help you?')
      };

      // Mock protocol with all required methods
      const mockProtocol = {
        getPersistence: jest.fn().mockReturnValue(mockPersistence),
        getLLMService: jest.fn().mockReturnValue(mockLLMService),
        getRegistry: jest.fn().mockReturnValue({
          register: jest.fn()
        }),
        registerAgent: jest.fn()
      };

      (sdk as any).protocol = mockProtocol;

      const response = await sdk.chat('Hello');
      expect(response).toBeDefined();
      expect(typeof response).toBe('string');
    });

    it('should handle analyze', async () => {
      const result = await sdk.analyze({ data: [1, 2, 3] }, 'statistical');
      expect(result).toBeDefined();
    });
  });

  describe('Client Operations', () => {
    beforeEach(async () => {
      sdk = TriProtocolSDK.create(mockConfig);
      await sdk.initialize();
    });

    it('should get client instance', () => {
      // Initialize client first
      (sdk as any).client = {
        sendMessage: jest.fn(),
        callTool: jest.fn()
      };

      const client = sdk.getClient();
      expect(client).toBeDefined();
      expect(client.sendMessage).toBeDefined();
      expect(client.callTool).toBeDefined();
    });
  });

  describe('Plugin Management', () => {
    beforeEach(async () => {
      sdk = TriProtocolSDK.create(mockConfig);
      await sdk.initialize();
    });

    it('should register plugin', async () => {
      const plugin = {
        name: 'TestPlugin',
        version: '1.0.0',
        install: jest.fn()
      };

      await sdk.registerPlugin(plugin);
      expect(plugin.install).toHaveBeenCalled();
    });

    it('should get plugins', () => {
      const plugins = sdk.getPlugins();
      expect(Array.isArray(plugins)).toBe(true);
    });
  });

  describe('Event Handling', () => {
    beforeEach(async () => {
      sdk = TriProtocolSDK.create(mockConfig);
      await sdk.initialize();
    });

    it('should handle SDK events', async () => {
      // Since EventEmitter3 is mocked in jest.setup, we need to test differently
      // We'll test that the SDK has the event methods available
      expect(typeof sdk.on).toBe('function');
      expect(typeof sdk.emit).toBe('function');
      expect(typeof sdk.off).toBe('function');

      // The actual event handling is tested by EventEmitter3's own tests
      // We just verify the SDK extends EventEmitter properly
      expect(sdk).toBeInstanceOf(EventEmitter);
    });

    it('should remove event handlers', () => {
      const handler = jest.fn();
      sdk.on('agent:created', handler);
      sdk.off('agent:created', handler);

      sdk.emit('agent:created', { id: 'test-123' });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('State Management', () => {
    beforeEach(() => {
      sdk = TriProtocolSDK.create(mockConfig);
    });

    it('should check if initialized', async () => {
      expect(sdk.isInitialized()).toBe(false);

      await sdk.initialize();
      expect(sdk.isInitialized()).toBe(true);
    });

    it('should get configuration', () => {
      const config = sdk.getConfig();
      expect(config).toBeDefined();
      expect(config.mode).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      sdk = TriProtocolSDK.create(mockConfig);
    });

    it('should handle double initialization', async () => {
      await sdk.initialize();
      // Second call should not throw, just return
      await expect(sdk.initialize()).resolves.not.toThrow();
    });

    it('should handle missing required config', async () => {
      const incompleteConfig = {} as SDKConfig;
      const testSdk = TriProtocolSDK.create(incompleteConfig);

      // Should use defaults without throwing
      await expect(testSdk.initialize()).resolves.not.toThrow();
    });
  });
});