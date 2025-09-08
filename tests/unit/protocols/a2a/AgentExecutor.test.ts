// tests/unit/protocols/a2a/AgentExecutor.test.ts
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  InternalExecutionResult,
  ExecutionMetrics
} from '../../../../protocols/src/a2a/AgentExecutor';
import {
  Task,
  TaskState,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Message,
  AgentCapability,
  CapabilityCategory,
  Artifact
} from '../../../../protocols/src/a2a/types';
import { EventEmitter } from 'eventemitter3';

// Concrete implementation for testing
class TestAgentExecutor extends AgentExecutor {
  public testResult: InternalExecutionResult = {
    success: true,
    result: { test: 'result' }
  };

  public testMessage: Message = {
    role: 'agent',
    parts: [{ kind: 'text', text: 'Test response' }],
    messageId: 'test-msg-1',
    kind: 'message'
  };

  // Public callback for overriding behavior in tests
  public taskLogicOverride?: (
    context: RequestContext,
    eventBus: ExecutionEventBus,
    signal: AbortSignal
  ) => Promise<InternalExecutionResult>;

  public messageLogicOverride?: (
    context: RequestContext
  ) => Promise<Message>;

  protected async executeTaskLogic(
      context: RequestContext,
      eventBus: ExecutionEventBus,
      signal: AbortSignal
  ): Promise<InternalExecutionResult> {
    // Allow override for testing
    if (this.taskLogicOverride) {
      return this.taskLogicOverride(context, eventBus, signal);
    }

    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, 10));

    // Check for cancellation
    if (signal.aborted) {
      return {
        success: false,
        error: 'Task was cancelled'
      };
    }

    // Simulate progress updates
    if (context.metadata?.simulateProgress) {
      const task: Task = {
        id: context.taskId,
        contextId: context.contextId,
        status: {
          state: 'in-progress',
          timestamp: new Date().toISOString()
        },
        kind: 'task',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      for (let i = 20; i <= 100; i += 20) {
        this.publishProgressUpdate(eventBus, task, i, `Progress: ${i}%`);
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }

    return this.testResult;
  }

  protected async executeMessageLogic(context: RequestContext): Promise<Message> {
    // Allow override for testing
    if (this.messageLogicOverride) {
      return this.messageLogicOverride(context);
    }

    await new Promise(resolve => setTimeout(resolve, 5));
    return this.testMessage;
  }

  getCapabilities(): AgentCapability[] {
    return [{
      id: 'test-capability',
      name: 'Test Capability',
      description: 'For testing',
      category: CapabilityCategory.ANALYSIS,
      inputs: [],
      outputs: [],
      cost: 10,
      reliability: 0.99,
      version: '1.0.0'
    }];
  }
}

