//tri-protocol/protocols/src/a2a/types.ts
/**
 * A2A Protocol Types & Interfaces
 * Agent-to-Agent Communication Protocol Core Types
 * Fist Core (Alpha) Protocol of the Tri Protocol
 */


// ================================
// Agent Provider
// ================================

export interface AgentProvider {
    organization: string;
    url: string;
}

// ================================
// Agent Capabilities & Discovery
// ================================

export interface AgentSystemFeatures{
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
    extensions?: AgentExtension[];
}

export interface AgentExtension {
    name: string;
    url?: string;
    version: string;
    description?: string;
    required?: boolean;
    params?: { [key: string]: any };
}

export interface AgentCapability {
    id: string;
    name: string;
    description: string;
    category: CapabilityCategory;
    inputs: ParameterSchema[];
    outputs: ParameterSchema[];
    cost: number; // Computational cost (1-100)
    reliability: number; // Reliability score (0-1)
    version: string;
    tags?: string[];
}

export enum CapabilityCategory {
    ANALYSIS = 'analysis',
    ACTION = 'action',
    MONITORING = 'monitoring',
    CREATIVE = 'creative',
    COORDINATION = 'coordination',
    SECURITY = 'security',
    COMMUNICATION = 'communication'
}

export interface ParameterSchema {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required: boolean;
    description: string;
    validation?: {
        min?: number;
        max?: number;
        pattern?: string;
        enum?: any[];
    };
}

// ================================
// Security Schemes
// ================================

export type SecurityScheme =
    | APIKeySecurityScheme
    | HTTPAuthSecurityScheme
    | OAuth2SecurityScheme
    | OpenIdConnectSecurityScheme
    | MutualTLSSecurityScheme;

export interface SecuritySchemeBase {
    //operation description for the security scheme
    description?: string;
}
export interface SecurityCredentials{
    // Credentials for API Key authentication
    apiKey?: string;

    // Credentials for HTTP authentication
    token?: string;
    username?: string;
    password?: string;

    // Credentials for OAuth2
    accessToken?: string;
    refreshToken?: string;
    clientId?: string;
    clientSecret?: string;

    // Credentials for OpenID Connect
    idToken?: string;

    // Credentials for Mutual TLS
    clientCertificate?: string;
    clientKey?: string;

    // General fields
    expiresAt?: Date;
    scope?: string[];
    metadata?: { [key: string]: any };

}


export interface APIKeySecurityScheme extends SecuritySchemeBase {
    readonly  type: 'apiKey';
    readonly in: 'query' | 'header' | 'cookie';
    name: string;
}

export interface HTTPAuthSecurityScheme extends SecuritySchemeBase {
    readonly type: 'http';
    scheme: string;
    bearerFormat?: string;
}

export interface OAuth2SecurityScheme extends SecuritySchemeBase {
    readonly type: 'oauth2';
    flows: OAuthFlows;
    oauth2MetadataUrl?: string; // URL to fetch OAuth2 metadata
}
export interface OpenIdConnectSecurityScheme extends SecuritySchemeBase {
    readonly type: 'openIdConnect';
    openIdConnectUrl: string; // URL to OpenID Connect metadata
}

export interface MutualTLSSecurityScheme extends SecuritySchemeBase {
    readonly type: 'mutualTLS';
    description?: string; // Description of the mutual TLS security scheme
}

export interface OAuthFlows{
    authorizationCode?: AutorizationCodeAuthFlow;
    ClientCredentials?: ClientCredentialsAuthFlow;
    implicit?: ImplicitAuthFlow;
    password?: PasswordAuthFlow;
}

export interface AutorizationCodeAuthFlow {
    authorizationUrl: string;
    tokenUrl: string;
    refreshUrl?: string;
    scopes: { [scope: string]: string };
}

export interface ClientCredentialsAuthFlow {
    tokenUrl: string;
    refreshUrl?: string;
    scopes: { [scope: string]: string };
}

