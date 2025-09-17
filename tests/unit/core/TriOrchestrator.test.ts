import { TriOrchestrator, OrchestratorTask, TaskAnalysis } from '../../../core/src/TriOrchestrator';
import { TriProtocol } from '../../../core/src/TriProtocol';
import { TriRegistry, RegistryEntry } from '../../../core/src/TriRegistry';
import { AgentProfile, AgentStatus } from '../../../protocols/src/a2a/types';
import { setupLoggerMock, createMockTriProtocol, createMockTriRegistry } from './test-helpers';

// Setup Logger mock before any imports that use it
const mockLogger = setupLoggerMock();

// Mock dependencies
jest.mock('../../../core/src/TriProtocol');
jest.mock('../../../core/src/TriRegistry');

describe('TriOrchestrator', () => {
    let orchestrator: TriOrchestrator;
    let mockProtocol: any;
    let mockRegistry: any;

    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();

        // Create mocked instances using helpers
        mockProtocol = createMockTriProtocol();
        mockRegistry = createMockTriRegistry();

        // Mock constructors
        (TriProtocol as jest.MockedClass<typeof TriProtocol>).mockImplementation(() => mockProtocol as any);
        (TriRegistry as jest.MockedClass<typeof TriRegistry>).mockImplementation(() => mockRegistry as any);

        orchestrator = new TriOrchestrator(mockProtocol, mockRegistry);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Constructor', () => {
        it('should create a new TriOrchestrator instance', () => {
            expect(orchestrator).toBeInstanceOf(TriOrchestrator);
        });

        it('should create registry if not provided', () => {
            const orchestratorNoRegistry = new TriOrchestrator(mockProtocol);
            expect(orchestratorNoRegistry).toBeInstanceOf(TriOrchestrator);
        });
    });

    describe('execute()', () => {
        describe('Workflow routing', () => {
            it('should route workflow type tasks to LangGraph', async () => {
                const task: OrchestratorTask = {
                    id: 'task-1',
                    type: 'workflow',
                    name: 'Test Workflow',
                    input: { data: 'test' }
                };

                mockProtocol.createWorkflow.mockResolvedValue('workflow-1');
                mockProtocol.executeWorkflow.mockResolvedValue({
                    id: 'exec-1',
                    status: 'completed'
                } as any);

                const result = await orchestrator.execute(task);

                expect(mockProtocol.createWorkflow).toHaveBeenCalled();
                expect(mockProtocol.executeWorkflow).toHaveBeenCalled();
            });

            it('should route multi-step tasks to workflow', async () => {
                const task: OrchestratorTask = {
                    id: 'task-2',
                    type: 'simple',
                    name: 'Multi-step task',
                    steps: [
                        { id: 'step1', type: 'action', action: 'read' },
                        { id: 'step2', type: 'action', action: 'process' }
                    ]
                };

                mockProtocol.createWorkflow.mockResolvedValue('workflow-2');
                mockProtocol.executeWorkflow.mockResolvedValue({
                    id: 'exec-2',
                    status: 'completed'
                } as any);

                await orchestrator.execute(task);

                expect(mockProtocol.createWorkflow).toHaveBeenCalled();
                expect(mockProtocol.executeWorkflow).toHaveBeenCalled();
            });
        });

        describe('Communication routing', () => {
            it('should route communication type tasks to A2A', async () => {
                const task: OrchestratorTask = {
                    id: 'task-3',
                    type: 'communication',
                    name: 'Send message',
                    target: 'agent-1',
                    input: 'Hello agent'
                };

                mockProtocol.sendMessage.mockResolvedValue({
                    id: 'msg-1',
                    status: 'sent'
                } as any);

                await orchestrator.execute(task);

                expect(mockProtocol.sendMessage).toHaveBeenCalledWith(
                    'agent-1',
                    expect.objectContaining({
                        role: 'user',
                        parts: expect.arrayContaining([
                            expect.objectContaining({
                                kind: 'text',
                                text: 'Hello agent'
                            })
                        ])
                    })
                );
            });

            it('should throw error if target is missing', async () => {
                const task: OrchestratorTask = {
                    id: 'task-4',
                    type: 'communication',
                    name: 'Send message',
                    input: 'Hello'
                };

                await expect(orchestrator.execute(task))
                    .rejects.toThrow('Communication task requires a target agent');
            });
        });

        describe('Tool routing', () => {
            it('should route tool type tasks to MCP', async () => {
                const task: OrchestratorTask = {
                    id: 'task-5',
                    type: 'tool',
                    name: 'Execute tool',
                    tool: 'filesystem:read_file',
                    args: { path: '/test.txt' }
                };

                mockProtocol.executeTool.mockResolvedValue({
                    success: true,
                    result: 'file content'
                });

                const result = await orchestrator.execute(task);

                expect(mockProtocol.executeTool).toHaveBeenCalledWith(
                    'filesystem:read_file',
                    { path: '/test.txt' }
                );
                expect(result).toEqual({
                    success: true,
                    result: 'file content'
                });
            });

            it('should throw error if tool is missing', async () => {
                const task: OrchestratorTask = {
                    id: 'task-6',
                    type: 'tool',
                    name: 'Execute tool',
                    args: { data: 'test' }
                };

                await expect(orchestrator.execute(task))
                    .rejects.toThrow('Tool task requires a tool name');
            });
        });

        describe('Simple task intelligent routing', () => {
            it('should route reasoning tasks to agents with LLM capability', async () => {
                const task: OrchestratorTask = {
                    id: 'task-7',
                    type: 'simple',
                    name: 'analyze data',
                    input: 'Please analyze this dataset',
                    metadata: { requiresReasoning: true }
                };

                const mockAgent: RegistryEntry = {
                    protocol: 'a2a' as const,
                    profile: {
                        agentId: 'reasoning-agent',
                        agentType: 'test',
                        status: 'ONLINE' as AgentStatus,
                        capabilities: [{ name: 'reasoning' }],
                        systemFeatures: { streaming: false, pushNotifications: false },
                        metadata: {} as any,
                        lastSeen: new Date()
                    } as AgentProfile,
                    registeredAt: new Date(),
                    lastUpdated: new Date()
                };

                mockRegistry.findByCapability.mockReturnValue([mockAgent]);
                mockProtocol.sendMessage.mockResolvedValue({ success: true } as any);

                await orchestrator.execute(task);

                expect(mockRegistry.findByCapability).toHaveBeenCalledWith('reasoning');
                expect(mockProtocol.sendMessage).toHaveBeenCalledWith(
                    'reasoning-agent',
                    expect.any(Object),
                    expect.any(Object)
                );
            });

            it('should route tool-related tasks to MCP', async () => {
                const task: OrchestratorTask = {
                    id: 'task-8',
                    type: 'simple',
                    name: 'read file',
                    input: 'Read the configuration file',
                    tool: 'filesystem:read_file'
                };

                mockProtocol.executeTool.mockResolvedValue({
                    success: true,
                    content: 'file data'
                });

                await orchestrator.execute(task);

                expect(mockProtocol.executeTool).toHaveBeenCalledWith(
                    'filesystem:read_file',
                    {}
                );
            });

            it('should analyze task text for routing hints', async () => {
                const task: OrchestratorTask = {
                    id: 'task-9',
                    type: 'simple',
                    name: 'process',
                    input: 'analyze and process this data'
                };

                const mockAgent: RegistryEntry = {
                    protocol: 'a2a' as const,
                    profile: {
                        agentId: 'data-agent',
                        agentType: 'test',
                        status: 'ONLINE' as AgentStatus,
                        capabilities: [{ name: 'data-processing' }],
                        systemFeatures: { streaming: false, pushNotifications: false },
                        metadata: {} as any,
                        lastSeen: new Date()
                    } as AgentProfile,
                    registeredAt: new Date(),
                    lastUpdated: new Date()
                };

                mockRegistry.findByCapability.mockReturnValue([mockAgent]);
                mockProtocol.sendMessage.mockResolvedValue({ success: true } as any);

                await orchestrator.execute(task);

                // Should recognize 'analyze' and 'process' keywords
                expect(mockRegistry.findByCapability).toHaveBeenCalled();
            });

            it('should fallback to workflow if no specific routing possible', async () => {
                const task: OrchestratorTask = {
                    id: 'task-10',
                    type: 'simple',
                    name: 'unknown task',
                    input: 'do something'
                };

                // No agents available
                mockRegistry.findByCapability.mockReturnValue([]);
                mockProtocol.findAgentsByCapability.mockResolvedValue([]);

                mockProtocol.createWorkflow.mockResolvedValue('fallback-workflow');
                mockProtocol.executeWorkflow.mockResolvedValue({
                    id: 'exec-fallback',
                    status: 'completed'
                } as any);

                await orchestrator.execute(task);

                expect(mockProtocol.createWorkflow).toHaveBeenCalled();
            });
        });

        it('should handle task execution errors', async () => {
            const task: OrchestratorTask = {
                id: 'task-error',
                type: 'tool',
                name: 'Error task',
                tool: 'failing:tool'
            };

            mockProtocol.executeTool.mockRejectedValue(new Error('Tool execution failed'));

            await expect(orchestrator.execute(task))
                .rejects.toThrow('Tool execution failed');
        });
    });

    describe('analyzeTask()', () => {
        it('should analyze task metadata for routing hints', async () => {
            const task: OrchestratorTask = {
                id: 'task-meta',
                type: 'simple',
                name: 'test',
                metadata: {
                    requiresReasoning: true,
                    tool: 'custom:tool',
                    capability: 'analysis'
                }
            };

            // Access private method through any type
            const analysis = await (orchestrator as any).analyzeTask(task);

            expect(analysis.requiresReasoning).toBe(true);
            expect(analysis.requiresTools).toBe(true);
            expect(analysis.suggestedTool).toBe('custom:tool');
            expect(analysis.primaryCapability).toBe('analysis');
        });

        it('should detect reasoning patterns in task text', async () => {
            const task: OrchestratorTask = {
                id: 'task-reason',
                type: 'simple',
                name: 'analyze this',
                input: 'explain and understand the data'
            };

            const analysis = await (orchestrator as any).analyzeTask(task);

            expect(analysis.requiresReasoning).toBe(true);
            expect(analysis.confidence).toBeGreaterThanOrEqual(0.7);
        });

        it('should detect tool patterns in task text', async () => {
            const task: OrchestratorTask = {
                id: 'task-tool',
                type: 'simple',
                name: 'file operation',
                input: 'read the file and write results'
            };

            const analysis = await (orchestrator as any).analyzeTask(task);

            expect(analysis.requiresTools).toBe(true);
            expect(analysis.suggestedTool).toBe('filesystem:read_file');
        });

        it('should detect communication patterns in task text', async () => {
            const task: OrchestratorTask = {
                id: 'task-comm',
                type: 'simple',
                name: 'notification',
                input: 'send notification to all agents and coordinate response'
            };

            const analysis = await (orchestrator as any).analyzeTask(task);

            expect(analysis.requiresCommunication).toBe(true);
            expect(analysis.primaryCapability).toBe('coordination');
        });
    });

    describe('getStatus()', () => {
        it('should return orchestrator status', () => {
            const status = orchestrator.getStatus();

            expect(status).toHaveProperty('initialized', true);
            expect(status).toHaveProperty('protocols');
            expect(status.protocols).toEqual({
                a2a: true,
                langgraph: true,
                mcp: true
            });
            expect(status).toHaveProperty('capabilities');
            expect(status.capabilities).toEqual({
                workflows: true,
                communication: true,
                tools: true
            });
        });

        it('should reflect disabled protocols', () => {
            mockProtocol.getA2A.mockReturnValue(undefined);
            mockProtocol.getMCP.mockReturnValue(undefined);

            const status = orchestrator.getStatus();

            expect(status.protocols.a2a).toBe(false);
            expect(status.protocols.mcp).toBe(false);
            expect(status.capabilities.communication).toBe(false);
            expect(status.capabilities.tools).toBe(false);
        });
    });

    describe('routeToAgent()', () => {
        it('should route task to specific agent', async () => {
            const task: OrchestratorTask = {
                id: 'task-route',
                type: 'simple',
                name: 'test task',
                input: 'test data'
            };

            mockProtocol.sendMessage.mockResolvedValue({ success: true } as any);

            await (orchestrator as any).routeToAgent('agent-123', task);

            expect(mockProtocol.sendMessage).toHaveBeenCalledWith(
                'agent-123',
                expect.objectContaining({
                    role: 'user',
                    parts: expect.any(Array)
                }),
                expect.objectContaining({
                    task: expect.objectContaining({
                        id: 'task-route',
                        kind: 'task'
                    })
                })
            );
        });
    });

    describe('findAgentsForCapability()', () => {
        it('should find agents from registry first', async () => {
            const mockAgents = [
                {
                    protocol: 'a2a' as const,
                    profile: {
                        agentId: 'agent-1',
                        agentType: 'test',
                        status: 'ONLINE' as AgentStatus,
                        capabilities: [{ name: 'analysis' }],
                        systemFeatures: { streaming: false, pushNotifications: false },
                        metadata: {} as any,
                        lastSeen: new Date()
                    } as AgentProfile,
                    registeredAt: new Date(),
                    lastUpdated: new Date()
                } as RegistryEntry
            ];

            mockRegistry.findByCapability.mockReturnValue(mockAgents);

            const agents = await (orchestrator as any).findAgentsForCapability('analysis');

            expect(agents).toEqual(mockAgents);
            expect(mockRegistry.findByCapability).toHaveBeenCalledWith('analysis');
        });

        it('should fallback to A2A protocol if registry empty', async () => {
            mockRegistry.findByCapability.mockReturnValue([]);

            const mockProfiles: AgentProfile[] = [
                {
                    agentId: 'agent-2',
                    agentType: 'test',
                    status: 'ONLINE' as AgentStatus,
                    capabilities: [{ name: 'monitoring' }],
                    systemFeatures: { streaming: false, pushNotifications: false },
                    metadata: {} as any,
                    lastSeen: new Date()
                } as AgentProfile
            ];

            mockProtocol.findAgentsByCapability.mockResolvedValue(mockProfiles);

            const agents = await (orchestrator as any).findAgentsForCapability('monitoring');

            expect(agents).toHaveLength(1);
            expect(agents[0].profile).toEqual(mockProfiles[0]);
            expect(mockProtocol.findAgentsByCapability).toHaveBeenCalledWith('monitoring');
        });
    });

    describe('selectOptimalAgent()', () => {
        it('should select first agent from list', () => {
            const agents = [
                { profile: { agentId: 'agent-1' } },
                { profile: { agentId: 'agent-2' } },
                { profile: { agentId: 'agent-3' } }
            ];

            const selected = (orchestrator as any).selectOptimalAgent(agents);

            expect(selected).toEqual(agents[0]);
        });

        it('should throw error if no agents available', () => {
            expect(() => (orchestrator as any).selectOptimalAgent([]))
                .toThrow('No agents available');
        });
    });
});