/**
 * Polyfill for Reflect metadata if not available
 * This ensures compatibility across different environments
 */

// Extend global Reflect object
declare global {
  namespace Reflect {
    function defineMetadata(metadataKey: any, metadataValue: any, target: any, propertyKey?: string | symbol): void;
    function getMetadata(metadataKey: any, target: any, propertyKey?: string | symbol): any;
    function hasMetadata(metadataKey: any, target: any, propertyKey?: string | symbol): boolean;
    function getOwnMetadata(metadataKey: any, target: any, propertyKey?: string | symbol): any;
    function getMetadataKeys(target: any, propertyKey?: string | symbol): any[];
    function getOwnMetadataKeys(target: any, propertyKey?: string | symbol): any[];
    function deleteMetadata(metadataKey: any, target: any, propertyKey?: string | symbol): boolean;
  }
}

// Create implementation if not available
const metadataMap = new WeakMap<any, Map<string, any>>();

if (!(Reflect as any).defineMetadata) {
  (Reflect as any).defineMetadata = function(key: any, value: any, target: any, propertyKey?: any): void {
    let targetMap = metadataMap.get(target);
    if (!targetMap) {
      targetMap = new Map();
      metadataMap.set(target, targetMap);
    }

    const metaKey = propertyKey ? `${String(key)}:${String(propertyKey)}` : String(key);
    targetMap.set(metaKey, value);
  };
}

if (!(Reflect as any).getMetadata) {
  (Reflect as any).getMetadata = function(key: any, target: any, propertyKey?: any): any {
    const targetMap = metadataMap.get(target);
    if (!targetMap) return undefined;

    const metaKey = propertyKey ? `${String(key)}:${String(propertyKey)}` : String(key);
    return targetMap.get(metaKey);
  };
}

if (!(Reflect as any).hasMetadata) {
  (Reflect as any).hasMetadata = function(key: any, target: any, propertyKey?: any): boolean {
    const targetMap = metadataMap.get(target);
    if (!targetMap) return false;

    const metaKey = propertyKey ? `${String(key)}:${String(propertyKey)}` : String(key);
    return targetMap.has(metaKey);
  };
}

if (!(Reflect as any).getOwnMetadata) {
  (Reflect as any).getOwnMetadata = (Reflect as any).getMetadata;
}

if (!(Reflect as any).getMetadataKeys) {
  (Reflect as any).getMetadataKeys = function(target: any, propertyKey?: any): any[] {
    const targetMap = metadataMap.get(target);
    if (!targetMap) return [];
    return Array.from(targetMap.keys());
  };
}

if (!(Reflect as any).getOwnMetadataKeys) {
  (Reflect as any).getOwnMetadataKeys = (Reflect as any).getMetadataKeys;
}

if (!(Reflect as any).deleteMetadata) {
  (Reflect as any).deleteMetadata = function(key: any, target: any, propertyKey?: any): boolean {
    const targetMap = metadataMap.get(target);
    if (!targetMap) return false;

    const metaKey = propertyKey ? `${String(key)}:${String(propertyKey)}` : String(key);
    return targetMap.delete(metaKey);
  };
}

export {};