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

// Upload endpoint: POST /api/upload/:sessionId
// Expects multipart fields: color, bw, animation (each is a file)
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
    const uploaded = {};
    for (const [key, fileArray] of Object.entries(files || {})) {
      if (fileArray && fileArray.length > 0) {
        uploaded[key] = fileArray[0].originalname;
      }
    }
    console.log(`Uploaded session ${sessionId}:`, uploaded);
    res.json({ success: true, sessionId, files: uploaded });
  }
);

// Serve files: GET /download/:sessionId/:filename
app.get("/download/:sessionId/:filename", (req, res) => {
  const filePath = path.join(DATA_DIR, req.params.sessionId, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

// Download portal: GET /download/:sessionId
app.get("/download/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const sessionDir = path.join(DATA_DIR, sessionId);
  const hasColor = fs.existsSync(path.join(sessionDir, "color.png"));
  const hasBW = fs.existsSync(path.join(sessionDir, "bw.png"));
  const hasGif = fs.existsSync(path.join(sessionDir, "animation.gif"));

  if (!hasColor && !hasBW && !hasGif) {
    return res.status(404).json({ error: "Session not found" });
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
  res.json({ status: "ok", name: "Loveshots Photobooth Server" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Loveshots server running on port ${PORT}`);
});
