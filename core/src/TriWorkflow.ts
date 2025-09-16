// packages/core/src/TriWorkflow.ts
import { EventEmitter } from 'eventemitter3';
import { LangGraphAdapter } from '../../protocols/src/langgraph';
import {
    WorkflowDefinition,
    WorkflowExecution,
    WorkflowNode,
    WorkflowState,
    ExecutionConfig
} from '../../protocols/src/langgraph/types';


type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';
import { A2ANode } from '../../protocols/src/langgraph/nodes/A2ANode';
import { MCPNode } from '../../protocols/src/langgraph/nodes/MCPNode';
import {
    createDataPipelineWorkflow,
    createResearchWorkflow,
    createCollaborationWorkflow,
    createToolChainWorkflow,
    createETLWorkflow
} from '../../protocols/src/langgraph/templates/WorkflowTemplates';
import { Logger } from '../../logger';

export interface WorkflowTemplate {
    name: string;
    description: string;
    factory: (config: any) => WorkflowDefinition;
}

export class TriWorkflow extends EventEmitter {
    private langGraphAdapter: LangGraphAdapter;
    private workflows = new Map<string, WorkflowDefinition>();
    private executions = new Map<string, WorkflowExecution>();
    private templates = new Map<string, WorkflowTemplate>();
    private logger: Logger;
    protected id: string;
    protected name: string;

    constructor(langGraphAdapter: LangGraphAdapter, config?: any) {
        super();
        this.langGraphAdapter = langGraphAdapter;
        this.logger = Logger.getLogger('TriWorkflow');
        this.id = config?.id || Math.random().toString(36).substring(7);
        this.name = config?.name || 'TriWorkflow';
        this.loadTemplates();
        this.setupEventHandlers();
    }

    /**
     * Load pre-built workflow templates
     */
    private loadTemplates(): void {
        // Register built-in templates
        this.templates.set('DataPipeline', {
            name: 'Data Pipeline',
            description: 'Read data → Process with agent → Save results → Notify',
            factory: createDataPipelineWorkflow
        });

        this.templates.set('Research', {
            name: 'Research Workflow',
            description: 'Search → Analyze with agents → Aggregate → Generate report',
            factory: createResearchWorkflow
        });

        this.templates.set('Collaboration', {
            name: 'Multi-Agent Collaboration',
            description: 'Coordinate multiple agents to complete complex tasks',
            factory: createCollaborationWorkflow
        });

        this.templates.set('ToolChain', {
            name: 'Tool Chain',
            description: 'Execute a sequence of MCP tools',
            factory: createToolChainWorkflow
        });

        this.templates.set('ETL', {
            name: 'ETL Workflow',
            description: 'Extract → Transform → Load data pipeline',
            factory: createETLWorkflow
        });

        this.logger.info(`Loaded ${this.templates.size} workflow templates`);
    }

    /**
     * Setup event handlers for workflow events
     */
    private setupEventHandlers(): void {
        this.langGraphAdapter.on('workflow:completed', (execution: WorkflowExecution) => {
            this.executions.set(execution.id, execution);
            this.emit('workflow:completed', execution);
        });

        this.langGraphAdapter.on('workflow:failed', (execution: WorkflowExecution) => {
            this.executions.set(execution.id, execution);
            this.emit('workflow:failed', execution);
        });

        this.langGraphAdapter.on('node:executed', (data: any) => {
            this.emit('node:executed', data);
        });
    }

    /**
     * Create a new workflow
     */
    async createWorkflow(definition: WorkflowDefinition): Promise<string> {
        this.logger.info('Creating workflow', { id: definition.id, name: definition.name });

        const workflowId = await this.langGraphAdapter.createWorkflow(definition);
        this.workflows.set(workflowId, definition);

        this.logger.info('Workflow created', { workflowId });
        return workflowId;
    }

    /**
     * Execute a workflow
     */
    async executeWorkflow(id: string, input: any, config?: ExecutionConfig): Promise<WorkflowExecution> {
        this.logger.info('Executing workflow', { id, input });

        const execution = await this.langGraphAdapter.executeWorkflow(id, input, config);
        this.executions.set(execution.id, execution);

        this.logger.info('Workflow execution started', { executionId: execution.id });
        return execution;
    }

    /**
     * Execute a workflow (alias for compatibility)
     */
    async execute(workflowIdOrDefinition?: string | WorkflowDefinition, input?: any): Promise<WorkflowExecution> {
        let workflowId: string;

        if (typeof workflowIdOrDefinition === 'string') {
            workflowId = workflowIdOrDefinition;
        } else if (workflowIdOrDefinition) {
            workflowId = await this.createWorkflow(workflowIdOrDefinition);
        } else {
            // Use the instance's workflow if no parameter provided
            const defaultWorkflow = this.workflows.values().next().value;
            if (!defaultWorkflow) {
                throw new Error('No workflow available to execute');
            }
            workflowId = defaultWorkflow.id;
        }

        return this.executeWorkflow(workflowId, input || {});
    }

    /**
     * Pause a running workflow
     */
    async pauseWorkflow(executionId: string): Promise<void> {
        this.logger.info('Pausing workflow', { executionId });
        await this.langGraphAdapter.pauseWorkflow(executionId);

        const execution = this.executions.get(executionId);
        if (execution) {
            execution.status = 'paused';
            this.executions.set(executionId, execution);
        }
    }

