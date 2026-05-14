# 🌿 CCATFARM — 스마트팜 자율주행 로봇 관제 시스템

실내 자율주행 모바일 로봇 기반 작물 생장 모니터링 및 자동 충전 시스템의 웹 대시보드입니다.

## 시스템 구성

```
┌─────────────────────────────────────────────────────────┐
│  모바일 웹 대시보드 (React + TypeScript + Vite)           │
│  작물 모니터링 · 원격 제어 · Emergency Stop               │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket ws://9090
                         │ MJPEG http://8000
┌────────────────────────┴────────────────────────────────┐
│  Raspberry Pi 5 — rosbridge_server · 카메라 RTSP 중계     │
│  /cmd_vel · /odom · /scan · /battery_state               │
└────────────────────────┬────────────────────────────────┘
                         │ ROS2 DDS (내부망)
┌────────────────────────┴────────────────────────────────┐
│  Jetson Orin Nano — SLAM · Nav2 · YOLOv11 추론           │
│  Cartographer · 경로 계획 · 작물 탐지                     │
└─────────────────────────────────────────────────────────┘
```

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드 | React 19, TypeScript, Vite, react-router-dom, lucide-react |
| 로봇 통신 | roslib (CDN), WebSocket, ROS 2 Jazzy |
| 백엔드 | FastAPI, OpenCV (RTSP→MJPEG 변환) |
| 로봇 | STELLA N5, Nav2, Cartographer, AprilTag 도킹 |
| AI | YOLOv11 (작물 병해 탐지) |

## 프로젝트 구조

```
CCATFARM/
├── backend/
│   └── main.py                  # FastAPI + 카메라 MJPEG 스트리밍
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Joystick.tsx     # 아날로그 조이스틱 (터치/마우스)
│   │   │   └── RosMap.tsx       # OccupancyGrid 맵 시각화
│   │   ├── hooks/
│   │   │   ├── useRos.ts        # ROS WebSocket 연결 관리
│   │   │   ├── useBattery.ts    # /battery_state 구독
│   │   │   ├── useCamera.ts     # compressed image 구독
│   │   │   └── useDiagnostics.ts# /diagnostics 구독
│   │   ├── pages/
│   │   │   ├── Home.tsx         # 대시보드 (Zone, 배터리, 알림)
│   │   │   ├── Map.tsx          # 맵 + 카메라 + 조이스틱 제어
│   │   │   ├── Crops.tsx        # 작물 상태 모니터링
│   │   │   └── Settings.tsx     # 사용자 설정
│   │   ├── config/
│   │   │   └── rosTopics.ts     # ROS 2 토픽 정의 문서
│   │   └── utils/
│   │       └── zoneMap.ts       # 좌표 기반 Zone 판별
│   └── index.html
└── README.md
```

## 실행 방법

### 1. 프론트엔드

```bash
cd frontend
npm install
npm run dev
```

→ http://localhost:5173

### 2. 백엔드 (카메라 스트리밍)

```bash
cd backend
pip install fastapi uvicorn opencv-python
uvicorn main:app --reload --host 0.0.0.0
```

→ http://localhost:8000

카메라 IP 변경: `RPI_IP=192.168.0.4 uvicorn main:app --reload`

### 3. 로봇 측 (ROS 2)

```bash
# rosbridge 실행 (웹 앱 연동)
ros2 launch rosbridge_server rosbridge_websocket_launch.xml

# Nav2 + 맵 서버 (자율주행 + /map 토픽)
ros2 launch nav2_bringup bringup_launch.py map:=/path/to/map.yaml
```

### 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `VITE_ROS_URL` | `ws://192.168.0.141:9090` | rosbridge WebSocket 주소 |
| `RPI_IP` | `192.168.0.4` | 라즈베리파이 RTSP 카메라 IP |

## 주요 기능

- 실시간 로봇 위치 모니터링 (`/amcl_pose`) + 좌표 기반 Zone 판별
- 배터리 상태 실시간 표시 (`/battery_state`) + 저전압 경고
- RTSP 카메라 MJPEG 스트리밍 (듀얼 짐벌 카메라)
- OccupancyGrid 맵 시각화 (`/map`)
- EMERGENCY → 아날로그 조이스틱 수동 제어 (`/cmd_vel`)
- 시스템 진단 알림 (`/diagnostics`)

## API 엔드포인트

| 경로 | 설명 |
|------|------|
| `GET /api/camera/1` | 1번 카메라 MJPEG 스트리밍 |
| `GET /api/camera/2` | 2번 카메라 MJPEG 스트리밍 |
| `GET /api/camera/{id}/snapshot` | 단일 프레임 스냅샷 |

## 팀

깻팜 (한밭대학교 컴퓨터공학과 캡스톤디자인)

| 이름 | 역할 |
|------|------|
| 최현석 | Nav Lead — ROS2 환경 구축, Nav2, SLAM |
| 태성우 | HW Architect — 프레임 제작, 액추에이터 |
| 이시우 | Vision/Docking — ArUco 인식, 정밀 정렬 |
| 사민경 | AI/App Dev — YOLOv11, 모바일 앱 UI/UX |
