import winston from 'winston';
import fs from 'fs';
import path from 'path';
import { ConfigLoader } from './configLoader';

// Ensure the storage directory exists
const logsDir = './logs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const configLoader = ConfigLoader.getInstance();
const serverConfig = configLoader.getServerConfig();

// Configure the logger
const logger = winston.createLogger({
  level: serverConfig.logLevel || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'mediapackage-mock' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp }) => {
          return `${timestamp} ${level}: ${message}`;
        })
      ),
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log') 
    }),
  ],
});

// Function to reload logger configuration
export function reloadLoggerConfig() {
  const refreshedConfig = configLoader.reloadConfig();
  const logLevel = refreshedConfig.server.logLevel || 'info';
  
  logger.level = logLevel;
  logger.info(`Logger configuration reloaded. Log level set to: ${logLevel}`);
}

export default logger; 