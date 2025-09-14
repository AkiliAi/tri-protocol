import { Logger } from '../../../logger';
/**
 * A2A Protocol Agent Executor - PRODUCTION VERSION
 * Agent-to-Agent (A2A) communication Agent Executor implementation.
 * This executor handles task execution, cancellation, and event publishing
 * First Core (Alpha) Protocol of the Tri Protocol
 */

import { EventEmitter } from 'eventemitter3';
import {
    Message,
    Task,
    TaskResult,
    TaskState,
    TaskStatusUpdateEvent,
    TaskArtifactUpdateEvent,
    Artifact,
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
    agentId?: string; // ID of the executing agent
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
 * Internal execution result structure
 * Used by executeTaskLogic before being mapped to TaskResult
 */
export interface InternalExecutionResult {
    success: boolean;
    result?: any;
    error?: Error | string;
    artifacts?: Artifact[];
}

/**
 * Execution metrics for monitoring
 */
export interface ExecutionMetrics {
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    cancelledExecutions: number;
    averageExecutionTime: number;
    lastExecutionTime?: Date;
}

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

    /**
     * Get execution metrics
     */
    getMetrics(): ExecutionMetrics;

    /**
     * Get running tasks
     */
    getRunningTasks(): string[];
}

/**
 * Abstract base class for agent executors
 */
export abstract class AgentExecutor implements IAgentExecutor {
    protected logger: Logger;
    protected runningTasks = new Map<string, AbortController>();
    protected taskContexts = new Map<string, RequestContext>();
    protected taskTimeouts = new Map<string, NodeJS.Timeout>();
    
    constructor() {
        this.logger = Logger.getLogger('AgentExecutor');
    }

    protected metrics: ExecutionMetrics = {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        cancelledExecutions: 0,
        averageExecutionTime: 0
    };

    /**
     * Execute a task or message
     */
    async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<ExecutionResult> {
        // Validate context
        this.validateContext(context);

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
        const timeout = this.taskTimeouts.get(taskId);

        if (controller && context) {
            // Abort the task
            controller.abort();

            // Clear timeout if exists
            if (timeout) {
                clearTimeout(timeout);
                this.taskTimeouts.delete(taskId);
            }

            // Clean up
            this.runningTasks.delete(taskId);
            this.taskContexts.delete(taskId);

            this.logger.info(`[AgentExecutor] Task cancelled: ${taskId}`);
        } else {
            throw new Error(`Task not found or not running: ${taskId}`);
        }
    }

    /**
     * Get execution metrics
     */
    getMetrics(): ExecutionMetrics {
        return { ...this.metrics };
    }

    /**
     * Get list of running task IDs
     */
    getRunningTasks(): string[] {
        return Array.from(this.runningTasks.keys());
    }

    /**
     * Validate request context
     */
    protected validateContext(context: RequestContext): void {
        if (!context.taskId) {
            throw new Error('taskId is required in RequestContext');
        }
        if (!context.contextId) {
            throw new Error('contextId is required in RequestContext');
        }
        if (!context.message) {
            throw new Error('message is required in RequestContext');
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
                context.metadata?.streaming === true ||
                context.metadata?.createTask === true;
        }
        return false;
    }

