/**
 * Unit tests for Template Classes
 */

import {
  ChatAgentTemplate,
  ResearchAgentTemplate,
  AnalystAgentTemplate,
  AssistantAgentTemplate,
  DataPipelineTemplate,
  RAGPipelineTemplate,
  MultiAgentChatTemplate
} from '../../../../sdk/src/templates';
import { TriProtocolSDK } from '../../../../sdk/src/TriProtocolSDK';
import { AgentBuilder } from '../../../../sdk/src/builders/AgentBuilder';
import { WorkflowBuilder } from '../../../../sdk/src/builders/WorkflowBuilder';

// Mock dependencies
jest.mock('../../../../sdk/src/TriProtocolSDK');
jest.mock('../../../../sdk/src/builders/AgentBuilder');
jest.mock('../../../../sdk/src/builders/WorkflowBuilder');

describe('Agent Templates', () => {
  let mockSDK: jest.Mocked<TriProtocolSDK>;
  let mockAgentBuilder: jest.Mocked<AgentBuilder>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock agent builder with fluent interface
    mockAgentBuilder = {
      withDescription: jest.fn().mockReturnThis(),
      withPersonality: jest.fn().mockReturnThis(),
      withCapability: jest.fn().mockReturnThis(),
      withMemory: jest.fn().mockReturnThis(),
      withLLM: jest.fn().mockReturnThis(),
      withTool: jest.fn().mockReturnThis(),
      canCommunicate: jest.fn().mockReturnThis(),
      canUseTools: jest.fn().mockReturnThis(),
      canExecuteWorkflows: jest.fn().mockReturnThis(),
      build: jest.fn().mockResolvedValue({
        id: 'agent-123',
        name: 'TestAgent',
        capabilities: ['conversation']
      })
    } as any;

    // Create mock SDK
    mockSDK = {
      createAgent: jest.fn().mockResolvedValue(mockAgentBuilder)
    } as any;
  });

  describe('ChatAgentTemplate', () => {
    it('should have correct name and description', () => {
      const template = new ChatAgentTemplate();

      expect(template.name).toBe('chat');
      expect(template.description).toBe('A conversational agent with memory and context management');
    });

    it('should create agent with correct configuration', async () => {
      const template = new ChatAgentTemplate();
      const agent = await template.create(mockSDK);

      expect(mockSDK.createAgent).toHaveBeenCalledWith('ChatAgent', 'assistant');
      expect(mockAgentBuilder.withDescription).toHaveBeenCalled();
      expect(mockAgentBuilder.withPersonality).toHaveBeenCalled();
      expect(mockAgentBuilder.withCapability).toHaveBeenCalledWith('conversation');
      expect(mockAgentBuilder.withMemory).toHaveBeenCalledWith('both');
      expect(mockAgentBuilder.canCommunicate).toHaveBeenCalled();
      expect(mockAgentBuilder.canUseTools).toHaveBeenCalled();
      expect(mockAgentBuilder.build).toHaveBeenCalled();
    });
  });

  describe('ResearchAgentTemplate', () => {
    it('should have correct name and description', () => {
      const template = new ResearchAgentTemplate();

      expect(template.name).toBe('research');
      expect(template.description).toBe('A thorough research agent for information gathering and analysis');
    });

    it('should create agent with research capabilities', async () => {
      const template = new ResearchAgentTemplate();
      const agent = await template.create(mockSDK);

      expect(mockSDK.createAgent).toHaveBeenCalledWith('ResearchAgent', 'researcher');
      expect(mockAgentBuilder.withCapability).toHaveBeenCalledWith('research');
      expect(mockAgentBuilder.withCapability).toHaveBeenCalledWith('fact-checking');
      expect(mockAgentBuilder.withTool).toHaveBeenCalledWith('web-search');
      expect(mockAgentBuilder.build).toHaveBeenCalled();
    });
  });

  describe('AnalystAgentTemplate', () => {
    it('should have correct name and description', () => {
      const template = new AnalystAgentTemplate();

      expect(template.name).toBe('analyst');
      expect(template.description).toBe('A data analyst expert in statistical analysis and visualization');
    });

    it('should create agent with analysis capabilities', async () => {
      const template = new AnalystAgentTemplate();
      const agent = await template.create(mockSDK);

      expect(mockSDK.createAgent).toHaveBeenCalledWith('AnalystAgent', 'analyst');
      expect(mockAgentBuilder.withCapability).toHaveBeenCalledWith('data-analysis');
      expect(mockAgentBuilder.withCapability).toHaveBeenCalledWith('pattern-recognition');
      expect(mockAgentBuilder.withTool).toHaveBeenCalledWith('data-processor');
      expect(mockAgentBuilder.build).toHaveBeenCalled();
    });
  });

  describe('AssistantAgentTemplate', () => {
    it('should have correct name and description', () => {
      const template = new AssistantAgentTemplate();

      expect(template.name).toBe('assistant');
      expect(template.description).toBe('A general-purpose assistant for various tasks');
    });

    it('should create agent with assistant capabilities', async () => {
      const template = new AssistantAgentTemplate();
      const agent = await template.create(mockSDK);

      expect(mockSDK.createAgent).toHaveBeenCalledWith('AssistantAgent', 'assistant');
      expect(mockAgentBuilder.withCapability).toHaveBeenCalledWith('general-assistance');
      expect(mockAgentBuilder.withCapability).toHaveBeenCalledWith('task-planning');
      expect(mockAgentBuilder.canExecuteWorkflows).toHaveBeenCalled();
      expect(mockAgentBuilder.build).toHaveBeenCalled();
    });
  });
});

