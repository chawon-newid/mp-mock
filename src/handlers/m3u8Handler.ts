import { Request, Response } from 'express';
import { M3u8TrackingInfo, SegmentInfo } from '../types';
import path from 'path';
import fs from 'fs';
import { parseM3u8 } from '../utils/m3u8Parser';
import axios from 'axios';
import { Logger } from 'winston';
import logger from '../utils/logger';

export class M3u8Handler {
    private streamTracker: Map<string, M3u8TrackingInfo>;
    private mockStoragePath: string;
    private segmentArrivalTimeoutBufferMs: number;
    private logger: Logger;

    constructor(
        streamTracker: Map<string, M3u8TrackingInfo>,
        mockStoragePath: string,
        segmentArrivalTimeoutBufferMs: number,
        loggerInstance?: Logger
    ) {
        this.streamTracker = streamTracker;
        this.mockStoragePath = mockStoragePath;
        this.segmentArrivalTimeoutBufferMs = segmentArrivalTimeoutBufferMs;
        this.logger = loggerInstance || logger;
    }

    private checkSegmentArrival = (m3u8Key: string): void => {
        const trackingInfo = this.streamTracker.get(m3u8Key);
        if (!trackingInfo || trackingInfo.allSegmentsReceived) {
            return;
        }

        const now = Date.now();
        let allReceived = true;
        const missingSegments: string[] = [];

        this.logger.info(`[${trackingInfo.channelId}] Timeout check for M3U8: ${trackingInfo.m3u8Uri}`);

        for (const [segmentUri, segmentInfo] of trackingInfo.segments.entries()) {
            if (!segmentInfo.received) {
                allReceived = false;
                missingSegments.push(segmentUri);
                // Mark segment as timed out for metrics
                segmentInfo.timeoutOccurred = true;
                // Increment timeout counters
                trackingInfo.timeoutEvents++;
                trackingInfo.successiveTimeouts++;
                // Update max successive timeouts if needed
                if (trackingInfo.successiveTimeouts > trackingInfo.maxSuccessiveTimeouts) {
                    trackingInfo.maxSuccessiveTimeouts = trackingInfo.successiveTimeouts;
                }
            }
        }

        if (allReceived) {
            this.logger.info(`[${trackingInfo.channelId}] OK: All ${trackingInfo.segments.size} segments for ${trackingInfo.m3u8Uri} received.`);
            trackingInfo.allSegmentsReceived = true;
            // Reset successive timeouts counter on success
            trackingInfo.successiveTimeouts = 0;
        } else {
            this.logger.warn(`[${trackingInfo.channelId}] TIMEOUT: Missing ${missingSegments.length} segment(s) for ${trackingInfo.m3u8Uri}: ${missingSegments.join(', ')}`);
        }

        trackingInfo.timeoutId = undefined;
    };

    private async fetchM3u8Content(url: string): Promise<string> {
        try {
            this.logger.debug(`Fetching M3U8 content from URL: ${url}`);
            const response = await axios.get<string>(url);
            this.logger.debug(`Response status: ${response.status}`);
            this.logger.debug(`Response headers:`, response.headers);
            this.logger.debug(`Response data length: ${response.data.length}`);
            return response.data;
        } catch (error) {
            this.logger.error(`Failed to fetch M3U8 content from ${url}`, error);
            throw error;
        }
    }

    public handlePut = async (req: Request, res: Response): Promise<void> => {
        const channelId = req.params.channelId;
        const m3u8Uri = req.path;
        
        // 경로가 '/live/:channelId/' 형식이므로 기본 파일 이름을 'playlist.m3u8'로 설정
        let filename = path.basename(m3u8Uri);
        if (!filename) {
            filename = 'playlist.m3u8';
        }
        
        const m3u8Key = `${channelId}/${filename}`;
        const rawBody = (req as any).rawBody;

        this.logger.debug(`WebDAV PUT request received for ${m3u8Uri}`);
        this.logger.debug(`Request headers:`, req.headers);
        this.logger.debug(`Request params:`, req.params);
        this.logger.debug(`Request body length:`, rawBody?.length);

        if (!rawBody) {
            this.logger.error(`Received PUT for ${m3u8Uri} but no body found.`);
            res.status(400).send('Bad Request: Missing body');
            return;
        }

        let m3u8Content: string;
        try {
            const bodyContent = rawBody.toString('utf-8');
            this.logger.debug(`Request body content:`, bodyContent);

            if (bodyContent.startsWith('http://') || bodyContent.startsWith('https://')) {
                this.logger.debug(`Detected URL in request body, fetching content...`);
                m3u8Content = await this.fetchM3u8Content(bodyContent);
                this.logger.debug(`Successfully fetched M3U8 content length: ${m3u8Content?.length}`);
            } else {
                m3u8Content = bodyContent;
                this.logger.debug(`Using direct M3U8 content length: ${m3u8Content?.length}`);
            }
        } catch (error) {
            this.logger.error(`Failed to get M3U8 content:`, error);
            res.status(500).send('Internal Server Error: Failed to get M3U8 content');
            return;
        }

        // Store the M3U8 file
        const filePath = path.join(this.mockStoragePath, channelId, filename);
        this.logger.debug(`Storing M3U8 file at: ${filePath}`);
        try {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, m3u8Content);
        } catch (error) {
            this.logger.error(`Failed to write M3U8 file to ${filePath}`, error);
            res.status(500).send('Internal Server Error: Failed to write file');
            return;
        }

