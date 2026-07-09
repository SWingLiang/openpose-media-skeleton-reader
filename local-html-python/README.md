# OpenPose Media Skeleton Reader v0.3.1

本目录是本地 HTML + Python 版。它通过浏览器界面读取视频/图片，通过本地 Python 服务调用 `OpenPoseDemo.exe`，并叠加显示 BODY_25、Hand、Face、Audio 和 RGB 分析。

## 快速启动

Windows：

```bat
start_windows.bat
```

或手动运行：

```bash
python app.py --open
```

打开：

```text
http://127.0.0.1:8765
```

## 操作流程

```text
选择媒体 → 选择 OpenPose 路径 → 设置模型开关 → 点击一键分析
→ 等待 JSON 生成完毕 → 按需勾选视频预览的显示层
```

## OpenPose 路径

```text
C:\openpose\bin\OpenPoseDemo.exe
C:\openpose\models
```

本仓库不包含 OpenPose 本体。请自行安装或下载 OpenPose portable/compiled version。

## v0.3.1 重点

- Python 状态改成普通文字显示。
- OpenPoseDemo.exe 与 models 支持本地选择按钮。
- 支持直接打开已生成的 OpenPose JSON 文件夹。
- 支持隐藏原视频/图片，只看骨架、点或编号。
- Audio 与 RGB 面板压缩为固定高度。
- 支持 BODY_25、Hand、Face 三类 JSON 叠加显示。
