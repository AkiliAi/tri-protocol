// packages/core/src/TriOrchestrator.ts
import { Logger } from '@tri-protocol/logger';
import { TriProtocol } from './TriProtocol';
import { TriRegistry } from './TriRegistry';
import { WorkflowDefinition } from '../../protocols/src/langgraph/types';
import { Task as A2ATask, TaskDefinition, TaskStatus } from '../../protocols/src/a2a/types';

// Use a different interface name for orchestrator-specific task structure
export interface OrchestratorTask {
    id?: string;
    type: 'workflow' | 'communication' | 'tool' | 'simple';
    name?: string;
    input?: any;
    steps?: TaskStep[];
    target?: string;
    tool?: string;
    args?: any;
    metadata?: Record<string, any>;
    requiredCapability?: string;
}

export interface TaskStep {
    id: string;
    type: string;
    action: string;
    params?: any;
    dependsOn?: string[];
}

export interface TaskAnalysis {
    requiresReasoning: boolean;
    requiresTools: boolean;
    requiresCommunication: boolean;
    primaryCapability: string;
    suggestedTool?: string;
    confidence: number;
}

/**
 * TriOrchestrator - Intelligent router to appropriate protocol
 * Routes tasks to LangGraph (workflows), A2A (communication), or MCP (tools)
 */
export class TriOrchestrator {
    private logger: Logger;
    private protocol: TriProtocol;
    private registry: TriRegistry;

    constructor(protocol: TriProtocol, registry?: TriRegistry) {
        this.protocol = protocol;
        this.registry = registry || new TriRegistry();
        this.logger = Logger.getLogger('TriOrchestrator');
        this.logger.info('TriOrchestrator initialized as intelligent protocol router');
    }
    
