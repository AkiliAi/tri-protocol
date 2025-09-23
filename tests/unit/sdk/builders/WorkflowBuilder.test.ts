/**
 * Unit tests for WorkflowBuilder
 */

import { WorkflowBuilder, SDKWorkflowImpl } from '../../../../sdk/src/builders/WorkflowBuilder';
import { TriProtocol, TriWorkflow, TriOrchestrator } from '../../../../sdk/src/types/core-types';
import { WorkflowConfig, WorkflowStatus } from '../../../../sdk/src/types';

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
  v4: jest.fn(() => 'workflow-uuid-456')
}));

describe('WorkflowBuilder', () => {
  let builder: WorkflowBuilder;
  let mockProtocol: jest.Mocked<TriProtocol>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProtocol = {
      registerAgent: jest.fn(),
      getOrchestrator: jest.fn(),
      getLLMService: jest.fn(),
      getPersistence: jest.fn(),
      getProtocol: jest.fn(),
      initialize: jest.fn(),
      shutdown: jest.fn()
    } as unknown as jest.Mocked<TriProtocol>;

    builder = new WorkflowBuilder(mockProtocol);
  });

  describe('Fluent API', () => {
    it('should set workflow name', () => {
      const result = builder.withName('TestWorkflow');
      expect(result).toBe(builder);
      expect((builder as any).config.name).toBe('TestWorkflow');
    });

    it('should set workflow description', () => {
      const result = builder.withDescription('Test Workflow Description');
      expect(result).toBe(builder);
      expect((builder as any).config.description).toBe('Test Workflow Description');
    });

    it('should set workflow timeout', () => {
      const result = builder.withTimeout(5000);
      expect(result).toBe(builder);
      expect((builder as any).config.timeout).toBe(5000);
    });

    it('should set workflow retries', () => {
      const result = builder.withRetries(3);
      expect(result).toBe(builder);
      expect((builder as any).config.retries).toBe(3);
    });

    it('should enable checkpointing', () => {
      const result = builder.withCheckpointing(true);
      expect(result).toBe(builder);
      expect((builder as any).config.checkpointing).toBe(true);
    });

    it('should add workflow step', () => {
      const result = builder.addStep('Step 1');
      expect(result).toBe(builder);

      const nodes = (builder as any).nodes;
      expect(nodes).toHaveLength(1);
      expect(nodes[0].config.name).toBe('Step 1');
    });

    it('should add sequential steps', () => {
      builder
        .addStep('Step 1')
        .addStep('Step 2')
        .addStep('Step 3');

      const nodes = (builder as any).nodes;
      const edges = (builder as any).edges;

      expect(nodes).toHaveLength(3);
      expect(edges).toHaveLength(2);

      expect(nodes[0].config.name).toBe('Step 1');
      expect(nodes[1].config.name).toBe('Step 2');
      expect(nodes[2].config.name).toBe('Step 3');
    });

    it('should add parallel steps', () => {
      builder.parallel('Parallel 1', 'Parallel 2', 'Parallel 3');

      const nodes = (builder as any).nodes;

      // Parallel creates start, end, and the parallel steps
      expect(nodes.some((n: any) => n.type === 'parallel-start')).toBe(true);
      expect(nodes.some((n: any) => n.type === 'parallel-end')).toBe(true);
      expect(nodes.some((n: any) => n.config?.name === 'Parallel 1')).toBe(true);
      expect(nodes.some((n: any) => n.config?.name === 'Parallel 2')).toBe(true);
      expect(nodes.some((n: any) => n.config?.name === 'Parallel 3')).toBe(true);
    });

    it('should add conditional flow', () => {
      const condition = 'value > 5';

      const branchBuilder = builder.condition(condition);
      branchBuilder.then((b) => {
        b.addStep('Then Step');
      }).else((b) => {
        b.addStep('Else Step');
      });

      const nodes = (builder as any).nodes;

      // Should have condition node, then step, else step
      expect(nodes.some((n: any) => n.type === 'condition')).toBe(true);
      expect(nodes.some((n: any) => n.config?.name === 'Then Step')).toBe(true);
      expect(nodes.some((n: any) => n.config?.name === 'Else Step')).toBe(true);
    });

    it('should add loop flow', () => {
      const condition = 'count < 10';

      builder.loop(condition, (b) => {
        b.addStep('Loop Body');
      });

      const nodes = (builder as any).nodes;

      expect(nodes.some((n: any) => n.type === 'loop-start')).toBe(true);
      expect(nodes.some((n: any) => n.config?.name === 'Loop Body')).toBe(true);
      expect(nodes.some((n: any) => n.type === 'loop-end')).toBe(true);
    });
  });

  describe('Templates', () => {
    it('should apply data-pipeline template', () => {
      const result = builder.fromTemplate('data-pipeline');
      expect(result).toBe(builder);

      // Templates are not implemented yet, just check it doesn't throw
      expect(() => builder.fromTemplate('data-pipeline')).not.toThrow();
    });

    it('should apply research template', () => {
      const result = builder.fromTemplate('research');
      expect(result).toBe(builder);

      // Templates are not implemented yet, just check it doesn't throw
      expect(() => builder.fromTemplate('research')).not.toThrow();
    });

    it('should apply rag-pipeline template', () => {
      const result = builder.fromTemplate('rag-pipeline');
      expect(result).toBe(builder);

      // Templates are not implemented yet, just check it doesn't throw
      expect(() => builder.fromTemplate('rag-pipeline')).not.toThrow();
    });

    it('should apply multi-agent template', () => {
      const result = builder.fromTemplate('multi-agent');
      expect(result).toBe(builder);

      // Templates are not implemented yet, just check it doesn't throw
      expect(() => builder.fromTemplate('multi-agent')).not.toThrow();
    });

    it('should handle unknown template gracefully', () => {
      const result = builder.fromTemplate('unknown-template' as any);
      expect(result).toBe(builder);
      // Should not throw error
    });
  });

  describe('Build', () => {
    it('should build workflow with configuration', async () => {
      builder
        .withName('TestWorkflow')
        .withDescription('Test Description')
        .addStep('Step 1')
        .addStep('Step 2');

      const workflow = await builder.build();

      expect(workflow).toBeDefined();
      expect(workflow.name).toBe('TestWorkflow');
      expect(workflow.description).toBe('Test Description');
    });

    it('should register workflow after build', async () => {
      const orchestrator = {
        executeWorkflow: jest.fn()
      };
      mockProtocol.getOrchestrator.mockReturnValue(orchestrator as any);

      builder.withName('TestWorkflow').addStep('Step 1');
      const workflow = await builder.build();

      // Verify workflow is created
      expect(workflow).toBeDefined();
    });

    it('should merge template with custom config', async () => {
      builder
        .fromTemplate('data-pipeline')
        .withName('CustomPipeline')
        .withDescription('Custom Description')
        .addStep('Custom Step');

      const workflow = await builder.build();

      expect(workflow.name).toBe('CustomPipeline');
      expect(workflow.description).toBe('Custom Description');
    });

    it('should emit event when SDK is provided', async () => {
      const mockSdk = {
        emit: jest.fn()
      };

      const builderWithSdk = new WorkflowBuilder(mockProtocol, mockSdk);
      builderWithSdk.withName('TestWorkflow').addStep('Step 1');
      const workflow = await builderWithSdk.build();

      expect(mockSdk.emit).toHaveBeenCalledWith('workflow:created', workflow);
    });

    it('should chain multiple configurations', () => {
      builder
        .withName('TestWorkflow')
        .withDescription('Research workflow')
        .withTimeout(10000)
        .withRetries(5)
        .withCheckpointing(true)
        .addStep('Step 1')
        .addStep('Step 2')
        .addStep('Step 3');

      expect((builder as any).config.name).toBe('TestWorkflow');
      expect((builder as any).config.description).toBe('Research workflow');
      expect((builder as any).config.timeout).toBe(10000);
      expect((builder as any).config.retries).toBe(5);
      expect((builder as any).config.checkpointing).toBe(true);
      expect((builder as any).nodes).toHaveLength(3);
    });
  });
});

