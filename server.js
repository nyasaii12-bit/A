const express = require("express");
const multer = require("multer");
const yauzl = require("yauzl");
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

// ------------------------------
// SSE Progress
// ------------------------------
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

// ------------------------------
// FFmpeg
// ------------------------------
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

// ------------------------------
// TRUE STREAMING ZIP PROCESSOR
// ------------------------------
app.post("/process", upload.single("zipfile"), async (req, res) => {
  if (!req.file) return res.status(400).send("No ZIP uploaded.");

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apt2u-"));
  const zipPath = path.join(tmpRoot, "input.zip");
  fs.writeFileSync(zipPath, req.file.buffer);

  const outputZipPath = path.join(tmpRoot, "output.zip");
  const outputStream = fs.createWriteStream(outputZipPath);
  const archive = archiver("zip");
  archive.pipe(outputStream);

  // Open ZIP in streaming mode
  const zip = await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) reject(err);
      else resolve(zipfile);
    });
  });

  let total = 0;
  let processed = 0;

  // First pass: count entries
  await new Promise((resolve) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, z) => {
      z.readEntry();
      z.on("entry", (entry) => {
        if (!entry.fileName.endsWith("/")) total++;
        z.readEntry();
      });
      z.on("end", resolve);
    });
  });

  // Second pass: process entries one-by-one
  zip.readEntry();

  zip.on("entry", (entry) => {
    if (entry.fileName.endsWith("/")) {
      zip.readEntry();
      return;
    }

    processed++;
    send(`Processing ${processed} of ${total} :: ${entry.fileName}`);

    const ext = path.extname(entry.fileName);
    const base = path.basename(entry.fileName, ext);

    const inPath = path.join(tmpRoot, `in_${processed}${ext}`);
    const outPath = path.join(tmpRoot, `out_${processed}.wav`);

    zip.openReadStream(entry, async (err, readStream) => {
      if (err) throw err;

      const writeStream = fs.createWriteStream(inPath);
      readStream.pipe(writeStream);

      writeStream.on("finish", async () => {
        await runFFmpeg(inPath, outPath);

        archive.file(outPath, { name: `${base}.wav` });

        fs.unlinkSync(inPath);
        fs.unlinkSync(outPath);

        zip.readEntry();
      });
    });
  });

  zip.on("end", () => {
    send("DONE");
    archive.finalize();
  });

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
  console.log(`apt2u TRUE streaming server running on port ${PORT}`)
);
