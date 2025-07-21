import { exec } from 'child_process';
import { promisify } from 'util';

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
   * Get the best behave command for the current system
   * @returns Promise<string> The best behave command
   */
  public async getBestBehaveCommand(): Promise<string> {
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