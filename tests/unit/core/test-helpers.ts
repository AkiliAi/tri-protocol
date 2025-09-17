// Test helpers for Core module unit tests

// Mock Logger setup
export const createMockLogger = () => {
    return {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        trace: jest.fn(),
        fatal: jest.fn(),
        child: jest.fn().mockReturnThis()
    };
};

// Setup Logger mock for all tests
export const setupLoggerMock = () => {
    const mockLogger = createMockLogger();

    // Mock the Logger module
    jest.mock('@tri-protocol/logger', () => ({
        Logger: {
            getLogger: jest.fn().mockReturnValue(mockLogger)
        },
        LoggerManager: {
            getLogger: jest.fn().mockReturnValue(mockLogger),
            getInstance: jest.fn().mockReturnValue({
                getLogger: jest.fn().mockReturnValue(mockLogger)
            })
        }
    }));

    return mockLogger;
};

// Mock A2A Protocol
export const createMockA2AProtocol = () => {
    return {
        registerAgent: jest.fn().mockResolvedValue(true),
        unregisterAgent: jest.fn().mockResolvedValue(true),
        sendMessage: jest.fn().mockResolvedValue({ id: 'msg-1', status: 'sent' }),
        findAgentsByCapability: jest.fn().mockResolvedValue([]),
        getAgent: jest.fn(),
        listAgents: jest.fn().mockResolvedValue([]),
        connect: jest.fn().mockResolvedValue(true),
        disconnect: jest.fn().mockResolvedValue(true),
        shutdown: jest.fn().mockResolvedValue(true),
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn()
    };
};

// Mock LangGraph Protocol
export const createMockLangGraphAdapter = () => {
    return {
        initialize: jest.fn().mockResolvedValue(true),
        createWorkflow: jest.fn().mockResolvedValue('workflow-1'),
        executeWorkflow: jest.fn().mockResolvedValue({
            id: 'exec-1',
            workflowId: 'workflow-1',
            status: 'completed',
            context: {},
            nodes: []
        }),
        pauseWorkflow: jest.fn().mockResolvedValue(true),
        resumeWorkflow: jest.fn().mockResolvedValue(true),
        getWorkflowStatus: jest.fn().mockResolvedValue({ status: 'completed' }),
        listWorkflows: jest.fn().mockResolvedValue([]),
        createFromTemplate: jest.fn().mockResolvedValue('workflow-from-template'),
        listTemplates: jest.fn().mockResolvedValue([]),
        shutdown: jest.fn().mockResolvedValue(true),
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn()
    };
};

// Mock MCP Adapter
export const createMockMCPAdapter = () => {
    return {
        initialize: jest.fn().mockResolvedValue(true),
        executeTool: jest.fn().mockResolvedValue({ success: true, result: 'tool result' }),
        listTools: jest.fn().mockResolvedValue([]),
        getTool: jest.fn().mockResolvedValue(null),
        registerServer: jest.fn().mockResolvedValue(true),
        unregisterServer: jest.fn().mockResolvedValue(true),
        listServers: jest.fn().mockResolvedValue([]),
        connect: jest.fn().mockResolvedValue(true),
        disconnect: jest.fn().mockResolvedValue(true),
        shutdown: jest.fn().mockResolvedValue(true),
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn()
    };
};

