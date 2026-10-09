import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

async function optimize() {
  const repoRoot = process.cwd();
  const imgPath = path.join(repoRoot, 'examples', 'express-prisma', 'public', 'assets', 'Gemini_Generated_Image_qrr6ubqrr6ubqrr6.png');
  if (!fs.existsSync(imgPath)) {
    console.error('[optimize-images] Image not found:', imgPath);
    process.exit(2);
  }

  const statBefore = fs.statSync(imgPath);
  console.log('[optimize-images] Before size:', (statBefore.size / 1024).toFixed(2), 'KB');

  const tmpOut = imgPath + '.opt.png';
  try {
    // lossless recompression via libpng settings
    await sharp(imgPath)
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(tmpOut);

    const statAfter = fs.statSync(tmpOut);
    console.log('[optimize-images] After size:', (statAfter.size / 1024).toFixed(2), 'KB');

    // Only replace if smaller
    if (statAfter.size < statBefore.size) {
      fs.renameSync(tmpOut, imgPath);
      console.log('[optimize-images] Replaced original with optimized image');
    } else {
      fs.unlinkSync(tmpOut);
      console.log('[optimize-images] Optimized output not smaller; original retained');
    }
    process.exit(0);
  } catch (err) {
    console.error('[optimize-images] Error:', err);
    if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    process.exit(1);
  }
}

optimize().catch((err) => {
  console.error('[optimize-images] Unhandled error:', err);
  process.exit(1);
});
