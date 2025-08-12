/**
 * A2A Protocol Agent Executor
 * Agent-to-Agent (A2A) communication Agent Executor implementation.
 * This executor handles task execution, cancellation, and event publishing
 *Fist Core (Alpha) Protocol of the Tri Protocol
 */

// packages/protocols/src/a2a/AgentExecutor.ts
import { EventEmitter } from 'eventemitter3';
import {
    Message,
    Task,
    TaskStatus,
    TaskStatusUpdateEvent,
    TaskArtifactUpdateEvent,
    Artifact,
    Part,
    AgentCapability,
    CapabilityCategory
} from "./types";

/**
 * Request context for agent execution
 */
export interface RequestContext {
    taskId: string;
    contextId: string;
    message: Message;
    capability?: AgentCapability;
    metadata?: Record<string, any>;
    existingTask?: Task;
}

/**
 * Event bus for publishing execution events
 */
export interface ExecutionEventBus extends EventEmitter {
    publish(event: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent): void;
    finished(): void;
    error(error: Error): void;
}

/**
 * Execution result
 */
export type ExecutionResult = Message | Task;

/**
 * Base interface for agent executors
 */
export interface IAgentExecutor {
    /**
     * Execute a task or message
     */
    execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<ExecutionResult>;

    /**
     * Cancel a running task
     */
    cancelTask(taskId: string): Promise<void>;

    /**
     * Get executor capabilities
     */
    getCapabilities?(): AgentCapability[];
}

/**
 * Abstract base class for agent executors
 */
export abstract class AgentExecutor implements IAgentExecutor {
    protected runningTasks = new Map<string, AbortController>();
    protected taskContexts = new Map<string, RequestContext>();

    /**
     * Execute a task or message
     */
    async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<ExecutionResult> {
        // Check if we should create a task
        const shouldCreateTask = this.shouldCreateTask(context);

        if (shouldCreateTask) {
            return this.executeAsTask(context, eventBus);
        } else {
            return this.executeAsMessage(context, eventBus);
        }
    }

    /**
     * Cancel a running task
     */
    async cancelTask(taskId: string): Promise<void> {
        const controller = this.runningTasks.get(taskId);
        const context = this.taskContexts.get(taskId);

        if (controller && context) {
            // Abort the task
            controller.abort();

            // Clean up
            this.runningTasks.delete(taskId);
            this.taskContexts.delete(taskId);

            console.log(`[AgentExecutor] Task cancelled: ${taskId}`);
        } else {
            throw new Error(`Task not found or not running: ${taskId}`);
        }
    }

    /**
     * Determine if execution should create a task
     * Override this method to customize task creation logic
     */
    protected shouldCreateTask(context: RequestContext): boolean {
        // Default: create task if capability suggests long-running operation
        if (context.capability) {
            return context.capability.cost > 50 ||
                context.capability.category === CapabilityCategory.ACTION ||
                context.metadata?.streaming === true;
        }
        return false;
    }

    /**
     * Execute as a task with status updates
     */
    protected async executeAsTask(context: RequestContext, eventBus: ExecutionEventBus): Promise<Task> {
        // Create or use existing task
        let task = context.existingTask;

        if (!task) {
            task = this.createTask(context);
            eventBus.publish(task);
        }

        // Setup cancellation
        const abortController = new AbortController();
        this.runningTasks.set(context.taskId, abortController);
        this.taskContexts.set(context.taskId, context);

        try {
            // Update status to in-progress
            this.publishStatusUpdate(eventBus, task, 'in-progress');

            // Execute with abort signal
            const result = await this.executeTaskLogic(context, eventBus, abortController.signal);

            // Check if cancelled
            if (abortController.signal.aborted) {
                this.publishStatusUpdate(eventBus, task, 'cancelled', true);
                return task;
            }

            // Update final status
            if (result.success) {
                this.publishStatusUpdate(eventBus, task, 'completed', true);
            } else {
                this.publishStatusUpdate(eventBus, task, 'failed', true, result.error);
            }

            // Add final artifact if any
            if (result.artifact) {
                this.publishArtifactUpdate(eventBus, task, result.artifact, true);
            }

            return task;

        } catch (error) {
            // Handle execution error
            if (abortController.signal.aborted) {
                this.publishStatusUpdate(eventBus, task, 'cancelled', true);
            } else {
                this.publishStatusUpdate(eventBus, task, 'failed', true, error);
                eventBus.error(error as Error);
            }

            return task;

        } finally {
            // Clean up
            this.runningTasks.delete(context.taskId);
            this.taskContexts.delete(context.taskId);
            eventBus.finished();
        }
    }

