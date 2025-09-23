/**
 * Protocol types declarations for SDK
 * These are temporary types to avoid circular dependencies during compilation
 */

// A2A Protocol
export class A2AProtocol {
  async initialize(): Promise<void> {}
  async sendMessage(agentId: string, message: any): Promise<any> { return {}; }
  async execute(command: any): Promise<any> { return {}; }
}

// MCP Adapter
export class MCPAdapter {
  async initialize(): Promise<void> {}
  async registerTool(tool: any): Promise<void> {}
  async execute(command: any): Promise<any> { return {}; }
}

// LangGraph Adapter
export class LangGraphAdapter {
  async initialize(): Promise<void> {}
  async execute(command: any): Promise<any> { return {}; }
}

// Logger
export class LoggerManager {
  static getLogger(name: string): any {
    return {
      info: (...args: any[]) => console.log('[INFO]', ...args),
      debug: (...args: any[]) => console.log('[DEBUG]', ...args),
      warn: (...args: any[]) => console.warn('[WARN]', ...args),
      error: (...args: any[]) => console.error('[ERROR]', ...args)
    };
  }
}