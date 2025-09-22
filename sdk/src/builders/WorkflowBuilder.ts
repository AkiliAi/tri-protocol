import { TriProtocol, TriWorkflow } from '../types/core-types';
import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import {
  SDKWorkflow,
  WorkflowConfig,
  WorkflowNode,
  WorkflowEdge,
  WorkflowStatus,
  SDKError
} from '../types';
import { Serializers } from '../utils/Serializers';

export class SDKWorkflowImpl extends EventEmitter implements SDKWorkflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[] = [];
  edges: WorkflowEdge[] = [];

  private workflow?: TriWorkflow;
  private protocol: TriProtocol;
  private config: WorkflowConfig;
  private status: WorkflowStatus = { status: 'pending' };

  constructor(protocol: TriProtocol, config: WorkflowConfig, nodes: WorkflowNode[], edges: WorkflowEdge[]) {
    super();
    this.id = uuidv4();
    this.name = config.name;
    this.description = config.description;
    this.protocol = protocol;
    this.config = config;
    this.nodes = nodes;
    this.edges = edges;
  }

  async execute(input: any): Promise<any> {
    this.status = { status: 'running', progress: 0 };
    this.emit('status:changed', this.status);
    this.emit('started', input);

    try {
      // Create TriWorkflow instance
      this.workflow = new TriWorkflow({
        id: this.id,
        name: this.name,
        nodes: this.nodes.map(n => ({
          id: n.id,
          type: n.type,
          config: n.config
        })),
        edges: this.edges.map(e => ({
          source: e.from,
          target: e.to,
          condition: e.condition
        }))
      } as any);

      // Execute workflow through orchestrator
      const orchestrator = this.protocol.getOrchestrator();
      const result = await orchestrator.executeWorkflow(this.workflow, input);

      this.status = { status: 'completed', progress: 100 };
      this.emit('status:changed', this.status);
      this.emit('completed', result);

      return result;
    } catch (error) {
      this.status = { status: 'failed', error };
      this.emit('status:changed', this.status);
      this.emit('failed', error);
      throw new SDKError('Workflow execution failed', 'WORKFLOW_ERROR', error);
    }
  }

  getStatus(): WorkflowStatus {
    return { ...this.status };
  }

  async pause(): Promise<void> {
    if (this.status.status !== 'running') {
      throw new SDKError('Cannot pause workflow that is not running', 'INVALID_STATE');
    }

    this.status = { ...this.status, status: 'paused' };
    this.emit('status:changed', this.status);
    this.emit('paused');

    // TODO: Implement actual pause logic when orchestrator supports it
  }

  async resume(): Promise<void> {
    if (this.status.status !== 'paused') {
      throw new SDKError('Cannot resume workflow that is not paused', 'INVALID_STATE');
    }

    this.status = { ...this.status, status: 'running' };
    this.emit('status:changed', this.status);
    this.emit('resumed');

    // TODO: Implement actual resume logic when orchestrator supports it
  }

  async cancel(): Promise<void> {
    if (this.status.status === 'completed' || this.status.status === 'failed') {
      throw new SDKError('Cannot cancel completed workflow', 'INVALID_STATE');
    }

    this.status = { status: 'failed', error: 'Cancelled by user' };
    this.emit('status:changed', this.status);
    this.emit('cancelled');

    // TODO: Implement actual cancellation logic when orchestrator supports it
  }

  getNodes(): WorkflowNode[] {
    return this.nodes;
  }

  getEdges(): WorkflowEdge[] {
    return this.edges;
  }

  getNode(nodeId: string): WorkflowNode | undefined {
    return this.nodes.find(node => node.id === nodeId);
  }

  toMermaid(): string {
    return Serializers.workflowToMermaid({
      id: this.id,
      name: this.name,
      nodes: this.nodes,
      edges: this.edges
    });
  }
}

interface StepConfig {
  type: string;
  [key: string]: any;
}

interface ConditionConfig {
  expression: string;
  [key: string]: any;
}

export class BranchBuilder {
  constructor(
    private workflowBuilder: WorkflowBuilder,
    private conditionNode: WorkflowNode
  ) {}

  then(steps: (builder: WorkflowBuilder) => void): BranchBuilder {
    const thenBuilder = new WorkflowBuilder(
      this.workflowBuilder['protocol'],
      this.workflowBuilder['sdk']
    );

    steps(thenBuilder);

    // Add nodes and edges from then branch
    this.workflowBuilder['nodes'].push(...thenBuilder['nodes']);
    this.workflowBuilder['edges'].push(...thenBuilder['edges']);

    // Connect condition to then branch
    if (thenBuilder['nodes'].length > 0) {
      this.workflowBuilder['edges'].push({
        from: this.conditionNode.id,
        to: thenBuilder['nodes'][0].id,
        type: 'conditional',
        condition: 'true'
      });
    }

    return this;
  }

  else(steps: (builder: WorkflowBuilder) => void): WorkflowBuilder {
    const elseBuilder = new WorkflowBuilder(
      this.workflowBuilder['protocol'],
      this.workflowBuilder['sdk']
    );

    steps(elseBuilder);

    // Add nodes and edges from else branch
    this.workflowBuilder['nodes'].push(...elseBuilder['nodes']);
    this.workflowBuilder['edges'].push(...elseBuilder['edges']);

    // Connect condition to else branch
    if (elseBuilder['nodes'].length > 0) {
      this.workflowBuilder['edges'].push({
        from: this.conditionNode.id,
        to: elseBuilder['nodes'][0].id,
        type: 'conditional',
        condition: 'false'
      });
    }

    return this.workflowBuilder;
  }
}

