#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge an OpenPose JSON folder into one pose_bundle.json.")
    parser.add_argument("--json-dir", required=True)
    parser.add_argument("--out", default="pose_bundle.json")
    parser.add_argument("--fps", type=int, default=30)
    args = parser.parse_args()

    json_dir = Path(args.json_dir)
    files = sorted(json_dir.glob("*_keypoints.json")) or sorted(json_dir.glob("*.json"))
    frames = []
    for index, path in enumerate(files):
        data = json.loads(path.read_text(encoding="utf-8"))
        data["_source_file"] = path.name
        data["_frame_index"] = index
        data["_time_sec"] = round(index / max(1, args.fps), 6)
        frames.append(data)

    bundle = {
        "schema": "openpose-media-skeleton-reader.bundle.v0.3",
        "version": "0.3.1",
        "fps": args.fps,
        "frame_count": len(frames),
        "frames": frames,
    }
    Path(args.out).write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {args.out} with {len(frames)} frames")


if __name__ == "__main__":
    main()
