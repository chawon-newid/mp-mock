import { M3u8TrackingInfo, SegmentInfo } from '../types';
import path from 'path';
import logger from './logger';

export function parseM3u8(content: string, m3u8Uri: string, channelId: string): M3u8TrackingInfo | null {
    const lines = content.split('\n');
    let targetDuration = 5; // Default target duration for master playlists
    const segments = new Map<string, SegmentInfo>();
    let isMasterPlaylist = false;
    const now = Date.now();

    logger.debug(`Parsing M3U8 content for URI: ${m3u8Uri}, channelId: ${channelId}`);
    logger.debug(`M3U8 content length: ${content.length} bytes`);
    
    // 디버그 - M3U8 내용 로깅
    logger.debug("M3U8 Content (first 500 chars):", content.substring(0, 500));

    // M3U8 파일 경로에서 기본 파일명(확장자 제외) 추출
    const isMediaPackageV2 = m3u8Uri.startsWith('/in/v2/');
    let m3u8BaseName = '';

    if (isMediaPackageV2) {
        // MediaPackage v2 스타일 URL에서 파일명 추출
        if (m3u8Uri.endsWith('/channel')) {
            m3u8BaseName = 'playlist';
        } else {
            // /in/v2/{channelId}/{redundantId}/{filename}.m3u8 형식에서 filename 추출
            const parts = m3u8Uri.split('/');
            const lastPart = parts[parts.length - 1];
            m3u8BaseName = lastPart.replace(/\.[^.]+$/, ''); // 확장자 제거
        }
    } else {
        // 일반 스타일 URL에서 파일명 추출
        const parts = m3u8Uri.split('/');
        const lastPart = parts[parts.length - 1];
        m3u8BaseName = lastPart.replace(/\.[^.]+$/, ''); // 확장자 제거
        if (m3u8BaseName === '') {
            m3u8BaseName = 'playlist';
        }
    }

    logger.debug(`Extracted M3U8 base name: ${m3u8BaseName}`);
    
    // M3U8 파일 경로에서 디렉토리 부분 추출
    const m3u8Path = m3u8Uri.split('/').slice(0, -1).join('/');
    logger.debug(`M3U8 base path: ${m3u8Path}`);

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
                logger.debug(`Added variant stream: ${variantUri}`);
            }
            i++; // Skip the next line as we've already processed it
        } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
            targetDuration = parseInt(line.split(':')[1], 10);
            logger.debug(`Target duration: ${targetDuration}`);
        } else if (line.startsWith('#EXTINF:')) {
            const duration = parseFloat(line.split(':')[1].split(',')[0]);
            
            // 다음 줄에 있는 세그먼트 경로 가져오기
            if (i + 1 < lines.length) {
                const segmentUri = lines[i + 1].trim();
                
                if (segmentUri && !segmentUri.startsWith('#')) {
                    // 상대 경로만 추출 (전체 경로에서 파일명만 가져옴)
                    const segmentRelativePath = segmentUri.includes('/') 
                        ? segmentUri.split('/').pop() || segmentUri 
                        : segmentUri;
                    
                    // 원본 세그먼트 경로도 유지 (추가적인 매칭 가능성을 위해)
                    const originalSegmentUri = segmentUri;
                    
                    logger.debug(`Found segment: ${segmentRelativePath}, duration: ${duration}`);
                    
                    // 기본 세그먼트 정보 생성
                    const segmentInfo: SegmentInfo = {
                        uri: segmentRelativePath,
                        duration,
                        received: false,
                        firstSeenAt: now
                    };
                    
                    // 세그먼트를 맵에 추가 (파일명만 사용)
                    segments.set(segmentRelativePath, segmentInfo);
                    
                    // MediaPackage v2 스타일 URL에서는 추가 형식의 세그먼트 키도 함께 추가
                    if (isMediaPackageV2) {
                        // TS 파일인 경우에만 추가 매핑
                        if (segmentRelativePath.endsWith('.ts')) {
                            // 확장자 제거
                            const filenameWithoutExt = segmentRelativePath.replace(/\.[^.]+$/, '');
                            
                            // 언더스코어(_)로 분리된 패턴 처리
                            if (filenameWithoutExt.includes('_')) {
                                const parts = filenameWithoutExt.split('_');
                                
                                // MediaPackage 패턴: channel_123_456.ts와 같은 형식
                                // 실제 수신되는 세그먼트 파일 형식과 일치하도록 하기 위해
                                // 다양한 패턴을 등록해 놓음
                                
                                if (parts.length >= 3) {
                                    // 추가 패턴 1: 숫자 변형
                                    // 예: channel_123_456.ts -> channel_123_457.ts, channel_123_458.ts 등
                                    const baseNameWithoutNum = parts.slice(0, -1).join('_');
                                    const lastNum = parseInt(parts[parts.length - 1]);
                                    
                                    if (!isNaN(lastNum)) {
                                        // 원래 번호 기준으로 근접한 번호들 추가
                                        for (let num = lastNum - 5; num <= lastNum + 5; num++) {
                                            if (num !== lastNum && num >= 0) {
                                                const variantName = `${baseNameWithoutNum}_${num}.ts`;
                                                segments.set(variantName, { ...segmentInfo });
                                                logger.debug(`Added numeric variant: ${variantName}`);
                                            }
                                        }
                                    }
                                }
                                
                                // 추가 패턴 2: 파일 이름을 더 일반화된 패턴으로 추가
                                if (parts.length >= 2) {
                                    // 첫 번째 부분만 사용한 패턴
                                    const simpleVariant = `${parts[0]}.ts`;
                                    if (simpleVariant !== segmentRelativePath) {
                                        segments.set(simpleVariant, { ...segmentInfo });
                                        logger.debug(`Added simplified variant: ${simpleVariant}`);
                                    }
                                    
                                    // 첫 두 부분만 사용한 패턴
                                    if (parts.length >= 3) {
                                        const mediumVariant = `${parts[0]}_${parts[1]}.ts`;
                                        if (mediumVariant !== segmentRelativePath) {
                                            segments.set(mediumVariant, { ...segmentInfo });
                                            logger.debug(`Added medium simplified variant: ${mediumVariant}`);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    i++; // 다음 줄 건너뛰기 (이미 처리했으므로)
                }
            }
        }
    }

    if (segments.size === 0) {
        logger.warn(`No segments found in M3U8 content for ${m3u8Uri}`);
        return null;
    }

    logger.debug(`Parsed ${segments.size} segments from M3U8`);
    
    // 디버그 - 첫 번째 세그먼트 로깅
    if (segments.size > 0) {
        const firstSegment = Array.from(segments.keys())[0];
        logger.debug(`First segment key: ${firstSegment}`);
        
        // 세그먼트 키 샘플 로깅 (최대 5개)
        const segmentKeys = Array.from(segments.keys()).slice(0, 5);
        logger.debug(`Sample segment keys [${segmentKeys.length}/${segments.size}]: ${segmentKeys.join(', ')}`);
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