        // Parse M3U8 content and update tracking info
        try {
            const parsedData = parseM3u8(m3u8Content, m3u8Uri, channelId);
            this.logger.debug(`Parsed M3U8 data:`, parsedData);
            if (parsedData) {
                const now = Date.now();
                
                // Check if we already have tracking info for this M3U8
                const existingTrackingInfo = this.streamTracker.get(m3u8Key);
                const previousM3u8Updates = existingTrackingInfo 
                    ? [now, ...existingTrackingInfo.previousM3u8Updates] 
                    : [now];
                    
                // Limit the array size to prevent memory growth
                if (previousM3u8Updates.length > 20) {
                    previousM3u8Updates.length = 20;
                }
                
                // Create or update tracking info
                const trackingInfo: M3u8TrackingInfo = {
                    m3u8Uri: m3u8Uri,
                    targetDuration: parsedData.targetDuration,
                    segments: new Map(),
                    allSegmentsReceived: parsedData.allSegmentsReceived,
                    receivedAt: now,
                    channelId: channelId,
                    lastSegmentReceivedTime: existingTrackingInfo?.lastSegmentReceivedTime || now,
                    segmentArrivalTimeoutBufferMs: this.segmentArrivalTimeoutBufferMs,
                    timeoutId: undefined,
                    previousM3u8Updates: previousM3u8Updates,
                    timeoutEvents: existingTrackingInfo?.timeoutEvents || 0,
                    successiveTimeouts: existingTrackingInfo?.successiveTimeouts || 0,
                    maxSuccessiveTimeouts: existingTrackingInfo?.maxSuccessiveTimeouts || 0,
                    segmentArrivalIntervals: existingTrackingInfo?.segmentArrivalIntervals || []
                };
                
                // Process segments from the parsed data
                // We need to preserve existing segment info for metrics
                for (const [segmentUri, parsedSegment] of parsedData.segments.entries()) {
                    const existingSegment = existingTrackingInfo?.segments.get(segmentUri);
                    
                    const segmentInfo: SegmentInfo = {
                        uri: parsedSegment.uri,
                        duration: parsedSegment.duration,
                        received: existingSegment?.received || false,
                        receivedAt: existingSegment?.receivedAt,
                        size: existingSegment?.size,
                        firstSeenAt: existingSegment?.firstSeenAt || now,
                        timeoutOccurred: existingSegment?.timeoutOccurred || false
                    };
                    
                    trackingInfo.segments.set(segmentUri, segmentInfo);
                }

                // Clear existing timeout if any (e.g., if M3U8 is updated)
                if (existingTrackingInfo?.timeoutId) {
                    clearTimeout(existingTrackingInfo.timeoutId);
                    this.logger.debug(`Cleared existing timeout for ${m3u8Key}`);
                }

                // Set timeout check only if segments are expected
                if (!trackingInfo.allSegmentsReceived && trackingInfo.segments.size > 0) {
                    const deadline = now + (trackingInfo.targetDuration * 1000) + this.segmentArrivalTimeoutBufferMs;
                    trackingInfo.timeoutId = setTimeout(() => this.checkSegmentArrival(m3u8Key), deadline - now);
                    this.logger.info(`Set segment arrival timeout for ${m3u8Key} (${deadline - now}ms)`);
                }

                this.streamTracker.set(m3u8Key, trackingInfo);
                this.logger.debug(`Updated streamTracker for ${m3u8Key}`);
            } else {
                this.logger.warn(`Could not parse M3U8 content for ${m3u8Uri}`);
            }
        } catch (error) {
            this.logger.error(`Failed to parse M3U8 or update tracker for ${m3u8Uri}`, error);
            // Decide if we should send 500 or if partial success is okay
            // Let's assume parsing failure means we can't proceed reliably
            res.status(500).send('Internal Server Error: Failed to parse M3U8');
            return;
        }

        res.status(200).send('OK');
    };
} 