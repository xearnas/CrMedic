// Aides navigateur pour les justificatifs et la photo de profil (non testées en Node).

/** Réduit une image à `maxSide` px et la renvoie en data URL JPEG. */
export function downscaleImage(file, maxSide = 900, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * ratio));
      canvas.height = Math.max(1, Math.round(img.height * ratio));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible.'));
    };
    img.src = url;
  });
}

export function readText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    r.readAsText(file);
  });
}

export function downloadText(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' o';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' Ko';
  return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' Mo';
}
