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
        let segmentPathFull = '';
        let isMediaPackageV2 = false;
        
        if (fullPath.startsWith('/in/v2/')) {
            isMediaPackageV2 = true;
            // MediaPackage v2 스타일 URL: /in/v2/{channelId}/{redundantId}/{segmentPath}
            if (req.params.segmentPath) {
                segmentPathFull = req.params.segmentPath;
                this.logger.debug(`MediaPackage v2 style path detected, segment path: ${segmentPathFull}`);
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
            segmentPathFull = match ? match[1] : '';
            this.logger.debug(`Standard style path detected, segment path: ${segmentPathFull}`);
        }
        
        if (!segmentPathFull) {
            this.logger.error(`Could not extract segment path from URL: ${fullPath}`);
            res.status(400).send('Bad Request: Could not determine segment path');
            return;
        }
        
        // 파일명만 추출 (경로에서 마지막 부분만 사용)
        const segmentUriRelative = segmentPathFull.includes('/') 
            ? segmentPathFull.split('/').pop() || segmentPathFull
            : segmentPathFull;
            
        this.logger.debug(`Final segment relative path: ${segmentUriRelative}`);
        this.logger.debug(`Full segment path: ${segmentPathFull}`);
        
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
        
        // 세그먼트 매칭을 위한 키 추출
        let baseFilename = '';
        const possibleKeys = new Set<string>();
        
        // 기본 키 추가 (최초 플레이리스트)
        possibleKeys.add(`${channelId}/playlist.m3u8`);
        
        // 세그먼트 파일명에서 베이스 파일명 추출
        if (segmentUriRelative.endsWith('.ts')) {
            const filenameWithoutExt = segmentUriRelative.replace(/\.[^.]+$/, '');
            
            if (filenameWithoutExt.includes('_')) {
                // channel_845548_23.ts -> channel_845548
                const parts = filenameWithoutExt.split('_');
                if (parts.length >= 2) {
                    baseFilename = parts.slice(0, parts.length - 1).join('_');
                    possibleKeys.add(`${channelId}/${baseFilename}.m3u8`);
                }
                
                // 추가 패턴 시도 (첫 부분만, 등)
                if (parts.length >= 1) {
                    possibleKeys.add(`${channelId}/${parts[0]}.m3u8`);
                }
            } else {
                // 단순 파일명
                baseFilename = filenameWithoutExt;
                possibleKeys.add(`${channelId}/${baseFilename}.m3u8`);
            }
        }
        
        this.logger.debug(`Looking for segment ${segmentUriRelative} in possible M3U8 keys: [${Array.from(possibleKeys).join(', ')}]`);
        
        // 가능한 모든 키에 대해 세그먼트 매칭 시도
        for (const m3u8Key of possibleKeys) {
            const trackingInfo = this.streamTracker.get(m3u8Key);
            if (!trackingInfo || trackingInfo.channelId !== channelId || trackingInfo.allSegmentsReceived) {
                continue;
            }
            
            this.logger.debug(`Checking tracking info for ${m3u8Key} - has ${trackingInfo.segments.size} segments`);
            
            // 직접 매칭 시도
            if (trackingInfo.segments.has(segmentUriRelative)) {
                const segmentInfo = trackingInfo.segments.get(segmentUriRelative);
                if (segmentInfo && !segmentInfo.received) {
                    // 세그먼트 정보 업데이트
                    this.updateSegmentInfo(trackingInfo, m3u8Key, segmentInfo, segmentUriRelative, rawBody.length);
                    foundSegment = true;
                    break;
                }
            }
            
            // 직접 매칭이 실패하면 유사 세그먼트 찾기 시도
            if (!foundSegment && isMediaPackageV2) {
                const matchedSegmentKey = this.findSimilarSegment(segmentUriRelative, trackingInfo);
                if (matchedSegmentKey) {
                    const segmentInfo = trackingInfo.segments.get(matchedSegmentKey);
                    if (segmentInfo && !segmentInfo.received) {
                        this.logger.debug(`Found similar segment ${matchedSegmentKey} for received segment ${segmentUriRelative}`);
                        this.updateSegmentInfo(trackingInfo, m3u8Key, segmentInfo, matchedSegmentKey, rawBody.length);
                        foundSegment = true;
                        break;
                    }
                }
            }
        }
        
        // 매칭되는 세그먼트를 찾지 못했지만 추가할 수 있는 트래킹 정보가 있는 경우
        if (!foundSegment && possibleKeys.size > 0) {
            for (const m3u8Key of possibleKeys) {
                const trackingInfo = this.streamTracker.get(m3u8Key);
                if (trackingInfo && trackingInfo.channelId === channelId && !trackingInfo.allSegmentsReceived) {
                    // 새 세그먼트 추가
                    const now = Date.now();
                    const segmentInfo = {
                        uri: segmentUriRelative,
                        duration: 2, // 기본 지속시간
                        received: true,
                        receivedAt: now,
                        size: rawBody.length,
                        firstSeenAt: now
                    };
                    
                    trackingInfo.segments.set(segmentUriRelative, segmentInfo);
                    
                    // 세그먼트 수신 간격 추적
                    if (trackingInfo.lastSegmentReceivedTime > 0) {
                        const interval = now - trackingInfo.lastSegmentReceivedTime;
                        if (!trackingInfo.segmentArrivalIntervals) {
                            trackingInfo.segmentArrivalIntervals = [];
                        }
                        trackingInfo.segmentArrivalIntervals.push(interval);
                        if (trackingInfo.segmentArrivalIntervals.length > 20) {
                            trackingInfo.segmentArrivalIntervals.shift();
                        }
                    }
                    
                    trackingInfo.lastSegmentReceivedTime = now;
                    
                    this.logger.info(`[${channelId}] Added new segment ${segmentUriRelative} to M3U8 ${trackingInfo.m3u8Uri}.`);
                    foundSegment = true;
                    break;
                }
            }
        }

        if (!foundSegment) {
            this.logger.warn(`[${channelId}] Received TS segment ${segmentUriRelative} but it was not expected or already timed out/completed.`);
            // 디버깅을 위한 추가 정보 로깅
            this.logger.debug(`Available M3U8 keys in tracker: [${Array.from(this.streamTracker.keys()).join(', ')}]`);
            
            for (const [key, info] of this.streamTracker.entries()) {
                if (info.channelId === channelId) {
                    this.logger.debug(`Segments in ${key}: [${Array.from(info.segments.keys()).slice(0, 5).join(', ')}${info.segments.size > 5 ? '...' : ''}]`);
                }
            }
        }

        res.status(200).send('OK');
    };
    
    // 세그먼트 정보 업데이트
    private updateSegmentInfo(trackingInfo: M3u8TrackingInfo, m3u8Key: string, segmentInfo: any, segmentKey: string, size: number): void {
        const now = Date.now();
        
        // 전송 지연 계산 (플레이리스트에 등장한 시점부터 수신까지)
        const transferDelay = now - (segmentInfo.firstSeenAt || now);
        this.logger.debug(`[${trackingInfo.channelId}] Segment ${segmentKey} transfer delay: ${transferDelay}ms`);
        
        // 세그먼트 정보 업데이트
        segmentInfo.received = true;
        segmentInfo.receivedAt = now;
        segmentInfo.size = size;
        
        // 연속 타임아웃 카운터 초기화
        trackingInfo.successiveTimeouts = 0;
        
        // 마지막 세그먼트 수신 시간 업데이트
        const previousTime = trackingInfo.lastSegmentReceivedTime;
        trackingInfo.lastSegmentReceivedTime = now;
        
        // 세그먼트 도착 간격 계산 및 저장 (지터 계산용)
        if (previousTime > 0) {
            const arrivalInterval = now - previousTime;
            if (!trackingInfo.segmentArrivalIntervals) {
                trackingInfo.segmentArrivalIntervals = [];
            }
            trackingInfo.segmentArrivalIntervals.push(arrivalInterval);
            if (trackingInfo.segmentArrivalIntervals.length > 20) {
                trackingInfo.segmentArrivalIntervals.shift();
            }
        }
        
        this.logger.info(`[${trackingInfo.channelId}] Marked segment ${segmentKey} as received for M3U8 ${trackingInfo.m3u8Uri}.`);
        
        // 모든 세그먼트가 수신되었는지 확인
        let allReceived = true;
        for (const segInfo of trackingInfo.segments.values()) {
            if (!segInfo.received) {
                allReceived = false;
                break;
            }
        }
        
        if (allReceived) {
            this.logger.info(`[${trackingInfo.channelId}] All segments for ${trackingInfo.m3u8Uri} received.`);
            trackingInfo.allSegmentsReceived = true;
            if (trackingInfo.timeoutId) {
                clearTimeout(trackingInfo.timeoutId);
                trackingInfo.timeoutId = undefined;
                this.logger.debug(`Cleared timeout for ${m3u8Key} as all segments received.`);
            }
        }
    }
    
    // 유사한 세그먼트 찾기 (패턴 매칭)
    private findSimilarSegment(segmentUri: string, trackingInfo: M3u8TrackingInfo): string | null {
        if (!segmentUri.endsWith('.ts')) {
            return null;
        }
        
        const segmentName = segmentUri.replace(/\.[^.]+$/, ''); // 확장자 제거
        
        for (const [key, info] of trackingInfo.segments.entries()) {
            if (!key.endsWith('.ts') || info.received) {
                continue;
            }
            
            const keyName = key.replace(/\.[^.]+$/, '');
            
            // 패턴 1: 마지막 숫자만 다른 경우 (channel_845548_23.ts vs channel_845548_24.ts)
            if (segmentName.includes('_') && keyName.includes('_')) {
                const segmentParts = segmentName.split('_');
                const keyParts = keyName.split('_');
                
                if (segmentParts.length === keyParts.length) {
                    // 마지막 부분을 제외한 모든 부분이 일치하는지 확인
                    const segmentBase = segmentParts.slice(0, -1).join('_');
                    const keyBase = keyParts.slice(0, -1).join('_');
                    
                    if (segmentBase === keyBase) {
                        return key; // 마지막 숫자만 다른 세그먼트 찾음
                    }
                }
            }
            
            // 패턴 2: 세그먼트 이름이 키의 일부로 시작하는 경우
            if (keyName.startsWith(segmentName) || segmentName.startsWith(keyName)) {
                return key;
            }
        }
        
        return null;
    }
} 