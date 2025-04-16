import { parseM3u8 } from '../../src/utils/m3u8Parser';

describe('M3U8 Parser', () => {
    const sampleM3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment1.ts
#EXTINF:10.0,
segment2.ts
#EXTINF:10.0,
segment3.ts
#EXT-X-ENDLIST`;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.clearAllMocks();
    });

    it('should parse valid M3U8 content', () => {
        const result = parseM3u8(sampleM3u8, '/live/channel1/playlist.m3u8', 'channel1');
        
        expect(result).not.toBeNull();
        if (result) {
            expect(result.m3u8Uri).toBe('/live/channel1/playlist.m3u8');
            expect(result.targetDuration).toBe(10);
            expect(result.segments.size).toBe(3);
            expect(result.channelId).toBe('channel1');

            // Check segment details
            const segment1 = result.segments.get('segment1.ts');
            expect(segment1).toBeDefined();
            if (segment1) {
                expect(segment1.uri).toBe('segment1.ts');
                expect(segment1.duration).toBe(10.0);
                expect(segment1.received).toBe(false);
            }
        }
    });

    it('should handle invalid M3U8 content that contains a segment', () => {
        const invalidM3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXTINF:10.0,
segment1.ts`;

        const result = parseM3u8(invalidM3u8, '/live/channel1/playlist.m3u8', 'channel1');
        expect(result).not.toBeNull();
        if (result) {
            expect(result.segments.size).toBe(1);
            expect(result.segments.has('segment1.ts')).toBeTruthy();
        }
    });

    it('should handle M3U8 with comments and empty lines', () => {
        const m3u8WithComments = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10

# This is a comment
#EXTINF:10.0,
segment1.ts

# Another comment
#EXTINF:10.0,
segment2.ts
#EXT-X-ENDLIST`;

        const result = parseM3u8(m3u8WithComments, '/live/channel1/playlist.m3u8', 'channel1');
        expect(result).not.toBeNull();
        if (result) {
            expect(result.segments.size).toBe(2);
        }
    });
}); 