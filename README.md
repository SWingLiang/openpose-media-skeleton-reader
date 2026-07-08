# OpenPose Media Skeleton Reader

`openpose-media-skeleton-reader` 是一个本地媒体骨架读取与可视化小工具。它可以读取视频或图片，在媒体上叠加 OpenPose 输出的骨架关键点，同时显示音频波形和 RGB 构成分析。

当前版本已经升级为 **React + Vite 前端 + FastAPI 本地后端**：

```text
React / Vite 前端
        ↓ HTTP API
FastAPI 本地后端
        ↓ subprocess
OpenPoseDemo.exe
        ↓
*_keypoints.json
        ↓
前端自动加载并叠加显示
```

> 运行时需要的是 `OpenPoseDemo.exe` 和 `models` 文件夹，不是 OpenPose 源码文件夹。

---

## 功能

- 选择视频或图片。
- 将媒体上传到本地 FastAPI 后端。
- 在前端配置本地 OpenPose 路径。
- 一键调用 `OpenPoseDemo.exe` 分析视频或图片。
- 自动读取 `*_keypoints.json` 并叠加显示骨架。
- 保留手动加载已有 JSON / JSON 文件夹的模式。
- 支持显示或隐藏：骨架连线、关键点、关键点编号、音频波形、RGB 构成。
- 右侧显示当前帧关键点数值表达。

---

## 项目结构

```text
openpose-media-skeleton-reader/
├─ frontend/
│  ├─ index.html
│  ├─ package.json
│  └─ src/
│     ├─ App.jsx
│     ├─ App.css
│     └─ main.jsx
│
├─ backend/
│  ├─ main.py
│  ├─ requirements.txt
│  ├─ uploads/
│  │  └─ .gitkeep
│  └─ outputs/
│     └─ .gitkeep
│
├─ .gitignore
└─ README.md
```

---

## 1. 准备 OpenPose

请先确认本机已经可以运行 OpenPose。Windows 常见路径示例：

```text
OpenPose 程序路径：C:\openpose\bin\OpenPoseDemo.exe
OpenPose models 路径：C:\openpose\models
```

可以先在命令行测试：

```bat
C:\openpose\bin\OpenPoseDemo.exe --help
```

如果 OpenPose 本身不能启动，本工具也无法调用它。

---

## 2. 启动后端

进入后端目录：

```bash
cd backend
```

建议创建虚拟环境：

```bash
python -m venv .venv
```

Windows PowerShell：

```powershell
.\.venv\Scripts\Activate.ps1
```

macOS / Linux：

```bash
source .venv/bin/activate
```

安装依赖：

```bash
pip install -r requirements.txt
```

启动 FastAPI：

```bash
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

后端地址：

```text
http://127.0.0.1:8000
```

健康检查：

```text
http://127.0.0.1:8000/api/health
```

---

## 3. 启动前端

打开另一个终端，进入前端目录：

```bash
cd frontend
```

安装依赖：

```bash
npm install
```

启动 Vite：

```bash
npm run dev
```

前端地址：

```text
http://127.0.0.1:5173
```

---

## 4. 使用流程

### 自动 OpenPose 分析流程

```text
1. 点击“选择媒体”
2. 选择 mp4 / mov / jpg / png 等文件
3. 工具会自动上传媒体到 backend/uploads
4. 输入 OpenPoseDemo.exe 路径
5. 输入 models 文件夹路径
6. 点击“保存设置”
7. 点击“一键分析骨架”
8. 等待任务状态从 queued / running 变为 completed
9. 前端自动读取 backend/outputs/{job_id} 中的 JSON
10. 播放视频或查看图片上的骨架叠加效果
```

### 手动 JSON 读取流程

如果你已经提前用 OpenPose 生成了 JSON，可以不运行后端分析：

```text
1. 选择媒体
2. 点击“选择骨架 JSON”或“选择 JSON 文件夹”
3. 前端直接读取 JSON 并叠加骨架
```

---

## 5. 后端 API

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/config` | 读取 OpenPose 配置 |
| POST | `/api/config` | 保存 `openpose_exe` 和 `model_folder` |
| POST | `/api/upload` | 上传视频或图片到 `backend/uploads` |
| POST | `/api/analyze` | 创建 OpenPose 分析任务 |
| GET | `/api/jobs/{job_id}` | 查询任务状态 |
| GET | `/api/jobs/{job_id}/json-list` | 读取输出 JSON 文件列表 |
| GET | `/api/jobs/{job_id}/json/{filename}` | 读取单个 OpenPose JSON |

---

## 6. OpenPose 调用方式

视频分析时，后端会调用类似命令：

```bat
OpenPoseDemo.exe ^
  --video input.mp4 ^
  --write_json backend\outputs\{job_id} ^
  --display 0 ^
  --render_pose 0 ^
  --model_folder C:\openpose\models
```

图片分析时，后端会把单张图片复制到临时输入文件夹，然后调用：

```bat
OpenPoseDemo.exe ^
  --image_dir input_image_folder ^
  --write_json backend\outputs\{job_id} ^
  --display 0 ^
  --render_pose 0 ^
  --model_folder C:\openpose\models
```

---

## 7. 常见问题

### 保存 OpenPose 配置失败

检查路径是否真实存在。例如：

```text
C:\openpose\bin\OpenPoseDemo.exe
C:\openpose\models
```

不要填写：

```text
C:\openpose\src
```

`src` 是源码目录，不是运行分析需要的路径。

### 点击“一键分析骨架”后任务失败

请检查：

- OpenPose 是否能在命令行单独启动。
- `models` 是否完整下载。
- OpenPose 版本是否匹配你的 CUDA / CPU 环境。
- 媒体文件格式是否被 OpenPose 支持。
- 视频路径中是否有特殊字符。

右侧面板会显示 OpenPose 日志尾部，便于定位错误。

### 视频能播放，但没有骨架

可能原因：

- 没有加载 JSON。
- OpenPose 没有检测到人体。
- FPS 设置与视频实际帧率不一致。
- JSON 坐标来自不同分辨率的视频。

可以先把 FPS 设置为 30；如果视频是 60fps，请改成 60。

### 音频波形读取失败

浏览器的 Web Audio API 对部分视频封装格式支持有限。即使音频波形失败，也不会影响 OpenPose 骨架分析和 JSON 叠加。

### 前端无法连接后端

确认后端正在运行：

```text
http://127.0.0.1:8000/api/health
```

确认前端地址是：

```text
http://127.0.0.1:5173
```

后端已经配置 CORS，允许 `http://localhost:5173` 和 `http://127.0.0.1:5173` 调用。

---

## 8. 开发说明

本工具的运行数据不会提交到 Git：

```text
backend/openpose_config.json
backend/uploads/*
backend/outputs/*
```

`uploads` 和 `outputs` 目录通过 `.gitkeep` 保留结构。

---

## 9. 测试建议

建议按顺序测试：

```text
1. 后端 /api/health 是否正常
2. 前端是否能读取 /api/config
3. 前端是否能上传图片
4. 保存 OpenPoseDemo.exe 和 models 路径
5. 用一张图片测试“一键分析骨架”
6. 再用短视频测试逐帧 JSON 输出
7. 检查播放时骨架、RGB、音频波形是否同步显示
```
