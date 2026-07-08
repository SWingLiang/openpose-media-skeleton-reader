# Vercel Deployment Notes

This repository is designed as a split deployment:

```text
Vercel: frontend/ React + Vite static web app
Local computer: backend/ FastAPI + OpenPoseDemo.exe
```

## What works on Vercel

The Vercel deployment can run the browser-side media reader:

- select video or image files in the browser;
- display the media;
- analyze and show RGB composition;
- decode and draw video audio waveform when the browser supports the video audio track;
- manually load OpenPose JSON or a JSON folder;
- overlay BODY_25 skeletons, keypoints, and keypoint numbers.

## What does not run directly on Vercel

Vercel should not be used to run the local Windows OpenPose binary. The automatic `OpenPoseDemo.exe` call remains a local workflow through `backend/main.py`. This is because OpenPose normally depends on local executable files, local model folders, GPU/CUDA or CPU builds, and large media files.

## Recommended Vercel settings

When importing the GitHub repository into Vercel, use the repository root as the root directory. Do not set the root directory to `frontend`, because this repository already contains a root-level `vercel.json` that points Vercel to `frontend/`.

Recommended settings:

```text
Root Directory: .
Framework Preset: Vite
Install Command: npm install --prefix frontend
Build Command: npm run build --prefix frontend
Output Directory: frontend/dist
```

These values are already encoded in `vercel.json`.

## Local OpenPose workflow after Vercel deployment

For actual automatic OpenPose analysis, run the FastAPI backend on the same computer that has OpenPose installed:

```bash
cd backend
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# macOS / Linux:
# source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Then run the frontend locally for full automatic analysis:

```bash
cd frontend
npm install
npm run dev
```

The public Vercel site is best used as a demonstration and manual OpenPose JSON reader.
