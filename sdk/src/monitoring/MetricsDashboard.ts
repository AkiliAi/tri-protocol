import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import * as path from 'path';
import { TriProtocolSDK } from '../TriProtocolSDK';
import { PrometheusExporter } from '../metrics/exporters';
import { LoggerManager } from '@tri-protocol/logger';
import { MetricSnapshot } from '../metrics';

/**
 * Real-time metrics dashboard for SDK monitoring
 */
export class MetricsDashboard {
  private app: express.Application;
  private server: any;
  private io: Server;
  private logger = LoggerManager.getLogger('MetricsDashboard');
  private updateInterval?: NodeJS.Timeout;
  private prometheusExporter: PrometheusExporter;

  constructor(
    private sdk: TriProtocolSDK,
    private port: number = 3001
  ) {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new Server(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    this.prometheusExporter = new PrometheusExporter({
      prefix: 'tri_protocol_sdk'
    });

    // Add Prometheus exporter to SDK
    this.sdk.enableMetricsExport(this.prometheusExporter);

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, 'public')));

    // CORS middleware
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });
  }

  private setupRoutes(): void {
    // Main dashboard route
    this.app.get('/', (req, res) => {
      res.send(this.getDashboardHTML());
    });

    // API: Current metrics
    this.app.get('/api/metrics', (req, res) => {
      const metrics = this.sdk.getMetricsSnapshot();
      res.json(this.formatMetricsForDashboard(metrics));
    });

    // API: Historical metrics (last hour)
    this.app.get('/api/metrics/history', (req, res) => {
      // In a real implementation, this would fetch from a time-series database
      res.json({
        message: 'Historical metrics would be fetched from storage',
        placeholder: true
      });
    });

    // Prometheus metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      const metrics = this.sdk.getMetricsSnapshot();
      await this.prometheusExporter.export(metrics);
      res.set('Content-Type', 'text/plain');
      res.send(this.prometheusExporter.getMetrics());
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      const metrics = this.sdk.getMetricsSnapshot();
      const isHealthy = this.checkHealth(metrics);

      res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        metrics: {
          errorRate: metrics.errorRate,
          activeAgents: metrics.activeAgents,
          activeWorkflows: metrics.activeWorkflows,
          memoryUsage: Math.round(metrics.memoryUsage.heapUsed / 1024 / 1024),
          responseTime: Math.round(metrics.averageResponseTime)
        }
      });
    });

    // API: Reset metrics
    this.app.post('/api/metrics/reset', (req, res) => {
      this.sdk.getMetrics().reset();
      res.json({ success: true, message: 'Metrics reset successfully' });
    });

    // API: SDK configuration
    this.app.get('/api/config', (req, res) => {
      res.json(this.sdk.getConfig());
    });
  }

  private setupWebSocket(): void {
    this.io.on('connection', (socket) => {
      this.logger.info(`Client connected: ${socket.id}`);

      // Send current metrics immediately
      const metrics = this.sdk.getMetricsSnapshot();
      socket.emit('metrics', this.formatMetricsForDashboard(metrics));

      // Set up periodic updates for this client
      const interval = setInterval(() => {
        const metrics = this.sdk.getMetricsSnapshot();
        socket.emit('metrics', this.formatMetricsForDashboard(metrics));
      }, 1000); // Update every second

      // Handle client requests
      socket.on('refresh', () => {
        const metrics = this.sdk.getMetricsSnapshot();
        socket.emit('metrics', this.formatMetricsForDashboard(metrics));
      });

      socket.on('reset', () => {
        this.sdk.getMetrics().reset();
        socket.emit('reset-success');
      });

      // Cleanup on disconnect
      socket.on('disconnect', () => {
        this.logger.info(`Client disconnected: ${socket.id}`);
        clearInterval(interval);
      });
    });
  }

  private formatMetricsForDashboard(metrics: MetricSnapshot): any {
    return {
      timestamp: metrics.timestamp.toISOString(),
      overview: {
        totalAgents: metrics.totalAgentsCreated,
        activeAgents: metrics.activeAgents,
        totalWorkflows: metrics.totalWorkflowsExecuted,
        activeWorkflows: metrics.activeWorkflows,
        totalQueries: metrics.totalQueries,
        totalErrors: metrics.totalErrors,
        errorRate: metrics.errorRate
      },
      performance: {
        avgResponseTime: Math.round(metrics.averageResponseTime),
        p50ResponseTime: Math.round(metrics.p50ResponseTime),
        p95ResponseTime: Math.round(metrics.p95ResponseTime),
        p99ResponseTime: Math.round(metrics.p99ResponseTime)
      },
      memory: {
        heapUsed: Math.round(metrics.memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(metrics.memoryUsage.heapTotal / 1024 / 1024),
        rss: Math.round(metrics.memoryUsage.rss / 1024 / 1024),
        external: Math.round(metrics.memoryUsage.external / 1024 / 1024)
      },
      protocols: metrics.protocolUsage,
      llm: {
        total: metrics.llmCalls.total,
        cacheHits: metrics.llmCalls.cacheHits,
        cacheHitRate: metrics.llmCalls.cacheHitRate.toFixed(1),
        avgTokens: Math.round(metrics.llmCalls.averageTokens),
        totalCost: metrics.llmCalls.totalCost?.toFixed(4) || '0.0000',
        byProvider: metrics.llmCalls.byProvider
      },
      builders: metrics.builderUsage,
      errors: metrics.errorsByType
    };
  }

  private checkHealth(metrics: MetricSnapshot): boolean {
    // Health check criteria
    const errorRateThreshold = 10; // errors per minute
    const memoryThreshold = 0.9; // 90% of heap
    const responseTimeThreshold = 5000; // 5 seconds

    if (metrics.errorRate > errorRateThreshold) {
      return false;
    }

    if (metrics.memoryUsage.heapUsed / metrics.memoryUsage.heapTotal > memoryThreshold) {
      return false;
    }

    if (metrics.p95ResponseTime > responseTimeThreshold) {
      return false;
    }

    return true;
  }

  private getDashboardHTML(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tri-Protocol SDK Metrics Dashboard</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #333;
      min-height: 100vh;
      padding: 20px;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    header {
      text-align: center;
      color: white;
      margin-bottom: 30px;
    }

    h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
    }

    .timestamp {
      opacity: 0.9;
      font-size: 0.9rem;
    }

    .dashboard {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
    }

    .metric-card {
      background: white;
      border-radius: 10px;
      padding: 20px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      transition: transform 0.2s;
    }

    .metric-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
    }

    .metric-card h2 {
      font-size: 1.2rem;
      margin-bottom: 15px;
      color: #667eea;
    }

    .metric-value {
      font-size: 2rem;
      font-weight: bold;
      color: #333;
    }

    .metric-label {
      font-size: 0.9rem;
      color: #666;
      margin-top: 5px;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-top: 10px;
    }

    .metric-item {
      padding: 10px;
      background: #f7fafc;
      border-radius: 5px;
    }

    .metric-item-value {
      font-size: 1.2rem;
      font-weight: 600;
      color: #333;
    }

    .metric-item-label {
      font-size: 0.8rem;
      color: #666;
      margin-top: 2px;
    }

    .controls {
      position: fixed;
      bottom: 20px;
      right: 20px;
      display: flex;
      gap: 10px;
    }

    button {
      background: #667eea;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 1rem;
      transition: background 0.2s;
    }

    button:hover {
      background: #5a67d8;
    }

    button:active {
      transform: scale(0.98);
    }

    .status-indicator {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 5px;
    }

    .status-healthy {
      background: #48bb78;
    }

    .status-warning {
      background: #ed8936;
    }

    .status-error {
      background: #f56565;
    }

    .chart-container {
      height: 200px;
      margin-top: 15px;
    }

    @media (max-width: 768px) {
      .dashboard {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🚀 Tri-Protocol SDK Metrics Dashboard</h1>
      <div class="timestamp" id="timestamp">Connecting...</div>
    </header>

    <div class="dashboard">
      <!-- Overview Card -->
      <div class="metric-card">
        <h2>📊 Overview</h2>
        <div class="metric-value" id="total-queries">0</div>
        <div class="metric-label">Total Queries</div>
        <div class="metric-grid">
          <div class="metric-item">
            <div class="metric-item-value" id="active-agents">0</div>
            <div class="metric-item-label">Active Agents</div>
          </div>
          <div class="metric-item">
            <div class="metric-item-value" id="active-workflows">0</div>
            <div class="metric-item-label">Active Workflows</div>
          </div>
          <div class="metric-item">
            <div class="metric-item-value" id="total-agents">0</div>
            <div class="metric-item-label">Total Agents</div>
          </div>
          <div class="metric-item">
            <div class="metric-item-value" id="total-workflows">0</div>
            <div class="metric-item-label">Total Workflows</div>
          </div>
        </div>
      </div>

      <!-- Performance Card -->
      <div class="metric-card">
        <h2>⚡ Performance</h2>
        <div class="metric-value"><span id="avg-response-time">0</span> ms</div>
        <div class="metric-label">Average Response Time</div>
        <div class="metric-grid">
          <div class="metric-item">
            <div class="metric-item-value"><span id="p50-time">0</span> ms</div>
            <div class="metric-item-label">P50 Latency</div>
          </div>
          <div class="metric-item">
            <div class="metric-item-value"><span id="p95-time">0</span> ms</div>
            <div class="metric-item-label">P95 Latency</div>
          </div>
          <div class="metric-item">
            <div class="metric-item-value"><span id="p99-time">0</span> ms</div>
            <div class="metric-item-label">P99 Latency</div>
          </div>
          <div class="metric-item">
            <div class="metric-item-value"><span id="error-rate">0</span>/min</div>
            <div class="metric-item-label">Error Rate</div>
          </div>
        </div>
      </div>

      <!-- Memory Card -->
      <div class="metric-card">
        <h2>💾 Memory Usage</h2>
        <div class="metric-value"><span id="heap-used">0</span> MB</div>
        <div class="metric-label">Heap Used</div>
        <div class="metric-grid">
          <div class="metric-item">
            <div class="metric-item-value"><span id="heap-total">0</span> MB</div>
            <div class="metric-item-label">Heap Total</div>
          </div>
          <div class="metric-item">
            <div class="metric-item-value"><span id="rss">0</span> MB</div>
            <div class="metric-item-label">RSS</div>
          </div>
        </div>
      </div>

      <!-- LLM Card -->
      <div class="metric-card">
        <h2>🤖 LLM Usage</h2>
        <div class="metric-value" id="llm-calls">0</div>
        <div class="metric-label">Total LLM Calls</div>
        <div class="metric-grid">
          <div class="metric-item">
            <div class="metric-item-value"><span id="cache-hit-rate">0</span>%</div>
            <div class="metric-item-label">Cache Hit Rate</div>
          </div>
          <div class="metric-item">
            <div class="metric-item-value" id="avg-tokens">0</div>
            <div class="metric-item-label">Avg Tokens</div>
          </div>
          <div class="metric-item">
            <div class="metric-item-value">$<span id="llm-cost">0.0000</span></div>
            <div class="metric-item-label">Total Cost</div>
          </div>
          <div class="metric-item">
            <div class="metric-item-value" id="cache-hits">0</div>
            <div class="metric-item-label">Cache Hits</div>
          </div>
        </div>
      </div>

      <!-- Protocol Usage Card -->
      <div class="metric-card">
        <h2>🔌 Protocol Usage</h2>
        <div class="metric-grid">
          <div class="metric-item">
            <div class="metric-item-value" id="a2a-usage">0</div>
            <div class="metric-item-label">A2A</div>
          </div>
          <div class="metric-item">
            <div class="metric-item-value" id="mcp-usage">0</div>
            <div class="metric-item-label">MCP</div>
          </div>
          <div class="metric-item">
            <div class="metric-item-value" id="langgraph-usage">0</div>
            <div class="metric-item-label">LangGraph</div>
          </div>
        </div>
      </div>

      <!-- Errors Card -->
      <div class="metric-card">
        <h2>❌ Errors</h2>
        <div class="metric-value" id="total-errors">0</div>
        <div class="metric-label">Total Errors</div>
        <div id="errors-by-type" class="metric-grid"></div>
      </div>
    </div>

    <div class="controls">
      <button onclick="refreshMetrics()">🔄 Refresh</button>
      <button onclick="resetMetrics()">🗑️ Reset Metrics</button>
    </div>
  </div>

  <script>
    const socket = io();

    socket.on('connect', () => {
      console.log('Connected to metrics server');
      document.getElementById('timestamp').textContent = 'Connected • ' + new Date().toLocaleString();
    });

    socket.on('disconnect', () => {
      document.getElementById('timestamp').textContent = 'Disconnected • Reconnecting...';
    });

    socket.on('metrics', (data) => {
      updateDashboard(data);
    });

    socket.on('reset-success', () => {
      alert('Metrics reset successfully!');
    });

    function updateDashboard(data) {
      // Update timestamp
      document.getElementById('timestamp').textContent = 'Last Updated: ' + new Date(data.timestamp).toLocaleString();

      // Update Overview
      document.getElementById('total-queries').textContent = data.overview.totalQueries;
      document.getElementById('active-agents').textContent = data.overview.activeAgents;
      document.getElementById('active-workflows').textContent = data.overview.activeWorkflows;
      document.getElementById('total-agents').textContent = data.overview.totalAgents;
      document.getElementById('total-workflows').textContent = data.overview.totalWorkflows;

      // Update Performance
      document.getElementById('avg-response-time').textContent = data.performance.avgResponseTime;
      document.getElementById('p50-time').textContent = data.performance.p50ResponseTime;
      document.getElementById('p95-time').textContent = data.performance.p95ResponseTime;
      document.getElementById('p99-time').textContent = data.performance.p99ResponseTime;
      document.getElementById('error-rate').textContent = data.overview.errorRate;

      // Update Memory
      document.getElementById('heap-used').textContent = data.memory.heapUsed;
      document.getElementById('heap-total').textContent = data.memory.heapTotal;
      document.getElementById('rss').textContent = data.memory.rss;

      // Update LLM
      document.getElementById('llm-calls').textContent = data.llm.total;
      document.getElementById('cache-hit-rate').textContent = data.llm.cacheHitRate;
      document.getElementById('avg-tokens').textContent = data.llm.avgTokens;
      document.getElementById('llm-cost').textContent = data.llm.totalCost;
      document.getElementById('cache-hits').textContent = data.llm.cacheHits;

      // Update Protocol Usage
      document.getElementById('a2a-usage').textContent = data.protocols.a2a;
      document.getElementById('mcp-usage').textContent = data.protocols.mcp;
      document.getElementById('langgraph-usage').textContent = data.protocols.langgraph;

      // Update Errors
      document.getElementById('total-errors').textContent = data.overview.totalErrors;

      // Update errors by type
      const errorsContainer = document.getElementById('errors-by-type');
      errorsContainer.innerHTML = '';
      for (const [type, count] of Object.entries(data.errors)) {
        const errorItem = document.createElement('div');
        errorItem.className = 'metric-item';
        errorItem.innerHTML = \`
          <div class="metric-item-value">\${count}</div>
          <div class="metric-item-label">\${type}</div>
        \`;
        errorsContainer.appendChild(errorItem);
      }
    }

    function refreshMetrics() {
      socket.emit('refresh');
    }

    function resetMetrics() {
      if (confirm('Are you sure you want to reset all metrics?')) {
        socket.emit('reset');
      }
    }
  </script>
</body>
</html>
    `;
  }

  /**
   * Start the dashboard server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        this.logger.info(`📊 Metrics dashboard running at http://localhost:${this.port}`);
        this.logger.info(`📈 Prometheus metrics available at http://localhost:${this.port}/metrics`);
        this.logger.info(`❤️ Health check available at http://localhost:${this.port}/health`);
        resolve();
      });
    });
  }

  /**
   * Stop the dashboard server
   */
  async stop(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    return new Promise((resolve) => {
      this.io.close(() => {
        this.server.close(() => {
          this.logger.info('Dashboard server stopped');
          resolve();
        });
      });
    });
  }
}