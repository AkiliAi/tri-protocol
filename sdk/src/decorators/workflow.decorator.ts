import './reflect-polyfill';
import { WorkflowConfig } from '../types';

const WORKFLOW_CONFIG_KEY = Symbol('workflowConfig');
const WORKFLOW_STEPS_KEY = Symbol('workflowSteps');
const WORKFLOW_EDGES_KEY = Symbol('workflowEdges');

/**
 * Class decorator to define a workflow
 */
export function Workflow(config?: WorkflowConfig) {
  return function <T extends { new(...args: any[]): {} }>(constructor: T) {
    Reflect.defineMetadata(WORKFLOW_CONFIG_KEY, config || {}, constructor);

    return class extends constructor {
      __workflowConfig = config;

      constructor(...args: any[]) {
        super(...args);

        // Apply metadata from decorators
        const steps = Reflect.getMetadata(WORKFLOW_STEPS_KEY, constructor.prototype) || [];
        const edges = Reflect.getMetadata(WORKFLOW_EDGES_KEY, constructor.prototype) || [];

        if (steps.length > 0) {
          (this as any).steps = steps;
        }
        if (edges.length > 0) {
          (this as any).edges = edges;
        }
      }
    };
  };
}

/**
 * Method decorator to define a workflow step
 */
export function Step(order?: number, config?: any) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const steps = Reflect.getMetadata(WORKFLOW_STEPS_KEY, target) || [];

    steps.push({
      order: order ?? steps.length,
      method: propertyKey,
      config,
      handler: descriptor.value
    });

    // Sort steps by order
    steps.sort((a: any, b: any) => a.order - b.order);

    Reflect.defineMetadata(WORKFLOW_STEPS_KEY, steps, target);

    return descriptor;
  };
}

/**
 * Method decorator to define a parallel step
 */
export function Parallel(...methods: string[]) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const steps = Reflect.getMetadata(WORKFLOW_STEPS_KEY, target) || [];

    steps.push({
      type: 'parallel',
      method: propertyKey,
      parallelMethods: methods,
      handler: descriptor.value
    });

    Reflect.defineMetadata(WORKFLOW_STEPS_KEY, steps, target);

    return descriptor;
  };
}

/**
 * Method decorator to define a conditional step
 */
export function Conditional(condition: string | ((context: any) => boolean)) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const steps = Reflect.getMetadata(WORKFLOW_STEPS_KEY, target) || [];

    steps.push({
      type: 'conditional',
      method: propertyKey,
      condition,
      handler: descriptor.value
    });

    Reflect.defineMetadata(WORKFLOW_STEPS_KEY, steps, target);

    return descriptor;
  };
}

/**
 * Method decorator to define a loop step
 */
export function Loop(condition: string | ((context: any) => boolean)) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const steps = Reflect.getMetadata(WORKFLOW_STEPS_KEY, target) || [];

    steps.push({
      type: 'loop',
      method: propertyKey,
      condition,
      handler: descriptor.value
    });

    Reflect.defineMetadata(WORKFLOW_STEPS_KEY, steps, target);

    return descriptor;
  };
}

/**
 * Method decorator to define an edge between steps
 */
export function Edge(from: string, to: string, condition?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const edges = Reflect.getMetadata(WORKFLOW_EDGES_KEY, target) || [];

    edges.push({
      from,
      to,
      condition,
      method: propertyKey
    });

    Reflect.defineMetadata(WORKFLOW_EDGES_KEY, edges, target);

    return descriptor;
  };
}

/**
 * Method decorator for error handling in workflow
 */
export function ErrorHandler() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    Reflect.defineMetadata('workflow:errorHandler', propertyKey, target);
    return descriptor;
  };
}

/**
 * Method decorator for workflow completion handler
 */
export function OnComplete() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    Reflect.defineMetadata('workflow:onComplete', propertyKey, target);
    return descriptor;
  };
}

/**
 * Method decorator for workflow initialization
 */
export function OnInit() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    Reflect.defineMetadata('workflow:onInit', propertyKey, target);
    return descriptor;
  };
}

/**
 * Utility to extract workflow metadata from a decorated class
 */
export function extractWorkflowMetadata(target: any): any {
  const config = Reflect.getMetadata(WORKFLOW_CONFIG_KEY, target.constructor) || {};
  const steps = Reflect.getMetadata(WORKFLOW_STEPS_KEY, target) || [];
  const edges = Reflect.getMetadata(WORKFLOW_EDGES_KEY, target) || [];
  const errorHandler = Reflect.getMetadata('workflow:errorHandler', target);
  const onComplete = Reflect.getMetadata('workflow:onComplete', target);
  const onInit = Reflect.getMetadata('workflow:onInit', target);

  return {
    config,
    steps,
    edges,
    errorHandler,
    onComplete,
    onInit
  };
}