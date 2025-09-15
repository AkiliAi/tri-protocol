/*
    Index file for the core module of the Tri Protocol.
 */

// core/src/index.ts
export { TriProtocol, TriProtocolConfig } from './TriProtocol';
export { TriAgent, TriAgentConfig } from './TriAgent';
export { TriRegistry, RegistryEntry } from './TriRegistry';
export { TriOrchestrator } from './TriOrchestrator';
export { TriWorkflow } from './TriWorkflow';

// Export LLM Service
export * from './services/llm';

// Re-export A2A types for convenience
export * from '../../protocols/src/a2a/types';