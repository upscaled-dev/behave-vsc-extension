/**
 * Localization Service - Centralized service for getting localized UI strings
 * 
 * Singleton pattern for efficient memory usage.
 * Manages UI text catalog (English reference, extended with Russian and other languages)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Type definition for locale catalog structure
 */
type LocaleCatalog = Record<string, unknown>;

/**
 * Supported locales
 */
export type SupportedLocale = 'en' | 'ru';

/**
 * Default locale when detection fails
 */
const DEFAULT_LOCALE: SupportedLocale = 'en';

/**
 * Localization Service class
 */
export class LocalizationService {
  private static instance: LocalizationService;
  private currentLocale: SupportedLocale;
  private catalogs: Map<SupportedLocale, LocaleCatalog>;
  private fallbackCatalog: LocaleCatalog;

  private constructor() {
    this.catalogs = new Map();
    this.currentLocale = DEFAULT_LOCALE;
    this.fallbackCatalog = {};
    this.initialize();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): LocalizationService {
    if (!LocalizationService.instance) {
      LocalizationService.instance = new LocalizationService();
    }
    return LocalizationService.instance;
  }

  /**
   * Initialize the service by loading catalogs and detecting locale
   */
  private initialize(): void {
    this.detectLocale();
    this.loadCatalogs();
  }

  /**
   * Detect current locale from VSCode settings
   */
  private detectLocale(): void {
    try {
      const vscodeLocale = vscode?.env?.language;
      if (vscodeLocale) {
        if (vscodeLocale.startsWith('ru')) {
          this.currentLocale = 'ru';
        } else {
          this.currentLocale = 'en';
        }
      } else {
        this.currentLocale = DEFAULT_LOCALE;
      }
    } catch {
      this.currentLocale = DEFAULT_LOCALE;
    }
  }

  /**
   * Load all locale catalogs from JSON files
   */
  private loadCatalogs(): void {
    const locales: SupportedLocale[] = ['en', 'ru'];
    
    for (const locale of locales) {
      const catalog = this.loadCatalog(locale);
      this.catalogs.set(locale, catalog);
      
      if (locale === 'en') {
        this.fallbackCatalog = catalog;
      }
    }
  }

  /**
   * Load a specific locale catalog from JSON file
   */
  private loadCatalog(locale: SupportedLocale): LocaleCatalog {
    const catalogPath = path.join(__dirname, 'locales', `${locale}.json`);
    
    try {
      const content = fs.readFileSync(catalogPath, 'utf-8');
      return JSON.parse(content) as LocaleCatalog;
    } catch {
      return {};
    }
  }

  /**
   * Get localized text by key path
   * 
   * @param keyPath - Dot-separated path to the text (e.g., 'codelens.runScenario')
   * @param params - Optional parameters for string interpolation
   * @returns Localized text or key path if not found
   * 
   * @example
   * getText('codelens.runScenario') // Returns "▶️ Run Scenario" or "▶️ Запустить сценарий"
   * getText('errors.fileNotFound', { path: '/some/file.feature' }) // Returns "File not found: /some/file.feature"
   */
  public getText(keyPath: string, params?: Record<string, string>): string {
    const catalog = this.catalogs.get(this.currentLocale) ?? this.fallbackCatalog;
    
    let text = this.getNestedValue(catalog, keyPath);
    
    text ??= this.getNestedValue(this.fallbackCatalog, keyPath);
    
    if (!text) {
      return keyPath;
    }
    
    return this.interpolate(text, params);
  }

  /**
   * Get nested value from object by dot-separated path
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
    const keys = path.split('.');
    let current: unknown = obj;
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
    
    return typeof current === 'string' ? current : undefined;
  }

  /**
   * Interpolate parameters into text
   * Replaces {paramName} with actual values
   */
  private interpolate(text: string, params?: Record<string, string>): string {
    if (!params) {
      return text;
    }
    
    return text.replace(/\{(\w+)\}/g, (match, key) => {
      return params[key] ?? match;
    });
  }

  /**
   * Get current locale
   */
  public getCurrentLocale(): SupportedLocale {
    return this.currentLocale;
  }

  /**
   * Set current locale
   * 
   * @param locale - Locale to set
   */
  public setLocale(locale: SupportedLocale): void {
    if (this.catalogs.has(locale)) {
      this.currentLocale = locale;
    }
  }

  /**
   * Get all supported locales
   */
  public getSupportedLocales(): SupportedLocale[] {
    return Array.from(this.catalogs.keys());
  }

  /**
   * Check if a locale is supported
   */
  public isLocaleSupported(locale: string): boolean {
    return this.catalogs.has(locale as SupportedLocale);
  }

  /**
   * Reload catalogs (useful for development/testing)
   */
  public reloadCatalogs(): void {
    this.catalogs.clear();
    this.loadCatalogs();
  }
}

/**
 * Get singleton instance of localization service
 */
export function getLocalizationService(): LocalizationService {
  return LocalizationService.getInstance();
}

/**
 * Convenience function to get localized text
 * 
 * @param keyPath - Dot-separated path to the text
 * @param params - Optional parameters for string interpolation
 * @returns Localized text
 */
export function t(keyPath: string, params?: Record<string, string>): string {
  return getLocalizationService().getText(keyPath, params);
}
