const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");

const app = express();

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

// Ensure uploads folder exists
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

// Multer disk storage (safe for Render)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename: (req, file, cb) =>
      cb(null, Date.now() + "-" + file.originalname)
  })
});

// Process MP4s and return WAVs separately
app.post("/process", upload.array("files"), async (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).send("No MP4s uploaded.");

  const results = [];

  for (const file of req.files) {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);

    const inPath = file.path;
    const outPath = `uploads/${base}.wav`;

    // FFmpeg: Normalize FIRST, then trim (safe settings)
    await new Promise((resolve, reject) => {
      const cmd =
        `ffmpeg -y -i "${inPath}" -af ` +
        `"dynaudnorm=f=150:g=3:p=0.95,` +
        `silenceremove=start_periods=1:start_silence=0.35:start_threshold=-55dB:` +
        `stop_periods=1:stop_silence=0.35:stop_threshold=-55dB" ` +
        `-acodec pcm_s16le -ar 44100 -ac 2 "${outPath}"`;

      exec(cmd, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // Read WAV as binary
    const wavBuffer = fs.readFileSync(outPath);

    results.push({
      name: `${base}.wav`,
      buffer: wavBuffer.toString("base64")
    });

    // Cleanup
    fs.unlinkSync(inPath);
    fs.unlinkSync(outPath);
  }

  res.json(results);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`apt2u separate-download server running on port ${PORT}`)
);
