import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { getVideoInfo, downloadVideo } from './services/downloader.js';

const app = express();
const PORT = process.env.PORT || 5000;
const DOWNLOADS_DIR = path.resolve(process.cwd(), 'downloads');
const HISTORY_FILE = path.resolve(process.cwd(), 'history.json');

// Middleware
app.use(cors());
app.use(express.json());

// Load history helper
function getHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch (error) {
    console.error('Error reading history file:', error);
  }
  return [];
}

// Save history helper
function saveHistory(history) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing history file:', error);
  }
}

// Keep track of active download child processes
const activeDownloads = new Map();

// API: Get Video Info
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    console.log(`Fetching info for URL: ${url}`);
    const info = await getVideoInfo(url);
    res.json(info);
  } catch (error) {
    console.error(`Error fetching info for ${url}:`, error.message);
    res.status(500).json({ error: error.message || 'Failed to extract video information' });
  }
});

// API: Download video via SSE stream
app.get('/api/download-stream', (req, res) => {
  const { url, formatId, title, thumbnail, duration, uploader } = req.query;

  if (!url) {
    return res.status(400).write('data: {"status":"error", "message":"URL is required"}\n\n');
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const downloadId = Date.now().toString();

  console.log(`Starting download stream [ID: ${downloadId}] for: ${url}`);

  const childProcess = downloadVideo({
    url,
    formatId: formatId || 'best',
    outputDir: DOWNLOADS_DIR,
    onProgress: (progress) => {
      res.write(`data: ${JSON.stringify(progress)}\n\n`);
    },
    onComplete: (data) => {
      // Add to history
      const history = getHistory();
      const newHistoryItem = {
        id: downloadId,
        title: title || data.filename,
        uploader: uploader || 'Unknown',
        thumbnail: thumbnail || '',
        duration: duration ? parseInt(duration) : 0,
        filename: data.filename,
        filepath: path.join(DOWNLOADS_DIR, data.filename),
        downloadDate: new Date().toISOString(),
        formatId: formatId || 'best'
      };

      history.unshift(newHistoryItem);
      saveHistory(history);

      res.write(`data: ${JSON.stringify({ status: 'completed', filename: data.filename, historyItem: newHistoryItem })}\n\n`);
      res.end();
      activeDownloads.delete(downloadId);
    },
    onError: (error) => {
      res.write(`data: ${JSON.stringify({ status: 'error', message: error.message })}\n\n`);
      res.end();
      activeDownloads.delete(downloadId);
    }
  });

  // Track child process
  activeDownloads.set(downloadId, childProcess);

  // If client disconnects (tab closed, page refreshed, request cancelled)
  req.on('close', () => {
    console.log(`SSE connection closed for download [ID: ${downloadId}]`);
    const proc = activeDownloads.get(downloadId);
    if (proc) {
      console.log(`Killing child process for download [ID: ${downloadId}]`);
      proc.kill('SIGINT'); // Send interrupt signal to yt-dlp to stop gracefully
      activeDownloads.delete(downloadId);
    }
  });
});

// API: Get History
app.get('/api/history', (req, res) => {
  res.json(getHistory());
});

// API: Delete from History
app.delete('/api/history/:id', (req, res) => {
  const { id } = req.params;
  const deleteFile = req.query.deleteFile === 'true';

  let history = getHistory();
  const item = history.find((i) => i.id === id);

  if (item && deleteFile) {
    try {
      if (fs.existsSync(item.filepath)) {
        fs.unlinkSync(item.filepath);
        console.log(`Deleted file: ${item.filepath}`);
      }
    } catch (err) {
      console.error(`Failed to delete file ${item.filepath}:`, err.message);
    }
  }

  history = history.filter((i) => i.id !== id);
  saveHistory(history);
  res.json({ success: true, history });
});

// API: Clear All History
app.post('/api/history/clear', (req, res) => {
  saveHistory([]);
  res.json({ success: true, history: [] });
});

// API: Open Downloads Folder on Windows
app.post('/api/open-downloads', (req, res) => {
  try {
    console.log(`Opening folder: ${DOWNLOADS_DIR}`);
    // Spawn explorer with the path to downloads directory
    spawn('explorer.exe', [DOWNLOADS_DIR]);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to open downloads folder:', error);
    res.status(500).json({ error: 'Failed to open downloads folder' });
  }
});

// Expose downloaded files statically at /files endpoint
app.use('/files', express.static(DOWNLOADS_DIR));

// Serve built frontend assets in production mode
const CLIENT_DIST_DIR = path.resolve(process.cwd(), 'client', 'dist');
if (fs.existsSync(CLIENT_DIST_DIR)) {
  console.log(`Production mode: Serving static files from ${CLIENT_DIST_DIR}`);
  app.use(express.static(CLIENT_DIST_DIR));
  
  // Catch-all route to serve the React SPA index.html for unknown routes
  app.get('*', (req, res, next) => {
    // If it's a backend endpoint or a file request that wasn't found, let it pass to 404 handler
    if (req.path.startsWith('/api') || req.path.startsWith('/files')) {
      return next();
    }
    res.sendFile(path.join(CLIENT_DIST_DIR, 'index.html'));
  });
}

// Start Server
app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
  console.log(`Downloads directory path: ${DOWNLOADS_DIR}`);
});
