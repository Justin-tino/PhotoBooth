const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── In-memory session store ──────────────────────────────────────────────────
// Railway uses ephemeral storage – files on disk are wiped on every redeploy.
// We keep an in-memory map of sessionId → { filename → Buffer } so that
// sessions survive disk wipes (they only disappear on process restart).
const sessionStore = new Map();

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionDir = path.join(DATA_DIR, req.params.sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

// CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// ── Helper: get a file buffer (in-memory first, then disk) ───────────────────
function getFileBuffer(sessionId, filename) {
  // 1. Check in-memory store
  const memSession = sessionStore.get(sessionId);
  if (memSession && memSession[filename]) {
    return memSession[filename];
  }
  // 2. Check disk
  const diskPath = path.join(DATA_DIR, sessionId, filename);
  if (fs.existsSync(diskPath)) {
    return fs.readFileSync(diskPath);
  }
  return null;
}

// ── Helper: check if a session has any files ─────────────────────────────────
function sessionHasFiles(sessionId) {
  const files = ["color.png", "bw.png", "animation.gif"];
  return files.some((f) => getFileBuffer(sessionId, f) !== null);
}

// ── Upload endpoint: POST /api/upload/:sessionId ─────────────────────────────
app.post(
  "/api/upload/:sessionId",
  upload.fields([
    { name: "color", maxCount: 1 },
    { name: "bw", maxCount: 1 },
    { name: "animation", maxCount: 1 },
  ]),
  (req, res) => {
    const { sessionId } = req.params;
    const files = req.files;

    if (!files || Object.keys(files).length === 0) {
      console.error(`Upload ${sessionId} failed: No files in request`);
      return res.status(400).json({ success: false, error: "No files in request" });
    }

    const uploaded = {};
    const memEntry = sessionStore.get(sessionId) || {};

    for (const [key, fileArray] of Object.entries(files)) {
      if (fileArray && fileArray.length > 0) {
        const f = fileArray[0];
        uploaded[key] = f.originalname;

        // Also store in memory so we survive Railway disk wipes
        try {
          const buf = fs.readFileSync(f.path);
          memEntry[f.originalname] = buf;
          console.log(`  Stored ${f.originalname} in memory (${buf.length} bytes)`);
        } catch (e) {
          console.error(`  Failed to read ${f.originalname} into memory: ${e.message}`);
        }
      }
    }

    if (Object.keys(uploaded).length === 0) {
      console.error(`Upload ${sessionId} failed: All file fields empty`);
      return res.status(400).json({ success: false, error: "All file fields empty" });
    }

    sessionStore.set(sessionId, memEntry);
    console.log(`Upload session ${sessionId}: ${JSON.stringify(uploaded)} (${sessionStore.size} active sessions)`);
    res.json({ success: true, sessionId, files: uploaded });
  }
);

// ── Status endpoint: GET /api/status/:sessionId ──────────────────────────────
// The Flutter app calls this to verify files are present before showing the QR
app.get("/api/status/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const hasColor = getFileBuffer(sessionId, "color.png") !== null;
  const hasBW = getFileBuffer(sessionId, "bw.png") !== null;
  const hasGif = getFileBuffer(sessionId, "animation.gif") !== null;
  const ready = hasColor || hasBW || hasGif;

  res.json({
    sessionId,
    ready,
    files: { color: hasColor, bw: hasBW, animation: hasGif },
  });
});

