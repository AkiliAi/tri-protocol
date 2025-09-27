import { EventEmitter } from 'eventemitter3';
import { TriAgent, TriWorkflow } from './core-types';
import { MetricExporter } from '../metrics';

export interface SDKConfig {
  mode?: 'development' | 'production';
  simple?: boolean;  // Enable simple mode (no network features, minimal config)

  persistence?: {
    enabled?: boolean;
    backend?: 'memory' | 'file' | 'mongodb' | 'postgres' | 'redis' | 'cloud'|'qdrant';
    config?: any;
  };

  llm?: {
    provider?: 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'mistral' | 'huggingface';
    apiKey?: string;
    model?: string;
    endpoint?: string;
    temperature?: number;
    maxTokens?: number;
  };

  protocols?: {
    a2a?: boolean | A2AConfig;
    mcp?: boolean | MCPConfig;
    langgraph?: boolean | LangGraphConfig;
  };

  metrics?: {
    enabled?: boolean;
    collectInterval?: number;
    persistence?: 'memory' | 'redis' | 'prometheus';
    exporters?: MetricExporter[];
  };

  advanced?: {
    customConfig?: any;
    plugins?: Plugin[];
    middleware?: Middleware[];
    hooks?: Hooks;
  };

  logging?: {
    level?: 'debug' | 'info' | 'warn' | 'error';
    enabled?: boolean;
  };
}

export interface A2AConfig {
  enabled: boolean;
  lazy?: boolean;  // Enable lazy mode (skip network initialization)
  discovery?: boolean | 'local' | 'registry' | 'hybrid';  // Support boolean or string
  enableP2P?: boolean;  // Enable P2P discovery (default false)
  discoveryTimeout?: number;  // Timeout for discovery operations
  security?: {
    auth?: 'none' | 'api-key' | 'oauth2' | 'mtls';
    encryption?: boolean;
  };
}

export interface MCPConfig {
  enabled: boolean;
  servers?: MCPServerConfig[];
}

export interface MCPServerConfig {
  name: string;
  url: string;
  apiKey?: string;
}

export interface LangGraphConfig {
  enabled: boolean;
  checkpointer?: 'memory' | 'file' | 'database';
}

export interface Plugin {
  name: string;
  version?: string;
  install: (sdk: any) => Promise<void>;
}

export interface Middleware {
  name: string;
  pre?: (context: any) => Promise<void>;
  post?: (context: any, result: any) => Promise<any>;
}

export interface Hooks {
  onAgentCreated?: (agent: SDKAgent) => void;
  onWorkflowCreated?: (workflow: SDKWorkflow) => void;
  onError?: (error: Error) => void;
  onLLMCall?: (prompt: string, response: string) => void;
}

export interface SDKAgent extends EventEmitter {
  id: string;
  name: string;
  description?: string;
  capabilities: string[];
  tools: string[];
  memory?: MemoryConfig;

  initialize(): Promise<void>;
  respond(input: string, context?: any): Promise<string>;
  think(prompt: string): Promise<string>;
  execute(task: any): Promise<any>;
  addCapability(capability: string | AgentCapability): Promise<void>;
  addTool(tool: string | ToolDefinition): Promise<void>;
  enableMemory(config: MemoryConfig): Promise<void>;
  communicate(agentId: string, message: any): Promise<any>;
  getState(): AgentState;
}

export interface SDKWorkflow extends EventEmitter {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];

  execute(input: any): Promise<any>;
  getStatus(): WorkflowStatus;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
}

export interface AgentConfig {
  name?: string;
  description?: string;
  systemPrompt?: string;
  llm?: any;
  enableA2A?: boolean;
  enableMCP?: boolean;
  enableLangGraph?: boolean;
  capabilities?: string[];
  tools?: string[];
  memory?: MemoryConfig;
}

export interface MemoryConfig {
  enabled: boolean;
  type: 'short' | 'long' | 'both';
  ttl?: number;
  maxEntries?: number;
}

export interface WorkflowConfig {
  name: string;
  description?: string;
  timeout?: number;
  retries?: number;
  checkpointing?: boolean;
}

export interface WorkflowNode {
  id: string;
  type: 'task' | 'agent' | 'tool' | 'condition' | 'parallel-start' | 'parallel-end' | 'loop-start' | 'loop-end';
  config?: any;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  type?: 'sequential' | 'conditional' | 'loop';
  condition?: string;
}

export interface AgentCapability {
  name: string;
  description?: string;
  handler?: (input: any) => Promise<any>;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  parameters?: any;
  handler?: (args: any) => Promise<any>;
}

export interface AgentState {
  status: 'idle' | 'thinking' | 'executing' | 'communicating';
  currentTask?: any;
  memory?: any;
}

export interface WorkflowStatus {
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  progress?: number;
  currentNode?: string;
  error?: any;
}

export interface SearchOptions {
  limit?: number;
  threshold?: number;
  metadata?: any;
}

export interface TestCase {
  name: string;
  input: any;
  expectedOutput?: any;
  validate?: (output: any) => boolean;
}

export interface TestResult {
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  output?: any;
  error?: any;
}

export interface QueryAnalysis {
  type: 'agent' | 'workflow' | 'llm';
  capability?: string;
  workflow?: string;
  confidence: number;
}

export class SDKError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'SDKError';
  }
}

export interface AgentTemplate {
  name: string;
  description: string;
  create: (sdk: any) => Promise<SDKAgent>;
}

export interface WorkflowTemplate {
  name: string;
  description: string;
  create: (sdk: any) => Promise<SDKWorkflow>;
}