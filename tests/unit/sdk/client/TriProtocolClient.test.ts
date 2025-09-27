/**
 * Unit tests for TriProtocolClient
 */

import { TriProtocolClient } from '../../../../sdk/src/client/TriProtocolClient';
import { TriProtocolSDK } from '../../../../sdk/src/TriProtocolSDK';
import { SDKError } from '../../../../sdk/src/types';

// Mock dependencies
jest.mock('../../../../sdk/src/TriProtocolSDK');

describe('TriProtocolClient', () => {
  let client: TriProtocolClient;
  let mockSDK: jest.Mocked<TriProtocolSDK>;
  let mockPersistence: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock persistence
    mockPersistence = {
      save: jest.fn().mockResolvedValue(undefined),
      load: jest.fn().mockResolvedValue({ key: 'value' }),
      searchSimilar: jest.fn().mockResolvedValue([{ id: 'result-1' }])
    };

    // Create mock protocol
    const mockGetPersistence = jest.fn().mockReturnValue(mockPersistence);
    const mockProtocol = {
      getPersistence: mockGetPersistence
    };

    // Create mock SDK
    mockSDK = {
      query: jest.fn().mockResolvedValue('Test response'),
      chat: jest.fn().mockResolvedValue('Chat response'),
      createAgent: jest.fn().mockResolvedValue({ id: 'agent-123', name: 'TestAgent' }),
      createWorkflow: jest.fn().mockResolvedValue({ id: 'workflow-123', name: 'TestWorkflow' }),
      executeWorkflow: jest.fn().mockResolvedValue({ result: 'success' }),
      runWorkflow: jest.fn().mockResolvedValue({ result: 'success' }),
      getWorkflowStatus: jest.fn().mockResolvedValue({ status: 'running' }),
      analyze: jest.fn().mockResolvedValue({ insights: ['insight1'] }),
      getProtocol: jest.fn().mockReturnValue(mockProtocol),
      mockGetPersistence // Expose for tests
    } as any;

    client = new TriProtocolClient(mockSDK);
  });

  describe('Simple API', () => {
    describe('ask', () => {
      it('should process question through SDK', async () => {
        const result = await client.ask('What is the weather?');

        expect(result).toBe('Test response');
        expect(mockSDK.query).toHaveBeenCalledWith('What is the weather?', undefined);
      });

      it('should pass context to SDK', async () => {
        const context = { location: 'New York' };
        await client.ask('What is the weather?', context);

        expect(mockSDK.query).toHaveBeenCalledWith('What is the weather?', context);
      });

      it('should handle errors', async () => {
        mockSDK.query.mockRejectedValue(new Error('Query failed'));

        await expect(client.ask('Test')).rejects.toThrow(SDKError);
      });
    });

    describe('chat', () => {
      it('should handle chat conversation', async () => {
        const result = await client.chat('Hello');

        expect(result).toBe('Chat response');
        expect(mockSDK.chat).toHaveBeenCalledWith('Hello');
      });

      it('should handle errors in chat', async () => {
        mockSDK.chat.mockRejectedValue(new Error('Chat failed'));

        await expect(client.chat('Test')).rejects.toThrow(SDKError);
      });
    });

    describe('memory operations', () => {
      describe('remember', () => {
        it('should save to memory', async () => {
          await client.remember('test-key', { data: 'test-value' });

          expect(mockPersistence.save).toHaveBeenCalledWith('memory', 'test-key', { data: 'test-value' });
        });

        it('should handle errors', async () => {
          mockPersistence.save.mockRejectedValue(new Error('Save failed'));

          await expect(client.remember('key', 'value')).rejects.toThrow(SDKError);
        });

        it('should throw if persistence not configured', async () => {
          (mockSDK as any).mockGetPersistence.mockReturnValue(null);

          await expect(client.remember('key', 'value')).rejects.toThrow(SDKError);
        });
      });

      describe('recall', () => {
        it('should load from memory', async () => {
          const result = await client.recall('test-key');

          expect(result).toEqual({ key: 'value' });
          expect(mockPersistence.load).toHaveBeenCalledWith('memory', 'test-key');
        });

        it('should handle errors', async () => {
          mockPersistence.load.mockRejectedValue(new Error('Load failed'));

          await expect(client.recall('key')).rejects.toThrow(SDKError);
        });
      });
    });

    describe('search', () => {
      it('should search with vector similarity', async () => {
        const result = await client.search('test query');

        expect(result).toEqual([{ id: 'result-1' }]);
        expect(mockPersistence.searchSimilar).toHaveBeenCalledWith('test query', {
          limit: 10,
          threshold: 0.7
        });
      });

      it('should pass options to search', async () => {
        const options = { limit: 5, threshold: 0.9 };
        await client.search('test query', options);

        expect(mockPersistence.searchSimilar).toHaveBeenCalledWith('test query', {
          limit: 5,
          threshold: 0.9
        });
      });
    });
  });

  describe('Agent Management Client', () => {
    describe('agents.create', () => {
      it('should create agent', async () => {
        const result = await client.agents.create('TestAgent');

        expect(result.id).toBe('agent-123');
        expect(mockSDK.createAgent).toHaveBeenCalledWith('TestAgent');
      });
    });

    describe('agents.list', () => {
      it('should have list method', () => {
        expect(client.agents.list).toBeDefined();
        expect(typeof client.agents.list).toBe('function');
      });
    });

    describe('agents.get', () => {
      it('should have get method', () => {
        expect(client.agents.get).toBeDefined();
        expect(typeof client.agents.get).toBe('function');
      });
    });

    describe('agents.delete', () => {
      it('should have delete method', () => {
        expect(client.agents.delete).toBeDefined();
        expect(typeof client.agents.delete).toBe('function');
      });
    });
  });

  describe('Workflow Management Client', () => {
    describe('workflows.create', () => {
      it('should create workflow', async () => {
        const result = await client.workflows.create('TestWorkflow');

        expect(result.id).toBe('workflow-123');
        expect(mockSDK.createWorkflow).toHaveBeenCalledWith('TestWorkflow');
      });
    });

    describe('workflows.list', () => {
      it('should have list method', () => {
        expect(client.workflows.list).toBeDefined();
        expect(typeof client.workflows.list).toBe('function');
      });
    });

    describe('workflows.run', () => {
      it('should run workflow', async () => {
        const input = { data: 'test' };
        const result = await client.workflows.run('workflow-123', input);

        expect(result.result).toBe('success');
        expect(mockSDK.runWorkflow).toHaveBeenCalledWith('workflow-123', input);
      });
    });

    describe('workflows.status', () => {
      it('should get workflow status', async () => {
        const result = await client.workflows.status('workflow-123');

        expect(result.status).toBe('running');
        expect(mockSDK.getWorkflowStatus).toHaveBeenCalledWith('workflow-123');
      });
    });
  });

  describe('LLM Client', () => {
    describe('llm.complete', () => {
      it('should have complete method', () => {
        expect(client.llm.complete).toBeDefined();
        expect(typeof client.llm.complete).toBe('function');
      });
    });

    describe('llm.chat', () => {
      it('should have chat method', () => {
        expect(client.llm.chat).toBeDefined();
        expect(typeof client.llm.chat).toBe('function');
      });
    });

    describe('llm.embed', () => {
      it('should have embed method', () => {
        expect(client.llm.embed).toBeDefined();
        expect(typeof client.llm.embed).toBe('function');
      });
    });
  });

  describe('Error handling', () => {
    it('should wrap SDK errors properly', async () => {
      mockSDK.query.mockRejectedValue(new Error('Network error'));

      try {
        await client.ask('Test');
        fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(SDKError);
        expect((error as SDKError).code).toBe('ASK_ERROR');
      }
    });

    it('should handle missing persistence gracefully', async () => {
      (mockSDK as any).mockGetPersistence.mockReturnValue(null);

      await expect(client.search('test')).rejects.toThrow(SDKError);
    });
  });

  describe('Integration', () => {
    it('should work with complete flow', async () => {
      // Create an agent
      const agent = await client.agents.create('TestAgent');
      expect(agent.id).toBe('agent-123');

      // Ask a question
      const answer = await client.ask('What is 2+2?');
      expect(answer).toBe('Test response');

      // Remember something
      await client.remember('calculation', { question: '2+2', answer: 4 });

      // Recall it
      const memory = await client.recall('calculation');
      expect(memory).toBeDefined();
    });
  });
});