// packages/core/src/types/index.ts
export interface TriProtocolConfig {
    protocols: {
        a2a?: A2AConfig;
        langgraph?: LangGraphConfig;
        mcp?: MCPConfig;
    };
    runtime?: RuntimeConfig;
}

export interface A2AConfig {
    enabled: boolean;
    endpoint?: string;
    port?: number;
}

export interface LangGraphConfig {
    enabled: boolean;
    checkpointStorage?: 'memory' | 'sqlite' | 'postgres';
    maxConcurrentWorkflows?: number;
}

export interface MCPConfig {
    enabled: boolean;
    tools?: string[];
    resourcePath?: string;
}

export interface RuntimeConfig {
    monitoring?: boolean;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
    performance?: {
        maxMemoryMB?: number;
        timeoutMs?: number;
    };
}

export interface AgentCapability {
    id: string;
    name: string;
    description: string;
    category: 'analysis' | 'action' | 'monitoring' | 'creative';
}

export interface TriAgentConfig {
    id?: string;
    name: string;
    capabilities?: AgentCapability[];
    // protocols?: {
    //     a2a?: boolean;
    //     langgraph?: boolean;
    //     mcp?: string[];
    // };
    protocols?: TriProtocolConfig;
}