# 咀嚼-音乐研究网站 设计文档

**日期：** 2026-05-24
**作者：** perseusyang（与 Claude 协作）
**状态：** Draft

## 1. 目的

搭建一个网站，用于研究**音乐类型（古典 vs 嘻哈）对进食时咀嚼行为的影响**。

参与者用手机摄像头对着自己进食，浏览器本地实时分析嘴部运动，记录咀嚼频率、每口咀嚼数、总进食时长。结束后用户可自愿上传**匿名聚合结果**到后端供研究者分析。

非目标：本网站不做统计分析，分析由研究者用导出的 CSV 自行完成。

## 2. 范围与限制

- **部署范围：** 本地实验/小规模招募（<50 人），运行在研究者电脑或一台服务器上，通过局域网 IP 或 ngrok 暴露 HTTPS URL 给参与者
- **设备：** 主要支持现代手机浏览器（iOS Safari 16+ / Android Chrome），桌面浏览器也兼容
- **隐私：** 摄像头视频帧仅在浏览器内处理，**绝不上传**。仅上传去身份化的聚合统计 + 咀嚼事件时间戳列表
- **数据上传是 opt-in：** 用户在结果页主动点击"上传匿名结果"才发请求

## 3. 系统架构

```
浏览器（HTTPS）
├─ MediaPipe FaceMesh（CDN）→ 嘴部坐标
├─ 自适应峰值检测 → 咀嚼事件
├─ HTMLAudioElement → MP3 播放
└─ Chart.js（CDN）→ 结果可视化
        │
        │ GET /api/playlist?genre={classical|hiphop}
        │ GET /music/<filename>.mp3
        │ POST /api/sessions（仅 opt-in）
        ▼
FastAPI 后端（uvicorn）
├─ 路由：/api/playlist, /api/sessions, /api/health
├─ 静态：/  (前端) ，/music/ (mp3 库)
└─ SQLite：sessions.db
        ▲
        │ （离线，独立）
scripts/generate_music.py
└─ audiocraft / MusicGen → backend/music/{classical,hiphop}/
```

**关键架构决定：**

- **前后端分离：** 前端是无打包的静态页面（HTML/CSS + ES modules），后端是 FastAPI
- **AI 音乐离线生成：** 不在 web 请求路径上跑 audiocraft，避免 GPU 依赖和延迟
- **视频帧不离开浏览器：** 仅上传聚合结果
- **数据上传 opt-in：** 用户主动点上传按钮才提交

## 4. 前端：页面流程

四个页面，单页应用形态，路由用 `history.pushState` 切换 view（无需框架）：

### 4.1 同意页 `#/consent`
- 实验目的、流程说明
- 隐私声明（明确：摄像头帧仅本地处理、绝不上传视频、上传的数据只有聚合统计且匿名、可随时退出）
- 同意 checkbox（必须勾选）+ "我同意，继续"按钮

### 4.2 选择页 `#/setup`
- **食物类型**（单选）：中式点菜 / 牛排 / 轻食 / 寿司 / 西式（披萨/汉堡/意面/面包）
- **音乐类型**（单选）：古典（缓） / 嘻哈（律动）
- "开始记录"按钮 → 请求摄像头权限 → 进入录制页

### 4.3 录制页 `#/recording`
**显示内容（极简，避免观察者效应）：**
- 顶部：计时器（mm:ss）
- 中间：当前播放曲目名 + "正在检测"状态灯（绿/红）
- 底部：大号"结束记录"按钮

**不显示：** 咀嚼次数、频率、实时曲线、摄像头预览（防止用户因为看到自己的脸或数据而改变咀嚼行为）

**后台运行：**
- MediaPipe FaceMesh 持续从 `<video>` 元素取帧
- 检测引擎每帧更新 mouth_open 时间序列、检测峰值、累积事件
- 音频引擎按顺序播放预生成 mp3，记录每首曲目的播放起止时间
- 没有面部识别到时，状态灯转红，但**继续计时**（数据点中标记"无人脸"）

