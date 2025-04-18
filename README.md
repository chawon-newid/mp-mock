# MediaPackage Mock Server (MP-MOCK)

AWS MediaPackage Mock Server는 HLS WebDAV 테스트를 위한 목 서버입니다. 이 서버는 HLS 스트리밍 프로토콜의 WebDAV 전송 과정을 시뮬레이션하고 성능 지표를 수집합니다.

## 주요 기능

- M3U8 플레이리스트 및 TS 세그먼트 파일 수신 및 저장
- HLS 스트림 세그먼트 전달 상태 모니터링
- 세그먼트 타임아웃 및 수신 실패 감지
- 상세한 성능 측정 지표 수집 및 보고서 생성
- 다양한 지연 시간 및 신뢰성 지표 분석

## 설치 방법

### 요구 사항

- Node.js 14 이상
- npm 또는 yarn

### 설치 단계

1. 리포지토리 클론:
```bash
git clone https://github.com/your-username/MP-MOCK.git
cd MP-MOCK
```

2. 의존성 설치:
```bash
npm install
```

## 실행 방법

### 개발 모드

```bash
npm run dev
```

### 프로덕션 모드

```bash
npm run build
npm start
```

서버는 기본적으로 3001 포트에서 실행됩니다. 환경 변수 `PORT`를 설정하여 다른 포트를 지정할 수 있습니다.

## API 엔드포인트

### WebDAV 엔드포인트

- **PUT `/live/:channelId/`**: M3U8 플레이리스트 파일 업로드 (재생목록 파일명은 요청 본문으로 전달)
- **PUT `/live/:channelId/*.ts`**: TS 세그먼트 파일 업로드
- **GET `/live/:channelId/*`**: 저장된 M3U8 또는 TS 파일 조회

### 보고서 엔드포인트

- **GET `/report`**: 현재 스트림 성능 보고서 조회

## 성능 측정 지표

MP-MOCK 서버는 다음과 같은 성능 지표를 수집합니다:

### 기본 지표
- 총 세그먼트 수
- 수신된 세그먼트 수/비율
- 누락된 세그먼트 수
- 평균 세그먼트 크기
- 총 데이터 전송량
- 평균 비트레이트

### 지연 시간 지표
- 세그먼트 전송 지연(평균/최소/최대) - M3U8에 세그먼트가 등장한 후 실제 수신될 때까지의 시간
- M3U8 업데이트 주기 - 연속적인 M3U8 업데이트 간의 시간 간격
- 마지막 M3U8 업데이트 이후 경과 시간

### 신뢰성 지표
- 세그먼트 도착 간격의 표준편차(지터) - 세그먼트가 얼마나 일관된 간격으로 도착하는지
- 타임아웃 이벤트 수 - 세그먼트가 지정된 타임아웃 내에 도착하지 않은 횟수
- 최대 연속 타임아웃 수 - 연속으로 발생한 타임아웃 이벤트의 최대 수

## 로깅

서버는 Winston 로깅 라이브러리를 사용하여 로그를 콘솔과 파일에 기록합니다:

- **콘솔 로그**: 모든 로그 메시지를 표준 출력에 표시
- **오류 로그 파일**: `./logs/error.log` - 오류 메시지만 포함
- **종합 로그 파일**: `./logs/combined.log` - 모든 로그 메시지 포함

로그 레벨은 `config.yaml` 파일의 `server.logLevel` 속성, 환경 변수 `LOG_LEVEL`, 또는 API 엔드포인트를 통해 설정할 수 있습니다.

## 성능 보고서

서버는 5초마다 성능 보고서를 생성하여 `mock_storage/realtime_report_{timestamp}.txt` 파일로 저장합니다. 이 보고서는 현재 활성 스트림의 성능 지표를 포함합니다.

실시간 보고서는 `/report` 엔드포인트를 통해 확인할 수도 있습니다.

## 구성 옵션

### 구성 파일 (config.yaml)

서버는 `config.yaml` 파일을 통해 구성할 수 있습니다. 기본 위치는 프로젝트 루트 디렉토리입니다.

