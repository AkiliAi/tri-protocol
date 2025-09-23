import './reflect-polyfill';
import { AgentConfig } from '../types';

const AGENT_CONFIG_KEY = Symbol('agentConfig');
const CAPABILITIES_KEY = Symbol('capabilities');
const TOOLS_KEY = Symbol('tools');
const MEMORY_CONFIG_KEY = Symbol('memoryConfig');
const METADATA_KEY = Symbol('metadata');

/**
 * Class decorator to define an agent configuration
 */
export function Agent(config?: AgentConfig) {
  return function <T extends { new(...args: any[]): {} }>(constructor: T) {
    Reflect.defineMetadata(AGENT_CONFIG_KEY, config || {}, constructor);

    // Create a new class that extends the original
    return class extends constructor {
      __agentConfig = config;

      constructor(...args: any[]) {
        super(...args);

        // Apply metadata from decorators
        const capabilities = Reflect.getMetadata(CAPABILITIES_KEY, constructor.prototype) || [];
        const tools = Reflect.getMetadata(TOOLS_KEY, constructor.prototype) || [];
        const memoryConfig = Reflect.getMetadata(MEMORY_CONFIG_KEY, constructor);

        if (capabilities.length > 0) {
          (this as any).capabilities = capabilities;
        }
        if (tools.length > 0) {
          (this as any).tools = tools;
        }
        if (memoryConfig) {
          (this as any).memory = memoryConfig;
        }
      }
    };
  };
}

/**
 * Method decorator to define a capability
 */
export function Capability(name: string, description?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const capabilities = Reflect.getMetadata(CAPABILITIES_KEY, target) || [];

    capabilities.push({
      name,
      description,
      method: propertyKey,
      handler: descriptor.value
    });

    Reflect.defineMetadata(CAPABILITIES_KEY, capabilities, target);

    // Store capability metadata on the method itself
    Reflect.defineMetadata(METADATA_KEY, { type: 'capability', name, description }, target, propertyKey);

    return descriptor;
  };
}

/**
 * Method decorator to define a tool
 */
export function Tool(name: string, parameters?: any) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const tools = Reflect.getMetadata(TOOLS_KEY, target) || [];

    tools.push({
      name,
      parameters,
      method: propertyKey,
      handler: descriptor.value
    });

    Reflect.defineMetadata(TOOLS_KEY, tools, target);

    // Store tool metadata on the method itself
    Reflect.defineMetadata(METADATA_KEY, { type: 'tool', name, parameters }, target, propertyKey);

    return descriptor;
  };
}

/**
 * Class decorator to configure memory
 */
export function Memory(type: 'short' | 'long' | 'both', config?: any) {
  return function <T extends { new(...args: any[]): {} }>(constructor: T) {
    const memoryConfig = {
      enabled: true,
      type,
      ...config
    };

    Reflect.defineMetadata(MEMORY_CONFIG_KEY, memoryConfig, constructor);

    return class extends constructor {
      __memoryConfig = memoryConfig;
    };
  };
}

/**
 * Property decorator to inject SDK instance
 */
export function InjectSDK() {
  return function (target: any, propertyKey: string) {
    // This will be handled by the SDK when instantiating the agent
    Reflect.defineMetadata('sdk:inject', true, target, propertyKey);
  };
}

/**
 * Property decorator to inject protocol instance
 */
export function InjectProtocol() {
  return function (target: any, propertyKey: string) {
    // This will be handled by the SDK when instantiating the agent
    Reflect.defineMetadata('protocol:inject', true, target, propertyKey);
  };
}

/**
 * Method decorator to mark a method as an event handler
 */
export function On(event: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const events = Reflect.getMetadata('events', target) || [];
    events.push({ event, handler: propertyKey });
    Reflect.defineMetadata('events', events, target);
    return descriptor;
  };
}

/**
 * Method decorator to mark a method as executable before main logic
 */
export function Before() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    Reflect.defineMetadata('hook:before', propertyKey, target);
    return descriptor;
  };
}

/**
 * Method decorator to mark a method as executable after main logic
 */
export function After() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    Reflect.defineMetadata('hook:after', propertyKey, target);
    return descriptor;
  };
}

/**
 * Parameter decorator to inject context
 */
export function Context() {
  return function (target: any, propertyKey: string, parameterIndex: number) {
    const existingTokens = Reflect.getMetadata('context:params', target, propertyKey) || [];
    existingTokens.push({ index: parameterIndex });
    Reflect.defineMetadata('context:params', existingTokens, target, propertyKey);
  };
}

/**
 * Utility to extract metadata from a decorated class
 */
export function extractAgentMetadata(target: any): any {
  const config = Reflect.getMetadata(AGENT_CONFIG_KEY, target.constructor) || {};
  const capabilities = Reflect.getMetadata(CAPABILITIES_KEY, target) || [];
  const tools = Reflect.getMetadata(TOOLS_KEY, target) || [];
  const memoryConfig = Reflect.getMetadata(MEMORY_CONFIG_KEY, target.constructor);
  const events = Reflect.getMetadata('events', target) || [];

  return {
    config,
    capabilities,
    tools,
    memory: memoryConfig,
    events
  };
}