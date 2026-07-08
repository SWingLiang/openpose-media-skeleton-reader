from __future__ import annotations

import json
import shutil
import subprocess
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="OpenPose Media Skeleton Reader Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
CONFIG_PATH = BASE_DIR / "openpose_config.json"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

jobs: Dict[str, Dict[str, Any]] = {}
jobs_lock = threading.Lock()


class OpenPoseConfig(BaseModel):
    openpose_exe: str
    model_folder: str


class AnalyzeRequest(BaseModel):
    media_id: str
    media_type: str  # "video" or "image"


def _read_config() -> Dict[str, str]:
    if not CONFIG_PATH.exists():
        return {"openpose_exe": "", "model_folder": ""}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"OpenPose 配置文件损坏: {exc}") from exc


def _write_job(job_id: str, **updates: Any) -> None:
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(updates)


def _get_job_snapshot(job_id: str) -> Dict[str, Any]:
    with jobs_lock:
        if job_id not in jobs:
            raise HTTPException(status_code=404, detail="任务不存在")
        return dict(jobs[job_id])


def _detect_media_type(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    raise HTTPException(status_code=400, detail=f"不支持的媒体格式: {suffix}")


def _find_uploaded_media(media_id: str) -> Path:
    matches = sorted(UPLOAD_DIR.glob(f"{media_id}.*"))
    if not matches:
        raise RuntimeError("媒体文件不存在，请重新上传")
    return matches[0]


def _count_json_files(output_dir: Path) -> int:
    if not output_dir.exists():
        return 0
    return len(list(output_dir.glob("*_keypoints.json")))


def _command_for_display(cmd: List[str]) -> str:
    try:
        return subprocess.list2cmdline(cmd)
    except Exception:
        return " ".join(cmd)


@app.get("/api/health")
def health() -> Dict[str, bool]:
    return {"ok": True}


@app.get("/api/config")
def get_config() -> Dict[str, str]:
    return _read_config()


@app.post("/api/config")
def save_config(config: OpenPoseConfig) -> Dict[str, Any]:
    openpose_exe = Path(config.openpose_exe).expanduser()
    model_folder = Path(config.model_folder).expanduser()

    if not openpose_exe.exists():
        raise HTTPException(status_code=400, detail="OpenPoseDemo.exe 路径不存在")
    if not openpose_exe.is_file():
        raise HTTPException(status_code=400, detail="OpenPose 程序路径不是文件")
    if not model_folder.exists():
        raise HTTPException(status_code=400, detail="models 文件夹路径不存在")
    if not model_folder.is_dir():
        raise HTTPException(status_code=400, detail="models 路径不是文件夹")

    payload = {"openpose_exe": str(openpose_exe), "model_folder": str(model_folder)}
    CONFIG_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True, "message": "OpenPose 配置已保存", **payload}


@app.post("/api/upload")
async def upload_media(file: UploadFile = File(...)) -> Dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="没有收到文件名")

    media_type = _detect_media_type(file.filename)
    suffix = Path(file.filename).suffix.lower()
    media_id = str(uuid.uuid4())
    target_path = UPLOAD_DIR / f"{media_id}{suffix}"

    try:
        with target_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    finally:
        await file.close()

    return {"media_id": media_id, "filename": file.filename, "media_type": media_type, "path": str(target_path)}


