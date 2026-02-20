// scripts/afterPack.cjs
// Ad-hoc codesign macOS app in CI (no Apple Developer certificate needed)
// This prevents the "app is damaged" error on macOS Gatekeeper

const { execSync } = require("child_process");

exports.default = async function (context) {
  if (context.electronPlatformName !== "darwin") return;

  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  console.log(`  Ad-hoc signing: ${appPath}`);
  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" });
    console.log("  Ad-hoc signing complete");
  } catch (e) {
    console.warn(`  Warning: ad-hoc signing failed: ${e.message}`);
  }
};
