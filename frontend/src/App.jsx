import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000';
const EMPTY_CONFIG = { openpose_exe: '', model_folder: '' };

const BODY_25_PAIRS = [
  [1, 8], [1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7],
  [8, 9], [9, 10], [10, 11], [8, 12], [12, 13], [13, 14],
  [1, 0], [0, 15], [15, 17], [0, 16], [16, 18], [14, 19],
  [19, 20], [14, 21], [11, 22], [22, 23], [11, 24],
];

function guessMediaType(file) {
  if (!file) return '';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('image/')) return 'image';
  const suffix = file.name.split('.').pop()?.toLowerCase();
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(suffix)) return 'video';
  if (['jpg', 'jpeg', 'png', 'bmp', 'webp'].includes(suffix)) return 'image';
  return '';
}

function getPoint(keypoints, index) {
  const offset = index * 3;
  return {
    x: keypoints[offset] ?? 0,
    y: keypoints[offset + 1] ?? 0,
    c: keypoints[offset + 2] ?? 0,
  };
}

function resizeCanvasToElement(canvas, element, fallbackHeight = 100) {
  if (!canvas) return { width: 0, height: 0 };
  const ratio = window.devicePixelRatio || 1;
  const rect = element?.getBoundingClientRect?.() ?? { width: canvas.clientWidth || 320, height: fallbackHeight };
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height || fallbackHeight));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) {
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

function drawCanvasMessage(canvas, message) {
  const { width, height } = resizeCanvasToElement(canvas, canvas?.parentElement, 100);
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.font = '13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(message, 14, Math.max(28, height / 2));
}

async function readJsonFile(file) {
  return JSON.parse(await file.text());
}

export default function App() {
  const videoRef = useRef(null);
  const imageRef = useRef(null);
  const overlayRef = useRef(null);
  const audioCanvasRef = useRef(null);
  const rgbCanvasRef = useRef(null);
  const hiddenCanvasRef = useRef(null);
  const animationRef = useRef(null);
  const pollRef = useRef(null);
  const lastFrameRef = useRef(-1);

  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [configStatus, setConfigStatus] = useState('未配置');
  const [media, setMedia] = useState({ file: null, url: '', mediaType: '' });
  const [uploadInfo, setUploadInfo] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('尚未上传媒体');
  const [job, setJob] = useState(null);
  const [poseFrames, setPoseFrames] = useState([]);
  const [poseSource, setPoseSource] = useState('尚未加载骨架 JSON');
  const [frameIndex, setFrameIndex] = useState(0);
  const [fps, setFps] = useState(30);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioStatus, setAudioStatus] = useState('尚未读取音频');
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showKeypoints, setShowKeypoints] = useState(true);
  const [showNumbers, setShowNumbers] = useState(false);
  const [showAudio, setShowAudio] = useState(true);
  const [showRGB, setShowRGB] = useState(true);

  const firstPersonPoints = useMemo(() => {
    const keypoints = poseFrames[frameIndex]?.people?.[0]?.pose_keypoints_2d;
    if (!keypoints?.length) return [];
    return Array.from({ length: Math.floor(keypoints.length / 3) }, (_, index) => ({ index, ...getPoint(keypoints, index) }));
  }, [frameIndex, poseFrames]);

  useEffect(() => {
    fetch(`${API_BASE}/api/config`)
      .then((response) => response.json())
      .then((data) => {
        setConfig({ ...EMPTY_CONFIG, ...data });
        setConfigStatus(data.openpose_exe && data.model_folder ? '已读取 OpenPose 配置' : '未配置');
      })
      .catch((error) => setConfigStatus(`无法连接后端：${error.message}`));
  }, []);

  useEffect(() => () => {
    if (media.url) URL.revokeObjectURL(media.url);
  }, [media.url]);

  const saveConfig = async () => {
    setConfigStatus('正在保存配置...');
    try {
      const response = await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || '保存失败');
      setConfigStatus(data.message || 'OpenPose 配置已保存');
    } catch (error) {
      setConfigStatus(`保存失败：${error.message}`);
    }
  };

  const handleMediaChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const mediaType = guessMediaType(file);
    if (!mediaType) {
      setUploadStatus('不支持的媒体格式');
      return;
    }

    if (media.url) URL.revokeObjectURL(media.url);
    setMedia({ file, url: URL.createObjectURL(file), mediaType });
    setPoseFrames([]);
    setPoseSource('尚未加载骨架 JSON');
    setFrameIndex(0);
    setIsPlaying(false);
    setJob(null);
    setUploadInfo(null);
    setUploadStatus('正在上传到本地后端...');

    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || '上传失败');
      setUploadInfo(data);
      setUploadStatus(`已上传：${data.filename}`);
    } catch (error) {
      setUploadStatus(`上传失败：${error.message}`);
    }
  };

  const loadJobJson = useCallback(async (jobId) => {
    const listResponse = await fetch(`${API_BASE}/api/jobs/${jobId}/json-list`);
    const list = await listResponse.json();
    if (!listResponse.ok) throw new Error(list.detail || '读取 JSON 列表失败');

    const frames = await Promise.all(list.files.map(async (filename) => {
      const response = await fetch(`${API_BASE}/api/jobs/${jobId}/json/${encodeURIComponent(filename)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || `读取 ${filename} 失败`);
      return data;
    }));

    setPoseFrames(frames);
    setPoseSource(`OpenPose 输出 JSON：${frames.length} 帧`);
    setFrameIndex(0);
    lastFrameRef.current = -1;
  }, []);

  const analyzeWithOpenPose = async () => {
    if (!uploadInfo?.media_id) {
      setUploadStatus('请先选择并上传媒体文件');
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_id: uploadInfo.media_id, media_type: uploadInfo.media_type }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || '创建分析任务失败');
      setJob(data);
      setPoseSource('OpenPose 正在生成骨架 JSON...');
    } catch (error) {
      setJob({ status: 'failed', message: error.message, json_count: 0 });
    }
  };

  useEffect(() => {
    if (!job?.job_id || !['queued', 'running'].includes(job.status)) return undefined;
    pollRef.current = window.setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/jobs/${job.job_id}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || '任务查询失败');
        setJob(data);
        if (data.status === 'completed') {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
          await loadJobJson(data.job_id);
        }
        if (data.status === 'failed') {
          window.clearInterval(pollRef.current);
          pollRef.current = null;
          setPoseSource(`OpenPose 分析失败：${data.message}`);
        }
      } catch (error) {
        setJob((previous) => ({ ...(previous || {}), status: 'failed', message: error.message }));
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 1000);

    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [job?.job_id, job?.status, loadJobJson]);

  const handleSingleJson = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = await readJsonFile(file);
      setPoseFrames([data]);
      setPoseSource(`已加载单个 JSON：${file.name}`);
      setFrameIndex(0);
      lastFrameRef.current = -1;
    } catch (error) {
      setPoseSource(`JSON 读取失败：${error.message}`);
    }
  };

  const handleJsonFolder = async (event) => {
    const files = Array.from(event.target.files || [])
      .filter((file) => file.name.endsWith('.json'))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!files.length) {
      setPoseSource('没有在文件夹中找到 JSON 文件');
      return;
    }
    try {
      const frames = await Promise.all(files.map(readJsonFile));
      setPoseFrames(frames);
      setPoseSource(`已加载 JSON 文件夹：${frames.length} 帧`);
      setFrameIndex(0);
      lastFrameRef.current = -1;
    } catch (error) {
      setPoseSource(`JSON 文件夹读取失败：${error.message}`);
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (media.mediaType !== 'video' || !video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const resetPlayback = () => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setIsPlaying(false);
    setFrameIndex(0);
    lastFrameRef.current = -1;
  };

  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const target = media.mediaType === 'video' ? videoRef.current : imageRef.current;
    if (!canvas || !target) return;

    const { width, height } = resizeCanvasToElement(canvas, target, 360);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    const naturalWidth = media.mediaType === 'video' ? target.videoWidth || width : target.naturalWidth || width;
    const naturalHeight = media.mediaType === 'video' ? target.videoHeight || height : target.naturalHeight || height;
    const currentFrame = media.mediaType === 'video'
      ? Math.min(Math.max(0, Math.floor((target.currentTime || 0) * fps)), Math.max(0, poseFrames.length - 1))
      : Math.min(frameIndex, Math.max(0, poseFrames.length - 1));

    if (currentFrame !== lastFrameRef.current) {
      lastFrameRef.current = currentFrame;
      setFrameIndex(currentFrame);
    }

    const people = poseFrames[currentFrame]?.people || [];
    if (!people.length) return;

    const scaleX = width / naturalWidth;
    const scaleY = height / naturalHeight;

    people.forEach((person, personIndex) => {
      const keypoints = person.pose_keypoints_2d || [];

      if (showSkeleton) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = personIndex === 0 ? 'rgba(71, 206, 255, 0.92)' : 'rgba(255, 199, 95, 0.72)';
        BODY_25_PAIRS.forEach(([a, b]) => {
          const p1 = getPoint(keypoints, a);
          const p2 = getPoint(keypoints, b);
          if (p1.c < 0.05 || p2.c < 0.05) return;
          ctx.beginPath();
          ctx.moveTo(p1.x * scaleX, p1.y * scaleY);
          ctx.lineTo(p2.x * scaleX, p2.y * scaleY);
          ctx.stroke();
        });
      }

      for (let index = 0; index < keypoints.length / 3; index += 1) {
        const point = getPoint(keypoints, index);
        if (point.c < 0.05) continue;
        const x = point.x * scaleX;
        const y = point.y * scaleY;
        if (showKeypoints) {
          ctx.beginPath();
          ctx.fillStyle = point.c > 0.4 ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 126, 126, 0.82)';
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (showNumbers) {
          ctx.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.72)';
          ctx.lineWidth = 3;
          ctx.strokeText(String(index), x + 6, y - 6);
          ctx.fillText(String(index), x + 6, y - 6);
        }
      }
    });
  }, [fps, frameIndex, media.mediaType, poseFrames, showKeypoints, showNumbers, showSkeleton]);

  const drawRGB = useCallback(() => {
    const canvas = rgbCanvasRef.current;
    if (!showRGB || !canvas) return;
    const target = media.mediaType === 'video' ? videoRef.current : imageRef.current;
    if (!target) {
      drawCanvasMessage(canvas, '尚未选择媒体');
      return;
    }

    const { width, height } = resizeCanvasToElement(canvas, canvas.parentElement, 96);
    const ctx = canvas.getContext('2d');
    const hidden = hiddenCanvasRef.current;
    const hiddenCtx = hidden?.getContext('2d', { willReadFrequently: true });
    if (!hiddenCtx) return;

    const sourceWidth = media.mediaType === 'video' ? target.videoWidth : target.naturalWidth;
    const sourceHeight = media.mediaType === 'video' ? target.videoHeight : target.naturalHeight;
    if (!sourceWidth || !sourceHeight) {
      drawCanvasMessage(canvas, '等待媒体尺寸信息...');
      return;
    }

    const sampleWidth = 64;
    const sampleHeight = Math.max(1, Math.round((sourceHeight / sourceWidth) * sampleWidth));
    hidden.width = sampleWidth;
    hidden.height = sampleHeight;
    hiddenCtx.drawImage(target, 0, 0, sampleWidth, sampleHeight);
    const pixels = hiddenCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
    let r = 0; let g = 0; let b = 0;
    const count = pixels.length / 4;
    for (let i = 0; i < pixels.length; i += 4) {
      r += pixels[i];
      g += pixels[i + 1];
      b += pixels[i + 2];
    }
    r = Math.round(r / count);
    g = Math.round(g / count);
    b = Math.round(b / count);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
    ctx.font = '13px ui-monospace, SFMono-Regular, Consolas, monospace';
    ctx.fillText(`RGB avg  R:${r}  G:${g}  B:${b}`, 14, 22);

    [
      ['R', r, 'rgba(255, 91, 91, 0.86)'],
      ['G', g, 'rgba(72, 214, 142, 0.86)'],
      ['B', b, 'rgba(89, 154, 255, 0.86)'],
    ].forEach(([label, value, color], index) => {
      const y = 44 + index * 18;
      const barMaxWidth = width - 80;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.fillRect(42, y - 9, barMaxWidth, 10);
      ctx.fillStyle = color;
      ctx.fillRect(42, y - 9, (value / 255) * barMaxWidth, 10);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.fillText(label, 18, y);
    });
  }, [media.mediaType, showRGB]);

  useEffect(() => {
    const tick = () => {
      drawOverlay();
      drawRGB();
      animationRef.current = window.requestAnimationFrame(tick);
    };
    animationRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) window.cancelAnimationFrame(animationRef.current);
    };
  }, [drawOverlay, drawRGB]);

  useEffect(() => {
    const drawAudioWaveform = async () => {
      const canvas = audioCanvasRef.current;
      if (!canvas) return;
      if (!showAudio) {
        const { width, height } = resizeCanvasToElement(canvas, canvas.parentElement, 110);
        canvas.getContext('2d').clearRect(0, 0, width, height);
        return;
      }
      if (!media.file || media.mediaType !== 'video') {
        drawCanvasMessage(canvas, media.mediaType === 'image' ? '图片没有音频波形' : '尚未选择视频');
        setAudioStatus(media.mediaType === 'image' ? '图片没有音频' : '尚未读取音频');
        return;
      }
      try {
        setAudioStatus('正在解码音频...');
        const arrayBuffer = await media.file.arrayBuffer();
        const audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        await audioContext.close();
        const channelData = audioBuffer.getChannelData(0);
        const { width, height } = resizeCanvasToElement(canvas, canvas.parentElement, 110);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = 'rgba(83, 218, 255, 0.88)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const step = Math.max(1, Math.floor(channelData.length / width));
        const middle = height / 2;
        for (let x = 0; x < width; x += 1) {
          let min = 1;
          let max = -1;
          const start = x * step;
          for (let j = 0; j < step && start + j < channelData.length; j += 1) {
            const value = channelData[start + j];
            if (value < min) min = value;
            if (value > max) max = value;
          }
          ctx.moveTo(x, middle + min * middle * 0.88);
          ctx.lineTo(x, middle + max * middle * 0.88);
        }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
        ctx.font = '13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(`Audio waveform · ${audioBuffer.duration.toFixed(2)}s`, 14, 20);
        setAudioStatus(`音频已读取：${audioBuffer.duration.toFixed(2)} 秒`);
      } catch (error) {
        drawCanvasMessage(canvas, '无法解码音频。部分浏览器不支持直接解码该视频音轨。');
        setAudioStatus(`音频读取失败：${error.message}`);
      }
    };
    drawAudioWaveform();
  }, [media.file, media.mediaType, showAudio]);

  return (
    <main className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">OpenPose · RGB · Audio</p>
          <h1>Media Skeleton Reader</h1>
          <p className="subtitle">本地 FastAPI 后端调用 OpenPoseDemo.exe，自动生成骨架 JSON，并在媒体上同步叠加显示。</p>
        </div>
        <div className="status-pill">Backend: {API_BASE}</div>
      </header>

      <section className="control-grid">
        <div className="panel control-panel">
          <h2>1. 媒体与 OpenPose</h2>
          <label className="file-button">
            选择媒体
            <input type="file" accept="video/*,image/*" onChange={handleMediaChange} />
          </label>
          <p className="hint">{uploadStatus}</p>
          <div className="form-stack">
            <label>
              OpenPoseDemo.exe 路径
              <input value={config.openpose_exe} onChange={(event) => setConfig((previous) => ({ ...previous, openpose_exe: event.target.value }))} placeholder="C:\\openpose\\bin\\OpenPoseDemo.exe" />
            </label>
            <label>
              models 文件夹路径
              <input value={config.model_folder} onChange={(event) => setConfig((previous) => ({ ...previous, model_folder: event.target.value }))} placeholder="C:\\openpose\\models" />
            </label>
          </div>
          <div className="button-row">
            <button type="button" onClick={saveConfig}>保存设置</button>
            <button type="button" onClick={analyzeWithOpenPose} disabled={!uploadInfo?.media_id}>一键分析骨架</button>
          </div>
          <p className="hint">{configStatus}</p>
          {job && (
            <div className={`job-card ${job.status}`}>
              <strong>OpenPose 状态：{job.status}</strong>
              <span>{job.message}</span>
              <span>JSON 帧数：{job.json_count ?? 0}</span>
            </div>
          )}
        </div>

        <div className="panel control-panel">
          <h2>2. 手动加载 JSON</h2>
          <label className="file-button secondary">
            选择骨架 JSON
            <input type="file" accept=".json,application/json" onChange={handleSingleJson} />
          </label>
          <label className="file-button secondary">
            选择 JSON 文件夹
            <input type="file" accept=".json,application/json" multiple webkitdirectory="true" directory="true" onChange={handleJsonFolder} />
          </label>
          <p className="hint">{poseSource}</p>
          <div className="toggle-grid">
            <label><input type="checkbox" checked={showSkeleton} onChange={(e) => setShowSkeleton(e.target.checked)} /> 显示骨架</label>
            <label><input type="checkbox" checked={showKeypoints} onChange={(e) => setShowKeypoints(e.target.checked)} /> 显示关键点</label>
            <label><input type="checkbox" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} /> 显示编号</label>
            <label><input type="checkbox" checked={showAudio} onChange={(e) => setShowAudio(e.target.checked)} /> 显示音频波形</label>
            <label><input type="checkbox" checked={showRGB} onChange={(e) => setShowRGB(e.target.checked)} /> 显示 RGB 构成</label>
          </div>
          <label className="fps-control">
            FPS
            <input type="number" min="1" max="120" value={fps} onChange={(event) => setFps(Number(event.target.value) || 30)} />
          </label>
        </div>
      </section>

      <section className="workspace">
        <div className="stage-column">
          <div className="media-stage panel">
            {!media.url && <div className="empty-stage">请选择视频或图片</div>}
            {media.mediaType === 'video' && (
              <video ref={videoRef} src={media.url} className="media-element" onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} controls={false} />
            )}
            {media.mediaType === 'image' && (
              <img ref={imageRef} src={media.url} className="media-element" alt="selected media" />
            )}
            <canvas ref={overlayRef} className="overlay-canvas" />
          </div>

          <div className="playback-bar panel">
            <button type="button" onClick={togglePlay} disabled={media.mediaType !== 'video'}>{isPlaying ? '暂停' : '播放'}</button>
            <button type="button" onClick={resetPlayback}>重置</button>
            <span>当前帧：{frameIndex} / {Math.max(0, poseFrames.length - 1)}</span>
            <span>{audioStatus}</span>
          </div>

          <div className="analysis-stack">
            <div className="analysis-card panel">
              <h3>Audio Waveform</h3>
              <canvas ref={audioCanvasRef} className="analysis-canvas" />
            </div>
            <div className="analysis-card panel">
              <h3>RGB Composition</h3>
              <canvas ref={rgbCanvasRef} className="analysis-canvas" />
              <canvas ref={hiddenCanvasRef} className="hidden-canvas" />
            </div>
          </div>
        </div>

        <aside className="panel inspector">
          <h2>当前帧数据</h2>
          <div className="inspector-meta">
            <span>Frames: {poseFrames.length}</span>
            <span>People: {poseFrames[frameIndex]?.people?.length ?? 0}</span>
          </div>
          {firstPersonPoints.length ? (
            <pre>{`P_${frameIndex} = {\n${firstPersonPoints.filter((point) => point.c > 0.05).map((point) => `  p${point.index} = (${Math.round(point.x)}, ${Math.round(point.y)}, ${Number(point.c).toFixed(2)})`).join(',\n')}\n}`}</pre>
          ) : (
            <p className="hint">当前帧没有可显示的关键点。</p>
          )}
          {job?.log_tail?.length ? (
            <details>
              <summary>OpenPose 日志</summary>
              <pre className="log-box">{job.log_tail.join('\n')}</pre>
            </details>
          ) : null}
        </aside>
      </section>
    </main>
  );
}
