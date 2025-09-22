/**
 * Unit tests for Serializers
 */

import { Serializers } from '../../../../sdk/src/utils/Serializers';
import * as zlib from 'zlib';

// Mock zlib
jest.mock('zlib', () => ({
  gzipSync: jest.fn((data) => Buffer.from('compressed:' + data)),
  gunzipSync: jest.fn((data) => Buffer.from(data.toString().replace('compressed:', '')))
}));

describe('Serializers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('serializeAgent', () => {
    it('should serialize agent to JSON string', () => {
      const agent = {
        id: 'agent-123',
        name: 'TestAgent',
        description: 'Test Description',
        capabilities: ['cap1', 'cap2'],
        tools: ['tool1'],
        memory: { enabled: true, type: 'both' as const }
      };

      const result = Serializers.serializeAgent(agent);

      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result);
      expect(parsed.id).toBe('agent-123');
      expect(parsed.name).toBe('TestAgent');
      expect(parsed.capabilities).toEqual(['cap1', 'cap2']);
    });

    it('should handle agent with minimal fields', () => {
      const agent = {
        id: 'agent-456',
        name: 'MinimalAgent'
      };

      const result = Serializers.serializeAgent(agent as any);
      const parsed = JSON.parse(result);

      expect(parsed.id).toBe('agent-456');
      expect(parsed.name).toBe('MinimalAgent');
      expect(parsed.capabilities).toBeUndefined();
    });

    it('should handle null or undefined', () => {
      expect(() => Serializers.serializeAgent(null as any)).toThrow();
      expect(() => Serializers.serializeAgent(undefined as any)).toThrow();
    });
  });

  describe('deserializeAgent', () => {
    it('should deserialize JSON string to agent', () => {
      const json = JSON.stringify({
        id: 'agent-123',
        name: 'TestAgent',
        description: 'Test Description',
        capabilities: ['cap1', 'cap2'],
        tools: ['tool1'],
        memory: { enabled: true, type: 'both' }
      });

      const result = Serializers.deserializeAgent(json);

      expect(result.id).toBe('agent-123');
      expect(result.name).toBe('TestAgent');
      expect(result.description).toBe('Test Description');
      expect(result.capabilities).toEqual(['cap1', 'cap2']);
      expect(result.tools).toEqual(['tool1']);
      expect(result.memory).toEqual({ enabled: true, type: 'both' });
    });

    it('should handle invalid JSON', () => {
      expect(() => Serializers.deserializeAgent('invalid json')).toThrow();
      expect(() => Serializers.deserializeAgent('')).toThrow();
    });
  });

  describe('serializeWorkflow', () => {
    it('should serialize workflow to JSON string', () => {
      const workflow = {
        id: 'wf-123',
        name: 'TestWorkflow',
        description: 'Test Workflow',
        nodes: [
          { id: 'node1', type: 'task', name: 'Task 1' },
          { id: 'node2', type: 'task', name: 'Task 2' }
        ],
        edges: [
          { from: 'node1', to: 'node2' }
        ]
      };

      const result = Serializers.serializeWorkflow(workflow);

      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result);
      expect(parsed.id).toBe('wf-123');
      expect(parsed.name).toBe('TestWorkflow');
      expect(parsed.nodes).toHaveLength(2);
      expect(parsed.edges).toHaveLength(1);
    });

    it('should handle workflow with minimal fields', () => {
      const workflow = {
        id: 'wf-456',
        name: 'MinimalWorkflow'
      };

      const result = Serializers.serializeWorkflow(workflow as any);
      const parsed = JSON.parse(result);

      expect(parsed.id).toBe('wf-456');
      expect(parsed.name).toBe('MinimalWorkflow');
    });
  });

  describe('deserializeWorkflow', () => {
    it('should deserialize JSON string to workflow', () => {
      const json = JSON.stringify({
        id: 'wf-123',
        name: 'TestWorkflow',
        description: 'Test Workflow',
        nodes: [
          { id: 'node1', type: 'task', name: 'Task 1' },
          { id: 'node2', type: 'task', name: 'Task 2' }
        ],
        edges: [
          { from: 'node1', to: 'node2' }
        ]
      });

      const result = Serializers.deserializeWorkflow(json);

      expect(result.id).toBe('wf-123');
      expect(result.name).toBe('TestWorkflow');
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
    });

    it('should handle invalid JSON', () => {
      expect(() => Serializers.deserializeWorkflow('invalid json')).toThrow();
    });
  });

  describe('agentToYAML', () => {
    it('should convert agent to YAML format', () => {
      const agent = {
        id: 'agent-123',
        name: 'TestAgent',
        description: 'Test Description',
        capabilities: ['cap1', 'cap2'],
        tools: ['tool1', 'tool2']
      };

      const result = Serializers.agentToYAML(agent);

      expect(result).toContain('id: agent-123');
      expect(result).toContain('name: TestAgent');
      expect(result).toContain('description: Test Description');
      expect(result).toContain('capabilities:');
      expect(result).toContain('  - cap1');
      expect(result).toContain('  - cap2');
      expect(result).toContain('tools:');
      expect(result).toContain('  - tool1');
      expect(result).toContain('  - tool2');
    });

    it('should handle agent with no arrays', () => {
      const agent = {
        id: 'agent-456',
        name: 'SimpleAgent',
        description: 'Simple'
      };

      const result = Serializers.agentToYAML(agent as any);

      expect(result).toContain('id: agent-456');
      expect(result).toContain('name: SimpleAgent');
      expect(result).not.toContain('capabilities:');
      expect(result).not.toContain('tools:');
    });

    it('should escape special characters in strings', () => {
      const agent = {
        id: 'agent-789',
        name: 'Agent: Special',
        description: 'Description with "quotes"'
      };

      const result = Serializers.agentToYAML(agent as any);

      expect(result).toContain('name: "Agent: Special"');
      expect(result).toContain('description: "Description with \\"quotes\\""');
    });
  });

  describe('serializeConfig', () => {
    it('should serialize config to JSON string', () => {
      const config = {
        mode: 'development',
        baseURL: 'http://localhost:3000',
        timeout: 5000
      };

      const result = Serializers.serializeConfig(config);

      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result);
      expect(parsed.mode).toBe('development');
      expect(parsed.baseURL).toBe('http://localhost:3000');
      expect(parsed.timeout).toBe(5000);
    });
  });

  describe('workflowToMermaid', () => {
    it('should generate Mermaid diagram for workflow', () => {
      const workflow = {
        id: 'wf-123',
        name: 'TestWorkflow',
        nodes: [
          { id: 'node1', type: 'task', config: { name: 'Task 1' } },
          { id: 'node2', type: 'task', config: { name: 'Task 2' } },
          { id: 'node3', type: 'task', config: { name: 'Task 3' } }
        ],
        edges: [
          { from: 'node1', to: 'node2' },
          { from: 'node2', to: 'node3' }
        ]
      };

      const result = Serializers.workflowToMermaid(workflow);

      expect(result).toContain('graph TD');
      expect(result).toContain('node1[Task 1]');
      expect(result).toContain('node2[Task 2]');
      expect(result).toContain('node3[Task 3]');
      expect(result).toContain('node1 --> node2');
      expect(result).toContain('node2 --> node3');
    });

    it('should handle workflow with no edges', () => {
      const workflow = {
        id: 'wf-456',
        name: 'DisconnectedWorkflow',
        nodes: [
          { id: 'node1', type: 'task', config: { name: 'Task 1' } },
          { id: 'node2', type: 'task', config: { name: 'Task 2' } }
        ],
        edges: []
      };

      const result = Serializers.workflowToMermaid(workflow as any);

      expect(result).toContain('graph TD');
      expect(result).toContain('node1[Task 1]');
      expect(result).toContain('node2[Task 2]');
      expect(result).not.toContain('-->');
    });

    it('should handle workflow with no nodes', () => {
      const workflow = {
        id: 'wf-789',
        name: 'EmptyWorkflow'
      };

      const result = Serializers.workflowToMermaid(workflow as any);

      expect(result).toContain('graph TD');
      expect(result).not.toContain('[');
    });

    it('should escape special characters in node names', () => {
      const workflow = {
        id: 'wf-special',
        name: 'SpecialWorkflow',
        nodes: [
          { id: 'node1', type: 'task', config: { name: 'Task [1]' } },
          { id: 'node2', type: 'task', config: { name: 'Task (2)' } }
        ],
        edges: []
      };

      const result = Serializers.workflowToMermaid(workflow as any);

      expect(result).toContain('node1[Task \\[1\\]]');
      expect(result).toContain('node2[Task \\(2\\)]');
    });
  });

  describe('compress and decompress', () => {
    it('should compress and decompress data', () => {
      const originalData = 'This is test data to be compressed';

      const compressed = Serializers.compress(originalData);
      expect(compressed).toContain('compressed:');

      const decompressed = Serializers.decompress(compressed);
      expect(decompressed).toBe(originalData);
    });

    it('should handle large data', () => {
      const largeData = 'x'.repeat(10000);

      const compressed = Serializers.compress(largeData);
      const decompressed = Serializers.decompress(compressed);

      expect(decompressed).toBe(largeData);
    });

    it('should handle empty string', () => {
      const compressed = Serializers.compress('');
      const decompressed = Serializers.decompress(compressed);

      expect(decompressed).toBe('');
    });

    it('should handle special characters', () => {
      const specialData = '🚀 Special © chars ñ';

      const compressed = Serializers.compress(specialData);
      const decompressed = Serializers.decompress(compressed);

      expect(decompressed).toBe(specialData);
    });
  });

  describe('sanitize', () => {
    it('should remove HTML tags', () => {
      const input = '<script>alert("xss")</script>Hello World';
      const result = Serializers.sanitize(input);

      expect(result).toBe('Hello World');
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('</script>');
    });

    it('should remove multiple HTML tags', () => {
      const input = '<div><span>Hello</span> <b>World</b></div>';
      const result = Serializers.sanitize(input);

      expect(result).toBe('Hello World');
    });

    it('should handle nested tags', () => {
      const input = '<div><p><a href="test">Link</a></p></div>';
      const result = Serializers.sanitize(input);

      expect(result).toBe('Link');
    });

    it('should preserve text without tags', () => {
      const input = 'Plain text without any HTML';
      const result = Serializers.sanitize(input);

      expect(result).toBe(input);
    });

    it('should handle self-closing tags', () => {
      const input = 'Text<br/>More text<img src="test"/>End';
      const result = Serializers.sanitize(input);

      expect(result).toBe('TextMore textEnd');
    });

    it('should handle attributes', () => {
      const input = '<a href="javascript:alert(1)" onclick="alert(2)">Click</a>';
      const result = Serializers.sanitize(input);

      expect(result).toBe('Click');
    });
  });

  describe('bundleAgents', () => {
    it('should bundle multiple agents', () => {
      const agents = [
        { id: 'agent-1', name: 'Agent1' },
        { id: 'agent-2', name: 'Agent2' }
      ];

      const result = Serializers.bundleAgents(agents);

      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result);
      expect(parsed.agents).toHaveLength(2);
      expect(parsed.agents[0].name).toBe('Agent1');
    });
  });

  describe('bundleWorkflows', () => {
    it('should bundle multiple workflows', () => {
      const workflows = [
        { id: 'wf-1', name: 'Workflow1' },
        { id: 'wf-2', name: 'Workflow2' }
      ];

      const result = Serializers.bundleWorkflows(workflows);

      expect(typeof result).toBe('string');
      const parsed = JSON.parse(result);
      expect(parsed.workflows).toHaveLength(2);
      expect(parsed.workflows[0].name).toBe('Workflow1');
    });
  });
});