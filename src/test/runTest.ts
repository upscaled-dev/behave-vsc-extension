import * as path from "path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  try {
    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to the extension test script
    const extensionTestsPath = path.resolve(__dirname, "./suite/index.js");

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
    });
  } catch (err) {
     
    console.log("Failed to run tests:", err);
    process.exit(1);
  }
}

main().catch(console.error);
