import fs from 'fs';
import path from 'path';
import { M3u8TrackingInfo } from '../types';
import { Logger } from 'winston';
import logger from './logger';

export interface StreamMetrics {
    channelId: string;
    m3u8Uri: string;
    totalSegments: number;
    receivedSegments: number;
    missingSegments: number;
    averageSegmentSize: number;
    totalBytes: number;
    startTime: number;
    endTime: number;
    duration: number;
    bitrate: number;
    
    avgSegmentTransferDelay: number;   // Average time from playlist appearance to segment reception (ms)
    minSegmentTransferDelay: number;   // Minimum segment transfer delay (ms)
    maxSegmentTransferDelay: number;   // Maximum segment transfer delay (ms)
    m3u8UpdateInterval: number;        // Average time between M3U8 playlist updates (ms)
    lastM3u8UpdateTime: number;        // Timestamp of the last M3U8 update
    
    segmentArrivalJitter: number;      // Standard deviation of inter-segment arrival times (ms)
    timeoutEvents: number;             // Number of segment timeout events
    successiveTimeouts: number;        // Maximum number of successive timeout events
    segmentArrivalIntervals: number[]; // Array of intervals between segment arrivals (for jitter calculation)
}

export class ReportGenerator {
    private mockStoragePath: string;
    private streamTracker: Map<string, M3u8TrackingInfo>;
    private logger: Logger;

    constructor(mockStoragePath: string, streamTracker: Map<string, M3u8TrackingInfo>, loggerInstance?: Logger) {
        this.mockStoragePath = mockStoragePath;
        this.streamTracker = streamTracker;
        this.logger = loggerInstance || logger;
    }

    private calculateStreamMetrics(channelId: string, trackingInfo: M3u8TrackingInfo): StreamMetrics {
        const segments = Array.from(trackingInfo.segments.values());
        const receivedSegments = segments.filter(s => s.received);
        const totalBytes = receivedSegments.reduce((sum, seg) => sum + (seg.size || 0), 0);
        const startTime = receivedSegments.length > 0 ? Math.min(...receivedSegments.map(s => s.receivedAt || 0)) : 0;
        const endTime = receivedSegments.length > 0 ? Math.max(...receivedSegments.map(s => s.receivedAt || 0)) : 0;
        const duration = (endTime - startTime) / 1000; // in seconds
        const bitrate = duration > 0 ? (totalBytes * 8) / duration : 0; // in bits per second

        // Calculate latency metrics
        // Segment transfer delays (from appearing in playlist to receipt)
        const transferDelays = receivedSegments
            .filter(s => s.firstSeenAt !== undefined && s.receivedAt)
            .map(s => (s.receivedAt as number) - (s.firstSeenAt as number));
        
        const avgSegmentTransferDelay = transferDelays.length > 0
            ? transferDelays.reduce((sum, delay) => sum + delay, 0) / transferDelays.length
            : 0;
        
        const minSegmentTransferDelay = transferDelays.length > 0
            ? Math.min(...transferDelays)
            : 0;
            
        const maxSegmentTransferDelay = transferDelays.length > 0
            ? Math.max(...transferDelays)
            : 0;
        
        // Calculate M3U8 update interval
        const m3u8Updates = trackingInfo.previousM3u8Updates || [];
        const m3u8UpdateIntervals = [];
        
        for (let i = 0; i < m3u8Updates.length - 1; i++) {
            m3u8UpdateIntervals.push(m3u8Updates[i] - m3u8Updates[i + 1]);
        }
        
        const m3u8UpdateInterval = m3u8UpdateIntervals.length > 0
            ? m3u8UpdateIntervals.reduce((sum, interval) => sum + interval, 0) / m3u8UpdateIntervals.length
            : 0;
        
        const lastM3u8UpdateTime = m3u8Updates.length > 0 ? m3u8Updates[0] : 0;
        
        // Calculate reliability metrics
        // Segment arrival jitter (standard deviation of inter-segment arrival times)
        const arrivalIntervals = trackingInfo.segmentArrivalIntervals || [];
        let segmentArrivalJitter = 0;
        
        if (arrivalIntervals.length > 1) {
            const meanInterval = arrivalIntervals.reduce((sum, interval) => sum + interval, 0) / arrivalIntervals.length;
            const sumSquaredDifferences = arrivalIntervals.reduce((sum, interval) => {
                const diff = interval - meanInterval;
                return sum + (diff * diff);
            }, 0);
            // Standard deviation = sqrt(variance), where variance = sum of squared differences / count
            segmentArrivalJitter = Math.sqrt(sumSquaredDifferences / arrivalIntervals.length);
        }
        
        // For timeout events, use the values tracked in M3u8TrackingInfo
        const timeoutEvents = trackingInfo.timeoutEvents || 0;
        const successiveTimeouts = trackingInfo.maxSuccessiveTimeouts || 0;

        return {
            channelId,
            m3u8Uri: trackingInfo.m3u8Uri,
            totalSegments: segments.length,
            receivedSegments: receivedSegments.length,
            missingSegments: segments.length - receivedSegments.length,
            averageSegmentSize: receivedSegments.length > 0 ? totalBytes / receivedSegments.length : 0,
            totalBytes,
            startTime,
            endTime,
            duration,
            bitrate,
            
            // Latency metrics
            avgSegmentTransferDelay,
            minSegmentTransferDelay,
            maxSegmentTransferDelay,
            m3u8UpdateInterval,
            lastM3u8UpdateTime,
            
            // Reliability metrics
            segmentArrivalJitter,
            timeoutEvents,
            successiveTimeouts: successiveTimeouts,
            segmentArrivalIntervals: arrivalIntervals
        };
    }

