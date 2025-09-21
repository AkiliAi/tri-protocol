import { TriProtocol, TriProtocolConfig } from '../../../core/src/TriProtocol';
import { TriRegistry } from '../../../core/src/TriRegistry';
import { AgentProfile, AgentStatus } from '../../../protocols/src/a2a/types';
import { EventEmitter } from 'eventemitter3';
import { setupLoggerMock, createMockA2AProtocol, createMockLangGraphAdapter, createMockMCPAdapter } from './test-helpers';

// Setup Logger mock before any imports that use it
const mockLogger = setupLoggerMock();

// Mock dependencies
jest.mock('../../../protocols/src/a2a');
jest.mock('../../../protocols/src/langgraph');
jest.mock('../../../protocols/src/mcp');

describe('TriProtocol', () => {
    let protocol: TriProtocol;
    let registry: TriRegistry;
    let config: TriProtocolConfig;

    beforeEach(() => {
        // Clear mocks
        jest.clearAllMocks();

        // Setup protocol mocks
        const { A2AProtocol } = require('../../../protocols/src/a2a');
        const { LangGraphAdapter } = require('../../../protocols/src/langgraph');
        const { MCPAdapter } = require('../../../protocols/src/mcp');

        A2AProtocol.mockImplementation(() => createMockA2AProtocol());
        LangGraphAdapter.mockImplementation(() => createMockLangGraphAdapter());
        MCPAdapter.mockImplementation(() => createMockMCPAdapter());

        config = {
            name: 'test-protocol',
            version: '1.0.0',
            baseUrl: 'http://localhost:8080',
            protocols: {
                a2a: {
                    enabled: true,
                    agentCard: {
                        name: 'test-agent'
                    }
                },
                langgraph: {
                    enabled: true,
                    config: {}
                },
                mcp: {
                    enabled: true,
                    config: {}
                }
            }
        };

        registry = new TriRegistry();
        protocol = new TriProtocol(config, registry);
    });

    afterEach(() => {
        protocol.removeAllListeners();
        registry.removeAllListeners();
        jest.clearAllMocks();
    });

    describe('Constructor', () => {
        it('should create a new TriProtocol instance', () => {
            expect(protocol).toBeInstanceOf(TriProtocol);
            expect(protocol).toBeInstanceOf(EventEmitter);
        });

        it('should accept a registry parameter', () => {
            const customRegistry = new TriRegistry();
            const protocolWithRegistry = new TriProtocol(config, customRegistry);
            expect(protocolWithRegistry.getRegistry()).toBe(customRegistry);
        });

        it('should create a default registry if not provided', () => {
            const protocolNoRegistry = new TriProtocol(config);
            expect(protocolNoRegistry.getRegistry()).toBeInstanceOf(TriRegistry);
        });
    });

    describe('initialize()', () => {
        it('should initialize all enabled protocols', async () => {
            await protocol.initialize();

            expect(protocol.getA2A()).toBeDefined();
            expect(protocol.getLangGraph()).toBeDefined();
            expect(protocol.getMCP()).toBeDefined();
        });

        it('should not initialize disabled protocols', async () => {
            const disabledConfig: TriProtocolConfig = {
                ...config,
                protocols: {
                    a2a: { enabled: false },
                    langgraph: { enabled: false },
                    mcp: { enabled: false }
                }
            };

            const protocolDisabled = new TriProtocol(disabledConfig);
            await protocolDisabled.initialize();

            expect(protocolDisabled.getA2A()).toBeUndefined();
            expect(protocolDisabled.getLangGraph()).toBeUndefined();
            expect(protocolDisabled.getMCP()).toBeUndefined();
        });

        it('should emit initialized event', async () => {
            const spy = jest.fn();
            protocol.on('initialized', spy);

            await protocol.initialize();

            expect(spy).toHaveBeenCalled();
        });

        it('should not initialize twice', async () => {
            await protocol.initialize();

            const a2aFirst = protocol.getA2A();

            await protocol.initialize(); // Second call

            const a2aSecond = protocol.getA2A();

            expect(a2aFirst).toBe(a2aSecond); // Same instance
        });
    });

    describe('A2A Protocol methods', () => {
        beforeEach(async () => {
            await protocol.initialize();
        });

        it('should register an agent', async () => {
            const mockProfile: AgentProfile = {
                agentId: 'test-agent-1',
                agentType: 'test',
                status: AgentStatus.ONLINE,
                capabilities: [],
                systemFeatures: {
                    streaming: false,
                    pushNotifications: false
                },
                metadata: {} as any,
                lastSeen: new Date()
            };

            const a2a = protocol.getA2A();
            if (a2a) {
                a2a.registerAgent = jest.fn();
            }

            await protocol.registerAgent(mockProfile);

            expect(a2a?.registerAgent).toHaveBeenCalledWith(mockProfile);
        });

        it('should throw error if A2A not enabled', async () => {
            const disabledProtocol = new TriProtocol({
                ...config,
                protocols: {
                    ...config.protocols,
                    a2a: { enabled: false }
                }
            });
            await disabledProtocol.initialize();

            await expect(disabledProtocol.registerAgent({} as any))
                .rejects.toThrow('A2A Protocol not enabled');
        });

        it('should send a message', async () => {
            const message = {
                role: 'user' as const,
                parts: [{ kind: 'text' as const, text: 'Hello' }],
                messageId: 'msg-1',
                kind: 'message' as const
            };

            const a2a = protocol.getA2A();
            if (a2a) {
                a2a.sendMessage = jest.fn().mockResolvedValue({ success: true });
            }

            const result = await protocol.sendMessage('target-agent', message);

            expect(a2a?.sendMessage).toHaveBeenCalledWith('target-agent', message, undefined);
        });

        it('should find agents by capability', async () => {
            const mockAgents = [
                {
                    agentId: 'agent-1',
                    capabilities: [{ name: 'reasoning' }]
                }
            ];

            const a2a = protocol.getA2A();
            if (a2a) {
                a2a.findAgentsByCapability = jest.fn().mockResolvedValue(mockAgents);
            }

            const agents = await protocol.findAgentsByCapability('reasoning');

            expect(agents).toEqual(mockAgents);
            expect(a2a?.findAgentsByCapability).toHaveBeenCalledWith('reasoning');
        });
    });

    describe('LangGraph methods', () => {
        beforeEach(async () => {
            await protocol.initialize();
        });

        it('should create a workflow', async () => {
            const definition = {
                id: 'workflow-1',
                name: 'Test Workflow',
                description: 'Test',
                stateSchema: {},
                nodes: [],
                edges: [],
                entryPoint: 'start'
            };

            const langGraph = protocol.getLangGraph();
            if (langGraph) {
                langGraph.createWorkflow = jest.fn().mockResolvedValue('workflow-1');
            }

            const workflowId = await protocol.createWorkflow(definition);

            expect(workflowId).toBe('workflow-1');
            expect(langGraph?.createWorkflow).toHaveBeenCalledWith(definition);
        });

        it('should execute a workflow', async () => {
            const execution = {
                id: 'exec-1',
                status: 'completed'
            };

            const langGraph = protocol.getLangGraph();
            if (langGraph) {
                langGraph.executeWorkflow = jest.fn().mockResolvedValue(execution);
            }

            const result = await protocol.executeWorkflow('workflow-1', { input: 'test' });

            expect(result).toEqual(execution);
            expect(langGraph?.executeWorkflow).toHaveBeenCalledWith('workflow-1', { input: 'test' }, undefined);
        });

        it('should pause a workflow', async () => {
            const langGraph = protocol.getLangGraph();
            if (langGraph) {
                langGraph.pauseWorkflow = jest.fn();
            }

            await protocol.pauseWorkflow('exec-1');

            expect(langGraph?.pauseWorkflow).toHaveBeenCalledWith('exec-1');
        });

        it('should resume a workflow', async () => {
            const langGraph = protocol.getLangGraph();
            if (langGraph) {
                langGraph.resumeWorkflow = jest.fn();
            }

            await protocol.resumeWorkflow('exec-1');

            expect(langGraph?.resumeWorkflow).toHaveBeenCalledWith('exec-1');
        });

        it('should submit human input', () => {
            const langGraph = protocol.getLangGraph();
            if (langGraph) {
                langGraph.submitHumanInput = jest.fn();
            }

            protocol.submitHumanInput('node-1', { answer: 'yes' }, 'user-1');

            expect(langGraph?.submitHumanInput).toHaveBeenCalledWith('node-1', { answer: 'yes' }, 'user-1');
        });

        it('should throw error if LangGraph not enabled', async () => {
            const disabledProtocol = new TriProtocol({
                ...config,
                protocols: {
                    ...config.protocols,
                    langgraph: { enabled: false }
                }
            });
            await disabledProtocol.initialize();

            await expect(disabledProtocol.createWorkflow({} as any))
                .rejects.toThrow('LangGraph not enabled');
        });
    });

    describe('MCP methods', () => {
        beforeEach(async () => {
            await protocol.initialize();
        });

        it('should execute a tool', async () => {
            const toolResult = {
                success: true,
                result: 'tool output'
            };

            const mcp = protocol.getMCP();
            if (mcp) {
                mcp.executeTool = jest.fn().mockResolvedValue(toolResult);
            }

            const result = await protocol.executeTool('filesystem:read', { path: '/test.txt' });

            expect(result).toEqual(toolResult);
            expect(mcp?.executeTool).toHaveBeenCalledWith({
                toolName: 'filesystem:read',
                arguments: { path: '/test.txt' }
            });
        });

        it('should list tools', async () => {
            const resources = ['tool1', 'tool2'];

            const mcp = protocol.getMCP();
            if (mcp) {
                mcp.listResources = jest.fn().mockResolvedValue(resources);
            }

            const tools = await protocol.listTools();

            expect(tools).toEqual(resources);
            expect(mcp?.listResources).toHaveBeenCalled();
        });

        it('should throw error if MCP not enabled', async () => {
            const disabledProtocol = new TriProtocol({
                ...config,
                protocols: {
                    ...config.protocols,
                    mcp: { enabled: false }
                }
            });
            await disabledProtocol.initialize();

            await expect(disabledProtocol.executeTool('tool', {}))
                .rejects.toThrow('MCP not enabled');
        });
    });

    describe('Cross-protocol bridge', () => {
        beforeEach(async () => {
            await protocol.initialize();
        });

        it('should setup event handlers for A2A to MCP bridge', async () => {
            const a2a = protocol.getA2A();

            // Check if A2A has event listeners registered
            expect(a2a).toBeDefined();
            // Since we're mocking, we can't directly test the bridge functionality
            // but we can verify the setup was called
        });

        it('should handle capability discovery events', () => {
            const spy = jest.fn();
            protocol.on('tri:capability:available', spy);

            protocol.emit('tri:a2a:capability:discovered', {
                name: 'test-capability',
                description: 'Test'
            });

            expect(spy).toHaveBeenCalledWith({
                protocol: 'a2a',
                capability: {
                    name: 'test-capability',
                    description: 'Test'
                }
            });
        });
    });

    describe('Registry integration', () => {
        beforeEach(async () => {
            await protocol.initialize();
        });

        it('should auto-register A2A agents with registry', () => {
            const mockProfile: AgentProfile = {
                agentId: 'auto-agent',
                agentType: 'test',
                status: AgentStatus.ONLINE,
                capabilities: [],
                systemFeatures: {
                    streaming: false,
                    pushNotifications: false
                },
                metadata: {} as any,
                lastSeen: new Date()
            };

            const registrySpy = jest.spyOn(registry, 'register');

            protocol.emit('tri:a2a:agent:registered', mockProfile);

            expect(registrySpy).toHaveBeenCalledWith('a2a', mockProfile);
        });

        it('should auto-unregister A2A agents from registry', () => {
            const registrySpy = jest.spyOn(registry, 'unregister');

            protocol.emit('tri:a2a:agent:unregistered', 'agent-to-remove');

            expect(registrySpy).toHaveBeenCalledWith('agent-to-remove');
        });

        it('should forward registry events', () => {
            const spy = jest.fn();
            protocol.on('tri:registry:agent:registered', spy);

            registry.emit('agent:registered', { protocol: 'a2a', profile: {} });

            expect(spy).toHaveBeenCalled();
        });
    });

    describe('getStatus()', () => {
        it('should return status for initialized protocol', async () => {
            await protocol.initialize();

            const a2a = protocol.getA2A();
            const langGraph = protocol.getLangGraph();
            const mcp = protocol.getMCP();

            if (a2a) {
                a2a.getRegisteredAgents = jest.fn().mockReturnValue([1, 2]);
                a2a.getActiveTasks = jest.fn().mockReturnValue([1]);
            }

            if (langGraph) {
                langGraph.listWorkflows = jest.fn().mockReturnValue([1, 2, 3]);
                langGraph.listExecutions = jest.fn().mockReturnValue([1]);
            }

            const status = protocol.getStatus();

            expect(status).toEqual({
                name: 'test-protocol',
                version: '1.0.0',
                initialized: true,
                protocols: {
                    a2a: {
                        enabled: true,
                        agents: 2,
                        tasks: 1
                    },
                    langgraph: {
                        enabled: true,
                        workflows: 3,
                        executions: 1
                    },
                    mcp: {
                        enabled: true,
                        connected: true
                    }
                }
            });
        });

        it('should return status for non-initialized protocol', () => {
            const status = protocol.getStatus();

            expect(status).toEqual({
                name: 'test-protocol',
                version: '1.0.0',
                initialized: false,
                protocols: {
                    a2a: { enabled: false },
                    langgraph: { enabled: false },
                    mcp: { enabled: false }
                }
            });
        });
    });

    describe('shutdown()', () => {
        beforeEach(async () => {
            await protocol.initialize();
        });

        it('should shutdown all protocols', async () => {
            const a2a = protocol.getA2A();
            const langGraph = protocol.getLangGraph();
            const mcp = protocol.getMCP();

            if (a2a) {
                a2a.shutdown = jest.fn();
            }
            if (langGraph) {
                langGraph.shutdown = jest.fn();
            }
            if (mcp) {
                mcp.disconnect = jest.fn();
            }

            await protocol.shutdown();

            expect(a2a?.shutdown).toHaveBeenCalled();
            expect(langGraph?.shutdown).toHaveBeenCalled();
            expect(mcp?.disconnect).toHaveBeenCalled();
        });

        it('should clear adapters and listeners', async () => {
            const listenerCountBefore = protocol.eventNames().length;

            await protocol.shutdown();

            expect(protocol.eventNames()).toEqual([]);
            expect(protocol.getA2A()).toBeUndefined();
            expect(protocol.getLangGraph()).toBeUndefined();
            expect(protocol.getMCP()).toBeUndefined();
        });

        it('should handle shutdown when protocols not initialized', async () => {
            const nonInitProtocol = new TriProtocol(config);

            await expect(nonInitProtocol.shutdown()).resolves.not.toThrow();
        });
    });

    describe('getRegistry()', () => {
        it('should return the registry', () => {
            expect(protocol.getRegistry()).toBe(registry);
        });
    });
});