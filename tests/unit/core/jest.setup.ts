// Jest setup file for Core module tests

// Mock the logger module globally
jest.mock('@tri-protocol/logger', () => {
    const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        trace: jest.fn(),
        fatal: jest.fn(),
        child: jest.fn().mockReturnThis()
    };

    return {
        Logger: {
            getLogger: jest.fn(() => mockLogger)
        },
        LoggerManager: {
            getLogger: jest.fn(() => mockLogger),
            getInstance: jest.fn(() => ({
                getLogger: jest.fn(() => mockLogger)
            }))
        }
    };
});

// Mock the file-based logger path
jest.mock('../../../logger', () => {
    const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        trace: jest.fn(),
        fatal: jest.fn(),
        child: jest.fn().mockReturnThis()
    };

    return {
        Logger: {
            getLogger: jest.fn(() => mockLogger)
        },
        LoggerManager: {
            getLogger: jest.fn(() => mockLogger),
            getInstance: jest.fn(() => ({
                getLogger: jest.fn(() => mockLogger)
            }))
        }
    };
});

// Also mock using the relative path
jest.mock('../../logger', () => {
    const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        trace: jest.fn(),
        fatal: jest.fn(),
        child: jest.fn().mockReturnThis()
    };

    return {
        Logger: {
            getLogger: jest.fn(() => mockLogger)
        },
        LoggerManager: {
            getLogger: jest.fn(() => mockLogger),
            getInstance: jest.fn(() => ({
                getLogger: jest.fn(() => mockLogger)
            }))
        }
    };
});