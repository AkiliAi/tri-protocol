import { LangGraphAdapter } from '../../../../protocols/src/langgraph/LangGraphAdapter';
import { 
  WorkflowDefinition, 
  WorkflowState, 
  NodeExecutionError,
  WorkflowError
} from '../../../../protocols/src/langgraph/types';
import { HumanMessage } from '@langchain/core/messages';

describe('LangGraphAdapter', () => {
  let adapter: LangGraphAdapter;
  let mockA2AAdapter: any;
  let mockMCPAdapter: any;

  beforeEach(() => {
    // Create mock adapters
    mockA2AAdapter = {
      sendMessage: jest.fn().mockResolvedValue({ 
        data: { content: 'Agent response', agentId: 'test-agent' } 
      }),
      findAgentsByCapability: jest.fn().mockResolvedValue(['agent-1', 'agent-2'])
    };

    mockMCPAdapter = {
      executeTool: jest.fn().mockResolvedValue({ result: 'Tool executed' }),
      listTools: jest.fn().mockResolvedValue(['tool1', 'tool2'])
    };

    adapter = new LangGraphAdapter();
  });

  afterEach(async () => {
    await adapter.shutdown();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', async () => {
      await adapter.initialize({});
      expect(adapter.protocolId).toBe('langgraph');
      expect(adapter.version).toBe('1.0.0');
    });

    it('should initialize with A2A and MCP adapters', async () => {
      await adapter.initialize({
        a2aAdapter: mockA2AAdapter,
        mcpAdapter: mockMCPAdapter
      });

      // Should emit ready event
      const readyHandler = jest.fn();
      adapter.on('adapter:ready', readyHandler);
      await adapter.initialize({});
      
      expect(readyHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Workflow Creation', () => {
    const simpleWorkflow: WorkflowDefinition = {
      id: 'test-workflow',
      name: 'Test Workflow',
      description: 'A simple test workflow',
      stateSchema: {
        input: { value: null },
        output: { value: null }
      },
      nodes: [
        {
          id: 'start',
          type: 'custom',
          name: 'Start Node',
          function: async (state) => ({ ...state, started: true })
        },
        {
          id: 'end',
          type: 'custom',
          name: 'End Node',
          function: async (state) => ({ ...state, completed: true })
        }
      ],
      edges: [
        { from: 'start', to: 'end' }
      ],
      entryPoint: 'start'
    };

    it('should create a workflow successfully', async () => {
      await adapter.initialize({});
      const workflowId = await adapter.createWorkflow(simpleWorkflow);
      
      expect(workflowId).toBeTruthy();
      expect(adapter.listWorkflows()).toHaveLength(1);
      expect(adapter.getWorkflow(workflowId)).toEqual(simpleWorkflow);
    });

    it('should generate an ID if not provided', async () => {
      await adapter.initialize({});
      const workflowWithoutId = { ...simpleWorkflow, id: undefined };
      const workflowId = await adapter.createWorkflow(workflowWithoutId as any);
      
      expect(workflowId).toBeTruthy();
      expect(workflowId).toMatch(/^[a-f0-9-]+$/);
    });

    it('should emit workflow:created event', async () => {
      await adapter.initialize({});
      const createdHandler = jest.fn();
      adapter.on('workflow:created', createdHandler);
      
      const workflowId = await adapter.createWorkflow(simpleWorkflow);
      
      expect(createdHandler).toHaveBeenCalledWith({
        workflowId,
        name: 'Test Workflow'
      });
    });
  });

  describe('Workflow Execution', () => {
    const testWorkflow: WorkflowDefinition = {
      id: 'exec-test',
      name: 'Execution Test',
      description: 'Test workflow execution',
      stateSchema: {
        counter: { value: 0, default: 0 },
        messages: { value: [], default: [] }
      },
      nodes: [
        {
          id: 'increment',
          type: 'custom',
          name: 'Increment Counter',
          function: async (state) => ({
            ...state,
            counter: (state.counter || 0) + 1
          })
        }
      ],
      edges: [],
      entryPoint: 'increment'
    };

    it('should execute a workflow successfully', async () => {
      await adapter.initialize({});
      const workflowId = await adapter.createWorkflow(testWorkflow);
      
      const execution = await adapter.executeWorkflow(workflowId, { counter: 0 });
      
      expect(execution.status).toBe('completed');
      expect(execution.workflowId).toBe(workflowId);
      expect(execution.state.counter).toBe(1);
    });

    it('should handle workflow not found error', async () => {
      await adapter.initialize({});
      
      await expect(
        adapter.executeWorkflow('non-existent', {})
      ).rejects.toThrow(WorkflowError);
    });

    it('should support timeout configuration', async () => {
      await adapter.initialize({});
      
      const slowWorkflow: WorkflowDefinition = {
        ...testWorkflow,
        nodes: [{
          id: 'slow',
          type: 'custom',
          name: 'Slow Node',
          function: async () => {
            await new Promise(resolve => setTimeout(resolve, 200));
            return {};
          }
        }],
        entryPoint: 'slow'
      };
      
      const workflowId = await adapter.createWorkflow(slowWorkflow);
      
      // Execute with short timeout
      const execution = adapter.executeWorkflow(workflowId, {}, { timeout: 100 });
      
      // Should eventually timeout
      await expect(execution).rejects.toThrow();
    });

    it('should emit workflow events', async () => {
      await adapter.initialize({});
      const workflowId = await adapter.createWorkflow(testWorkflow);
      
      const startedHandler = jest.fn();
      const completedHandler = jest.fn();
      const nodeExecutedHandler = jest.fn();
      
      adapter.on('workflow:started', startedHandler);
      adapter.on('workflow:completed', completedHandler);
      adapter.on('node:executed', nodeExecutedHandler);
      
      await adapter.executeWorkflow(workflowId, {});
      
      expect(startedHandler).toHaveBeenCalled();
      expect(completedHandler).toHaveBeenCalled();
      expect(nodeExecutedHandler).toHaveBeenCalled();
    });
  });

  describe('Node Types', () => {
    beforeEach(async () => {
      await adapter.initialize({
        a2aAdapter: mockA2AAdapter,
        mcpAdapter: mockMCPAdapter
      });
    });

    it('should execute agent node with A2A integration', async () => {
      const workflow: WorkflowDefinition = {
        id: 'agent-test',
        name: 'Agent Test',
        description: 'Test agent node',
        stateSchema: {
          messages: { value: [], default: [] }
        },
        nodes: [{
          id: 'agent-node',
          type: 'agent',
          name: 'Agent Node',
          function: async (state) => state,
          metadata: { agentId: 'test-agent', task: 'test-task' }
        }],
        edges: [],
        entryPoint: 'agent-node'
      };
      
      const workflowId = await adapter.createWorkflow(workflow);
      const execution = await adapter.executeWorkflow(workflowId, {});
      
      expect(mockA2AAdapter.sendMessage).toHaveBeenCalledWith({
        to: 'test-agent',
        type: 'TASK_REQUEST',
        payload: expect.objectContaining({
          task: 'test-task'
        })
      });
      
      expect(execution.state.messages).toHaveLength(1);
    });

    it('should execute tool node with MCP integration', async () => {
      const workflow: WorkflowDefinition = {
        id: 'tool-test',
        name: 'Tool Test',
        description: 'Test tool node',
        stateSchema: {
          context: { value: {}, default: {} }
        },
        nodes: [{
          id: 'tool-node',
          type: 'tool',
          name: 'Tool Node',
          function: async (state) => state,
          metadata: { tool: 'test-tool', args: { param: 'value' } }
        }],
        edges: [],
        entryPoint: 'tool-node'
      };
      
      const workflowId = await adapter.createWorkflow(workflow);
      await adapter.executeWorkflow(workflowId, {});
      
      expect(mockMCPAdapter.executeTool).toHaveBeenCalledWith(
        'test-tool',
        { param: 'value' }
      );
    });

    it('should handle node execution errors', async () => {
      const workflow: WorkflowDefinition = {
        id: 'error-test',
        name: 'Error Test',
        description: 'Test error handling',
        stateSchema: {},
        nodes: [{
          id: 'error-node',
          type: 'custom',
          name: 'Error Node',
          function: async () => {
            throw new Error('Node execution failed');
          }
        }],
        edges: [],
        entryPoint: 'error-node'
      };
      
      const workflowId = await adapter.createWorkflow(workflow);
      
      await expect(
        adapter.executeWorkflow(workflowId, {})
      ).rejects.toThrow(NodeExecutionError);
    });

    it('should support retry policy', async () => {
      let attempts = 0;
      const workflow: WorkflowDefinition = {
        id: 'retry-test',
        name: 'Retry Test',
        description: 'Test retry policy',
        stateSchema: {},
        nodes: [{
          id: 'retry-node',
          type: 'custom',
          name: 'Retry Node',
          function: async () => {
            attempts++;
            if (attempts < 3) {
              throw new Error('Temporary failure');
            }
            return { success: true };
          },
          retryPolicy: {
            maxAttempts: 3,
            backoffStrategy: 'linear',
            initialDelay: 10
          }
        }],
        edges: [],
        entryPoint: 'retry-node'
      };
      
      const workflowId = await adapter.createWorkflow(workflow);
      const execution = await adapter.executeWorkflow(workflowId, {});
      
      expect(attempts).toBe(3);
      expect(execution.state.success).toBe(true);
    });
  });

  describe('Conditional Routing', () => {
    it('should handle conditional routing', async () => {
      await adapter.initialize({});
      
      const workflow: WorkflowDefinition = {
        id: 'conditional-test',
        name: 'Conditional Test',
        description: 'Test conditional routing',
        stateSchema: {
          value: { value: 0 },
          path: { value: '' }
        },
        nodes: [
          {
            id: 'start',
            type: 'custom',
            name: 'Start',
            function: async (state) => state
          },
          {
            id: 'path-a',
            type: 'custom',
            name: 'Path A',
            function: async (state) => ({ ...state, path: 'A' })
          },
          {
            id: 'path-b',
            type: 'custom',
            name: 'Path B',
            function: async (state) => ({ ...state, path: 'B' })
          }
        ],
        edges: [],
        entryPoint: 'start',
        conditionalRouting: [{
          source: 'start',
          conditions: [
            {
              condition: (state) => state.value > 0,
              target: 'path-a'
            },
            {
              condition: (state) => state.value <= 0,
              target: 'path-b'
            }
          ],
          default: 'path-b'
        }]
      };
      
      const workflowId = await adapter.createWorkflow(workflow);
      
      // Test path A
      const executionA = await adapter.executeWorkflow(workflowId, { value: 10 });
      expect(executionA.state.path).toBe('A');
      
      // Test path B
      const executionB = await adapter.executeWorkflow(workflowId, { value: -5 });
      expect(executionB.state.path).toBe('B');
    });
  });

  describe('Parallel Execution', () => {
    it('should execute nodes in parallel', async () => {
      await adapter.initialize({});
      
      const parallelNodes = [
        {
          id: 'parallel-1',
          type: 'custom' as const,
          name: 'Parallel 1',
          function: async (state: WorkflowState) => ({
            ...state,
            result1: 'done'
          })
        },
        {
          id: 'parallel-2',
          type: 'custom' as const,
          name: 'Parallel 2',
          function: async (state: WorkflowState) => ({
            ...state,
            result2: 'done'
          })
        }
      ];
      
      const result = await adapter.executeParallel(parallelNodes, {});
      
      expect(result.result1).toBe('done');
      expect(result.result2).toBe('done');
    });
  });

  describe('Checkpointing', () => {
    it('should create checkpoints during execution', async () => {
      await adapter.initialize({});
      
      const workflow: WorkflowDefinition = {
        id: 'checkpoint-test',
        name: 'Checkpoint Test',
        description: 'Test checkpointing',
        stateSchema: {
          step: { value: 0 }
        },
        nodes: [
          {
            id: 'step1',
            type: 'custom',
            name: 'Step 1',
            function: async (state) => ({ ...state, step: 1 })
          },
          {
            id: 'step2',
            type: 'custom',
            name: 'Step 2',
            function: async (state) => ({ ...state, step: 2 })
          }
        ],
        edges: [
          { from: 'step1', to: 'step2' }
        ],
        entryPoint: 'step1'
      };
      
      const workflowId = await adapter.createWorkflow(workflow);
      const execution = await adapter.executeWorkflow(workflowId, {}, {
        checkpointing: true
      });
      
      expect(execution.checkpoints.length).toBeGreaterThan(0);
      expect(execution.state.step).toBe(2);
    });
  });

  describe('Human in the Loop', () => {
    it('should handle human input nodes', async () => {
      await adapter.initialize({});
      
      const workflow: WorkflowDefinition = {
        id: 'human-test',
        name: 'Human Test',
        description: 'Test human input',
        stateSchema: {
          messages: { value: [], default: [] }
        },
        nodes: [{
          id: 'human-node',
          type: 'human',
          name: 'Human Input',
          function: async (state) => state,
          metadata: {
            prompt: 'Please provide input',
            timeout: 100
          }
        }],
        edges: [],
        entryPoint: 'human-node'
      };
      
      const workflowId = await adapter.createWorkflow(workflow);
      
      const humanInputHandler = jest.fn();
      adapter.on('human:input:required', humanInputHandler);
      
      // Start execution (will wait for input)
      const executionPromise = adapter.executeWorkflow(workflowId, {});
      
      // Wait a bit for the node to be reached
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Submit human input
      adapter.submitHumanInput('human-node', 'User response', 'user-123');
      
      const execution = await executionPromise;
      
      expect(humanInputHandler).toHaveBeenCalled();
      expect(execution.state.messages).toHaveLength(1);
      expect(execution.state.messages![0].content).toBe('User response');
    });
  });

  describe('Workflow Management', () => {
    let workflowId: string;

    beforeEach(async () => {
      await adapter.initialize({});
      const workflow: WorkflowDefinition = {
        id: 'mgmt-test',
        name: 'Management Test',
        description: 'Test workflow management',
        stateSchema: {},
        nodes: [{
          id: 'wait',
          type: 'custom',
          name: 'Wait',
          function: async () => {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return {};
          }
        }],
        edges: [],
        entryPoint: 'wait'
      };
      workflowId = await adapter.createWorkflow(workflow);
    });

    it('should list workflows', () => {
      const workflows = adapter.listWorkflows();
      expect(workflows).toHaveLength(1);
      expect(workflows[0].id).toBe(workflowId);
      expect(workflows[0].name).toBe('Management Test');
    });

    it('should get workflow status', async () => {
      const executionPromise = adapter.executeWorkflow(workflowId, {});
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const executions = adapter.listExecutions(workflowId);
      expect(executions).toHaveLength(1);
      expect(executions[0].status).toBe('running');
      
      // Cancel to clean up
      await adapter.cancelWorkflow(executions[0].id);
    });

    it('should pause and resume workflow', async () => {
      const executionPromise = adapter.executeWorkflow(workflowId, {});
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const executions = adapter.listExecutions(workflowId);
      const executionId = executions[0].id;
      
      await adapter.pauseWorkflow(executionId);
      
      const pausedExecution = adapter.getWorkflowStatus(executionId);
      expect(pausedExecution?.status).toBe('paused');
      
      // Clean up
      await adapter.cancelWorkflow(executionId);
    });

    it('should delete workflow', async () => {
      await adapter.deleteWorkflow(workflowId);
      
      const workflows = adapter.listWorkflows();
      expect(workflows).toHaveLength(0);
    });

    it('should not delete workflow with running executions', async () => {
      const executionPromise = adapter.executeWorkflow(workflowId, {});
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      await expect(
        adapter.deleteWorkflow(workflowId)
      ).rejects.toThrow(WorkflowError);
      
      // Clean up
      const executions = adapter.listExecutions(workflowId);
      await adapter.cancelWorkflow(executions[0].id);
    });
  });

  describe('Shutdown', () => {
    it('should shutdown cleanly', async () => {
      await adapter.initialize({});
      
      const workflow: WorkflowDefinition = {
        id: 'shutdown-test',
        name: 'Shutdown Test',
        description: 'Test shutdown',
        stateSchema: {},
        nodes: [{
          id: 'node',
          type: 'custom',
          name: 'Node',
          function: async () => ({ done: true })
        }],
        edges: [],
        entryPoint: 'node'
      };
      
      const workflowId = await adapter.createWorkflow(workflow);
      await adapter.executeWorkflow(workflowId, {});
      
      const shutdownHandler = jest.fn();
      adapter.on('adapter:shutdown', shutdownHandler);
      
      await adapter.shutdown();
      
      expect(shutdownHandler).toHaveBeenCalled();
      expect(adapter.listWorkflows()).toHaveLength(0);
      expect(adapter.listExecutions()).toHaveLength(0);
    });
  });
});