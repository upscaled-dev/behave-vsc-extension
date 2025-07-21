import * as assert from "assert";
import * as vscode from "vscode";
import { TestDiscoveryManager } from "../../core/test-discovery-manager";

suite("TestDiscoveryManager Unit Tests", () => {
  let discoveryManager: TestDiscoveryManager;

  setup(() => {
    // Get a fresh instance for each test
    discoveryManager = TestDiscoveryManager.getInstance();
  });

  teardown(() => {
    // Clean up after each test
    discoveryManager.clearCache();
  });

  test("Should create singleton instance", () => {
    const instance1 = TestDiscoveryManager.getInstance();
    const instance2 = TestDiscoveryManager.getInstance();
    assert.strictEqual(instance1, instance2);
  });

  test("Should get cache statistics", () => {
    const stats = discoveryManager.getCacheStats();
    assert.strictEqual(stats.size, 0);
    assert.strictEqual(stats.maxSize, 100);
    assert.strictEqual(stats.oldestEntry, null);
    assert.strictEqual(stats.newestEntry, null);
  });

  test("Should clear cache", () => {
    // Add some dummy data to cache
    const cache = (discoveryManager as any).cache;
    cache.set("test:pattern", {
      timestamp: Date.now(),
      data: ["file1.feature"],
    });

    assert.strictEqual(cache.size, 1);

    discoveryManager.clearCache();

    assert.strictEqual(cache.size, 0);
  });

  test("Should handle empty workspace folders", async () => {
    // Mock the findFiles method to return empty array
    const originalFindFiles = vscode.workspace.findFiles;
    (vscode.workspace as any).findFiles = () => {
      return Promise.resolve([]);
    };

    try {
      const files = await discoveryManager.discoverTestFiles({
        pattern: "**/*.feature",
      });
      assert.deepStrictEqual(files, []);
    } finally {
      // Restore original findFiles
      (vscode.workspace as any).findFiles = originalFindFiles;
    }
  });

  test("Should handle cache TTL", async () => {
    // Mock a very short TTL for testing
    const originalTTL = (discoveryManager as any).DEFAULT_CACHE_TTL;
    (discoveryManager as any).DEFAULT_CACHE_TTL = 1; // 1ms

    try {
      // Mock findFiles to return some files
      const originalFindFiles = vscode.workspace.findFiles;
      (vscode.workspace as any).findFiles = () => {
        return Promise.resolve([{ fsPath: "test.feature" } as vscode.Uri]);
      };

      // First discovery should cache
      await discoveryManager.discoverTestFiles({ pattern: "**/*.feature" });

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Manually trigger cleanup
      (discoveryManager as any).cleanupCache();

      // Cache should be cleaned up
      const stats = discoveryManager.getCacheStats();
      assert.strictEqual(stats.size, 0);

      // Restore original findFiles
      (vscode.workspace as any).findFiles = originalFindFiles;
    } finally {
      // Restore original TTL
      (discoveryManager as any).DEFAULT_CACHE_TTL = originalTTL;
    }
  });

  test("Should force refresh cache", async () => {
    // Dispose and get a fresh instance for a clean state
    discoveryManager.dispose();
    discoveryManager = TestDiscoveryManager.getInstance();
    discoveryManager.clearCache();

    // Mock discoverFiles to return different results
    const mockFiles = ["file1.feature", "file2.feature"];
    const originalDiscoverFiles = (discoveryManager as any).discoverFiles;
    (discoveryManager as any).discoverFiles = () => Promise.resolve(mockFiles);

    try {
      // First discovery
      const files1 = await discoveryManager.discoverTestFiles({
        pattern: "**/*.feature",
      });
      assert.deepStrictEqual(files1, mockFiles);

      // Force refresh
      const files2 = await discoveryManager.discoverTestFiles({
        pattern: "**/*.feature",
        forceRefresh: true,
      });
      assert.deepStrictEqual(files2, mockFiles);

      // Cache should still have the entry
      const stats = discoveryManager.getCacheStats();
      assert.strictEqual(stats.size, 1);
    } finally {
      // Restore original discoverFiles
      (discoveryManager as any).discoverFiles = originalDiscoverFiles;
    }
  });

  test("Should handle cache size limits", () => {
    const originalMaxSize = (discoveryManager as any).MAX_CACHE_SIZE;
    (discoveryManager as any).MAX_CACHE_SIZE = 2; // Small limit for testing

    try {
      // Add more entries than the limit
      const cache = (discoveryManager as any).cache;
      const now = Date.now();

      cache.set("pattern1", { timestamp: now - 1000, data: [] });
      cache.set("pattern2", { timestamp: now - 500, data: [] });
      cache.set("pattern3", { timestamp: now, data: [] });

      assert.strictEqual(cache.size, 3);

      // Trigger cleanup
      (discoveryManager as any).cleanupCache();

      // Should be at max size
      assert.strictEqual(cache.size, 2);

      // Oldest entry should be removed
      assert.strictEqual(cache.has("pattern1"), false);
      assert.strictEqual(cache.has("pattern2"), true);
      assert.strictEqual(cache.has("pattern3"), true);
    } finally {
      // Restore original max size
      (discoveryManager as any).MAX_CACHE_SIZE = originalMaxSize;
    }
  });

  test("Should dispose properly", () => {
    const originalInstance = TestDiscoveryManager.getInstance();

    discoveryManager.dispose();

    // Instance should be cleared
    const newInstance = TestDiscoveryManager.getInstance();
    assert.notStrictEqual(originalInstance, newInstance);
  });
});