    /**
     * Execute a task by routing to the appropriate protocol
     */
    async execute(task: OrchestratorTask): Promise<any> {
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
    private async executeWorkflow(task: OrchestratorTask): Promise<any> {
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
    private async executeCommunication(task: OrchestratorTask): Promise<any> {
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
    private async executeTool(task: OrchestratorTask): Promise<any> {
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
     * Execute simple task by intelligently determining best protocol
     */
    private async executeSimpleTask(task: OrchestratorTask): Promise<any> {
        this.logger.debug('Analyzing task for intelligent routing', { task });

        // Step 1: Analyze task requirements
        const analysis = await this.analyzeTask(task);
        this.logger.debug('Task analysis complete', analysis);

        // Step 2: Route based on analysis
        try {
            // Check if task needs reasoning (LLM-powered agents)
            if (analysis.requiresReasoning) {
                this.logger.info('Task requires reasoning, finding capable agent');
                const agents = await this.registry.findByCapability('reasoning');
                if (agents.length > 0) {
                    const agent = this.selectOptimalAgent(agents);
                    return await this.routeToAgent(agent.profile.agentId, task);
                }
                // Fallback to any agent with LLM capability
                const llmAgents = await this.registry.findByCapability('llm');
                if (llmAgents.length > 0) {
                    const agent = this.selectOptimalAgent(llmAgents);
                    return await this.routeToAgent(agent.profile.agentId, task);
                }
            }

            // Check if task needs specific tools
            if (analysis.requiresTools && analysis.suggestedTool) {
                this.logger.info('Task requires tools, using MCP', { tool: analysis.suggestedTool });
                const mcp = this.protocol.getMCP();
                if (mcp) {
                    return await this.protocol.executeTool(
                        analysis.suggestedTool,
                        task.args || task.metadata?.args || {}
                    );
                }
            }

            // Check if task needs agent communication
            if (analysis.requiresCommunication) {
                this.logger.info('Task requires agent communication');
                const a2a = this.protocol.getA2A();
                if (a2a) {
                    // If specific target is mentioned
                    if (task.target) {
                        return await this.routeToAgent(task.target, task);
                    }

                    // Find agent by capability
                    const agents = await this.findAgentsForCapability(analysis.primaryCapability);
                    if (agents.length > 0) {
                        const agent = this.selectOptimalAgent(agents);
                        return await this.routeToAgent(agent.profile.agentId, task);
                    }
                }
            }

            // Try to find any agent with the primary capability
            const capableAgents = await this.findAgentsForCapability(analysis.primaryCapability);
            if (capableAgents.length > 0) {
                const agent = this.selectOptimalAgent(capableAgents);
                this.logger.info('Found capable agent', { agentId: agent.profile.agentId, capability: analysis.primaryCapability });
                return await this.routeToAgent(agent.profile.agentId, task);
            }

            // If no specific routing is possible, try workflow
            if (this.protocol.getLangGraph()) {
                this.logger.info('No specific routing found, attempting workflow execution');
                return await this.executeWorkflow({ ...task, type: 'workflow' });
            }

            throw new Error(`Cannot route task - no suitable protocol or agent found: ${task.id || task.name}`);

        } catch (error) {
            this.logger.error('Task routing failed', error, { task, analysis });
            throw error;
        }
    }

    /**
     * Analyze task to determine routing requirements
     */
    private async analyzeTask(task: OrchestratorTask): Promise<TaskAnalysis> {
        const analysis: TaskAnalysis = {
            requiresReasoning: false,
            requiresTools: false,
            requiresCommunication: false,
            primaryCapability: 'general',
            confidence: 0.5
        };

        // Check task metadata for hints
        if (task.metadata) {
            if (task.metadata.requiresReasoning) analysis.requiresReasoning = true;
            if (task.metadata.tool) {
                analysis.requiresTools = true;
                analysis.suggestedTool = task.metadata.tool;
            }
            if (task.metadata.capability) {
                analysis.primaryCapability = task.metadata.capability;
            }
        }

        // Check for tool requirements
        if (task.tool) {
            analysis.requiresTools = true;
            analysis.suggestedTool = task.tool;
            analysis.confidence = 0.9;
        }

        // Check for communication requirements
        if (task.target || task.requiredCapability) {
            analysis.requiresCommunication = true;
            if (task.requiredCapability) {
                analysis.primaryCapability = task.requiredCapability;
            }
            analysis.confidence = 0.8;
        }

        // Analyze task name/input for patterns
        const taskText = `${task.name || ''} ${JSON.stringify(task.input || '')}`.toLowerCase();

        // Reasoning patterns
        if (taskText.includes('analyze') || taskText.includes('reason') ||
            taskText.includes('explain') || taskText.includes('understand') ||
            taskText.includes('generate') || taskText.includes('create')) {
            analysis.requiresReasoning = true;
            analysis.confidence = Math.max(analysis.confidence, 0.7);
        }

        // Tool patterns
        if (taskText.includes('file') || taskText.includes('read') ||
            taskText.includes('write') || taskText.includes('execute') ||
            taskText.includes('fetch') || taskText.includes('api')) {
            analysis.requiresTools = true;
            analysis.confidence = Math.max(analysis.confidence, 0.7);

            // Suggest specific tools
            if (taskText.includes('file') || taskText.includes('read')) {
                analysis.suggestedTool = 'filesystem:read_file';
            } else if (taskText.includes('write')) {
                analysis.suggestedTool = 'filesystem:write_file';
            } else if (taskText.includes('fetch') || taskText.includes('api')) {
                analysis.suggestedTool = 'web:fetch';
            }
        }

        // Communication patterns
        if (taskText.includes('send') || taskText.includes('notify') ||
            taskText.includes('ask') || taskText.includes('coordinate') ||
            taskText.includes('delegate')) {
            analysis.requiresCommunication = true;
            analysis.confidence = Math.max(analysis.confidence, 0.7);
        }

        // Determine primary capability based on patterns
        if (taskText.includes('data') || taskText.includes('process')) {
            analysis.primaryCapability = 'data-processing';
        } else if (taskText.includes('analyze')) {
            analysis.primaryCapability = 'analysis';
        } else if (taskText.includes('monitor')) {
            analysis.primaryCapability = 'monitoring';
        } else if (taskText.includes('coordinate')) {
            analysis.primaryCapability = 'coordination';
        }

        return analysis;
    }

    /**
     * Route task to specific agent
     */
    private async routeToAgent(agentId: string, task: OrchestratorTask): Promise<any> {
        const a2a = this.protocol.getA2A();
        if (!a2a) {
            throw new Error('A2A protocol not available');
        }

        // Convert OrchestratorTask to A2A Task format
        const a2aTask: Partial<A2ATask> = {
            id: task.id || `task-${Date.now()}`,
            contextId: `ctx-${Date.now()}`,
            status: {
                state: 'submitted',
                timestamp: new Date().toISOString()
            },
            metadata: task.metadata || {},
            kind: 'task' as const
        };

        this.logger.info('Routing task to agent', { agentId, taskId: a2aTask.id });

        return await this.protocol.sendMessage(
            agentId,
            {
                role: 'user' as const,
                parts: [{
                    kind: 'text' as const,
                    text: task.input || JSON.stringify(task)
                }],
                messageId: `msg-${Date.now()}`,
                kind: 'request' as any
            },
            { task: a2aTask }
        );
    }

    /**
     * Find agents by capability
     */
    private async findAgentsForCapability(capability: string): Promise<any[]> {
        // Try registry first
        const registryAgents = this.registry.findByCapability(capability);
        if (registryAgents.length > 0) {
            return registryAgents;
        }

        // Try A2A protocol
        const a2a = this.protocol.getA2A();
        if (a2a) {
            const agents = await this.protocol.findAgentsByCapability(capability);
            return agents.map(profile => ({ profile, registeredAt: new Date() }));
        }

        return [];
    }

    /**
     * Select optimal agent from list
     */
    private selectOptimalAgent(agents: any[]): any {
        if (agents.length === 0) {
            throw new Error('No agents available');
        }

        // Simple selection: return first agent
        // TODO: Implement smarter selection based on load, reliability, etc.
        return agents[0];
    }
    
    /**
     * Convert task to workflow definition
     */
    private taskToWorkflow(task: OrchestratorTask): WorkflowDefinition {
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