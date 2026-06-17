const express = require("express");
const multer = require("multer");
const JSZip = require("jszip");
const cors = require("cors");
const path = require("path");

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
// ZIP Upload Processor
// ------------------------------
app.post("/process", upload.single("zipfile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No ZIP uploaded.");
    }

    const inputZip = new JSZip();
    const loadedZip = await inputZip.loadAsync(req.file.buffer);

    const outputZip = new JSZip();
    const fileNames = Object.keys(loadedZip.files);
    const total = fileNames.length;

    let index = 0;

    for (const name of fileNames) {
      index++;

      sendProgress(`Processing ${index} of ${total}: ${name}`);

      const fileData = await loadedZip.files[name].async("nodebuffer");

      // Placeholder for real processing
      const processed = fileData;

      outputZip.file(name, processed);

      await new Promise(r => setTimeout(r, 100));
    }

    sendProgress("DONE");

    const finalZip = await outputZip.generateAsync({ type: "nodebuffer" });

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=apt2u_processed.zip"
    });

    res.send(finalZip);

  } catch (err) {
    console.error("ZIP processing error:", err);
    sendProgress("ERROR");
    res.status(500).send("Server error while processing ZIP.");
  }
});

// ------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`apt2u ZIP server running on port ${PORT}`));
