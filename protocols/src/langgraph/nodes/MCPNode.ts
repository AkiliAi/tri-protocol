import { WorkflowNode, WorkflowState } from '../types';

/**
 * MCPNode - Reusable workflow nodes for MCP tool execution
 */
export class MCPNode {
  /**
   * Create a node that executes a specific MCP tool
   */
  static createToolNode(tool: string, args?: any, options?: {
    timeout?: number;
    retryOnFailure?: boolean;
    validateOutput?: (output: any) => boolean;
    fallbackValue?: any;
    skipOnCircuitOpen?: boolean;
  }): WorkflowNode {
    return {
      id: `mcp-${tool.replace(/[^a-zA-Z0-9]/g, '-')}`,
      type: 'tool',
      name: `Execute ${tool}`,
      function: async (state: WorkflowState) => {
        // Tool arguments can come from state or be provided directly
        const toolArgs = args || state.context?.toolArgs?.[tool];
        
        return {
          context: {
            ...state.context,
            toolExecution: {
              tool,
              args: toolArgs,
              timestamp: new Date(),
              // Circuit breaker metadata
              circuitBreakerHandling: {
                skipOnOpen: options?.skipOnCircuitOpen ?? false,
                fallbackValue: options?.fallbackValue
              }
            }
          }
        };
      },
      timeout: options?.timeout,
      retryPolicy: options?.retryOnFailure ? {
        maxAttempts: 3,
        backoffStrategy: 'exponential',
        initialDelay: 1000
      } : undefined,
      metadata: { 
        tool, 
        args,
        validateOutput: options?.validateOutput,
        circuitBreakerHandling: {
          skipOnOpen: options?.skipOnCircuitOpen,
          fallbackValue: options?.fallbackValue
        }
      }
    };
  }
  
  /**
   * Create a node for reading files
   */
  static createFileReadNode(path: string, options?: {
    encoding?: string;
    parseAs?: 'json' | 'yaml' | 'text';
  }): WorkflowNode {
    return this.createToolNode('filesystem:read_file', { 
      path,
      encoding: options?.encoding || 'utf-8'
    }, {
      validateOutput: (output) => output !== null && output !== undefined
    });
  }
  
  /**
   * Create a node for writing files
   */
  static createFileWriteNode(path: string, options?: {
    content?: string;
    contentFromState?: string; // Path in state to get content from
    encoding?: string;
    createDirectories?: boolean;
  }): WorkflowNode {
    return {
      id: `mcp-write-${path.replace(/[^a-zA-Z0-9]/g, '-')}`,
      type: 'tool',
      name: `Write to ${path}`,
      function: async (state: WorkflowState) => {
        let content = options?.content;
        
        // Get content from state if specified
        if (options?.contentFromState) {
          const keys = options.contentFromState.split('.');
          let value: any = state;
          for (const key of keys) {
            value = value[key];
            if (value === undefined) break;
          }
          content = value as string;
        }
        
        return {
          context: {
            ...state.context,
            toolExecution: {
              tool: 'filesystem:write_file',
              args: {
                path,
                content,
                encoding: options?.encoding || 'utf-8',
                createDirectories: options?.createDirectories || false
              },
              timestamp: new Date()
            }
          }
        };
      },
      metadata: {
        tool: 'filesystem:write_file',
        path,
        encoding: options?.encoding || 'utf-8'
      }
    };
  }
  
  /**
   * Create a node for listing directory contents
   */
  static createListDirectoryNode(path: string, options?: {
    recursive?: boolean;
    includeHidden?: boolean;
    pattern?: string;
  }): WorkflowNode {
    return this.createToolNode('filesystem:list_directory', {
      path,
      recursive: options?.recursive || false,
      includeHidden: options?.includeHidden || false,
      pattern: options?.pattern
    });
  }
  
