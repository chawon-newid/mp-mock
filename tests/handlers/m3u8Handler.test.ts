import { M3u8Handler } from '../../src/handlers/m3u8Handler';
import { M3u8TrackingInfo } from '../../src/types';
import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

// Mock fs module
jest.mock('fs', () => ({
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
}));

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('M3U8 Handler', () => {
    let handler: M3u8Handler;
    let streamTracker: Map<string, M3u8TrackingInfo>;
    const mockStoragePath = '/mock/storage';
    const segmentArrivalTimeoutBufferMs = 2000;

    beforeEach(() => {
        streamTracker = new Map();
        handler = new M3u8Handler(streamTracker, mockStoragePath, segmentArrivalTimeoutBufferMs);
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.clearAllMocks();
        streamTracker.clear();
    });

    it('should handle valid M3U8 PUT request', async () => {
        const mockReq = {
            params: { channelId: 'channel1' },
            path: '/live/channel1/playlist.m3u8',
            method: 'PUT',
        };
        const req = mockReq as unknown as Request;
        const res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn(),
        } as unknown as Response;

        const m3u8Content = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment1.ts
#EXTINF:10.0,
segment2.ts
#EXT-X-ENDLIST`;

        (req as any).rawBody = Buffer.from(m3u8Content);

        await handler.handlePut(req, res);

        // Verify response
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('OK');

        // Verify file system operations
        expect(fs.mkdirSync).toHaveBeenCalled();
        expect(fs.writeFileSync).toHaveBeenCalled();

        // Verify stream tracker
        const trackingInfo = streamTracker.get('channel1/playlist.m3u8');
        expect(trackingInfo).toBeDefined();
        if (trackingInfo) {
            expect(trackingInfo.m3u8Uri).toBe('/live/channel1/playlist.m3u8');
            expect(trackingInfo.targetDuration).toBe(10);
            expect(trackingInfo.segments.size).toBe(2);
            expect(trackingInfo.allSegmentsReceived).toBe(false);
        }
    });

    it('should handle invalid M3U8 content', async () => {
        const mockReq = {
            params: { channelId: 'channel1' },
            path: '/live/channel1/playlist.m3u8',
            method: 'PUT',
        };
        const req = mockReq as unknown as Request;
        const res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn(),
        } as unknown as Response;

        const invalidM3u8Content = `#EXTM3U
#EXT-X-VERSION:3
Invalid content without any segments`;

        (req as any).rawBody = Buffer.from(invalidM3u8Content);

        await handler.handlePut(req, res);

        // Verify response
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('OK');

        // Verify file system operations still occurred
        expect(fs.mkdirSync).toHaveBeenCalled();
        expect(fs.writeFileSync).toHaveBeenCalled();

        // Verify stream tracker is empty
        expect(streamTracker.size).toBe(0);
    });

    it('should handle missing request body', async () => {
        const mockReq = {
            params: { channelId: 'channel1' },
            path: '/live/channel1/playlist.m3u8',
            method: 'PUT',
        };
        const req = mockReq as unknown as Request;
        const res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn(),
        } as unknown as Response;

        await handler.handlePut(req, res);

        // Verify error response
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.send).toHaveBeenCalledWith('Bad Request: Missing body');

        // Verify no file system operations
        expect(fs.mkdirSync).not.toHaveBeenCalled();
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle real M3U8 URL', async () => {
        const mockReq = {
            params: { channelId: 'channel1' },
            path: '/live/channel1/playlist.m3u8',
            method: 'PUT',
        };
        const req = mockReq as unknown as Request;
        const res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn(),
        } as unknown as Response;

        // Mock axios response with real M3U8 content
        const realM3u8Content = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-STREAM-INF:BANDWIDTH=9011200,CODECS="hvc1.1.4.L123.B01,mp4a.40.2",FRAME-RATE=30.00,RESOLUTION=1920x1080
index.m3u8?apikey=ed4ede75-fb21588a-98635595-219242bc&resolution=1920x1080&channelid=newid_332&targetplatform=samsung_tvplus&programid=1abdfcb9c7af784f5fabed71f3272fea34f21a34197
#EXT-X-STREAM-INF:BANDWIDTH=2010800,CODECS="hvc1.1.4.L93.B01,mp4a.40.2",FRAME-RATE=30.00,RESOLUTION=1280x720
index.m3u8?apikey=ed4ede75-fb21588a-98635595-219242bc&resolution=1280x720&channelid=newid_332&targetplatform=samsung_tvplus&programid=1abdfcb9c7af784f5fabed71f3272fea34f21a34197
#EXT-X-STREAM-INF:BANDWIDTH=1240800,CODECS="hvc1.1.4.L90.B01,mp4a.40.2",FRAME-RATE=30.00,RESOLUTION=960x540
index.m3u8?apikey=ed4ede75-fb21588a-98635595-219242bc&resolution=960x540&channelid=newid_332&targetplatform=samsung_tvplus&programid=1abdfcb9c7af784f5fabed71f3272fea34f21a34197
#EXT-X-STREAM-INF:BANDWIDTH=690800,CODECS="hvc1.1.4.L63.B01,mp4a.40.2",FRAME-RATE=30.00,RESOLUTION=640x360
index.m3u8?apikey=ed4ede75-fb21588a-98635595-219242bc&resolution=640x360&channelid=newid_332&targetplatform=samsung_tvplus&programid=1abdfcb9c7af784f5fabed71f3272fea34f21a34197`;

        mockedAxios.get.mockResolvedValue({
            data: realM3u8Content,
            status: 200,
            statusText: 'OK',
            headers: {},
            config: {} as any
        });

        // Set the M3U8 URL in the request body
        const m3u8Url = 'https://live-us-east-1.its-newid.net/live/newid_332/samsung_tvplus/index.m3u8?apikey=b97c7a7d0c82424bb607e141ef215779&auth=98fdd3cb-558cbe2b-30a2ef57-5e4509f4';
        (req as any).rawBody = Buffer.from(m3u8Url);

        await handler.handlePut(req, res);

        // Verify response
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith('OK');

        // Verify axios was called with the correct URL
        expect(mockedAxios.get).toHaveBeenCalledWith(m3u8Url);

        // Verify file system operations
        expect(fs.mkdirSync).toHaveBeenCalled();
        expect(fs.writeFileSync).toHaveBeenCalled();

        // Verify stream tracker
        const trackingInfo = streamTracker.get('channel1/playlist.m3u8');
        expect(trackingInfo).toBeDefined();
        if (trackingInfo) {
            expect(trackingInfo.m3u8Uri).toBe('/live/channel1/playlist.m3u8');
            expect(trackingInfo.segments.size).toBe(4); // 4 different quality streams
            expect(trackingInfo.allSegmentsReceived).toBe(false);
        }
    });
}); 