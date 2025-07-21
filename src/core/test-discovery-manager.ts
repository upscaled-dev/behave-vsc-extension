import * as vscode from "vscode";
import { Logger } from "../utils/logger";
import { ExtensionConfig } from "./extension-config";
import { CacheEntry, DiscoveryOptions } from "../types";

export class TestDiscoveryManager {
  private static instance: TestDiscoveryManager | undefined;
  private cache = new Map<string, CacheEntry<string[]>>();
  private readonly DEFAULT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_CACHE_SIZE = 100; // Maximum number of cache entries
  private logger: Logger;
  private config: ExtensionConfig;

  private constructor() {
    this.logger = Logger.getInstance();
    this.config = ExtensionConfig.getInstance();
  }

  public static getInstance(): TestDiscoveryManager {
    TestDiscoveryManager.instance ??= new TestDiscoveryManager();
    return TestDiscoveryManager.instance;
  }

  /**
   * Discover test files with intelligent caching
   */
  public async discoverTestFiles(
    options: DiscoveryOptions = {}
  ): Promise<string[]> {
    const {
      pattern = this.config.testFilePattern,
      maxCacheAge = this.DEFAULT_CACHE_TTL,
      forceRefresh = false,
    } = options;

    const cacheKey = `discovery:${pattern}`;

    try {
      // Check cache first (unless force refresh is requested)
      if (!forceRefresh) {
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < maxCacheAge) {
          this.logger.debug("Using cached test discovery results", {
            pattern,
            fileCount: cached.data.length,
            cacheAge: Date.now() - cached.timestamp,
          });
          return cached.data;
        }
      }

      this.logger.info("Discovering test files", { pattern, forceRefresh });

      // Perform file discovery
      const files = await this.discoverFiles(pattern);

      // Cache the results
      this.cache.set(cacheKey, {
        timestamp: Date.now(),
        data: files,
      });

      // Cleanup old cache entries if we exceed max size
      this.cleanupCache();

      this.logger.info("Test discovery completed", {
        pattern,
        fileCount: files.length,
      });

      return files;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to discover test files", {
        pattern,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Discover files using VS Code workspace API
   */
  private async discoverFiles(pattern: string): Promise<string[]> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        this.logger.warn("No workspace folders found for test discovery");
        return [];
      }

      const files: string[] = [];

      for (const folder of workspaceFolders) {
        const relativePattern = new vscode.RelativePattern(folder, pattern);
        const foundFiles = await vscode.workspace.findFiles(
          relativePattern,
          "**/node_modules/**"
        );

        files.push(...foundFiles.map((file) => file.fsPath));
      }

      return files;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error("Failed to discover files", {
        pattern,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * Clean up expired cache entries and limit cache size
   */
  private cleanupCache(): void {
    const now = Date.now();
    const entriesToDelete: string[] = [];

    // Find expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.DEFAULT_CACHE_TTL) {
        entriesToDelete.push(key);
      }
    }

    // Delete expired entries
    for (const key of entriesToDelete) {
      this.cache.delete(key);
    }

    // If still over max size, delete oldest entries
    if (this.cache.size > this.MAX_CACHE_SIZE) {
      const sortedEntries = Array.from(this.cache.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp
      );

      const entriesToRemove = sortedEntries.slice(
        0,
        this.cache.size - this.MAX_CACHE_SIZE
      );
      for (const [key] of entriesToRemove) {
        this.cache.delete(key);
      }
    }

    if (entriesToDelete.length > 0 || this.cache.size > this.MAX_CACHE_SIZE) {
      this.logger.debug("Cache cleanup completed", {
        deletedEntries: entriesToDelete.length,
        remainingEntries: this.cache.size,
      });
    }
  }

  /**
   * Clear all cached data
   */
  public clearCache(): void {
    const cacheSize = this.cache.size;
    this.cache.clear();
    this.logger.info("Cache cleared", { previousSize: cacheSize });
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): {
    size: number;
    maxSize: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  } {
    if (this.cache.size === 0) {
      return {
        size: 0,
        maxSize: this.MAX_CACHE_SIZE,
        oldestEntry: null,
        newestEntry: null,
      };
    }

    const timestamps = Array.from(this.cache.values()).map(
      (entry) => entry.timestamp
    );
    return {
      size: this.cache.size,
      maxSize: this.MAX_CACHE_SIZE,
      oldestEntry: Math.min(...timestamps),
      newestEntry: Math.max(...timestamps),
    };
  }

  /**
   * Force refresh of cached data
   */
  public async refreshCache(pattern?: string): Promise<void> {
    const patterns = pattern
      ? [pattern]
      : Array.from(this.cache.keys()).map((key) =>
          key.replace("discovery:", "")
        );

    for (const p of patterns) {
      await this.discoverTestFiles({ pattern: p, forceRefresh: true });
    }

    this.logger.info("Cache refresh completed", { patterns });
  }

  /**
   * Dispose of the manager and clean up resources
   */
  public dispose(): void {
    try {
      this.logger.info("Disposing test discovery manager");
      this.clearCache();
      TestDiscoveryManager.instance = undefined;
      this.logger.info("Test discovery manager disposed successfully");
    } catch (error) {
      this.logger.error("Failed to dispose test discovery manager", { error });
    }
  }
}