```yaml
# 서버 구성
server:
  # 서버가 바인딩할 포트 (기본값: 3001)
  port: 3001
  # 로그 레벨 (error, warn, info, http, verbose, debug, silly)
  logLevel: "info"

# 스트리밍 구성
streaming:
  # 세그먼트 도착 타임아웃 버퍼 (밀리초)
  segmentArrivalTimeoutBufferMs: 0

# 스토리지 구성
storage:
  # 수신된 파일이 저장될 기본 경로
  mockStoragePath: "./mock_storage"
  
  # TS 파일 정리 구성
  cleanup:
    # 자동 정리 활성화 여부 (true/false)
    enabled: true
    
    # TS 파일 보관 기간 (밀리초)
    # 기본값: 3600000 (1시간)
    retentionPeriodMs: 3600000
    
    # 정리 작업 실행 간격 (밀리초)
    # 기본값: 300000 (5분)
    cleanupIntervalMs: 300000

# 보고서 생성 구성
reports:
  # 성능 보고서 자동 생성 간격 (밀리초)
  reportIntervalMs: 60000
  
  # 보고서 파일 이름
  filename: "performance_history.txt"
```

### 환경 변수

다음 환경 변수를 통해 구성 파일의 설정을 재정의할 수 있습니다:

- **SERVER_PORT**: 서버 포트
- **SERVER_HOST**: 서버 호스트
- **LOG_LEVEL**: 로깅 레벨 (기본값: 'info')
- **STORAGE_PATH**: 저장 경로

### 로그 레벨 동적 변경

서버 실행 중에 로그 레벨을 변경하는 방법은 다음과 같습니다:

1. **npm 스크립트 사용**:
```bash
# 기본 명령 (사용자에게 레벨 입력 요청)
npm run loglevel

# 특정 레벨로 직접 설정
npm run loglevel:debug
npm run loglevel:info
npm run loglevel:warn
npm run loglevel:error
```

2. **직접 API 엔드포인트 호출**:
```bash
curl -X POST "http://localhost:3001/config/loglevel?level=debug"
```

유효한 로그 레벨: 'error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'

## 사용 예시

### M3U8 파일 업로드

```bash
curl -X PUT -T playlist.m3u8 http://localhost:3001/live/channel1/
```

### TS 세그먼트 업로드

```bash
curl -X PUT -T segment1.ts http://localhost:3001/live/channel1/segment1.ts
```

### HLS 스트림 시청하기

#### 브라우저나 HLS 플레이어에서 직접 재생

M3U8 플레이리스트 URL을 직접 HLS 지원 비디오 플레이어에 입력하여 스트림을 시청할 수 있습니다:

```
http://localhost:3001/live/channel1/playlist.m3u8
```

#### HTML5 비디오 태그와 HLS.js 사용하기

HLS.js 라이브러리를 사용하여 웹 페이지에서 스트림을 재생할 수 있습니다:

```html
<!DOCTYPE html>
<html>
<head>
  <title>HLS 스트림 플레이어</title>
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
</head>
<body>
  <video id="video" controls></video>
  <script>
    const video = document.getElementById('video');
    const videoSrc = 'http://localhost:3001/live/channel1/playlist.m3u8';
    
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(videoSrc);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, function() {
        video.play();
      });
    } 
    // HLS를 기본 지원하는 브라우저용 (Safari 등)
    else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = videoSrc;
      video.addEventListener('loadedmetadata', function() {
        video.play();
      });
    }
  </script>
</body>
</html>
```

#### VLC 또는 기타 미디어 플레이어로 시청하기

VLC와 같은 미디어 플레이어에서 '네트워크 스트림 열기' 옵션을 사용하여 다음 URL을 입력합니다:

```
http://localhost:3001/live/channel1/playlist.m3u8
```

### 성능 보고서 조회

```bash
curl http://localhost:3001/report
```

## 디렉토리 구조

```
MP-MOCK/
├── src/
│   ├── handlers/           # 요청 핸들러
│   ├── utils/              # 유틸리티 함수
│   ├── types.ts            # 타입 정의
│   └── server.ts           # 서버 메인 코드
├── mock_storage/           # 저장된 파일 및 로그
├── dist/                   # 컴파일된 코드
├── tests/                  # 테스트 파일
├── jest.config.js          # Jest 설정
├── package.json            # 프로젝트 메타데이터
└── tsconfig.json           # TypeScript 설정
```

## 문제 해결

### 서버가 시작되지 않는 경우

1. 포트 충돌 여부 확인: 다른 프로세스가 이미 3001 포트를 사용 중인지 확인하세요.
2. 의존성 설치 여부 확인: `npm install`을 다시 실행하세요.

### M3U8 또는 TS 파일 업로드 실패

1. 유효한 M3U8/TS 파일인지 확인하세요.
2. 채널 ID가 URL에 포함되어 있는지 확인하세요.

## 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 