describe('AgentExecutor', () => {
  let executor: TestAgentExecutor;
  let eventBus: ExecutionEventBus;
  let publishedEvents: any[] = [];

  beforeEach(() => {
    executor = new TestAgentExecutor();
    publishedEvents = [];

    eventBus = {
      publish: jest.fn((event) => {
        publishedEvents.push(event);
      }),
      finished: jest.fn(),
      error: jest.fn(),
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn()
    } as any;
  });

  describe('Task Execution', () => {
    it('should execute a task successfully', async () => {
      const context: RequestContext = {
        taskId: 'task-001',
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'Execute task' }],
          messageId: 'msg-001',
          kind: 'message'
        },
        capability: {
          id: 'test-cap',
          name: 'Test',
          description: 'Test capability',
          category: CapabilityCategory.ACTION,
          inputs: [],
          outputs: [],
          cost: 60, // > 50, should create task
          reliability: 0.9,
          version: '1.0.0'
        },
        agentId: 'test-agent'
      };

      const result = await executor.execute(context, eventBus);

      expect(result).toBeDefined();
      expect((result as Task).kind).toBe('task');
      expect((result as Task).id).toBe('task-001');
      expect((result as Task).results?.success).toBe(true);
      expect(eventBus.publish).toHaveBeenCalled();
      expect(eventBus.finished).toHaveBeenCalled();
    });

    it('should execute as message when cost is low', async () => {
      const context: RequestContext = {
        taskId: 'msg-task-001',
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'Simple query' }],
          messageId: 'msg-001',
          kind: 'message'
        },
        capability: {
          id: 'simple-cap',
          name: 'Simple',
          description: 'Simple capability',
          category: CapabilityCategory.COMMUNICATION,
          inputs: [],
          outputs: [],
          cost: 10, // < 50, should execute as message
          reliability: 0.9,
          version: '1.0.0'
        }
      };

      const result = await executor.execute(context, eventBus);

      expect(result).toBeDefined();
      expect((result as Message).kind).toBe('message');
      expect((result as Message).role).toBe('agent');
      expect(eventBus.publish).toHaveBeenCalled();
      expect(eventBus.finished).toHaveBeenCalled();
    });

    it('should handle task with existing task', async () => {
      const existingTask: Task = {
        id: 'existing-001',
        contextId: 'context-001',
        status: {
          state: 'in-progress',
          timestamp: new Date().toISOString()
        },
        kind: 'task',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const context: RequestContext = {
        taskId: 'existing-001',
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'Continue task' }],
          messageId: 'msg-001',
          kind: 'message'
        },
        existingTask,
        capability: {
          id: 'test-cap',
          name: 'Test',
          description: 'Test capability',
          category: CapabilityCategory.ACTION,
          inputs: [],
          outputs: [],
          cost: 60,
          reliability: 0.9,
          version: '1.0.0'
        }
      };

      const result = await executor.execute(context, eventBus);

      expect(result).toBeDefined();
      expect((result as Task).id).toBe('existing-001');
      expect((result as Task).results?.success).toBe(true);
    });

    it('should publish status updates during execution', async () => {
      const context: RequestContext = {
        taskId: 'status-task',
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'Track status' }],
          messageId: 'msg-001',
          kind: 'message'
        },
        capability: {
          id: 'test-cap',
          name: 'Test',
          description: 'Test capability',
          category: CapabilityCategory.ACTION,
          inputs: [],
          outputs: [],
          cost: 60,
          reliability: 0.9,
          version: '1.0.0'
        }
      };

      await executor.execute(context, eventBus);

      const statusUpdates = publishedEvents.filter(e => e.kind === 'status-update');

      expect(statusUpdates.length).toBeGreaterThan(0);
      expect(statusUpdates.some(u => u.status.state === 'in-progress')).toBe(true);
      expect(statusUpdates.some(u => u.status.state === 'completed')).toBe(true);
    });

    it('should handle task failure', async () => {
      executor.testResult = {
        success: false,
        error: 'Task failed for testing'
      };

      const context: RequestContext = {
        taskId: 'fail-task',
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'This will fail' }],
          messageId: 'msg-001',
          kind: 'message'
        },
        capability: {
          id: 'test-cap',
          name: 'Test',
          description: 'Test capability',
          category: CapabilityCategory.ACTION,
          inputs: [],
          outputs: [],
          cost: 60,
          reliability: 0.9,
          version: '1.0.0'
        }
      };

      const result = await executor.execute(context, eventBus);

      expect((result as Task).results?.success).toBe(false);
      expect((result as Task).results?.error).toContain('Task failed for testing');

      const statusUpdates = publishedEvents.filter(e => e.kind === 'status-update');
      expect(statusUpdates.some(u => u.status.state === 'failed')).toBe(true);
    });

    it('should publish progress updates', async () => {
      const context: RequestContext = {
        taskId: 'progress-task',
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'Track progress' }],
          messageId: 'msg-001',
          kind: 'message'
        },
        capability: {
          id: 'test-cap',
          name: 'Test',
          description: 'Test capability',
          category: CapabilityCategory.ACTION,
          inputs: [],
          outputs: [],
          cost: 60,
          reliability: 0.9,
          version: '1.0.0'
        },
        metadata: {
          simulateProgress: true
        }
      };

      await executor.execute(context, eventBus);

      const progressUpdates = publishedEvents.filter(
          e => e.kind === 'status-update' && e.metadata?.progress
      );

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates.some(u => u.metadata.progress === 20)).toBe(true);
      expect(progressUpdates.some(u => u.metadata.progress === 100)).toBe(true);
    });
  });

  describe('Task Cancellation', () => {
    it('should cancel a running task', async () => {
      const context: RequestContext = {
        taskId: 'cancel-task',
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'Long running task' }],
          messageId: 'msg-001',
          kind: 'message'
        },
        capability: {
          id: 'test-cap',
          name: 'Test',
          description: 'Test capability',
          category: CapabilityCategory.ACTION,
          inputs: [],
          outputs: [],
          cost: 60,
          reliability: 0.9,
          version: '1.0.0'
        }
      };

      // Make task take longer
      executor.taskLogicOverride = async (context, eventBus, signal) => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (signal.aborted) {
          return { success: false, error: 'Task was cancelled' };
        }
        return { success: true, result: 'done' };
      };

      // Start execution
      const executionPromise = executor.execute(context, eventBus);

      // Wait a bit then cancel
      await new Promise(resolve => setTimeout(resolve, 50));
      await executor.cancelTask('cancel-task');

      const result = await executionPromise;

      expect((result as Task).results?.success).toBe(false);
      expect((result as Task).results?.error).toContain('cancelled');

      const statusUpdates = publishedEvents.filter(e => e.kind === 'status-update');
      expect(statusUpdates.some(u => u.status.state === 'cancelled')).toBe(true);
    });

    it('should throw error when cancelling non-existent task', async () => {
      await expect(executor.cancelTask('non-existent'))
          .rejects.toThrow('Task not found');
    });

    it('should handle timeout', async () => {
      const context: RequestContext = {
        taskId: 'timeout-task',
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'Will timeout' }],
          messageId: 'msg-001',
          kind: 'message'
        },
        capability: {
          id: 'test-cap',
          name: 'Test',
          description: 'Test capability',
          category: CapabilityCategory.ACTION,
          inputs: [],
          outputs: [],
          cost: 60,
          reliability: 0.9,
          version: '1.0.0'
        },
        metadata: {
          timeout: 50 // 50ms timeout
        }
      };

      // Make task take longer than timeout
      executor.taskLogicOverride = async (context, eventBus, signal) => {
        // Wait for longer than the timeout (50ms)
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 20));
          // Check if cancelled
          if (signal.aborted) {
            return { success: false, error: 'Task was cancelled' };
          }
        }
        return { success: true };
      };

      const result = await executor.execute(context, eventBus);

      // Task should be cancelled due to timeout
      expect((result as Task).results?.success).toBe(false);
    });
  });

  describe('Artifacts', () => {
    it('should publish artifacts', async () => {
      const artifact: Artifact = {
        artifactId: 'artifact-001',
        name: 'Test Artifact',
        parts: [{ kind: 'text', text: 'Artifact content' }],
        createdAt: new Date()
      };

      executor.testResult = {
        success: true,
        result: 'completed',
        artifacts: [artifact]
      };

      const context: RequestContext = {
        taskId: 'artifact-task',
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'Generate artifact' }],
          messageId: 'msg-001',
          kind: 'message'
        },
        capability: {
          id: 'test-cap',
          name: 'Test',
          description: 'Test capability',
          category: CapabilityCategory.ACTION,
          inputs: [],
          outputs: [],
          cost: 60,
          reliability: 0.9,
          version: '1.0.0'
        }
      };

      const result = await executor.execute(context, eventBus);

      expect((result as Task).artifacts).toBeDefined();
      expect((result as Task).artifacts?.length).toBe(1);

      const artifactUpdates = publishedEvents.filter(e => e.kind === 'artifact-update');
      expect(artifactUpdates.length).toBe(1);
      expect(artifactUpdates[0].artifact.artifactId).toBe('artifact-001');
    });
  });

  describe('Metrics', () => {
    it('should track execution metrics', async () => {
      const initialMetrics = executor.getMetrics();
      expect(initialMetrics.totalExecutions).toBe(0);

      // Execute several tasks
      for (let i = 0; i < 3; i++) {
        const context: RequestContext = {
          taskId: `metric-task-${i}`,
          contextId: 'context-001',
          message: {
            role: 'user',
            parts: [{ kind: 'text', text: 'Test' }],
            messageId: `msg-${i}`,
            kind: 'message'
          },
          capability: {
            id: 'test-cap',
            name: 'Test',
            description: 'Test capability',
            category: CapabilityCategory.ACTION,
            inputs: [],
            outputs: [],
            cost: 60,
            reliability: 0.9,
            version: '1.0.0'
          }
        };

        await executor.execute(context, eventBus);
      }

      const metrics = executor.getMetrics();

      expect(metrics.totalExecutions).toBe(3);
      expect(metrics.successfulExecutions).toBe(3);
      expect(metrics.failedExecutions).toBe(0);
      expect(metrics.averageExecutionTime).toBeGreaterThan(0);
      expect(metrics.lastExecutionTime).toBeDefined();
    });

    it('should track failed executions', async () => {
      executor.testResult = {
        success: false,
        error: 'Intentional failure'
      };

      const context: RequestContext = {
        taskId: 'fail-metric-task',
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'Will fail' }],
          messageId: 'msg-001',
          kind: 'message'
        },
        capability: {
          id: 'test-cap',
          name: 'Test',
          description: 'Test capability',
          category: CapabilityCategory.ACTION,
          inputs: [],
          outputs: [],
          cost: 60,
          reliability: 0.9,
          version: '1.0.0'
        }
      };

      await executor.execute(context, eventBus);

      const metrics = executor.getMetrics();
      expect(metrics.failedExecutions).toBe(1);
    });

    it('should track cancelled executions', async () => {
      const context: RequestContext = {
        taskId: 'cancel-metric-task',
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'Will be cancelled' }],
          messageId: 'msg-001',
          kind: 'message'
        },
        capability: {
          id: 'test-cap',
          name: 'Test',
          description: 'Test capability',
          category: CapabilityCategory.ACTION,
          inputs: [],
          outputs: [],
          cost: 60,
          reliability: 0.9,
          version: '1.0.0'
        }
      };

      // Slow down execution
      executor.taskLogicOverride = async (ctx, eb, signal: AbortSignal) => {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (signal.aborted) {
          return { success: false, error: 'Cancelled' };
        }
        return { success: true };
      };

      const executionPromise = executor.execute(context, eventBus);

      setTimeout(() => executor.cancelTask('cancel-metric-task'), 20);

      await executionPromise;

      const metrics = executor.getMetrics();
      expect(metrics.cancelledExecutions).toBe(1);
    });
  });

  describe('Running Tasks Management', () => {
    it('should track running tasks', async () => {
      const context: RequestContext = {
        taskId: 'running-task',
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'Long task' }],
          messageId: 'msg-001',
          kind: 'message'
        },
        capability: {
          id: 'test-cap',
          name: 'Test',
          description: 'Test capability',
          category: CapabilityCategory.ACTION,
          inputs: [],
          outputs: [],
          cost: 60,
          reliability: 0.9,
          version: '1.0.0'
        }
      };

      // Slow down execution
      executor.taskLogicOverride = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { success: true };
      };

      const executionPromise = executor.execute(context, eventBus);

      // Check running tasks while executing
      await new Promise(resolve => setTimeout(resolve, 20));
      const runningTasks = executor.getRunningTasks();
      expect(runningTasks).toContain('running-task');

      await executionPromise;

      // Should be empty after completion
      const finalRunningTasks = executor.getRunningTasks();
      expect(finalRunningTasks).not.toContain('running-task');
    });
  });

  describe('Capabilities', () => {
    it('should return executor capabilities', () => {
      const capabilities = executor.getCapabilities();

      expect(capabilities).toBeDefined();
      expect(capabilities?.length).toBe(1);
      expect(capabilities?.[0].id).toBe('test-capability');
      expect(capabilities?.[0].category).toBe(CapabilityCategory.ANALYSIS);
    });
  });

  describe('Error Handling', () => {
    it('should handle validation errors', async () => {
      const invalidContext = {
        taskId: '', // Invalid - empty
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'Test' }],
          messageId: 'msg-001',
          kind: 'message'
        }
      } as RequestContext;

      await expect(executor.execute(invalidContext, eventBus))
          .rejects.toThrow('taskId is required');
    });

    it('should handle execution errors', async () => {
      executor.taskLogicOverride = async () => {
        throw new Error('Execution error');
      };

      const context: RequestContext = {
        taskId: 'error-task',
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'Will error' }],
          messageId: 'msg-001',
          kind: 'message'
        },
        capability: {
          id: 'test-cap',
          name: 'Test',
          description: 'Test capability',
          category: CapabilityCategory.ACTION,
          inputs: [],
          outputs: [],
          cost: 60,
          reliability: 0.9,
          version: '1.0.0'
        }
      };

      const result = await executor.execute(context, eventBus);

      expect((result as Task).results?.success).toBe(false);
      expect((result as Task).results?.error).toContain('Execution error');
      expect(eventBus.error).toHaveBeenCalled();
    });

    it('should handle message execution errors', async () => {
      executor.messageLogicOverride = async () => {
        throw new Error('Message error');
      };

      const context: RequestContext = {
        taskId: 'msg-error',
        contextId: 'context-001',
        message: {
          role: 'user',
          parts: [{ kind: 'text', text: 'Will error' }],
          messageId: 'msg-001',
          kind: 'message'
        }
        // No capability or metadata to force message execution
      };

      await expect(executor.execute(context, eventBus))
          .rejects.toThrow('Message error');

      expect(eventBus.error).toHaveBeenCalled();
    });
  });
});