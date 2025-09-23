/**
 * SDK Templates
 * Re-export all agent and workflow templates
 */

// Agent Templates
export {
  ChatAgentTemplate,
  AssistantAgentTemplate,
  ResearchAgentTemplate,
  AnalystAgentTemplate
} from './agents';

// Workflow Templates
export {
  DataPipelineTemplate,
  MultiAgentChatTemplate,
  RAGPipelineTemplate
} from './workflows';

// Template types
export type AgentTemplate = 'assistant' | 'researcher' | 'analyst' | 'coder' | 'chat';
export type WorkflowTemplate = 'data-pipeline' | 'research' | 'rag-pipeline' | 'multi-agent';

// Template Registry
export const AgentTemplates = {
  assistant: 'AssistantAgent',
  researcher: 'ResearchAgent',
  analyst: 'AnalystAgent',
  coder: 'CoderAgent', // Not yet implemented
  chat: 'ChatAgent'
} as const;

export const WorkflowTemplates = {
  'data-pipeline': 'DataPipeline',
  'research': 'ResearchWorkflow', // Not yet implemented
  'rag-pipeline': 'RAGPipeline',
  'multi-agent': 'MultiAgentChat'
} as const;