    private formatBytes(bytes: number): string {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    private formatBitrate(bps: number): string {
        const units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
        let rate = bps;
        let unitIndex = 0;
        while (rate >= 1000 && unitIndex < units.length - 1) {
            rate /= 1000;
            unitIndex++;
        }
        return `${rate.toFixed(2)} ${units[unitIndex]}`;
    }

    public generateReport(): string {
        const metrics: StreamMetrics[] = [];
        let totalBytes = 0;
        let totalDuration = 0;
        const now = Date.now();

        for (const [key, trackingInfo] of this.streamTracker.entries()) {
            const metric = this.calculateStreamMetrics(trackingInfo.channelId, trackingInfo);
            metrics.push(metric);
            totalBytes += metric.totalBytes;
            totalDuration = Math.max(totalDuration, metric.duration);
        }

        const report = [
            '=== Stream Performance Report ===',
            `Generated at: ${new Date().toISOString()}`,
            `Total streams analyzed: ${metrics.length}`,
            `Total duration: ${totalDuration.toFixed(2)} seconds`,
            `Total data transferred: ${this.formatBytes(totalBytes)}`,
            `Average bitrate: ${this.formatBitrate((totalBytes * 8) / totalDuration)}`,
            '\n=== Individual Stream Metrics ===\n'
        ];

        metrics.forEach(metric => {
            const timeSinceLastSegment = metric.endTime ? (now - metric.endTime) / 1000 : 0;
            const segmentsPerSecond = metric.duration > 0 ? metric.receivedSegments / metric.duration : 0;
            const timeSinceLastM3u8 = metric.lastM3u8UpdateTime ? (now - metric.lastM3u8UpdateTime) / 1000 : 0;
            
            report.push(
                `Channel: ${metric.channelId}`,
                `M3U8 URI: ${metric.m3u8Uri}`,
                `Segments: ${metric.receivedSegments}/${metric.totalSegments} (${((metric.receivedSegments/metric.totalSegments)*100).toFixed(2)}% received)`,
                `Segments per second: ${segmentsPerSecond.toFixed(2)}`,
                `Time since last segment: ${timeSinceLastSegment.toFixed(2)} seconds`,
                `Average segment size: ${this.formatBytes(metric.averageSegmentSize)}`,
                `Total data: ${this.formatBytes(metric.totalBytes)}`,
                `Duration: ${metric.duration.toFixed(2)} seconds`,
                `Bitrate: ${this.formatBitrate(metric.bitrate)}`,
                // Add new latency metrics
                `\nLatency Metrics:`,
                `Avg segment transfer delay: ${metric.avgSegmentTransferDelay.toFixed(2)} ms`,
                `Min segment transfer delay: ${metric.minSegmentTransferDelay.toFixed(2)} ms`,
                `Max segment transfer delay: ${metric.maxSegmentTransferDelay.toFixed(2)} ms`,
                `M3U8 update interval: ${metric.m3u8UpdateInterval.toFixed(2)} ms`,
                `Time since last M3U8 update: ${timeSinceLastM3u8.toFixed(2)} seconds`,
                // Add new reliability metrics
                `\nReliability Metrics:`,
                `Segment arrival jitter: ${metric.segmentArrivalJitter.toFixed(2)} ms`,
                `Timeout events: ${metric.timeoutEvents}`,
                `Maximum successive timeouts: ${metric.successiveTimeouts}`,
                '---'
            );
        });

        return report.join('\n');
    }

    public saveReport(filename: string = 'performance_report.txt'): void {
        try {
            const report = this.generateReport();
            const reportPath = path.join(this.mockStoragePath, filename);
            fs.writeFileSync(reportPath, report);
            this.logger.info(`Performance report saved to: ${reportPath}`);
        } catch (error) {
            this.logger.error(`Failed to save performance report:`, error);
        }
    }
} 