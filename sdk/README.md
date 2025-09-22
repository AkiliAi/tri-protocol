# Tri-Protocol SDK

[![npm version](https://badge.fury.io/js/%40tri-protocol%2Fsdk.svg)](https://badge.fury.io/js/%40tri-protocol%2Fsdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/@tri-protocol/sdk)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)

Official SDK for the Tri-Protocol Framework - Build sophisticated multi-agent systems with ease.

## Features

- 🚀 **Simple API** - Get started in minutes with an intuitive, developer-friendly API
- 🤖 **Pre-built Templates** - Ready-to-use agent and workflow templates
- 🔧 **Fluent Builders** - Chain methods to create complex agents and workflows
- 🎨 **Decorators** - Use TypeScript decorators for elegant agent definitions
- 🔄 **Protocol Support** - Seamless integration with A2A, MCP, and LangGraph protocols
- 💾 **Built-in Persistence** - Memory and state management out of the box
- 🧪 **Testing Utilities** - Comprehensive testing tools included

## Installation

```bash
npm install @tri-protocol/sdk
```

## Quick Start

### Simple Chat

```typescript
import { TriProtocolSDK } from '@tri-protocol/sdk';

const sdk = await TriProtocolSDK.initialize();
const response = await sdk.chat("Hello, how can you help me?");
console.log(response);
```

### Create an Agent

```typescript
const agent = await sdk.createAgent('ResearchBot')
  .withCapability('research')
  .withCapability('analysis')
  .withTool('web-search')
  .withMemory('long')
  .build();

const research = await agent.respond('Latest AI developments');
```

### Build a Workflow

```typescript
const workflow = await sdk.createWorkflow('DataPipeline')
  .addStep({ type: 'tool', config: { tool: 'data-reader' } })
  .transform(data => ({ ...data, processed: true }))
  .parallel(
    { type: 'agent', config: { agentId: 'analyst', action: 'analyze' } },
    { type: 'agent', config: { agentId: 'validator', action: 'validate' } }
  )
  .addStep({ type: 'tool', config: { tool: 'data-writer' } })
  .build();

const result = await workflow.execute(inputData);
```

## Core Concepts

### SDK Initialization

```typescript
const sdk = await TriProtocolSDK.initialize({
  mode: 'development',      // or 'production'
  llm: {
    provider: 'ollama',     // or 'openai', 'anthropic', etc.
    model: 'llama2',
    apiKey: 'your-api-key'  // if required
  },
  persistence: {
    enabled: true,
    backend: 'mongodb'      // or 'memory', 'postgres', 'redis'
  },
  protocols: {
    a2a: true,              // Enable Agent-to-Agent communication
    mcp: true,              // Enable Model Context Protocol
    langgraph: true         // Enable LangGraph orchestration
  }
});
```

### Agents

Agents are autonomous entities that can:
- Process natural language inputs
- Execute tasks and workflows
- Communicate with other agents
- Use tools and resources
- Maintain memory and context

#### Using Templates

```typescript
// Use pre-built templates
const chatAgent = await sdk.createAgent('Chat', 'chat').build();
const researcher = await sdk.createAgent('Researcher', 'research').build();
const analyst = await sdk.createAgent('Analyst', 'analyst').build();
```

#### Custom Agents

```typescript
const customAgent = await sdk.createAgent('CustomBot')
  .withDescription('A specialized agent for my use case')
  .withPersonality('You are an expert in...')
  .withCapability('custom:my-capability')
  .withTool('my-custom-tool')
  .withMemory('both')  // short-term and long-term
  .withLLM({
    temperature: 0.7,
    maxTokens: 2048
  })
  .canCommunicate()     // Enable A2A protocol
  .canUseTools()        // Enable MCP protocol
  .canExecuteWorkflows() // Enable LangGraph
  .build();
```

### Workflows

Workflows orchestrate complex multi-step processes:

```typescript
const workflow = await sdk.createWorkflow('MyWorkflow')
  .withTimeout(60000)
  .withRetries(3)
  .withCheckpointing(true)

  // Sequential steps
  .addStep('Extract data')
  .addStep('Validate data')

  // Parallel execution
  .parallel(
    'Process stream 1',
    'Process stream 2',
    'Process stream 3'
  )

  // Conditional branching
  .condition('data.quality > 0.8')
    .then(builder => builder.addStep('High quality processing'))
    .else(builder => builder.addStep('Standard processing'))

  // Loops
  .loop('hasMoreData', builder => {
    builder
      .addStep('Process batch')
      .addStep('Update progress');
  })

  // Integration with agents and tools
  .useAgent('analyst', 'analyze')
  .useTool('report-generator', { format: 'pdf' })

  .build();
```

### Decorators

Use TypeScript decorators for class-based agents:

```typescript
import { Agent, Capability, Tool, Memory } from '@tri-protocol/sdk';

@Agent({ name: 'SmartAssistant' })
@Memory('both')
export class MyAssistant extends SDKAgent {
  @Capability('schedule')
  async scheduleTask(task: string, when: Date) {
    // Implementation
  }

  @Tool('calculator')
  async calculate(expression: string): Promise<number> {
    // Implementation
  }
}

const assistant = await sdk.registerAgent(MyAssistant);
```

### Client API

The SDK provides a simplified client for common operations:

```typescript
const client = sdk.getClient();

// Simple operations
await client.ask("What's the weather like?");
await client.chat("Tell me a joke");

// Memory operations
await client.remember('user-preference', { theme: 'dark' });
const preference = await client.recall('user-preference');

// Search
const results = await client.search('quantum computing', {
  limit: 10,
  threshold: 0.7
});

// Agent management
const agents = await client.agents.list();
const agent = await client.agents.get('agent-id');

// Workflow management
const workflows = await client.workflows.list();
await client.workflows.run('workflow-id', inputData);
```

## Advanced Features

### Plugins

Extend the SDK with plugins:

```typescript
const myPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  install: async (sdk) => {
    // Add custom functionality
    sdk.registerAgentTemplate('custom', new CustomAgentTemplate());
    sdk.registerWorkflowTemplate('custom', new CustomWorkflowTemplate());
  }
};

sdk.registerPlugin(myPlugin);
```

### Streaming

Support for streaming responses:

```typescript
const stream = client.stream('Generate a long story...');
for await (const chunk of stream) {
  console.log(chunk);
}
```

### Batch Operations

Execute multiple operations efficiently:

```typescript
const results = await client.batch([
  { type: 'ask', params: { question: 'Question 1' } },
  { type: 'ask', params: { question: 'Question 2' } },
  { type: 'task', params: { task: 'Process data', context: data } }
]);
```

## Testing

The SDK includes comprehensive testing utilities:

```typescript
import { SDKTestRunner } from '@tri-protocol/sdk/testing';

const runner = new SDKTestRunner();

// Test an agent
await runner.testAgent(agent, [
  {
    name: 'Basic response',
    input: 'Hello',
    expectedOutput: /greeting/i
  }
]);

// Test a workflow
await runner.testWorkflow(workflow, [
  { input: testData1 },
  { input: testData2 }
]);
```

## API Reference

### TriProtocolSDK

- `create(config?)` - Create SDK instance
- `initialize(config?)` - Create and initialize SDK
- `createAgent(name, template?)` - Create agent builder
- `createWorkflow(name)` - Create workflow builder
- `query(question, context?)` - Process a query
- `chat(message)` - Chat interaction
- `analyze(data, type?)` - Analyze data
- `runWorkflow(template, input)` - Run workflow template
- `registerPlugin(plugin)` - Register a plugin
- `registerAgent(AgentClass)` - Register agent class
- `shutdown()` - Clean shutdown

### AgentBuilder

- `withName(name)` - Set agent name
- `withDescription(desc)` - Set description
- `withCapability(cap)` - Add capability
- `withTool(tool)` - Add tool
- `withMemory(type)` - Enable memory
- `withLLM(config)` - Configure LLM
- `withPersonality(prompt)` - Set system prompt
- `fromTemplate(template)` - Use template
- `canCommunicate()` - Enable A2A
- `canUseTools()` - Enable MCP
- `canExecuteWorkflows()` - Enable LangGraph
- `build()` - Build the agent

### WorkflowBuilder

- `withName(name)` - Set workflow name
- `withDescription(desc)` - Set description
- `withTimeout(ms)` - Set timeout
- `withRetries(count)` - Set retry count
- `withCheckpointing(enabled)` - Enable checkpointing
- `addStep(step)` - Add sequential step
- `parallel(...steps)` - Add parallel steps
- `condition(expr)` - Add conditional branch
- `loop(condition, body)` - Add loop
- `useAgent(id, action)` - Use agent
- `useTool(name, args)` - Use tool
- `transform(fn)` - Transform data
- `filter(fn)` - Filter data
- `build()` - Build the workflow

## Examples

See the `examples/` directory for more comprehensive examples:

- `quickstart/` - Getting started examples
- `advanced/` - Advanced patterns and techniques
- `recipes/` - Common use case implementations

## Contributing

We welcome contributions! Please see our [Contributing Guide](../CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](../LICENSE) for details.

## Support

- [Documentation](https://github.com/AkiliAi/tri-protocol)
- [API Reference](https://github.com/AkiliAi/tri-protocol)
- [GitHub Issues](https://github.com/AkiliAi/tri-protocol/issues)
- [Discord Community](https://discord.gg/tri-protocol)