# Local HTML + Python Version

This repository keeps two usage paths:

```text
frontend/ + backend/      React/Vite + FastAPI version
local-html-python/        v0.3.1 local HTML + Python bridge version
```

Use `local-html-python/` when you want the browser interface to call your local `OpenPoseDemo.exe`.

```bat
cd local-html-python
start_windows.bat
```

OpenPose itself is not included in this repository. Configure the paths in the UI:

```text
C:\openpose\bin\OpenPoseDemo.exe
C:\openpose\models
```
