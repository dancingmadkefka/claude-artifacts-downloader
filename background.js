// background.js
importScripts("jszip.min.js");

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "downloadArtifacts") {
    // Get artifacts from storage based on conversation UUID
    chrome.storage.local.get([`artifacts_${request.uuid}`], (artifactsResult) => {
      const artifacts = artifactsResult[`artifacts_${request.uuid}`];
      
      if (artifacts && artifacts.length > 0) {
        console.log("Found artifacts:", artifacts.length);
        const zip = new JSZip();
        let artifactCount = 0;
        
        // Add each artifact to the ZIP file
        artifacts.forEach((artifact) => {
          const fileName = artifact.file_name;
          const content = artifact.content;
          
          zip.file(fileName, content);
          artifactCount++;
          console.log(`Added artifact: ${fileName}`);
        });
        
        // Generate the ZIP and offer download
        zip.generateAsync({ type: "blob" }).then((content) => {
          const reader = new FileReader();
          reader.onload = function (e) {
            const arrayBuffer = e.target.result;
            chrome.downloads.download(
              {
                url: "data:application/zip;base64," + arrayBufferToBase64(arrayBuffer),
                filename: `Claude_Artifacts_${request.uuid}.zip`,
                saveAs: true,
              },
              (downloadId) => {
                if (chrome.runtime.lastError) {
                  console.error(chrome.runtime.lastError);
                  chrome.tabs.sendMessage(sender.tab.id, {
                    action: "artifactsProcessed",
                    failure: true,
                    message: "Error downloading artifacts.",
                  });
                } else {
                  chrome.tabs.sendMessage(sender.tab.id, {
                    action: "artifactsProcessed",
                    success: true,
                    message: `${artifactCount} artifacts downloaded successfully.`,
                  });
                }
              }
            );
          };
          reader.readAsArrayBuffer(content);
        });
      } else {
        // No artifacts found
        chrome.tabs.sendMessage(sender.tab.id, {
          action: "artifactsProcessed",
          message: "No artifacts found for this conversation.",
        });
      }
    });
    return true; // Keep the message channel open for async response
  }
});

// Convert ArrayBuffer to Base64 for download URL
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Monitor tab updates to add the download button
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.url && changeInfo.url.startsWith("https://claude.ai/chat/")) {
    chrome.tabs.sendMessage(tabId, { action: "checkAndAddDownloadButton" });
  }
});

// Listen for artifact data from the docs endpoint
chrome.webRequest.onBeforeSendHeaders.addListener(
  (obj) => {
    if (!isOwnRequest(obj)) {
      fetchDocs(obj).then((resp) => {
        if (resp && Array.isArray(resp)) {
          // Get the conversation ID from the current tab
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs && tabs.length > 0) {
              const url = tabs[0].url;
              const match = url.match(/\/chat\/([a-f0-9-]+)/);
              if (match && match[1]) {
                const conversationUuid = match[1];
                console.log("Storing artifacts for conversation:", conversationUuid);
                chrome.storage.local.set({ 
                  [`artifacts_${conversationUuid}`]: resp 
                });
              }
            }
          });
        }
      });
    }
  },
  { urls: ["https://claude.ai/api/organizations/*/projects/*/docs"] },
  ["requestHeaders", "extraHeaders"],
);

// Check if a request is our own to prevent infinite loops
function isOwnRequest(obj) {
  return (
    obj.requestHeaders?.some((header) => header.name === "X-Own-Request") ??
    false
  );
}

// Fetch artifact data from the docs endpoint
async function fetchDocs(obj) {
  const headers = {};
  obj.requestHeaders.forEach((header) => (headers[header.name] = header.value));
  headers["X-Own-Request"] = "true";
  
  try {
    console.log("Fetching docs:", obj.url);
    const response = await fetch(obj.url, {
      method: obj.method,
      headers: headers,
      credentials: "include",
    });
    
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    console.log("Docs data:", data);
    return data;
  } catch (error) {
    console.error("Fetch docs error:", error);
    return null;
  }
}