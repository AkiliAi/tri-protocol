#!/usr/bin/env ts-node

/**
 * SDK Unit Tests Runner
 * Executes all SDK unit tests and generates a comprehensive report
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

console.log(`
╔═══════════════════════════════════════════════════════════╗
║            TRI-PROTOCOL SDK - UNIT TESTS                  ║
╚═══════════════════════════════════════════════════════════╝
`);

const testCategories = [
  {
    name: 'Core SDK',
    pattern: 'TriProtocolSDK.test.ts',
    description: 'Main SDK class and initialization'
  },
  {
    name: 'Builders',
    pattern: 'builders/*.test.ts',
    description: 'AgentBuilder and WorkflowBuilder'
  },
  {
    name: 'Client',
    pattern: 'client/*.test.ts',
    description: 'TriProtocolClient HTTP and WebSocket'
  },
  {
    name: 'Utilities',
    pattern: 'utils/*.test.ts',
    description: 'Validators and Serializers'
  },
  {
    name: 'Templates',
    pattern: 'templates/*.test.ts',
    description: 'Agent and Workflow templates'
  },
  {
    name: 'Decorators',
    pattern: 'decorators/*.test.ts',
    description: 'TypeScript decorators'
  }
];

interface TestResult {
  category: string;
  passed: boolean;
  tests?: number;
  failures?: number;
  duration?: number;
  coverage?: {
    statements: number;
    branches: number;
    functions: number;
    lines: number;
  };
  error?: string;
}

const results: TestResult[] = [];

// Run tests for each category
for (const category of testCategories) {
  console.log(`\n🧪 Testing: ${category.name}`);
  console.log(`   ${category.description}`);
  console.log('─'.repeat(60));

  try {
    const startTime = Date.now();

    // Run Jest for specific test files
    const output = execSync(
      `npx jest --testPathPattern="${category.pattern}" --coverage --json --outputFile=test-output.json`,
      {
        cwd: __dirname,
        stdio: 'pipe',
        encoding: 'utf8'
      }
    );

    const duration = Date.now() - startTime;

    // Read test results
    const testOutput = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-output.json'), 'utf8'));

    const result: TestResult = {
      category: category.name,
      passed: testOutput.success,
      tests: testOutput.numTotalTests,
      failures: testOutput.numFailedTests,
      duration: duration / 1000,
      coverage: testOutput.coverageMap ? {
        statements: calculateCoverage(testOutput.coverageMap, 'statements'),
        branches: calculateCoverage(testOutput.coverageMap, 'branches'),
        functions: calculateCoverage(testOutput.coverageMap, 'functions'),
        lines: calculateCoverage(testOutput.coverageMap, 'lines')
      } : undefined
    };

    results.push(result);

    console.log(`✅ ${result.tests} tests passed in ${result.duration}s`);

    if (result.coverage) {
      console.log(`📊 Coverage: ${result.coverage.lines}% lines, ${result.coverage.branches}% branches`);
    }
  } catch (error: any) {
    console.log(`❌ Tests failed`);

    results.push({
      category: category.name,
      passed: false,
      error: error.message || 'Unknown error'
    });
  } finally {
    // Clean up test output file
    try {
      fs.unlinkSync(path.join(__dirname, 'test-output.json'));
    } catch {}
  }
}

// Generate summary report
console.log('\n' + '═'.repeat(60));
console.log('📊 TEST SUMMARY');
console.log('═'.repeat(60) + '\n');

const totalTests = results.reduce((sum, r) => sum + (r.tests || 0), 0);
const totalFailures = results.reduce((sum, r) => sum + (r.failures || 0), 0);
const passedCategories = results.filter(r => r.passed).length;

// Display results table
console.log('Category                Tests    Status    Coverage');
console.log('─'.repeat(60));

for (const result of results) {
  const status = result.passed ? '✅ PASS' : '❌ FAIL';
  const tests = result.tests ? `${result.tests - (result.failures || 0)}/${result.tests}` : 'N/A';
  const coverage = result.coverage ? `${result.coverage.lines}%` : 'N/A';

  console.log(
    `${result.category.padEnd(20)} ${tests.padEnd(8)} ${status.padEnd(10)} ${coverage}`
  );
}

console.log('\n' + '─'.repeat(60));
console.log(`\n📈 Overall Statistics:`);
console.log(`   Categories: ${passedCategories}/${testCategories.length} passed`);
console.log(`   Tests: ${totalTests - totalFailures}/${totalTests} passed`);
console.log(`   Success Rate: ${Math.round(((totalTests - totalFailures) / totalTests) * 100)}%`);

// Generate detailed report file
const reportPath = path.join(__dirname, 'test-report.md');
generateMarkdownReport(results, reportPath);

console.log(`\n📄 Detailed report saved to: ${reportPath}`);

// Exit with appropriate code
const allPassed = results.every(r => r.passed);
console.log('\n' + '═'.repeat(60));

if (allPassed) {
  console.log('🎉 ALL SDK UNIT TESTS PASSED! 🎉');
  console.log('The SDK is fully tested and ready for integration.');
} else {
  console.log('⚠️ Some tests failed. Please review the errors above.');
  process.exit(1);
}

console.log('═'.repeat(60) + '\n');

// Helper functions
function calculateCoverage(coverageMap: any, metric: string): number {
  let covered = 0;
  let total = 0;

  for (const file in coverageMap) {
    const fileCoverage = coverageMap[file];
    const metricData = fileCoverage[metric];

    if (metricData) {
      covered += metricData.covered || 0;
      total += metricData.total || 0;
    }
  }

  return total > 0 ? Math.round((covered / total) * 100) : 0;
}

function generateMarkdownReport(results: TestResult[], outputPath: string) {
  let markdown = '# SDK Unit Test Report\n\n';
  markdown += `Generated: ${new Date().toISOString()}\n\n`;

  markdown += '## Summary\n\n';
  markdown += '| Category | Tests | Status | Duration | Coverage |\n';
  markdown += '|----------|-------|--------|----------|----------|\n';

  for (const result of results) {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    const tests = result.tests ? `${result.tests - (result.failures || 0)}/${result.tests}` : 'N/A';
    const duration = result.duration ? `${result.duration}s` : 'N/A';
    const coverage = result.coverage ?
      `L:${result.coverage.lines}% B:${result.coverage.branches}%` : 'N/A';

    markdown += `| ${result.category} | ${tests} | ${status} | ${duration} | ${coverage} |\n`;
  }

  markdown += '\n## Details\n\n';

  for (const result of results) {
    markdown += `### ${result.category}\n\n`;

    if (result.passed) {
      markdown += `- ✅ All tests passed\n`;
      markdown += `- Tests: ${result.tests}\n`;
      markdown += `- Duration: ${result.duration}s\n`;

      if (result.coverage) {
        markdown += `- Coverage:\n`;
        markdown += `  - Statements: ${result.coverage.statements}%\n`;
        markdown += `  - Branches: ${result.coverage.branches}%\n`;
        markdown += `  - Functions: ${result.coverage.functions}%\n`;
        markdown += `  - Lines: ${result.coverage.lines}%\n`;
      }
    } else {
      markdown += `- ❌ Tests failed\n`;

      if (result.failures) {
        markdown += `- Failures: ${result.failures}\n`;
      }

      if (result.error) {
        markdown += `- Error: ${result.error}\n`;
      }
    }

    markdown += '\n';
  }

  fs.writeFileSync(outputPath, markdown, 'utf8');
}