    /**
     * Execute as a task with status updates
     */
    protected async executeAsTask(context: RequestContext, eventBus: ExecutionEventBus): Promise<Task> {
        const startTime = Date.now();
        this.metrics.totalExecutions++;

        // Create or use existing task
        let task = context.existingTask || this.createTask(context);

        if (!context.existingTask) {
            eventBus.publish(task);
        }

        // Setup cancellation
        const abortController = new AbortController();
        this.runningTasks.set(context.taskId, abortController);
        this.taskContexts.set(context.taskId, context);

        // Setup timeout if defined
        if (context.metadata?.timeout) {
            const timeout = setTimeout(() => {
                this.cancelTask(context.taskId).catch(error => {
                    this.logger.error('Failed to cancel task on timeout', error, { taskId: context.taskId });
                });
            }, context.metadata.timeout);
            this.taskTimeouts.set(context.taskId, timeout);
        }

        try {
            // Update status to in-progress
            this.publishStatusUpdate(eventBus, task, 'in-progress');

            // Execute with abort signal
            const executionResult = await this.executeTaskLogic(context, eventBus, abortController.signal);

            // Check if cancelled
            if (abortController.signal.aborted) {
                this.publishStatusUpdate(eventBus, task, 'cancelled', true);
                this.metrics.cancelledExecutions++;

                // Create cancelled result
                const cancelledResult: TaskResult = {
                    taskId: context.taskId,
                    success: false,
                    error: 'Task was cancelled',
                    executedBy: context.agentId || context.metadata?.agentId || 'unknown',
                    executionTime: Date.now() - startTime,
                    timestamp: new Date()
                };
                task.results = cancelledResult;

                return task;
            }

            // Create the complete TaskResult
            const taskResult: TaskResult = {
                taskId: context.taskId,
                success: executionResult.success,
                result: executionResult.result,
                error: executionResult.error ? String(executionResult.error) : undefined,
                executedBy: context.agentId || context.metadata?.agentId || 'unknown',
                executionTime: Date.now() - startTime,
                timestamp: new Date(),
                artifacts: executionResult.artifacts
            };

            // Assign result to task
            task.results = taskResult;
            task.updatedAt = new Date();

            // Update final status
            if (taskResult.success) {
                this.publishStatusUpdate(eventBus, task, 'completed', true);
                this.metrics.successfulExecutions++;
            } else {
                this.publishStatusUpdate(eventBus, task, 'failed', true, taskResult.error);
                this.metrics.failedExecutions++;
            }

            // Publish artifacts if any
            if (taskResult.artifacts && taskResult.artifacts.length > 0) {
                for (let i = 0; i < taskResult.artifacts.length; i++) {
                    const artifact = taskResult.artifacts[i];
                    const isLast = i === taskResult.artifacts.length - 1;
                    this.publishArtifactUpdate(eventBus, task, artifact, isLast);
                }
            }

            return task;

        } catch (error) {
            const executionTime = Date.now() - startTime;

            // Handle execution error
            if (abortController.signal.aborted) {
                this.publishStatusUpdate(eventBus, task, 'cancelled', true);
                this.metrics.cancelledExecutions++;
            } else {
                this.publishStatusUpdate(eventBus, task, 'failed', true, error);
                this.metrics.failedExecutions++;
                eventBus.error(error as Error);
            }

            // Create error result
            const errorResult: TaskResult = {
                taskId: context.taskId,
                success: false,
                error: error instanceof Error ? error.message : String(error),
                executedBy: context.agentId || context.metadata?.agentId || 'unknown',
                executionTime,
                timestamp: new Date()
            };

            task.results = errorResult;
            task.updatedAt = new Date();

            return task;

        } finally {
            // Update metrics
            const executionTime = Date.now() - startTime;
            this.updateExecutionMetrics(executionTime);

            // Clear timeout if exists
            const timeout = this.taskTimeouts.get(context.taskId);
            if (timeout) {
                clearTimeout(timeout);
                this.taskTimeouts.delete(context.taskId);
            }

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
        this.metrics.totalExecutions++;
        const startTime = Date.now();

        try {
            const response = await this.executeMessageLogic(context);
            eventBus.publish(response);
            eventBus.finished();
            this.metrics.successfulExecutions++;
            return response;
        } catch (error) {
            this.metrics.failedExecutions++;
            eventBus.error(error as Error);
            throw error;
        } finally {
            const executionTime = Date.now() - startTime;
            this.updateExecutionMetrics(executionTime);
        }
    }

    /**
     * Update execution metrics
     */
    protected updateExecutionMetrics(executionTime: number): void {
        this.metrics.averageExecutionTime =
            (this.metrics.averageExecutionTime * (this.metrics.totalExecutions - 1) + executionTime)
            / this.metrics.totalExecutions;
        this.metrics.lastExecutionTime = new Date();
    }

    /**
     * Create a new task
     */
    protected createTask(context: RequestContext): Task {
        return {
            id: context.taskId,
            contextId: context.contextId,
            status: {
                state: 'submitted',
                timestamp: new Date().toISOString()
            },
            kind: 'task',
            createdAt: new Date(),
            updatedAt: new Date(),
            executedBy: context.agentId || context.metadata?.agentId,
            metadata: context.metadata
        };
    }

    /**
     * Publish status update event
     */
    protected publishStatusUpdate(
        eventBus: ExecutionEventBus,
        task: Task,
        state: TaskState,
        final: boolean = false,
        error?: any
    ): void {
        const statusUpdate: TaskStatusUpdateEvent = {
            taskId: task.id,
            contextId: task.contextId,
            kind: 'status-update',
            status: {
                state: state,
                timestamp: new Date().toISOString(),
                message: error ? {
                    role: 'agent',
                    parts: [{
                        kind: 'text',
                        text: error instanceof Error ? error.message : String(error)
                    }],
                    messageId: `error-${Date.now()}`,
                    kind: 'message'
                } : undefined
            },
            final,
            metadata: error instanceof Error ? {
                error: error.stack || error.message,
                errorName: error.name
            } : error ? { error: String(error) } : undefined
        };

        task.status = statusUpdate.status;
        task.updatedAt = new Date();
        eventBus.publish(statusUpdate);
    }

    /**
     * Publish progress update (helper method)
     */
    protected publishProgressUpdate(
        eventBus: ExecutionEventBus,
        task: Task,
        progress: number, // 0-100
        message?: string
    ): void {
        const statusUpdate: TaskStatusUpdateEvent = {
            taskId: task.id,
            contextId: task.contextId,
            kind: 'status-update',
            status: {
                state: 'in-progress',
                timestamp: new Date().toISOString(),
                message: message ? {
                    role: 'agent',
                    parts: [{
                        kind: 'text',
                        text: message
                    }],
                    messageId: `progress-${Date.now()}`,
                    kind: 'message'
                } : undefined
            },
            final: false,
            metadata: {
                progress,
                progressPercentage: `${Math.round(progress)}%`
            }
        };

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
        task.updatedAt = new Date();

        eventBus.publish(artifactUpdate);
    }

    /**
     * Check if task is cancelled (helper method)
     */
    protected isTaskCancelled(signal: AbortSignal): boolean {
        return signal.aborted;
    }

    /**
     * Abstract method - implement task execution logic
     * Returns partial result that will be completed into TaskResult
     */
    protected abstract executeTaskLogic(
        context: RequestContext,
        eventBus: ExecutionEventBus,
        signal: AbortSignal
    ): Promise<InternalExecutionResult>;

    /**
     * Abstract method - implement message execution logic
     */
    protected abstract executeMessageLogic(context: RequestContext): Promise<Message>;

    /**
     * Get executor capabilities (optional)
     */
    getCapabilities?(): AgentCapability[];
}