// Create mock TriProtocol instance
export const createMockTriProtocol = () => {
    const mockA2A = createMockA2AProtocol();
    const mockLangGraph = createMockLangGraphAdapter();
    const mockMCP = createMockMCPAdapter();

    return {
        // Protocol getters
        getA2A: jest.fn().mockReturnValue(mockA2A),
        getLangGraph: jest.fn().mockReturnValue(mockLangGraph),
        getMCP: jest.fn().mockReturnValue(mockMCP),

        // A2A methods
        registerAgent: jest.fn().mockImplementation((...args) => mockA2A.registerAgent(...args)),
        unregisterAgent: jest.fn().mockImplementation((...args) => mockA2A.unregisterAgent(...args)),
        sendMessage: jest.fn().mockImplementation((...args) => mockA2A.sendMessage(...args)),
        findAgentsByCapability: jest.fn().mockImplementation((...args) => mockA2A.findAgentsByCapability(...args)),

        // LangGraph methods
        createWorkflow: jest.fn().mockImplementation((...args) => mockLangGraph.createWorkflow(...args)),
        executeWorkflow: jest.fn().mockImplementation((...args) => mockLangGraph.executeWorkflow(...args)),
        pauseWorkflow: jest.fn().mockImplementation((...args) => mockLangGraph.pauseWorkflow(...args)),
        resumeWorkflow: jest.fn().mockImplementation((...args) => mockLangGraph.resumeWorkflow(...args)),

        // MCP methods
        executeTool: jest.fn().mockImplementation((...args) => mockMCP.executeTool(...args)),
        listTools: jest.fn().mockImplementation(() => mockMCP.listTools()),

        // Registry
        getRegistry: jest.fn().mockReturnValue(createMockTriRegistry()),

        // Event emitter methods
        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),
        removeAllListeners: jest.fn(),

        // Utility methods
        bridgeProtocols: jest.fn().mockResolvedValue(true),
        getStatus: jest.fn().mockReturnValue({
            a2a: { enabled: true, connected: true },
            langgraph: { enabled: true, connected: true },
            mcp: { enabled: true, connected: true }
        }),
        shutdown: jest.fn().mockResolvedValue(true),
        initialize: jest.fn().mockResolvedValue(true),

        // Internal references for testing
        _mockA2A: mockA2A,
        _mockLangGraph: mockLangGraph,
        _mockMCP: mockMCP
    };
};

// Create mock TriRegistry instance
export const createMockTriRegistry = () => {
    const registry = new Map();
    const protocolIndex = new Map();
    const capabilityIndex = new Map();

    return {
        register: jest.fn().mockImplementation((protocol, profile) => {
            const entry = {
                protocol,
                profile,
                registeredAt: new Date(),
                lastUpdated: new Date()
            };
            registry.set(profile.agentId, entry);

            // Update indices
            if (!protocolIndex.has(protocol)) {
                protocolIndex.set(protocol, new Set());
            }
            protocolIndex.get(protocol).add(profile.agentId);

            if (profile.capabilities) {
                profile.capabilities.forEach((cap: any) => {
                    if (!capabilityIndex.has(cap.name)) {
                        capabilityIndex.set(cap.name, new Set());
                    }
                    capabilityIndex.get(cap.name).add(profile.agentId);
                });
            }

            return entry;
        }),

        unregister: jest.fn().mockImplementation((agentId) => {
            return registry.delete(agentId);
        }),

        get: jest.fn().mockImplementation((agentId) => {
            return registry.get(agentId);
        }),

        getAll: jest.fn().mockImplementation(() => {
            return Array.from(registry.values());
        }),

        findByCapability: jest.fn().mockImplementation((capability) => {
            const agentIds = capabilityIndex.get(capability) || new Set();
            return Array.from(agentIds).map(id => registry.get(id)).filter(Boolean);
        }),

        findByProtocol: jest.fn().mockImplementation((protocol) => {
            const agentIds = protocolIndex.get(protocol) || new Set();
            return Array.from(agentIds).map(id => registry.get(id)).filter(Boolean);
        }),

        getStats: jest.fn().mockImplementation(() => {
            return {
                totalAgents: registry.size,
                byProtocol: {
                    a2a: (protocolIndex.get('a2a')?.size || 0),
                    langgraph: (protocolIndex.get('langgraph')?.size || 0),
                    mcp: (protocolIndex.get('mcp')?.size || 0)
                }
            };
        }),

        on: jest.fn(),
        off: jest.fn(),
        emit: jest.fn(),

        // For testing
        _registry: registry,
        _protocolIndex: protocolIndex,
        _capabilityIndex: capabilityIndex
    };
};