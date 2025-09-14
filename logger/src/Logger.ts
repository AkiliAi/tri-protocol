import winston, { Logger as WinstonLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { EventEmitter } from 'events';

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  HTTP = 'http',
  VERBOSE = 'verbose',
  DEBUG = 'debug',
  SILLY = 'silly'
}

export interface LogContext {
  component?: string;
  agentId?: string;
  protocol?: string;
  taskId?: string;
  correlationId?: string;
  [key: string]: any;
}

export interface LoggerConfig {
  level?: LogLevel;
  console?: boolean;
  file?: boolean;
  json?: boolean;
  timestamp?: boolean;
  colorize?: boolean;
  maxFiles?: string;
  maxSize?: string;
  dirname?: string;
  datePattern?: string;
}

export class Logger extends EventEmitter {
  private winston: WinstonLogger;
  private context: LogContext = {};
  private static instances = new Map<string, Logger>();
  
  constructor(
    private component: string,
    private config: LoggerConfig = {}
  ) {
    super();
    this.winston = this.createWinstonLogger();
    this.context.component = component;
  }
  
  static getLogger(component: string, config?: LoggerConfig): Logger {
    if (!Logger.instances.has(component)) {
      Logger.instances.set(component, new Logger(component, config));
    }
    return Logger.instances.get(component)!;
  }
  
  static get instances_() {
    return Logger.instances;
  }
  
  private createWinstonLogger(): WinstonLogger {
    const {
      level = LogLevel.INFO,
      console: enableConsole = true,
      file = false,
      json = false,
      timestamp = true,
      colorize = true,
      dirname = './logs',
      datePattern = 'YYYY-MM-DD',
      maxSize = '20m',
      maxFiles = '14d'
    } = this.config;
    
    const formats = [];
    
    if (timestamp) {
      formats.push(format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }));
    }
    
    if (!json) {
      formats.push(format.printf(({ timestamp, level, message, ...meta }) => {
        const ctx = this.formatContext(meta);
        const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.component}]`;
        return `${prefix} ${message}${ctx ? ` ${ctx}` : ''}`;
      }));
    } else {
      formats.push(format.json());
    }
    
    const logTransports: any[] = [];
    
    if (enableConsole) {
      logTransports.push(new transports.Console({
        format: format.combine(
          colorize ? format.colorize() : format.uncolorize(),
          ...formats
        )
      }));
    }
    
    if (file) {
      logTransports.push(new DailyRotateFile({
        filename: `${dirname}/%DATE%-app.log`,
        datePattern,
        maxSize,
        maxFiles,
        format: format.combine(...formats)
      }));
      
      logTransports.push(new DailyRotateFile({
        filename: `${dirname}/%DATE%-error.log`,
        datePattern,
        maxSize,
        maxFiles,
        level: 'error',
        format: format.combine(...formats)
      }));
    }
    
    return winston.createLogger({
      level,
      transports: logTransports,
      exitOnError: false
    });
  }
  
  private formatContext(meta: any): string {
    const relevant = Object.entries(meta)
      .filter(([key, value]) => value !== undefined && key !== 'component')
      .map(([key, value]) => {
        if (typeof value === 'object') {
          return `${key}=${JSON.stringify(value)}`;
        }
        return `${key}=${value}`;
      });
    
    return relevant.length > 0 ? `[${relevant.join(' ')}]` : '';
  }
  
  error(message: string, error?: Error | any, context?: LogContext): void {
    const meta = { ...this.context, ...context };
    
    if (error instanceof Error) {
      meta.error = {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    } else if (error) {
      meta.error = error;
    }
    
    this.winston.error(message, meta);
    this.emit('log:error', { message, error, context: meta });
  }
  
  warn(message: string, context?: LogContext): void {
    const meta = { ...this.context, ...context };
    this.winston.warn(message, meta);
    this.emit('log:warn', { message, context: meta });
  }
  
  info(message: string, context?: LogContext): void {
    const meta = { ...this.context, ...context };
    this.winston.info(message, meta);
    this.emit('log:info', { message, context: meta });
  }
  
  http(message: string, context?: LogContext): void {
    const meta = { ...this.context, ...context };
    this.winston.http(message, meta);
  }
  
  debug(message: string, context?: LogContext): void {
    const meta = { ...this.context, ...context };
    this.winston.debug(message, meta);
    this.emit('log:debug', { message, context: meta });
  }
  
  verbose(message: string, context?: LogContext): void {
    const meta = { ...this.context, ...context };
    this.winston.verbose(message, meta);
  }
  
  silly(message: string, context?: LogContext): void {
    const meta = { ...this.context, ...context };
    this.winston.silly(message, meta);
  }
  
  child(context: LogContext): Logger {
    const child = new Logger(this.component, this.config);
    child.context = { ...this.context, ...context };
    return child;
  }
  
  startTimer(): (message?: string, context?: LogContext) => void {
    const start = Date.now();
    return (message?: string, context?: LogContext) => {
      const duration = Date.now() - start;
      this.info(message || 'Timer', { ...context, duration: `${duration}ms` });
    };
  }
  
  profile(id: string): void {
    this.winston.profile(id);
  }
  
  setLevel(level: LogLevel): void {
    this.winston.level = level;
  }
  
  getLevel(): string {
    return this.winston.level;
  }
  
  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }
  
  clearContext(): void {
    this.context = { component: this.component };
  }
  
  async query(options: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.winston.query(options, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  }
}

export const defaultLogger = Logger.getLogger('default');