/**
 * Example: Agent with MCP Integration
 * Demonstrates how to create an agent with MCP capabilities
 * and connect it to various MCP servers for tool access
 */

import { TriAgent, TriAgentConfig } from '../core';
import { TriProtocol } from '../core';
import { TriRegistry } from '../core';
import { TriOrchestrator } from '../core';
import { Logger } from '../logger';
import {
    Message,
    Task,
    AgentCapability,
    AgentStatus
} from 'protocols/dist';
import type {
    MCPServerConnection,
    ToolExecutionResponse
} from 'protocols/dist/mcp';

/**
 * Custom Data Analyst Agent with MCP capabilities
 */
class DataAnalystAgent extends TriAgent {
    private analysisResults: Map<string, any> = new Map();

    constructor() {
        const config: TriAgentConfig = {
            id: 'data-analyst-001',
            name: 'DataAnalyst',
            type: 'analyst',
            description: 'Agent that analyzes data using MCP tools',
            capabilities: [
                {
                    name: 'data_analysis',
                    description: 'Analyze data from various sources',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            source: { type: 'string' },
                            query: { type: 'string' }
                        }
                    },
                    outputSchema: {
                        type: 'object',
                        properties: {
                            result: { type: 'any' }
                        }
                    }
                },
                {
                    name: 'file_processing',
                    description: 'Process files using filesystem MCP server',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            path: { type: 'string' },
                            operation: { type: 'string' }
                        }
                    },
                    outputSchema: {
                        type: 'object',
                        properties: {
                            status: { type: 'string' },
                            data: { type: 'any' }
                        }
                    }
                }
            ],
            enableMCP: true,
            mcpConfig: {
                enabled: true,
                autoDiscoverTools: true,
                enableToolCaching: true,
                verboseLogging: true,
                maxConcurrentExecutions: 5
            }
        };

        super(config);
        this.setupMCPHandlers();
    }

    /**
     * Setup MCP-specific event handlers
     */
    private setupMCPHandlers(): void {
        this.on('mcp:server:connected', (serverName, capabilities) => {
            this.logger.info(`✅ MCP server connected: ${serverName}`, { capabilities });
        });

        this.on('mcp:tool:executed', (response: ToolExecutionResponse) => {
            this.logger.info(`🔧 Tool executed: ${response.toolName}`, {
                success: response.success,
                duration: `${response.duration}ms`
            });
        });

        this.on('mcp:error', (error, context) => {
            this.logger.error('❌ MCP error occurred', error, context);
        });
    }

    /**
     * Connect to MCP servers on agent startup
     */
    async onConnect(): Promise<void> {
        this.logger.info('Connecting to MCP servers...');

        // Connect to filesystem MCP server
        try {
            await this.connectToFilesystemServer();
        } catch (error) {
            this.logger.error('Failed to connect to filesystem server', error);
        }

        // Connect to GitHub MCP server (if needed)
        try {
            await this.connectToGitHubServer();
        } catch (error) {
            this.logger.error('Failed to connect to GitHub server', error);
        }

        // Discover available tools
        await this.discoverAvailableTools();
    }

    /**
     * Connect to filesystem MCP server
     */
    private async connectToFilesystemServer(): Promise<void> {
        const connection: MCPServerConnection = {
            name: 'filesystem',
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/data'],
            env: {
                NODE_ENV: 'production'
            },
            autoReconnect: true,
            maxReconnectAttempts: 3
        };

        await this.connectMCPServer(connection);
        this.logger.info('Connected to filesystem MCP server');
    }

    /**
     * Connect to GitHub MCP server
     */
    private async connectToGitHubServer(): Promise<void> {
        const connection: MCPServerConnection = {
            name: 'github',
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: {
                GITHUB_TOKEN: process.env.GITHUB_TOKEN || ''
            },
            autoReconnect: true
        };

        if (!process.env.GITHUB_TOKEN) {
            this.logger.warn('GITHUB_TOKEN not set, skipping GitHub MCP server');
            return;
        }

        await this.connectMCPServer(connection);
        this.logger.info('Connected to GitHub MCP server');
    }

    /**
     * Discover and log available tools
     */
    private async discoverAvailableTools(): Promise<void> {
        const tools = this.getAvailableTools();
        
        this.logger.info(`Discovered ${tools.length} tools:`);
        tools.forEach(tool => {
            this.logger.info(`  - ${tool.name}: ${tool.description}`, {
                server: tool.serverName
            });
        });
    }

    /**
     * Process incoming messages
     */
    async processMessage(message: Message): Promise<Message> {
        this.logger.info('Processing message', { messageId: message.messageId });

        // Extract command from message
        const content = message.parts[0]?.data;
        
        if (typeof content === 'object' && content.command) {
            switch (content.command) {
                case 'analyze_file':
                    return await this.analyzeFile(content.path);
                
                case 'list_files':
                    return await this.listFiles(content.directory);
                
                case 'get_tools':
                    return this.getToolsList();
                
                case 'execute_tool':
                    return await this.executeSpecificTool(content.tool, content.args);
                
                default:
                    return this.createResponse('Unknown command', message.messageId);
            }
        }

        return this.createResponse('No command specified', message.messageId);
    }

    /**
     * Analyze a file using MCP tools
     */
    private async analyzeFile(path: string): Promise<Message> {
        try {
            // Use filesystem tool to read the file
            const result = await this.useTool('filesystem:read_file', { path });
            
            if (result.success) {
                // Store analysis result
                this.analysisResults.set(path, result.result);
                
                return this.createResponse({
                    status: 'success',
                    message: `File analyzed: ${path}`,
                    data: result.result
                });
            } else {
                return this.createResponse({
                    status: 'error',
                    message: `Failed to analyze file: ${result.error}`
                });
            }
        } catch (error) {
            return this.createResponse({
                status: 'error',
                message: `Error analyzing file: ${error}`
            });
        }
    }

    /**
     * List files in a directory
     */
    private async listFiles(directory: string): Promise<Message> {
        try {
            const result = await this.useTool('filesystem:list_directory', { 
                path: directory 
            });
            
            if (result.success) {
                return this.createResponse({
                    status: 'success',
                    files: result.result
                });
            } else {
                return this.createResponse({
                    status: 'error',
                    message: `Failed to list files: ${result.error}`
                });
            }
        } catch (error) {
            return this.createResponse({
                status: 'error',
                message: `Error listing files: ${error}`
            });
        }
    }

    /**
     * Get list of available tools
     */
    private getToolsList(): Message {
        const tools = this.getAvailableTools();
        
        return this.createResponse({
            status: 'success',
            tools: tools.map(t => ({
                name: t.name,
                description: t.description,
                server: t.serverName
            }))
        });
    }

    /**
     * Execute a specific tool
     */
    private async executeSpecificTool(toolName: string, args: any): Promise<Message> {
        try {
            const result = await this.useTool(toolName, args);
            
            return this.createResponse({
                status: result.success ? 'success' : 'error',
                result: result.result,
                error: result.error,
                duration: result.duration
            });
        } catch (error) {
            return this.createResponse({
                status: 'error',
                message: `Error executing tool: ${error}`
            });
        }
    }

    /**
     * Create a response message
     */
    private createResponse(content: any, correlationId?: string): Message {
        return {
            role: 'agent',
            parts: [{
                kind: 'data',
                data: content
            }],
            messageId: `${this.config.id}-${Date.now()}`,
            correlationId,
            kind: 'message'
        };
    }

    /**
     * Process tasks (required by abstract class)
     */
    async processTask(task: Task): Promise<void> {
        this.logger.info('Processing task', { taskId: task.id });
        
        // Task processing logic here
        // Could involve using multiple MCP tools in sequence
    }

    /**
     * Custom tool selection logic
     */
    protected selectTool(tools: any[], context?: any): string | null {
        // Implement custom logic to select the best tool based on context
        if (context?.type === 'file_operation') {
            return tools.find(t => t.serverName === 'filesystem')?.name || null;
        }
        
        // Default to first available tool
        return tools[0]?.name || null;
    }
}

