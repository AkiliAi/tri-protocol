// packages/core/src/TriOrchestrator.ts
import { Logger } from '@tri-protocol/logger';
import { TriProtocol } from './TriProtocol';
import { WorkflowDefinition } from '../../protocols/src/langgraph/types';

export interface Task {
    id?: string;
    type: 'workflow' | 'communication' | 'tool' | 'simple';
    name?: string;
    input?: any;
    steps?: TaskStep[];
    target?: string;
    tool?: string;
    args?: any;
}

export interface TaskStep {
    id: string;
    type: string;
    action: string;
    params?: any;
    dependsOn?: string[];
}

/**
 * TriOrchestrator - Simple router to appropriate protocol
 * Routes tasks to LangGraph (workflows), A2A (communication), or MCP (tools)
 */
export class TriOrchestrator {
    private logger: Logger;
    private protocol: TriProtocol;
    
    constructor(protocol: TriProtocol) {
        this.protocol = protocol;
        this.logger = Logger.getLogger('TriOrchestrator');
        this.logger.info('TriOrchestrator initialized as protocol router');
    }
    
    /**
     * Execute a task by routing to the appropriate protocol
     */
    async execute(task: Task): Promise<any> {
        this.logger.info('Executing task', { taskType: task.type, taskName: task.name });
        
        try {
            // Complex multi-step task → LangGraph
            if (task.type === 'workflow' || (task.steps && task.steps.length > 1)) {
                return await this.executeWorkflow(task);
            }
            
            // Simple message → A2A
            if (task.type === 'communication') {
                return await this.executeCommunication(task);
            }
            
            // Tool execution → MCP
            if (task.type === 'tool') {
                return await this.executeTool(task);
            }
            
            // Simple task - determine best protocol
            return await this.executeSimpleTask(task);
            
        } catch (error) {
            this.logger.error('Task execution failed', error, { task });
            throw error;
        }
    }
    
    /**
     * Execute workflow using LangGraph
     */
    private async executeWorkflow(task: Task): Promise<any> {
        const langGraph = this.protocol.getLangGraph();
        if (!langGraph) {
            throw new Error('LangGraph not available for workflow execution');
        }
        
        this.logger.debug('Routing to LangGraph for workflow execution', { task });
        
        // Convert task to workflow definition
        const workflow = this.taskToWorkflow(task);
        const workflowId = await this.protocol.createWorkflow(workflow);
        
        // Execute workflow
        return await this.protocol.executeWorkflow(workflowId, task.input || {});
    }
    
    /**
     * Execute communication using A2A
     */
    private async executeCommunication(task: Task): Promise<any> {
        const a2a = this.protocol.getA2A();
        if (!a2a) {
            throw new Error('A2A not available for communication');
        }
        
        this.logger.debug('Routing to A2A for communication', { task });
        
        if (!task.target) {
            throw new Error('Communication task requires a target agent');
        }
        
        return await this.protocol.sendMessage(
            task.target,
            { 
                role: 'user' as const,
                parts: [{ kind: 'text' as const, text: task.input || '' }],
                messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`,
                kind: 'request' as any
            }
        );
    }
    
    /**
     * Execute tool using MCP
     */
    private async executeTool(task: Task): Promise<any> {
        const mcp = this.protocol.getMCP();
        if (!mcp) {
            throw new Error('MCP not available for tool execution');
        }
        
        this.logger.debug('Routing to MCP for tool execution', { task });
        
        if (!task.tool) {
            throw new Error('Tool task requires a tool name');
        }
        
        return await this.protocol.executeTool(task.tool, task.args || {});
    }
    
    /**
     * Execute simple task by determining best protocol
     */
    private async executeSimpleTask(task: Task): Promise<any> {
        this.logger.debug('Determining best protocol for simple task', { task });
        
        // If task has a target, use A2A
        if (task.target) {
            return await this.executeCommunication({ ...task, type: 'communication' });
        }
        
        // If task has a tool, use MCP
        if (task.tool) {
            return await this.executeTool({ ...task, type: 'tool' });
        }
        
        // Default to workflow for complex logic
        return await this.executeWorkflow({ ...task, type: 'workflow' });
    }
    
    /**
     * Convert task to workflow definition
     */
    private taskToWorkflow(task: Task): WorkflowDefinition {
        this.logger.debug('Converting task to workflow definition', { task });
        
        const nodes = task.steps?.map((step, index) => ({
            id: step.id || `step-${index}`,
            type: 'custom' as const,
            name: step.action,
            function: async (state: any) => {
                // This would be implemented based on step type
                return {
                    ...state,
                    [`${step.id}_complete`]: true
                };
            }
        })) || [];
        
        const edges = task.steps?.slice(0, -1).map((step, index) => ({
            from: step.id || `step-${index}`,
            to: task.steps![index + 1].id || `step-${index + 1}`
        })) || [];
        
        return {
            id: task.id || `task-${Date.now()}`,
            name: task.name || 'Dynamic Task Workflow',
            description: `Auto-generated workflow for task: ${task.name}`,
            stateSchema: {
                input: { value: task.input },
                output: { value: null },
                currentStep: { value: 0 },
                steps: { value: task.steps || [] }
            },
            nodes,
            edges,
            entryPoint: nodes[0]?.id || 'start',
            config: {
                timeout: 60000,
                maxRetries: 2
            }
        };
    }
    
    /**
     * Get orchestrator status
     */
    getStatus(): any {
        const status = {
            initialized: true,
            protocols: {
                a2a: !!this.protocol.getA2A(),
                langgraph: !!this.protocol.getLangGraph(),
                mcp: !!this.protocol.getMCP()
            },
            capabilities: {
                workflows: !!this.protocol.getLangGraph(),
                communication: !!this.protocol.getA2A(),
                tools: !!this.protocol.getMCP()
            }
        };
        
        this.logger.debug('Orchestrator status', status);
        return status;
    }
}