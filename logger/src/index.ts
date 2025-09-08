// Main exports for @tri-protocol/logger package

export { Logger, LogLevel, LogContext, LoggerConfig, defaultLogger } from './Logger';
export { LoggerManager } from './LoggerManager';
export { 
  createExpressLogger, 
  createResponseLogger, 
  createErrorLogger,
  RequestLogContext,
  ExpressLoggerOptions 
} from './middleware/ExpressLogger';

// Convenience re-export
import { LoggerManager } from './LoggerManager';
export const getLogger = (component: string) => LoggerManager.getLogger(component);