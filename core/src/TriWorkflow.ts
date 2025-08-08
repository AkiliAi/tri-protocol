// // packages/core/src/TriWorkflow.ts
// export abstract class TriWorkflow {
//     protected id: string;
//     protected name: string;
//     protected graph: WorkflowGraph;
//     protected state: WorkflowState;
//
//     constructor(config: TriWorkflowConfig) {
//         this.id = config.id || generateId();
//         this.name = config.name;
//         this.graph = this.buildGraph(config);
//         this.state = this.initializeState(config);
//     }
//
//     // Define workflow structure
//     protected abstract buildGraph(config: TriWorkflowConfig): WorkflowGraph;
//
//     // Define initial state
//     protected abstract initializeState(config: TriWorkflowConfig): WorkflowState;
//
//     // Node definitions
//     protected defineNode(
//         name: string,
//         handler: NodeHandler,
//         options?: NodeOptions
//     ): WorkflowNode {
//         return {
//             name,
//             handler,
//             type: options?.type || 'task',
//             retryPolicy: options?.retry,
//             timeout: options?.timeout
//         };
//     }
//
//     // Edge definitions
//     protected defineEdge(
//         from: string,
//         to: string,
//         condition?: EdgeCondition
//     ): WorkflowEdge {
//         return { from, to, condition };
//     }
//
//     // Execution hooks
//     async beforeExecute(): Promise<void> {}
//     async afterExecute(result: WorkflowResult): Promise<void> {}
//     async onError(error: Error): Promise<void> {}
// }