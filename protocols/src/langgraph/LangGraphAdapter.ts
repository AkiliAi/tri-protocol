import { StateGraph, StateGraphArgs } from '@langchain/langgraph';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { EventEmitter } from 'eventemitter3';
import { Logger } from '@tri-protocol/logger';
import { v4 as uuidv4 } from 'uuid';
import {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  WorkflowState,
  WorkflowExecution,
  CompiledWorkflow,
  ExecutionConfig,
  LangGraphConfig,
  NodeFunction,
  ConditionalRoute,
  Checkpoint,
  WorkflowInfo,
  StreamOutput,
  HumanInputRequest,
  HumanInputResponse,
  NodeExecutionError,
  WorkflowTimeoutError,
  WorkflowError,
  ExecutionHistory
} from './types';

export class LangGraphAdapter extends EventEmitter {
  readonly protocolId = 'langgraph';
  readonly version = '1.0.0';
  readonly capabilities = [
    'workflow-execution',
    'state-management', 
    'conditional-routing',
    'parallel-execution',
    'checkpointing',
    'human-in-loop'
  ];
  
  private workflows = new Map<string, CompiledWorkflow>();
  private executions = new Map<string, WorkflowExecution>();
  private humanInputQueue = new Map<string, HumanInputResponse>();
  private logger: Logger;
  private a2aAdapter?: any; // Reference to A2A for agent communication
  private mcpAdapter?: any; // Reference to MCP for tool access
  private config: LangGraphConfig;
  private currentExecution?: WorkflowExecution;
  
  constructor(config?: LangGraphConfig) {
    super();
    this.logger = Logger.getLogger('LangGraphAdapter');
    this.config = config || {};
  }
  
  // Initialize with references to other protocols
  async initialize(config: any): Promise<void> {
    this.logger.info('Initializing LangGraph adapter');
    
    // Store references to other protocol adapters
    if (config.a2aAdapter) this.a2aAdapter = config.a2aAdapter;
    if (config.mcpAdapter) this.mcpAdapter = config.mcpAdapter;
    
    // Merge config
    this.config = { ...this.config, ...config };
    
    // Register built-in node types
    this.registerBuiltInNodes();
    
    this.emit('adapter:ready', { protocol: 'langgraph' });
  }
  
  // CREATE WORKFLOW
  async createWorkflow(definition: WorkflowDefinition): Promise<string> {
    this.logger.info('Creating workflow', { name: definition.name });
    
    // Create StateGraph with schema
    const stateChannels: StateGraphArgs<WorkflowState>['channels'] = {};
    
    // Convert state schema to LangGraph channels
    for (const [key, config] of Object.entries(definition.stateSchema)) {
      stateChannels[key] = {
        value: (left?: any, right?: any) => right !== undefined ? right : left,
        default: () => config.default ?? null
      };
    }
    
    const workflow = new StateGraph<WorkflowState, any>({
      channels: stateChannels
    });
    
    // Add nodes
    for (const node of definition.nodes) {
      workflow.addNode(node.id, this.wrapNodeFunction(node));
    }
    
    // Add edges
    for (const edge of definition.edges) {
      if (edge.condition) {
        // Conditional edge
        workflow.addConditionalEdges(
          edge.from as any,
          edge.condition as any,
          {
            [edge.to]: edge.to
          } as any
        );
      } else {
        // Direct edge
        workflow.addEdge(edge.from as any, edge.to as any);
      }
    }
    
    // Set entry point
    workflow.setEntryPoint(definition.entryPoint as any);
    
    // Add conditional routing
    if (definition.conditionalRouting) {
      for (const route of definition.conditionalRouting) {
        this.addConditionalRouting(workflow, route);
      }
    }
    
    // Compile workflow - only add checkpointer if explicitly configured
    const compileConfig: any = {};
    if (definition.config?.checkpointInterval) {
      // Only use checkpointer if explicitly needed for this workflow
      compileConfig.checkpointer = this.createCheckpointer();
    }
    
    const compiled = workflow.compile(compileConfig);
    
    // Store workflow
    const workflowId = definition.id || this.generateId();
    this.workflows.set(workflowId, {
      definition,
      graph: workflow,
      compiled
    });
    
    this.emit('workflow:created', { workflowId, name: definition.name });
    return workflowId;
  }
  