export interface ImplicitAuthFlow {
    authorizationUrl: string;
    refreshUrl?: string;
    scopes: { [scope: string]: string };
}

export interface PasswordAuthFlow {
    tokenUrl: string;
    refreshUrl?: string;
    scopes: { [scope: string]: string };
}


// ================================
// Agent Skills
// ================================

export interface AgentSkill {
    id: string;
    name: string;
    description?: string;
    tags?: string[];
    examples?: string[];
    inputModes?: string[];
    outputModes?: string[];
    security?: {[scheme:string]:string[]}[];
}

// ================================
// Transport Protocols
// ================================
export enum TransportProtocol {
    JSONRPC = "JSONRPC",
    GRPC = "GRPC",
    HTTP_JSON = "HTTP+JSON",
}

export interface AgentInterface {
    url: string;
    transport: TransportProtocol | string; // Allow custom protocols
}


// ================================
// Agent Card
// ================================

export interface AgentCardSignature {
    protected: String;
    signature: String;
    header?: { [key: string]: any }; // Optional header for additional metadata
}

export interface AgentCard {
    protocolVersion: string; // Version of the protocol used
    name: string; // Name of the agent
    description?: string; // Optional description of the agent
    url: string; // URL of the agent's endpoint
    preferredTransport: TransportProtocol | string; // Preferred transport protocol
    additionalInterfaces?: AgentInterface[]; // Additional interfaces for the agent
    iconUrl?: string; // URL to the agent's icon
    provider?: AgentProvider; // Information about the agent provider
    version?: string; // Version of the agent
    documentationUrl?: string; // URL to the agent's documentation
    // capabilities?: AgentCapability; // Capabilities of the agent
    systemFeatures?: AgentSystemFeatures[]; // System features supported by the agent
    securitySchemes?: SecurityScheme[]; // Security schemes supported by the agent
    defaultInputMode?: string; // Default input mode for the agent
    defaultOutputMode?: string; // Default output mode for the agent
    skills: AgentSkill[]; // Skills supported by the agent
    capabilities: AgentCapability[]; // Optinoal  Capabilities of the agent
    supportsAuthenticatedExtendedCard?: boolean; // Whether the agent supports authenticated extended cards
    signature?: AgentCardSignature[]; // Signature for the agent card
}

export interface AgentProfile {
    agentId: string;
    agentType: string;
    status: AgentStatus;
    capabilities: AgentCapability[];
    systemeFeatures: AgentSystemFeatures[];
    metadata: AgentMetadata;
    lastSeen: Date;
    networkAddress?: string;
}


export enum AgentStatus {
    ONLINE = 'online',
    OFFLINE = 'offline',
    BUSY = 'busy',
    MAINTENANCE = 'maintenance',
    ERROR = 'error'
}

export interface AgentMetadata {
    version: string;
    location: string; // URL or identifier
    load: number; // Current load 0-100
    uptime: number; // Uptime in milliseconds
    capabilities_count: number;
    performance_metrics?: {
        avg_response_time: number;
        success_rate: number;
        total_requests: number;
    };
}

// ================================
// Task & Workflow Types
// ================================
export interface Task {
    id: string;
    contextId: string;
    status: TaskStatus;
    history?: Message[];
    artifacts?: Artifact[];
    metadata?: { [key: string]: any };
    readonly kind: "task";
    createdAt: Date;
}
export interface TaskDefinition {
    id: string;
    name: string;
    description: string;
    requiredCapability: string;
    parameters: Record<string, any>;
    priority: A2APriority;
    timeout?: number;
    retries?: number;
    dependencies?: string[]; // Other task IDs
}

export interface TaskResult {
    taskId: string;
    success: boolean;
    result?: any;
    error?: string;
    executedBy: string;
    executionTime: number;
    timestamp: Date;
}


