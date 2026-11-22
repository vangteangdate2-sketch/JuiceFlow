const MAX_WIDTH = 640;
const MAX_HEIGHT = 480;
const MAX_DATA_URL_LENGTH = 180000; // Safely within 200,000 char Firestore rule & localStorage budget

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image file.'));
    };
    img.src = url;
  });
}

export async function compressImageBlobToDataUrl(blob: Blob): Promise<string> {
  if (!blob.type.startsWith('image/') && blob.type !== '') {
    throw new Error('Selected file is not a valid image.');
  }

  const img = await loadImageFromBlob(blob);
  const scale = Math.min(1, MAX_WIDTH / img.naturalWidth, MAX_HEIGHT / img.naturalHeight);
  const targetW = Math.max(1, Math.round(img.naturalWidth * scale));
  const targetH = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context unavailable.');
  }

  // Neutral stone background in case source PNG has transparency
  ctx.fillStyle = '#F5F5F4';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);

  let quality = 0.82;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);

  while (dataUrl.length > MAX_DATA_URL_LENGTH && quality > 0.35) {
    quality -= 0.12;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }

  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    // Downscale slightly more if still oversized
    const smallerCanvas = document.createElement('canvas');
    smallerCanvas.width = Math.round(targetW * 0.7);
    smallerCanvas.height = Math.round(targetH * 0.7);
    const sCtx = smallerCanvas.getContext('2d');
    if (sCtx) {
      sCtx.fillStyle = '#F5F5F4';
      sCtx.fillRect(0, 0, smallerCanvas.width, smallerCanvas.height);
      sCtx.drawImage(canvas, 0, 0, smallerCanvas.width, smallerCanvas.height);
      dataUrl = smallerCanvas.toDataURL('image/jpeg', 0.65);
    }
  }

  return dataUrl;
}
