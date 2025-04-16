import { Request } from 'express';

export interface SegmentInfo {
    uri: string;
    duration: number;
    received: boolean;
    receivedAt?: number;
    size?: number;
    firstSeenAt?: number;
    timeoutOccurred?: boolean;
}

export interface M3u8TrackingInfo {
    m3u8Uri: string;
    targetDuration: number;
    segments: Map<string, SegmentInfo>;
    allSegmentsReceived: boolean;
    receivedAt: number;
    channelId: string;
    timeoutId?: NodeJS.Timeout;
    lastSegmentReceivedTime: number;
    segmentArrivalTimeoutBufferMs: number;
    previousM3u8Updates: number[];  // Array of timestamps for previous M3U8 updates
    timeoutEvents: number;          // Count of timeout events for this M3U8
    successiveTimeouts: number;     // Count of successive timeout events
    maxSuccessiveTimeouts: number;  // Maximum number of successive timeouts observed
    segmentArrivalIntervals: number[]; // Array of intervals between segment arrivals (for jitter calculation)
}

declare module 'express' {
    interface Request {
        rawBody?: Buffer;
    }
} 