export interface TaskStatus{
    state: TaskState;
    message?:Message;
    timestamp?: string;
}

export interface TaskState{
    Submitted: "submitted";
    InProgress: "in-progress";
    Working: "working";
    InputRequired: "input-required";
    Completed: "completed";
    Failed: "failed";
    Cancelled: "cancelled";
    Rejected: "rejected";
    AuthRequired: "auth-required";
    Unknown: "unknown";
}

export interface TaskStatusUpdateEvent {
    taskId: string;
    contextId: string;
    readonly kind: "status-update";
    status: TaskStatus;
    final?: boolean;
    metadata?: { [key: string]: any };
}

export interface TaskArtifactUpdateEvent {
    taskId: string;
    contextId: string;
    readonly kind: "artifact-update";
    artifact: Artifact;
    append?: boolean; //
    lastChunks?: boolean
    metadata?: { [key: string]: any };
}

export interface TaskIdParameters {
    id: string;
    metadata?: { [key: string]: any };
}

export interface InMemoryTaskStore {
    tasks: Map<string, Task>;
    TasksByContextId: Map<string, Task[]>;
    artifacts: Map<string, Artifact[]>;
    pushConfigs: Map<string, TaskPushNotificationConfig>;
    metrics: Map<string, {
        createdAt: Date;
        lastUpdated: Date;
        executionTime?: number;
        attempts: number;
    }>
    // Méthodes de gestion
    addTask(task: Task): void;
    getTask(taskId: string): Task | undefined;
    updateTaskStatus(taskId: string, status: TaskStatus): boolean;
    removeTask(taskId: string): boolean;
    getTasksByContext(contextId: string): Task[];
    getTasksByStatus(status: TaskState): Task[];
    addArtifact(taskId: string, artifact: Artifact): boolean;
    getArtifacts(taskId: string): Artifact[];
    cleanup(olderThan: Date): number; // Retourne le nombre de tâches supprimées


}
export interface Artifact {
    artifactId: string;
    name?: string;
    description?: string;
    parts: Part[];
    metadata?: { [key: string]: any };
    extensions?: string[];
    createdAt?: Date;

}

export interface TaskQueryParameters extends TaskIdParameters {
    historyLengts?: number;
}

export interface GetTaskPushNotificationConfigParameters  extends TaskIdParameters {
    pushNotificationConfigId?: string;
}

export interface ListTaskPushNotificationConfigParameters  extends TaskIdParameters {}

export interface DeleteTaskPushNotificationConfigParams extends TaskIdParameters {
    pushNotificationConfigId: string;
}

export interface WorkflowDefinition {
    id: string;
    name: string;
    description: string;
    steps: WorkflowStep[];
    timeout?: number;
    onError?: 'abort' | 'continue' | 'retry';
}

export interface WorkflowStep {
    id: string;
    name: string;
    capability: string;
    parameters: Record<string, any>;
    condition?: string; // Conditional execution
    parallel?: boolean; // Execute in parallel with next step
    onSuccess?: WorkflowAction[];
    onError?: WorkflowAction[];
}

export interface WorkflowAction {
    type: 'goto' | 'abort' | 'retry' | 'notify';
    target?: string; // Step ID or agent ID
    parameters?: Record<string, any>;
}

export interface WorkflowExecution {
    workflowId: string;
    executionId: string;
    status: WorkflowStatus;
    currentStep?: string;
    startTime: Date;
    endTime?: Date;
    results: Map<string, TaskResult>;
    error?: string;
}


export enum WorkflowStatus {
    PENDING = 'pending',
    RUNNING = 'running',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CANCELLED = 'cancelled'
}

// ================================
// Core A2A Message Protocol
// ================================

//  Sois Message  ou A2AMessage
export interface Message {
    readonly role: "user" | "agent";
    parts: Part[];
    metadata?: {
        [key: string]: any;
    };
    extensions?: string[];
    referenceTaskIds?: string[];
    messageId: string;
    taskId?: string;
    contextId?: string;
    readonly kind: "message";
}

