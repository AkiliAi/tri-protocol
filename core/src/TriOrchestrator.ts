// packages/core/src/TriOrchestrator.ts
export class TriOrchestrator {
    private agents: Map<string, TriAgent> = new Map();
    private workflows: Map<string, TriWorkflow> = new Map();
    private protocolAdapters: ProtocolAdapters;
    private messageQueue: PriorityQueue<OrchestratorMessage>;
    private executionEngine: WorkflowExecutionEngine;

    constructor(config: TriProtocolConfig) {
        this.initializeAdapters(config.protocols);
        this.messageQueue = new PriorityQueue();
        this.executionEngine = new WorkflowExecutionEngine();
    }

    // Agent orchestration
    async routeMessage(from: string, to: string, message: any): Promise<any> {
        const targetAgent = this.agents.get(to);
        if (!targetAgent) {
            throw new Error(`Agent ${to} not found`);
        }

        // Determine best protocol for communication
        const protocol = this.selectProtocol(from, to, message);

        switch (protocol) {
            case 'a2a':
                return this.protocolAdapters.a2a.sendMessage(from, to, message);
            case 'direct':
                return targetAgent.handleDirectMessage(message);
            default:
                return this.fallbackCommunication(from, to, message);
        }
    }

    // Workflow orchestration
    async executeWorkflow(workflow: TriWorkflow): Promise<WorkflowResult> {
        // Create execution context
        const context = this.createExecutionContext(workflow);

        // Execute via LangGraph adapter
        const result = await this.protocolAdapters.langgraph.execute(
            workflow.graph,
            workflow.state,
            context
        );

        // Post-process results
        return this.processWorkflowResult(result);
    }

    // Protocol selection logic
    private selectProtocol(from: string, to: string, message: any): string {
        // Intelligent protocol selection based on:
        // - Agent capabilities
        // - Message type
        // - Performance requirements
        // - Current system load

        const fromAgent = this.agents.get(from);
        const toAgent = this.agents.get(to);

        if (fromAgent?.supportsA2A && toAgent?.supportsA2A) {
            return 'a2a';
        }

        if (message.requiresWorkflow) {
            return 'langgraph';
        }

        return 'direct';
    }
}