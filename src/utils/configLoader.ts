import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface ServerConfig {
  port: number;
  host: string;
  logLevel: string;
}

export interface StreamingConfig {
  segmentTimeout: number;
  m3u8UpdateInterval: number;
  reportInterval: number;
}

export interface CleanupConfig {
  enabled: boolean;
  retentionPeriodHours: number;
  intervalMinutes: number;
}

export interface StorageConfig {
  path: string;
  maxSizeGB: number;
}

export interface ReportsConfig {
  enabled: boolean;
  path: string;
  intervalMinutes: number;
}

export interface AppConfig {
  server: ServerConfig;
  streaming: StreamingConfig;
  cleanup: CleanupConfig;
  storage: StorageConfig;
  reports: ReportsConfig;
}

export class ConfigLoader {
  private static instance: ConfigLoader;
  private config: AppConfig;
  private configPath: string;

  private constructor(configPath: string) {
    this.configPath = configPath;
    this.config = this.loadConfig();
  }

  public static getInstance(configPath?: string): ConfigLoader {
    if (!ConfigLoader.instance) {
      const defaultPath = path.join(process.cwd(), 'config.yaml');
      ConfigLoader.instance = new ConfigLoader(configPath || defaultPath);
    }
    return ConfigLoader.instance;
  }

  private loadConfig(): AppConfig {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.warn(`Configuration file not found at ${this.configPath}, using default values`);
        return this.getDefaultConfig();
      }

      const fileContents = fs.readFileSync(this.configPath, 'utf8');
      const yamlConfig = yaml.load(fileContents) as Partial<AppConfig>;
      
      const config = this.mergeWithDefaults(yamlConfig);
      
      this.applyEnvironmentOverrides(config);
      
      console.info('Configuration loaded successfully');
      return config;
    } catch (error) {
      console.error(`Error loading configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return this.getDefaultConfig();
    }
  }

  private getDefaultConfig(): AppConfig {
    return {
      server: {
        port: 8080,
        host: '0.0.0.0',
        logLevel: 'info'
      },
      streaming: {
        segmentTimeout: 10000,
        m3u8UpdateInterval: 6000,
        reportInterval: 60000
      },
      cleanup: {
        enabled: true,
        retentionPeriodHours: 24,
        intervalMinutes: 60
      },
      storage: {
        path: path.join(process.cwd(), 'mock_storage'),
        maxSizeGB: 10
      },
      reports: {
        enabled: true,
        path: path.join(process.cwd(), 'reports'),
        intervalMinutes: 5
      }
    };
  }

  private mergeWithDefaults(partialConfig: Partial<AppConfig>): AppConfig {
    const defaultConfig = this.getDefaultConfig();
    
    const merge = <T>(target: T, source?: Partial<T>): T => {
      if (!source) return target;
      const result = { ...target };
      
      Object.keys(source).forEach(key => {
        const sourceValue = source[key as keyof Partial<T>];
        const targetValue = target[key as keyof T];
        
        if (
          sourceValue !== null && 
          typeof sourceValue === 'object' &&
          targetValue !== null &&
          typeof targetValue === 'object'
        ) {
          result[key as keyof T] = merge(targetValue, sourceValue as any) as any;
        } else if (sourceValue !== undefined) {
          result[key as keyof T] = sourceValue as any;
        }
      });
      
      return result;
    };
    
    return merge(defaultConfig, partialConfig);
  }

  private applyEnvironmentOverrides(config: AppConfig): void {
    if (process.env.SERVER_PORT) {
      config.server.port = parseInt(process.env.SERVER_PORT, 10);
    }
    if (process.env.SERVER_HOST) {
      config.server.host = process.env.SERVER_HOST;
    }
    if (process.env.LOG_LEVEL) {
      config.server.logLevel = process.env.LOG_LEVEL;
    }

    if (process.env.STORAGE_PATH) {
      config.storage.path = process.env.STORAGE_PATH;
    }
  }

  public getConfig(): AppConfig {
    return this.config;
  }

  public reloadConfig(): AppConfig {
    this.config = this.loadConfig();
    return this.config;
  }

  public getServerConfig(): ServerConfig {
    return this.config.server;
  }

  public getStreamingConfig(): StreamingConfig {
    return this.config.streaming;
  }

  public getCleanupConfig(): CleanupConfig {
    return this.config.cleanup;
  }

  public getStorageConfig(): StorageConfig {
    return this.config.storage;
  }

  public getReportsConfig(): ReportsConfig {
    return this.config.reports;
  }
} 