import { TriProtocol } from '../../core/src/TriProtocol';
import { LangGraphAdapter } from '../../protocols/src/langgraph/LangGraphAdapter';
import { A2AProtocol } from '../../protocols/src/a2a/A2AProtocol';
import { MCPAdapter } from '../../protocols/src/mcp/MCPAdapter';
import { WorkflowDefinition } from '../../protocols/src/langgraph/types';
import { A2ANode, MCPNode } from '../../protocols/src/langgraph/nodes';
import {
  createDataPipelineWorkflow,
  createResearchWorkflow,
  createToolChainWorkflow,
  createCollaborationWorkflow,
  createETLWorkflow
} from '../../protocols/src/langgraph/templates/WorkflowTemplates';
import { Logger } from '@tri-protocol/logger';

// Mock implementations
jest.mock('../../protocols/src/a2a/A2AProtocol');
jest.mock('../../protocols/src/mcp/MCPAdapter');

describe('LangGraph Full Integration Tests', () => {
  let triProtocol: TriProtocol;
  let langGraphAdapter: LangGraphAdapter;
  let a2aProtocol: A2AProtocol;
  let mcpAdapter: MCPAdapter;
  let logger: Logger;
  
  beforeEach(async () => {
    logger = Logger.getLogger('IntegrationTest');
    
    // Initialize mocked protocols
    a2aProtocol = new A2AProtocol({ agentId: 'test-agent' });
    mcpAdapter = new MCPAdapter({ enabled: true });
    
    // Mock A2A responses
    (a2aProtocol.sendMessage as jest.Mock) = jest.fn().mockResolvedValue({
      status: 'completed',
      data: { content: 'Agent response', result: 'success' }
    });
    
    // Mock MCP tool execution
    (mcpAdapter.executeTool as jest.Mock) = jest.fn().mockResolvedValue({
      result: 'Tool executed successfully',
      data: { output: 'test-output' }
    });
    
    // Initialize TriProtocol with all adapters
    triProtocol = new TriProtocol({
      a2a: { enabled: true },
      mcp: { enabled: true },
      langgraph: { enabled: true }
    });
    
    await triProtocol.initialize();
    
    // Initialize LangGraph with protocol integrations
    langGraphAdapter = new LangGraphAdapter();
    await langGraphAdapter.initialize({
      a2aAdapter: a2aProtocol,
      mcpAdapter: mcpAdapter
    });
  });
  
  afterEach(async () => {
    await langGraphAdapter.shutdown();
    await triProtocol.shutdown();
  });
  
  describe('Complex Workflow with All Protocols', () => {
    it('should execute workflow using A2A + MCP + LangGraph', async () => {
      // Create a complex workflow
      const workflowDef: WorkflowDefinition = {
        id: 'test-complex-workflow',
        name: 'Integration Test Workflow',
        description: 'Test workflow using all three protocols',
        stateSchema: {
          inputFile: { value: '/test/input.json' },
          processedData: { value: null },
          report: { value: null }
        },
        nodes: [
          // 1. Read file using MCP
          MCPNode.createFileReadNode('/test/input.json', {
            parseAs: 'json',
            fallbackValue: { default: 'data' },
            skipOnCircuitOpen: true
          }),
          
          // 2. Process with agent using A2A
          A2ANode.createSendMessageNode('analyst-001', {
            messageType: 'TASK_REQUEST',
            task: 'analyze-data',
            timeout: 5000
          }),
          
          // 3. Transform data using MCP
          MCPNode.createTransformNode({
            transformer: 'json-to-csv',
            inputPath: 'data',
            outputPath: 'transformed'
          }),
          
          // 4. Generate report using another agent
          A2ANode.createSendMessageNode('reporter-001', {
            messageType: 'REPORT_REQUEST',
            task: 'generate-report'
          }),
          
          // 5. Save report using MCP
          MCPNode.createFileWriteNode('/test/report.md', {
            contentFromState: 'report',
            createDirectories: true
          }),
          
          // 6. Notify stakeholders using A2A broadcast
          A2ANode.createBroadcastNode({
            messageType: 'REPORT_READY',
            waitForResponses: false
          })
        ],
        edges: [
          { from: 'mcp-filesystem-read-file', to: 'a2a-send-analyst-001' },
          { from: 'a2a-send-analyst-001', to: 'mcp-transform-json-to-csv' },
          { from: 'mcp-transform-json-to-csv', to: 'a2a-send-reporter-001' },
          { from: 'a2a-send-reporter-001', to: 'mcp-write--test-report-md' },
          { from: 'mcp-write--test-report-md', to: 'a2a-broadcast' }
        ],
        entryPoint: 'mcp-filesystem-read-file',
        config: {
          timeout: 60000,
          maxRetries: 2,
          checkpointInterval: 10000
        }
      };
      
      // Create and execute workflow
      const workflowId = await langGraphAdapter.createWorkflow(workflowDef);
      expect(workflowId).toBeDefined();
      
      const execution = await langGraphAdapter.executeWorkflow(workflowId, {
        inputFile: '/test/input.json'
      });
      
      // Verify execution
      expect(execution).toBeDefined();
      expect(execution.status).toBe('completed');
      expect(execution.state).toBeDefined();
      
      // Verify all protocols were used
      expect(mcpAdapter.executeTool).toHaveBeenCalledTimes(3); // read, transform, write
      expect(a2aProtocol.sendMessage).toHaveBeenCalledTimes(3); // 2 sends + 1 broadcast
      
      // Verify correlation IDs were tracked
      expect(execution.state.context).toHaveProperty('a2a-send-analyst-001_correlationId');
      expect(execution.state.context).toHaveProperty('a2a-send-reporter-001_correlationId');
    });
    
    it('should handle Circuit Breaker OPEN state gracefully', async () => {
      // Mock circuit breaker open error
      (mcpAdapter.executeTool as jest.Mock).mockRejectedValueOnce(
        new Error('Circuit breaker is OPEN for server: test-server')
      );
      
      const workflow: WorkflowDefinition = {
        id: 'cb-test-workflow',
        name: 'Circuit Breaker Test',
        description: 'Test circuit breaker handling',
        stateSchema: {
          data: { value: null }
        },
        nodes: [
          MCPNode.createFileReadNode('/test/data.json', {
            fallbackValue: { fallback: 'data' },
            skipOnCircuitOpen: true
          }),
          A2ANode.createSendMessageNode('processor', {
            messageType: 'PROCESS',
            task: 'process-fallback'
          })
        ],
        edges: [
          { from: 'mcp-filesystem-read-file', to: 'a2a-send-processor' }
        ],
        entryPoint: 'mcp-filesystem-read-file'
      };
      
      const workflowId = await langGraphAdapter.createWorkflow(workflow);
      const execution = await langGraphAdapter.executeWorkflow(workflowId, {});
      
      // Should complete with fallback value
      expect(execution.status).toBe('completed');
      expect(execution.state.context?.['mcp-filesystem-read-file_skipped']).toBe(true);
      expect(execution.state.context?.['mcp-filesystem-read-file_result']).toEqual({ fallback: 'data' });
      
      // A2A should still be called with fallback data
      expect(a2aProtocol.sendMessage).toHaveBeenCalled();
    });
  });
  
  describe('Workflow Templates', () => {
    it('should execute data pipeline workflow template', async () => {
      const workflow = createDataPipelineWorkflow({
        dataSource: '/data/input.json',
        processorAgent: 'data-processor',
        outputPath: '/data/output.json',
        notifyAgents: ['monitor-1', 'monitor-2'],
        transformations: [
          { type: 'normalize', config: { schema: 'v2' } }
        ]
      });
      
      const workflowId = await langGraphAdapter.createWorkflow(workflow);
      const execution = await langGraphAdapter.executeWorkflow(workflowId, {});
      
      expect(execution.status).toBe('completed');
      expect(mcpAdapter.executeTool).toHaveBeenCalled();
      expect(a2aProtocol.sendMessage).toHaveBeenCalled();
    });
    
    it('should execute research workflow template', async () => {
      const workflow = createResearchWorkflow({
        topic: 'AI Safety',
        researchAgents: ['researcher-1', 'researcher-2', 'researcher-3'],
        reportFormat: 'markdown',
        saveReport: true,
        requireConsensus: true
      });
      
      const workflowId = await langGraphAdapter.createWorkflow(workflow);
      const execution = await langGraphAdapter.executeWorkflow(workflowId, {});
      
      expect(execution.status).toBe('completed');
      expect(execution.state).toHaveProperty('report');
    });
    
    it('should execute tool chain workflow template', async () => {
      const workflow = createToolChainWorkflow({
        tools: [
          { name: 'fetch:api', args: { url: 'https://api.test.com' } },
          { name: 'transform:json', args: { format: 'csv' } },
          { name: 'save:file', args: { path: '/output.csv' } }
        ],
        parallel: false
      });
      
      const workflowId = await langGraphAdapter.createWorkflow(workflow);
      const execution = await langGraphAdapter.executeWorkflow(workflowId, {});
      
      expect(execution.status).toBe('completed');
      expect(mcpAdapter.executeTool).toHaveBeenCalledTimes(3);
    });
    
    it('should execute collaboration workflow template', async () => {
      const workflow = createCollaborationWorkflow({
        task: 'Analyze market trends',
        coordinatorAgent: 'coordinator',
        workerAgents: ['analyst-1', 'analyst-2', 'analyst-3'],
        requireApproval: false,
        maxIterations: 2
      });
      
      const workflowId = await langGraphAdapter.createWorkflow(workflow);
      const execution = await langGraphAdapter.executeWorkflow(workflowId, {});
      
      expect(execution.status).toBe('completed');
      // Coordinator called twice (decompose + review)
      // Plus delegation and aggregation
      expect(a2aProtocol.sendMessage).toHaveBeenCalled();
    });
    
    it('should execute ETL workflow template', async () => {
      const workflow = createETLWorkflow({
        sources: ['/data/source1.json', '/data/source2.json'],
        transformations: [
          { type: 'merge', config: { key: 'id' } },
          { type: 'filter', config: { field: 'active', value: true } }
        ],
        destination: '/data/merged.json',
        validationRules: [
          (data) => data != null,
          (data) => Array.isArray(data) || typeof data === 'object'
        ],
        notifyOnComplete: ['etl-monitor']
      });
      
      const workflowId = await langGraphAdapter.createWorkflow(workflow);
      const execution = await langGraphAdapter.executeWorkflow(workflowId, {});
      
      expect(execution.status).toBe('completed');
      expect(mcpAdapter.executeTool).toHaveBeenCalled();
    });
  });
  
  describe('Error Handling and Recovery', () => {
    it('should retry failed nodes according to retry policy', async () => {
      let attemptCount = 0;
      (mcpAdapter.executeTool as jest.Mock).mockImplementation(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary failure');
        }
        return { result: 'success' };
      });
      
      const workflow: WorkflowDefinition = {
        id: 'retry-test',
        name: 'Retry Test',
        description: 'Test retry policy',
        stateSchema: { data: { value: null } },
        nodes: [
          MCPNode.createToolNode('test-tool', { arg: 'value' }, {
            retryOnFailure: true
          })
        ],
        edges: [],
        entryPoint: 'mcp-test-tool'
      };
      
      const workflowId = await langGraphAdapter.createWorkflow(workflow);
      const execution = await langGraphAdapter.executeWorkflow(workflowId, {});
      
      expect(execution.status).toBe('completed');
      expect(attemptCount).toBe(3); // Failed twice, succeeded on third
    });
    
    it('should handle async A2A responses with correlation tracking', async () => {
      // Mock async response
      (a2aProtocol.sendMessage as jest.Mock).mockResolvedValueOnce({
        status: 'pending',
        correlationId: 'test-correlation-123',
        data: null
      });
      
      const workflow: WorkflowDefinition = {
        id: 'async-test',
        name: 'Async A2A Test',
        description: 'Test async message handling',
        stateSchema: { message: { value: 'test' } },
        nodes: [
          A2ANode.createSendMessageNode('async-agent', {
            messageType: 'ASYNC_TASK'
          })
        ],
        edges: [],
        entryPoint: 'a2a-send-async-agent'
      };
      
      const workflowId = await langGraphAdapter.createWorkflow(workflow);
      const execution = await langGraphAdapter.executeWorkflow(workflowId, {});
      
      // Check correlation ID was tracked
      expect(execution.state.context?.pendingA2AMessages).toBeDefined();
      expect(execution.state.context?.['a2a-send-async-agent_correlationId']).toBe('test-correlation-123');
    });
  });
  
  describe('Performance and Monitoring', () => {
    it('should track execution metrics', async () => {
      const workflow: WorkflowDefinition = {
        id: 'metrics-test',
        name: 'Metrics Test',
        description: 'Test metrics collection',
        stateSchema: { data: { value: null } },
        nodes: [
          MCPNode.createToolNode('tool1', {}),
          A2ANode.createSendMessageNode('agent1'),
          MCPNode.createToolNode('tool2', {})
        ],
        edges: [
          { from: 'mcp-tool1', to: 'a2a-send-agent1' },
          { from: 'a2a-send-agent1', to: 'mcp-tool2' }
        ],
        entryPoint: 'mcp-tool1'
      };
      
      const workflowId = await langGraphAdapter.createWorkflow(workflow);
      const execution = await langGraphAdapter.executeWorkflow(workflowId, {});
      
      // Check metrics
      expect(execution.metrics).toBeDefined();
      expect(execution.metrics.nodesExecuted).toBe(3);
      expect(execution.metrics.executionTime).toBeGreaterThan(0);
      
      // Check execution history
      expect(execution.state.history).toHaveLength(3);
      expect(execution.state.history![0].nodeId).toBe('mcp-tool1');
      expect(execution.state.history![1].nodeId).toBe('a2a-send-agent1');
      expect(execution.state.history![2].nodeId).toBe('mcp-tool2');
    });
    
    it('should emit events for monitoring', async () => {
      const events: any[] = [];
      
      langGraphAdapter.on('workflow:started', (event) => events.push(event));
      langGraphAdapter.on('node:executed', (event) => events.push(event));
      langGraphAdapter.on('workflow:completed', (event) => events.push(event));
      
      const workflow: WorkflowDefinition = {
        id: 'events-test',
        name: 'Events Test',
        description: 'Test event emission',
        stateSchema: { data: { value: null } },
        nodes: [
          MCPNode.createToolNode('test-tool', {})
        ],
        edges: [],
        entryPoint: 'mcp-test-tool'
      };
      
      const workflowId = await langGraphAdapter.createWorkflow(workflow);
      await langGraphAdapter.executeWorkflow(workflowId, {});
      
      // Check events were emitted
      expect(events.some(e => e.type === 'workflow:started')).toBe(true);
      expect(events.some(e => e.type === 'node:executed')).toBe(true);
      expect(events.some(e => e.type === 'workflow:completed')).toBe(true);
    });
  });
  
  describe('Conditional Routing', () => {
    it('should follow conditional routes based on state', async () => {
      const workflow: WorkflowDefinition = {
        id: 'conditional-test',
        name: 'Conditional Test',
        description: 'Test conditional routing',
        stateSchema: {
          score: { value: 0 }
        },
        nodes: [
          {
            id: 'calculate-score',
            type: 'custom',
            name: 'Calculate Score',
            function: async (state) => ({
              ...state,
              score: 75
            })
          },
          {
            id: 'high-score-path',
            type: 'custom',
            name: 'High Score Path',
            function: async (state) => ({
              ...state,
              result: 'excellent'
            })
          },
          {
            id: 'low-score-path',
            type: 'custom',
            name: 'Low Score Path',
            function: async (state) => ({
              ...state,
              result: 'needs-improvement'
            })
          }
        ],
        edges: [
          { from: 'calculate-score', to: 'high-score-path' }
        ],
        conditionalRouting: [
          {
            source: 'calculate-score',
            conditions: [
              {
                condition: (state) => state.score >= 70,
                target: 'high-score-path'
              },
              {
                condition: (state) => state.score < 70,
                target: 'low-score-path'
              }
            ],
            default: 'low-score-path'
          }
        ],
        entryPoint: 'calculate-score'
      };
      
      const workflowId = await langGraphAdapter.createWorkflow(workflow);
      const execution = await langGraphAdapter.executeWorkflow(workflowId, {});
      
      expect(execution.status).toBe('completed');
      expect(execution.state.result).toBe('excellent');
      expect(execution.state.score).toBe(75);
    });
  });
});