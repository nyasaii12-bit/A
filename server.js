const express = require("express");
const multer = require("multer");
const unzipper = require("unzipper");
const archiver = require("archiver");
const cors = require("cors");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");
const os = require("os");

const app = express();

// ⭐ THIS LINE MAKES THE UI WORK — DO NOT REMOVE
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

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
// FFmpeg Processor
// ------------------------------
function runFFmpeg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd =
      `ffmpeg -y -i "${inputPath}" -af ` +
      `"silenceremove=start_periods=1:start_silence=0.1:start_threshold=-40dB:` +
      `stop_periods=1:stop_silence=0.1:stop_threshold=-40dB,` +
      `dynaudnorm=f=75:g=15,` +
      `aformat=sample_fmts=s16:sample_rates=44100" ` +
      `"${outputPath}"`;

    exec(cmd, (error) => {
      if (error) return reject(error);
      resolve();
    });
  });
}

// ------------------------------
// STREAMING ZIP PROCESSOR
// ------------------------------
app.post("/process", upload.single("zipfile"), async (req, res) => {
  if (!req.file) return res.status(400).send("No ZIP uploaded.");

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apt2u-"));
  const inputZipPath = path.join(tmpRoot, "input.zip");
  fs.writeFileSync(inputZipPath, req.file.buffer);

  const outputZipPath = path.join(tmpRoot, "output.zip");
  const outputStream = fs.createWriteStream(outputZipPath);
  const archive = archiver("zip");
  archive.pipe(outputStream);

  let totalFiles = 0;
  let processedFiles = 0;

  // Count files
  await new Promise((resolve) => {
    fs.createReadStream(inputZipPath)
      .pipe(unzipper.Parse())
      .on("entry", (entry) => {
        if (!entry.path.endsWith("/")) totalFiles++;
        entry.autodrain();
      })
      .on("close", resolve);
  });

  // Process files
  await new Promise((resolve) => {
    fs.createReadStream(inputZipPath)
      .pipe(unzipper.Parse())
      .on("entry", async (entry) => {
        if (entry.path.endsWith("/")) {
          entry.autodrain();
          return;
        }

        processedFiles++;

        // ⭐ Send progress + filename
        sendProgress(`Processing ${processedFiles} of ${totalFiles} :: ${entry.path}`);

        const ext = path.extname(entry.path);
        const base = path.basename(entry.path, ext);

        const inPath = path.join(tmpRoot, `in_${processedFiles}${ext}`);
        const outPath = path.join(tmpRoot, `out_${processedFiles}.wav`);

        const writeStream = fs.createWriteStream(inPath);
        entry.pipe(writeStream);

        await new Promise((r) => writeStream.on("finish", r));

        await runFFmpeg(inPath, outPath);

        archive.file(outPath, { name: `${base}.wav` });

        fs.unlinkSync(inPath);
        fs.unlinkSync(outPath);
      })
      .on("close", resolve);
  });

  sendProgress("DONE");

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

// ------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`apt2u streaming server running on port ${PORT}`)
);
