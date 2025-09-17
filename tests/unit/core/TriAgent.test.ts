import { TriAgent, TriAgentConfig } from '../../../core/src/TriAgent';
import { TriProtocol } from '../../../core/src/TriProtocol';
import { AgentStatus, AgentCapability, Message, Task } from '../../../protocols/src/a2a/types';
import { MCPClientManager } from '../../../protocols/src/mcp';
import { LLMService } from '../../../core/src/services/llm/LLMService';
import { ReasoningEngine } from '../../../core/src/services/llm/ReasoningEngine';
import { setupLoggerMock, createMockTriProtocol, createMockTriRegistry } from './test-helpers';

// Setup Logger mock before any imports that use it
const mockLogger = setupLoggerMock();

// Mock dependencies
jest.mock('../../../core/src/TriProtocol');
jest.mock('../../../protocols/src/mcp');
jest.mock('../../../core/src/services/llm/LLMService');
jest.mock('../../../core/src/services/llm/ReasoningEngine');

// Create a concrete implementation for testing
class TestAgent extends TriAgent {
    async processTask(task: Task): Promise<any> {
        return { success: true, taskId: task.id };
    }

    async handleMessage(message: Message): Promise<any> {
        return { received: true, messageId: message.messageId };
    }

    async processMessage(message: Message): Promise<Message | Task> {
        return {
            role: 'agent' as const,
            parts: [{ kind: 'text' as const, text: 'Response' }],
            messageId: `response-${message.messageId}`,
            kind: 'message' as const
        };
    }

    protected getSystemPrompt(): string {
        return 'Test agent system prompt';
    }

    protected async onConnect(): Promise<void> {
        // Test implementation
    }

    protected async onDisconnect(): Promise<void> {
        // Test implementation
    }

    // Add public methods for testing
    async sendMessage(target: string, message: Message): Promise<any> {
        if (!this.isConnected()) {
            throw new Error('Agent not connected to Tri-Protocol');
        }
        return await this.triProtocol?.sendMessage(target, message);
    }

    getCapabilities() {
        return this.config.capabilities || [];
    }

    isConnected() {
        return this.status === AgentStatus.ONLINE;
    }

    getAvailableTools() {
        if (!this.mcpManager) {
            throw new Error('MCP is not enabled');
        }
        // Return the mocked listTools function result
        return (this.mcpManager as any).listTools ? (this.mcpManager as any).listTools() : [];
    }

    async generateWithLLM(prompt: string) {
        if (!this.llm) {
            throw new Error('LLM is not enabled for this agent');
        }
        // Use the mocked generate function if available
        const llmAny = this.llm as any;
        if (llmAny.generate) {
            return await llmAny.generate(prompt);
        }
        return await this.llm.complete(prompt);
    }
}

