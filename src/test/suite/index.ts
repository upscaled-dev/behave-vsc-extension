import * as path from "path";
import Mocha from "mocha";
import * as fs from "fs";

export async function run(): Promise<void> {
  console.log("Running test suite with ES module support...");

  // Create the mocha test with ES module support
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: 5000, // 5 second timeout
    bail: true,
  });

  const testsRoot = path.resolve(__dirname, "..");

  try {
    console.log("Loading test files...");

    // Load all test files
    const testFiles = [
      "simple.test.js",
      "parser.test.js",
      "extension.test.js",
      "execution.test.js",
      "integration.test.js",
    ];

    for (const testFile of testFiles) {
      const testPath = path.resolve(testsRoot, testFile);
      if (fs.existsSync(testPath)) {
        console.log(`Loading test file: ${testFile}`);
        mocha.addFile(testPath);
      } else {
        console.log(`Test file not found: ${testFile}`);
      }
    }

    // Load unit tests
    const unitTestsRoot = path.resolve(testsRoot, "unit");
    if (fs.existsSync(unitTestsRoot)) {
      const unitTestFiles = fs
        .readdirSync(unitTestsRoot)
        .filter((file) => file.endsWith(".test.js"))
        .map((file) => path.resolve(unitTestsRoot, file));

      for (const testFile of unitTestFiles) {
        console.log(`Loading unit test file: ${path.basename(testFile)}`);
        mocha.addFile(testFile);
      }
    }

    // Load integration tests
    const integrationTestsRoot = path.resolve(testsRoot, "integration");
    if (fs.existsSync(integrationTestsRoot)) {
      const integrationTestFiles = fs
        .readdirSync(integrationTestsRoot)
        .filter((file) => file.endsWith(".test.js"))
        .map((file) => path.resolve(integrationTestsRoot, file));

      for (const testFile of integrationTestFiles) {
        console.log(
          `Loading integration test file: ${path.basename(testFile)}`
        );
        mocha.addFile(testFile);
      }
    }

    console.log("Running Mocha...");
    // Run the mocha test with timeout
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        mocha.run((failures: number) => {
          console.log(`Mocha completed with ${failures} failures`);
          if (failures > 0) {
            reject(new Error(`${failures} tests failed.`));
          } else {
            resolve();
          }
        });
      }),
      new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Mocha test timed out after 10 seconds"));
        }, 10000);
      }),
    ]);

    console.log("Test suite completed successfully");
  } catch (err) {
    console.error("Test suite error:", err);
    return Promise.reject(err);
  }
}
