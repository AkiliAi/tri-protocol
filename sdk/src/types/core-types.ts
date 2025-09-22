/**
 * Core types declarations for SDK
 * These are temporary types to avoid circular dependencies during compilation
 */

import { EventEmitter } from 'eventemitter3';

// TriProtocol types
export interface TriProtocolConfig {
  persistence?: any;
  llm?: any;
  protocols?: any;
}

export class TriProtocol {
  constructor(config?: TriProtocolConfig) {}
  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}
  getRegistry(): TriRegistry { return new TriRegistry(); }
  getOrchestrator(): TriOrchestrator { return new TriOrchestrator(); }
  getPersistence(): PersistenceManager | null { return null; }
  getLLMService(): any { return {}; }
  getEmbeddingService(): any { return {}; }
  getProtocol(name: string): any { return null; }
  registerAgent(agent: TriAgent): Promise<void> { return Promise.resolve(); }
}

// TriAgent types
export class TriAgent {
  id: string;
  name: string;
  capabilities: string[];
  metadata?: any;

  constructor(config: any) {
    this.id = config.id;
    this.name = config.name;
    this.capabilities = config.capabilities || [];
    this.metadata = config.metadata;
  }
}

// TriRegistry types
export class TriRegistry {
  async list(): Promise<any[]> { return []; }
  async get(id: string): Promise<any> { return null; }
  async register(agent: TriAgent): Promise<void> {}
  async unregister(id: string): Promise<void> {}
}

// TriOrchestrator types
export class TriOrchestrator {
  async executeTask(task: any): Promise<any> { return {}; }
  async executeWorkflow(workflow: any, input: any): Promise<any> { return {}; }
  async getTaskStatus(id: string): Promise<any> { return {}; }
  async listWorkflows(): Promise<any[]> { return []; }
}

// TriWorkflow types
export class TriWorkflow {
  id: string;
  name: string;
  nodes: any[];
  edges: any[];

  constructor(config: any) {
    this.id = config.id;
    this.name = config.name;
    this.nodes = config.nodes || [];
    this.edges = config.edges || [];
  }
}

// PersistenceManager types
export class PersistenceManager {
  async save(collection: string, key: string, value: any): Promise<void> {}
  async load(collection: string, key: string): Promise<any> { return null; }
  async searchSimilar(query: string, options?: any): Promise<any[]> { return []; }
}

// Export all
export default {
  TriProtocol,
  TriAgent,
  TriRegistry,
  TriOrchestrator,
  TriWorkflow,
  PersistenceManager
};