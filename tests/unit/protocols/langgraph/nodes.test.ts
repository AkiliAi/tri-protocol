import { A2ANode, MCPNode } from '../../../../protocols/src/langgraph/nodes';
import { WorkflowState } from '../../../../protocols/src/langgraph/types';

describe('Workflow Nodes', () => {
  describe('A2ANode', () => {
    describe('createSendMessageNode', () => {
      it('should create a send message node', () => {
        const node = A2ANode.createSendMessageNode('agent-123', {
          messageType: 'REQUEST',
          task: 'process-data',
          timeout: 5000
        });

        expect(node.id).toBe('a2a-send-agent-123');
        expect(node.type).toBe('agent');
        expect(node.name).toBe('Send to agent-123');
        expect(node.timeout).toBe(5000);
        expect(node.metadata?.agentId).toBe('agent-123');
        expect(node.metadata?.messageType).toBe('REQUEST');
      });

      it('should extract message from state', async () => {
        const node = A2ANode.createSendMessageNode('agent-123');
        const state: WorkflowState = {
          messages: [{ content: 'Test message' }],
          context: {}
        };

        const result = await node.function(state);
        
        expect(result.context?.pendingAgentCall).toEqual({
          agentId: 'agent-123',
          message: 'Test message',
          task: undefined,
          messageType: 'TASK_REQUEST'
        });
      });
    });

    describe('createBroadcastNode', () => {
      it('should create a broadcast node', () => {
        const node = A2ANode.createBroadcastNode({
          messageType: 'NOTIFICATION',
          filterByCapability: 'data-processing',
          waitForResponses: true,
          timeout: 10000
        });

        expect(node.id).toBe('a2a-broadcast');
        expect(node.type).toBe('agent');
        expect(node.metadata?.broadcast).toBe(true);
        expect(node.metadata?.filterByCapability).toBe('data-processing');
      });
    });

    describe('createDiscoveryNode', () => {
      it('should create a discovery node', () => {
        const node = A2ANode.createDiscoveryNode({
          capability: 'analysis',
          skill: 'machine-learning',
          maxAgents: 5
        });

        expect(node.id).toBe('a2a-discovery');
        expect(node.metadata?.discovery).toBe(true);
        expect(node.metadata?.capability).toBe('analysis');
        expect(node.metadata?.maxAgents).toBe(5);
      });
    });

    describe('createWaitForResponseNode', () => {
      it('should create a wait for response node with retry', () => {
        const node = A2ANode.createWaitForResponseNode('agent-456', {
          timeout: 30000,
          retryOnTimeout: true
        });

        expect(node.id).toBe('a2a-wait-agent-456');
        expect(node.timeout).toBe(30000);
        expect(node.retryPolicy).toBeDefined();
        expect(node.retryPolicy?.maxAttempts).toBe(3);
        expect(node.retryPolicy?.backoffStrategy).toBe('exponential');
      });
    });

    describe('createDelegationNode', () => {
      it('should create a delegation node', () => {
        const node = A2ANode.createDelegationNode({
          taskType: 'analysis',
          requiredCapabilities: ['ml', 'statistics'],
          maxAgents: 3,
          parallel: true
        });

        expect(node.id).toBe('a2a-delegate-analysis');
        expect(node.metadata?.delegation).toBe(true);
        expect(node.metadata?.parallel).toBe(true);
        expect(node.metadata?.requiredCapabilities).toEqual(['ml', 'statistics']);
      });
    });

    describe('createAggregationNode', () => {
      it('should create an aggregation node', async () => {
        const node = A2ANode.createAggregationNode(
          ['agent-1', 'agent-2', 'agent-3'],
          { aggregationType: 'majority' }
        );

        const state: WorkflowState = {
          context: {
            agent_agent_1_response: { result: 'A' },
            agent_agent_2_response: { result: 'B' },
            agent_agent_3_response: { result: 'A' }
          }
        };

        const result = await node.function(state);
        
        expect(result.context?.aggregationMetadata).toBeDefined();
        expect(result.context?.aggregationMetadata.totalResponses).toBe(3);
      });
    });

    describe('createNegotiationNode', () => {
      it('should create a negotiation node', () => {
        const node = A2ANode.createNegotiationNode({
          topic: 'resource-allocation',
          participants: ['agent-1', 'agent-2'],
          maxRounds: 5,
          consensusThreshold: 0.8
        });

        expect(node.id).toBe('a2a-negotiate-resource-allocation');
        expect(node.metadata?.negotiation).toBe(true);
        expect(node.metadata?.participants).toEqual(['agent-1', 'agent-2']);
      });

      it('should increment negotiation round', async () => {
        const node = A2ANode.createNegotiationNode({
          topic: 'test',
          participants: ['agent-1']
        });

        const state: WorkflowState = {
          context: { negotiationRound: 2 }
        };

        const result = await node.function(state);
        expect(result.context?.negotiation.currentRound).toBe(3);
      });
    });

    describe('createLoadBalancerNode', () => {
      it('should balance with round-robin strategy', async () => {
        const node = A2ANode.createLoadBalancerNode({
          agentPool: ['agent-1', 'agent-2', 'agent-3'],
          strategy: 'round-robin'
        });

        // First execution
        const result1 = await node.function({ context: {} });
        expect(result1.context?.selectedAgent).toBe('agent-1');

        // Second execution
        const result2 = await node.function(result1 as WorkflowState);
        expect(result2.context?.selectedAgent).toBe('agent-2');

        // Third execution
        const result3 = await node.function(result2 as WorkflowState);
        expect(result3.context?.selectedAgent).toBe('agent-3');

        // Fourth execution (should wrap around)
        const result4 = await node.function(result3 as WorkflowState);
        expect(result4.context?.selectedAgent).toBe('agent-1');
      });

      it('should balance with random strategy', async () => {
        const node = A2ANode.createLoadBalancerNode({
          agentPool: ['agent-1', 'agent-2'],
          strategy: 'random'
        });

        const result = await node.function({ context: {} });
        expect(['agent-1', 'agent-2']).toContain(result.context?.selectedAgent);
      });
    });
  });

  describe('MCPNode', () => {
    describe('createToolNode', () => {
      it('should create a tool node', () => {
        const node = MCPNode.createToolNode('database:query', {
          query: 'SELECT * FROM users',
          connection: 'main'
        }, {
          timeout: 30000,
          retryOnFailure: true
        });

        expect(node.id).toBe('mcp-database-query');
        expect(node.type).toBe('tool');
        expect(node.timeout).toBe(30000);
        expect(node.retryPolicy).toBeDefined();
        expect(node.metadata?.tool).toBe('database:query');
      });

      it('should extract tool args from state', async () => {
        const node = MCPNode.createToolNode('test-tool');
        const state: WorkflowState = {
          context: {
            toolArgs: {
              'test-tool': { param: 'value' }
            }
          }
        };

        const result = await node.function(state);
        expect(result.context?.toolExecution.args).toEqual({ param: 'value' });
      });
    });

    describe('createFileReadNode', () => {
      it('should create a file read node', () => {
        const node = MCPNode.createFileReadNode('/path/to/file.json', {
          encoding: 'utf-8',
          parseAs: 'json'
        });

        expect(node.id).toBe('mcp-filesystem-read-file');
        expect(node.metadata?.tool).toBe('filesystem:read_file');
      });
    });

    describe('createFileWriteNode', () => {
      it('should create a file write node with static content', () => {
        const node = MCPNode.createFileWriteNode('/output/file.txt', {
          content: 'Hello World',
          encoding: 'utf-8',
          createDirectories: true
        });

        expect(node.id).toContain('mcp-write');
        expect(node.metadata?.tool).toBe('filesystem:write_file');
      });

      it('should extract content from state', async () => {
        const node = MCPNode.createFileWriteNode('/output/file.txt', {
          contentFromState: 'data.output'
        });

        const state: WorkflowState = {
          data: {
            output: 'Dynamic content'
          }
        };

        const result = await node.function(state);
        expect(result.context?.toolExecution.args.content).toBe('Dynamic content');
      });
    });

    describe('createWebSearchNode', () => {
      it('should create a web search node', () => {
        const node = MCPNode.createWebSearchNode({
          query: 'TypeScript best practices',
          maxResults: 20
        });

        expect(node.id).toBe('mcp-web-search');
        expect(node.metadata?.tool).toBe('web:search');
      });

      it('should extract query from state', async () => {
        const node = MCPNode.createWebSearchNode({
          queryFromState: 'searchQuery',
          maxResults: 10
        });

        const state: WorkflowState = {
          searchQuery: 'Dynamic search'
        };

        const result = await node.function(state);
        expect(result.context?.toolExecution.args.query).toBe('Dynamic search');
      });
    });

    describe('createAPICallNode', () => {
      it('should create an API call node', () => {
        const node = MCPNode.createAPICallNode({
          endpoint: 'https://api.example.com/data',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: { key: 'value' },
          auth: {
            type: 'bearer',
            credentials: 'token-123'
          }
        });

        expect(node.id).toContain('mcp-api-POST');
        expect(node.metadata?.method).toBe('POST');
      });
    });

    describe('createTransformNode', () => {
      it('should create a transform node', () => {
        const node = MCPNode.createTransformNode({
          transformer: 'json-to-csv',
          inputPath: 'data.json',
          outputPath: 'data.csv',
          config: { delimiter: ',' }
        });

        expect(node.id).toBe('mcp-transform-json-to-csv');
        expect(node.metadata?.transformer).toBe('json-to-csv');
      });
    });

    describe('createCacheNode', () => {
      it('should create a cache get node', () => {
        const node = MCPNode.createCacheNode({
          operation: 'get',
          key: 'user:123'
        });

        expect(node.id).toBe('mcp-cache-get');
        expect(node.metadata?.operation).toBe('get');
      });

      it('should create a cache set node with TTL', () => {
        const node = MCPNode.createCacheNode({
          operation: 'set',
          key: 'session:456',
          value: { user: 'john' },
          ttl: 3600
        });

        expect(node.id).toBe('mcp-cache-set');
        expect(node.metadata?.operation).toBe('set');
      });
    });

    describe('createShellCommandNode', () => {
      it('should create a shell command node', () => {
        const node = MCPNode.createShellCommandNode({
          command: 'npm',
          args: ['test'],
          cwd: '/project',
          timeout: 60000
        });

        expect(node.metadata?.tool).toBe('shell:execute');
        expect(node.timeout).toBe(60000);
      });
    });

    describe('createParallelToolsNode', () => {
      it('should create a parallel tools node', () => {
        const node = MCPNode.createParallelToolsNode([
          { tool: 'tool1', args: { a: 1 }, id: 't1' },
          { tool: 'tool2', args: { b: 2 }, id: 't2' }
        ]);

        expect(node.id).toBe('mcp-parallel-tools');
        expect(node.metadata?.parallel).toBe(true);
        expect(node.metadata?.tools).toHaveLength(2);
      });
    });

    describe('createToolChainNode', () => {
      it('should create a tool chain node', () => {
        const node = MCPNode.createToolChainNode([
          { tool: 'read', args: { file: 'input.txt' } },
          { tool: 'transform', args: { type: 'uppercase' } },
          { tool: 'write', args: { file: 'output.txt' } }
        ]);

        expect(node.id).toBe('mcp-tool-chain');
        expect(node.metadata?.toolChain).toBe(true);
        expect(node.metadata?.tools).toHaveLength(3);
      });
    });
  });
});