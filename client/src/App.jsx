import React, { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  const [url, setUrl] = useState('');
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [videoInfo, setVideoInfo] = useState(null);
  const [selectedFormat, setSelectedFormat] = useState('best');
  
  const [downloadState, setDownloadState] = useState({
    isDownloading: false,
    percent: 0,
    speed: '',
    eta: '',
    status: '',
    filename: ''
  });

  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [isOpenFolderLoading, setIsOpenFolderLoading] = useState(false);

  const eventSourceRef = useRef(null);

  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('downloader-theme') || 'minimalist-dark';
  });

  // Cat interaction states (Grey tabby cat chases the mouse)
  const mousePosRef = useRef({ x: -200, y: -200 }); // start offscreen
  const [catPos, setCatPos] = useState({ x: -100, y: -100, isRunning: false, direction: 1 });
  const [showBubble, setShowBubble] = useState(false);
  const [bubbleText, setBubbleText] = useState('เหมียว! 🐾');

  // Mouse position tracker
  useEffect(() => {
    const handleMouseMove = (e) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // requestAnimationFrame loop for cat chase
  useEffect(() => {
    let animationFrameId;
    let currentX = -100;
    let currentY = -100;

    const updateCatPosition = () => {
      // Offset target position slightly so cat sits near cursor
      const targetX = mousePosRef.current.x - 45;
      const targetY = mousePosRef.current.y - 20;

      const dx = targetX - currentX;
      const dy = targetY - currentY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      let isRunning = false;
      let direction = 1;

      if (distance > 35) {
        // Cat runs towards the cursor
        currentX += dx * 0.045; // Ease factor (lag effect)
        currentY += dy * 0.045;
        isRunning = true;
        direction = dx > 0 ? 1 : -1;
        setShowBubble(false);
      } else {
        // Cat is close to cursor, show speech bubble
        setShowBubble(true);
        // Randomly set speech bubbles occasionally
        if (Math.random() < 0.005) {
          const texts = ['เหมียว! 🐾', 'แง๊วว~ 💖', 'จับได้แล้ว! 🐁', 'งิ้ม... 💤'];
          setBubbleText(texts[Math.floor(Math.random() * texts.length)]);
        }
      }

      setCatPos({
        x: currentX,
        y: currentY,
        isRunning,
        direction
      });

      animationFrameId = requestAnimationFrame(updateCatPosition);
    };

    animationFrameId = requestAnimationFrame(updateCatPosition);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  // Apply theme to body element states
  const [isSleepingCatAwake, setIsSleepingCatAwake] = useState(false);
  const [sleepingCatBubble, setSleepingCatBubble] = useState(null);
  const [isSleepingCatHovered, setIsSleepingCatHovered] = useState(false);

  // Apply theme to body element
  useEffect(() => {
    document.body.className = `theme-${theme}`;
    localStorage.setItem('downloader-theme', theme);
  }, [theme]);

  // Fetch history on mount
  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  const handleFetchInfo = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;

    setIsLoadingInfo(true);
    setError(null);
    setVideoInfo(null);
    setSuccessMessage(null);

    try {
      const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch video details');
      }

      setVideoInfo(data);
      // Select best format by default
      setSelectedFormat('best');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoadingInfo(false);
    }
  };

  const handleDownload = () => {
    if (!videoInfo) return;

    setError(null);
    setSuccessMessage(null);
    setDownloadState({
      isDownloading: true,
      percent: 0,
      speed: '',
      eta: '',
      status: 'starting',
      filename: ''
    });

    const sseUrl = `/api/download-stream?url=${encodeURIComponent(url)}` +
      `&formatId=${selectedFormat}` +
      `&title=${encodeURIComponent(videoInfo.title)}` +
      `&thumbnail=${encodeURIComponent(videoInfo.thumbnail)}` +
      `&duration=${videoInfo.duration}` +
      `&uploader=${encodeURIComponent(videoInfo.uploader)}`;

    // Create SSE Connection
    const eventSource = new EventSource(sseUrl);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.status === 'downloading' || data.status === 'merging' || data.status === 'extracting_audio') {
        setDownloadState({
          isDownloading: true,
          percent: data.percent,
          speed: data.speed,
          eta: data.eta,
          status: data.status,
          filename: data.filename || videoInfo.title
        });
      } else if (data.status === 'completed') {
        setDownloadState({
          isDownloading: false,
          percent: 100,
          speed: '',
          eta: '',
          status: 'completed',
          filename: data.filename
        });
        setSuccessMessage(`ดาวน์โหลดสำเร็จแล้ว: ${data.filename}`);
        setVideoInfo(null);
        setUrl('');
        fetchHistory();
        eventSource.close();
      } else if (data.status === 'error') {
        setError(data.message || 'เกิดข้อผิดพลาดในการดาวน์โหลด');
        setDownloadState({
          isDownloading: false,
          percent: 0,
          speed: '',
          eta: '',
          status: 'error',
          filename: ''
        });
        eventSource.close();
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE Error:', err);
      setError('ขาดการเชื่อมต่อจากเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง');
      setDownloadState({
        isDownloading: false,
        percent: 0,
        speed: '',
        eta: '',
        status: 'error',
        filename: ''
      });
      eventSource.close();
    };
  };

  const handleCancelDownload = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      setDownloadState({
        isDownloading: false,
        percent: 0,
        speed: '',
        eta: '',
        status: 'cancelled',
        filename: ''
      });
      setError('ยกเลิกการดาวน์โหลดเรียบร้อยแล้ว');
    }
  };

  const handleDeleteHistory = async (id, deleteFile = false) => {
    try {
      const confirmDelete = window.confirm(
        deleteFile 
          ? 'ต้องการลบข้อมูลประวัติและไฟล์วิดีโอออกจากเครื่องของคุณใช่หรือไม่?' 
          : 'ต้องการลบประวัตินี้ใช่หรือไม่? (ไฟล์วิดีโอจะไม่ถูกลบ)'
      );
      if (!confirmDelete) return;

      const res = await fetch(`/api/history/${id}?deleteFile=${deleteFile}`, {
        method: 'DELETE'
      });
      
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history);
      }
    } catch (err) {
      console.error('Failed to delete history item:', err);
    }
  };

  const handleClearHistory = async () => {
    try {
      const confirmClear = window.confirm('ต้องการลบประวัติการดาวน์โหลดทั้งหมดใช่หรือไม่? (ไฟล์วิดีโอจะไม่ถูกลบ)');
      if (!confirmClear) return;

      const res = await fetch('/api/history/clear', {
        method: 'POST'
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data.history);
      }
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  };

  const handleOpenDownloads = async () => {
    setIsOpenFolderLoading(true);
    try {
      await fetch('/api/open-downloads', {
        method: 'POST'
      });
    } catch (err) {
      console.error('Failed to open downloads folder:', err);
    } finally {
      setIsOpenFolderLoading(false);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'starting': return 'กำลังเริ่มต้นกระบวนการ...';
      case 'downloading': return 'กำลังดาวน์โหลดไฟล์...';
      case 'merging': return 'กำลังรวมไฟล์ภาพและเสียง (FFmpeg)...';
      case 'extracting_audio': return 'กำลังแยกและแปลงไฟล์เสียงเป็น MP3...';
      case 'completed': return 'ดาวน์โหลดเสร็จสมบูรณ์!';
      case 'error': return 'เกิดข้อผิดพลาด';
      case 'cancelled': return 'ยกเลิกการดาวน์โหลด';
      default: return 'กำลังทำงาน...';
    }
  };

  return (
    <div className="app-container">
      <div className="bg-glows">
        <div className="glow-1"></div>
        <div className="glow-2"></div>
      </div>

      <header>
        <div className="header-text">
          <h1>
            <svg className="logo-icon" width="44" height="44" viewBox="0 0 44 44">
              {/* Left Ear (8-bit) */}
              <rect x="6" y="2" width="6" height="6" fill="#71717a" />
              <rect x="8" y="4" width="3" height="4" fill="#fca5a5" />
              
              {/* Right Ear (8-bit) */}
              <rect x="32" y="2" width="6" height="6" fill="#71717a" />
              <rect x="33" y="4" width="3" height="4" fill="#fca5a5" />

              {/* Main Head Base (8-bit) */}
              <rect x="6" y="8" width="32" height="30" fill="#a1a1aa" />

              {/* Tabby Head Stripes */}
              <rect x="21" y="8" width="2" height="6" fill="#3f3f46" />
              <rect x="15" y="8" width="2" height="4" fill="#3f3f46" />
              <rect x="27" y="8" width="2" height="4" fill="#3f3f46" />
              
              {/* Cheek Stripes */}
              <rect x="6" y="20" width="6" height="2" fill="#3f3f46" />
              <rect x="6" y="26" width="5" height="2" fill="#3f3f46" />
              <rect x="32" y="20" width="6" height="2" fill="#3f3f46" />
              <rect x="33" y="26" width="5" height="2" fill="#3f3f46" />

              {/* Snout */}
              <rect x="17" y="24" width="10" height="6" fill="#ffffff" />

              {/* Eyes */}
              <rect x="14" y="18" width="4" height="4" fill="#000000" />
              <rect x="26" y="18" width="4" height="4" fill="#000000" />

              {/* Nose */}
              <rect x="21" y="24" width="2" height="2" fill="#fca5a5" />

              {/* Whiskers */}
              <rect x="2" y="26" width="8" height="1" fill="#000000" />
              <rect x="34" y="26" width="8" height="1" fill="#000000" />
            </svg>
            Sarawut Video Downloader
          </h1>
          <p>ดาวน์โหลดวิดีโอและไฟล์เสียงความละเอียดสูงจากเว็บต่าง ๆ ได้ฟรี สะดวก รวดเร็ว</p>
        </div>

        <div className="theme-switcher">
          <button 
            type="button"
            className={`theme-btn ${theme === 'minimalist-dark' ? 'active' : ''}`}
            onClick={() => setTheme('minimalist-dark')}
          >
            Dark
          </button>
          <button 
            type="button"
            className={`theme-btn ${theme === 'minimalist-light' ? 'active' : ''}`}
            onClick={() => setTheme('minimalist-light')}
          >
            Light
          </button>
          <button 
            type="button"
            className={`theme-btn ${theme === 'retro-8bit' ? 'active' : ''}`}
            onClick={() => setTheme('retro-8bit')}
          >
            8-Bit
          </button>
          <button 
            type="button"
            className={`theme-btn ${theme === 'retro-16bit' ? 'active' : ''}`}
            onClick={() => setTheme('retro-16bit')}
          >
            16-Bit
          </button>
        </div>
      </header>

      {/* Main Glass Box */}
      <main className="glass-card">
        {/* Search Input Section */}
        <form onSubmit={handleFetchInfo} className="input-section">
          <div className="url-input-wrapper">
            <input
              type="url"
              className="url-input"
              placeholder="วางลิงก์วิดีโอของคุณที่นี่ (เช่น YouTube, TikTok, Facebook, Vimeo...)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isLoadingInfo || downloadState.isDownloading}
              required
            />
            <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          
          <button 
            type="submit" 
            className="glow-btn"
            disabled={isLoadingInfo || downloadState.isDownloading || !url.trim()}
          >
            {isLoadingInfo ? (
              <>
                <div className="spinner"></div>
                กำลังวิเคราะห์...
              </>
            ) : (
              <>
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                ดึงข้อมูลวิดีโอ
              </>
            )}
          </button>

          <button 
            type="button" 
            className="open-folder-btn" 
            title="เปิดโฟลเดอร์ดาวน์โหลด"
            onClick={handleOpenDownloads}
            disabled={isOpenFolderLoading}
          >
            {isOpenFolderLoading ? (
              <div className="spinner" style={{width: 18, height: 18}}></div>
            ) : (
              <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            )}
          </button>
        </form>

        {/* Error Notification */}
        {error && (
          <div className="error-banner" style={{ marginTop: '1.5rem' }}>
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Success Notification */}
        {successMessage && (
          <div className="error-banner" style={{ marginTop: '1.5rem', background: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.25)', color: '#a7f3d0' }}>
            <svg width="20" height="20" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span>{successMessage}</span>
          </div>
        )}

        {/* Video Metadata Display */}
        {videoInfo && !downloadState.isDownloading && (
          <div className="media-details">
            <div className="thumbnail-wrapper">
              <img src={videoInfo.thumbnail} alt={videoInfo.title} />
              <div className="duration-badge">{formatDuration(videoInfo.duration)}</div>
            </div>
            
            <div className="media-info">
              <div className="media-meta">
                <h2>{videoInfo.title}</h2>
                <div className="uploader-name">{videoInfo.uploader}</div>
              </div>

              <div className="download-options">
                <div className="options-row">
                  <select 
                    value={selectedFormat} 
                    onChange={(e) => setSelectedFormat(e.target.value)}
                  >
                    <option value="best">ดีที่สุด (Best Video + Best Audio)</option>
                    <option value="bestvideo">ความละเอียดสูงสุด (Video Only)</option>
                    <option value="bestaudio">ไฟล์เสียงอย่างเดียว (Best Audio MP3)</option>
                    
                    {/* Render unique formats filtered by resolutions */}
                    {videoInfo.formats
                      .filter(f => f.resolution && f.resolution !== 'audio only')
                      // Filter down to unique resolutions to avoid cluttering dropdown
                      .filter((f, idx, self) => self.findIndex(t => t.resolution === f.resolution && t.extension === f.extension) === idx)
                      .slice(0, 10) // Limit to top 10 options
                      .map(f => (
                        <option key={f.formatId} value={f.formatId}>
                          วิดีโอ {f.resolution} ({f.extension}) {f.note ? `- ${f.note}` : ''}
                        </option>
                      ))}
                  </select>
                  
                  <button onClick={handleDownload} className="glow-btn">
                    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    ดาวน์โหลด
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Real-time Progress Display */}
        {downloadState.isDownloading && (
          <div className="progress-card">
            <div className="progress-header">
              <div className="progress-title">
                {getStatusText(downloadState.status)}
              </div>
              <div className="progress-percent">
                {Math.round(downloadState.percent)}%
              </div>
            </div>

            <div className="progress-bar-container">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${downloadState.percent}%` }}
              ></div>
            </div>

            {downloadState.filename && (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ไฟล์: {downloadState.filename}
              </div>
            )}

            <div className="progress-stats">
              <div className="stat-item">
                <div className="stat-label">ความเร็ว</div>
                <div className="stat-value">{downloadState.speed || '-'}</div>
              </div>
              <div className="stat-item">
                <div className="stat-label">เวลาที่เหลือ</div>
                <div className="stat-value">{downloadState.eta || '-'}</div>
              </div>
              <div className="stat-item">
                <div className="stat-label">ขนาดไฟล์</div>
                <div className="stat-value">{downloadState.size || '-'}</div>
              </div>
            </div>

            <button onClick={handleCancelDownload} className="cancel-btn">
              ยกเลิกการดาวน์โหลด
            </button>
          </div>
        )}
      </main>

      {/* Downloads History Panel */}
      <section className="glass-card">
        <div className="history-section">
          <div className="history-header">
            <h2>ประวัติการดาวน์โหลด</h2>
            {history.length > 0 && (
              <button onClick={handleClearHistory} className="clear-btn">
                ล้างประวัติทั้งหมด
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div className="empty-history">
              <svg fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p>ไม่มีประวัติการดาวน์โหลด</p>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>วิดีโอที่คุณดาวน์โหลดสำเร็จจะปรากฏที่นี่</span>
            </div>
          ) : (
            <div className="history-list">
              {history.map((item) => (
                <div key={item.id} className="history-item">
                  <div className="history-thumb">
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt={item.title} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', background: 'rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                    <div className="duration-badge">{formatDuration(item.duration)}</div>
                  </div>

                  <div className="history-details">
                    <h3>{item.title}</h3>
                    <div className="history-meta">
                      <span className="uploader-name" style={{ fontSize: '0.8rem' }}>{item.uploader}</span>
                      <span>•</span>
                      <span>Format: {item.formatId}</span>
                      <span>•</span>
                      <span className="history-date">
                        {new Date(item.downloadDate).toLocaleDateString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  <div className="history-actions">
                    <a 
                      href={`/files/${encodeURIComponent(item.filename)}`} 
                      download={item.filename}
                      className="action-btn" 
                      title="ดาวน์โหลดลงเครื่อง"
                    >
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </a>
                    <button 
                      className="action-btn" 
                      title="เปิดโฟลเดอร์ดาวน์โหลด"
                      onClick={handleOpenDownloads}
                    >
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </button>
                    <button 
                      className="action-btn delete" 
                      title="ลบเฉพาะประวัติ"
                      onClick={() => handleDeleteHistory(item.id, false)}
                    >
                      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    <button 
                      className="action-btn delete" 
                      style={{ background: 'rgba(239, 68, 68, 0.05)' }}
                      title="ลบไฟล์และประวัติ"
                      onClick={() => handleDeleteHistory(item.id, true)}
                    >
                      <span style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>FILE</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Walking Tabby Cat (แมวลายสลิดสีเทา) - Chasing the mouse */}
      <div 
        className={`walking-cat-container ${catPos.isRunning ? 'running' : ''}`}
        style={{ 
          left: `${catPos.x}px`, 
          top: `${catPos.y}px`,
          transform: `scaleX(${catPos.direction})`,
          position: 'fixed'
        }}
      >
        {showBubble && <div className="cat-speech-bubble">{bubbleText}</div>}
        <svg width="90" height="55" viewBox="0 0 90 55">
          {/* Curled Tail (8-bit) */}
          <path className="cat-tail" d="M18,24 L10,24 L10,14 L14,14 L14,20 L18,20 Z" fill="#a1a1aa" />
          
          {/* Legs (8-bit) */}
          <rect className="cat-leg leg-back-left" x="22" y="36" width="6" height="14" fill="#71717a" />
          <rect className="cat-leg leg-front-right" x="46" y="36" width="6" height="14" fill="#a1a1aa" />
          <rect className="cat-leg leg-back-right" x="28" y="36" width="6" height="14" fill="#a1a1aa" />
          <rect className="cat-leg leg-front-left" x="52" y="36" width="6" height="14" fill="#71717a" />

          {/* Body (8-bit) */}
          <rect x="18" y="20" width="40" height="18" fill="#a1a1aa" />
          
          {/* Stripes on body (8-bit) */}
          <rect x="28" y="20" width="3" height="8" fill="#3f3f46" />
          <rect x="34" y="20" width="3" height="10" fill="#3f3f46" />
          <rect x="40" y="20" width="3" height="10" fill="#3f3f46" />
          <rect x="46" y="20" width="3" height="8" fill="#3f3f46" />

          {/* Head (8-bit) */}
          <rect x="52" y="8" width="18" height="18" fill="#a1a1aa" />
          {/* Head Stripes */}
          <rect x="58" y="8" width="2" height="6" fill="#3f3f46" />
          <rect x="64" y="8" width="2" height="6" fill="#3f3f46" />
          <rect x="52" y="16" width="3" height="2" fill="#3f3f46" />
          <rect x="67" y="16" width="3" height="2" fill="#3f3f46" />
          
          {/* Ears (Outer Grey, Inner Pink) */}
          <rect x="52" y="2" width="4" height="6" fill="#71717a" />
          <rect x="53" y="4" width="2" height="4" fill="#fca5a5" />
          <rect x="66" y="2" width="4" height="6" fill="#71717a" />
          <rect x="67" y="4" width="2" height="4" fill="#fca5a5" />
          
          {/* Eyes */}
          <rect x="55" y="13" width="2" height="2" fill="#000000" />
          <rect x="63" y="13" width="2" height="2" fill="#000000" />
          
          {/* Snout & Nose */}
          <rect x="57" y="17" width="6" height="4" fill="#ffffff" />
          <rect x="59" y="17" width="2" height="2" fill="#fca5a5" />
          
          {/* Whiskers */}
          <rect x="47" y="18" width="4" height="1" fill="#000000" />
          <rect x="71" y="18" width="4" height="1" fill="#000000" />
        </svg>
      </div>

      {/* Sleeping White Cat (แมวขาวนอนหลับ) */}
      <div 
        className={`sleeping-cat-container ${isSleepingCatAwake ? 'awake' : ''}`}
        onMouseEnter={() => { setIsSleepingCatHovered(true); if (!isSleepingCatAwake) setSleepingCatBubble('ฟี่... 💤'); }}
        onMouseLeave={() => { setIsSleepingCatHovered(false); if (!isSleepingCatAwake) setSleepingCatBubble(null); }}
        onClick={() => {
          if (!isSleepingCatAwake) {
            setIsSleepingCatAwake(true);
            setSleepingCatBubble('แง๊วว? ☀️');
            setTimeout(() => {
              setIsSleepingCatAwake(false);
              setSleepingCatBubble(null);
            }, 2500);
          }
        }}
      >
        {sleepingCatBubble && <div className="cat-speech-bubble">{sleepingCatBubble}</div>}
        <svg width="70" height="45" viewBox="0 0 70 45">
          {/* Zzz floating effects */}
          {!isSleepingCatAwake && (
            <g className="sleeping-zzz-group">
              <text className="zzz-1" x="56" y="8">Z</text>
              <text className="zzz-2" x="59" y="4">z</text>
              <text className="zzz-3" x="62" y="1">z</text>
            </g>
          )}

          {/* Tail curled around (8-bit) */}
          <path className="sleeping-cat-tail" d="M12 28 H34 V32 H10 V24 H12 Z" fill="#ffffff" />
          
          {/* Body (8-bit) */}
          <rect className="sleeping-cat-body" x="14" y="18" width="32" height="22" fill="#ffffff" />
          {/* Shadows */}
          <rect x="14" y="20" width="28" height="20" fill="#f3f4f6" />
          <rect x="16" y="18" width="28" height="20" fill="#ffffff" />

          {/* Head (8-bit) */}
          <rect x="42" y="12" width="16" height="16" fill="#ffffff" />
          
          {/* Ears (Outer White, Inner Pink) */}
          <rect x="42" y="6" width="4" height="6" fill="#ffffff" />
          <rect x="43" y="8" width="2" height="4" fill="#fca5a5" />
          <rect x="54" y="6" width="4" height="6" fill="#ffffff" />
          <rect x="55" y="8" width="2" height="4" fill="#fca5a5" />
          
          {/* Eyes (Open or Closed based on state) */}
          {isSleepingCatAwake ? (
            <>
              <rect x="45" y="17" width="2" height="2" fill="#000000" />
              <rect x="51" y="17" width="2" height="2" fill="#000000" />
            </>
          ) : (
            <>
              <rect x="44" y="18" width="3" height="1" fill="#4b5563" />
              <rect x="51" y="18" width="3" height="1" fill="#4b5563" />
            </>
          )}
          
          {/* Nose */}
          <rect x="49" y="21" width="2" height="1" fill="#fca5a5" />
          
          {/* Whiskers */}
          <rect x="36" y="20" width="5" height="1" fill="#d1d5db" />
          <rect x="59" y="20" width="5" height="1" fill="#d1d5db" />
        </svg>
      </div>
    </div>
  );
}

export default App;
