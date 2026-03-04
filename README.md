# INFINITAS Rank Table Maker

`tracker.tsv`를 업로드해 `SP11H`, `SP12H` Hard Gauge 서열표 기반으로 기록을 관리하는 Electron 데스크톱 앱입니다.

## 기능
- `tracker.tsv` 불러오기
- beatmania.app의 `SP11H`, `SP12H` 서열표 자동 반영
- 카테고리별 램프/EX 점수/레이트 표시
- 업데이트 히스토리(직전 대비 개선 차트 수 포함)
- 목표 설정 및 달성 여부 표시
- 현재 서열표 PNG 저장

## 실행
1. 의존성 설치
```bash
npm install
```
2. 실행
```bash
npm start
```

## 참고
- 서열표 데이터 출처: `https://beatmania.app/!/SP11H/`, `https://beatmania.app/!/SP12H/`
- 히스토리/목표 데이터는 Electron `userData/state.json`에 저장됩니다.