export interface A2AMessage {
    id: string;
    readonly role:  "agent" | "user" ;
    from: string; // Source agent ID
    to: string; // Target agent ID or 'broadcast'
    type: A2AMessageType;
    taskId?: string; // Associated task ID
    referenceTaskIds?: string;
    contextId?: string;
    payload: any;
    timestamp: Date;
    priority: A2APriority;
    correlationId?: string; // For workflow tracing
    ttl?: number; // Time to live in milliseconds
    metadata?: Record<string, any>;
}

export enum A2AMessageType {
    // Discovery & Registration
    AGENT_ANNOUNCE = 'agent_announce',
    AGENT_QUERY = 'agent_query',
    CAPABILITY_REQUEST = 'capability_request',
    CAPABILITY_RESPONSE = 'capability_response',

    // Task Coordination
    TASK_REQUEST = 'task_request',
    TASK_RESPONSE = 'task_response',
    TASK_DELEGATE = 'task_delegate',
    TASK_STATUS = 'task_status',
    TASK_CANCEL = 'task_cancel',

    // Workflow Management
    WORKFLOW_START = 'workflow_start',
    WORKFLOW_STEP = 'workflow_step',
    WORKFLOW_COMPLETE = 'workflow_complete',
    WORKFLOW_ERROR = 'workflow_error',

    // Health & Monitoring
    HEALTH_CHECK = 'health_check',
    HEALTH_RESPONSE = 'health_response',
    STATUS_UPDATE = 'status_update',
    ERROR_REPORT = 'error_report',

    // System Events
    AGENT_ONLINE = 'agent_online',
    AGENT_OFFLINE = 'agent_offline',
    NETWORK_BROADCAST = 'network_broadcast'
}

export type A2APriority = 'low' | 'normal' | 'high' | 'urgent';

export interface A2AResponse {
    success: boolean;
    data?: any;
    error?: string;
    metadata?: {
        processingTime?: number;
        agentId?: string;
        capability?: string;
        timestamp?: Date;
    };
}

export interface MessageSendConfiguration {
    acceptedOutputModes?: string[];
    historyLength?: number;
    pushNotificationConfig?: PushNotificationConfig;
    blocking?: boolean;
}

export interface MessageSendParameters {
    message: Message;
    configuration?: MessageSendConfiguration;
    metadata?: {
        [key: string]: any;
    };
}

export interface PartBase {
    metadata?: { [key: string]: any };
}

export interface TextPart extends PartBase {
    readonly kind: "text";
    text: string;
}
export interface FileBase {
    name?: string;
    mimiType?: string;
}

export interface FileWithBytes extends FileBase {
    bytes: string;
    uri?: never;
}

export interface FileWithUri extends FileBase{
    uri: string;
    bytes?: never
}

export interface FilePart extends PartBase {
    readonly kind: "file";
    file: FileWithBytes | FileWithUri;
}
export interface DataPart extends PartBase {
    readonly kind: "data";
    data: {[key: string]: any; };
}

export type Part = TextPart | FilePart | DataPart;

export interface PushNotificationAuthenticationInfo {
    schemes: string[];
    credentials?: string;
}
export interface PushNotificationConfig {
    id?: string;
    url: string;
    token?: string;
    authentication?: PushNotificationAuthenticationInfo;
}

export interface TaskPushNotificationConfig {
    taskId: string;
    pushNotificationConfig: PushNotificationConfig;
}

export interface JSONRPCMessage {
    readonly jsonrpc: "2.0";

    id?: number | string | null;
    method?: string; // Only present in requests
    params?: unknown; // Only present in requests
    result?: unknown; // Only present in success responses
    error?: JSONRPCError | A2AError; // Only present in error responses


}
export interface JSONRPCRequest extends JSONRPCMessage {
    method: string;
    parameters?: any[] | Record<string, any>;
}

