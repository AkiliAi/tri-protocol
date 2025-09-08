/**
 * MCP Circuit Breaker
 * Implements circuit breaker pattern for MCP server connections
 * to prevent cascading failures and improve resilience
 */

import { EventEmitter } from 'eventemitter3';
import { Logger } from '../../../logger';

export interface CircuitBreakerConfig {
    failureThreshold: number;      // Number of failures before opening (default: 5)
    successThreshold: number;       // Number of successes to close (default: 2)
    timeout: number;               // Time before half-open in ms (default: 60000)
    monitoringPeriod: number;      // Monitoring window in ms (default: 120000)
    resetTimeout: number;          // Time to reset failure count in ms (default: 300000)
}

export interface CircuitBreakerState {
    status: 'closed' | 'open' | 'half-open';
    failures: number;
    successes: number;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    lastFailureTime?: Date;
    lastSuccessTime?: Date;
    lastStateChange?: Date;
    totalRequests: number;
    totalFailures: number;
    totalSuccesses: number;
}

export interface CircuitBreakerEvents {
    'state:changed': (serverName: string, oldState: string, newState: string) => void;
    'circuit:open': (serverName: string, reason: string) => void;
    'circuit:close': (serverName: string) => void;
    'circuit:half-open': (serverName: string) => void;
    'request:success': (serverName: string) => void;
    'request:failure': (serverName: string, error: Error) => void;
}

export class MCPCircuitBreaker extends EventEmitter<CircuitBreakerEvents> {
    private readonly logger: Logger;
    private readonly circuits = new Map<string, CircuitBreakerState>();
    private readonly configs = new Map<string, CircuitBreakerConfig>();
    private readonly timers = new Map<string, NodeJS.Timeout>();
    
    private readonly defaultConfig: CircuitBreakerConfig = {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60000, // 1 minute
        monitoringPeriod: 120000, // 2 minutes
        resetTimeout: 300000 // 5 minutes
    };

    constructor() {
        super();
        this.logger = new Logger('MCPCircuitBreaker');
    }

    /**
     * Initialize circuit breaker for a server
     */
    public initializeCircuit(
        serverName: string, 
        config?: Partial<CircuitBreakerConfig>
    ): void {
        const finalConfig = { ...this.defaultConfig, ...config };
        
        this.configs.set(serverName, finalConfig);
        this.circuits.set(serverName, {
            status: 'closed',
            failures: 0,
            successes: 0,
            consecutiveFailures: 0,
            consecutiveSuccesses: 0,
            totalRequests: 0,
            totalFailures: 0,
            totalSuccesses: 0,
            lastStateChange: new Date()
        });

        this.logger.info(`Circuit breaker initialized for server: ${serverName}`, {
            config: finalConfig
        });
    }

    /**
     * Check if request should be allowed
     */
    public shouldAllowRequest(serverName: string): boolean {
        const state = this.circuits.get(serverName);
        if (!state) {
            // No circuit breaker configured, allow request
            return true;
        }

        const config = this.configs.get(serverName)!;

        // Update state based on timeout
        if (state.status === 'open') {
            const timeSinceLastFailure = state.lastFailureTime 
                ? Date.now() - state.lastFailureTime.getTime()
                : Infinity;

            if (timeSinceLastFailure >= config.timeout) {
                this.transitionToHalfOpen(serverName);
            }
        }

        // Check current state
        switch (state.status) {
            case 'closed':
                return true;
            case 'half-open':
                // Allow limited requests in half-open state
                return state.consecutiveSuccesses < config.successThreshold;
            case 'open':
                return false;
            default:
                return true;
        }
    }

    /**
     * Record successful request
     */
    public recordSuccess(serverName: string): void {
        const state = this.circuits.get(serverName);
        if (!state) return;

        const config = this.configs.get(serverName)!;

        state.totalRequests++;
        state.totalSuccesses++;
        state.successes++;
        state.consecutiveSuccesses++;
        state.consecutiveFailures = 0;
        state.lastSuccessTime = new Date();

        this.emit('request:success', serverName);

        // Handle state transitions
        switch (state.status) {
            case 'half-open':
                if (state.consecutiveSuccesses >= config.successThreshold) {
                    this.transitionToClosed(serverName);
                }
                break;
            case 'open':
                // Shouldn't happen, but handle gracefully
                this.logger.warn(`Success recorded while circuit is open for ${serverName}`);
                break;
        }

        // Reset failure count after monitoring period
        this.scheduleFailureReset(serverName);
    }

    /**
     * Record failed request
     */
    public recordFailure(serverName: string, error: Error): void {
        const state = this.circuits.get(serverName);
        if (!state) return;

        const config = this.configs.get(serverName)!;

        state.totalRequests++;
        state.totalFailures++;
        state.failures++;
        state.consecutiveFailures++;
        state.consecutiveSuccesses = 0;
        state.lastFailureTime = new Date();

        this.emit('request:failure', serverName, error);

        // Handle state transitions
        switch (state.status) {
            case 'closed':
                if (state.consecutiveFailures >= config.failureThreshold) {
                    this.transitionToOpen(serverName, `Failure threshold reached: ${state.consecutiveFailures}`);
                }
                break;
            case 'half-open':
                // Single failure in half-open state reopens the circuit
                this.transitionToOpen(serverName, 'Failed in half-open state');
                break;
        }
    }