### 4.4 结果页 `#/results`
**显示：**
- 概览卡片：总时长、总咀嚼次数、平均咀嚼频率（次/分钟）、平均每口咀嚼数、总口数、音乐类型、播放曲数
- 咀嚼频率随时间变化曲线（Chart.js 折线图，X=时间，Y=每 10 秒咀嚼次数）
- 每口咀嚼数分布柱状图（X=口序号，Y=该口咀嚼次数）
- "上传匿名结果"按钮（点了发 POST，成功后变成"已上传，感谢配合"）
- "再来一次"按钮 → 回到选择页

## 5. 咀嚼检测算法

**输入：** MediaPipe FaceMesh 每帧给出的 478 个 3D 面部 landmarks。

**核心特征：归一化嘴开口度**
```
mouth_open(t) = |landmark_upper_lip_center - landmark_lower_lip_center| / face_width
```
- `upper_lip_center` ≈ landmark 13；`lower_lip_center` ≈ landmark 14（待实测确认）
- `face_width` = 左脸颊到右脸颊（如 landmark 234 和 454 的距离），用于消除"用户离手机远近"的影响

**采样率：** 浏览器 `requestVideoFrameCallback`，预期 ~30fps。如设备性能不足，降级到 `requestAnimationFrame` 限频到 15fps。

**算法：自适应阈值峰值检测**

1. **滑动统计窗口：** 保留最近 30 秒的 `mouth_open` 样本，持续更新均值 μ 和标准差 σ
2. **峰值条件：** 当前帧的 `mouth_open` 满足
   - 大于 μ + k·σ（k 初始 = 1.5，可在 config 里调）
   - 是局部极大值（前 5 帧与后 5 帧都比它小）→ 实现上做 5 帧延迟的实时检测
   - 距离上一个已记录峰值 ≥ 200ms（5Hz 上限，超过这个就是误检）
3. **暖机：** 前 10 秒不报峰值，让滑动统计有意义；UI 状态灯先黄后绿

**每口咀嚼数：每口由停顿划分**
- 维护"当前口"计数器
- 每检测到一个峰值，"当前口"+1
- 如果已经 ≥ 1.5 秒没有新峰值，且"当前口" ≥ 2，则结束当前口：把它加入 `bites` 列表，重置计数器
- 如果"当前口" < 2 个峰值就停顿了，视为噪声/误检，不算一口（也不计入总数）

**实时频率指标（仅用于结果页计算，录制中不显示）：**
- 每 10 秒一个 bucket，bucket 内的峰值数 ÷ 10 = 该 bucket 的 Hz
- 全段平均频率 = 总峰值数 ÷ 总时长

**降级与异常：**
- 若 FaceMesh 连续 > 1 秒检测不到面部：状态灯转红，时间序列里这段标记 `no_face=true`，不计入峰值检测窗口
- 若摄像头权限被拒：录制页显示错误，不允许进入录制

## 6. 后端：API 和数据模型

### 6.1 路由

| Method | Path                            | 说明                                          |
|--------|---------------------------------|-----------------------------------------------|
| GET    | `/api/health`                   | 健康检查，返回 `{"status":"ok"}`              |
| GET    | `/api/playlist?genre=classical` | 返回该 genre 的随机洗牌后的 mp3 文件名列表    |
| POST   | `/api/sessions`                 | 上传一个 session 的聚合结果                   |
| GET    | `/music/<filename>.mp3`         | 静态文件，预生成的 mp3                        |
| GET    | `/`, `/static/*`                | 前端静态文件                                  |

### 6.2 `GET /api/playlist` 响应
```json
{
  "genre": "classical",
  "tracks": [
    {"id": "cl_03", "filename": "cl_03.mp3", "title": "Classical #3", "duration_sec": 45},
    {"id": "cl_07", "filename": "cl_07.mp3", "title": "Classical #7", "duration_sec": 52}
  ]
}
```
后端读取 `music/{genre}/` 下的所有 mp3，洗牌后返回。`title` 来自伴随的 `manifest.json`（generate_music.py 生成）。

