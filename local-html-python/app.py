#!/usr/bin/env python3
from __future__ import annotations

import argparse
import cgi
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

APP_VERSION = "0.3.1"
HOST = "127.0.0.1"
PORT = 8765
ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
CONFIG_DIR = ROOT / "config"
RUNS = ROOT / "runs"
UPLOADS = RUNS / "uploads"
OUTPUTS = RUNS / "outputs"
TEMP = RUNS / "temp"
CONFIG_PATH = CONFIG_DIR / "openpose_config.json"
VIDEO_EXT = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

for p in [CONFIG_DIR, UPLOADS, OUTPUTS, TEMP]:
    p.mkdir(parents=True, exist_ok=True)

jobs: dict[str, dict] = {}
lock = threading.Lock()


def default_config() -> dict:
    return {
        "openpose_exe": "",
        "model_folder": "",
        "fps": 30,
        "net_resolution": "-1x368",
        "hand_net_resolution": "368x368",
        "face_net_resolution": "368x368",
        "number_people_max": 0,
    }


def read_config() -> dict:
    cfg = default_config()
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass
    return cfg


def write_config(data: dict) -> dict:
    cfg = default_config()
    cfg.update(data or {})
    cfg["openpose_exe"] = str(cfg.get("openpose_exe", "")).strip()
    cfg["model_folder"] = str(cfg.get("model_folder", "")).strip()
    cfg["fps"] = int(cfg.get("fps") or 30)
    cfg["number_people_max"] = int(cfg.get("number_people_max") or 0)
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    return cfg


def media_type(path: Path) -> str:
    s = path.suffix.lower()
    if s in VIDEO_EXT:
        return "video"
    if s in IMAGE_EXT:
        return "image"
    raise ValueError(f"unsupported media type: {s}")


def send_json(h: SimpleHTTPRequestHandler, data, status=200):
    raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
    h.send_response(status)
    h.send_header("Content-Type", "application/json; charset=utf-8")
    h.send_header("Content-Length", str(len(raw)))
    h.send_header("Access-Control-Allow-Origin", "*")
    h.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    h.send_header("Access-Control-Allow-Headers", "Content-Type")
    h.end_headers()
    h.wfile.write(raw)


def body_json(h: SimpleHTTPRequestHandler) -> dict:
    n = int(h.headers.get("Content-Length", "0") or 0)
    if not n:
        return {}
    return json.loads(h.rfile.read(n).decode("utf-8"))


def pick_path(kind: str) -> str:
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk(); root.withdraw(); root.attributes("-topmost", True)
        if kind == "exe":
            val = filedialog.askopenfilename(title="Select OpenPoseDemo.exe", filetypes=[("Executable", "*.exe"), ("All files", "*.*")])
        else:
            val = filedialog.askdirectory(title="Select folder")
        root.destroy()
        return val or ""
    except Exception:
        return ""


def list_json_frames(folder: Path) -> list[dict]:
    files = sorted(folder.glob("*_keypoints.json")) or sorted(folder.glob("*.json"))
    frames = []
    for i, p in enumerate(files):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            data["_source_file"] = p.name
            data["_frame_index"] = i
            frames.append(data)
        except Exception:
            continue
    return frames


def set_job(job_id: str, **kwargs):
    with lock:
        if job_id in jobs:
            jobs[job_id].update(kwargs)
            jobs[job_id]["updated_at"] = time.time()


