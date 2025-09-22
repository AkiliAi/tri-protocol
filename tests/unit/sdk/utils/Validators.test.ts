/**
 * Unit tests for Validators
 */

import { Validators } from '../../../../sdk/src/utils/Validators';

describe('Validators', () => {
  describe('validateAgentName', () => {
    it('should accept valid agent names', () => {
      expect(() => Validators.validateAgentName('ValidAgent')).not.toThrow();
      expect(() => Validators.validateAgentName('Agent123')).not.toThrow();
      expect(() => Validators.validateAgentName('My_Agent')).not.toThrow();
      expect(() => Validators.validateAgentName('agent-name')).not.toThrow();
      expect(() => Validators.validateAgentName('A')).not.toThrow();
    });

    it('should reject empty names', () => {
      expect(() => Validators.validateAgentName('')).toThrow('Agent name cannot be empty');
    });

    it('should reject names that are too long', () => {
      const longName = 'a'.repeat(101);
      expect(() => Validators.validateAgentName(longName)).toThrow('Agent name must be less than 100 characters');
    });

    it('should reject names with invalid characters', () => {
      expect(() => Validators.validateAgentName('Agent@123')).toThrow('Agent name can only contain alphanumeric characters, underscores, and hyphens');
      expect(() => Validators.validateAgentName('Agent#Name')).toThrow();
      expect(() => Validators.validateAgentName('Agent Name')).toThrow(); // Space is invalid
      expect(() => Validators.validateAgentName('Agent.Name')).toThrow();
    });

    it('should trim whitespace before validation', () => {
      expect(() => Validators.validateAgentName('  ValidAgent  ')).not.toThrow();
    });

    it('should handle undefined or null gracefully', () => {
      expect(() => Validators.validateAgentName(undefined as any)).toThrow('Agent name cannot be null');
      expect(() => Validators.validateAgentName(null as any)).toThrow('Agent name cannot be null');
    });
  });

  describe('validateCapability', () => {
    it('should accept valid capabilities', () => {
      expect(() => Validators.validateCapability('research')).not.toThrow();
      expect(() => Validators.validateCapability('analysis')).not.toThrow();
      expect(() => Validators.validateCapability('data-analysis')).not.toThrow();
      expect(() => Validators.validateCapability('code-generation')).not.toThrow();
      expect(() => Validators.validateCapability('conversation')).not.toThrow();
      expect(() => Validators.validateCapability('debugging')).not.toThrow();
      expect(() => Validators.validateCapability('summarization')).not.toThrow();
      expect(() => Validators.validateCapability('translation')).not.toThrow();
    });

    it('should accept custom capabilities', () => {
      expect(() => Validators.validateCapability('custom:capability')).not.toThrow();
      expect(() => Validators.validateCapability('custom:my-special-skill')).not.toThrow();
    });

    it('should reject empty capability', () => {
      expect(() => Validators.validateCapability('')).toThrow('Capability cannot be empty');
    });

    it('should reject invalid capability format', () => {
      expect(() => Validators.validateCapability('capability with spaces')).toThrow('Invalid capability');
      expect(() => Validators.validateCapability('capability@special')).toThrow('Invalid capability');
      expect(() => Validators.validateCapability('123')).toThrow('Invalid capability');
    });

    it('should handle undefined or null', () => {
      expect(() => Validators.validateCapability(undefined as any)).toThrow('Capability cannot be empty');
      expect(() => Validators.validateCapability(null as any)).toThrow('Capability cannot be empty');
    });
  });

  describe('validateToolDefinition', () => {
    it('should accept valid tool definitions', () => {
      const validTool = {
        name: 'web-search',
        description: 'Search the web',
        parameters: {},
        execute: () => {}
      };
      expect(() => Validators.validateToolDefinition(validTool)).not.toThrow();
    });

    it('should reject tool without name', () => {
      const invalidTool = {
        description: 'No name'
      };
      expect(() => Validators.validateToolDefinition(invalidTool)).toThrow();
    });

    it('should reject tool with empty name', () => {
      const invalidTool = {
        name: '',
        description: 'Empty name'
      };
      expect(() => Validators.validateToolDefinition(invalidTool)).toThrow();
    });

    it('should handle tool with all properties', () => {
      const completeTool = {
        name: 'calculator',
        description: 'Perform calculations',
        parameters: { a: 'number', b: 'number' },
        execute: jest.fn()
      };
      expect(() => Validators.validateToolDefinition(completeTool)).not.toThrow();
    });
  });

  describe('validateLLMProvider', () => {
    it('should accept valid LLM providers', () => {
      expect(() => Validators.validateLLMProvider('openai')).not.toThrow();
      expect(() => Validators.validateLLMProvider('anthropic')).not.toThrow();
      expect(() => Validators.validateLLMProvider('gemini')).not.toThrow();
      expect(() => Validators.validateLLMProvider('mistral')).not.toThrow();
      expect(() => Validators.validateLLMProvider('huggingface')).not.toThrow();
      expect(() => Validators.validateLLMProvider('ollama')).not.toThrow();
    });

    it('should reject invalid providers', () => {
      expect(() => Validators.validateLLMProvider('invalid-provider')).toThrow('Invalid LLM provider');
      expect(() => Validators.validateLLMProvider('gpt')).toThrow('Invalid LLM provider');
      expect(() => Validators.validateLLMProvider('')).toThrow('Invalid LLM provider');
    });

    it('should be case-insensitive', () => {
      expect(() => Validators.validateLLMProvider('OpenAI')).not.toThrow();
      expect(() => Validators.validateLLMProvider('ANTHROPIC')).not.toThrow();
      expect(() => Validators.validateLLMProvider('Gemini')).not.toThrow();
    });
  });

  describe('validateMemoryConfig', () => {
    it('should accept valid memory config', () => {
      const validConfig = {
        enabled: true,
        type: 'both',
        ttl: 3600,
        maxEntries: 100
      };
      expect(() => Validators.validateMemoryConfig(validConfig)).not.toThrow();
    });

    it('should accept minimal memory config', () => {
      const minimalConfig = {
        enabled: true
      };
      expect(() => Validators.validateMemoryConfig(minimalConfig)).not.toThrow();
    });

    it('should reject invalid memory config', () => {
      const invalidConfig = {
        enabled: 'yes', // Should be boolean
        type: 'invalid'
      };
      expect(() => Validators.validateMemoryConfig(invalidConfig)).toThrow();
    });
  });

  describe('validateWorkflowName', () => {
    it('should accept valid workflow names', () => {
      expect(() => Validators.validateWorkflowName('DataPipeline')).not.toThrow();
      expect(() => Validators.validateWorkflowName('Research_Workflow')).not.toThrow();
      expect(() => Validators.validateWorkflowName('RAG-Pipeline')).not.toThrow();
      expect(() => Validators.validateWorkflowName('Workflow123')).not.toThrow();
    });

    it('should reject empty workflow name', () => {
      expect(() => Validators.validateWorkflowName('')).toThrow();
    });

    it('should reject workflow name with invalid characters', () => {
      expect(() => Validators.validateWorkflowName('Workflow@123')).toThrow();
      expect(() => Validators.validateWorkflowName('Workflow Name')).toThrow();
    });
  });

  describe('validateSDKConfig', () => {
    it('should accept valid configuration', () => {
      const validConfig = {
        mode: 'development',
        baseURL: 'http://localhost:3000',
        apiKey: 'test-key',
        timeout: 5000,
        persistence: {
          enabled: true,
          backend: 'memory'
        }
      };

      expect(() => Validators.validateSDKConfig(validConfig)).not.toThrow();
    });

    it('should accept minimal valid configuration', () => {
      const minimalConfig = {
        mode: 'production'
      };

      expect(() => Validators.validateSDKConfig(minimalConfig)).not.toThrow();
    });

    it('should reject invalid configuration', () => {
      const invalidConfig = {
        mode: 123, // Should be string
        timeout: -1000
      };

      expect(() => Validators.validateSDKConfig(invalidConfig)).toThrow();
    });
  });

  describe('validateAPIKey', () => {
    it('should accept valid API keys for OpenAI', () => {
      expect(() => Validators.validateAPIKey('sk-1234567890abcdef', 'openai')).not.toThrow();
    });

    it('should accept valid API keys for Anthropic', () => {
      expect(() => Validators.validateAPIKey('sk-ant-1234567890abcdef', 'anthropic')).not.toThrow();
    });

    it('should reject empty API key', () => {
      expect(() => Validators.validateAPIKey('', 'openai')).toThrow();
    });

    it('should reject invalid API key format', () => {
      expect(() => Validators.validateAPIKey('invalid-key', 'openai')).toThrow();
    });
  });

  describe('validateWorkflowNode', () => {
    it('should accept valid node', () => {
      const validNode = {
        id: 'node-1',
        type: 'task',
        name: 'Process Data'
      };

      expect(() => Validators.validateWorkflowNode(validNode)).not.toThrow();
    });

    it('should accept node with optional fields', () => {
      const nodeWithOptionals = {
        id: 'node-2',
        type: 'task',
        name: 'Analyze',
        description: 'Analyze the data',
        timeout: 5000,
        retries: 3
      };

      expect(() => Validators.validateWorkflowNode(nodeWithOptionals)).not.toThrow();
    });

    it('should reject node without required fields', () => {
      const invalidNode = {
        name: 'Missing ID',
        type: 'task'
      };

      expect(() => Validators.validateWorkflowNode(invalidNode)).toThrow();
    });
  });

  describe('validateWorkflowEdge', () => {
    it('should accept valid edge', () => {
      const validEdge = {
        from: 'node-1',
        to: 'node-2'
      };

      expect(() => Validators.validateWorkflowEdge(validEdge)).not.toThrow();
    });

    it('should accept edge with condition', () => {
      const edgeWithCondition = {
        from: 'node-1',
        to: 'node-2',
        condition: 'success'
      };

      expect(() => Validators.validateWorkflowEdge(edgeWithCondition)).not.toThrow();
    });

    it('should reject edge without required fields', () => {
      const invalidEdge = {
        from: 'node-1'
      };

      expect(() => Validators.validateWorkflowEdge(invalidEdge)).toThrow();
    });
  });

  describe('validateQuery', () => {
    it('should accept valid queries', () => {
      expect(() => Validators.validateQuery('What is the weather?')).not.toThrow();
      expect(() => Validators.validateQuery('Analyze this data')).not.toThrow();
    });

    it('should reject empty query', () => {
      expect(() => Validators.validateQuery('')).toThrow();
    });

    it('should reject query that is too short', () => {
      expect(() => Validators.validateQuery('a')).toThrow();
    });
  });

  describe('validatePlugin', () => {
    it('should accept valid plugin', () => {
      const validPlugin = {
        name: 'TestPlugin',
        version: '1.0.0',
        install: jest.fn()
      };

      expect(() => Validators.validatePlugin(validPlugin)).not.toThrow();
    });

    it('should reject plugin without name', () => {
      const invalidPlugin = {
        version: '1.0.0',
        install: jest.fn()
      };

      expect(() => Validators.validatePlugin(invalidPlugin)).toThrow();
    });

    it('should reject plugin without initialize method', () => {
      const invalidPlugin = {
        name: 'TestPlugin',
        version: '1.0.0'
      };

      expect(() => Validators.validatePlugin(invalidPlugin)).toThrow('Plugin must have an install function');
    });
  });
});