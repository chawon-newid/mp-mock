import { Request, Response } from 'express';
import { M3u8TrackingInfo } from '../types';
import path from 'path';
import fs from 'fs';
import { Logger } from 'winston';
import logger from '../utils/logger';

export class SegmentHandler {
    private streamTracker: Map<string, M3u8TrackingInfo>;
    private mockStoragePath: string;
    private logger: Logger;

    constructor(streamTracker: Map<string, M3u8TrackingInfo>, mockStoragePath: string, loggerInstance: Logger) {
        this.streamTracker = streamTracker;
        this.mockStoragePath = mockStoragePath;
        this.logger = loggerInstance || logger;
    }

    public handlePut = (req: Request, res: Response): void => {
        const channelId = req.params.channelId;
        const fullPath = req.path;
        
        this.logger.debug(`Full path: ${fullPath}`);
        this.logger.debug(`Channel ID: ${channelId}`);
        this.logger.debug(`Original URL: ${req.originalUrl}`);
        this.logger.debug(`Request params: ${JSON.stringify(req.params)}`);
        
        // 세그먼트 상대 경로 추출 - MediaPackage v2 스타일과 일반 스타일 모두 지원
        let segmentUriRelative = '';
        
        if (fullPath.startsWith('/in/v2/')) {
            // MediaPackage v2 스타일 URL: /in/v2/{channelId}/{channelId}/{segmentPath}
            if (req.params.segmentPath) {
                segmentUriRelative = req.params.segmentPath;
                this.logger.debug(`MediaPackage v2 style path detected, segment path: ${segmentUriRelative}`);
            } else {
                // segmentPath 매개변수가 없는 경우 (채널 엔드포인트인 경우)
                this.logger.error(`MediaPackage v2 style URL without segment path: ${fullPath}`);
                res.status(400).send('Bad Request: Missing segment path');
                return;
            }
        } else {
            // 기존 스타일 URL: /live/{channelId}/{segmentPath}
            const segmentPathRegex = new RegExp(`^/live/${channelId}/(.+)$`);
            const match = fullPath.match(segmentPathRegex);
            segmentUriRelative = match ? match[1] : '';
            this.logger.debug(`Standard style path detected, segment path: ${segmentUriRelative}`);
        }
        
        if (!segmentUriRelative) {
            this.logger.error(`Could not extract segment path from URL: ${fullPath}`);
            res.status(400).send('Bad Request: Could not determine segment path');
            return;
        }
        
        this.logger.debug(`Final segment relative path: ${segmentUriRelative}`);
        
        const rawBody = (req as any).rawBody;

        if (!rawBody) {
            this.logger.error(`[${channelId}] Received PUT for ${fullPath} but no body found.`);
            res.status(400).send('Bad Request: Missing body');
            return;
        }

        this.logger.info(`[${channelId}] Received PUT for TS: ${fullPath} (${rawBody.length} bytes)`);

        // Store the TS file
        const filePath = path.join(this.mockStoragePath, channelId, segmentUriRelative);
        this.logger.debug(`Storing file at: ${filePath}`);
        
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, rawBody);
            this.logger.debug(`Successfully wrote file to: ${filePath}`);
        } catch (error) {
            this.logger.error(`[${channelId}] Failed to write segment file to ${filePath}`, error);
            res.status(500).send('Internal Server Error: Failed to write file');
            return;
        }

        // Find and update the corresponding M3U8 tracking info
        let foundSegment = false;
        for (const [m3u8Key, trackingInfo] of this.streamTracker.entries()) {
            if (trackingInfo.channelId === channelId && 
                !trackingInfo.allSegmentsReceived && 
                trackingInfo.segments.has(segmentUriRelative)) {
                
                const segmentInfo = trackingInfo.segments.get(segmentUriRelative);
                if (segmentInfo && !segmentInfo.received) {
                    const now = Date.now();
                    
                    // Calculate transfer delay (time from appearing in playlist to reception)
                    const transferDelay = now - (segmentInfo.firstSeenAt || now);
                    this.logger.debug(`[${channelId}] Segment ${segmentUriRelative} transfer delay: ${transferDelay}ms`);
                    
                    // Update segment info
                    segmentInfo.received = true;
                    segmentInfo.receivedAt = now;
                    segmentInfo.size = rawBody.length;
                    
                    // Reset successive timeouts counter since we received a segment
                    trackingInfo.successiveTimeouts = 0;
                    
                    // Update last segment received time for this M3U8
                    const previousTime = trackingInfo.lastSegmentReceivedTime;
                    trackingInfo.lastSegmentReceivedTime = now;
                    
                    // Calculate and store segment arrival interval for jitter calculation
                    if (previousTime > 0) {
                        const arrivalInterval = now - previousTime;
                        // Store in segment info for reporting
                        // We use this array in calculateStreamMetrics for jitter calculation
                        if (!trackingInfo.segmentArrivalIntervals) {
                            trackingInfo.segmentArrivalIntervals = [];
                        }
                        trackingInfo.segmentArrivalIntervals.push(arrivalInterval);
                        // Keep only last 20 intervals to avoid memory growth
                        if (trackingInfo.segmentArrivalIntervals.length > 20) {
                            trackingInfo.segmentArrivalIntervals.shift();
                        }
                    }
                    
                    this.logger.info(`[${channelId}] Marked segment ${segmentUriRelative} as received for M3U8 ${trackingInfo.m3u8Uri}.`);
                    foundSegment = true;
                    
                    // Check if all segments are now received
                    let allReceivedForM3u8 = true;
                    for (const segInfo of trackingInfo.segments.values()) {
                        if (!segInfo.received) {
                            allReceivedForM3u8 = false;
                            break;
                        }
                    }
                    
                    if (allReceivedForM3u8) {
                        this.logger.info(`[${channelId}] All segments for ${trackingInfo.m3u8Uri} received.`);
                        trackingInfo.allSegmentsReceived = true;
                        if (trackingInfo.timeoutId) {
                            clearTimeout(trackingInfo.timeoutId);
                            trackingInfo.timeoutId = undefined;
                            this.logger.debug(`Cleared timeout for ${m3u8Key} as all segments received.`);
                        }
                    }
                    break;
                }
            }
        }

        if (!foundSegment) {
            this.logger.warn(`[${channelId}] Received TS segment ${segmentUriRelative} but it was not expected or already timed out/completed.`);
        }

        res.status(200).send('OK');
    };
} 