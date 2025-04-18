import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { M3u8TrackingInfo } from './types';
import { M3u8Handler } from './handlers/m3u8Handler';
import { SegmentHandler } from './handlers/segmentHandler';
import { ReportGenerator } from './utils/reportGenerator';
import { CleanupManager } from './utils/cleanupManager';
import logger from './utils/logger';
import { ConfigLoader } from './utils/configLoader';
import { reloadLoggerConfig } from './utils/logger';

// Load configuration
const configLoader = ConfigLoader.getInstance();
const serverConfig = configLoader.getServerConfig();
const storageConfig = configLoader.getStorageConfig();
const streamingConfig = configLoader.getStreamingConfig();
const cleanupConfig = configLoader.getCleanupConfig();
const reportsConfig = configLoader.getReportsConfig();

const storagePath = storageConfig.path;

// Ensure storage directory exists
if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
}

// Initialize stream tracker
const streamTracker: Map<string, M3u8TrackingInfo> = new Map();

// Initialize handlers
const m3u8Handler = new M3u8Handler(
    streamTracker,
    storagePath,
    streamingConfig.segmentTimeout,
    logger
);

const segmentHandler = new SegmentHandler(
    streamTracker,
    storagePath,
    logger
);

// Initialize report generator
const reportGenerator = new ReportGenerator(storagePath, streamTracker, logger);

// Initialize cleanup manager
const cleanupManager = new CleanupManager(
    storagePath,
    {
        isEnabled: cleanupConfig.enabled,
        retentionPeriodMs: cleanupConfig.retentionPeriodHours * 60 * 60 * 1000, // Convert hours to ms
        cleanupIntervalMs: cleanupConfig.intervalMinutes * 60 * 1000, // Convert minutes to ms
        loggerInstance: logger
    }
);

// Create Express app
const app = express();

// 성능 보고서 자동 생성 (단일 파일에 누적 방식)
setInterval(() => {
    const reportPath = path.join(reportsConfig.path, 'performance_history.txt');
    reportGenerator.saveReport(reportPath);
}, reportsConfig.intervalMinutes * 60 * 1000); // Convert minutes to ms

// Middleware to get raw body for PUT requests
app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'PUT') {
        const data: Buffer[] = [];
        req.on('data', chunk => {
            data.push(chunk);
        });
        req.on('end', () => {
            (req as any).rawBody = Buffer.concat(data);
            logger.http(`[${req.method}] ${req.originalUrl} - Body length: ${(req as any).rawBody?.length || 0}`);
            next();
        });
    } else {
        next();
    }
});

// Log all requests
app.use((req: Request, res: Response, next: NextFunction) => {
    // 원래 URL과 경로 매개변수를 함께 로깅
    const requestInfo = {
        originalUrl: req.originalUrl,
        path: req.path,
        params: req.params,
        method: req.method
    };
    logger.debug(`Request info: ${JSON.stringify(requestInfo)}`);
    logger.http(`[${req.method}] ${req.originalUrl} - Headers: ${JSON.stringify(req.headers)}`);
    next();
});

// Route handlers - 경로 매칭 패턴 명확히 하기
app.put('/live/:channelId/', (req: Request, res: Response) => {
    logger.debug(`M3U8 handler triggered for: ${req.originalUrl}, channelId: ${req.params.channelId}`);
    m3u8Handler.handlePut(req, res);
});

// Add MediaPackage v2 style URL pattern support
app.put('/in/v2/:channelId/:redundantId/channel', (req: Request, res: Response) => {
    logger.debug(`M3U8 handler triggered for MediaPackage v2 style channel URL: ${req.originalUrl}`);
    logger.debug(`Channel ID: ${req.params.channelId}, Redundant ID: ${req.params.redundantId}`);
    logger.debug(`This is a playlist endpoint request (channel)`);
    
    // 트래킹 키 로깅 (디버깅용)
    const trackingKey = `${req.params.channelId}/playlist.m3u8`;
    logger.debug(`Expected tracking key for channel endpoint: ${trackingKey}`);
    
    m3u8Handler.handlePut(req, res);
});