export interface JSONRPCError {
    code: number;
    message: string;
    data?: any;
}

export interface JSONRPCSuccessResponse extends JSONRPCMessage {
    id: number | string | null;
    result?: any;
    error?: never;
}

export interface JSONRPCErrorResponse extends JSONRPCMessage {
    id: number | string | null;
    result?: never;
    error: JSONRPCError |A2AError;
}
export type JSONRPCResponse =
    | SendMessageResponse
    | SendStreamingMessageResponse
    | GetTaskResponse
    | CancelTaskResponse
    | SetTaskPushNotificationConfigResponse
    | GetTaskPushNotificationConfigResponse
    | ListTaskPushNotificationConfigResponse
    | DeleteTaskPushNotificationConfigResponse
    | GetAuthenticatedExtendedCardResponse;

export interface SendMessageRequest extends JSONRPCRequest {
    id: number | string;
    readonly method: "message/send";
    parameters: MessageSendParameters;
}
export interface SendMessageSuccessResponse extends JSONRPCSuccessResponse {
    result: Message | Task;
}

export interface SendMessageSuccessResponse extends JSONRPCSuccessResponse {
    result: Message | Task;
}

export type SendMessageResponse =
    | SendMessageSuccessResponse
    | JSONRPCErrorResponse;

export interface SendStreamingMessageRequest extends JSONRPCRequest {
    id: number | string;
    readonly method: "message/stream";
    parameters: MessageSendParameters;
}

export interface SendStreamingMessageSuccessResponse
    extends JSONRPCSuccessResponse {
    result: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;
}
export interface SendStreamingMessageSuccessResponse
    extends JSONRPCSuccessResponse {
    result: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;
}

export type SendStreamingMessageResponse =
    | SendStreamingMessageSuccessResponse
    | JSONRPCErrorResponse;


export interface SendStreamingMessageRequest extends JSONRPCRequest {
    id: number | string;
    readonly method: "message/stream";
    parameters: MessageSendParameters;
}

export interface SendStreamingMessageSuccessResponse
    extends JSONRPCSuccessResponse {
    result: Message | Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent;
}

export interface GetTaskRequest extends JSONRPCRequest {
    id: number | string;
    readonly method: "tasks/get";
    parameters: TaskQueryParameters;
}
export interface GetTaskRequest extends JSONRPCRequest {
    id: number | string;
    readonly method: "tasks/get";
    parameters: TaskQueryParameters;
}

export interface GetTaskSuccessResponse extends JSONRPCSuccessResponse {
    result: Task;
}

export type GetTaskResponse = GetTaskSuccessResponse | JSONRPCErrorResponse;

export interface CancelTaskRequest extends JSONRPCRequest {
    id: number | string;
    readonly method: "tasks/cancel";
    params: TaskIdParameters;
}

export interface CancelTaskSuccessResponse extends JSONRPCSuccessResponse {
    result: Task;
}

export type CancelTaskResponse =
    | CancelTaskSuccessResponse
    | JSONRPCErrorResponse;

export interface SetTaskPushNotificationConfigRequest extends JSONRPCRequest {
    id: number | string;
    readonly method: "tasks/pushNotificationConfig/set";
    params: TaskPushNotificationConfig;
}

export interface SetTaskPushNotificationConfigSuccessResponse
    extends JSONRPCSuccessResponse {
    result: TaskPushNotificationConfig;
}

export type SetTaskPushNotificationConfigResponse =
    | SetTaskPushNotificationConfigSuccessResponse
    | JSONRPCErrorResponse;

export interface GetTaskPushNotificationConfigRequest extends JSONRPCRequest {
    id: number | string;
    readonly method: "tasks/pushNotificationConfig/get";
    params: GetTaskPushNotificationConfigParameters | TaskIdParameters;
}

