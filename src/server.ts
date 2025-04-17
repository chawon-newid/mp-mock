import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { M3u8TrackingInfo } from './types';
import { M3u8Handler } from './handlers/m3u8Handler';
import { SegmentHandler } from './handlers/segmentHandler';
import { ReportGenerator } from './utils/reportGenerator';
import logger from './utils/logger';

// Configuration
const config = {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
    mockStoragePath: path.join(__dirname, '..', 'mock_storage'),
    segmentArrivalTimeoutBufferMs: 2000, // 2 seconds buffer
};

const storagePath = path.join(__dirname, '..', 'mock_storage');

// Ensure storage directory exists
if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath, { recursive: true });
}

// Initialize stream tracker
const streamTracker: Map<string, M3u8TrackingInfo> = new Map();

// Initialize handlers
const m3u8Handler = new M3u8Handler(
    streamTracker,
    config.mockStoragePath,
    config.segmentArrivalTimeoutBufferMs,
    logger
);

const segmentHandler = new SegmentHandler(
    streamTracker,
    config.mockStoragePath,
    logger
);

// Initialize report generator
const reportGenerator = new ReportGenerator(config.mockStoragePath, streamTracker, logger);

// Create Express app
const app = express();

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
app.put('/in/v2/:channelId/:channelId/channel', (req: Request, res: Response) => {
    logger.debug(`MediaPackage v2 handler triggered for: ${req.originalUrl}, channelId: ${req.params.channelId}`);
    m3u8Handler.handlePut(req, res);
});

// Add route handlers for segments under MediaPackage v2 style paths
app.put('/in/v2/:channelId/:channelId/:segmentPath(*)', (req: Request, res: Response) => {
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
    const filePath = path.join(config.mockStoragePath, req.params.channelId, req.params[0]);
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

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled error:', err);
    res.status(500).send('Internal Server Error');
});

// Start server
app.listen(config.port, '0.0.0.0', () => {
    logger.info(`MediaPackage Mock Server listening on port ${config.port}`);
    logger.info(`Storing received files in: ${config.mockStoragePath}`);
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
    logger.info(`Server is accessible from: http://${serverIp}:${config.port}`);
}); 