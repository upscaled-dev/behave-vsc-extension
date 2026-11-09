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

  constructor(logger?: Logger, _config?: ExtensionConfig) {
    this.logger = logger ?? Logger.getInstance();
  }

  public static create(logger?: Logger, config?: ExtensionConfig): TestDiscoveryManager {
    return new TestDiscoveryManager(logger, config);
  }

  /**
   * Get the singleton instance of the test discovery manager
   * @deprecated Use TestDiscoveryManager.create() for new code or inject TestDiscoveryManager via context
   */
  public static getInstance(): TestDiscoveryManager {
    TestDiscoveryManager.instance ??= new TestDiscoveryManager();
    return TestDiscoveryManager.instance;
  }

  /**
   * Discover test files with intelligent caching
   */
  public async discoverTestFiles(
    options: DiscoveryOptions = {}, token?: vscode.CancellationToken
  ): Promise<string[]> {
    if (token?.isCancellationRequested) {return [];}
    const {
      pattern,
      maxCacheAge = this.DEFAULT_CACHE_TTL,
      forceRefresh = false,
    } = options;

    const searches = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({ folder,
      pattern: pattern ?? ExtensionConfig.forResource(folder.uri).testFilePattern }));
    for (const search of searches) {
      if (!search.pattern.trim()) {throw new Error(`Test file pattern is empty for project '${search.folder.name}'.`);}
    }
    const cacheKey = JSON.stringify(searches.map(({ folder, pattern: selected }) => [folder.uri.toString(), selected]));

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

      // Drain every admitted root before reporting failure so no search outlives its logger.
      const results = await Promise.allSettled(searches.map(({ folder, pattern: selected }) => this.discoverFiles(selected, folder, token)));
      if (token?.isCancellationRequested) {return [];}
      const files: string[] = [];
      for (const result of results) {
        if (result.status === "rejected") {throw result.reason;}
        files.push(...result.value);
      }

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
      if (token?.isCancellationRequested) {return [];}
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
  private async discoverFiles(pattern: string, selected: vscode.WorkspaceFolder, token?: vscode.CancellationToken): Promise<string[]> {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        this.logger.warn("No workspace folders found for test discovery");
        return [];
      }

      const files: string[] = [];

      for (const folder of [selected]) {
        const relativePattern = new vscode.RelativePattern(folder, pattern);
        const foundFiles = await vscode.workspace.findFiles(
          relativePattern,
          "**/node_modules/**", undefined, token
        );
        if (token?.isCancellationRequested) {return [];}

        files.push(...foundFiles.filter((file) => vscode.workspace.getWorkspaceFolder(file)?.uri.toString() === folder.uri.toString()).map((file) => file.fsPath));
      }

      return files;
    } catch (error) {
      if (token?.isCancellationRequested) {return [];}
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
    this.clearCache();
    await this.discoverTestFiles({ ...(pattern ? { pattern } : {}), forceRefresh: true });
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
