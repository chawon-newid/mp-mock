import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';

const storagePath = path.join(__dirname, '..', '..', 'mock_storage');
const logFilePath = path.join(storagePath, 'server.log');

// Ensure storage directory exists
if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
}

// Check if we're in a test environment
const isTest = process.env.NODE_ENV === 'test';

// Create a different logger configuration for test environment
const logger = isTest ? 
    // Simple console logger for tests
    winston.createLogger({
        level: 'debug',
        transports: [
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.timestamp(),
                    winston.format.simple()
                )
            })
        ]
    }) : 
    // Full logger for production
    winston.createLogger({
        level: process.env.LOG_LEVEL || 'info', // Default to 'info', can be configured via env var
        format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.errors({ stack: true }), // Log stack traces for errors
            winston.format.splat(),
            winston.format.printf(({ timestamp, level, message, stack }) => {
                return `[${timestamp}] [${level.toUpperCase()}] ${stack || message}`;
            })
        ),
        transports: [
            // Log to console
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(), // Add colors to console output
                    winston.format.printf(({ timestamp, level, message, stack }) => {
                        return `[${timestamp}] [${level}] ${stack || message}`;
                    })
                )
            }),
            // Log to file
            new winston.transports.File({
                filename: logFilePath,
                maxsize: 5 * 1024 * 1024, // 5MB max size
                maxFiles: 5, // Keep up to 5 log files
                tailable: true,
                format: winston.format.printf(({ timestamp, level, message, stack }) => {
                    // File logs don't need color codes
                    return `[${timestamp}] [${level.toUpperCase()}] ${stack || message}`;
                })
            })
        ],
        exceptionHandlers: [
            // Handle uncaught exceptions
            new winston.transports.File({ filename: path.join(storagePath, 'exceptions.log') })
        ],
        rejectionHandlers: [
            // Handle unhandled promise rejections
            new winston.transports.File({ filename: path.join(storagePath, 'rejections.log') })
        ],
        exitOnError: false // Do not exit on handled exceptions
    });

export default logger; 