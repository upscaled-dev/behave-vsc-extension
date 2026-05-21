import { CommandBuilder } from "./command-builders/command-builder-interface";
import { BehaveCommandBuilder } from "./command-builders/behave-command-builder";
import { PytestBddCommandBuilder } from "./command-builders/pytest-bdd-command-builder";
import { ExtensionConfig } from "./extension-config";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Framework Factory (Adapter Factory)
 * 
 * This factory class creates the appropriate CommandBuilder based on the framework type.
 * It implements the Factory Pattern to encapsulate the creation logic and provides
 * automatic framework detection based on project configuration files.
 */
export class FrameworkFactory {
  /**
   * Create a CommandBuilder instance for the specified framework
   * @param framework - Framework name ("behave", "pytest-bdd")
   * @param config - Extension configuration
   * @returns CommandBuilder instance for the framework
   */
  public static createCommandBuilder(framework: string, config: ExtensionConfig): CommandBuilder {
    switch (framework.toLowerCase()) {
      case "behave":
        return new BehaveCommandBuilder(config);
      case "pytest-bdd":
        return new PytestBddCommandBuilder(config);
      default:
        throw new Error(`Unsupported framework: ${framework}`);
    }
  }

  /**
   * Automatically detect the BDD framework based on project configuration files
   * @param workspacePath - Path to the workspace root
   * @returns Promise resolving to the detected framework name
   */
  public static async autoDetect(workspacePath?: string): Promise<string> {
    const wsPath = workspacePath ?? this.getWorkspacePath();
    
    if (!wsPath) {
      // Default to behave if no workspace
      return "behave";
    }

    try {
      const hasBehaveConfig = this.hasBehaveConfig(wsPath);
      const hasPytestBddConfig = this.hasPytestBddConfig(wsPath);
      
      // Check for explicit configuration conflicts
      if (hasBehaveConfig && hasPytestBddConfig) {
        const message = "⚠️ Both behave and pytest-bdd configurations detected! Using behave by default. " +
                       "Please remove one framework's configuration files or set 'behaveTestRunner.framework' manually.";
        vscode.window.showWarningMessage(message);
        return "behave"; // Prefer behave for backward compatibility
      }

      // Clear framework preference based on explicit configuration
      if (hasBehaveConfig) {
        return "behave";
      }

      if (hasPytestBddConfig) {
        return "pytest-bdd";
      }

      // If no explicit config, check file patterns (but warn about ambiguity)
      const hasFeatureFiles = await this.hasFeatureFiles(wsPath);
      const hasPytestFiles = await this.hasPytestTestFiles(wsPath);
      
      if (hasFeatureFiles && hasPytestFiles) {
        const message = "📁 Both .feature files and pytest test files found. " +
                       "Defaulting to behave. Please add framework configuration files or set 'behaveTestRunner.framework' manually for explicit selection.";
        vscode.window.showInformationMessage(message);
        
        // Always default to behave for backward compatibility
        return "behave";
      }

      // Default to behave for backward compatibility
      return "behave";
    } catch {
      // If detection fails, default to behave
      return "behave";
    }
  }

