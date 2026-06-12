import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import ffmpeg from '@ffmpeg-installer/ffmpeg';

const ffmpegPath = ffmpeg.path;

// Ensure downloads folder exists
const DEFAULT_DOWNLOAD_DIR = path.resolve(process.cwd(), 'downloads');
if (!fs.existsSync(DEFAULT_DOWNLOAD_DIR)) {
  fs.mkdirSync(DEFAULT_DOWNLOAD_DIR, { recursive: true });
}

/**
 * Fetch video metadata using yt-dlp
 * @param {string} url - The video URL
 * @returns {Promise<Object>} - Simplified metadata object
 */
export function getVideoInfo(url) {
  return new Promise((resolve, reject) => {
    // Spawn python -m yt_dlp with -J (dump json)
    const args = [
      '-m', 'yt_dlp',
      '--ffmpeg-location', ffmpegPath,
      '-J',
      '--no-playlist', // Only fetch single video info
      url
    ];

    const child = spawn('python', args);

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.error('yt-dlp info error:', stderrData);
        return reject(new Error(stderrData || `yt-dlp exited with code ${code}`));
      }

      try {
        const rawInfo = JSON.parse(stdoutData);
        
        // Handle playlist or channel page url gracefully
        if (!rawInfo.formats && rawInfo.entries) {
          return reject(new Error('ลิงก์นี้เป็นรายการเล่น (Playlist) หรือหน้าช่อง (Channel) กรุณาใช้ลิงก์ตัววิดีโอเดี่ยว ๆ เพื่อดาวน์โหลด'));
        }

        if (!rawInfo.formats) {
          return reject(new Error('ไม่พบรูปแบบไฟล์วิดีโอที่สามารถดาวน์โหลดได้'));
        }
        
        // Filter and format the formats list
        const formats = rawInfo.formats
          .filter(f => {
            // Keep formats that have both audio/video, or are audio-only, or are useful high-quality video-only
            return f.vcodec !== 'none' || f.acodec !== 'none';
          })
          .map(f => {
            let resolution = 'audio only';
            if (f.vcodec !== 'none') {
              resolution = f.resolution || `${f.width}x${f.height}` || `${f.height}p`;
              if (f.height) {
                resolution = `${f.height}p`;
              }
            }

            return {
              formatId: f.format_id,
              extension: f.ext,
              resolution,
              fps: f.fps,
              fileSize: f.filesize || f.filesize_approx || null,
              vcodec: f.vcodec,
              acodec: f.acodec,
              note: f.format_note || ''
            };
          });

        const info = {
          id: rawInfo.id,
          title: rawInfo.title,
          thumbnail: rawInfo.thumbnail || (rawInfo.thumbnails && rawInfo.thumbnails.length ? rawInfo.thumbnails[rawInfo.thumbnails.length - 1].url : ''),
          description: rawInfo.description,
          duration: rawInfo.duration, // in seconds
          uploader: rawInfo.uploader || rawInfo.channel,
          webpageUrl: rawInfo.webpage_url,
          formats: formats
        };

        resolve(info);
      } catch (err) {
        reject(new Error(`Failed to parse video info: ${err.message}`));
      }
    });
  });
}

/**
 * Download a video and track progress
 * @param {Object} options
 * @param {string} options.url - Video URL
 * @param {string} options.formatId - Selected format ID (e.g. 'bestvideo+bestaudio' or specific id)
 * @param {string} options.outputDir - Output directory
 * @param {Function} options.onProgress - Progress callback
 * @param {Function} options.onComplete - Completion callback
 * @param {Function} options.onError - Error callback
 * @returns {Object} - Control object containing the child process (for cancellation)
 */
export function downloadVideo({ url, formatId = 'best', outputDir = DEFAULT_DOWNLOAD_DIR, onProgress, onComplete, onError }) {
  // Setup output path template: title.ext
  // yt-dlp template: %(title)s.%(ext)s
  const outputPath = path.join(outputDir, '%(title)s.%(ext)s');

  let resolvedFormatId = formatId;
  if (formatId === 'best') {
    resolvedFormatId = 'bestvideo+bestaudio/best';
  }

  const args = [
    '-m', 'yt_dlp',
    '--ffmpeg-location', ffmpegPath,
    '-f', resolvedFormatId,
    '-o', outputPath,
    '--newline', // Output progress per line
    '--progress',
    '--no-playlist',
    url
  ];

  // If format is audio-only, we should extract and convert it to MP3 or M4A
  if (formatId === 'bestaudio' || formatId.includes('audio')) {
    args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
  }

  const child = spawn('python', args);
  let errorSent = false;
  let filename = '';

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      console.log(`[yt-dlp stdout]: ${trimmed}`);

      // Parse filename being written
      // Example: [download] Destination: C:\path\to\video.mp4
      if (trimmed.startsWith('[download] Destination:')) {
        filename = trimmed.replace('[download] Destination:', '').trim();
      }

      // Parse progress information
      // Format: [download]  12.3% of 45.12MiB at  3.12MiB/s ETA 00:15
      // Format: [download]  100% of 45.12MiB in 00:10
      if (trimmed.startsWith('[download]')) {
        const percentMatch = trimmed.match(/(\d+(?:\.\d+)?)%/);
        if (percentMatch) {
          const percent = parseFloat(percentMatch[1]);
          
          let size = '';
          const sizeMatch = trimmed.match(/of\s+([~\d.]+[a-zA-Z]+)/);
          if (sizeMatch) size = sizeMatch[1];

          let speed = '';
          const speedMatch = trimmed.match(/at\s+([\d.]+[a-zA-Z/]+)/);
          if (speedMatch) speed = speedMatch[1];

          let eta = '';
          const etaMatch = trimmed.match(/ETA\s+([\d:]+)/);
          if (etaMatch) eta = etaMatch[1];

          onProgress({
            status: 'downloading',
            percent,
            size,
            speed,
            eta,
            filename: path.basename(filename)
          });
        }
      }

      // Parse ffmpeg merging / post-processing
      // Format: [Merger] Merging formats into "..."
      if (trimmed.startsWith('[Merger]')) {
        onProgress({
          status: 'merging',
          percent: 99,
          size: '',
          speed: '',
          eta: '',
          filename: path.basename(filename)
        });
      }

      // Parse post-processing / extracting audio
      // Format: [ExtractAudio] Destination: ...
      if (trimmed.startsWith('[ExtractAudio]')) {
        onProgress({
          status: 'extracting_audio',
          percent: 99,
          size: '',
          speed: '',
          eta: '',
          filename: path.basename(filename)
        });
      }
    }
  });

  child.stderr.on('data', (data) => {
    const errorStr = data.toString();
    console.error(`[yt-dlp stderr]: ${errorStr}`);
    
    // Some warnings are output to stderr, don't treat them as fatal unless they stop the process
    if (errorStr.toLowerCase().includes('error:')) {
      if (!errorSent) {
        errorSent = true;
        onError(new Error(errorStr));
      }
    }
  });

  child.on('close', (code) => {
    if (code === 0) {
      onComplete({
        status: 'completed',
        filename: path.basename(filename)
      });
    } else {
      if (!errorSent) {
        onError(new Error(`Download process exited with code ${code}`));
      }
    }
  });

  return child; // Return child process to allow client to cancel
}