// Add route handlers for segments under MediaPackage v2 style paths
app.put('/in/v2/:channelId/:redundantId/:segmentPath(*)', (req: Request, res: Response) => {
    logger.debug(`Request params for MediaPackage v2 style URL: ${JSON.stringify(req.params)}`);
    
    // 트래킹 키 생성 로직 (디버깅용)
    if (req.params.segmentPath.endsWith('.m3u8')) {
        const m3u8Filename = req.params.segmentPath;
        const baseFilename = m3u8Filename.replace(/\.[^.]+$/, '');
        const trackingKey = `${req.params.channelId}/${baseFilename}.m3u8`;
        logger.debug(`M3U8 request - expected tracking key: ${trackingKey}`);
    } else if (req.params.segmentPath.endsWith('.ts')) {
        const tsFilename = req.params.segmentPath;
        const tsFilenameWithoutExt = tsFilename.replace(/\.[^.]+$/, '');
        
        // 가능한 트래킹 키 패턴들 생성
        const possibleKeys = [];
        
        if (tsFilenameWithoutExt.includes('_')) {
            const segmentNameParts = tsFilenameWithoutExt.split('_');
            if (segmentNameParts.length >= 2) {
                // 마지막 숫자 부분 제거 (예: channel_845548_23 -> channel_845548)
                const baseNameWithoutNumber = segmentNameParts.slice(0, -1).join('_');
                possibleKeys.push(`${req.params.channelId}/${baseNameWithoutNumber}.m3u8`);
            }
        }
        
        logger.debug(`TS segment request - possible tracking keys: ${possibleKeys.join(', ')}`);
    }
    
    if (req.params.segmentPath.endsWith('.ts')) {
        logger.debug(`TS segment handler triggered for MediaPackage v2 style URL: ${req.originalUrl}`);
        segmentHandler.handlePut(req, res);
    } else if (req.params.segmentPath.endsWith('.m3u8')) {
        logger.debug(`M3U8 handler triggered for MediaPackage v2 style URL: ${req.originalUrl}`);
        m3u8Handler.handlePut(req, res);
    } else {
        logger.warn(`Unhandled file type for MediaPackage v2 style URL: ${req.originalUrl}`);
        res.status(400).send('Unsupported file type');
    }
});

// playlist.m3u8와 같은 형식의 URL도 지원
app.put('/live/:channelId/:filename([^/]+\\.m3u8)', (req: Request, res: Response) => {
    logger.debug(`M3U8 handler triggered for file: ${req.originalUrl}, channelId: ${req.params.channelId}, filename: ${req.params.filename}`);
    m3u8Handler.handlePut(req, res);
});

app.put('/live/:channelId/*.ts', (req: Request, res: Response) => {
    logger.debug(`Segment handler triggered for: ${req.originalUrl}`);
    segmentHandler.handlePut(req, res);
});

// Basic GET handler for root
app.get('/', (req: Request, res: Response) => {
    res.send('MediaPackage Mock Server is running.');
});

// GET handler for M3U8 and TS files
app.get('/live/:channelId/*', (req: Request, res: Response) => {
    const filePath = path.join(storagePath, req.params.channelId, req.params[0]);
    logger.info(`[GET] Serving file: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
        logger.warn(`[GET] File not found: ${filePath}`);
        return res.status(404).send('File not found');
    }

    const contentType = filePath.endsWith('.m3u8') 
        ? 'application/vnd.apple.mpegurl' 
        : 'video/mp2t';
    
    res.setHeader('Content-Type', contentType);
    res.sendFile(filePath);
});

// Report generation endpoint
app.get('/report', (req: Request, res: Response) => {
    const report = reportGenerator.generateReport();
    res.setHeader('Content-Type', 'text/plain');
    res.send(report);
});

// Add a log level configuration endpoint
app.post('/config/loglevel', (req: Request, res: Response) => {
    try {
        const newLogLevel = req.query.level as string;
        
        if (!newLogLevel) {
            return res.status(400).json({ error: 'Log level not provided', message: 'Please provide a log level as a query parameter' });
        }
        
        // Validate log level
        const validLogLevels = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
        if (!validLogLevels.includes(newLogLevel)) {
            return res.status(400).json({ 
                error: 'Invalid log level', 
                message: `Log level must be one of: ${validLogLevels.join(', ')}` 
            });
        }
        
        // Update log level in memory
        process.env.LOG_LEVEL = newLogLevel;
        
        // Reload logger configuration
        reloadLoggerConfig();
        
        logger.info(`Log level changed to: ${newLogLevel}`);
        return res.status(200).json({ success: true, message: `Log level set to: ${newLogLevel}` });
    } catch (error) {
        logger.error('Error updating log level:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).send('Internal Server Error');
});

// Start server
app.listen(serverConfig.port, '0.0.0.0', () => {
    logger.info(`MediaPackage Mock Server listening on port ${serverConfig.port}`);
    logger.info(`Storing received files in: ${storagePath}`);
    const interfaces = require('os').networkInterfaces();
    let serverIp = 'localhost';
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
            if (iface.family === 'IPv4' && !iface.internal) {
                serverIp = iface.address;
                break;
            }
        }
        if (serverIp !== 'localhost') break;
    }
    logger.info(`Server is accessible from: http://${serverIp}:${serverConfig.port}`);
    
    // 정리 작업 시작
    cleanupManager.start();
    if (cleanupConfig.enabled) {
        logger.info(`TS file cleanup enabled. Files will be kept for ${cleanupConfig.retentionPeriodHours} hours`);
    }
});

// 애플리케이션 종료 시 정리 작업 중지
process.on('SIGINT', () => {
    logger.info('Shutting down server...');
    cleanupManager.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down server...');
    cleanupManager.stop();
    process.exit(0);
}); 