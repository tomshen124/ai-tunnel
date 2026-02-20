// app/assets/generate-icons.mjs
// Generate PNG and ICNS icons from SVG for electron-builder
import sharp from "sharp";
import { readFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(__dirname, "icon.svg");
const svgBuffer = readFileSync(svgPath);

const sizes = [16, 32, 64, 128, 256, 512, 1024];

async function main() {
  console.log("Generating icons from SVG...");

  // Generate PNGs at all sizes
  for (const size of sizes) {
    const outPath = resolve(__dirname, `icon-${size}.png`);
    await sharp(svgBuffer).resize(size, size).png().toFile(outPath);
    console.log(`  ${size}x${size} → ${outPath}`);
  }

  // Main icon.png (512x512, used by electron-builder for Linux)
  const mainPng = resolve(__dirname, "icon.png");
  await sharp(svgBuffer).resize(512, 512).png().toFile(mainPng);
  console.log(`  icon.png (512x512) → ${mainPng}`);

  // Generate .ico for Windows (256x256 PNG, electron-builder converts)
  const icoSource = resolve(__dirname, "icon-256.png");
  console.log(`  icon-256.png ready for Windows .ico generation`);

  // Generate .icns for macOS using sips + iconutil (macOS only)
  if (process.platform === "darwin") {
    try {
      const iconsetDir = resolve(__dirname, "icon.iconset");
      mkdirSync(iconsetDir, { recursive: true });

      const icnsMap = [
        [16, "icon_16x16.png"],
        [32, "icon_16x16@2x.png"],
        [32, "icon_32x32.png"],
        [64, "icon_32x32@2x.png"],
        [128, "icon_128x128.png"],
        [256, "icon_128x128@2x.png"],
        [256, "icon_256x256.png"],
        [512, "icon_256x256@2x.png"],
        [512, "icon_512x512.png"],
        [1024, "icon_512x512@2x.png"],
      ];

      for (const [size, name] of icnsMap) {
        const src = resolve(__dirname, `icon-${size}.png`);
        const dest = resolve(iconsetDir, name);
        await sharp(readFileSync(src)).png().toFile(dest);
      }

      const icnsPath = resolve(__dirname, "icon.icns");
      execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`);
      console.log(`  icon.icns → ${icnsPath}`);

      // Cleanup iconset
      execSync(`rm -rf "${iconsetDir}"`);
    } catch (e) {
      console.warn(`  Warning: Could not generate .icns: ${e.message}`);
    }
  }

  console.log("Done!");
}

main().catch(console.error);
