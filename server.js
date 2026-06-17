const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");

const app = express();

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

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

    await new Promise((resolve, reject) => {
      const cmd =
        `ffmpeg -y -i "${inPath}" -af ` +
        `"silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB:` +
        `stop_periods=1:stop_silence=0.1:stop_threshold=-40dB,` +
        `dynaudnorm=f=50:g=10" "${outPath}"`;

      exec(cmd, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    const wavBuffer = fs.readFileSync(outPath);

    results.push({
      name: `${base}.wav`,
      buffer: wavBuffer.toString("base64")
    });

    fs.unlinkSync(inPath);
    fs.unlinkSync(outPath);
  }

  res.json(results);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`apt2u separate-download server running on port ${PORT}`)
);