  /**
   * Create a node for web search
   */
  static createWebSearchNode(options?: {
    query?: string;
    queryFromState?: string;
    maxResults?: number;
    searchEngine?: string;
  }): WorkflowNode {
    return {
      id: 'mcp-web-search',
      type: 'tool',
      name: 'Web Search',
      function: async (state: WorkflowState) => {
        let query = options?.query;
        
        // Get query from state if specified
        if (options?.queryFromState) {
          const keys = options.queryFromState.split('.');
          let value: any = state;
          for (const key of keys) {
            value = value[key];
            if (value === undefined) break;
          }
          query = value as string;
        }
        
        return {
          context: {
            ...state.context,
            toolExecution: {
              tool: 'web:search',
              args: {
                query,
                maxResults: options?.maxResults || 10,
                searchEngine: options?.searchEngine || 'default'
              },
              timestamp: new Date()
            }
          }
        };
      },
      metadata: {
        tool: 'web:search',
        maxResults: options?.maxResults || 10
      }
    };
  }
  
  /**
   * Create a node for fetching web content
   */
  static createWebFetchNode(url: string, options?: {
    headers?: Record<string, string>;
    parseAs?: 'html' | 'json' | 'text';
    extractSelector?: string;
  }): WorkflowNode {
    return this.createToolNode('web:fetch', {
      url,
      headers: options?.headers,
      parseAs: options?.parseAs || 'html',
      extractSelector: options?.extractSelector
    });
  }
  
  /**
   * Create a node for database queries
   */
  static createDatabaseQueryNode(options: {
    connection: string;
    query: string;
    params?: any[];
    type?: 'select' | 'insert' | 'update' | 'delete';
  }): WorkflowNode {
    return this.createToolNode('database:query', {
      connection: options.connection,
      query: options.query,
      params: options.params,
      type: options.type || 'select'
    }, {
      timeout: 30000, // 30 second timeout for DB operations
      retryOnFailure: true
    });
  }
  
  /**
   * Create a node for sending emails
   */
  static createEmailNode(options: {
    to: string | string[];
    subject: string;
    body?: string;
    bodyFromState?: string;
    attachments?: string[];
  }): WorkflowNode {
    return {
      id: 'mcp-send-email',
      type: 'tool',
      name: 'Send Email',
      function: async (state: WorkflowState) => {
        let body = options.body;
        
        // Get body from state if specified
        if (options.bodyFromState) {
          const keys = options.bodyFromState.split('.');
          let value: any = state;
          for (const key of keys) {
            value = value[key];
            if (value === undefined) break;
          }
          body = value;
        }
        
        return {
          context: {
            ...state.context,
            toolExecution: {
              tool: 'email:send',
              args: {
                to: options.to,
                subject: options.subject,
                body,
                attachments: options.attachments
              },
              timestamp: new Date()
            }
          }
        };
      },
      metadata: {
        tool: 'email:send',
        to: options.to,
        subject: options.subject
      }
    };
  }
  
  /**
   * Create a node for API calls
   */
  static createAPICallNode(options: {
    endpoint: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Record<string, string>;
    body?: any;
    bodyFromState?: string;
    auth?: {
      type: 'bearer' | 'basic' | 'api-key';
      credentials: any;
    };
  }): WorkflowNode {
    return {
      id: `mcp-api-${options.method || 'GET'}-${options.endpoint.replace(/[^a-zA-Z0-9]/g, '-')}`,
      type: 'tool',
      name: `API Call: ${options.method || 'GET'} ${options.endpoint}`,
      function: async (state: WorkflowState) => {
        let body = options.body;
        
        // Get body from state if specified
        if (options.bodyFromState) {
          const keys = options.bodyFromState.split('.');
          let value: any = state;
          for (const key of keys) {
            value = value[key];
            if (value === undefined) break;
          }
          body = value;
        }
        
        return {
          context: {
            ...state.context,
            toolExecution: {
              tool: 'api:call',
              args: {
                endpoint: options.endpoint,
                method: options.method || 'GET',
                headers: options.headers,
                body,
                auth: options.auth
              },
              timestamp: new Date()
            }
          }
        };
      },
      metadata: {
        tool: 'api:call',
        endpoint: options.endpoint,
        method: options.method || 'GET'
      }
    };
  }
  