/**
 * Collaborative Agent that works with DataAnalyst
 */
class CollaboratorAgent extends TriAgent {
    constructor() {
        const config: TriAgentConfig = {
            id: 'collaborator-001',
            name: 'Collaborator',
            type: 'assistant',
            description: 'Agent that collaborates with DataAnalyst',
            capabilities: [
                {
                    name: 'request_analysis',
                    description: 'Request data analysis from DataAnalyst',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            query: { type: 'string' }
                        }
                    },
                    outputSchema: {
                        type: 'object',
                        properties: {
                            result: { type: 'any' }
                        }
                    }
                }
            ],
            enableMCP: false // This agent doesn't need MCP
        };

        super(config);
    }

    async processMessage(message: Message): Promise<Message> {
        this.logger.info('Collaborator processing message', { 
            messageId: message.messageId 
        });

        // Process collaboration requests
        return {
            role: 'agent',
            parts: [{
                kind: 'data',
                data: { status: 'processed' }
            }],
            messageId: `${this.config.id}-${Date.now()}`,
            kind: 'message'
        };
    }

    async processTask(task: Task): Promise<void> {
        this.logger.info('Collaborator processing task', { taskId: task.id });
    }
}

/**
 * Main execution
 */
async function main() {
    const logger = Logger.getLogger('MCPExample');
    
    try {
        // Initialize Tri-Protocol components
        logger.info('🚀 Starting MCP Integration Example');
        
        const registry = new TriRegistry();
        const protocol = new TriProtocol();
        const orchestrator = new TriOrchestrator();

        // Initialize protocol with registry
        await protocol.initialize(registry);

        // Create agents
        const dataAnalyst = new DataAnalystAgent();
        const collaborator = new CollaboratorAgent();

        // Connect agents to protocol
        await dataAnalyst.connect(protocol);
        await collaborator.connect(protocol);

        // Trigger MCP server connections
        await dataAnalyst.onConnect();

        // Wait a moment for connections to establish
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Example 1: Collaborator requests analysis from DataAnalyst
        logger.info('\n📊 Example 1: Request file analysis');
        const analysisRequest = await collaborator.sendToAgent('data-analyst-001', {
            command: 'analyze_file',
            path: '/tmp/data/sample.json'
        });
        logger.info('Analysis response:', analysisRequest);

        // Example 2: Get available tools
        logger.info('\n🔧 Example 2: Get available tools');
        const toolsRequest = await collaborator.sendToAgent('data-analyst-001', {
            command: 'get_tools'
        });
        logger.info('Available tools:', toolsRequest);

        // Example 3: List files in directory
        logger.info('\n📁 Example 3: List files');
        const filesRequest = await collaborator.sendToAgent('data-analyst-001', {
            command: 'list_files',
            directory: '/tmp/data'
        });
        logger.info('Files list:', filesRequest);

        // Get MCP statistics
        logger.info('\n📈 MCP Statistics:');
        const stats = dataAnalyst.getMCPStats();
        logger.info('Stats:', stats);

        // Keep the example running for a bit
        logger.info('\n✅ Example running successfully. Press Ctrl+C to exit.');
        
        // Graceful shutdown handler
        process.on('SIGINT', async () => {
            logger.info('\n🛑 Shutting down...');
            
            await dataAnalyst.disconnect();
            await collaborator.disconnect();
            await protocol.shutdown();
            
            logger.info('Shutdown complete');
            process.exit(0);
        });

        // Keep process alive
        await new Promise(() => {});

    } catch (error) {
        logger.error('Example failed', error);
        process.exit(1);
    }
}

// Run the example
if (require.main === module) {
    main().catch(console.error);
}

export { DataAnalystAgent, CollaboratorAgent };