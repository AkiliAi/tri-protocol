/**
 * Tri-Protocol SDK
 * Official SDK for building sophisticated multi-agent systems
 */

// Main SDK class
export { TriProtocolSDK } from './TriProtocolSDK';

// Client
export { TriProtocolClient } from './client';
export type { LLMClient, AgentManagementClient, WorkflowManagementClient } from './client';

// Builders
export { AgentBuilder, WorkflowBuilder, BranchBuilder } from './builders';
export { SDKAgentImpl, SDKWorkflowImpl } from './builders';

// Templates
export {
  ChatAgentTemplate,
  ResearchAgentTemplate,
  AnalystAgentTemplate,
  AssistantAgentTemplate
} from './templates/agents';

export {
  DataPipelineTemplate,
  RAGPipelineTemplate,
  MultiAgentChatTemplate
} from './templates/workflows';

// Decorators
export {
  Agent,
  Capability,
  Tool,
  Memory,
  InjectSDK,
  InjectProtocol,
  On,
  Before,
  After,
  Context,
  Workflow,
  Step,
  Parallel,
  Conditional,
  Loop,
  Edge,
  ErrorHandler,
  OnComplete,
  OnInit,
  extractAgentMetadata,
  extractWorkflowMetadata
} from './decorators';

// Utils
export { Validators, Serializers } from './utils';

// Types
export {
  SDKConfig,
  SDKAgent,
  SDKWorkflow,
  AgentConfig,
  WorkflowConfig,
  MemoryConfig,
  AgentCapability,
  ToolDefinition,
  AgentState,
  WorkflowStatus,
  WorkflowNode,
  WorkflowEdge,
  Plugin,
  Middleware,
  Hooks,
  SearchOptions,
  QueryAnalysis,
  TestCase,
  TestResult,
  SDKError,
  AgentTemplate,
  WorkflowTemplate,
  A2AConfig,
  MCPConfig,
  MCPServerConfig,
  LangGraphConfig
} from './types';

// Import for quick start helper
import { TriProtocolSDK as SDK } from './TriProtocolSDK';

// Quick start helper
export async function createSDK(config?: any): Promise<SDK> {
  return SDK.initialize(config);
}

// Default export for convenience
export default SDK;