  // EXECUTE WORKFLOW
  async executeWorkflow(
    workflowId: string, 
    input: any,
    config?: ExecutionConfig
  ): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new WorkflowError(`Workflow ${workflowId} not found`, 'WORKFLOW_NOT_FOUND');
    }
    
    const executionId = this.generateId();
    const execution: WorkflowExecution = {
      id: executionId,
      workflowId,
      state: input,
      status: 'running',
      startTime: new Date(),
      checkpoints: [],
      metrics: {
        nodesExecuted: 0,
        executionTime: 0
      }
    };
    
    this.executions.set(executionId, execution);
    this.currentExecution = execution;
    this.emit('workflow:started', { executionId, workflowId });
    
    try {
      // Set up timeout if configured
      const timeoutMs = config?.timeout || this.config.defaultTimeout;
      let timeoutHandle: NodeJS.Timeout | undefined;
      
      if (timeoutMs) {
        timeoutHandle = setTimeout(() => {
          execution.status = 'failed';
          execution.error = new WorkflowTimeoutError(workflowId, timeoutMs);
          this.emit('workflow:timeout', { executionId, workflowId });
        }, timeoutMs);
      }
      
      // Execute with streaming support
      if (config?.streaming) {
        const stream = await workflow.compiled.stream(input, {
          recursionLimit: config?.recursionLimit || 25,
          configurable: {
            thread_id: executionId
          }
        });
        
        // Process stream
        for await (const output of stream) {
          this.handleStreamOutput(executionId, output);
        }
      } else {
        // Direct invocation
        const finalState = await workflow.compiled.invoke(input, {
          recursionLimit: config?.recursionLimit || 25,
          configurable: {
            thread_id: executionId
          }
        });
        
        execution.state = finalState;
      }
      
      // Clear timeout
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      
      execution.status = 'completed';
      execution.endTime = new Date();
      execution.metrics.executionTime = 
        execution.endTime.getTime() - execution.startTime.getTime();
      
      this.emit('workflow:completed', { executionId, result: execution.state });
      return execution;
      
    } catch (error: any) {
      execution.status = 'failed';
      execution.error = error;
      execution.endTime = new Date();
      this.emit('workflow:failed', { executionId, error });
      throw error;
    }
  }
  
  // NODE WRAPPER - Integrates with A2A and MCP
  private wrapNodeFunction(node: WorkflowNode): NodeFunction {
    return async (state: WorkflowState) => {
      this.logger.debug('Executing node', { nodeId: node.id, type: node.type });
      
      const startTime = Date.now();
      const history: ExecutionHistory = {
        nodeId: node.id,
        timestamp: new Date(),
        status: 'success',
        input: state
      };
      
      try {
        let result: any;
        
        switch (node.type) {
          case 'agent':
            result = await this.executeAgentNode(node, state);
            break;
            
          case 'tool':
            result = await this.executeToolNode(node, state);
            break;
            
          case 'llm':
            result = await this.executeLLMNode(node, state);
            break;
            
          case 'human':
            result = await this.executeHumanNode(node, state);
            break;
            
          case 'custom':
            result = await node.function(state);
            break;
            
          default:
            throw new NodeExecutionError(`Unknown node type: ${node.type}`, node.id);
        }
        
        history.output = result;
        history.duration = Date.now() - startTime;
        
        // Add history to state
        const updatedState = {
          ...result,
          history: [...(state.history || []), history]
        };
        
        this.emit('node:executed', { 
          nodeId: node.id, 
          type: node.type,
          duration: history.duration,
          success: true 
        });
        
        return updatedState;
        
      } catch (error: any) {
        this.logger.error('Node execution failed', error, { nodeId: node.id });
        
        history.status = 'failure';
        history.error = error;
        history.duration = Date.now() - startTime;
        
        if (node.retryPolicy) {
          return this.retryNode(node, state, error);
        }
        
        throw new NodeExecutionError(
          `Node ${node.id} execution failed: ${error.message}`,
          node.id,
          error
        );
      }
    };
  }
  
  // INTEGRATION WITH A2A
  private async executeAgentNode(
    node: WorkflowNode, 
    state: WorkflowState
  ): Promise<Partial<WorkflowState>> {
    if (!this.a2aAdapter) {
      throw new NodeExecutionError('A2A adapter not available for agent node', node.id);
    }
    
    const agentId = node.metadata?.agentId;
    if (!agentId) {
      throw new NodeExecutionError('Agent ID not specified in node metadata', node.id);
    }
    
    const message = node.metadata?.message || state.messages?.slice(-1)[0];
    
    // Generate correlation ID for tracking
    const correlationId = `workflow-${this.currentExecution?.workflowId}-node-${node.id}-${Date.now()}`;
    
    // Send message to agent via A2A
    const response = await this.a2aAdapter.sendMessage({
      to: agentId,
      type: 'TASK_REQUEST',
      correlationId,
      payload: {
        task: node.metadata?.task,
        context: state.context,
        message
      }
    });
    
    // Update state with response and correlation tracking
    const responseMessage = new AIMessage({
      content: response.data?.content || JSON.stringify(response.data),
      name: agentId
    });
    
    // Track pending A2A messages if response is async
    const pendingA2AMessages = state.context?.pendingA2AMessages || new Map();
    const a2aResponses = state.context?.a2aResponses || new Map();
    
    if (response.status === 'pending') {
      pendingA2AMessages.set(correlationId, node.id);
    } else {
      a2aResponses.set(node.id, response.data);
    }
    
    return {
      messages: [...(state.messages || []), responseMessage],
      context: {
        ...state.context,
        [`${node.id}_result`]: response.data,
        [`${node.id}_correlationId`]: correlationId,
        pendingA2AMessages,
        a2aResponses,
        lastA2AInteraction: {
          nodeId: node.id,
          agentId,
          correlationId,
          timestamp: new Date(),
          status: response.status || 'completed'
        }
      }
    };
  }
  
  // INTEGRATION WITH MCP
  private async executeToolNode(
    node: WorkflowNode,
    state: WorkflowState
  ): Promise<Partial<WorkflowState>> {
    if (!this.mcpAdapter) {
      throw new NodeExecutionError('MCP adapter not available for tool node', node.id);
    }
    
    const toolName = node.metadata?.tool;
    if (!toolName) {
      throw new NodeExecutionError('Tool name not specified in node metadata', node.id);
    }
    
    const toolArgs = node.metadata?.args || 
                     this.extractToolArgs(state, node);
    
    // Check for circuit breaker handling options
    const cbHandling = node.metadata?.circuitBreakerHandling;
    
    try {
      // Execute tool via MCP
      const result = await this.mcpAdapter.executeTool({
        toolName,
        arguments: toolArgs
      });
      
      // Update state with tool result
      return {
        context: {
          ...state.context,
          [`${node.id}_result`]: result,
          lastToolExecution: {
            tool: toolName,
            result,
            timestamp: new Date(),
            status: 'success'
          }
        }
      };
    } catch (error: any) {
      // Handle Circuit Breaker OPEN state
      if (error.message?.includes('Circuit breaker is OPEN')) {
        this.logger.warn(`Circuit breaker OPEN for tool ${toolName}`, { nodeId: node.id });
        
        if (cbHandling?.skipOnOpen) {
          // Skip this node and continue with fallback value
          return {
            context: {
              ...state.context,
              [`${node.id}_result`]: cbHandling.fallbackValue ?? null,
              [`${node.id}_skipped`]: true,
              lastToolExecution: {
                tool: toolName,
                result: cbHandling.fallbackValue ?? null,
                timestamp: new Date(),
                status: 'skipped',
                reason: 'Circuit breaker OPEN'
              }
            }
          };
        }
      }
      
      // Re-throw for normal error handling/retry
      throw error;
    }
  }
  
  // LLM NODE EXECUTION
  private async executeLLMNode(
    node: WorkflowNode,
    state: WorkflowState
  ): Promise<Partial<WorkflowState>> {
    // This would integrate with an LLM provider
    // For now, return a placeholder response
    const prompt = node.metadata?.prompt || 'Process the current state';
    
    const systemMessage = new SystemMessage(prompt);
    const response = new AIMessage({
      content: `LLM response for: ${prompt}`,
      name: 'llm'
    });
    
    return {
      messages: [...(state.messages || []), systemMessage, response],
      context: {
        ...state.context,
        [`${node.id}_llm_response`]: response.content
      }
    };
  }
  
  // PARALLEL EXECUTION
  async executeParallel(
    nodes: WorkflowNode[],
    state: WorkflowState
  ): Promise<Partial<WorkflowState>> {
    const results = await Promise.all(
      nodes.map(node => this.wrapNodeFunction(node)(state))
    );
    
    // Merge results
    return results.reduce((acc, result) => ({
      ...acc,
      ...result,
      context: {
        ...acc.context,
        ...result.context
      },
      messages: [
        ...(acc.messages || []),
        ...(result.messages || [])
      ]
    }), {} as Partial<WorkflowState>);
  }
  
  // RETRY LOGIC
  private async retryNode(
    node: WorkflowNode,
    state: WorkflowState,
    error: Error
  ): Promise<Partial<WorkflowState>> {
    const policy = node.retryPolicy;
    if (!policy) {
      throw error;
    }
    
    let lastError = error;
    let delay = policy.initialDelay || 1000;
    
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      this.logger.info(`Retrying node ${node.id}, attempt ${attempt}/${policy.maxAttempts}`);
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delay));
      
      try {
        // Retry the node execution
        return await node.function(state);
      } catch (retryError: any) {
        lastError = retryError;
        
        // Calculate next delay
        if (policy.backoffStrategy === 'exponential') {
          delay = Math.min(delay * 2, policy.maxDelay || 30000);
        } else {
          delay = Math.min(delay + (policy.initialDelay || 1000), policy.maxDelay || 30000);
        }
      }
    }
    
    throw new NodeExecutionError(
      `Node ${node.id} failed after ${policy.maxAttempts} attempts: ${lastError.message}`,
      node.id,
      lastError
    );
  }
  
  // CHECKPOINTING
  private createCheckpointer() {
    // Use MemorySaver from LangGraph for proper checkpointing
    try {
      const { MemorySaver } = require('@langchain/langgraph');
      const checkpointer = new MemorySaver();
      
      // Wrap to store checkpoints in our execution tracking
      const originalPut = checkpointer.put.bind(checkpointer);
      const self = this;
      
      checkpointer.put = async function(config: any, checkpoint: any, metadata?: any) {
        const result = await originalPut(config, checkpoint, metadata);
        
        // Store in our execution tracking
        const threadId = config?.configurable?.thread_id;
        if (threadId) {
          const execution = self.executions.get(threadId);
          if (execution) {
            execution.checkpoints.push({
              id: self.generateId(),
              state: checkpoint,
              timestamp: new Date()
            });
          }
        }
        
        return result;
      };
      
      return checkpointer;
    } catch (error) {
      // Fallback to manual implementation if MemorySaver not available
      this.logger.warn('MemorySaver not available, using fallback checkpointer');
      
      const checkpoints = new Map<string, any>();
      const self = this;
      
      return {
        getTuple: async function(config: any) {
          const threadId = config?.configurable?.thread_id;
          if (!threadId) return undefined;
          
          const checkpoint = checkpoints.get(threadId);
          if (!checkpoint) return undefined;
          
          return {
            config,
            checkpoint,
            metadata: checkpoint?.metadata || {},
            parentConfig: undefined
          };
        }.bind(this),
        
        list: async function(config: any, options?: any) {
          const threadId = config?.configurable?.thread_id;
          const checkpoint = checkpoints.get(threadId);
          
          if (!checkpoint) return [];
          
          return [{
            config,
            checkpoint,
            metadata: checkpoint?.metadata || {},
            parentConfig: undefined
          }];
        }.bind(this),
        
        put: async function(config: any, checkpoint: any, metadata?: any) {
          const threadId = config?.configurable?.thread_id;
          if (!threadId) return config;
          
          checkpoints.set(threadId, {
            ...checkpoint,
            metadata: metadata || {}
          });
          
          // Store in execution
          const executionId = threadId;
          const execution = self.executions.get(executionId);
          if (execution) {
            execution.checkpoints.push({
              id: self.generateId(),
              state: checkpoint,
              timestamp: new Date()
            });
          }
          
          return {
            configurable: {
              ...config.configurable,
              checkpoint_id: checkpoint?.id || self.generateId()
            }
          };
        }.bind(this),
        
        putWrites: async function(config: any, writes: any[], taskId: string) {
          const threadId = config?.configurable?.thread_id;
          if (!threadId) return;
          
          const checkpoint = checkpoints.get(threadId) || {};
          checkpoint.writes = writes;
          checkpoint.taskId = taskId;
          checkpoints.set(threadId, checkpoint);
        }.bind(this)
      };
    }
  }
  
  // HUMAN IN THE LOOP
  private async executeHumanNode(
    node: WorkflowNode,
    state: WorkflowState
  ): Promise<Partial<WorkflowState>> {
    const request: HumanInputRequest = {
      nodeId: node.id,
      prompt: node.metadata?.prompt,
      options: node.metadata?.options,
      timeout: node.metadata?.timeout || 300000, // 5 minutes default
      state
    };
    
    this.emit('human:input:required', request);
    
    // Wait for human input
    const input = await this.waitForHumanInput(node.id, request.timeout);
    
    const humanMessage = new HumanMessage({
      content: typeof input.input === 'string' ? input.input : JSON.stringify(input.input),
      name: input.userId || 'human'
    });
    
    return {
      messages: [...(state.messages || []), humanMessage],
      context: {
        ...state.context,
        [`${node.id}_human_input`]: input.input
      }
    };
  }
  
  // Wait for human input with timeout
  private async waitForHumanInput(nodeId: string, timeout?: number): Promise<HumanInputResponse> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = timeout ? setTimeout(() => {
        reject(new NodeExecutionError(`Human input timeout for node ${nodeId}`, nodeId));
      }, timeout) : undefined;
      
      // Check for input periodically
      const checkInterval = setInterval(() => {
        const input = this.humanInputQueue.get(nodeId);
        if (input) {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          clearInterval(checkInterval);
          this.humanInputQueue.delete(nodeId);
          resolve(input);
        }
      }, 100);
    });
  }
  
  // Submit human input
  submitHumanInput(nodeId: string, input: any, userId?: string): void {
    const response: HumanInputResponse = {
      nodeId,
      input,
      timestamp: new Date(),
      userId
    };
    
    this.humanInputQueue.set(nodeId, response);
    this.emit('human:input:submitted', response);
  }
  
  // CONDITIONAL ROUTING
  private addConditionalRouting(workflow: StateGraph<WorkflowState>, route: ConditionalRoute): void {
    // Build route map with all possible targets
    const routeMap: Record<string, string> = {};
    
    // Add all condition targets to route map
    for (const condition of route.conditions) {
      routeMap[condition.target] = condition.target;
    }
    
    // Add default route
    routeMap[route.default] = route.default;
    
    // Create routing function that returns the target node id
    const routingFunction = (state: WorkflowState): string => {
      for (const condition of route.conditions) {
        if (condition.condition(state)) {
          return condition.target;
        }
      }
      return route.default;
    };
    
    workflow.addConditionalEdges(route.source as any, routingFunction, routeMap as any);
  }
  
  // STREAM OUTPUT HANDLING
  private handleStreamOutput(executionId: string, output: any): void {
    const execution = this.executions.get(executionId);
    if (!execution) return;
    
    const streamOutput: StreamOutput = {
      nodeId: output.node || 'unknown',
      output: output,
      timestamp: new Date()
    };
    
    this.emit('workflow:stream', { executionId, output: streamOutput });
    
    // Update execution metrics
    execution.metrics.nodesExecuted++;
  }
  
  // WORKFLOW MANAGEMENT
  async pauseWorkflow(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (execution && execution.status === 'running') {
      execution.status = 'paused';
      this.emit('workflow:paused', { executionId });
    }
  }
  
  async resumeWorkflow(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (execution && execution.status === 'paused') {
      execution.status = 'running';
      
      // Resume from last checkpoint
      const lastCheckpoint = execution.checkpoints.slice(-1)[0];
      if (lastCheckpoint) {
        this.emit('workflow:resumed', { executionId });
        
        // Continue execution from checkpoint
        const workflow = this.workflows.get(execution.workflowId);
        if (workflow) {
          await this.executeWorkflow(
            execution.workflowId,
            lastCheckpoint.state,
            { checkpointing: true }
          );
        }
      }
    }
  }
  
  async cancelWorkflow(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (execution) {
      execution.status = 'failed';
      execution.error = new WorkflowError('Workflow cancelled by user', 'CANCELLED');
      execution.endTime = new Date();
      this.emit('workflow:cancelled', { executionId });
    }
  }
  
  // UTILITY METHODS
  getWorkflowStatus(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }
  
  listWorkflows(): WorkflowInfo[] {
    return Array.from(this.workflows.entries()).map(([id, w]) => ({
      id,
      name: w.definition.name,
      description: w.definition.description,
      nodeCount: w.definition.nodes.length,
      status: 'active',
      lastExecuted: this.getLastExecutionTime(id)
    }));
  }
  
  listExecutions(workflowId?: string): WorkflowExecution[] {
    const executions = Array.from(this.executions.values());
    if (workflowId) {
      return executions.filter(e => e.workflowId === workflowId);
    }
    return executions;
  }
  
  getWorkflow(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId)?.definition;
  }
  
  async deleteWorkflow(workflowId: string): Promise<void> {
    // Check if any executions are running
    const runningExecutions = this.listExecutions(workflowId)
      .filter(e => e.status === 'running');
    
    if (runningExecutions.length > 0) {
      throw new WorkflowError(
        `Cannot delete workflow with running executions`,
        'WORKFLOW_IN_USE',
        undefined,
        workflowId
      );
    }
    
    this.workflows.delete(workflowId);
    this.emit('workflow:deleted', { workflowId });
  }
  
  // HELPER METHODS
  private extractToolArgs(state: WorkflowState, node: WorkflowNode): any {
    // Extract tool arguments from state based on node configuration
    const argMapping = node.metadata?.argMapping || {};
    const args: any = {};
    
    for (const [key, path] of Object.entries(argMapping)) {
      // Simple path resolution (could be enhanced)
      const value = this.getValueFromPath(state, path as string);
      if (value !== undefined) {
        args[key] = value;
      }
    }
    
    return args;
  }
  
  private getValueFromPath(obj: any, path: string): any {
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return undefined;
      }
    }
    
    return current;
  }
  
  private getLastExecutionTime(workflowId: string): Date | undefined {
    const executions = this.listExecutions(workflowId);
    if (executions.length === 0) return undefined;
    
    return executions
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())[0]
      .startTime;
  }
  
  private generateId(): string {
    return uuidv4();
  }
  
  private registerBuiltInNodes(): void {
    // Register commonly used node types
    this.logger.debug('Registered built-in node types');
  }
  
  // CLEANUP
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down LangGraph adapter');
    
    // Cancel all running workflows
    for (const execution of this.executions.values()) {
      if (execution.status === 'running') {
        await this.cancelWorkflow(execution.id);
      }
    }
    
    // Clear all data
    this.workflows.clear();
    this.executions.clear();
    this.humanInputQueue.clear();
    
    this.emit('adapter:shutdown');
  }
}