export interface GetTaskPushNotificationConfigSuccessResponse
    extends JSONRPCSuccessResponse {
    result: TaskPushNotificationConfig;
}

export type GetTaskPushNotificationConfigResponse =
    | GetTaskPushNotificationConfigSuccessResponse
    | JSONRPCErrorResponse;

export interface TaskResubscriptionRequest extends JSONRPCRequest {
    id: number | string;
    readonly method: "tasks/resubscribe";
    params: TaskIdParameters;
}

export interface ListTaskPushNotificationConfigRequest extends JSONRPCRequest {
    id: number | string;
    readonly method: "tasks/pushNotificationConfig/list";
    params: ListTaskPushNotificationConfigParameters;
}

export interface ListTaskPushNotificationConfigSuccessResponse
    extends JSONRPCSuccessResponse {
    result: TaskPushNotificationConfig[];
}

export type ListTaskPushNotificationConfigResponse =
    | ListTaskPushNotificationConfigSuccessResponse
    | JSONRPCErrorResponse;

export interface DeleteTaskPushNotificationConfigRequest
    extends JSONRPCRequest {
    id: number | string;
    readonly method: "tasks/pushNotificationConfig/delete";
    params: DeleteTaskPushNotificationConfigParams;
}

export interface DeleteTaskPushNotificationConfigSuccessResponse
    extends JSONRPCSuccessResponse {
    result: null;
}

export type DeleteTaskPushNotificationConfigResponse =
    | DeleteTaskPushNotificationConfigSuccessResponse
    | JSONRPCErrorResponse;

export interface GetAuthenticatedExtendedCardRequest extends JSONRPCRequest {
    id: number | string;
    readonly method: "agent/getAuthenticatedExtendedCard";
    params?: never;
}
export interface GetAuthenticatedExtendedCardSuccessResponse
    extends JSONRPCSuccessResponse {
    result: AgentCard;
}

export type GetAuthenticatedExtendedCardResponse =
    | GetAuthenticatedExtendedCardSuccessResponse
    | JSONRPCErrorResponse;


export type A2ARequest =
    | SendMessageRequest
    | SendStreamingMessageRequest
    | GetTaskRequest
    | CancelTaskRequest
    | SetTaskPushNotificationConfigRequest
    | GetTaskPushNotificationConfigRequest
    | TaskResubscriptionRequest
    | ListTaskPushNotificationConfigRequest
    | DeleteTaskPushNotificationConfigRequest
    | GetAuthenticatedExtendedCardRequest;

export interface JSONParseError extends JSONRPCError {
    readonly code: -1000; //-32700
    message: string;
}

export interface InvalidRequestError extends JSONRPCError {
    readonly code: -1001; //-32600
    message: string;
}
export interface MethodNotFoundError extends JSONRPCError {
    readonly code: -1002; //-32601
    message: string;
}
export interface InvalidParamsError extends JSONRPCError {

    readonly code: -1003; //32602
    message: string;
}
// --8<-- [end:InvalidParamsError]

// --8<-- [start:InternalError]
/**
 * An error indicating an internal error on the server.
 */
export interface InternalError extends JSONRPCError {
    /** The error code for an internal server error. */
    readonly code: -1004; //32603
    /**
     * The error message.
     * @default "Internal error"
     */
    message: string;
}
// --8<-- [end:InternalError]

// --8<-- [start:TaskNotFoundError]
/**
 * An A2A-specific error indicating that the requested task ID was not found.
 */
export interface TaskNotFoundError extends JSONRPCError {
    readonly code: -1005; //-32001
    message: string;
}
export interface TaskNotCancelableError extends JSONRPCError {
    readonly code: -1006;      //-32002
    message: string;
}

export interface PushNotificationNotSupportedError extends JSONRPCError {
    readonly code: -1007; //-32003
    message: string;
}
export interface UnsupportedOperationError extends JSONRPCError {
    readonly code: -1008; //-32004
    message: string;
}
export interface ContentTypeNotSupportedError extends JSONRPCError {

