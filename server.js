const express = require("express");
const multer = require("multer");
const archiver = require("archiver");
const cors = require("cors");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");
const os = require("os");

const app = express();

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ storage: multer.memoryStorage() });

// SSE progress
let clients = [];
app.get("/progress", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  res.flushHeaders();
  clients.push(res);

  req.on("close", () => {
    clients = clients.filter(c => c !== res);
  });
});

function send(msg) {
  clients.forEach(c => c.write(`data: ${msg}\n\n`));
}

// FFmpeg processor
function runFFmpeg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd =
      `ffmpeg -y -i "${inputPath}" -af ` +
      `"silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB:` +
      `stop_periods=1:stop_silence=0.1:stop_threshold=-40dB,` +
      `dynaudnorm=f=50:g=10" ` +
      `"${outputPath}"`;

    exec(cmd, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// MAIN ENDPOINT — upload MP4s directly
app.post("/process", upload.array("files"), async (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).send("No MP4s uploaded.");

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apt2u-"));
  const outputZipPath = path.join(tmpRoot, "output.zip");

  const outputStream = fs.createWriteStream(outputZipPath);
  const archive = archiver("zip");
  archive.pipe(outputStream);

  const total = req.files.length;
  let processed = 0;

  for (const file of req.files) {
    processed++;
    send(`Processing ${processed} of ${total} :: ${file.originalname}`);

    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);

    const inPath = path.join(tmpRoot, `in_${processed}${ext}`);
    const outPath = path.join(tmpRoot, `out_${processed}.wav`);

    fs.writeFileSync(inPath, file.buffer);

    await runFFmpeg(inPath, outPath);

    archive.file(outPath, { name: `${base}.wav` });

    fs.unlinkSync(inPath);
    fs.unlinkSync(outPath);
  }

  send("DONE");
  archive.finalize();

  outputStream.on("close", () => {
    const finalZip = fs.readFileSync(outputZipPath);

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=apt2u_processed.zip"
    });

    res.send(finalZip);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`apt2u MP4 direct-upload server running on port ${PORT}`)
);