export class WorkflowBuilder {
  private nodes: WorkflowNode[] = [];
  private edges: WorkflowEdge[] = [];
  private config: WorkflowConfig = { name: '' };
  private nodeCounter = 0;

  constructor(private protocol: TriProtocol, private sdk?: any) {}

  withName(name: string): this {
    this.config.name = name;
    return this;
  }

  withDescription(description: string): this {
    this.config.description = description;
    return this;
  }

  withTimeout(timeout: number): this {
    this.config.timeout = timeout;
    return this;
  }

  withRetries(retries: number): this {
    this.config.retries = retries;
    return this;
  }

  withCheckpointing(enabled: boolean = true): this {
    this.config.checkpointing = enabled;
    return this;
  }

  addStep(step: string | StepConfig): this {
    const node = this.createNode(step);
    this.nodes.push(node);

    // Auto-connect to previous node
    if (this.nodes.length > 1) {
      const prevNode = this.nodes[this.nodes.length - 2];
      this.edges.push({
        from: prevNode.id,
        to: node.id,
        type: 'sequential'
      });
    }

    return this;
  }

  parallel(...steps: (string | StepConfig)[]): this {
    const parallelNodes = steps.map(s => this.createNode(s));
    const startNode = this.createNode({ type: 'parallel-start' });
    const endNode = this.createNode({ type: 'parallel-end' });

    this.nodes.push(startNode, ...parallelNodes, endNode);

    // Connect previous node to start
    if (this.nodes.length > parallelNodes.length + 2) {
      const prevNode = this.nodes[this.nodes.length - parallelNodes.length - 3];
      this.edges.push({ from: prevNode.id, to: startNode.id });
    }

    // Connect start to all parallel nodes
    for (const node of parallelNodes) {
      this.edges.push({ from: startNode.id, to: node.id });
      this.edges.push({ from: node.id, to: endNode.id });
    }

    return this;
  }

  condition(condition: string | ConditionConfig): BranchBuilder {
    const conditionNode = this.createNode({
      type: 'condition',
      config: typeof condition === 'string' ? { expression: condition } : condition
    });

    this.nodes.push(conditionNode);

    // Connect to previous node if exists
    if (this.nodes.length > 1) {
      const prevNode = this.nodes[this.nodes.length - 2];
      this.edges.push({ from: prevNode.id, to: conditionNode.id });
    }

    return new BranchBuilder(this, conditionNode);
  }

  loop(condition: string, body: (builder: WorkflowBuilder) => void): this {
    const loopStart = this.createNode({
      type: 'loop-start',
      config: { condition }
    });

    const loopBuilder = new WorkflowBuilder(this.protocol, this.sdk);
    body(loopBuilder);

    const loopEnd = this.createNode({ type: 'loop-end' });

    // Connect to previous node if exists
    if (this.nodes.length > 0) {
      const prevNode = this.nodes[this.nodes.length - 1];
      this.edges.push({ from: prevNode.id, to: loopStart.id });
    }

    this.nodes.push(loopStart, ...loopBuilder.nodes, loopEnd);
    this.edges.push(...loopBuilder.edges);

    // Connect loop body
    if (loopBuilder.nodes.length > 0) {
      this.edges.push({ from: loopStart.id, to: loopBuilder.nodes[0].id });
      this.edges.push({
        from: loopBuilder.nodes[loopBuilder.nodes.length - 1].id,
        to: loopEnd.id
      });
    }

    // Loop back edge
    this.edges.push({ from: loopEnd.id, to: loopStart.id, type: 'loop' });

    return this;
  }

  useAgent(agentId: string, action: string): this {
    return this.addStep({
      type: 'agent',
      config: {
        agentId,
        action,
        protocol: 'a2a'
      }
    });
  }

  useTool(toolName: string, args?: any): this {
    return this.addStep({
      type: 'tool',
      config: {
        tool: toolName,
        arguments: args,
        protocol: 'mcp'
      }
    });
  }

  transform(transformer: (data: any) => any): this {
    return this.addStep({
      type: 'task',
      config: {
        action: 'transform',
        handler: transformer
      }
    });
  }

  filter(predicate: (item: any) => boolean): this {
    return this.addStep({
      type: 'task',
      config: {
        action: 'filter',
        handler: predicate
      }
    });
  }

  map(mapper: (item: any) => any): this {
    return this.addStep({
      type: 'task',
      config: {
        action: 'map',
        handler: mapper
      }
    });
  }

  reduce(reducer: (acc: any, item: any) => any, initial?: any): this {
    return this.addStep({
      type: 'task',
      config: {
        action: 'reduce',
        handler: reducer,
        initial
      }
    });
  }

  private createNode(step: string | StepConfig): WorkflowNode {
    const id = `node_${++this.nodeCounter}`;

    if (typeof step === 'string') {
      return { id, type: 'task', config: { name: step } };
    }

    return {
      id,
      type: (step.type || 'task') as WorkflowNode['type'],
      config: step.config || step
    };
  }

  async build(): Promise<SDKWorkflow> {
    if (!this.config.name) {
      throw new SDKError('Workflow name is required', 'VALIDATION_ERROR');
    }

    if (this.nodes.length === 0) {
      throw new SDKError('Workflow must have at least one node', 'VALIDATION_ERROR');
    }

    const workflow = new SDKWorkflowImpl(
      this.protocol,
      this.config,
      this.nodes,
      this.edges
    );

    // Emit event if SDK is available
    if (this.sdk) {
      this.sdk.emit('workflow:created', workflow);
    }

    return workflow;
  }

  fromTemplate(template: any): this {
    if (template.nodes) {
      this.nodes.push(...template.nodes);
    }
    if (template.edges) {
      this.edges.push(...template.edges);
    }
    if (template.config) {
      Object.assign(this.config, template.config);
    }
    return this;
  }
}