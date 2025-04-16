export interface SegmentInfo {
    uri: string;
    duration: number; // From #EXTINF
    received: boolean;
    receivedAt?: number; // Timestamp when received
}

export interface M3u8TrackingInfo {
    m3u8Uri: string;
    receivedAt: number;
    targetDuration: number; // #EXT-X-TARGETDURATION in seconds
    segments: Map<string, SegmentInfo>; // Keyed by segment URI
    timeoutId?: NodeJS.Timeout;
    allSegmentsReceived: boolean;
    channelId: string; // Extracted from URL
    lastSegmentReceivedTime: number;
    segmentArrivalTimeoutBufferMs: number;
}

export interface Config {
    port: number;
    mockStoragePath: string;
    segmentArrivalTimeoutBufferMs: number;
} 