def run_openpose(job_id: str, media_path: Path, req: dict):
    log: list[str] = []
    def append(line: str):
        line = line.strip()
        if line:
            log.append(line)
            del log[:-80]
            set_job(job_id, log_tail=list(log))
    try:
        cfg = read_config()
        exe = Path(cfg["openpose_exe"])
        model = Path(cfg["model_folder"])
        if not exe.is_file():
            raise RuntimeError("OpenPoseDemo.exe 路径不存在")
        if not model.is_dir():
            raise RuntimeError("models 文件夹路径不存在")
        out = OUTPUTS / job_id
        if out.exists():
            shutil.rmtree(out)
        out.mkdir(parents=True)
        kind = media_type(media_path)
        cmd = [str(exe)]
        if kind == "video":
            cmd += ["--video", str(media_path)]
        else:
            img_dir = TEMP / f"{job_id}_image_dir"
            if img_dir.exists():
                shutil.rmtree(img_dir)
            img_dir.mkdir(parents=True)
            shutil.copy2(media_path, img_dir / media_path.name)
            cmd += ["--image_dir", str(img_dir)]
        cmd += ["--model_pose", "BODY_25", "--write_json", str(out), "--display", "0", "--render_pose", "0", "--model_folder", str(model)]
        if cfg.get("net_resolution"):
            cmd += ["--net_resolution", str(cfg["net_resolution"])]
        if int(cfg.get("number_people_max") or 0) > 0:
            cmd += ["--number_people_max", str(cfg["number_people_max"])]
        if req.get("hand"):
            cmd += ["--hand", "--hand_net_resolution", str(cfg.get("hand_net_resolution") or "368x368")]
        if req.get("face"):
            cmd += ["--face", "--face_net_resolution", str(cfg.get("face_net_resolution") or "368x368")]
        set_job(job_id, status="running", message="OpenPose 正在分析", output_dir=str(out), command=subprocess.list2cmdline(cmd))
        p = subprocess.Popen(cmd, cwd=str(exe.parent), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="ignore")
        assert p.stdout is not None
        for line in p.stdout:
            append(line)
            set_job(job_id, json_count=len(list(out.glob("*_keypoints.json"))))
        rc = p.wait()
        count = len(list(out.glob("*_keypoints.json")))
        if rc != 0:
            raise RuntimeError("OpenPose exited with non-zero status. Check OpenPose.exe, models, CUDA/CPU build, media format, and path names.")
        set_job(job_id, status="completed", message="OpenPose 分析完成", return_code=rc, json_count=count)
    except Exception as e:
        set_job(job_id, status="failed", message=str(e), log_tail=list(log))


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(fmt % args)

    def do_OPTIONS(self):
        send_json(self, {"ok": True})

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        try:
            if path == "/api/health":
                return send_json(self, {"ok": True, "version": APP_VERSION})
            if path == "/api/config":
                return send_json(self, read_config())
            if path.startswith("/api/jobs/"):
                parts = path.strip("/").split("/")
                job_id = parts[2]
                if len(parts) == 3:
                    return send_json(self, jobs.get(job_id, {"status": "missing"}))
                job = jobs.get(job_id)
                if not job:
                    return send_json(self, {"error": "job not found"}, 404)
                out = Path(job.get("output_dir") or "")
                if len(parts) == 4 and parts[3] == "json-list":
                    files = [p.name for p in sorted(out.glob("*_keypoints.json"))]
                    return send_json(self, {"files": files, "count": len(files)})
                if len(parts) >= 5 and parts[3] == "json":
                    name = Path(parts[4]).name
                    jp = out / name
                    if not jp.exists():
                        return send_json(self, {"error": "json not found"}, 404)
                    return send_json(self, json.loads(jp.read_text(encoding="utf-8")))
            if path == "/":
                path = "/index.html"
            fp = (PUBLIC / path.lstrip("/")).resolve()
            if not str(fp).startswith(str(PUBLIC.resolve())) or not fp.exists():
                return send_json(self, {"error": "not found"}, 404)
            data = fp.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(str(fp))[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers(); self.wfile.write(data)
        except Exception as e:
            send_json(self, {"error": str(e)}, 500)

    def do_POST(self):
        path = unquote(urlparse(self.path).path)
        try:
            if path == "/api/config":
                return send_json(self, {"ok": True, "config": write_config(body_json(self))})
            if path == "/api/pick-exe":
                return send_json(self, {"path": pick_path("exe")})
            if path == "/api/pick-folder":
                return send_json(self, {"path": pick_path("folder")})
            if path == "/api/open-json-folder":
                folder = pick_path("folder")
                frames = list_json_frames(Path(folder)) if folder else []
                return send_json(self, {"path": folder, "count": len(frames), "frames": frames})
            if path == "/api/upload":
                form = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": self.headers.get("Content-Type")})
                item = form["file"]
                filename = Path(item.filename or "media.bin").name
                suffix = Path(filename).suffix.lower()
                mid = str(uuid.uuid4())
                target = UPLOADS / f"{mid}{suffix}"
                with target.open("wb") as f:
                    shutil.copyfileobj(item.file, f)
                return send_json(self, {"media_id": mid, "filename": filename, "path": str(target), "media_type": media_type(target)})
            if path == "/api/analyze":
                req = body_json(self)
                media_id = req.get("media_id", "")
                files = sorted(UPLOADS.glob(f"{media_id}.*"))
                if not files:
                    return send_json(self, {"error": "media not found"}, 404)
                job_id = str(uuid.uuid4())
                jobs[job_id] = {"job_id": job_id, "status": "queued", "message": "任务已创建", "json_count": 0, "created_at": time.time(), "log_tail": []}
                threading.Thread(target=run_openpose, args=(job_id, files[0], req), daemon=True).start()
                return send_json(self, jobs[job_id])
            send_json(self, {"error": "not found"}, 404)
        except Exception as e:
            send_json(self, {"error": str(e)}, 500)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    url = f"http://{args.host}:{args.port}"
    print(f"OpenPose Media Skeleton Reader v{APP_VERSION}")
    print(url)
    if args.open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