### 6.3 `POST /api/sessions` 请求体
```json
{
  "session_id": "uuid-v4-from-client",
  "started_at": "2026-05-24T18:30:00Z",
  "ended_at": "2026-05-24T18:45:23Z",
  "duration_sec": 923,
  "food_type": "steak",
  "music_genre": "hiphop",
  "tracks_played": ["hh_02", "hh_05", "hh_01"],
  "total_chews": 412,
  "total_bites": 28,
  "avg_chew_freq_hz": 0.45,
  "avg_chews_per_bite": 14.7,
  "chew_freq_buckets_10s": [0.3, 0.5, 0.6, ...],
  "bites": [
    {"start_ms": 4200, "end_ms": 13500, "chew_count": 18},
    {"start_ms": 21000, "end_ms": 30200, "chew_count": 16}
  ],
  "chew_events_ms": [4250, 4710, 5180, ...],
  "client_info": {
    "user_agent": "Mozilla/5.0...",
    "viewport": "390x844",
    "fps_observed": 28.5
  }
}
```

**重要：** 不含任何视频/图像数据，不含 IP 或用户标识。`session_id` 由客户端生成 UUID，仅用于防止重复上传。

### 6.4 SQLite schema

```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  uploaded_at TEXT NOT NULL,        -- 服务端接收时间
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_sec INTEGER NOT NULL,
  food_type TEXT NOT NULL,
  music_genre TEXT NOT NULL,
  tracks_played_json TEXT NOT NULL, -- JSON array
  total_chews INTEGER NOT NULL,
  total_bites INTEGER NOT NULL,
  avg_chew_freq_hz REAL NOT NULL,
  avg_chews_per_bite REAL NOT NULL,
  chew_freq_buckets_json TEXT NOT NULL,
  bites_json TEXT NOT NULL,
  chew_events_json TEXT NOT NULL,
  client_info_json TEXT NOT NULL
);
```

### 6.5 CSV 导出脚本

`scripts/export_csv.py`：把 SQLite 里所有 sessions 导出为两个 CSV：
- `sessions_summary.csv`：每行一个 session，聚合字段
- `bites_long.csv`：每行一口（长格式），便于 pandas 分析

## 7. AI 音乐生成（离线脚本）

`scripts/generate_music.py`：

- 使用 audiocraft 的 MusicGen 模型（`facebook/musicgen-small` 或 `medium`）
- 两组 prompts：
  - **classical：** "slow tempo classical chamber music, soft tones, gentle, low volume, peaceful piano and strings, no percussion, 60 BPM"
  - **hiphop：** "upbeat hip-hop instrumental, medium tempo, rhythmic drums, bass groove, head-nodding beat, 90 BPM"
- 每组生成 N 首（默认 10 首），每首 30-60 秒
- 输出到 `backend/music/classical/cl_NN.mp3` 和 `backend/music/hiphop/hh_NN.mp3`
- 同时写 `backend/music/{genre}/manifest.json`，包含每首的 id, filename, title, duration_sec

参数化：`python scripts/generate_music.py --genre classical --count 10 --duration 45`

**不在 web 服务里跑**。研究者本地用 GPU 跑一次，把生成的 mp3 提交到仓库（或单独同步）。

## 8. 文件结构

