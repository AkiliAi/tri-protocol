/**
 * Unit tests for AgentBuilder
 */

import { AgentBuilder, SDKAgentImpl } from '../../../../sdk/src/builders/AgentBuilder';
import { TriProtocol, TriAgent } from '../../../../sdk/src/types/core-types';
import { AgentConfig, MemoryConfig, ToolDefinition } from '../../../../sdk/src/types';

// Mock EventEmitter with actual functionality
jest.mock('eventemitter3', () => {
  return {
    EventEmitter: class MockEventEmitter {
      private handlers: Map<string, Function[]> = new Map();

      on(event: string, handler: Function) {
        if (!this.handlers.has(event)) {
          this.handlers.set(event, []);
        }
        this.handlers.get(event)!.push(handler);
        return this;
      }

      off(event: string, handler: Function) {
        const eventHandlers = this.handlers.get(event);
        if (eventHandlers) {
          const index = eventHandlers.indexOf(handler);
          if (index !== -1) {
            eventHandlers.splice(index, 1);
          }
        }
        return this;
      }

      emit(event: string, ...args: any[]) {
        const eventHandlers = this.handlers.get(event);
        if (eventHandlers) {
          eventHandlers.forEach(handler => handler(...args));
        }
        return true;
      }

      removeAllListeners(event?: string) {
        if (event) {
          this.handlers.delete(event);
        } else {
          this.handlers.clear();
        }
        return this;
      }
    }
  };
});

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-123')
}));

