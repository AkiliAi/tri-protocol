import { Request, Response, NextFunction } from 'express';
import { Logger } from '../Logger';

export interface RequestLogContext {
  method: string;
  url: string;
  ip: string;
  userAgent?: string;
  requestId?: string;
  statusCode?: number;
  duration?: string;
}

export interface ExpressLoggerOptions {
  logger?: Logger;
  excludePaths?: string[];
  includeBody?: boolean;
  includeQuery?: boolean;
  generateRequestId?: () => string;
}

export function createExpressLogger(options: ExpressLoggerOptions = {}) {
  const {
    logger = Logger.getLogger('ExpressServer'),
    excludePaths = ['/health', '/metrics'],
    includeBody = false,
    includeQuery = true,
    generateRequestId = () => Math.random().toString(36).substring(2, 15)
  } = options;
  
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip excluded paths
    if (excludePaths.some(path => req.path.startsWith(path))) {
      return next();
    }
    
    const start = Date.now();
    const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
    
    // Enrichir la requête avec l'ID
    (req as any).requestId = requestId;
    (req as any).logger = logger.child({ requestId });
    
    // Construire le contexte de log
    const logContext: RequestLogContext = {
      method: req.method,
      url: req.url,
      ip: req.ip || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'],
      requestId
    };
    
    if (includeQuery && Object.keys(req.query).length > 0) {
      (logContext as any).query = req.query;
    }
    
    if (includeBody && req.body && Object.keys(req.body).length > 0) {
      // Éviter de logger les mots de passe
      const sanitizedBody = { ...req.body };
      if (sanitizedBody.password) sanitizedBody.password = '[REDACTED]';
      if (sanitizedBody.token) sanitizedBody.token = '[REDACTED]';
      if (sanitizedBody.apiKey) sanitizedBody.apiKey = '[REDACTED]';
      (logContext as any).body = sanitizedBody;
    }
    
    // Logger la requête entrante
    logger.http('→ Incoming request', logContext);
    
    // Intercepter la fin de la réponse
    const originalSend = res.send;
    const originalJson = res.json;
    const originalEnd = res.end;
    
    const logResponse = () => {
      const duration = Date.now() - start;
      const responseContext: RequestLogContext = {
        ...logContext,
        statusCode: res.statusCode,
        duration: `${duration}ms`
      };
      
      // Ajouter les headers de réponse importants
      if (res.getHeader('x-response-time')) {
        (responseContext as any).responseTime = res.getHeader('x-response-time');
      }
      
      // Choisir le niveau selon le status code
      if (res.statusCode >= 500) {
        logger.error('← Request failed', undefined, responseContext);
      } else if (res.statusCode >= 400) {
        logger.warn('← Request client error', responseContext);
      } else if (res.statusCode >= 300) {
        logger.info('← Request redirected', responseContext);
      } else {
        logger.http('← Request completed', responseContext);
      }
    };
    
    res.send = function(data: any) {
      logResponse();
      res.send = originalSend;
      return res.send(data);
    };
    
    res.json = function(data: any) {
      logResponse();
      res.json = originalJson;
      return res.json(data);
    };
    
    res.end = function(...args: any[]) {
      logResponse();
      res.end = originalEnd;
      return res.end(...args);
    };
    
    next();
  };
}

// Middleware pour ajouter des méthodes de log à la réponse
export function createResponseLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const logger = (req as any).logger || Logger.getLogger('Response');
    
    // Ajouter des méthodes de log à la réponse
    (res as any).logInfo = (message: string, context?: any) => {
      logger.info(message, context);
    };
    
    (res as any).logError = (message: string, error?: Error, context?: any) => {
      logger.error(message, error, context);
    };
    
    (res as any).logWarn = (message: string, context?: any) => {
      logger.warn(message, context);
    };
    
    (res as any).logDebug = (message: string, context?: any) => {
      logger.debug(message, context);
    };
    
    next();
  };
}

// Middleware de gestion d'erreur avec logging
export function createErrorLogger(logger?: Logger) {
  const errorLogger = logger || Logger.getLogger('ErrorHandler');
  
  return (err: Error, req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as any).requestId || 'unknown';
    
    errorLogger.error('Unhandled error in request', err, {
      requestId,
      method: req.method,
      url: req.url,
      ip: req.ip
    });
    
    // Répondre avec une erreur générique
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        requestId,
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  };
}