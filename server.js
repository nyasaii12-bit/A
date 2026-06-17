const express = require("express");
const multer = require("multer");
const JSZip = require("jszip");
const cors = require("cors");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");
const os = require("os");

const app = express();

app.use(cors());
app.use(express.static("public"));

const upload = multer({ storage: multer.memoryStorage() });

// ------------------------------
// SSE Progress Stream
// ------------------------------
let progressClients = [];

app.get("/progress", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  res.flushHeaders();
  progressClients.push(res);

  req.on("close", () => {
    progressClients = progressClients.filter(c => c !== res);
  });
});

function sendProgress(msg) {
  progressClients.forEach(res => res.write(`data: ${msg}\n\n`));
}

// ------------------------------
// Helper: run FFmpeg
// ------------------------------
function runFFmpeg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -i "${inputPath}" -af ` +
      `"silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB:` +
      `stop_periods=1:stop_silence=0.1:stop_threshold=-40dB,` +
      `dynaudnorm=f=75:g=15,` +
      `aformat=sample_fmts=s16:sample_rates=44100" ` +
      `"${outputPath}"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

// ------------------------------
// ZIP Upload Processor
// ------------------------------
app.post("/process", upload.single("zipfile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No ZIP uploaded.");
    }

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apt2u-"));
    const inputZip = new JSZip();
    const loadedZip = await inputZip.loadAsync(req.file.buffer);

    const outputZip = new JSZip();
    const fileNames = Object.keys(loadedZip.files);
    const total = fileNames.length;

    let index = 0;

    for (const name of fileNames) {
      index++;
      sendProgress(`Processing ${index} of ${total}: ${name}`);

      const file = loadedZip.files[name];
      if (file.dir) continue;

      const rawBuffer = await file.async("nodebuffer");

      const inPath = path.join(tmpRoot, `in_${index}${path.extname(name) || ".mp4"}`);
      const outPath = path.join(tmpRoot, `out_${index}.wav`);

      fs.writeFileSync(inPath, rawBuffer);

      await runFFmpeg(inPath, outPath);

      const processedBuffer = fs.readFileSync(outPath);
      const outName = path.basename(name, path.extname(name)) + ".wav";

      outputZip.file(outName, processedBuffer);

      fs.unlinkSync(inPath);
      fs.unlinkSync(outPath);
    }

    sendProgress("DONE");

    const finalZip = await outputZip.generateAsync({ type: "nodebuffer" });

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=apt2u_processed.zip"
    });

    res.send(finalZip);

    fs.rmSync(tmpRoot, { recursive: true, force: true });

  } catch (err) {
    console.error("ZIP processing error:", err);
    sendProgress("ERROR");
    res.status(500).send("Server error while processing ZIP.");
  }
});

// ------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`apt2u ZIP server running on port ${PORT}`));
