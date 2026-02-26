/**
 * Language Detector - Detects Gherkin language from feature file content
 * 
 * Detection strategy:
 * 1. Check for explicit `# language: xx` header comment (highest priority)
 * 2. Auto-detect by matching first Gherkin keyword against registry
 * 3. Fall back to default language (English)
 */

import { getLanguageRegistry } from './language-registry';
import { LanguageDetectionResult } from './types';

/**
 * Regular expression to match language header comment
 * Matches: # language: ru, #language:ru, # language: en, etc.
 */
const LANGUAGE_HEADER_REGEX = /^\s*#\s*language\s*:\s*([a-zA-Z-]+)/i;

/**
 * Maximum number of lines to scan for language detection
 */
const MAX_SCAN_LINES = 10;

/**
 * Default language code when detection fails
 */
const DEFAULT_LANGUAGE = 'en';

/**
 * Language Detector class
 */
export class LanguageDetector {
  private registry = getLanguageRegistry();

  /**
   * Detect language from feature file content
   * 
   * @param content - Full content of the feature file
   * @returns Language detection result with code, method, and confidence
   */
  public detectLanguage(content: string): LanguageDetectionResult {
    if (!content || content.trim().length === 0) {
      return this.createResult(DEFAULT_LANGUAGE, 'default', 'low');
    }

    const lines = content.split(/\r?\n/);

    // Step 1: Check for explicit language header
    const explicitLanguage = this.detectExplicitLanguage(lines);
    if (explicitLanguage) {
      return explicitLanguage;
    }

    // Step 2: Auto-detect by keyword matching
    const autoDetectedLanguage = this.autoDetectLanguage(lines);
    if (autoDetectedLanguage) {
      return autoDetectedLanguage;
    }

    // Step 3: Fall back to default
    return this.createResult(DEFAULT_LANGUAGE, 'default', 'low');
  }

  /**
   * Detect language from explicit header comment
   * 
   * @param lines - Array of file lines
   * @returns Detection result if found, undefined otherwise
   */
  private detectExplicitLanguage(lines: string[]): LanguageDetectionResult | undefined {
    const scanLines = Math.min(lines.length, MAX_SCAN_LINES);

    for (let i = 0; i < scanLines; i++) {
      const line = lines[i];
      if (!line) {
        continue;
      }
      
      const match = LANGUAGE_HEADER_REGEX.exec(line);

      if (match?.[1]) {
        const languageCode = match[1].toLowerCase();

        // Validate that the language code exists in registry
        if (this.registry.isValidLanguageCode(languageCode)) {
          return this.createResult(languageCode, 'explicit', 'high');
        }
      }
    }

    return undefined;
  }

  /**
   * Auto-detect language by matching first Gherkin keyword
   * 
   * @param lines - Array of file lines
   * @returns Detection result if found, undefined otherwise
   */
  private autoDetectLanguage(lines: string[]): LanguageDetectionResult | undefined {
    const scanLines = Math.min(lines.length, MAX_SCAN_LINES);

    for (let i = 0; i < scanLines; i++) {
      const line = lines[i];
      if (!line) {
        continue;
      }
      
      const trimmedLine = line.trim();

      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }

      // Extract first word (potential keyword)
      const firstWord = this.extractFirstWord(trimmedLine);
      if (!firstWord) {
        continue;
      }

      // Try to find languages that have this keyword
      const matchedLanguages = this.registry.findLanguagesByKeyword(firstWord);

      if (matchedLanguages.length === 1) {
        const languageCode = matchedLanguages[0];
        if (languageCode) {
          // Unique match - high confidence
          return this.createResult(languageCode, 'auto', 'high');
        }
      } else if (matchedLanguages.length > 1) {
        // Multiple matches - prefer English if present, otherwise take first
        const preferredLanguage = matchedLanguages.includes('en') 
          ? 'en' 
          : matchedLanguages[0];
        if (preferredLanguage) {
          return this.createResult(preferredLanguage, 'auto', 'medium');
        }
      }
    }

    return undefined;
  }

  /**
   * Extract first word from a line (potential Gherkin keyword)
   * 
   * @param line - Line to extract word from
   * @returns First word or undefined if not found
   */
  private extractFirstWord(line: string): string | undefined {
    // Match word characters, including Unicode (for non-Latin scripts)
    // Also include special characters like emoji
    const match = line.match(/^([\p{L}\p{M}\p{Emoji}]+)/u);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
    return undefined;
  }

  /**
   * Create a language detection result
   * 
   * @param languageCode - Detected language code
   * @param method - Detection method used
   * @param confidence - Confidence level
   * @returns Language detection result
   */
  private createResult(
    languageCode: string,
    method: 'explicit' | 'auto' | 'default',
    confidence: 'high' | 'medium' | 'low'
  ): LanguageDetectionResult {
    return {
      languageCode,
      detectionMethod: method,
      confidence
    };
  }

  /**
   * Detect language from file path
   * Convenience method that reads file content and detects language
   * 
   * @param filePath - Path to feature file
   * @returns Language detection result
   */
  public async detectLanguageFromFile(filePath: string): Promise<LanguageDetectionResult> {
    try {
      const fs = await import('fs');
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.detectLanguage(content);
    } catch {
      return this.createResult(DEFAULT_LANGUAGE, 'default', 'low');
    }
  }
}

/**
 * Singleton instance of language detector
 */
let detectorInstance: LanguageDetector | undefined;

/**
 * Get singleton instance of language detector
 * 
 * @returns Language detector instance
 */
export function getLanguageDetector(): LanguageDetector {
  detectorInstance ??= new LanguageDetector();
  return detectorInstance;
}

/**
 * Convenience function to detect language from content
 * 
 * @param content - Feature file content
 * @returns Language detection result
 */
export function detectLanguage(content: string): LanguageDetectionResult {
  return getLanguageDetector().detectLanguage(content);
}

/**
 * Convenience function to detect language from file
 * 
 * @param filePath - Path to feature file
 * @returns Language detection result
 */
export async function detectLanguageFromFile(filePath: string): Promise<LanguageDetectionResult> {
  return getLanguageDetector().detectLanguageFromFile(filePath);
}