  /**
   * Validate that the workspace has a clean, single framework setup
   * @param workspacePath - Path to the workspace root
   * @returns Validation result with detected issues
   */
  public static async validateFrameworkSetup(workspacePath?: string): Promise<{
    isValid: boolean;
    detectedFrameworks: string[];
    issues: string[];
    recommendation: string;
  }> {
    const wsPath = workspacePath ?? this.getWorkspacePath();
    const issues: string[] = [];
    const detectedFrameworks: string[] = [];
    
    if (!wsPath) {
      return {
        isValid: true,
        detectedFrameworks: ["behave"], // default
        issues: [],
        recommendation: "Using behave as default (no workspace detected)"
      };
    }

    try {
      // Check for configuration files
      if (this.hasBehaveConfig(wsPath)) {
        detectedFrameworks.push("behave");
      }
      
      if (this.hasPytestBddConfig(wsPath)) {
        detectedFrameworks.push("pytest-bdd");
      }

      // Check for multiple framework configurations
      if (detectedFrameworks.length > 1) {
        issues.push("Multiple BDD framework configurations detected");
        issues.push("This may cause conflicts in test discovery and execution");
        return {
          isValid: false,
          detectedFrameworks,
          issues,
          recommendation: "Remove configuration files for unused framework or use manual framework selection"
        };
      }

      // Check file patterns
      const hasFeatureFiles = await this.hasFeatureFiles(wsPath);
      const hasPytestFiles = await this.hasPytestTestFiles(wsPath);
      
             if (detectedFrameworks.length === 0 && hasFeatureFiles && hasPytestFiles) {
         issues.push("Both .feature files and pytest test files found without explicit framework configuration - defaulting to behave");
         return {
           isValid: true, // This is now valid since we have a clear default
           detectedFrameworks: ["behave"], // Default to behave
           issues,
           recommendation: "Add framework configuration files (behave.ini or pytest.ini) for explicit framework selection"
         };
       }

      return {
        isValid: true,
        detectedFrameworks: detectedFrameworks.length > 0 ? detectedFrameworks : ["behave"],
        issues: [],
        recommendation: "Framework setup is clean"
      };
    } catch (error) {
      return {
        isValid: false,
        detectedFrameworks: [],
        issues: [`Framework validation failed: ${error}`],
        recommendation: "Check workspace permissions and framework configuration files"
      };
    }
  }

  /**
   * Check if the workspace has behave configuration files
   */
  private static hasBehaveConfig(workspacePath: string): boolean {
    const behaveConfigFiles = [
      "behave.ini",
      ".behaverc", 
      "setup.cfg",
      "pyproject.toml"
    ];

    for (const configFile of behaveConfigFiles) {
      const configPath = path.join(workspacePath, configFile);
      if (fs.existsSync(configPath)) {
        // For setup.cfg and pyproject.toml, check if they contain behave configuration
        if (configFile === "setup.cfg" || configFile === "pyproject.toml") {
          try {
            const content = fs.readFileSync(configPath, "utf8");
            if (content.includes("[behave") || content.includes("behave")) {
              return true;
            }
          } catch {
            // If we can't read the file, assume it's not a behave config
            continue;
          }
        } else {
          // For behave.ini and .behaverc, existence is enough
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if the workspace has pytest-bdd configuration files
   */
  private static hasPytestBddConfig(workspacePath: string): boolean {
    const pytestConfigFiles = [
      "pytest.ini",
      "pyproject.toml",
      "setup.cfg",
      "tox.ini"
    ];

    for (const configFile of pytestConfigFiles) {
      const configPath = path.join(workspacePath, configFile);
      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, "utf8");
          // Look for pytest-bdd in the configuration
          if (content.includes("pytest-bdd") || content.includes("pytest_bdd")) {
            return true;
          }
        } catch {
          // If we can't read the file, continue to next
          continue;
        }
      }
    }

    return false;
  }

  

  /**
   * Check if the workspace has .feature files
   */
  private static async hasFeatureFiles(workspacePath: string): Promise<boolean> {
    try {
      const featureFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspacePath, "**/*.feature"),
        null,
        1 // Just check if any exist
      );
      return featureFiles.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Check if the workspace has pytest-style test files
   */
  private static async hasPytestTestFiles(workspacePath: string): Promise<boolean> {
    try {
      const testFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspacePath, "**/test_*.py"),
        null,
        1 // Just check if any exist
      );
      return testFiles.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get the current workspace path
   */
  private static getWorkspacePath(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    return workspaceFolders?.[0]?.uri.fsPath;
  }

  /**
   * Get all supported frameworks
   */
  public static getSupportedFrameworks(): string[] {
    return ["behave", "pytest-bdd"];
  }

  /**
   * Check if a framework is supported
   */
  public static isFrameworkSupported(framework: string): boolean {
    return this.getSupportedFrameworks().includes(framework.toLowerCase());
  }
} 