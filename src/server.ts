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

// Start real-time report generation
const REPORT_INTERVAL_MS = 5000; // 5 seconds
setInterval(() => {
    reportGenerator.saveReport(`realtime_report_${Date.now()}.txt`);
}, REPORT_INTERVAL_MS);

// Middleware to get raw body for PUT requests
app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'PUT') {
        const data: Buffer[] = [];
        req.on('data', chunk => {
            data.push(chunk);
        });
        req.on('end', () => {
            (req as any).rawBody = Buffer.concat(data);
            logger.http(`[${req.method}] ${req.path} - Body length: ${(req as any).rawBody?.length || 0}`);
            next();
        });
    } else {
        next();
    }
});

// Log all requests
app.use((req: Request, res: Response, next: NextFunction) => {
    logger.http(`[${req.method}] ${req.path} - Headers: ${JSON.stringify(req.headers)}`);
    next();
});

// Route handlers
app.put('/live/:channelId/', (req: Request, res: Response) => {
    m3u8Handler.handlePut(req, res);
});

app.put('/live/:channelId/*.ts', (req: Request, res: Response) => {
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