def run_openpose_job(job_id: str, media_id: str, media_type: str) -> None:
    log_tail: List[str] = []

    def append_log(line: str) -> None:
        clean = line.strip()
        if not clean:
            return
        log_tail.append(clean)
        del log_tail[:-120]
        _write_job(job_id, log_tail=list(log_tail))

    try:
        config = _read_config()
        openpose_exe = config.get("openpose_exe", "")
        model_folder = config.get("model_folder", "")

        if not openpose_exe or not model_folder:
            raise RuntimeError("OpenPose 尚未配置，请先保存 OpenPoseDemo.exe 和 models 路径")

        openpose_path = Path(openpose_exe)
        model_path = Path(model_folder)
        if not openpose_path.exists():
            raise RuntimeError("OpenPoseDemo.exe 路径不存在")
        if not model_path.exists():
            raise RuntimeError("models 文件夹路径不存在")

        media_path = _find_uploaded_media(media_id)
        job_output_dir = OUTPUT_DIR / job_id
        if job_output_dir.exists():
            shutil.rmtree(job_output_dir)
        job_output_dir.mkdir(parents=True, exist_ok=True)

        _write_job(job_id, status="running", message="OpenPose 正在分析", output_dir=str(job_output_dir), json_count=0)

        if media_type == "video":
            cmd = [
                str(openpose_path),
                "--video",
                str(media_path),
                "--write_json",
                str(job_output_dir),
                "--display",
                "0",
                "--render_pose",
                "0",
                "--model_folder",
                str(model_path),
            ]
        elif media_type == "image":
            image_input_dir = UPLOAD_DIR / f"{media_id}_image_dir"
            if image_input_dir.exists():
                shutil.rmtree(image_input_dir)
            image_input_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(media_path, image_input_dir / media_path.name)
            cmd = [
                str(openpose_path),
                "--image_dir",
                str(image_input_dir),
                "--write_json",
                str(job_output_dir),
                "--display",
                "0",
                "--render_pose",
                "0",
                "--model_folder",
                str(model_path),
            ]
        else:
            raise RuntimeError("未知媒体类型")

        _write_job(job_id, command=_command_for_display(cmd))
        process = subprocess.Popen(
            cmd,
            cwd=str(openpose_path.parent),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="ignore",
        )

        if process.stdout:
            for line in process.stdout:
                append_log(line)
                _write_job(job_id, json_count=_count_json_files(job_output_dir))

        return_code = process.wait()
        json_count = _count_json_files(job_output_dir)

        if return_code != 0:
            raise RuntimeError("OpenPose 执行失败。请检查 OpenPoseDemo.exe、models 路径、CUDA/CPU 版本和媒体格式。")

        _write_job(
            job_id,
            status="completed",
            message="OpenPose 分析完成",
            json_count=json_count,
            output_dir=str(job_output_dir),
            return_code=return_code,
        )
    except Exception as exc:
        _write_job(job_id, status="failed", message=str(exc), log_tail=list(log_tail))


@app.post("/api/analyze")
def analyze_media(request: AnalyzeRequest, background_tasks: BackgroundTasks) -> Dict[str, Any]:
    if request.media_type not in {"video", "image"}:
        raise HTTPException(status_code=400, detail="media_type 必须是 video 或 image")

    try:
        _find_uploaded_media(request.media_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    job_id = str(uuid.uuid4())
    job = {
        "job_id": job_id,
        "media_id": request.media_id,
        "media_type": request.media_type,
        "status": "queued",
        "message": "任务已创建",
        "json_count": 0,
        "output_dir": "",
        "command": "",
        "log_tail": [],
    }
    with jobs_lock:
        jobs[job_id] = job

    background_tasks.add_task(run_openpose_job, job_id, request.media_id, request.media_type)
    return job


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> Dict[str, Any]:
    job = _get_job_snapshot(job_id)
    output_dir_value: Optional[str] = job.get("output_dir") or None
    if output_dir_value:
        output_dir = Path(output_dir_value)
        if output_dir.exists():
            job["json_count"] = _count_json_files(output_dir)
            _write_job(job_id, json_count=job["json_count"])
    return job


@app.get("/api/jobs/{job_id}/json-list")
def get_json_list(job_id: str) -> Dict[str, Any]:
    job = _get_job_snapshot(job_id)
    output_dir_value = job.get("output_dir")
    if not output_dir_value:
        raise HTTPException(status_code=404, detail="JSON 输出目录尚未生成")

    output_dir = Path(output_dir_value)
    if not output_dir.exists():
        raise HTTPException(status_code=404, detail="JSON 输出目录不存在")

    files = sorted(output_dir.glob("*_keypoints.json"))
    return {"job_id": job_id, "count": len(files), "files": [file.name for file in files]}


@app.get("/api/jobs/{job_id}/json/{filename}")
def get_json_file(job_id: str, filename: str) -> Dict[str, Any]:
    job = _get_job_snapshot(job_id)
    output_dir_value = job.get("output_dir")
    if not output_dir_value:
        raise HTTPException(status_code=404, detail="JSON 输出目录尚未生成")

    safe_name = Path(filename).name
    if safe_name != filename or not safe_name.endswith("_keypoints.json"):
        raise HTTPException(status_code=400, detail="非法 JSON 文件名")

    json_path = Path(output_dir_value) / safe_name
    if not json_path.exists():
        raise HTTPException(status_code=404, detail="JSON 文件不存在")

    try:
        return json.loads(json_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"JSON 解析失败: {exc}") from exc