  /**
   * Create a node for data transformation
   */
  static createTransformNode(options: {
    transformer: string; // Name of the transformer
    inputPath?: string; // Path in state to get input from
    outputPath?: string; // Path in state to store output
    config?: any; // Transformer-specific configuration
  }): WorkflowNode {
    return {
      id: `mcp-transform-${options.transformer}`,
      type: 'tool',
      name: `Transform: ${options.transformer}`,
      function: async (state: WorkflowState) => {
        let input = state;
        
        // Get input from specific path if specified
        if (options.inputPath) {
          const keys = options.inputPath.split('.');
          let current: any = input;
          for (const key of keys) {
            current = current[key];
            if (current === undefined) break;
          }
          input = current;
        }
        
        return {
          context: {
            ...state.context,
            toolExecution: {
              tool: `transform:${options.transformer}`,
              args: {
                input,
                config: options.config
              },
              outputPath: options.outputPath,
              timestamp: new Date()
            }
          }
        };
      },
      metadata: {
        tool: `transform:${options.transformer}`,
        transformer: options.transformer,
        config: options.config
      }
    };
  }
  
  /**
   * Create a node for cache operations
   */
  static createCacheNode(options: {
    operation: 'get' | 'set' | 'delete' | 'clear';
    key?: string;
    value?: any;
    valueFromState?: string;
    ttl?: number; // Time to live in seconds
  }): WorkflowNode {
    return {
      id: `mcp-cache-${options.operation}`,
      type: 'tool',
      name: `Cache ${options.operation}`,
      function: async (state: WorkflowState) => {
        let value = options.value;
        
        // Get value from state if specified
        if (options.valueFromState && options.operation === 'set') {
          const keys = options.valueFromState.split('.');
          let stateValue: any = state;
          for (const key of keys) {
            stateValue = stateValue[key];
            if (stateValue === undefined) break;
          }
          value = stateValue;
        }
        
        return {
          context: {
            ...state.context,
            toolExecution: {
              tool: `cache:${options.operation}`,
              args: {
                key: options.key,
                value,
                ttl: options.ttl
              },
              timestamp: new Date()
            }
          }
        };
      },
      metadata: {
        tool: `cache:${options.operation}`,
        operation: options.operation,
        key: options.key
      }
    };
  }
  
  /**
   * Create a node for executing shell commands
   */
  static createShellCommandNode(options: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }): WorkflowNode {
    return this.createToolNode('shell:execute', {
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      env: options.env
    }, {
      timeout: options.timeout || 60000, // 1 minute default timeout
      retryOnFailure: false // Don't retry shell commands by default
    });
  }
  
  /**
   * Create a node for scheduling tasks
   */
  static createScheduleNode(options: {
    taskId: string;
    schedule: string; // Cron expression or interval
    action: any;
    enabled?: boolean;
  }): WorkflowNode {
    return this.createToolNode('scheduler:create', {
      taskId: options.taskId,
      schedule: options.schedule,
      action: options.action,
      enabled: options.enabled !== false
    });
  }
  
  /**
   * Create a node that chains multiple tools
   */
  static createToolChainNode(tools: Array<{
    tool: string;
    args: any;
    outputMapping?: string; // Where to store output in state
  }>): WorkflowNode {
    return {
      id: 'mcp-tool-chain',
      type: 'tool',
      name: 'Execute Tool Chain',
      function: async (state: WorkflowState) => {
        const chainResults: any[] = [];
        
        return {
          context: {
            ...state.context,
            toolChain: {
              tools,
              results: chainResults,
              timestamp: new Date()
            }
          }
        };
      },
      metadata: {
        toolChain: true,
        tools
      }
    };
  }
  
  /**
   * Create a node for parallel tool execution
   */
  static createParallelToolsNode(tools: Array<{
    tool: string;
    args: any;
    id?: string;
  }>): WorkflowNode {
    return {
      id: 'mcp-parallel-tools',
      type: 'tool',
      name: 'Execute Tools in Parallel',
      function: async (state: WorkflowState) => {
        return {
          context: {
            ...state.context,
            parallelTools: {
              tools,
              timestamp: new Date()
            }
          }
        };
      },
      metadata: {
        parallel: true,
        tools
      }
    };
  }
}