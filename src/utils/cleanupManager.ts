import fs from 'fs';
import path from 'path';
import { Logger } from 'winston';
import logger from './logger';

export class CleanupManager {
    private mockStoragePath: string;
    private retentionPeriodMs: number;
    private cleanupIntervalMs: number;
    private isEnabled: boolean;
    private intervalId: NodeJS.Timeout | null = null;
    private logger: Logger;

    constructor(
        mockStoragePath: string, 
        options: {
            isEnabled?: boolean;
            retentionPeriodMs?: number;
            cleanupIntervalMs?: number;
            loggerInstance?: Logger;
        } = {}
    ) {
        this.mockStoragePath = mockStoragePath;
        this.isEnabled = options.isEnabled ?? false; // 기본적으로는 비활성화
        this.retentionPeriodMs = options.retentionPeriodMs ?? 3600000; // 기본값 1시간
        this.cleanupIntervalMs = options.cleanupIntervalMs ?? 300000; // 기본값 5분
        this.logger = options.loggerInstance || logger;
    }

    public start(): void {
        if (!this.isEnabled) {
            this.logger.info('TS file cleanup is disabled');
            return;
        }

        this.logger.info(`Starting TS file cleanup. Retention period: ${this.retentionPeriodMs / 60000} minutes, Interval: ${this.cleanupIntervalMs / 60000} minutes`);
        
        // 시작 즉시 한 번 실행
        this.cleanupOldFiles();
        
        // 주기적으로 실행되는 작업 설정
        this.intervalId = setInterval(() => this.cleanupOldFiles(), this.cleanupIntervalMs);
    }

    public stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            this.logger.info('TS file cleanup stopped');
        }
    }

    private cleanupOldFiles(): void {
        try {
            const now = Date.now();
            const cutoffTime = now - this.retentionPeriodMs;
            let totalRemoved = 0;
            
            // 채널 디렉토리 탐색
            const channelDirs = fs.readdirSync(this.mockStoragePath)
                .filter(item => {
                    const fullPath = path.join(this.mockStoragePath, item);
                    return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
                });
            
            for (const channelDir of channelDirs) {
                const channelPath = path.join(this.mockStoragePath, channelDir);
                
                // 각 채널 디렉토리 내 파일 검사
                const files = fs.readdirSync(channelPath)
                    .filter(file => file.endsWith('.ts'));
                
                for (const file of files) {
                    const filePath = path.join(channelPath, file);
                    const stats = fs.statSync(filePath);
                    
                    // 수정 시간이 기준 시간보다 이전이면 삭제
                    if (stats.mtimeMs < cutoffTime) {
                        fs.unlinkSync(filePath);
                        totalRemoved++;
                        this.logger.debug(`Removed old TS file: ${filePath}`);
                    }
                }
            }
            
            if (totalRemoved > 0) {
                this.logger.info(`Cleanup complete. Removed ${totalRemoved} old TS files.`);
            } else {
                this.logger.debug('Cleanup complete. No files to remove.');
            }
        } catch (error) {
            this.logger.error('Error during TS file cleanup:', error);
        }
    }
} 