    readonly code: -1009; //-32005
    message: string;
}

export interface InvalidAgentResponseError extends JSONRPCError {
    readonly code: -1010;  //-32006
    message: string;
}

export interface AuthenticatedExtendedCardNotConfiguredError extends JSONRPCError {
    readonly code: -1011; //-32007
    message: string;
}

// ================================
// A2A Error Types  choix N#1
// ================================
// export type A2AError =
//     | JSONParseError
//     | InvalidRequestError
//     | MethodNotFoundError
//     | InvalidParamsError
//     | InternalError
//     | TaskNotFoundError
//     | TaskNotCancelableError
//     | PushNotificationNotSupportedError
//     | UnsupportedOperationError
//     | ContentTypeNotSupportedError
//     | InvalidAgentResponseError
//     | AuthenticatedExtendedCardNotConfiguredError;


// ================================
// Capability Query & Discovery
// ================================

export interface CapabilityQuery {
    query: string; // Natural language or capability name
    requester: string; // Agent ID making the request
    filters?: {
        category?: CapabilityCategory;
        tags?: string[];
        minReliability?: number;
        maxCost?: number;
        availability?: boolean;
    };
    limit?: number;
}

export interface CapabilityMatch {
    agent: AgentProfile;
    capability: AgentCapability;
    score: number; // Match confidence (0-1)
    reason: string; // Why this capability matches
}

// ================================
// Network & Health Monitoring
// ================================

export interface NetworkTopology {
    agents: Map<string, AgentProfile>;
    connections: Map<string, string[]>; // Agent ID -> Connected agent IDs
    messageRoutes: Map<string, Route[]>; // Capability -> Available routes
    lastUpdated: Date;
}

export interface Route {
    agentId: string;
    capability: string;
    cost: number;
    reliability: number;
    responseTime: number;
    load: number;
}

export interface HealthMetrics {
    agentId: string;
    timestamp: Date;
    cpu_usage: number;
    memory_usage: number;
    response_time: number;
    success_rate: number;
    active_tasks: number;
    queue_length: number;
    last_error?: string;
}

// ================================
// A2A Protocol Events
// ================================

export interface A2AEventPayload {
    type: string;
    data: any;
    timestamp: Date;
    source: string;
}

export interface A2AProtocolEvents {
    'agent.registered': (agent: AgentProfile) => void;
    'agent.unregistered': (agentId: string) => void;
    'agent.status.changed': (agentId: string, status: AgentStatus) => void;
    'message.sent': (message: A2AMessage) => void;
    'message.received': (message: A2AMessage) => void;
    'message.failed': (message: A2AMessage, error: string) => void;
    'workflow.started': (execution: WorkflowExecution) => void;
    'workflow.completed': (execution: WorkflowExecution) => void;
    'workflow.failed': (execution: WorkflowExecution, error: string) => void;
    'network.topology.changed': (topology: NetworkTopology) => void;
    'capability.discovered': (matches: CapabilityMatch[]) => void;

}

// ================================
// A2A Configuration
// ================================

export interface A2AConfig {
    networkName: string;
    broadcastInterval: number; // Health broadcast interval in ms
    messageTimeout: number; // Default message timeout in ms
    maxRetries: number;
    enableHealthMonitoring: boolean;
    enableWorkflowEngine: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    performance: {
        maxConcurrentTasks: number;
        queueSize: number;
        routingAlgorithm: 'round-robin' | 'least-loaded' | 'best-match';
    };
}

// ================================
// Error Types ou A2AError Choix N#2
// ================================

// Custom error types for A2A protocol

export class A2AError extends Error {

    constructor(
        message: string,
        // public code: string,
        public code: any,
        public agentId?: string,
        public messageId?: string
    ) {
        super(message);
        this.name = 'A2AError';
    }
}