    /**
     * Resume a paused workflow
     */
    async resumeWorkflow(executionId: string): Promise<void> {
        this.logger.info('Resuming workflow', { executionId });
        await this.langGraphAdapter.resumeWorkflow(executionId);

        const execution = this.executions.get(executionId);
        if (execution) {
            execution.status = 'running';
            this.executions.set(executionId, execution);
        }
    }

    /**
     * Get workflow execution status
     */
    async getWorkflowStatus(executionId: string): Promise<WorkflowStatus> {
        const execution = this.executions.get(executionId);
        if (!execution) {
            throw new Error(`Execution not found: ${executionId}`);
        }
        return execution.status;
    }

    /**
     * Create workflow from template
     */
    async createFromTemplate(templateName: string, config: any): Promise<string> {
        const template = this.templates.get(templateName);
        if (!template) {
            throw new Error(`Template not found: ${templateName}`);
        }

        this.logger.info('Creating workflow from template', { template: templateName, config });

        const definition = template.factory(config);
        return this.createWorkflow(definition);
    }

    /**
     * List available templates
     */
    async listTemplates(): Promise<WorkflowTemplate[]> {
        return Array.from(this.templates.values());
    }

    /**
     * Create a workflow node from an agent
     */
    async createNodeFromAgent(agentId: string, options?: any): Promise<WorkflowNode> {
        return A2ANode.createSendMessageNode(agentId, options);
    }

    /**
     * Create a workflow node from a tool
     */
    async createNodeFromTool(toolName: string, args?: any, options?: any): Promise<WorkflowNode> {
        return MCPNode.createToolNode(toolName, args, options);
    }

    /**
     * Create a multi-protocol workflow combining A2A and MCP
     */
    async createMultiProtocolWorkflow(config: {
        name: string;
        description: string;
        inputSource?: string;
        processingAgent?: string;
        tools?: string[];
        outputPath?: string;
    }): Promise<string> {
        const nodes: WorkflowNode[] = [];
        const edges = [];

        // 1. Read input if specified
        if (config.inputSource) {
            const readNode = MCPNode.createFileReadNode(config.inputSource);
            nodes.push(readNode);
        }

        // 2. Process with agent if specified
        if (config.processingAgent) {
            const agentNode = A2ANode.createSendMessageNode(config.processingAgent);
            nodes.push(agentNode);
            if (nodes.length > 1) {
                edges.push({ from: nodes[nodes.length - 2].id, to: agentNode.id });
            }
        }

        // 3. Execute tools if specified
        if (config.tools && config.tools.length > 0) {
            for (const tool of config.tools) {
                const toolNode = MCPNode.createToolNode(tool);
                nodes.push(toolNode);
                if (nodes.length > 1) {
                    edges.push({ from: nodes[nodes.length - 2].id, to: toolNode.id });
                }
            }
        }

        // 4. Save output if specified
        if (config.outputPath) {
            const writeNode = MCPNode.createFileWriteNode(config.outputPath, {
                contentFromState: 'context.result'
            });
            nodes.push(writeNode);
            if (nodes.length > 1) {
                edges.push({ from: nodes[nodes.length - 2].id, to: writeNode.id });
            }
        }

        // 5. Broadcast completion
        const broadcastNode = A2ANode.createBroadcastNode();
        nodes.push(broadcastNode);
        if (nodes.length > 1) {
            edges.push({ from: nodes[nodes.length - 2].id, to: broadcastNode.id });
        }

        const workflow: WorkflowDefinition = {
            id: `multi-protocol-${Date.now()}`,
            name: config.name,
            description: config.description,
            stateSchema: {
                input: { value: null },
                context: { value: {} },
                result: { value: null }
            },
            nodes,
            edges,
            entryPoint: nodes[0].id
        };

        return this.createWorkflow(workflow);
    }

    /**
     * Get workflow by ID
     */
    getWorkflow(id: string): WorkflowDefinition | undefined {
        return this.workflows.get(id);
    }

    /**
     * Get execution by ID
     */
    getExecution(id: string): WorkflowExecution | undefined {
        return this.executions.get(id);
    }

    /**
     * List all workflows
     */
    listWorkflows(): WorkflowDefinition[] {
        return Array.from(this.workflows.values());
    }

    /**
     * List all executions
     */
    listExecutions(): WorkflowExecution[] {
        return Array.from(this.executions.values());
    }

    /**
     * Get status (override for compatibility)
     */
    getStatus(): string {
        const workflowCount = this.workflows.size;
        const executionCount = this.executions.size;
        const runningCount = Array.from(this.executions.values())
            .filter(e => e.status === 'running').length;

        return `Workflows: ${workflowCount}, Executions: ${executionCount} (${runningCount} running)`;
    }

    /**
     * Clear completed executions
     */
    clearCompletedExecutions(): number {
        let cleared = 0;
        for (const [id, execution] of this.executions) {
            if (execution.status === 'completed' || execution.status === 'failed') {
                this.executions.delete(id);
                cleared++;
            }
        }
        this.logger.info(`Cleared ${cleared} completed executions`);
        return cleared;
    }
}