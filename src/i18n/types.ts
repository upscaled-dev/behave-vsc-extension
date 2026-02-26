/**
 * Core TypeScript interfaces for i18n support in Behave VSCode Extension
 */

/**
 * Gherkin keywords for a specific language
 */
export interface GherkinKeywords {
  feature: string[];
  scenario: string[];
  scenario_outline: string[];
  background: string[];
  examples: string[];
  given: string[];
  when: string[];
  then: string[];
  and: string[];
  but: string[];
  rule?: string[];
}

/**
 * Complete language information including metadata and keywords
 */
export interface LanguageInfo {
  code: string;
  name: string;
  native: string;
  keywords: GherkinKeywords;
}

/**
 * Language registry data structure (maps language code to language info)
 */
export interface LanguageRegistry {
  [languageCode: string]: LanguageInfo;
}

/**
 * Result of language detection
 */
export interface LanguageDetectionResult {
  languageCode: string;
  detectionMethod: 'explicit' | 'auto' | 'default';
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Raw language data structure from behave_i18n.py
 */
export interface RawLanguageData {
  name: string;
  native: string;
  feature: string[];
  scenario: string[];
  scenario_outline: string[];
  background: string[];
  examples: string[];
  given: string[];
  when: string[];
  then: string[];
  and: string[];
  but: string[];
  rule?: string[];
}

/**
 * Raw languages dictionary from behave_i18n.py
 */
export interface RawLanguagesData {
  [languageCode: string]: RawLanguageData;
}
