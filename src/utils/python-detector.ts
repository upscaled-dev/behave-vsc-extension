import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(exec);

export class PythonDetector {
  private static instance: PythonDetector;
  private cachedCommand: string | null = null;

  private constructor() {}

  public static getInstance(): PythonDetector {
    if (!PythonDetector.instance) {
      PythonDetector.instance = new PythonDetector();
    }
    return PythonDetector.instance;
  }

  /**
   * Detect the best Python command for running behave
   * @returns Promise<string> The detected Python command
   */
  public async detectPythonCommand(): Promise<string> {
    if (this.cachedCommand) {
      return this.cachedCommand;
    }

    const commands = [
      'python3',
      'python',
      'py'
    ];

    for (const command of commands) {
      try {
        const { stdout } = await execAsync(`${command} --version`);
        if (stdout.includes('Python')) {
          this.cachedCommand = command;
          return command;
        }
      } catch {
        // Command not found, try next one
        continue;
      }
    }

    // Fallback to python3 if nothing else works
    this.cachedCommand = 'python3';
    return 'python3';
  }

  /**
   * Get the behave command with proper Python prefix
   * @returns Promise<string> The behave command (e.g., 'python3 -m behave')
   */
  public async getBehaveCommand(): Promise<string> {
    const pythonCommand = await this.detectPythonCommand();
    return `${pythonCommand} -m behave`;
  }

  /**
   * Test if behave is available with the given command
   * @param command The command to test
   * @returns Promise<boolean> True if behave is available
   */
  public async testBehaveCommand(command: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`${command} --version`);
      return stdout.includes('behave');
    } catch {
      return false;
    }
  }

  /**
   * Detect if a virtual environment is active by running a Python command
   * Returns the path to the venv Python if found, else null
   */
  public async detectVenvPython(): Promise<string | null> {
    try {
      // This command prints the path to the Python executable if in a venv, else empty
      const { stdout } = await execAsync("python3 -c 'import sys; print(getattr(sys, \"real_prefix\", getattr(sys, \"base_prefix\", None)) != sys.prefix and sys.executable or \"\")'");
      const pythonPath = stdout.trim();
      if (pythonPath && fs.existsSync(pythonPath)) {
        return pythonPath;
      }
    } catch {}
    try {
      const { stdout } = await execAsync("python -c 'import sys; print(getattr(sys, \"real_prefix\", getattr(sys, \"base_prefix\", None)) != sys.prefix and sys.executable or \"\")'");
      const pythonPath = stdout.trim();
      if (pythonPath && fs.existsSync(pythonPath)) {
        return pythonPath;
      }
    } catch {}
    return null;
  }

  /**
   * Get the best behave command, preferring venv Python if found
   */
  public async getBestBehaveCommand(): Promise<string> {
    // Prefer venv Python if available
    const venvPython = await this.detectVenvPython();
    if (venvPython) {
      return `${venvPython} -m behave`;
    }
    // First try the direct 'behave' command
    if (await this.testBehaveCommand('behave')) {
      return 'behave';
    }

    // Then try with Python module
    const pythonCommand = await this.detectPythonCommand();
    const moduleCommand = `${pythonCommand} -m behave`;
    
    if (await this.testBehaveCommand(moduleCommand)) {
      return moduleCommand;
    }

    // Fallback to the module command even if test fails
    return moduleCommand;
  }

  /**
   * Clear the cached command (useful for testing)
   */
  public clearCache(): void {
    this.cachedCommand = null;
  }
} 