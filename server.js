const express = require("express");
const multer = require("multer");
const JSZip = require("jszip");
const cors = require("cors");
const path = require("path");

const app = express();

// Allow UI to connect
app.use(cors());

// Serve UI from /public
app.use(express.static("public"));

// Multer memory storage for batch uploads
const upload = multer({ storage: multer.memoryStorage() });

// ------------------------------
// SSE (Server‑Sent Events) Setup
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
// Batch Processor
// ------------------------------
app.post("/process", upload.array("files"), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).send("No files uploaded.");
    }

    const zip = new JSZip();
    const total = req.files.length;

    for (let i = 0; i < total; i++) {
      const file = req.files[i];

      // Send progress update to UI
      sendProgress(`Processing ${i + 1} of ${total}: ${file.originalname}`);

      // Placeholder for real processing logic
      const processedBuffer = file.buffer;

      zip.file(file.originalname, processedBuffer);

      // Simulate processing time
      await new Promise(r => setTimeout(r, 150));
    }

    sendProgress("DONE");

    const zipData = await zip.generateAsync({ type: "nodebuffer" });

    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=apt2u_processed.zip"
    });

    res.send(zipData);

  } catch (err) {
    console.error("Processing error:", err);
    sendProgress("ERROR");
    res.status(500).send("Server error while processing files.");
  }
});

// ------------------------------
// Start Server
// ------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`apt2u server running on port ${PORT}`));
