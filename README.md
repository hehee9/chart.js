# Chart.js (메신저봇R용 그래프 모듈)

메신저봇R 0.7.34a+ 환경에서 사용할 수 있는 **그래프 생성 모듈**입니다. 다양한 차트(함수 그래프, 극좌표, 꺾은선, 파이, 막대, 산점도, 정규분포 등)를 이미지로 생성하여 파일로 저장할 수 있습니다. 실제 전송에는 [MediaSender](https://github.com/hehee9/mediaSender) 모듈이 필요합니다.

## 주요 특징
- **다양한 그래프 지원**: 함수, 극좌표, 꺾은선, 파이, 막대, 산점도, 정규분포 등
- **이미지 파일로 저장**: sdcard/msgbot/charts/ 경로에 PNG로 저장
- **옵션 커스터마이즈**: 색상, 크기, 제목, 신뢰구간 등 다양한 옵션 지원
- **자동 삭제 기능**: 일정 시간 후 파일 자동 삭제 가능
- **Android 9(API 28)+ 호환**

## 설치 및 준비
1. `chart.js` 파일을 메신저봇R의 스크립트/라이브러리 폴더에 복사합니다.
2. (선택) 이미지를 전송하려면 [MediaSender](https://github.com/hehee9/mediaSender) 모듈도 설치하세요.

## 사용법
```js
const Chart = require('chart');

// 함수 그래프 예시
const path = Chart.createFunctionGraph({
  formula: 'Math.sin(x)',
  width: 800,
  height: 600,
  lineColor: '#FF0000',
  autoDelete: true // 1분 후 자동 삭제
});

// 파이 차트 예시
const path = Chart.createPieChart({
  data: [
    { label: 'A', value: 30 },
    { label: 'B', value: 50 },
    { label: 'C', value: 20 }
  ],
  colors: ['#FF6384', '#36A2EB', '#FFCE56']
});
```

## 지원 그래프 종류 및 주요 옵션
- **createFunctionGraph**: 수식 기반 함수 그래프
  - `formula`: 'x'를 변수로 하는 JS 수식 (예: 'Math.sin(x)')
  - `width`, `height`, `lineColor`, `backgroundColor` 등
- **createPolarGraph**: 극좌표(r=f(θ)) 그래프
  - `formula`: 't'(θ) 변수 사용 (예: '2 * Math.sin(3*t)')
  - `rotations`: 회전 바퀴 수
- **createLineChart**: 데이터 꺾은선 그래프
  - `data`: [{x, y}, ...] 배열
- **createPieChart**: 파이 차트
  - `data`: [{label, value}, ...] 배열
  - `colors`: 파이 조각 색상 배열
- **createBarChart**: 막대 그래프
  - `data`: [{label, value}, ...] 배열
  - `orientation`: 'vertical' 또는 'horizontal'
- **createScatterPlot**: 산점도/추세선/신뢰구간
  - `data`: [{x, y}, ...] 배열
  - `showConfidenceInterval`: 신뢰구간 표시 여부
- **createNormalDistributionChart**: 정규분포 곡선/신뢰구간
  - `mean`, `stdDev`, `confidenceLevels` 등

## 반환값
- 성공 시: 생성된 이미지 파일의 전체 경로 (예: `sdcard/msgbot/charts/lineChart_123456789.png`)
- 실패 시: `null` 반환

## 주의사항
- **이미지 전송**: 이미지를 카카오톡 등으로 전송하려면 MediaSender 모듈이 필요합니다.
- **경로 권한**: sdcard/msgbot/charts/ 경로에 쓰기 권한이 필요합니다.
- **Android 9(API 28)+**, **메신저봇R 0.7.34a+** 이상에서 동작합니다.
- **수식 오류**: 잘못된 수식 입력 시 에러가 발생할 수 있습니다.

## 라이선스
MIT