/**
 * Setup mocks for MCP SDK testing
 */

// Mock @modelcontextprotocol/sdk client
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    listTools: jest.fn().mockResolvedValue({
      tools: [
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object' }
        },
        {
          name: 'write_file',
          description: 'Write a file',
          inputSchema: { type: 'object' }
        }
      ]
    }),
    callTool: jest.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, result: 'mock result' })
        }
      ]
    }),
    listResources: jest.fn().mockResolvedValue({
      resources: [
        {
          uri: 'mock://config/settings.json',
          name: 'Settings',
          mimeType: 'application/json'
        }
      ]
    }),
    readResource: jest.fn().mockResolvedValue({
      contents: [
        {
          uri: 'mock://config/settings.json',
          mimeType: 'application/json',
          text: '{"version": "1.0.0"}'
        }
      ]
    })
  }))
}));

// Mock transports
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({
    onclose: null,
    onerror: null
  }))
}));

jest.mock('@modelcontextprotocol/sdk/client/websocket.js', () => ({
  WebSocketClientTransport: jest.fn().mockImplementation(() => ({
    onclose: null,
    onerror: null
  }))
}));

// Mock server components for mock-mcp-server
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn(),
    close: jest.fn()
  }))
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn()
}));

export {};