describe('Workflow Templates', () => {
  let mockSDK: jest.Mocked<TriProtocolSDK>;
  let mockWorkflowBuilder: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock workflow builder with fluent interface that covers all methods
    mockWorkflowBuilder = {
      withDescription: jest.fn().mockReturnThis(),
      withTimeout: jest.fn().mockReturnThis(),
      withRetries: jest.fn().mockReturnThis(),
      withCheckpointing: jest.fn().mockReturnThis(),
      step: jest.fn().mockReturnThis(),
      addStep: jest.fn().mockReturnThis(),
      parallel: jest.fn().mockReturnThis(),
      conditional: jest.fn().mockReturnThis(),
      transform: jest.fn((fn) => mockWorkflowBuilder),
      condition: jest.fn(() => mockWorkflowBuilder),
      then: jest.fn((fn) => {
        // Create a simple mock to avoid infinite recursion
        const safeMock = {
          useAgent: jest.fn().mockReturnThis(),
          addStep: jest.fn().mockReturnThis(),
          build: jest.fn()
        };
        fn(safeMock);
        return mockWorkflowBuilder;
      }),
      useAgent: jest.fn().mockReturnThis(),
      build: jest.fn().mockResolvedValue({
        id: 'workflow-123',
        name: 'TestWorkflow',
        nodes: [],
        edges: []
      })
    };

    // Create mock SDK
    // Note: createWorkflow should return a Promise that resolves to a builder
    mockSDK = {
      createWorkflow: jest.fn(() => Promise.resolve(mockWorkflowBuilder))
    } as any;
  });

  describe('DataPipelineTemplate', () => {
    it('should have correct name and description', () => {
      const template = new DataPipelineTemplate();

      expect(template.name).toBe('data-pipeline');
      expect(template.description).toBe('ETL workflow for data processing');
    });
  });

  describe('RAGPipelineTemplate', () => {
    it('should have correct name and description', () => {
      const template = new RAGPipelineTemplate();

      expect(template.name).toBe('rag-pipeline');
      expect(template.description).toBe('Retrieval-Augmented Generation workflow');
    });

  });


});