export class AgentNotFoundError extends A2AError {
    constructor(agentId: string) {
        super(`Agent not found: ${agentId}`, 'AGENT_NOT_FOUND', agentId);
    }
}

export class CapabilityNotFoundError extends A2AError {
    constructor(capability: string) {
        super(`Capability not found: ${capability}`, 'CAPABILITY_NOT_FOUND');
    }
}

export class WorkflowExecutionError extends A2AError {
    constructor(workflowId: string, error: string) {
        super(`Workflow execution failed: ${error}`, 'WORKFLOW_FAILED');
    }
}

export class TaskExecutionError extends A2AError {
    constructor(taskId: string, error: string) {
        super(`Task execution failed: ${error}`, 'TASK_EXECUTION_FAILED', undefined, taskId);
    }
}

// ================================
// A2A Error Types  choix N#1
// ================================
// export type A2AError =
//     | JSONParseError
//     | InvalidRequestError
//     | MethodNotFoundError
//     | InvalidParamsError
//     | InternalError
//     | TaskNotFoundError
//     | TaskNotCancelableError
//     | PushNotificationNotSupportedError
//     | UnsupportedOperationError
//     | ContentTypeNotSupportedError
//     | InvalidAgentResponseError
//     | AuthenticatedExtendedCardNotConfiguredError;


export class JSONParseError extends A2AError {
    constructor(message: string) {
        super(message, "JSON_PARSE_ERROR");
        this.name = 'JSONParseError';
    }
}
export class InvalidRequestError extends A2AError {
    constructor(message: string) {
        super(message, "INVALID_REQUEST");
        this.name = 'InvalidRequestError';
    }
}
export class MethodNotFoundError extends A2AError {
    constructor(message: string) {
        super(message, "METHOD_NOT_FOUND");
        this.name = 'MethodNotFoundError';
    }
}
export class InvalidParamsError extends A2AError {
    constructor(message: string) {
        super(message, "INVALID_PARAMS");
        this.name = 'InvalidParamsError';
    }
}
export class InternalError extends A2AError {
    constructor(message: string) {
        super(message, "INTERNAL_ERROR");
        this.name = 'InternalError';
    }
}
export class TaskNotFoundError extends A2AError {
    constructor(taskId: string) {
        super(`Task not found: ${taskId}`, "TASK_NOT_FOUND", undefined, taskId);
        this.name = 'TaskNotFoundError';
    }
}

export class TaskNotCancelableError extends A2AError {
    constructor(taskId: string) {
        super(`Task not cancelable: ${taskId}`, "TASK_NOT_CANCELABLE", undefined, taskId);
        this.name = 'TaskNotCancelableError';
    }
}

export class PushNotificationNotSupportedError extends A2AError {
    constructor() {
        super("Push notifications not supported", "PUSH_NOTIFICATION_NOT_SUPPORTED");
        this.name = 'PushNotificationNotSupportedError';
    }
}

export class UnsupportedOperationError extends A2AError {
    constructor(message: string) {
        super(message, "UNSUPPORTED_OPERATION");
        this.name = 'UnsupportedOperationError';
    }
}

export class ContentTypeNotSupportedError extends A2AError {
    constructor(contentType: string) {
        super(`Content type not supported: ${contentType}`, "CONTENT_TYPE_NOT_SUPPORTED");
        this.name = 'ContentTypeNotSupportedError';
    }
}

export class InvalidAgentResponseError extends A2AError {
    constructor(message: string) {
        super(message, "INVALID_AGENT_RESPONSE");
        this.name = 'InvalidAgentResponseError';
    }
}

export class AuthenticatedExtendedCardNotConfiguredError extends A2AError {
    constructor() {
        super("Authenticated extended card not configured", "AUTHENTICATED_EXTENDED_CARD_NOT_CONFIGURED");
        this.name = 'AuthenticatedExtendedCardNotConfiguredError';
    }
}




