import { M3u8TrackingInfo, SegmentInfo } from '../types';

export function parseM3u8(content: string, m3u8Uri: string, channelId: string): M3u8TrackingInfo | null {
    const lines = content.split('\n');
    let targetDuration = 10; // Default target duration for master playlists
    const segments = new Map<string, SegmentInfo>();
    let isMasterPlaylist = false;
    const now = Date.now();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
            isMasterPlaylist = true;
            const variantUri = lines[i + 1].trim();
            if (variantUri) {
                segments.set(variantUri, {
                    uri: variantUri,
                    duration: targetDuration,
                    received: false,
                    firstSeenAt: now
                });
            }
            i++; // Skip the next line as we've already processed it
        } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
            targetDuration = parseInt(line.split(':')[1], 10);
        } else if (line.startsWith('#EXTINF:')) {
            const duration = parseFloat(line.split(':')[1].split(',')[0]);
            const segmentUri = lines[i + 1].trim();
            segments.set(segmentUri, {
                uri: segmentUri,
                duration,
                received: false,
                firstSeenAt: now
            });
            i++; // Skip the next line as we've already processed it
        }
    }

    if (segments.size === 0) {
        return null;
    }

    return {
        m3u8Uri,
        targetDuration,
        segments,
        channelId,
        allSegmentsReceived: false,
        lastSegmentReceivedTime: now,
        segmentArrivalTimeoutBufferMs: 2000,
        receivedAt: now,
        previousM3u8Updates: [now],
        timeoutEvents: 0,
        successiveTimeouts: 0,
        maxSuccessiveTimeouts: 0,
        segmentArrivalIntervals: []
    };
} 