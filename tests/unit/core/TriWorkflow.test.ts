import { TriWorkflow } from '../../../core/src/TriWorkflow';
import { LangGraphAdapter } from '../../../protocols/src/langgraph';
import { WorkflowDefinition, WorkflowExecution, WorkflowNode } from '../../../protocols/src/langgraph/types';
import { EventEmitter } from 'eventemitter3';
import { setupLoggerMock } from './test-helpers';

// Setup Logger mock before any imports that use it
const mockLogger = setupLoggerMock();

// Mock LangGraphAdapter
jest.mock('../../../protocols/src/langgraph');

describe('TriWorkflow', () => {
    let workflow: TriWorkflow;
    let mockLangGraphAdapter: jest.Mocked<LangGraphAdapter>;

    beforeEach(() => {
        // Create mock LangGraphAdapter
        mockLangGraphAdapter = new LangGraphAdapter() as jest.Mocked<LangGraphAdapter>;
        mockLangGraphAdapter.createWorkflow = jest.fn();
        mockLangGraphAdapter.executeWorkflow = jest.fn();
        mockLangGraphAdapter.pauseWorkflow = jest.fn();
        mockLangGraphAdapter.resumeWorkflow = jest.fn();
        mockLangGraphAdapter.on = jest.fn();
        mockLangGraphAdapter.emit = jest.fn();

        workflow = new TriWorkflow(mockLangGraphAdapter);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Constructor', () => {
        it('should create a new TriWorkflow instance', () => {
            expect(workflow).toBeInstanceOf(TriWorkflow);
            expect(workflow).toBeInstanceOf(EventEmitter);
        });

        it('should load default templates', async () => {
            const templates = await workflow.listTemplates();
            expect(templates).toHaveLength(5);

            const templateNames = templates.map(t => t.name);
            expect(templateNames).toContain('Data Pipeline');
            expect(templateNames).toContain('Research Workflow');
            expect(templateNames).toContain('Multi-Agent Collaboration');
            expect(templateNames).toContain('Tool Chain');
            expect(templateNames).toContain('ETL Workflow');
        });
    });

    describe('createWorkflow()', () => {
        const mockDefinition: WorkflowDefinition = {
            id: 'test-workflow',
            name: 'Test Workflow',
            description: 'A test workflow',
            stateSchema: {
                input: { value: null },
                output: { value: null }
            },
            nodes: [
                {
                    id: 'node-1',
                    type: 'custom',
                    name: 'Test Node',
                    function: async (state) => state
                }
            ],
            edges: [],
            entryPoint: 'node-1'
        };

        it('should create a workflow successfully', async () => {
            mockLangGraphAdapter.createWorkflow.mockResolvedValue('test-workflow');

            const workflowId = await workflow.createWorkflow(mockDefinition);

            expect(workflowId).toBe('test-workflow');
            expect(mockLangGraphAdapter.createWorkflow).toHaveBeenCalledWith(mockDefinition);
        });

        it('should store workflow definition locally', async () => {
            mockLangGraphAdapter.createWorkflow.mockResolvedValue('test-workflow');

            await workflow.createWorkflow(mockDefinition);

            const stored = workflow.getWorkflow('test-workflow');
            expect(stored).toEqual(mockDefinition);
        });
    });

    describe('executeWorkflow()', () => {
        const mockExecution: WorkflowExecution = {
            id: 'exec-1',
            workflowId: 'test-workflow',
            state: {
                messages: [],
                context: {},
                currentStep: 0
            },
            status: 'running',
            startTime: new Date(),
            checkpoints: [],
            metrics: {
                nodesExecuted: 0,
                executionTime: 0
            }
        };

        beforeEach(async () => {
            const definition: WorkflowDefinition = {
                id: 'test-workflow',
                name: 'Test',
                description: 'Test',
                stateSchema: {},
                nodes: [],
                edges: [],
                entryPoint: 'start'
            };
            mockLangGraphAdapter.createWorkflow.mockResolvedValue('test-workflow');
            await workflow.createWorkflow(definition);
        });

        it('should execute a workflow successfully', async () => {
            mockLangGraphAdapter.executeWorkflow.mockResolvedValue(mockExecution);

            const execution = await workflow.executeWorkflow('test-workflow', { input: 'test' });

            expect(execution).toEqual(mockExecution);
            expect(mockLangGraphAdapter.executeWorkflow).toHaveBeenCalledWith(
                'test-workflow',
                { input: 'test' },
                undefined
            );
        });

        it('should store execution locally', async () => {
            mockLangGraphAdapter.executeWorkflow.mockResolvedValue(mockExecution);

            await workflow.executeWorkflow('test-workflow', {});

            const stored = workflow.getExecution('exec-1');
            expect(stored).toEqual(mockExecution);
        });
    });

    describe('pauseWorkflow()', () => {
        const mockExecution: WorkflowExecution = {
            id: 'exec-1',
            workflowId: 'test-workflow',
            state: {} as any,
            status: 'running',
            startTime: new Date(),
            checkpoints: [],
            metrics: {
                nodesExecuted: 5,
                executionTime: 1000
            }
        };

        beforeEach(async () => {
            mockLangGraphAdapter.executeWorkflow.mockResolvedValue(mockExecution);
            await workflow.executeWorkflow('test-workflow', {});
        });

        it('should pause a running workflow', async () => {
            await workflow.pauseWorkflow('exec-1');

            expect(mockLangGraphAdapter.pauseWorkflow).toHaveBeenCalledWith('exec-1');

            const execution = workflow.getExecution('exec-1');
            expect(execution?.status).toBe('paused');
        });
    });

    describe('resumeWorkflow()', () => {
        const mockExecution: WorkflowExecution = {
            id: 'exec-1',
            workflowId: 'test-workflow',
            state: {} as any,
            status: 'paused',
            startTime: new Date(),
            checkpoints: [],
            metrics: {
                nodesExecuted: 5,
                executionTime: 1000
            }
        };

        beforeEach(async () => {
            mockLangGraphAdapter.executeWorkflow.mockResolvedValue(mockExecution);
            await workflow.executeWorkflow('test-workflow', {});
        });

        it('should resume a paused workflow', async () => {
            await workflow.resumeWorkflow('exec-1');

            expect(mockLangGraphAdapter.resumeWorkflow).toHaveBeenCalledWith('exec-1');

            const execution = workflow.getExecution('exec-1');
            expect(execution?.status).toBe('running');
        });
    });

    describe('getWorkflowStatus()', () => {
        const mockExecution: WorkflowExecution = {
            id: 'exec-1',
            workflowId: 'test-workflow',
            state: {} as any,
            status: 'completed',
            startTime: new Date(),
            checkpoints: [],
            metrics: {
                nodesExecuted: 10,
                executionTime: 5000
            }
        };

        beforeEach(async () => {
            mockLangGraphAdapter.executeWorkflow.mockResolvedValue(mockExecution);
            await workflow.executeWorkflow('test-workflow', {});
        });

        it('should return workflow execution status', async () => {
            const status = await workflow.getWorkflowStatus('exec-1');
            expect(status).toBe('completed');
        });

        it('should throw error for non-existent execution', async () => {
            await expect(workflow.getWorkflowStatus('non-existent'))
                .rejects.toThrow('Execution not found: non-existent');
        });
    });

    describe('createFromTemplate()', () => {
        it('should create workflow from DataPipeline template', async () => {
            mockLangGraphAdapter.createWorkflow.mockResolvedValue('pipeline-1');

            const workflowId = await workflow.createFromTemplate('DataPipeline', {
                dataSource: '/data/input.json',
                processorAgent: 'processor',
                outputPath: '/data/output.json'
            });

            expect(workflowId).toBe('pipeline-1');
            expect(mockLangGraphAdapter.createWorkflow).toHaveBeenCalled();

            const call = mockLangGraphAdapter.createWorkflow.mock.calls[0][0];
            expect(call.name).toBe('Data Pipeline Workflow');
        });

        it('should throw error for non-existent template', async () => {
            await expect(workflow.createFromTemplate('NonExistent', {}))
                .rejects.toThrow('Template not found: NonExistent');
        });
    });

    describe('listTemplates()', () => {
        it('should return all available templates', async () => {
            const templates = await workflow.listTemplates();

            expect(templates).toHaveLength(5);
            templates.forEach(template => {
                expect(template).toHaveProperty('name');
                expect(template).toHaveProperty('description');
                expect(template).toHaveProperty('factory');
                expect(typeof template.factory).toBe('function');
            });
        });
    });

    describe('createNodeFromAgent()', () => {
        it('should create an A2A node for an agent', async () => {
            const node = await workflow.createNodeFromAgent('test-agent', {
                messageType: 'TASK_REQUEST'
            });

            expect(node).toHaveProperty('id');
            expect(node.id).toContain('a2a-send-test-agent');
            expect(node.type).toBe('agent');
            expect(node.name).toBe('Send to test-agent');
            expect(node.metadata?.agentId).toBe('test-agent');
        });
    });

    describe('createNodeFromTool()', () => {
        it('should create an MCP node for a tool', async () => {
            const node = await workflow.createNodeFromTool('filesystem:read_file', {
                path: '/test.txt'
            });

            expect(node).toHaveProperty('id');
            expect(node.id).toContain('mcp-filesystem-read-file');
            expect(node.type).toBe('tool');
            expect(node.name).toBe('Execute filesystem:read_file');
        });
    });

    describe('createMultiProtocolWorkflow()', () => {
        it('should create a workflow combining A2A and MCP', async () => {
            mockLangGraphAdapter.createWorkflow.mockResolvedValue('multi-1');

            const workflowId = await workflow.createMultiProtocolWorkflow({
                name: 'Multi-Protocol Test',
                description: 'Test workflow',
                inputSource: '/input.json',
                processingAgent: 'processor',
                tools: ['transform', 'validate'],
                outputPath: '/output.json'
            });

            expect(workflowId).toBe('multi-1');

            const call = mockLangGraphAdapter.createWorkflow.mock.calls[0][0];
            expect(call.name).toBe('Multi-Protocol Test');
            expect(call.nodes.length).toBeGreaterThan(0);

            // Should have MCP nodes for file operations
            const mcpNodes = call.nodes.filter((n: WorkflowNode) => n.type === 'tool');
            expect(mcpNodes.length).toBeGreaterThan(0);

            // Should have A2A nodes for agent communication
            const a2aNodes = call.nodes.filter((n: WorkflowNode) => n.type === 'agent');
            expect(a2aNodes.length).toBeGreaterThan(0);
        });
    });

    describe('listWorkflows()', () => {
        it('should return empty array initially', () => {
            const workflows = workflow.listWorkflows();
            expect(workflows).toEqual([]);
        });

        it('should return all created workflows', async () => {
            const definitions = [
                {
                    id: 'workflow-1',
                    name: 'Workflow 1',
                    description: 'Test 1',
                    stateSchema: {},
                    nodes: [],
                    edges: [],
                    entryPoint: 'start'
                },
                {
                    id: 'workflow-2',
                    name: 'Workflow 2',
                    description: 'Test 2',
                    stateSchema: {},
                    nodes: [],
                    edges: [],
                    entryPoint: 'start'
                }
            ];

            mockLangGraphAdapter.createWorkflow.mockResolvedValueOnce('workflow-1');
            mockLangGraphAdapter.createWorkflow.mockResolvedValueOnce('workflow-2');

            await workflow.createWorkflow(definitions[0]);
            await workflow.createWorkflow(definitions[1]);

            const workflows = workflow.listWorkflows();
            expect(workflows).toHaveLength(2);
            expect(workflows).toEqual(definitions);
        });
    });

    describe('listExecutions()', () => {
        it('should return empty array initially', () => {
            const executions = workflow.listExecutions();
            expect(executions).toEqual([]);
        });

        it('should return all executions', async () => {
            const exec1: WorkflowExecution = {
                id: 'exec-1',
                workflowId: 'workflow-1',
                state: {} as any,
                status: 'running',
                startTime: new Date(),
                checkpoints: [],
                metrics: { nodesExecuted: 0, executionTime: 0 }
            };

            const exec2: WorkflowExecution = {
                id: 'exec-2',
                workflowId: 'workflow-2',
                state: {} as any,
                status: 'completed',
                startTime: new Date(),
                checkpoints: [],
                metrics: { nodesExecuted: 5, executionTime: 1000 }
            };

            mockLangGraphAdapter.executeWorkflow.mockResolvedValueOnce(exec1);
            mockLangGraphAdapter.executeWorkflow.mockResolvedValueOnce(exec2);

            await workflow.executeWorkflow('workflow-1', {});
            await workflow.executeWorkflow('workflow-2', {});

            const executions = workflow.listExecutions();
            expect(executions).toHaveLength(2);
            expect(executions.map(e => e.id)).toContain('exec-1');
            expect(executions.map(e => e.id)).toContain('exec-2');
        });
    });

    describe('clearCompletedExecutions()', () => {
        beforeEach(async () => {
            const executions: WorkflowExecution[] = [
                {
                    id: 'exec-1',
                    workflowId: 'w-1',
                    state: {} as any,
                    status: 'completed',
                    startTime: new Date(),
                    checkpoints: [],
                    metrics: { nodesExecuted: 5, executionTime: 1000 }
                },
                {
                    id: 'exec-2',
                    workflowId: 'w-2',
                    state: {} as any,
                    status: 'running',
                    startTime: new Date(),
                    checkpoints: [],
                    metrics: { nodesExecuted: 3, executionTime: 500 }
                },
                {
                    id: 'exec-3',
                    workflowId: 'w-3',
                    state: {} as any,
                    status: 'failed',
                    startTime: new Date(),
                    checkpoints: [],
                    metrics: { nodesExecuted: 2, executionTime: 300 }
                }
            ];

            for (const exec of executions) {
                mockLangGraphAdapter.executeWorkflow.mockResolvedValueOnce(exec);
                await workflow.executeWorkflow(exec.workflowId, {});
            }
        });

        it('should clear completed and failed executions', () => {
            const cleared = workflow.clearCompletedExecutions();

            expect(cleared).toBe(2);

            const remaining = workflow.listExecutions();
            expect(remaining).toHaveLength(1);
            expect(remaining[0].id).toBe('exec-2');
            expect(remaining[0].status).toBe('running');
        });
    });

    describe('getStatus()', () => {
        it('should return status string', async () => {
            // Create some workflows and executions
            mockLangGraphAdapter.createWorkflow.mockResolvedValue('w-1');
            await workflow.createWorkflow({
                id: 'w-1',
                name: 'Test',
                description: 'Test',
                stateSchema: {},
                nodes: [],
                edges: [],
                entryPoint: 'start'
            });

            const exec: WorkflowExecution = {
                id: 'exec-1',
                workflowId: 'w-1',
                state: {} as any,
                status: 'running',
                startTime: new Date(),
                checkpoints: [],
                metrics: { nodesExecuted: 0, executionTime: 0 }
            };
            mockLangGraphAdapter.executeWorkflow.mockResolvedValue(exec);
            await workflow.executeWorkflow('w-1', {});

            const status = workflow.getStatus();
            expect(status).toContain('Workflows: 1');
            expect(status).toContain('Executions: 1');
            expect(status).toContain('1 running');
        });
    });
});