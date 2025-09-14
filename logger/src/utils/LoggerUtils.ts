import { Logger, LogContext } from '../Logger';

/**
 * Utility functions for logger usage
 */

/**
 * Create a performance timer that logs execution time
 */
export function createPerformanceTimer(logger: Logger, operation: string): () => void {
    const start = process.hrtime.bigint();
    
    return () => {
        const end = process.hrtime.bigint();
        const duration = Number(end - start) / 1_000_000; // Convert to milliseconds
        
        logger.info(`${operation} completed`, {
            duration: `${duration.toFixed(2)}ms`,
            operation
        });
    };
}

/**
 * Log async operation with automatic error handling
 */
export async function logAsyncOperation<T>(
    logger: Logger,
    operation: string,
    fn: () => Promise<T>,
    context?: LogContext
): Promise<T> {
    const timer = createPerformanceTimer(logger, operation);
    
    logger.debug(`Starting ${operation}`, context);
    
    try {
        const result = await fn();
        timer();
        return result;
    } catch (error) {
        logger.error(`${operation} failed`, error as Error, context);
        throw error;
    }
}

/**
 * Create a method decorator for automatic logging
 */
export function LogMethod(logLevel: 'debug' | 'info' | 'verbose' = 'debug') {
    return function (
        target: any,
        propertyName: string,
        descriptor: PropertyDescriptor
    ) {
        const method = descriptor.value;
        
        descriptor.value = async function (...args: any[]) {
            const logger = (this as any).logger || Logger.getLogger(target.constructor.name);
            const timer = createPerformanceTimer(logger, propertyName);
            
            logger[logLevel](`Calling ${propertyName}`, {
                args: args.length > 0 ? args : undefined
            });
            
            try {
                const result = await method.apply(this, args);
                timer();
                return result;
            } catch (error) {
                logger.error(`${propertyName} failed`, error as Error);
                throw error;
            }
        };
        
        return descriptor;
    };
}

/**
 * Format error for logging with stack trace
 */
export function formatError(error: Error | any): any {
    if (error instanceof Error) {
        const formatted: any = {
            name: error.name,
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 5) // Limit stack trace
        };
        
        // Add any additional properties without overwriting
        Object.keys(error).forEach(key => {
            if (!['name', 'message', 'stack'].includes(key)) {
                formatted[key] = (error as any)[key];
            }
        });
        
        return formatted;
    }
    return error;
}

/**
 * Create a logger for a class with automatic context
 */
export function createClassLogger(className: string, context?: LogContext): Logger {
    return Logger.getLogger(className).child({
        class: className,
        ...context
    });
}

/**
 * Log network request/response
 */
export function logNetworkRequest(
    logger: Logger,
    method: string,
    url: string,
    options?: {
        body?: any;
        headers?: any;
        response?: any;
        statusCode?: number;
        duration?: number;
    }
): void {
    const context: LogContext = {
        method,
        url,
        statusCode: options?.statusCode,
        duration: options?.duration ? `${options.duration}ms` : undefined
    };
    
    if (options?.body) {
        // Sanitize sensitive data
        const sanitized = { ...options.body };
        if (sanitized.password) sanitized.password = '[REDACTED]';
        if (sanitized.token) sanitized.token = '[REDACTED]';
        if (sanitized.apiKey) sanitized.apiKey = '[REDACTED]';
        context.body = sanitized;
    }
    
    if (options?.headers) {
        const sanitizedHeaders = { ...options.headers };
        if (sanitizedHeaders.authorization) sanitizedHeaders.authorization = '[REDACTED]';
        if (sanitizedHeaders['x-api-key']) sanitizedHeaders['x-api-key'] = '[REDACTED]';
        context.headers = sanitizedHeaders;
    }
    
    if (options?.statusCode && options.statusCode >= 400) {
        logger.error(`${method} request failed`, undefined, context);
    } else {
        logger.http(`${method} request`, context);
    }
}

/**
 * Batch log messages for performance
 */
export class BatchLogger {
    private buffer: Array<{ level: string; message: string; context?: LogContext }> = [];
    private timer?: NodeJS.Timeout;
    
    constructor(
        private logger: Logger,
        private batchSize: number = 10,
        private flushInterval: number = 1000
    ) {
        this.startTimer();
    }
    
    private startTimer(): void {
        this.timer = setInterval(() => this.flush(), this.flushInterval);
    }
    
    log(level: 'info' | 'debug' | 'warn' | 'error', message: string, context?: LogContext): void {
        this.buffer.push({ level, message, context });
        
        if (this.buffer.length >= this.batchSize) {
            this.flush();
        }
    }
    
    flush(): void {
        if (this.buffer.length === 0) return;
        
        const batch = this.buffer.splice(0);
        this.logger.info(`Batch log (${batch.length} messages)`, {
            messages: batch
        });
    }
    
    destroy(): void {
        if (this.timer) {
            clearInterval(this.timer);
        }
        this.flush();
    }
}