    /**
     * Execute as a simple message response
     */
    protected async executeAsMessage(context: RequestContext, eventBus: ExecutionEventBus): Promise<Message> {
        try {
            const response = await this.executeMessageLogic(context);
            eventBus.publish(response);
            eventBus.finished();
            return response;
        } catch (error) {
            eventBus.error(error as Error);
            throw error;
        }
    }

    /**
     * Create a new task
     */
    protected createTask(context: RequestContext): Task {
        return {
            id: context.taskId,
            contextId: context.contextId,
            status: {
                // state: { Submitted: 'submitted' },
                // timestamp: new Date().toISOString()
                state: 'submitted' as any,
                timestamp: new Date().toISOString(),
            },
            kind: 'task',
            createdAt: new Date(),
            updatedAt: new Date(),
            metadata: context.metadata
        };
    }

    /**
     * Publish status update event
     */
    protected publishStatusUpdate(
        eventBus: ExecutionEventBus,
        task: Task,
        state: string,
        final: boolean = false,
        error?: any
    ): void {
        const statusUpdate: TaskStatusUpdateEvent = {
            taskId: task.id,
            contextId: task.contextId,
            kind: 'status-update',
            status: {
                state: { [state]: state } as any,
                timestamp: new Date().toISOString(),
                message: error ? {
                    role: 'agent',
                    parts: [{
                        kind: 'text',
                        text: error.message || 'Task failed'
                    }],
                    messageId: `error-${Date.now()}`,
                    kind: 'message'
                } : undefined
            },
            final,
            metadata: { error: error?.stack }
        };

        task.status = statusUpdate.status;
        eventBus.publish(statusUpdate);
    }

    /**
     * Publish artifact update event
     */
    protected publishArtifactUpdate(
        eventBus: ExecutionEventBus,
        task: Task,
        artifact: Artifact,
        lastChunk: boolean = false
    ): void {
        const artifactUpdate: TaskArtifactUpdateEvent = {
            taskId: task.id,
            contextId: task.contextId,
            kind: 'artifact-update',
            artifact,
            append: true,
            lastChunks: lastChunk
        };

        if (!task.artifacts) {
            task.artifacts = [];
        }
        task.artifacts.push(artifact);

        eventBus.publish(artifactUpdate);
    }

    /**
     * Check if task is cancelled
     */
    protected isTaskCancelled(signal: AbortSignal): boolean {
        return signal.aborted;
    }

    /**
     * Abstract method - implement task execution logic
     */
    protected abstract executeTaskLogic(
        context: RequestContext,
        eventBus: ExecutionEventBus,
        signal: AbortSignal
    ): Promise<{
        success: boolean;
        artifact?: Artifact;
        error?: any;
    }>;

    /**
     * Abstract method - implement message execution logic
     */
    protected abstract executeMessageLogic(context: RequestContext): Promise<Message>;

    /**
     * Get executor capabilities (optional)
     */
    getCapabilities?(): AgentCapability[];
}

/**
 * Simple implementation of ExecutionEventBus
 */
export class SimpleExecutionEventBus extends EventEmitter implements ExecutionEventBus {
    private events: Array<Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent> = [];
    private isFinished = false;

    publish(event: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent): void {
        if (this.isFinished) {
            throw new Error('Cannot publish events after finished() is called');
        }

        this.events.push(event);
        this.emit('event', event);

        // Emit specific event types
        if ('kind' in event) {
            switch (event.kind) {
                case 'task':
                    this.emit('task', event);
                    break;
                case 'message':
                    this.emit('message', event);
                    break;
                case 'status-update':
                    this.emit('status-update', event);
                    break;
                case 'artifact-update':
                    this.emit('artifact-update', event);
                    break;
            }
        }
    }

    finished(): void {
        if (!this.isFinished) {
            this.isFinished = true;
            this.emit('finished', this.events);
        }
    }

    error(error: Error): void {
        this.emit('error', error);
    }

    getEvents(): Array<Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent> {
        return [...this.events];
    }
}