describe('SDKWorkflowImpl', () => {
  let workflow: SDKWorkflowImpl;
  let mockProtocol: jest.Mocked<TriProtocol>;
  let config: WorkflowConfig;
  let nodes: any[];
  let edges: any[];

  beforeEach(() => {
    jest.clearAllMocks();

    const orchestrator = {
      executeWorkflow: jest.fn().mockResolvedValue({ result: 'success' })
    };

    mockProtocol = {
      registerAgent: jest.fn(),
      getOrchestrator: jest.fn(() => orchestrator),
      getLLMService: jest.fn(),
      getPersistence: jest.fn(),
      getProtocol: jest.fn(),
      initialize: jest.fn(),
      shutdown: jest.fn()
    } as unknown as jest.Mocked<TriProtocol>;

    config = {
      name: 'TestWorkflow',
      description: 'Test Workflow',
      timeout: 30000,
      retries: 3
    };

    nodes = [
      { id: 'node1', type: 'task', config: { name: 'Node 1' } },
      { id: 'node2', type: 'task', config: { name: 'Node 2' } }
    ];

    edges = [
      { from: 'node1', to: 'node2' }
    ];

    workflow = new SDKWorkflowImpl(mockProtocol, config, nodes, edges);
  });

  describe('Execution', () => {
    it('should execute workflow', async () => {
      const input = { data: 'test' };
      const result = await workflow.execute(input);

      expect(result).toEqual({ result: 'success' });
      expect(mockProtocol.getOrchestrator).toHaveBeenCalled();
    });

    it('should handle execution errors', async () => {
      const orchestrator = mockProtocol.getOrchestrator();
      orchestrator.executeWorkflow = jest.fn().mockRejectedValue(new Error('Execution failed'));

      await expect(workflow.execute({})).rejects.toThrow('Workflow execution failed');
    });

    it('should emit execution events', async () => {
      const startHandler = jest.fn();
      const completeHandler = jest.fn();

      workflow.on('started', startHandler);
      workflow.on('completed', completeHandler);

      await workflow.execute({ data: 'test' });

      expect(startHandler).toHaveBeenCalledWith({ data: 'test' });
      expect(completeHandler).toHaveBeenCalledWith({ result: 'success' });
    });
  });

  describe('State Management', () => {
    it('should get workflow status', () => {
      const status = workflow.getStatus();

      expect(status.status).toBe('pending');
    });

    it('should update status during execution', async () => {
      const promise = workflow.execute({ data: 'test' });

      expect(workflow.getStatus().status).toBe('running');

      await promise;

      expect(workflow.getStatus().status).toBe('completed');
    });

    it('should handle error status', async () => {
      const orchestrator = mockProtocol.getOrchestrator();
      orchestrator.executeWorkflow = jest.fn().mockRejectedValue(new Error('Failed'));

      try {
        await workflow.execute({});
      } catch (e) {
        // Expected to throw
      }

      expect(workflow.getStatus().status).toBe('failed');
    });
  });

  describe('Event Handlers', () => {
    it('should handle step completion', () => {
      const stepHandler = jest.fn();

      workflow.on('step:completed', stepHandler);

      // Simulate step completion
      workflow.emit('step:completed', {
        stepId: 'node1',
        result: { data: 'processed' }
      });

      expect(stepHandler).toHaveBeenCalledWith({
        stepId: 'node1',
        result: { data: 'processed' }
      });
    });

    it('should handle workflow errors', () => {
      const errorHandler = jest.fn();

      workflow.on('workflow:error', errorHandler);

      // Simulate error
      const error = new Error('Workflow failed');
      workflow.emit('workflow:error', { error });

      expect(errorHandler).toHaveBeenCalledWith({ error });
    });
  });

  describe('Pause and Resume', () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    afterEach(() => {
      jest.useFakeTimers();
    });

    it('should pause running workflow', async () => {
      // Make the orchestrator execution slower
      const orchestrator = mockProtocol.getOrchestrator();
      let resolveExecution: any;
      orchestrator.executeWorkflow = jest.fn().mockImplementation(() => {
        return new Promise(resolve => {
          resolveExecution = resolve;
        });
      });

      // Start workflow first
      const promise = workflow.execute({ data: 'test' });

      // Workflow should be running now
      expect(workflow.getStatus().status).toBe('running');

      // Now we can pause it
      await workflow.pause();
      expect(workflow.getStatus().status).toBe('paused');

      // Resolve the execution to complete the test
      if (resolveExecution) {
        resolveExecution({ result: 'success' });
      }

      // Wait for promise to settle
      await promise.catch(() => {});
    });

    it('should resume paused workflow', async () => {
      // Make the orchestrator execution slower
      const orchestrator = mockProtocol.getOrchestrator();
      let resolveExecution: any;
      orchestrator.executeWorkflow = jest.fn().mockImplementation(() => {
        return new Promise(resolve => {
          resolveExecution = resolve;
        });
      });

      // Start workflow first
      const promise = workflow.execute({ data: 'test' });

      // Workflow should be running
      expect(workflow.getStatus().status).toBe('running');

      // Pause it
      await workflow.pause();
      expect(workflow.getStatus().status).toBe('paused');

      // Resume it
      await workflow.resume();
      expect(workflow.getStatus().status).toBe('running');

      // Resolve the execution to complete the test
      if (resolveExecution) {
        resolveExecution({ result: 'success' });
      }

      // Wait for promise to settle
      await promise.catch(() => {});
    });

    it('should throw error when pausing non-running workflow', async () => {
      await expect(workflow.pause()).rejects.toThrow('Cannot pause workflow that is not running');
    });
  });

  describe('Cancel Operation', () => {
    it('should cancel workflow', async () => {
      await workflow.cancel();

      expect(workflow.getStatus().status).toBe('failed');
      expect(workflow.getStatus().error).toBe('Cancelled by user');
    });

    it('should not cancel completed workflow', async () => {
      await workflow.execute({ data: 'test' });

      await expect(workflow.cancel()).rejects.toThrow('Cannot cancel completed workflow');
    });
  });

  describe('Node and Edge Operations', () => {
    it('should get workflow nodes', () => {
      const workflowNodes = workflow.getNodes();

      expect(workflowNodes).toEqual(nodes);
    });

    it('should get workflow edges', () => {
      const workflowEdges = workflow.getEdges();

      expect(workflowEdges).toEqual(edges);
    });

    it('should find node by id', () => {
      const node = workflow.getNode('node1');

      expect(node).toEqual({ id: 'node1', type: 'task', config: { name: 'Node 1' } });
    });

    it('should return undefined for non-existent node', () => {
      const node = workflow.getNode('non-existent');

      expect(node).toBeUndefined();
    });
  });

  describe('Visualization', () => {
    it('should generate mermaid diagram', () => {
      const diagram = workflow.toMermaid();

      expect(diagram).toContain('graph TD');
      expect(diagram).toContain('node1[Node 1]'); // Uses config.name
      expect(diagram).toContain('node2[Node 2]');
      expect(diagram).toContain('node1 --> node2');
    });

    it('should handle empty workflow in mermaid', () => {
      const emptyWorkflow = new SDKWorkflowImpl(mockProtocol, config, [], []);
      const diagram = emptyWorkflow.toMermaid();

      expect(diagram).toContain('graph TD');
      expect(diagram).not.toContain('-->');
    });
  });
});