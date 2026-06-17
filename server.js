<script>
  const consoleBox = document.getElementById("console");
  const uploadStatus = document.getElementById("uploadStatus");
  const processStatus = document.getElementById("processStatus");

  function log(msg) {
    consoleBox.innerHTML += msg + "<br>";
    consoleBox.scrollTop = consoleBox.scrollHeight;
  }

  // SSE for server processing progress
  const evtSource = new EventSource("/progress");
  evtSource.onmessage = (e) => {
    const msg = e.data;
    log(msg);

    if (msg.startsWith("Processing")) {
      // Format: "Processing X of Y :: filename"
      const parts = msg.split(" :: ");
      const progressPart = parts[0];
      const fileName = parts[1] || "Unknown";

      const nums = progressPart.split(" ");
      const current = parseInt(nums[1]);
      const total = parseInt(nums[3]);
      const percent = (current / total) * 100;

      // ⭐ Clean, correct, no weird line breaks
      processStatus.innerHTML =
        `Processing: ${current} of ${total} (${percent.toFixed(1)}%)<br>` +
        `Current file: ${fileName}`;
    }

    if (msg === "DONE") {
      processStatus.textContent = "Processing complete!";
    }
  };

  // Upload handler with progress
  document.getElementById("uploadForm").onsubmit = async (e) => {
    e.preventDefault();

    const file = document.getElementById("zipfile").files[0];
    if (!file) {
      log("Please select a ZIP file.");
      return;
    }

    const formData = new FormData();
    formData.append("zipfile", file);

    log("Uploading ZIP…");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/process", true);
    xhr.responseType = "blob";

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = (event.loaded / event.total) * 100;
        uploadStatus.textContent = `Uploading ZIP: ${percent.toFixed(1)}%`;
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        uploadStatus.textContent = "Upload complete!";
        log("Download ready.");
        const blob = xhr.response;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "apt2u_processed.zip";
        a.click();
      } else {
        log("Error processing ZIP.");
      }
    };

    xhr.send(formData);
  };
</script>
