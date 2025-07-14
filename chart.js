/**
 * @module Chart
 * @description 메신저봇R 0.7.34a+ 환경에서 사용할 수 있는 그래프 모듈
 * - 실제 전송까지 하려면 `MediaSender` 모듈 필요 (@see https://github.com/hehee9/mediaSender)
 * 
 * @author hehee
 * @license MIT
 * @version 1.0.0
 * @since 2025-07-14
 */

(() => {
    const Bitmap = android.graphics.Bitmap;
    const Canvas = android.graphics.Canvas;
    const Paint = android.graphics.Paint;
    const RectF = android.graphics.RectF;
    const Path = android.graphics.Path;
    const File = java.io.File;
    const FileOutputStream = java.io.FileOutputStream;

    /** @description 차트 생성에 필요한 공통 유틸리티 함수 모음 */
    const ChartUtils = {
        /**
         * @description 16진수 색상 코드 -> ARGB 정수 배열 변환
         * @param {string} hex #RRGGBB 또는 #AARRGGBB 형식 16진수 색상 코드
         * @returns {number[]} [alpha, red, green, blue]
         */
        hexToARGB: (hex) => {
            const v = parseInt(hex.replace(/^#/, ''), 16);
            if (hex.length === 9) { // #AARRGGBB
                return [
                    (v >> 24) & 0xFF,
                    (v >> 16) & 0xFF,
                    (v >> 8)  & 0xFF,
                    v & 0xFF
                ];
            } else { // #RRGGBB
                return [
                    0xFF,
                    (v >> 16) & 0xFF,
                    (v >> 8)  & 0xFF,
                    v & 0xFF
                ];
            }
        },

        /**
         * @description 사용자 옵션, 기본 옵션 병합 (Object.assign 대용)
         * @param {object} defaults 기본값 객체
         * @param {object} options 사용자가 제공한 옵션 객체
         * @returns {object} 병합된 설정 객체
         */
        mergeOptions: (defaults, options) => {
            let config = {};
            for (let key in defaults) {
                config[key] = defaults[key];
            }
            if (options) {
                for (let key in options) {
                    if (Object.prototype.hasOwnProperty.call(options, key)) {
                        config[key] = options[key];
                    }
                }
            }
            return config;
        },

        /**
         * @description 부모 디렉토리 생성
         * @param {string} path 전체 파일 경로
         */
        ensureDirectoryExists: (path) => {
            try {
                let file = new File(path);
                let parentDir = file.getParentFile();
                if (!parentDir.exists()) {
                    parentDir.mkdirs();
                }
            } catch (e) {
                Log.e(`${e.name}\n${e.message}\n${e.stack}`);
            }
        },

        /**
         * @description 선형 회귀 분석 결과 계산
         * @param {Array<{x: number, y: number}>} data 분석할 데이터 배열
         * @returns {object|null} 통계 결과 객체 또는 계산 불가 시 null
         */
        calculateLinearRegression: (data) => {
            const n = data.length;
            if (n < 2) return null;

            let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
            for (let i = 0; i < n; i++) {
                sumX += data[i].x;
                sumY += data[i].y;
                sumXY += data[i].x * data[i].y;
                sumX2 += data[i].x * data[i].x;
            }

            const denominator = (n * sumX2 - sumX * sumX);
            if (denominator === 0) return null; // 기울기 계산 불가 (모든 x값이 동일)

            const meanX = sumX / n;
            const meanY = sumY / n;
            const slope = (n * sumXY - sumX * sumY) / denominator;
            const intercept = meanY - slope * meanX;

            // 신뢰구간 계산을 위한 추가 값들
            if (n < 3) return { slope, intercept, n, meanX, Sxx: 0, residualStdErr: 0 };

            let Sxx = 0;
            let ssr = 0; // 잔차 제곱합
            for (let i = 0; i < n; i++) {
                let dx = data[i].x - meanX;
                Sxx += dx * dx;
                let dy = data[i].y - (slope * data[i].x + intercept);
                ssr += dy * dy;
            }
            
            const residualStdErr = Math.sqrt(ssr / (n - 2)); // 잔차 표준 오차

            return { slope, intercept, n, meanX, Sxx, residualStdErr };
        },

        /**
         * @description 정규분포의 확률 밀도 함수(PDF)
         * @param {number} x 변수
         * @param {number} mean 평균 (μ)
         * @param {number} stdDev 표준편차 (σ)
         * @returns {number} 해당 x값의 확률 밀도
         */
        pdf: (x, mean, stdDev) => {
            if (stdDev <= 0) return 0;
            const diff = x - mean;
            const twoSigma2 = 2 * stdDev * stdDev;
            const coeff = 1 / (stdDev * Math.sqrt(2 * Math.PI));
            return coeff * Math.exp(-(diff * diff) / twoSigma2);
        },

        /**
         * @description 파일 경로가 없을 경우 기본 경로 생성
         * @param {string|null} path 사용자가 지정한 경로
         * @param {string} chartName 차트 종류 이름
         * @returns {string} 최종 파일 경로
         */
        resolvePath: (path, chartName) => {
            if (path) return path;
            let timestamp = Date.now();
            return `sdcard/msgbot/charts/${chartName}_${timestamp}.png`;
        },

        /**
         * @description 파일 자동 삭제 예약
         * @param {string} path 삭제할 파일 경로
         * @param {number} delay 삭제 전 대기 시간 (ms)
         */
        scheduleAutoDelete: (path, delay) => {
            if (!path || delay <= 0) return;
            setTimeout(() => {
                try {
                    FileStream.remove(path);
                    Log.i(path + " 파일이 자동 삭제되었습니다.");
                } catch (e) { }
            }, delay);
        }
    };


    /**
     * @description 수식 기반 함수 그래프 생성, 파일 저장
     * @param {object} options 그래프 생성 옵션
     * @param {string} options.path 이미지 저장 전체 경로
     * @param {string} options.formula 'x'를 변수로 포함하는 JS 수학 수식 문자열
     * @param {number} [options.width=800] 이미지 너비
     * @param {number} [options.height=600] 이미지 높이
     * @param {number} [options.scale=20] 그래프 배율 (값이 클수록 축소)
     * @param {string} [options.backgroundColor="#FFFFFF"] 배경색
     * @param {string} [options.axisColor="#CCCCCC"] 축 색상
     * @param {string} [options.lineColor="#FF0000"] 그래프 선 색상
     * @returns {string|null} 저장 파일 경로 | null
     */
    function createFunctionGraph(options) {
        const defaults = {
            path: null,
            autoDelete: false,
            deleteDelay: 60000,
            width: 800,
            height: 600,
            scale: 20,
            backgroundColor: "#FFFFFF",
            axisColor: "#CCCCCC",
            lineColor: "#FF0000"
        };
        const config = ChartUtils.mergeOptions(defaults, options);

        if (!config.path) {
            const timestamp = Date.now();
            config.path = `sdcard/msgbot/charts/functionGraph_${timestamp}.png`;
        }

        if (!config.formula) {
            Log.e("FunctionGraph 생성 오류: 필수 옵션 'formula'가 누락되었습니다.");
            return null;
        }

        const { formula, width, height, scale, backgroundColor, axisColor, lineColor } = config;

        let formulaFunc;
        try {
            formulaFunc = new Function('x', 'return ' + formula);
        } catch (e) {
            Log.e(`FunctionGraph 생성 오류: 잘못된 수식입니다\n${e.name}\n${e.message}\n${e.stack}`);
            return null;
        }

        let bitmap = null;
        let stream = null;
        try {
            ChartUtils.ensureDirectoryExists(config.path);
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            const canvas = new Canvas(bitmap);

            const [bgA, bgR, bgG, bgB] = ChartUtils.hexToARGB(backgroundColor);
            const [axA, axR, axG, axB] = ChartUtils.hexToARGB(axisColor);
            const [lnA, lnR, lnG, lnB] = ChartUtils.hexToARGB(lineColor);

            // Paint 객체 초기화
            const bgPaint = new Paint();
            bgPaint.setARGB(bgA, bgR, bgG, bgB);

            const axisPaint = new Paint();
            axisPaint.setARGB(axA, axR, axG, axB);
            axisPaint.setStrokeWidth(2);

            const graphPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            graphPaint.setARGB(lnA, lnR, lnG, lnB);
            graphPaint.setStrokeWidth(5);
            graphPaint.setStyle(Paint.Style.STROKE);

            // 배경 및 축 그리기
            canvas.drawPaint(bgPaint);
            const centerX = width / 2;
            const centerY = height / 2;
            canvas.drawLine(0, centerY, width, centerY, axisPaint);
            canvas.drawLine(centerX, 0, centerX, height, axisPaint);

            // 변수 캐싱
            const path = new Path();
            let firstPoint = true;

            // 그래프 경로 계산 및 생성
            for (let i = 0; i < width; i++) {
                let mathX = (i - centerX) / scale;
                let mathY = formulaFunc(mathX);

                if (!isFinite(mathY)) {
                    firstPoint = true;
                    continue;
                }

                let canvasY = centerY - (mathY * scale);
                if (firstPoint) {
                    path.moveTo(i, canvasY);
                    firstPoint = false;
                } else {
                    path.lineTo(i, canvasY);
                }
            }

            canvas.drawPath(path, graphPaint);

            // 파일로 저장
            stream = new FileOutputStream(config.path);
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream);

            // 자동 삭제 스케줄링
            if (config.autoDelete) {
                ChartUtils.scheduleAutoDelete(config.path, config.deleteDelay);
            }

            return config.path;

        } catch (e) {
            Log.e(`${e.name}\n${e.message}\n${e.stack}`);
            return null;
        } finally {
            if (stream) stream.close();
            if (bitmap) bitmap.recycle();
        }
    }

    /**
     * @description [극좌표계] r=f(t) 수식 그래프 생성, 파일 저장 (t는 θ)
     * @param {object} options 그래프 생성 옵션
     * @param {string} options.path 이미지 저장 전체 경로
     * @param {string} options.formula 't'(theta)를 변수로 포함하는 JS 수학 수식 문자열
     * @param {number} [options.width=1024] 이미지 너비
     * @param {number} [options.height=1024] 이미지 높이
     * @param {number} [options.scale=20] 그래프 확대/축소 배율
     * @param {number} [options.rotations=5] 그래프를 그릴 때 회전할 바퀴 수 (나선형 등 표현)
     * @param {string} [options.backgroundColor="#FFFFFF"] 배경색
     * @param {string} [options.axisColor="#CCCCCC"] 축 색상
     * @param {string} [options.lineColor="#0000FF"] 그래프 선 색상
     * @returns {string|null} 저장 파일 경로 | null
     */
    function createPolarGraph(options) {
        const defaults = {
            path: null,
            autoDelete: false,
            deleteDelay: 60000,
            width: 1024,
            height: 1024,
            scale: 20,
            rotations: 5,
            backgroundColor: "#FFFFFF",
            axisColor: "#CCCCCC",
            lineColor: "#0000FF"
        };
        const config = ChartUtils.mergeOptions(defaults, options);

        if (!config.path) {
            const timestamp = Date.now();
            config.path = `sdcard/msgbot/charts/polarGraph_${timestamp}.png`;
        }

        if (!config.formula) {
            Log.e("PolarGraph 생성 오류: 필수 옵션 'formula'가 누락되었습니다.");
            return null;
        }

        const { formula, width, height, scale, rotations, backgroundColor, axisColor, lineColor } = config;

        let formulaFunc;
        try {
            formulaFunc = new Function('t', `with(Math){return ${formula}}`);
        } catch (e) {
            Log.e(`PolarGraph 생성 오류: 잘못된 수식입니다\n${e.name}\n${e.message}\n${e.stack}`);
            return null;
        }

        const radFactor = Math.PI / 180;
        const step = 0.5;
        const maxAngle = 360 * rotations;

        let bitmap = null;
        let stream = null;
        try {
            ChartUtils.ensureDirectoryExists(config.path);
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            const canvas = new Canvas(bitmap);

            const bgPaint = new Paint();
            const [bgA, bgR, bgG, bgB] = ChartUtils.hexToARGB(backgroundColor);
            bgPaint.setARGB(bgA, bgR, bgG, bgB);

            const axisPaint = new Paint();
            const [axA, axR, axG, axB] = ChartUtils.hexToARGB(axisColor);
            axisPaint.setARGB(axA, axR, axG, axB);
            axisPaint.setStrokeWidth(2);

            const graphPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            const [lnA, lnR, lnG, lnB] = ChartUtils.hexToARGB(lineColor);
            graphPaint.setARGB(lnA, lnR, lnG, lnB);
            graphPaint.setStrokeWidth(5);
            graphPaint.setStyle(Paint.Style.STROKE);

            canvas.drawPaint(bgPaint);
            const centerX = width / 2;
            const centerY = height / 2;
            canvas.drawLine(0, centerY, width, centerY, axisPaint);
            canvas.drawLine(centerX, 0, centerX, height, axisPaint);

            const path = new Path();
            let isPathStarted = false;

            for (let angle = 0; angle < maxAngle; angle += step) {
                let theta = angle * radFactor;
                let r;

                try {
                    r = formulaFunc(theta);
                } catch (e) {
                    isPathStarted = false;
                    continue;
                }

                if (!isFinite(r)) {
                    isPathStarted = false;
                    continue;
                }

                let mathX = r * Math.cos(theta);
                let mathY = r * Math.sin(theta);

                let canvasX = centerX + mathX * scale;
                let canvasY = centerY - mathY * scale;

                if (!isPathStarted) {
                    path.moveTo(canvasX, canvasY);
                    isPathStarted = true;
                } else {
                    path.lineTo(canvasX, canvasY);
                }
            }

            canvas.drawPath(path, graphPaint);

            stream = new FileOutputStream(config.path);
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream);

            if (config.autoDelete) {
                ChartUtils.scheduleAutoDelete(config.path, config.deleteDelay);
            }

            return config.path;

        } catch (e) {
            Log.e(`${e.name}\n${e.message}\n${e.stack}`);
            return null;
        } finally {
            if (stream) stream.close();
            if (bitmap) bitmap.recycle();
        }
    }


    /**
     * @description 데이터 기반 꺾은선 그래프 생성, 파일 저장
     * @param {object} options 그래프 생성 옵션
     * @param {string} options.path 이미지 저장 전체 경로
     * @param {Array<object>} options.data 그래프 데이터 배열. 각 요소는 {x, y} 객체
     * @param {number} [options.width=800] 이미지 너비
     * @param {number} [options.height=600] 이미지 높이
     * @param {string} [options.backgroundColor="#FFFFFF"] 배경색
     * @param {string} [options.lineColor="#007BFF"] 선 색상
     * @param {string} [options.pointColor="#DC3545"] 데이터 포인트 색상
     * @returns {string|null} 저장 파일 경로 | null
     */
    function createLineChart(options) {
        const defaults = {
            path: null,
            autoDelete: false,
            deleteDelay: 60000,
            width: 800,
            height: 600,
            padding: { top: 50, right: 50, bottom: 70, left: 80 },
            backgroundColor: "#FFFFFF",
            lineColor: "#007BFF",
            pointColor: "#DC3545",
            gridColor: "#E9ECEF",
            textColor: "#495057",
            pointRadius: 8,
            strokeWidth: 5
        };
        const config = ChartUtils.mergeOptions(defaults, options);

        if (!config.path) {
            const timestamp = Date.now();
            config.path = `sdcard/msgbot/charts/lineChart_${timestamp}.png`;
        }

        if (!config.data || config.data.length < 2) {
            Log.e("LineChart 생성 오류: 필수 옵션(path, data)이 누락되었거나 데이터가 2개 미만입니다.");
            return null;
        }

        let bitmap = null;
        let stream = null;
        try {
            const {
                width, height, padding, data,
                backgroundColor, lineColor, pointColor, gridColor, textColor,
                pointRadius, strokeWidth
            } = config;
            const { top, right, bottom, left } = padding;
            const dataLen = data.length;

            let minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < dataLen; i++) {
                let y = data[i].y;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
            const yRange = maxY - minY || 1;

            const chartWidth = width - left - right;
            const chartHeight = height - top - bottom;
            const xInterval = chartWidth / (dataLen - 1);

            const [bgA, bgR, bgG, bgB] = ChartUtils.hexToARGB(backgroundColor);
            const [lnA, lnR, lnG, lnB] = ChartUtils.hexToARGB(lineColor);
            const [ptA, ptR, ptG, ptB] = ChartUtils.hexToARGB(pointColor);
            const [gdA, gdR, gdG, gdB] = ChartUtils.hexToARGB(gridColor);
            const [txA, txR, txG, txB] = ChartUtils.hexToARGB(textColor);

            const bgPaint = new Paint();
            bgPaint.setARGB(bgA, bgR, bgG, bgB);

            const linePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            linePaint.setARGB(lnA, lnR, lnG, lnB);
            linePaint.setStyle(Paint.Style.STROKE);
            linePaint.setStrokeWidth(strokeWidth);

            const pointPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            pointPaint.setARGB(ptA, ptR, ptG, ptB);
            pointPaint.setStyle(Paint.Style.FILL);

            const gridPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            gridPaint.setARGB(gdA, gdR, gdG, gdB);
            gridPaint.setStrokeWidth(2);

            const yLabelPaint = new Paint(Paint.ANTI_ALIAS_FLAG); // Y축 레이블용
            yLabelPaint.setARGB(txA, txR, txG, txB);
            yLabelPaint.setTextSize(24);
            yLabelPaint.setTextAlign(Paint.Align.RIGHT);

            const xLabelPaint = new Paint(Paint.ANTI_ALIAS_FLAG); // X축 레이블용
            xLabelPaint.setARGB(txA, txR, txG, txB);
            xLabelPaint.setTextSize(24);
            xLabelPaint.setTextAlign(Paint.Align.CENTER);

            // 캔버스 그리기 시작
            ChartUtils.ensureDirectoryExists(config.path);
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            const canvas = new Canvas(bitmap);

            // 배경 그리기
            canvas.drawPaint(bgPaint);

            // Y축 눈금 및 그리드 라인 그리기
            const yGridCount = 5;
            for (let i = 0; i <= yGridCount; i++) {
                let value = minY + (yRange / yGridCount) * i;
                let yPos = height - bottom - ((value - minY) / yRange) * chartHeight;
                canvas.drawLine(left, yPos, width - right, yPos, gridPaint);
                canvas.drawText(value.toFixed(1), left - 10, yPos + 8, yLabelPaint);
            }

            // X축 레이블 그리기
            for (let i = 0; i < dataLen; i++) {
                let xPos = left + i * xInterval;
                canvas.drawText(String(data[i].x), xPos, height - bottom + 30, xLabelPaint);
            }

            // 꺾은선 그래프 경로 그리기
            const linePath = new Path();
            let startY = height - bottom - ((data[0].y - minY) / yRange) * chartHeight;
            linePath.moveTo(left, startY);
            for (let i = 1; i < dataLen; i++) {
                let xPos = left + i * xInterval;
                let yPos = height - bottom - ((data[i].y - minY) / yRange) * chartHeight;
                linePath.lineTo(xPos, yPos);
            }
            canvas.drawPath(linePath, linePaint);

            // 데이터 포인트 그리기
            for (let i = 0; i < dataLen; i++) {
                let xPos = left + i * xInterval;
                let yPos = height - bottom - ((data[i].y - minY) / yRange) * chartHeight;
                canvas.drawCircle(xPos, yPos, pointRadius, pointPaint);
            }

            stream = new FileOutputStream(config.path);
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream);

            if (config.autoDelete) {
                ChartUtils.scheduleAutoDelete(config.path, config.deleteDelay);
            }

            return config.path;

        } catch (e) {
            Log.e(`${e.name}\n${e.message}\n${e.stack}`);
            return null;
        } finally {
            if (stream) stream.close();
            if (bitmap) bitmap.recycle();
        }
    }


    /**
     * @description 데이터 기반 원 그래프 생성, 파일 저장
     * @param {object} options 그래프 생성 옵션
     * @param {string} options.path 이미지 저장 전체 경로
     * @param {Array<object>} options.data 그래프 데이터 배열. 각 요소는 {label, value} 객체
     * @param {number} [options.width=1200] 이미지 너비
     * @param {number} [options.height=800] 이미지 높이
     * @param {string} [options.backgroundColor="#FFFFFF"] 배경색
     * @param {Array<string>} [options.colors] 파이 조각에 순환 적용될 색상 배열
     * @returns {string|null} 저장 파일 경로 | null
     */
    function createPieChart(options) {
        const defaults = {
            path: null,
            autoDelete: false,
            deleteDelay: 60000,
            width: 1200,
            height: 800,
            backgroundColor: "#FFFFFF",
            textColor: "#000000",
            colors: ["#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF", "#FF9F40"]
        };
        const config = ChartUtils.mergeOptions(defaults, options);

        if (!config.path) {
            const timestamp = Date.now();
            config.path = `sdcard/msgbot/charts/pieChart_${timestamp}.png`;
        }

        if (!config.data) {
            Log.e("PieChart 생성 오류: 필수 옵션(data)이 누락되었습니다.");
            return null;
        }

        let bitmap = null;
        let stream = null;
        try {
            const { path, width, height, backgroundColor, textColor, colors, data, autoDelete, deleteDelay } = config;

            const bgARGB = ChartUtils.hexToARGB(backgroundColor);
            const txtARGB = ChartUtils.hexToARGB(textColor);
            const sliceARGBs = colors.map(hex => ChartUtils.hexToARGB(hex));

            // Paint 용도별 분리 및 사전 스타일 설정
            const backgroundPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            backgroundPaint.setARGB(bgARGB[0], bgARGB[1], bgARGB[2], bgARGB[3]);

            const slicePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            slicePaint.setStyle(Paint.Style.FILL);

            const legendPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            legendPaint.setStyle(Paint.Style.FILL);

            const textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            textPaint.setARGB(txtARGB[0], txtARGB[1], txtARGB[2], txtARGB[3]);
            textPaint.setTextSize(35);
            textPaint.setTextAlign(Paint.Align.LEFT);

            // 비트맵 및 캔버스 준비
            ChartUtils.ensureDirectoryExists(path);
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            const canvas = new Canvas(bitmap);

            canvas.drawPaint(backgroundPaint);
            const totalValue = data.reduce((acc, cur) => acc + cur.value, 0);

            if (totalValue === 0) {
                textPaint.setTextAlign(Paint.Align.CENTER);
                canvas.drawText("데이터가 없습니다.", width / 2, height / 2, textPaint);
            } else {
                // 차트 및 범례 좌표 계산
                const chartRadius = Math.min(width, height) * 0.35;
                const centerX = width * 0.3;
                const centerY = height / 2;
                const chartRect = new RectF(centerX - chartRadius, centerY - chartRadius, centerX + chartRadius, centerY + chartRadius);

                let startAngle = -90;
                let legendX = centerX + chartRadius + 80;
                let legendY = (height - (data.length * 60)) / 2;

                // 렌더링 루프
                for (let i = 0, len = data.length; i < len; i++) {
                    let item = data[i];
                    let sweepAngle = (item.value / totalValue) * 360;
                    let argb = sliceARGBs[i % sliceARGBs.length];

                    slicePaint.setARGB(argb[0], argb[1], argb[2], argb[3]);
                    canvas.drawArc(chartRect, startAngle, sweepAngle, true, slicePaint);

                    legendPaint.setARGB(argb[0], argb[1], argb[2], argb[3]);
                    canvas.drawRect(legendX, legendY, legendX + 40, legendY + 40, legendPaint);

                    let percentage = (item.value / totalValue * 100).toFixed(1);
                    canvas.drawText(`${item.label} (${percentage}%)`, legendX + 60, legendY + 35, textPaint);

                    legendY += 60;
                    startAngle += sweepAngle;
                }
            }

            // 파일 저장
            stream = new FileOutputStream(path);
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream);

            if (autoDelete) {
                ChartUtils.scheduleAutoDelete(path, deleteDelay);
            }

            return path;

        } catch (e) {
            Log.e(`${e.name}\n${e.message}\n${e.stack}`);
            return null;
        } finally {
            // 리소스 해제
            if (stream) stream.close();
            if (bitmap) bitmap.recycle();
        }
    }


    /**
     * @description 데이터 기반 막대 그래프 생성, 파일 저장
     * @param {object} options 그래프 생성 옵션
     * @param {string} options.path 이미지 저장 전체 경로
     * @param {Array<{label: string, value: number}>} options.data 그래프 데이터 배열
     * @param {number} [options.width=1080] 이미지 너비
     * @param {number} [options.height=720] 이미지 높이
     * @param {string} [options.orientation='vertical'] 그래프 방향 ('vertical' 또는 'horizontal')
     * @param {string} [options.title=''] 그래프 제목
     * @param {string} [options.backgroundColor='#FFFFFF'] 배경색
     * @param {string} [options.barColor='#4682B4'] 막대 색상 (SteelBlue)
     * @param {string} [options.axisColor='#646464'] 축 색상
     * @param {string} [options.textColor='#000000'] 텍스트 색상
     * @param {string} [options.titleColor='#000000'] 제목 색상
     * @returns {string|null} 저장 파일 경로 | null
     */
    function createBarChart(options) {
        const defaults = {
            path: null,
            autoDelete: false,
            deleteDelay: 60000,
            width: 1080,
            height: 720,
            orientation: 'vertical',
            title: '',
            backgroundColor: '#FFFFFF',
            barColor: '#4682B4',
            axisColor: '#646464',
            textColor: '#000000',
            titleColor: '#000000'
        };
        const config = ChartUtils.mergeOptions(defaults, options);
        const { width, height, orientation, title, data } = config;
        
        let path = config.path;
        if (!path) {
            const timestamp = Date.now();
            path = `sdcard/msgbot/charts/barChart_${timestamp}.png`;
        }

        const dataLen = data ? data.length : 0;
        if (!data || dataLen === 0) {
            Log.e("BarChart 생성 오류: 데이터가 비어있습니다.");
            return null;
        }

        let bitmap = null;
        let stream = null;
        try {
            ChartUtils.ensureDirectoryExists(path);
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            const canvas = new Canvas(bitmap);

            const bgARGB = ChartUtils.hexToARGB(config.backgroundColor);
            const barARGB = ChartUtils.hexToARGB(config.barColor);
            const axisARGB = ChartUtils.hexToARGB(config.axisColor);
            const textARGB = ChartUtils.hexToARGB(config.textColor);
            const titleARGB = ChartUtils.hexToARGB(config.titleColor);

            const bgPaint = new Paint();
            bgPaint.setARGB(bgARGB[0], bgARGB[1], bgARGB[2], bgARGB[3]);

            const barPaint = new Paint();
            barPaint.setARGB(barARGB[0], barARGB[1], barARGB[2], barARGB[3]);
            barPaint.setStyle(Paint.Style.FILL);

            const axisPaint = new Paint();
            axisPaint.setARGB(axisARGB[0], axisARGB[1], axisARGB[2], axisARGB[3]);
            axisPaint.setStrokeWidth(4);

            const textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            textPaint.setARGB(textARGB[0], textARGB[1], textARGB[2], textARGB[3]);
            textPaint.setTextSize(35);
            textPaint.setTextAlign(Paint.Align.CENTER);

            const titlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            titlePaint.setARGB(titleARGB[0], titleARGB[1], titleARGB[2], titleARGB[3]);
            titlePaint.setTextSize(60);
            titlePaint.setTextAlign(Paint.Align.CENTER);
            titlePaint.setFakeBoldText(true);

            canvas.drawPaint(bgPaint);

            const padding = { top: 150, right: 50, bottom: 150, left: 150 };
            const graphWidth = width - padding.left - padding.right;
            const graphHeight = height - padding.top - padding.bottom;
            const maxValue = Math.max.apply(null, data.map(item => item.value)) || 1;

            if (title) {
                canvas.drawText(title, width / 2, padding.top / 2 + 20, titlePaint);
            }
            
            if (orientation === 'vertical') {
                canvas.drawLine(padding.left, padding.top, padding.left, padding.top + graphHeight, axisPaint);
                canvas.drawLine(padding.left, padding.top + graphHeight, padding.left + graphWidth, padding.top + graphHeight, axisPaint);
            } else { // horizontal
                const xAxisY = padding.top + graphHeight + height * 0.04;
                canvas.drawLine(padding.left, padding.top, padding.left, xAxisY, axisPaint);
                canvas.drawLine(padding.left, xAxisY, padding.left + graphWidth, xAxisY, axisPaint);
            }

            if (orientation === 'vertical') {
                let barWidth = graphWidth / (dataLen * 1.5);
                let barSpacing = barWidth * 0.5;

                let i = 0;
                for (let item of data) {
                    let barHeight = (item.value / maxValue) * graphHeight;
                    let left = padding.left + barSpacing + i * (barWidth + barSpacing);
                    let top = padding.top + graphHeight - barHeight;
                    let right = left + barWidth;
                    let bottom = padding.top + graphHeight;

                    canvas.drawRect(left, top, right, bottom, barPaint);
                    canvas.drawText(item.label, left + barWidth / 2, bottom + 45, textPaint);
                    canvas.drawText(String(item.value), left + barWidth / 2, top - 15, textPaint);
                    i++;
                }
            } else { // horizontal
                let barHeight = graphHeight / (dataLen * 1.5);
                let barSpacing = barHeight * 0.5;
                
                let labelPaint = new Paint(textPaint);
                labelPaint.setTextAlign(Paint.Align.RIGHT);
                
                let valuePaint = new Paint(textPaint);
                valuePaint.setTextAlign(Paint.Align.LEFT);

                let i = 0;
                for (let item of data) {
                    let barWidth = (item.value / (maxValue * 1.1)) * graphWidth; // 우측에 닿는 것 방지용 간격
                    let left = padding.left;
                    let top = padding.top + barSpacing + i * (barHeight + barSpacing);
                    let right = left + barWidth;
                    let bottom = top + barHeight;

                    canvas.drawRect(left, top, right, bottom, barPaint);
                    canvas.drawText(item.label, left - 20, top + barHeight / 2 + 15, labelPaint);
                    canvas.drawText(String(item.value), right + 20, top + barHeight / 2 + 15, valuePaint);
                    i++;
                }
            }

            stream = new FileOutputStream(path);
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream);

            if (config.autoDelete) ChartUtils.scheduleAutoDelete(path, config.deleteDelay);

            return path;

        } catch (e) {
            Log.e(`${e.name}\n${e.message}\n${e.stack}`);
            return null;
        } finally {
            if (stream) stream.close();
            if (bitmap) bitmap.recycle();
        }
    }


    /**
     * @description 데이터 기반 산점도 그래프 생성, 파일 저장
     * @param {object} options 그래프 생성 옵션
     * @param {string} options.path 이미지 저장 전체 경로
     * @param {Array<{x: number, y: number}>} options.data 그래프 데이터 배열
     * @param {number} [options.width=1000] 이미지 너비
     * @param {number} [options.height=800] 이미지 높이
     * @param {string} [options.title='산점도 그래프'] 그래프 제목
     * @param {string} [options.xLabel='X축'] X축 레이블
     * @param {string} [options.yLabel='Y축'] Y축 레이블
     * @param {boolean} [options.showConfidenceInterval=false] 추세선 및 신뢰구간 표시 여부
     * @param {string} [options.backgroundColor='#FFFFFF'] 배경색
     * @param {string} [options.pointColor='#FF6347'] 점 색상
     * @param {string} [options.regressionLineColor='#0000FF'] 추세선 색상
     * @param {string} [options.confidenceIntervalColor='#4682B4'] 신뢰구간 영역 색상
     * @returns {string|null} 저장 파일 경로 | null
     */
    function createScatterPlot(options) {
        const defaults = {
            path: null,
            autoDelete: false,
            deleteDelay: 60000,
            width: 1000,
            height: 800,
            padding: 100,
            title: '산점도 그래프',
            xLabel: 'X축',
            yLabel: 'Y축',
            pointSize: 10,
            fontSize: 40,
            backgroundColor: '#FFFFFF',
            axisColor: '#000000',
            textColor: '#333333',
            pointColor: '#FF6347',
            showConfidenceInterval: false,
            regressionLineColor: '#0000FF',
            confidenceIntervalColor: '#4682B4',
            confidenceIntervalResolution: 100
        };
        const config = ChartUtils.mergeOptions(defaults, options);

        if (!config.path) {
            const timestamp = Date.now();
            config.path = `sdcard/msgbot/charts/scatterPlot_${timestamp}.png`;
        }

        if (!config.data) {
            Log.e("ScatterPlot 생성 오류: 필수 옵션(data)이 누락되었습니다.");
            return null;
        }

        let bitmap = null;
        let stream = null;
        try {
            ChartUtils.ensureDirectoryExists(config.path);
            bitmap = Bitmap.createBitmap(config.width, config.height, Bitmap.Config.ARGB_8888);
            const canvas = new Canvas(bitmap);

            const bgColor = ChartUtils.hexToARGB(config.backgroundColor);
            const axisColor = ChartUtils.hexToARGB(config.axisColor);
            const textColor = ChartUtils.hexToARGB(config.textColor);
            const pointColor = ChartUtils.hexToARGB(config.pointColor);
            const regressionLineColor = ChartUtils.hexToARGB(config.regressionLineColor);
            const ciColor = ChartUtils.hexToARGB(config.confidenceIntervalColor);

            const bgPaint = new Paint();
            bgPaint.setARGB(bgColor[0], bgColor[1], bgColor[2], bgColor[3]);
            canvas.drawPaint(bgPaint);

            const axisPaint = new Paint();
            axisPaint.setARGB(axisColor[0], axisColor[1], axisColor[2], axisColor[3]);
            axisPaint.setStrokeWidth(5);

            const textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            textPaint.setARGB(textColor[0], textColor[1], textColor[2], textColor[3]);
            textPaint.setTextSize(config.fontSize);
            textPaint.setTextAlign(Paint.Align.CENTER);

            const pointPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            pointPaint.setARGB(pointColor[0], pointColor[1], pointColor[2], pointColor[3]);

            const regressionPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            regressionPaint.setARGB(regressionLineColor[0], regressionLineColor[1], regressionLineColor[2], regressionLineColor[3]);
            regressionPaint.setStrokeWidth(4);

            const ciPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            ciPaint.setARGB(60, ciColor[1], ciColor[2], ciColor[3]); // 60/255 투명도

            if (config.data.length === 0) {
                canvas.drawText("표시할 데이터가 없습니다.", config.width / 2, config.height / 2, textPaint);
            } else {
                const { width, height, padding: p, data } = config;

                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                for (let i = 0; i < data.length; i++) {
                    let point = data[i];
                    if (point.x < minX) minX = point.x;
                    if (point.x > maxX) maxX = point.x;
                    if (point.y < minY) minY = point.y;
                    if (point.y > maxY) maxY = point.y;
                }

                const drawableWidth = width - 2 * p;
                const drawableHeight = height - 2 * p;
                const xRange = maxX - minX || 1;
                const yRange = maxY - minY || 1;

                const toPixelX = val => p + ((val - minX) / xRange) * drawableWidth;
                const toPixelY = val => (height - p) - ((val - minY) / yRange) * drawableHeight;

                canvas.drawLine(p, height - p, width - p, height - p, axisPaint);
                canvas.drawLine(p, height - p, p, p, axisPaint);
                canvas.drawText(config.title, width / 2, p / 2, textPaint);
                canvas.drawText(config.xLabel, width / 2, height - p / 4, textPaint);

                canvas.save();
                canvas.rotate(-90, p / 2.5, height / 2);
                canvas.drawText(config.yLabel, p / 2.5, height / 2, textPaint);
                canvas.restore();

                if (config.showConfidenceInterval) {
                    const regression = ChartUtils.calculateLinearRegression(data);
                    if (regression) {
                        const startY = regression.slope * minX + regression.intercept;
                        const endY = regression.slope * maxX + regression.intercept;
                        canvas.drawLine(toPixelX(minX), toPixelY(startY), toPixelX(maxX), toPixelY(endY), regressionPaint);

                        if (regression.n > 2 && regression.Sxx > 0) {
                            const t_value = 1.96; // 95% 신뢰수준 근사치
                            const ciPath = new Path();
                            const upperPoints = [], lowerPoints = [];

                            const resolution = config.confidenceIntervalResolution;
                            for (let i = 0; i <= resolution; i++) {
                                let currentX = minX + (xRange / resolution) * i;
                                let predictedY = regression.slope * currentX + regression.intercept;
                                let se = regression.residualStdErr * Math.sqrt((1 / regression.n) + ((currentX - regression.meanX) ** 2) / regression.Sxx);
                                let marginOfError = t_value * se;

                                upperPoints.push({ x: toPixelX(currentX), y: toPixelY(predictedY + marginOfError) });
                                lowerPoints.push({ x: toPixelX(currentX), y: toPixelY(predictedY - marginOfError) });
                            }

                            ciPath.moveTo(upperPoints[0].x, upperPoints[0].y);
                            for (let i = 1; i < upperPoints.length; i++) ciPath.lineTo(upperPoints[i].x, upperPoints[i].y);
                            for (let i = lowerPoints.length - 1; i >= 0; i--) ciPath.lineTo(lowerPoints[i].x, lowerPoints[i].y);
                            ciPath.close();

                            canvas.save();
                            canvas.clipRect(p, p, width - p, height - p);
                            canvas.drawPath(ciPath, ciPaint);
                            canvas.restore();
                        }
                    }
                }

                for (let i = 0; i < data.length; i++) {
                    let point = data[i];
                    canvas.drawCircle(toPixelX(point.x), toPixelY(point.y), config.pointSize, pointPaint);
                }
            }

            stream = new FileOutputStream(config.path);
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream);

            if (config.autoDelete) {
                ChartUtils.scheduleAutoDelete(config.path, config.deleteDelay);
            }

            return config.path;

        } catch (e) {
            Log.e(`${e.name}\n${e.message}\n${e.stack}`);
            return null;
        } finally {
            if (stream) stream.close();
            if (bitmap) bitmap.recycle();
        }
    }


    /**
     * @description 정규분포 그래프 생성, 파일 저장
     * @param {object} options 그래프 생성 옵션
     * @param {string} options.path 이미지 저장 전체 경로
     * @param {number} [options.mean=0] 분포의 평균
     * @param {number} [options.stdDev=1] 분포의 표준편차
     * @param {number} [options.width=1024] 이미지 너비
     * @param {number} [options.height=600] 이미지 높이
     * @param {string} [options.orientation='vertical'] 그래프 방향 ('vertical' 또는 'horizontal')
     * @param {string} [options.backgroundColor='#FFFFFF'] 배경색
     * @param {string} [options.axisColor='#969696'] 축 색상
     * @param {string} [options.lineColor='#007AFF'] 그래프 선 색상
     * @param {Array<object>} [options.confidenceLevels] 신뢰구간 설정 배열. 예: [{ level: 0.95, color: '#504287F5' }]
     * @returns {string|null} 저장 파일 경로 | null
     */
    function createNormalDistributionChart(options) {
        const Z_SCORES = { 0.68: 1.0, 0.95: 1.96, 0.99: 2.58 };

        const defaults = {
            path: null,
            autoDelete: false,
            deleteDelay: 60000,
            mean: 0,
            stdDev: 1,
            width: 1024,
            height: 600,
            orientation: 'vertical',
            ciResolution: null,
            backgroundColor: '#FFFFFF',
            axisColor: '#969696',
            lineColor: '#007AFF',
            confidenceLevels: [
                { level: 0.95, color: '#504287F5' },
                { level: 0.68, color: '#7877BEFD' }
            ]
        };
        const config = ChartUtils.mergeOptions(defaults, options);
        const { mean, stdDev, width, height, orientation, backgroundColor, axisColor, lineColor, confidenceLevels } = config;
        
        const primaryAxisSize = (orientation === 'vertical') ? width : height;
        const ciResolution = config.ciResolution || primaryAxisSize;

        if (!config.path) {
            const timestamp = Date.now();
            config.path = `sdcard/msgbot/charts/normalDistributionChart_${timestamp}.png`;
        }

        const sortedConfidenceLevels = confidenceLevels
            .slice()
            .sort((a, b) => b.level - a.level)
            .map(ci => {
                let newCi = {};
                for (let key in ci) {
                    if (Object.prototype.hasOwnProperty.call(ci, key)) {
                        newCi[key] = ci[key];
                    }
                }
                newCi.argb = ChartUtils.hexToARGB(ci.color);
                return newCi;
            });

        let bitmap = null;
        let stream = null;
        try {
            ChartUtils.ensureDirectoryExists(config.path);
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            const canvas = new Canvas(bitmap);

            const bgPaint = new Paint();
            let c = ChartUtils.hexToARGB(backgroundColor);
            bgPaint.setARGB(c[0], c[1], c[2], c[3]);

            const axisPaint = new Paint();
            c = ChartUtils.hexToARGB(axisColor);
            axisPaint.setARGB(c[0], c[1], c[2], c[3]);
            axisPaint.setStrokeWidth(2);

            const linePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            c = ChartUtils.hexToARGB(lineColor);
            linePaint.setARGB(c[0], c[1], c[2], c[3]);
            linePaint.setStrokeWidth(5);
            linePaint.setStyle(Paint.Style.STROKE);

            const confidencePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
            confidencePaint.setStyle(Paint.Style.FILL);
            
            const ciPath = new Path();
            const graphPath = new Path();

            canvas.drawPaint(bgPaint);

            const range = 3.5 * stdDev;
            const minXData = mean - range;
            const maxXData = mean + range;
            const xDataRange = maxXData - minXData;

            const pdfCache = new Float32Array(primaryAxisSize);
            let maxYData = 0;
            for (let i = 0; i < primaryAxisSize; i++) {
                let dataX = minXData + xDataRange * (i / (primaryAxisSize - 1));
                let pdfVal = ChartUtils.pdf(dataX, mean, stdDev);
                pdfCache[i] = pdfVal;
                if (pdfVal > maxYData) {
                    maxYData = pdfVal;
                }
            }
            if (maxYData === 0) maxYData = 1;

            for (let ci of sortedConfidenceLevels) {
                let z = Z_SCORES[ci.level];
                if (!z) continue;

                ciPath.reset();
                confidencePaint.setARGB(ci.argb[0], ci.argb[1], ci.argb[2], ci.argb[3]);

                let ciMinX = mean - z * stdDev;
                let ciMaxX = mean + z * stdDev;

                if (orientation === 'vertical') {
                    let startPixel = Math.floor(primaryAxisSize * (ciMinX - minXData) / xDataRange);
                    let endPixel = Math.ceil(primaryAxisSize * (ciMaxX - minXData) / xDataRange);
                    
                    ciPath.moveTo(startPixel, height);
                    for (let i = 0; i <= ciResolution; i++) {
                        let p = Math.round(startPixel + (endPixel - startPixel) * (i / ciResolution));
                        if (p < 0 || p >= primaryAxisSize) continue;
                        
                        let canvasY = height - (pdfCache[p] / maxYData) * (height * 0.9);
                        ciPath.lineTo(p, canvasY);
                    }
                    ciPath.lineTo(endPixel, height);
                    ciPath.close();

                } else {
                    let startPixel = Math.floor(primaryAxisSize * (ciMaxX - minXData) / xDataRange);
                    let endPixel = Math.ceil(primaryAxisSize * (ciMinX - minXData) / xDataRange);

                    ciPath.moveTo(0, primaryAxisSize - startPixel);
                    for (let i = 0; i <= ciResolution; i++) {
                        let p = Math.round(startPixel + (endPixel - startPixel) * (i / ciResolution));
                        if (p < 0 || p >= primaryAxisSize) continue;

                        let canvasX = (pdfCache[p] / maxYData) * (width * 0.9);
                        ciPath.lineTo(canvasX, primaryAxisSize - p);
                    }
                    ciPath.lineTo(0, primaryAxisSize - endPixel);
                    ciPath.close();
                }
                canvas.drawPath(ciPath, confidencePaint);
            }

            if (orientation === 'vertical') {
                canvas.drawLine(0, height - 1, width, height - 1, axisPaint);
                canvas.drawLine(width / 2, 0, width / 2, height, axisPaint);
            } else {
                canvas.drawLine(1, 0, 1, height, axisPaint);
                canvas.drawLine(0, height / 2, width, height / 2, axisPaint);
            }

            if (orientation === 'vertical') {
                graphPath.moveTo(0, height - (pdfCache[0] / maxYData) * (height * 0.9));
                for (let i = 1; i < width; i++) {
                    let canvasY = height - (pdfCache[i] / maxYData) * (height * 0.9);
                    graphPath.lineTo(i, canvasY);
                }
            } else {
                graphPath.moveTo((pdfCache[0] / maxYData) * (width * 0.9), height);
                for (let i = 1; i < height; i++) {
                    let canvasX = (pdfCache[i] / maxYData) * (width * 0.9);
                    graphPath.lineTo(canvasX, height - i);
                }
            }
            canvas.drawPath(graphPath, linePaint);

            stream = new FileOutputStream(config.path);
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream);

            if (config.autoDelete) {
                ChartUtils.scheduleAutoDelete(config.path, config.deleteDelay);
            }

            return config.path;

        } catch (e) {
            Log.e(`${e.name}\n${e.message}\n${e.stack}`);
            return null;
        } finally {
            if (stream) stream.close();
            if (bitmap) bitmap.recycle();
        }
    }


    const Chart = {
        createFunctionGraph,
        createPolarGraph,
        createLineChart,
        createPieChart,
        createBarChart,
        createScatterPlot,
        createNormalDistributionChart
    };

    module.exports = Chart;
})();