// ── Serve individual files: GET /download/:sessionId/:filename ───────────────
app.get("/download/:sessionId/:filename", (req, res) => {
  const { sessionId, filename } = req.params;
  const buf = getFileBuffer(sessionId, filename);

  if (buf) {
    const contentType = filename.endsWith(".gif") ? "image/gif" : "image/png";
    res.set("Content-Type", contentType);
    res.set("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buf);
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

// ── Download portal: GET /download/:sessionId ────────────────────────────────
app.get("/download/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const hasColor = getFileBuffer(sessionId, "color.png") !== null;
  const hasBW = getFileBuffer(sessionId, "bw.png") !== null;
  const hasGif = getFileBuffer(sessionId, "animation.gif") !== null;

  if (!hasColor && !hasBW && !hasGif) {
    return res.status(404).send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Loveshots Photobooth</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #FFF0F1;
            color: #333;
            margin: 0;
            padding: 20px;
            text-align: center;
        }
        .container {
            max-width: 500px;
            margin: 40px auto;
            background: white;
            padding: 40px 20px;
            border-radius: 24px;
            box-shadow: 0 10px 25px rgba(244, 63, 94, 0.1);
            border: 1px solid #FDD1D4;
        }
        h1 { color: #FF69B4; font-size: 28px; margin-bottom: 10px; font-weight: 900; }
        p { color: #666; font-size: 16px; line-height: 1.6; }
        .icon { font-size: 48px; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">📸</div>
        <h1>Session Not Ready</h1>
        <p>Your photos are still being uploaded, or the session may have expired.</p>
        <p style="font-size:13px; color:#999; margin-top:20px;">Try scanning the QR code again in a moment, or ask the booth operator for help.</p>
    </div>
</body>
</html>
    `);
  }

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Loveshots Photobooth</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #FFF0F1;
            color: #333;
            margin: 0;
            padding: 20px;
            text-align: center;
        }
        .container {
            max-width: 500px;
            margin: 0 auto;
            background: white;
            padding: 30px 20px;
            border-radius: 24px;
            box-shadow: 0 10px 25px rgba(244, 63, 94, 0.1);
            border: 1px solid #FDD1D4;
        }
        h1 {
            color: #FF69B4;
            font-size: 28px;
            margin-bottom: 5px;
            font-weight: 900;
            letter-spacing: 1px;
        }
        .subtitle {
            color: #666;
            font-size: 14px;
            margin-bottom: 25px;
        }
        .preview {
            max-width: 100%;
            border-radius: 16px;
            margin-bottom: 25px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
            border: 2px solid #FFF;
        }
        .btn {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px 20px;
            margin: 12px 0;
            background-color: #FF69B4;
            color: white;
            text-decoration: none;
            border-radius: 14px;
            font-weight: bold;
            font-size: 16px;
            box-shadow: 0 4px 10px rgba(255, 105, 180, 0.3);
            transition: all 0.2s ease;
        }
        .btn-alt {
            background-color: #1E293B;
            box-shadow: 0 4px 10px rgba(30, 41, 59, 0.3);
        }
        .btn:active {
            transform: scale(0.98);
        }
        .footer {
            margin-top: 30px;
            font-size: 11px;
            color: #999;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>LOVESHOTS</h1>
        <div class="subtitle">Thank you for celebrating with us!</div>
        
        ${hasColor ? `<img class="preview" src="${baseUrl}/download/${sessionId}/color.png" alt="Your Collage Preview">` : ""}
        
        ${hasColor ? `<a class="btn" href="${baseUrl}/download/${sessionId}/color.png" download="loveshots_color.png">Download Color Collage</a>` : ""}
        ${hasBW ? `<a class="btn btn-alt" href="${baseUrl}/download/${sessionId}/bw.png" download="loveshots_bw.png">Download Black & White</a>` : ""}
        ${hasGif ? `<a class="btn" style="background-color: #8B5CF6; box-shadow: 0 4px 10px rgba(139, 92, 246, 0.3);" href="${baseUrl}/download/${sessionId}/animation.gif" download="loveshots_gif.gif">Download Looping GIF</a>` : ""}
        
        <div class="footer">Loveshots Photobooth</div>
    </div>
</body>
</html>
  `);
});

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", name: "Loveshots Photobooth Server", activeSessions: sessionStore.size });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Loveshots server running on port ${PORT}`);
});
