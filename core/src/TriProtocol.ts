/*
*/
import { EventEmitter} from 'eventemitter3';
import {TriProtocolConfig,} from "./types";
import { TriOrchestrator } from './TriOrchestrator';

export class TriProtocol extends EventEmitter {
    private static instance: TriProtocol;
    private orchestrator: TriOrchestrator;
    private registry: TriRegistry;
    private config: TriProtocolConfig;

    private constructor() {
        super();
    }

    static getInstance(): TriProtocol {
        if (!this.instance) {
            this.instance = new TriProtocol();
        }
        return this.instance;
    }

    async initialize(config: TriProtocolConfig): Promise<void> {
        this.config = config;
        console.log('🚀 Tri-Protocol initialized with config:', config);
        this.emit('initialized', config);
    }
}