    /**
     * Transition to open state
     */
    private transitionToOpen(serverName: string, reason: string): void {
        const state = this.circuits.get(serverName);
        if (!state) return;

        const oldStatus = state.status;
        state.status = 'open';
        state.lastStateChange = new Date();

        this.logger.warn(`Circuit opened for ${serverName}: ${reason}`, {
            failures: state.consecutiveFailures,
            lastFailure: state.lastFailureTime
        });

        this.emit('state:changed', serverName, oldStatus, 'open');
        this.emit('circuit:open', serverName, reason);

        // Schedule transition to half-open
        this.scheduleHalfOpenTransition(serverName);
    }

    /**
     * Transition to half-open state
     */
    private transitionToHalfOpen(serverName: string): void {
        const state = this.circuits.get(serverName);
        if (!state) return;

        const oldStatus = state.status;
        state.status = 'half-open';
        state.consecutiveSuccesses = 0;
        state.consecutiveFailures = 0;
        state.lastStateChange = new Date();

        this.logger.info(`Circuit half-open for ${serverName}`, {
            previousFailures: state.failures
        });

        this.emit('state:changed', serverName, oldStatus, 'half-open');
        this.emit('circuit:half-open', serverName);
    }

    /**
     * Transition to closed state
     */
    private transitionToClosed(serverName: string): void {
        const state = this.circuits.get(serverName);
        if (!state) return;

        const oldStatus = state.status;
        state.status = 'closed';
        state.failures = 0;
        state.successes = 0;
        state.consecutiveFailures = 0;
        state.consecutiveSuccesses = 0;
        state.lastStateChange = new Date();

        this.logger.info(`Circuit closed for ${serverName}`, {
            totalRequests: state.totalRequests,
            successRate: (state.totalSuccesses / state.totalRequests * 100).toFixed(2) + '%'
        });

        this.emit('state:changed', serverName, oldStatus, 'closed');
        this.emit('circuit:close', serverName);
    }

    /**
     * Schedule transition to half-open state
     */
    private scheduleHalfOpenTransition(serverName: string): void {
        const config = this.configs.get(serverName);
        if (!config) return;

        // Clear existing timer
        const existingTimer = this.timers.get(`${serverName}:half-open`);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new timer
        const timer = setTimeout(() => {
            this.transitionToHalfOpen(serverName);
            this.timers.delete(`${serverName}:half-open`);
        }, config.timeout);

        this.timers.set(`${serverName}:half-open`, timer);
    }

    /**
     * Schedule failure count reset
     */
    private scheduleFailureReset(serverName: string): void {
        const config = this.configs.get(serverName);
        if (!config) return;

        const timerKey = `${serverName}:reset`;
        
        // Clear existing timer
        const existingTimer = this.timers.get(timerKey);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new timer
        const timer = setTimeout(() => {
            const state = this.circuits.get(serverName);
            if (state && state.status === 'closed') {
                state.failures = 0;
                state.successes = 0;
                this.logger.debug(`Reset failure count for ${serverName}`);
            }
            this.timers.delete(timerKey);
        }, config.resetTimeout);

        this.timers.set(timerKey, timer);
    }

    /**
     * Get circuit state for a server
     */
    public getCircuitState(serverName: string): CircuitBreakerState | null {
        return this.circuits.get(serverName) || null;
    }

    /**
     * Get all circuit states
     */
    public getAllCircuitStates(): Map<string, CircuitBreakerState> {
        return new Map(this.circuits);
    }

    /**
     * Reset circuit breaker for a server
     */
    public resetCircuit(serverName: string): void {
        const state = this.circuits.get(serverName);
        if (!state) return;

        state.status = 'closed';
        state.failures = 0;
        state.successes = 0;
        state.consecutiveFailures = 0;
        state.consecutiveSuccesses = 0;
        state.lastStateChange = new Date();

        // Clear all timers
        this.clearTimers(serverName);

        this.logger.info(`Circuit reset for ${serverName}`);
        this.emit('state:changed', serverName, state.status, 'closed');
    }

    /**
     * Remove circuit breaker for a server
     */
    public removeCircuit(serverName: string): void {
        this.circuits.delete(serverName);
        this.configs.delete(serverName);
        this.clearTimers(serverName);
        
        this.logger.info(`Circuit breaker removed for ${serverName}`);
    }

    /**
     * Clear all timers for a server
     */
    private clearTimers(serverName: string): void {
        const timerKeys = [`${serverName}:half-open`, `${serverName}:reset`];
        
        for (const key of timerKeys) {
            const timer = this.timers.get(key);
            if (timer) {
                clearTimeout(timer);
                this.timers.delete(key);
            }
        }
    }

    /**
     * Get circuit breaker statistics
     */
    public getStatistics(serverName: string): any {
        const state = this.circuits.get(serverName);
        if (!state) return null;

        const config = this.configs.get(serverName)!;
        const uptime = state.lastStateChange 
            ? Date.now() - state.lastStateChange.getTime()
            : 0;

        return {
            serverName,
            status: state.status,
            uptime,
            config,
            metrics: {
                totalRequests: state.totalRequests,
                totalSuccesses: state.totalSuccesses,
                totalFailures: state.totalFailures,
                successRate: state.totalRequests > 0 
                    ? (state.totalSuccesses / state.totalRequests * 100).toFixed(2) + '%'
                    : 'N/A',
                currentConsecutiveFailures: state.consecutiveFailures,
                currentConsecutiveSuccesses: state.consecutiveSuccesses
            },
            lastFailure: state.lastFailureTime,
            lastSuccess: state.lastSuccessTime,
            lastStateChange: state.lastStateChange
        };
    }

    /**
     * Cleanup resources
     */
    public destroy(): void {
        // Clear all timers
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.circuits.clear();
        this.configs.clear();
        this.removeAllListeners();
    }
}