```
chewing-music-study/
├── README.md
├── docs/
│   └── superpowers/specs/2026-05-24-chewing-music-study-design.md
├── backend/
│   ├── pyproject.toml          # 或 requirements.txt
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py             # FastAPI app
│   │   ├── routes.py           # 路由
│   │   ├── db.py               # SQLite 连接
│   │   ├── schemas.py          # Pydantic 模型
│   │   └── playlist.py         # 读取 music/ 目录、洗牌
│   ├── music/
│   │   ├── classical/          # mp3 + manifest.json
│   │   └── hiphop/             # mp3 + manifest.json
│   ├── data/
│   │   └── sessions.db         # SQLite（运行时生成，gitignore）
│   └── tests/
│       ├── test_routes.py
│       └── test_playlist.py
├── frontend/
│   ├── index.html              # 入口，含路由 + 4 个 <template> view
│   ├── styles.css
│   ├── js/
│   │   ├── main.js             # 路由 + 状态
│   │   ├── consent.js
│   │   ├── setup.js
│   │   ├── recording.js
│   │   ├── results.js
│   │   ├── detector.js         # MediaPipe + 峰值检测
│   │   ├── audio_player.js
│   │   └── api.js
│   └── tests/
│       └── detector.test.js    # 喂合成数据进检测器，断言峰值/口数
└── scripts/
    ├── generate_music.py       # audiocraft 离线生成
    └── export_csv.py           # SQLite → CSV
```

## 9. 隐私与同意

**同意页必须明确：**
1. 摄像头会被开启，但**帧数据仅在你的浏览器里处理，绝不上传**
2. 上传的内容**仅**为：食物类型、音乐类型、咀嚼次数和时间戳、每口数据、设备信息（user agent、屏幕尺寸、fps）
3. **不收集**：你的脸、姓名、邮箱、IP、地理位置
4. 上传是**自愿的**——结果页主动点"上传"才会发出
5. 你可以**随时退出**：关闭页面即可，没有任何后台流程

UI 上必须有不打勾就无法继续的"我已阅读并同意"复选框。

## 10. 测试策略

**后端（pytest）：**
- `test_playlist.py`：用临时目录构造 mock 的 mp3 文件 + manifest，断言 `/api/playlist` 返回正确结构和洗牌
- `test_routes.py`：测试 POST `/api/sessions` 校验、写入 SQLite、重复 session_id 处理（幂等返回 200 + 已存在标记）
- 用 `TestClient`（fastapi.testclient），不需要起真服务

**前端（vitest 或 node 原生 test）：**
- `detector.test.js`：把合成时间序列（正弦波模拟咀嚼 + 停顿）喂给检测器，断言峰值数量和每口划分正确
- 不测 MediaPipe 本身，把它的输出抽象成 `mouth_open(t)` 接口便于注入

**手动 E2E：**
- 用真摄像头跑一次完整流程，确认录制 30 秒、停下来、看到结果页有数据
- 在手机 Safari 上跑一次（摄像头权限、HTTPS）

## 11. 实现顺序（按用户要求）

1. **里程碑 1 — 检测引擎可见证：** MediaPipe + 自适应峰值检测，搭一个调试页面，能实时显示 `mouth_open` 曲线和检测出的峰值（这个调试页面之后会移除/隐藏）
2. **里程碑 2 — 完整 session 流程：** 加入路由、4 个页面、计时器、结果页（用占位音乐）
3. **里程碑 3 — AI 音乐：** 先用占位音频（任意 mp3）通流程，然后写 generate_music.py，研究者本地生成真正的曲库
4. **里程碑 4 — 数据收集：** POST /api/sessions + SQLite + CSV 导出脚本

每个里程碑结束做一次手动验证，全部完成后做一次端到端测试。

## 12. 未决问题（实现中再敲定）

- MediaPipe FaceMesh 嘴部 landmark 的最佳 index（13/14 是初步选择，开发时实测调整）
- 峰值检测的 k 值（初始 1.5，根据真实试用结果调）
- 每口停顿阈值（初始 1.5s，调）
- iOS Safari 的摄像头权限 + 后台音频策略（开发时实测）
- 是否需要 HTTPS（手机摄像头 API 强制要求）→ 用 ngrok 或 mkcert 本地证书

这些都不影响架构和模块边界，是实现时的调参问题。