describe('AgentBuilder', () => {
  let builder: AgentBuilder;
  let mockProtocol: jest.Mocked<TriProtocol>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock protocol
    mockProtocol = {
      registerAgent: jest.fn(),
      getOrchestrator: jest.fn(),
      getLLMService: jest.fn(),
      getPersistence: jest.fn(),
      getProtocol: jest.fn(),
      initialize: jest.fn(),
      shutdown: jest.fn()
    } as unknown as jest.Mocked<TriProtocol>;

    builder = new AgentBuilder(mockProtocol);
  });

  describe('Fluent API', () => {
    it('should set agent name', () => {
      const result = builder.withName('TestAgent');
      expect(result).toBe(builder);
      expect((builder as any).config.name).toBe('TestAgent');
    });

    it('should set agent description', () => {
      const result = builder.withDescription('Test Description');
      expect(result).toBe(builder);
      expect((builder as any).config.description).toBe('Test Description');
    });

    it('should add capabilities', () => {
      builder.withCapability('research');
      builder.withCapability('analysis');

      expect((builder as any).capabilities).toContain('research');
      expect((builder as any).capabilities).toContain('analysis');
    });

    it('should add capability object', () => {
      const capability = { name: 'custom-cap', description: 'Custom capability' };
      builder.withCapability(capability);

      expect((builder as any).capabilities).toContain('custom-cap');
    });

    it('should add tools', () => {
      builder.withTool('web-search');
      builder.withTool('calculator');

      expect((builder as any).tools).toContain('web-search');
      expect((builder as any).tools).toContain('calculator');
    });

    it('should add tool definition', () => {
      const tool: ToolDefinition = {
        name: 'custom-tool',
        description: 'Custom tool',
        parameters: {},
        handler: jest.fn()
      };
      builder.withTool(tool);

      expect((builder as any).tools).toContain(tool);
    });

    it('should configure memory', () => {
      builder.withMemory('long');

      expect((builder as any).memory).toEqual({
        enabled: true,
        type: 'long'
      });
    });

    it('should configure LLM', () => {
      const llmConfig = {
        provider: 'openai',
        model: 'gpt-4'
      };
      builder.withLLM(llmConfig);

      expect((builder as any).config.llm).toEqual(llmConfig);
    });

    it('should set personality', () => {
      builder.withPersonality('You are a helpful assistant');

      expect((builder as any).config.systemPrompt).toBe('You are a helpful assistant');
    });

    it('should enable A2A communication', () => {
      builder.canCommunicate();

      expect((builder as any).config.enableA2A).toBe(true);
    });

    it('should enable MCP tools', () => {
      builder.canUseTools();

      expect((builder as any).config.enableMCP).toBe(true);
    });

    it('should enable LangGraph workflows', () => {
      builder.canExecuteWorkflows();

      expect((builder as any).config.enableLangGraph).toBe(true);
    });

    it('should chain multiple configurations', () => {
      const result = builder
        .withName('ChainedAgent')
        .withDescription('Chained Description')
        .withCapability('cap1')
        .withTool('tool1')
        .withMemory('both')
        .canCommunicate()
        .canUseTools()
        .canExecuteWorkflows();

      expect(result).toBe(builder);
      expect((builder as any).config.name).toBe('ChainedAgent');
      expect((builder as any).config.enableA2A).toBe(true);
      expect((builder as any).config.enableMCP).toBe(true);
      expect((builder as any).config.enableLangGraph).toBe(true);
    });
  });

  describe('Templates', () => {
    it('should apply assistant template', () => {
      builder.fromTemplate('assistant');

      const config = (builder as any).config;
      expect(config.systemPrompt).toBe('You are a helpful, friendly assistant.');
      expect(config.enableA2A).toBe(true);
      expect(config.enableMCP).toBe(true);
      expect((builder as any).capabilities).toContain('conversation');
      expect((builder as any).capabilities).toContain('general-knowledge');
    });

    it('should apply researcher template', () => {
      builder.fromTemplate('researcher');

      const config = (builder as any).config;
      expect(config.systemPrompt).toContain('thorough researcher');
      expect(config.enableMCP).toBe(true);
      expect(config.enableLangGraph).toBe(true);
      expect((builder as any).capabilities).toContain('research');
      expect((builder as any).capabilities).toContain('analysis');
    });

    it('should apply analyst template', () => {
      builder.fromTemplate('analyst');

      const config = (builder as any).config;
      expect(config.systemPrompt).toContain('data analyst');
      expect(config.enableMCP).toBe(true);
      expect(config.enableLangGraph).toBe(true);
      expect((builder as any).capabilities).toContain('data-analysis');
      expect((builder as any).capabilities).toContain('visualization');
    });

    it('should apply coder template', () => {
      builder.fromTemplate('coder');

      const config = (builder as any).config;
      expect(config.systemPrompt).toContain('expert programmer');
      expect(config.enableMCP).toBe(true);
      expect((builder as any).capabilities).toContain('code-generation');
      expect((builder as any).capabilities).toContain('debugging');
    });

    it('should handle unknown template gracefully', () => {
      builder.fromTemplate('unknown-template');

      // Should not throw, just not apply any template
      expect((builder as any).config.systemPrompt).toBeUndefined();
    });

    it('should override template settings', () => {
      builder
        .fromTemplate('assistant')
        .withPersonality('Custom personality')
        .withCapability('custom-cap');

      expect((builder as any).config.systemPrompt).toBe('Custom personality');
      expect((builder as any).capabilities).toContain('custom-cap');
      expect((builder as any).capabilities).toContain('conversation');
    });
  });

  describe('Build', () => {
    it('should build agent with configuration', async () => {
      builder
        .withName('TestAgent')
        .withDescription('Test Description')
        .withCapability('test-cap');

      const agent = await builder.build();

      expect(agent).toBeDefined();
      expect(agent.name).toBe('TestAgent');
      expect(agent.description).toBe('Test Description');
      expect(agent.capabilities).toContain('test-cap');
    });

    it('should initialize agent after build', async () => {
      const agent = await builder.withName('TestAgent').build();

      // Verify protocol.registerAgent was called
      expect(mockProtocol.registerAgent).toHaveBeenCalled();
    });

    it('should merge configurations during build', async () => {
      // Mock persistence for memory
      mockProtocol.getPersistence.mockReturnValue({
        save: jest.fn(),
        load: jest.fn()
      } as any);

      builder
        .fromTemplate('assistant')
        .withCapability('custom-cap')
        .withTool('custom-tool')
        .withMemory('both');

      const agent = await builder.build();

      expect(agent.capabilities).toContain('conversation');
      expect(agent.capabilities).toContain('general-knowledge');
      expect(agent.capabilities).toContain('custom-cap');
      expect(agent.tools).toContain('custom-tool');
      expect(agent.memory).toEqual({
        enabled: true,
        type: 'both'
      });
    });

    it('should emit event when SDK is provided', async () => {
      const mockSdk = {
        emit: jest.fn()
      };

      const builderWithSdk = new AgentBuilder(mockProtocol, mockSdk);
      const agent = await builderWithSdk.withName('TestAgent').build();

      expect(mockSdk.emit).toHaveBeenCalledWith('agent:created', agent);
    });
  });
});

