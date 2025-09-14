import { BaseMessage } from '@langchain/core/messages';

// Core workflow types
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  stateSchema: StateSchema;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryPoint: string;
  conditionalRouting?: ConditionalRoute[];
  config?: WorkflowConfig;
}

export interface StateSchema {
  [key: string]: {
    value: any;
    default?: any;
  };
}

export interface WorkflowNode {
  id: string;
  type: 'agent' | 'tool' | 'llm' | 'human' | 'custom';
  name: string;
  function: NodeFunction;
  retryPolicy?: RetryPolicy;
  timeout?: number;
  metadata?: Record<string, any>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: EdgeCondition;
}

export interface WorkflowState {
  [key: string]: any;
  messages?: BaseMessage[];
  context?: Record<string, any>;
  currentNode?: string;
  history?: ExecutionHistory[];
  error?: Error;
}

export type NodeFunction = (state: WorkflowState) => Promise<Partial<WorkflowState>>;

export type EdgeCondition = (state: WorkflowState) => boolean | string;

export interface ConditionalRoute {
  source: string;
  conditions: Array<{
    condition: (state: WorkflowState) => boolean;
    target: string;
  }>;
  default: string;
}

export interface WorkflowConfig {
  maxRetries?: number;
  timeout?: number;
  checkpointInterval?: number;
  parallelLimit?: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffStrategy?: 'linear' | 'exponential';
  initialDelay?: number;
  maxDelay?: number;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  state: WorkflowState;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  startTime: Date;
  endTime?: Date;
  checkpoints: Checkpoint[];
  metrics: ExecutionMetrics;
  error?: Error;
}

export interface Checkpoint {
  id: string;
  state: WorkflowState;
  timestamp: Date;
  nodeId?: string;
}

export interface ExecutionHistory {
  nodeId: string;
  timestamp: Date;
  duration?: number;
  status: 'success' | 'failure' | 'skipped';
  input?: any;
  output?: any;
  error?: Error;
}

export interface ExecutionMetrics {
  nodesExecuted: number;
  executionTime: number;
  retryCount?: number;
  errorCount?: number;
}

export interface CompiledWorkflow {
  definition: WorkflowDefinition;
  graph: any; // StateGraph instance
  compiled: any; // Compiled graph
}

export interface WorkflowInfo {
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  status?: 'active' | 'inactive';
  lastExecuted?: Date;
}

export interface ExecutionConfig {
  recursionLimit?: number;
  timeout?: number;
  checkpointing?: boolean;
  streaming?: boolean;
  metadata?: Record<string, any>;
}

export interface LangGraphConfig {
  a2aAdapter?: any;
  mcpAdapter?: any;
  checkpointer?: any;
  maxConcurrentWorkflows?: number;
  defaultTimeout?: number;
}

// Integration types
export interface A2AIntegration {
  sendMessage(agentId: string, message: any): Promise<any>;
  broadcast(message: any): Promise<any>;
  getAgents(): Promise<string[]>;
}

export interface MCPIntegration {
  executeTool(toolName: string, args: any): Promise<any>;
  listTools(): Promise<string[]>;
  getToolSchema(toolName: string): Promise<any>;
}

// Stream types
export interface StreamOutput {
  nodeId: string;
  output: any;
  timestamp: Date;
}

export interface HumanInputRequest {
  nodeId: string;
  prompt?: string;
  options?: string[];
  timeout?: number;
  state: WorkflowState;
}

export interface HumanInputResponse {
  nodeId: string;
  input: any;
  timestamp: Date;
  userId?: string;
}

// Error types
export class WorkflowError extends Error {
  constructor(
    message: string,
    public code: string,
    public nodeId?: string,
    public workflowId?: string
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export class NodeExecutionError extends WorkflowError {
  constructor(
    message: string,
    nodeId: string,
    public originalError?: Error
  ) {
    super(message, 'NODE_EXECUTION_ERROR', nodeId);
    this.name = 'NodeExecutionError';
  }
}

export class WorkflowTimeoutError extends WorkflowError {
  constructor(workflowId: string, timeout: number) {
    super(`Workflow ${workflowId} timed out after ${timeout}ms`, 'WORKFLOW_TIMEOUT', undefined, workflowId);
    this.name = 'WorkflowTimeoutError';
  }
}