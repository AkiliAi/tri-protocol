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

// Export Persistence Layer
export {
    PersistenceManager,
    PersistenceConfig,
    WorkflowDefinition,
    WorkflowExecution,
    AgentMemory,
    SearchQuery,
    RedisConfig,
    PostgresConfig,
    MongoConfig,
    QdrantConfig,
    RoutingRule
} from './persistence/PersistenceManager';

export * from './persistence/interfaces/IPersistenceAdapter';
export * from './persistence/interfaces/ICacheAdapter';
export * from './persistence/interfaces/IDocumentAdapter';
export * from './persistence/interfaces/IVectorAdapter';
export * from './persistence/interfaces/IRelationalAdapter';

// Re-export A2A types for convenience
export * from '../../protocols/src/a2a/types';