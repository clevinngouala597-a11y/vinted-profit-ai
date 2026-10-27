/** Taille maximale d'une photo importée (avant compression). */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_SIDE = 1400;
const QUALITY = 0.82;

/**
 * Compresse une image en JPEG (côté le plus long : 1400 px, qualité 82 %).
 * Une photo d'iPhone de 3–5 Mo passe ainsi autour de 200–400 Ko sans perte visible sur mobile.
 */
export async function compressImage(file: Blob): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) throw new Error('Photo trop lourde (25 Mo maximum).');
  if (!file.type.startsWith('image/')) throw new Error("Ce fichier n'est pas une image.");
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    bitmap = await new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("Impossible de lire cette image (format non pris en charge)."));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = 'naturalWidth' in bitmap ? bitmap.naturalWidth : bitmap.width;
  const h = 'naturalHeight' in bitmap ? bitmap.naturalHeight : bitmap.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('La compression de la photo a échoué.');
  return blob.size < file.size ? blob : file;
}
