# Install OpenPose

本工具不包含 OpenPose 本体。请准备可运行的 OpenPose，并在界面填写：

```text
OpenPoseDemo.exe: C:\openpose\bin\OpenPoseDemo.exe
models folder:    C:\openpose\models
```

如需使用 `--hand` 或 `--face`，请确认模型文件存在：

```text
C:\openpose\models\hand\pose_iter_102000.caffemodel
C:\openpose\models\face\pose_iter_116000.caffemodel
```

如果只做全身动作分析，优先使用 BODY_25 only。