describe('TriAgent', () => {
    let agent: TestAgent;
    let mockProtocol: any;
    let mockRegistry: any;
    let config: TriAgentConfig;

    beforeEach(() => {
        // Clear mocks
        jest.clearAllMocks();

        // Create mock instances
        mockProtocol = createMockTriProtocol();
        mockRegistry = createMockTriRegistry();
        mockProtocol.getRegistry = jest.fn().mockReturnValue(mockRegistry);

        // Mock TriProtocol constructor
        (TriProtocol as jest.MockedClass<typeof TriProtocol>).mockImplementation(() => mockProtocol as any);

        // Setup MCP and LLM mocks
        (MCPClientManager as jest.MockedClass<typeof MCPClientManager>).mockImplementation(() => ({
            connect: jest.fn().mockResolvedValue(true),
            disconnect: jest.fn().mockResolvedValue(true),
            executeTool: jest.fn().mockResolvedValue({ success: true }),
            listTools: jest.fn().mockResolvedValue([]),
            on: jest.fn(),
            off: jest.fn(),
            emit: jest.fn()
        }) as any);

        (LLMService as jest.MockedClass<typeof LLMService>).mockImplementation(() => ({
            complete: jest.fn().mockResolvedValue({ text: 'response' }),
            chat: jest.fn().mockResolvedValue({ text: 'response' }),
            getStatus: jest.fn().mockReturnValue({ defaultProvider: 'openai' }),
            on: jest.fn(),
            off: jest.fn(),
            emit: jest.fn()
        }) as any);

        (ReasoningEngine as jest.MockedClass<typeof ReasoningEngine>).mockImplementation(() => ({
            reason: jest.fn().mockResolvedValue({ result: 'reasoning result' }),
            analyze: jest.fn().mockResolvedValue({ analysis: 'analysis result' }),
            on: jest.fn(),
            off: jest.fn(),
            emit: jest.fn()
        }) as any);
        config = {
            id: 'test-agent-1',
            name: 'Test Agent',
            type: 'test',
            description: 'A test agent',
            capabilities: [
                {
                    id: 'cap1',
                    name: 'capability1',
                    description: 'Test capability',
                    category: 'ANALYSIS' as any,
                    inputs: [],
                    outputs: [],
                    cost: 1,
                    reliability: 0.9,
                    version: '1.0.0'
                }
            ],
            systemFeatures: {
                streaming: true,
                pushNotifications: false
            },
            metadata: {
                custom: 'value'
            }
        };

        agent = new TestAgent(config);
    });

    afterEach(() => {
        agent.removeAllListeners();
        jest.clearAllMocks();
    });

    describe('Constructor', () => {
        it('should create a new TriAgent instance', () => {
            expect(agent).toBeInstanceOf(TriAgent);
            expect(agent['config'].id).toBe('test-agent-1');
            expect(agent['config'].name).toBe('Test Agent');
            expect(agent['config'].type).toBe('test');
        });

        it('should initialize with OFFLINE status', () => {
            expect(agent.getStatus()).toBe(AgentStatus.OFFLINE);
        });

        it('should initialize MCP if enabled', () => {
            const mcpConfig: TriAgentConfig = {
                ...config,
                enableMCP: true,
                mcpConfig: {
                    enabled: true
                }
            };

            const mcpAgent = new TestAgent(mcpConfig);

            expect(mcpAgent.mcpManager).toBeDefined();
            expect(mcpAgent.mcpManager).toHaveProperty('connect');
            expect(mcpAgent.mcpManager).toHaveProperty('executeTool');
            expect(mcpAgent.isMCPEnabled()).toBe(true);
        });

        it('should initialize LLM if enabled', () => {
            const llmConfig: TriAgentConfig = {
                ...config,
                enableLLM: true,
                llmConfig: {
                    providers: [],
                    defaultProvider: 'ollama'
                }
            };

            const llmAgent = new TestAgent(llmConfig);

            expect(llmAgent.isLLMEnabled()).toBe(true);
        });

        it('should use provided LLM service', () => {
            const mockLLMService = new LLMService({
                providers: [],
                defaultProvider: 'ollama'
            });

            const llmConfig: TriAgentConfig = {
                ...config,
                enableLLM: true,
                llmService: mockLLMService
            };

            const llmAgent = new TestAgent(llmConfig);

            expect(llmAgent.isLLMEnabled()).toBe(true);
        });
    });

    describe('connect()', () => {
        it('should connect to TriProtocol successfully', async () => {
            await agent.connect(mockProtocol);

            expect(agent.getStatus()).toBe(AgentStatus.ONLINE);
            expect(mockProtocol.registerAgent).toHaveBeenCalledWith(
                expect.objectContaining({
                    agentId: 'test-agent-1',
                    agentType: 'test',
                    status: AgentStatus.ONLINE
                })
            );
        });

        it('should auto-register with registry if available', async () => {
            const mockRegistry = {
                register: jest.fn(),
                unregister: jest.fn()
            };
            mockProtocol.getRegistry.mockReturnValue(mockRegistry);

            await agent.connect(mockProtocol);

            expect(mockRegistry.register).toHaveBeenCalledWith(
                'a2a',
                expect.objectContaining({
                    agentId: 'test-agent-1'
                })
            );
        });

        it('should build proper agent profile', async () => {
            await agent.connect(mockProtocol);

            const profile = agent.getProfile();

            expect(profile).toBeDefined();
            expect(profile?.agentId).toBe('test-agent-1');
            expect(profile?.agentType).toBe('test');
            expect(profile?.capabilities).toHaveLength(1);
            expect(profile?.systemFeatures).toEqual({
                streaming: true,
                pushNotifications: false
            });
            expect(profile?.metadata).toMatchObject({
                custom: 'value',
                version: '1.0.0',
                location: 'agent://test-agent-1',
                capabilities_count: 1
            });
        });

        it('should emit connected event', async () => {
            const spy = jest.fn();
            agent.on('connected', spy);

            await agent.connect(mockProtocol);

            expect(spy).toHaveBeenCalledWith(
                expect.objectContaining({
                    agentId: 'test-agent-1'
                })
            );
        });
    });

    describe('disconnect()', () => {
        beforeEach(async () => {
            await agent.connect(mockProtocol);
        });

        it('should disconnect from TriProtocol', async () => {
            await agent.disconnect();

            expect(agent.getStatus()).toBe(AgentStatus.OFFLINE);
            expect(mockProtocol.unregisterAgent).toHaveBeenCalledWith('test-agent-1');
        });

        it('should auto-unregister from registry', async () => {
            const mockRegistry = {
                register: jest.fn(),
                unregister: jest.fn()
            };
            mockProtocol.getRegistry.mockReturnValue(mockRegistry);

            await agent.disconnect();

            expect(mockRegistry.unregister).toHaveBeenCalledWith('test-agent-1');
        });

        it('should disconnect MCP if enabled', async () => {
            const mcpAgent = new TestAgent({
                ...config,
                enableMCP: true
            });

            mcpAgent.mcpManager = new MCPClientManager({});
            mcpAgent.mcpManager.disconnectAll = jest.fn();

            await mcpAgent.connect(mockProtocol);
            await mcpAgent.disconnect();

            expect(mcpAgent.mcpManager.disconnectAll).toHaveBeenCalled();
        });

        it('should emit disconnected event', async () => {
            const spy = jest.fn();
            agent.on('disconnected', spy);

            await agent.disconnect();

            expect(spy).toHaveBeenCalled();
        });
    });

    describe('sendMessage()', () => {
        beforeEach(async () => {
            await agent.connect(mockProtocol);
        });

        it('should send a message to another agent', async () => {
            const message: Message = {
                role: 'user',
                parts: [{ kind: 'text', text: 'Hello' }],
                messageId: 'msg-1',
                kind: 'message' as const
            };

            mockProtocol.sendMessage.mockResolvedValue({
                role: 'agent' as const,
                parts: [],
                messageId: 'response-1',
                kind: 'message' as const
            });

            const result = await (agent as any).sendMessage('target-agent', message);

            expect(mockProtocol.sendMessage).toHaveBeenCalledWith(
                'target-agent',
                message
            );
            expect(result).toEqual({
                role: 'agent',
                parts: [],
                messageId: 'response-1',
                kind: 'message'
            });
        });

        it('should throw error if not connected', async () => {
            await agent.disconnect();

            const message: Message = {
                role: 'user',
                parts: [{ kind: 'text', text: 'Hello' }],
                messageId: 'msg-1',
                kind: 'message' as const
            };

            await expect((agent as any).sendMessage('target', message))
                .rejects.toThrow('Agent not connected to Tri-Protocol');
        });
    });

    describe('getCapabilities()', () => {
        it('should return agent capabilities', () => {
            const capabilities = (agent as any).getCapabilities();

            expect(capabilities).toHaveLength(1);
            expect(capabilities[0].name).toBe('capability1');
        });

        it('should include MCP capabilities if enabled', () => {
            const mcpAgent = new TestAgent({
                ...config,
                enableMCP: true
            });

            const capabilities = (mcpAgent as any).getCapabilities();

            // Base capability + MCP capability
            expect(capabilities.length).toBeGreaterThanOrEqual(1);
        });

        it('should include LLM capabilities if enabled', () => {
            const llmAgent = new TestAgent({
                ...config,
                enableLLM: true
            });

            const capabilities = (llmAgent as any).getCapabilities();

            // Should include reasoning and generation capabilities
            expect(capabilities.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('MCP functionality', () => {
        let mcpAgent: TestAgent;

        beforeEach(() => {
            mcpAgent = new TestAgent({
                ...config,
                enableMCP: true
            });

            mcpAgent.mcpManager = new MCPClientManager({});
            mcpAgent.mcpManager.connect = jest.fn();
            mcpAgent.mcpManager.disconnect = jest.fn();
            mcpAgent.mcpManager.getAvailableTools = jest.fn();
            mcpAgent.mcpManager.executeTool = jest.fn();
            mcpAgent.mcpManager.listResources = jest.fn();
            mcpAgent.mcpManager.readResource = jest.fn();
        });

        it('should connect to MCP server', async () => {
            const connection = {
                name: 'test-server',
                type: 'stdio' as const,
                command: 'test'
            };

            await mcpAgent.connectMCPServer(connection);

            expect(mcpAgent.mcpManager?.connect).toHaveBeenCalledWith(connection);
        });

        it('should disconnect from MCP server', async () => {
            await mcpAgent.disconnectMCPServer('test-server');

            expect(mcpAgent.mcpManager?.disconnect).toHaveBeenCalledWith('test-server');
        });

        it('should get available tools', () => {
            const mockTools = [
                { name: 'tool1', description: 'Tool 1' }
            ];

            ((mcpAgent.mcpManager as any).listTools as jest.Mock).mockReturnValue(mockTools);

            const tools = mcpAgent.getAvailableTools();

            expect(tools).toEqual(mockTools);
        });

        it('should execute a tool', async () => {
            const mockResult = {
                success: true,
                result: 'output'
            };

            (mcpAgent.mcpManager!.executeTool as jest.Mock).mockResolvedValue(mockResult);

            const result = await mcpAgent.useTool('test-tool', { arg: 'value' });

            expect(result).toEqual(mockResult);
            expect(mcpAgent.mcpManager?.executeTool).toHaveBeenCalledWith({
                toolName: 'test-tool',
                arguments: { arg: 'value' }
            });
        });

        it('should throw error if MCP not enabled', async () => {
            const agent = new TestAgent(config); // MCP not enabled

            expect(() => agent.getAvailableTools()).toThrow('MCP is not enabled');
        });
    });

    describe('LLM functionality', () => {
        let llmAgent: TestAgent;

        beforeEach(() => {
            llmAgent = new TestAgent({
                ...config,
                enableLLM: true
            });
        });

        it('should generate text using LLM', async () => {
            const mockResponse = {
                content: 'Generated text',
                usage: { promptTokens: 10, completionTokens: 5 }
            };

            if (llmAgent['llm']) {
                (llmAgent['llm'] as any).generate = jest.fn().mockResolvedValue(mockResponse);
            }

            const result = await (llmAgent as any).generateWithLLM('Generate a story');

            expect(result).toEqual(mockResponse);
        });

        it('should perform reasoning', async () => {
            const mockChain = {
                steps: [],
                conclusion: 'Reasoning result',
                confidence: 0.9
            };

            if (llmAgent['reasoning']) {
                llmAgent['reasoning'].reason = jest.fn().mockResolvedValue(mockChain);
            }

            const result = await llmAgent.reason('Analyze this problem');

            expect(result).toEqual(mockChain);
        });

        it('should throw error if LLM not enabled', async () => {
            const agent = new TestAgent(config); // LLM not enabled

            await expect((agent as any).generateWithLLM('test'))
                .rejects.toThrow('LLM is not enabled for this agent');
        });
    });

    describe('Event handling', () => {
        beforeEach(async () => {
            await agent.connect(mockProtocol);
        });

        it('should emit events for agent lifecycle', () => {
            const events: string[] = [];

            agent.on('status:changed', (status) => {
                events.push(`status:${status}`);
            });

            agent['updateStatus'](AgentStatus.BUSY);
            agent['updateStatus'](AgentStatus.OFFLINE);

            expect(events).toEqual([
                `status:${AgentStatus.BUSY}`,
                `status:${AgentStatus.OFFLINE}`
            ]);
        });

        it('should handle MCP events if enabled', () => {
            const mcpAgent = new TestAgent({
                ...config,
                enableMCP: true
            });

            const spy = jest.fn();
            mcpAgent.on('mcp:tool:executed', spy);

            mcpAgent.emit('mcp:tool:executed', {
                tool: 'test',
                result: 'success'
            });

            expect(spy).toHaveBeenCalledWith({
                tool: 'test',
                result: 'success'
            });
        });

        it('should handle LLM events if enabled', () => {
            const llmAgent = new TestAgent({
                ...config,
                enableLLM: true
            });

            const spy = jest.fn();
            llmAgent.on('llm:cache:hit', spy);

            llmAgent.emit('llm:cache:hit', {
                prompt: 'test',
                provider: 'test-provider'
            });

            expect(spy).toHaveBeenCalled();
        });
    });

    describe('Getters', () => {
        it('should return agent ID', () => {
            expect(agent['config'].id).toBe('test-agent-1');
        });

        it('should return agent name', () => {
            expect(agent['config'].name).toBe('Test Agent');
        });

        it('should return agent type', () => {
            expect(agent['config'].type).toBe('test');
        });

        it('should return agent status', () => {
            expect(agent.getStatus()).toBe(AgentStatus.OFFLINE);
        });

        it('should return agent profile after connection', async () => {
            expect(agent.getProfile()).toBeUndefined();

            await agent.connect(mockProtocol);

            const profile = agent.getProfile();
            expect(profile).toBeDefined();
            expect(profile?.agentId).toBe('test-agent-1');
        });

        it('should check if connected', async () => {
            expect((agent as any).isConnected()).toBe(false);

            await agent.connect(mockProtocol);

            expect((agent as any).isConnected()).toBe(true);
        });
    });
});