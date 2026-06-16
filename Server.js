const express = require("express");
const multer = require("multer");
const JSZip = require("jszip");
const path = require("path");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.get("/", (req, res) => {
  res.send(`
    <h2>apt2u File Processor</h2>
    <form action="/process" method="post" enctype="multipart/form-data">
      <input type="file" name="files" multiple />
      <button type="submit">Upload</button>
    </form>
  `);
});

app.post("/process", upload.array("files"), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send("No files uploaded.");
  }

  const zip = new JSZip();

  req.files.forEach((file) => {
    zip.file(file.originalname, file.buffer);
  });

  const zipData = await zip.generateAsync({ type: "nodebuffer" });

  res.set({
    "Content-Type": "application/zip",
    "Content-Disposition": "attachment; filename=processed.zip",
  });

  res.send(zipData);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