describe('SDKAgentImpl', () => {
  let agent: SDKAgentImpl;
  let mockProtocol: jest.Mocked<TriProtocol>;
  let config: AgentConfig;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProtocol = {
      registerAgent: jest.fn(),
      getOrchestrator: jest.fn(() => ({
        executeTask: jest.fn()
      })),
      getLLMService: jest.fn(() => ({
        chat: jest.fn().mockResolvedValue('Test response')
      })),
      getPersistence: jest.fn(() => ({
        save: jest.fn(),
        load: jest.fn()
      })),
      getProtocol: jest.fn(),
      initialize: jest.fn(),
      shutdown: jest.fn()
    } as unknown as jest.Mocked<TriProtocol>;

    config = {
      name: 'TestAgent',
      description: 'Test Description',
      capabilities: ['test-cap'],
      tools: ['test-tool'],
      systemPrompt: 'Test system prompt',
      enableA2A: true,
      enableMCP: true,
      enableLangGraph: true
    };

    agent = new SDKAgentImpl(mockProtocol, config);
  });

  describe('Initialization', () => {
    it('should initialize agent', async () => {
      await agent.initialize();

      expect(agent.id).toBeDefined();
      expect(typeof agent.id).toBe('string');
      expect(agent.id.length).toBeGreaterThan(0);
      expect(mockProtocol.registerAgent).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      mockProtocol.registerAgent.mockRejectedValue(new Error('Registration failed'));

      await expect(agent.initialize()).rejects.toThrow('Failed to initialize agent');
    });

    it('should setup memory if configured', async () => {
      const persistence = {
        save: jest.fn(),
        load: jest.fn()
      };
      mockProtocol.getPersistence.mockReturnValue(persistence as any);

      agent.memory = { enabled: true, type: 'both' };
      await agent.initialize();

      expect(persistence.save).toHaveBeenCalledWith(
        'metadata',
        expect.stringContaining('memory'),
        expect.objectContaining({
          type: 'both',
          created: expect.any(String)
        })
      );
    });
  });

  describe('Response Generation', () => {
    beforeEach(async () => {
      // Setup LLM service mock
      const llmService = {
        chat: jest.fn().mockResolvedValue('Test response'),
        complete: jest.fn().mockResolvedValue('Test completion')
      };
      mockProtocol.getLLMService.mockReturnValue(llmService as any);

      await agent.initialize();
    });

    it('should generate response', async () => {
      const response = await agent.respond('Hello');

      expect(response).toBe('Test response');
      expect(mockProtocol.getLLMService).toHaveBeenCalled();
    });

    it('should include context in response', async () => {
      const llmService = mockProtocol.getLLMService();
      const context = { topic: 'test' };

      await agent.respond('Hello', context);

      expect(llmService.chat).toHaveBeenCalledWith(
        expect.arrayContaining([
          { role: 'system', content: 'Test system prompt' },
          { role: 'user', content: 'Hello' },
          { role: 'system', content: expect.stringContaining('test') }
        ]),
        undefined
      );
    });

    it('should handle response errors', async () => {
      const llmService = mockProtocol.getLLMService();
      llmService.chat = jest.fn().mockRejectedValue(new Error('LLM error'));

      await expect(agent.respond('Hello')).rejects.toThrow('Failed to generate response');
    });

    it('should update state during response', async () => {
      const stateChangedHandler = jest.fn();
      agent.on('state:changed', stateChangedHandler);

      await agent.respond('Hello');

      expect(stateChangedHandler).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'thinking' })
      );
      expect(stateChangedHandler).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'idle' })
      );
    });

    it('should emit response event', async () => {
      const responseHandler = jest.fn();
      agent.on('response', responseHandler);

      await agent.respond('Hello');

      expect(responseHandler).toHaveBeenCalledWith({
        input: 'Hello',
        response: 'Test response'
      });
    });
  });

  describe('Task Execution', () => {
    beforeEach(async () => {
      // Setup orchestrator mock before initialization
      const orchestrator = {
        executeTask: jest.fn().mockResolvedValue({ result: 'success' })
      };
      mockProtocol.getOrchestrator.mockReturnValue(orchestrator as any);

      await agent.initialize();
    });

    it('should execute task', async () => {
      const orchestrator = mockProtocol.getOrchestrator();

      const task = { type: 'test', data: 'test-data' };
      const result = await agent.execute(task);

      expect(result).toEqual({ result: 'success' });
      expect(orchestrator.executeTask).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: agent.id,
          type: 'test',
          payload: task
        })
      );
    });

    it('should handle execution errors', async () => {
      const orchestrator = mockProtocol.getOrchestrator();
      orchestrator.executeTask = jest.fn().mockRejectedValue(new Error('Execution failed'));

      await expect(agent.execute({ type: 'test' })).rejects.toThrow('Failed to execute task');
    });

    it('should emit task completion event', async () => {
      const orchestrator = mockProtocol.getOrchestrator();
      orchestrator.executeTask = jest.fn().mockResolvedValue({ result: 'success' });

      const taskCompletedHandler = jest.fn();
      agent.on('task:completed', taskCompletedHandler);

      const task = { type: 'test' };
      await agent.execute(task);

      expect(taskCompletedHandler).toHaveBeenCalledWith({
        task,
        result: { result: 'success' }
      });
    });
  });

  describe('Capabilities', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should add capability string', async () => {
      await agent.addCapability('new-capability');

      expect(agent.capabilities).toContain('new-capability');
    });

    it('should add capability object', async () => {
      await agent.addCapability({
        name: 'custom-cap',
        description: 'Custom capability'
      });

      expect(agent.capabilities).toContain('custom-cap');
    });

    it('should not add duplicate capabilities', async () => {
      await agent.addCapability('test-cap');
      await agent.addCapability('test-cap');

      const count = agent.capabilities.filter(c => c === 'test-cap').length;
      expect(count).toBe(1);
    });

    it('should emit capability added event', async () => {
      const capabilityHandler = jest.fn();
      agent.on('capability:added', capabilityHandler);

      await agent.addCapability('new-cap');

      expect(capabilityHandler).toHaveBeenCalledWith('new-cap');
    });
  });

  describe('Communication', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should communicate with another agent', async () => {
      const a2aProtocol = {
        sendMessage: jest.fn().mockResolvedValue({ response: 'ok' })
      };
      mockProtocol.getProtocol.mockReturnValue(a2aProtocol as any);

      const result = await agent.communicate('other-agent', { message: 'hello' });

      expect(result).toEqual({ response: 'ok' });
      expect(a2aProtocol.sendMessage).toHaveBeenCalledWith('other-agent', { message: 'hello' });
    });

    it('should throw error if A2A not enabled', async () => {
      mockProtocol.getProtocol.mockReturnValue(null);

      await expect(agent.communicate('other-agent', {})).rejects.toThrow('Failed to communicate with agent');
    });

    it('should emit communication event', async () => {
      const a2aProtocol = {
        sendMessage: jest.fn().mockResolvedValue({ response: 'ok' })
      };
      mockProtocol.getProtocol.mockReturnValue(a2aProtocol as any);

      const communicationHandler = jest.fn();
      agent.on('communication:completed', communicationHandler);

      await agent.communicate('other-agent', { message: 'hello' });

      expect(communicationHandler).toHaveBeenCalledWith({
        agentId: 'other-agent',
        message: { message: 'hello' },
        response: { response: 'ok' }
      });
    });
  });

  describe('State Management', () => {
    it('should return current state', () => {
      const state = agent.getState();

      expect(state).toEqual({ status: 'idle' });
    });

    it('should return state copy', () => {
      const state1 = agent.getState();
      const state2 = agent.getState();

      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('Memory Management', () => {
    beforeEach(async () => {
      const persistence = {
        save: jest.fn(),
        load: jest.fn()
      };
      mockProtocol.getPersistence.mockReturnValue(persistence as any);
      await agent.initialize();
    });

    it('should enable memory', async () => {
      const memoryConfig: MemoryConfig = {
        enabled: true,
        type: 'both',
        ttl: 3600,
        maxEntries: 100
      };

      await agent.enableMemory(memoryConfig);

      expect(agent.memory).toEqual(memoryConfig);
    });

    it('should emit memory enabled event', async () => {
      const memoryHandler = jest.fn();
      agent.on('memory:enabled', memoryHandler);

      const memoryConfig: MemoryConfig = {
        enabled: true,
        type: 'short'
      };

      await agent.enableMemory(memoryConfig);

      expect(memoryHandler).toHaveBeenCalledWith(memoryConfig);
    });

    it('should store conversations in memory', async () => {
      agent.memory = { enabled: true, type: 'both' };
      const persistence = mockProtocol.getPersistence();

      await agent.respond('Hello');

      expect(persistence?.save).toHaveBeenCalledWith(
        'memory',
        expect.stringContaining('history'),
        expect.arrayContaining([
          expect.objectContaining({
            input: 'Hello',
            response: 'Test response',
            timestamp: expect.any(String)
          })
        ])
      );
    });
  });

  describe('Tool Management', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should add tool string', async () => {
      await agent.addTool('new-tool');

      expect(agent.tools).toContain('new-tool');
    });

    it('should add tool definition', async () => {
      const tool: ToolDefinition = {
        name: 'custom-tool',
        description: 'Custom tool',
        parameters: {},
        handler: jest.fn()
      };

      await agent.addTool(tool);

      expect(agent.tools).toContain('custom-tool');
    });

    it('should register tool with MCP if enabled', async () => {
      // Setup MCP protocol mock
      const mcpProtocol = {
        registerTool: jest.fn()
      };
      mockProtocol.getProtocol.mockImplementation((type) => {
        if (type === 'mcp') {
          return mcpProtocol as any;
        }
        return null;
      });

      // Enable MCP for this agent
      config.enableMCP = true;
      agent = new SDKAgentImpl(mockProtocol, config);
      await agent.initialize();

      await agent.addTool('test-tool');

      expect(mcpProtocol.registerTool).toHaveBeenCalledWith({ name: 'test-tool' });
    });

    it('should emit tool added event', async () => {
      const toolHandler = jest.fn();
      agent.on('tool:added', toolHandler);

      await agent.addTool('new-tool');

      expect(toolHandler).toHaveBeenCalledWith('new-tool');
    });
  });

  describe('Think Method', () => {
    beforeEach(async () => {
      await agent.initialize();
    });

    it('should delegate think to respond', async () => {
      const respondSpy = jest.spyOn(agent, 'respond');

      await agent.think('Test prompt');

      expect(respondSpy).toHaveBeenCalledWith('Test prompt');
    });
  });
});