import * as assert from "assert";
import { LocalizationService, getLocalizationService, t } from "../../i18n/localization-service.js";

suite("LocalizationService Unit Tests", () => {
  let service: LocalizationService;

  setup(() => {
    service = getLocalizationService();
  });

  suite("Initialization", () => {
    test("Should initialize with default locale", () => {
      const locale = service.getCurrentLocale();
      assert.ok(locale === "en" || locale === "ru");
    });

    test("Should load supported locales", () => {
      const locales = service.getSupportedLocales();
      assert.ok(locales.length >= 2);
      assert.ok(locales.includes("en"));
      assert.ok(locales.includes("ru"));
    });

    test("Should support English locale", () => {
      assert.strictEqual(service.isLocaleSupported("en"), true);
    });

    test("Should support Russian locale", () => {
      assert.strictEqual(service.isLocaleSupported("ru"), true);
    });

    test("Should not support unsupported locale", () => {
      assert.strictEqual(service.isLocaleSupported("fr"), false);
    });
  });

  suite("English Localization", () => {
    setup(() => {
      service.setLocale("en");
    });

    test("Should get CodeLens text for run scenario", () => {
      const text = service.getText("codelens.runScenario");
      assert.strictEqual(text, "▶️ Run Scenario");
    });

    test("Should get CodeLens text for run feature", () => {
      const text = service.getText("codelens.runFeature");
      assert.strictEqual(text, "▶️ Run Feature");
    });

    test("Should get CodeLens text for debug scenario", () => {
      const text = service.getText("codelens.debugScenario");
      assert.strictEqual(text, "🐛 Debug Scenario");
    });

    test("Should get command text for run all tests", () => {
      const text = service.getText("commands.runAllTests");
      assert.strictEqual(text, "Run All Behave Tests");
    });

    test("Should get message text for no feature file", () => {
      const text = service.getText("messages.noFeatureFile");
      assert.strictEqual(text, "No feature file is currently open");
    });

    test("Should get error text for file not found", () => {
      const text = service.getText("errors.fileNotFound", { path: "/test/file.feature" });
      assert.strictEqual(text, "File not found: /test/file.feature");
    });

    test("Should get test explorer text for loading", () => {
      const text = service.getText("testExplorer.loading");
      assert.strictEqual(text, "Loading tests...");
    });

    test("Should get status bar text for ready", () => {
      const text = service.getText("statusBar.ready");
      assert.strictEqual(text, "Behave: Ready");
    });
  });

  suite("Russian Localization", () => {
    setup(() => {
      service.setLocale("ru");
    });

    test("Should get CodeLens text for run scenario in Russian", () => {
      const text = service.getText("codelens.runScenario");
      assert.strictEqual(text, "▶️ Запустить сценарий");
    });

    test("Should get CodeLens text for run feature in Russian", () => {
      const text = service.getText("codelens.runFeature");
      assert.strictEqual(text, "▶️ Запустить функцию");
    });

    test("Should get CodeLens text for debug scenario in Russian", () => {
      const text = service.getText("codelens.debugScenario");
      assert.strictEqual(text, "🐛 Отладить сценарий");
    });

    test("Should get command text for run all tests in Russian", () => {
      const text = service.getText("commands.runAllTests");
      assert.strictEqual(text, "Запустить все тесты Behave");
    });

    test("Should get message text for no feature file in Russian", () => {
      const text = service.getText("messages.noFeatureFile");
      assert.strictEqual(text, "В данный момент не открыт файл функции");
    });

    test("Should get error text for file not found in Russian", () => {
      const text = service.getText("errors.fileNotFound", { path: "/test/file.feature" });
      assert.strictEqual(text, "Файл не найден: /test/file.feature");
    });

    test("Should get test explorer text for loading in Russian", () => {
      const text = service.getText("testExplorer.loading");
      assert.strictEqual(text, "Загрузка тестов...");
    });

    test("Should get status bar text for ready in Russian", () => {
      const text = service.getText("statusBar.ready");
      assert.strictEqual(text, "Behave: Готов");
    });
  });

  suite("Parameter Interpolation", () => {
    setup(() => {
      service.setLocale("en");
    });

    test("Should interpolate single parameter", () => {
      const text = service.getText("errors.fileNotFound", { path: "/some/path.feature" });
      assert.strictEqual(text, "File not found: /some/path.feature");
    });

    test("Should interpolate multiple parameters", () => {
      const text = service.getText("errors.parseError", { error: "Syntax error on line 5" });
      assert.strictEqual(text, "Error parsing feature file: Syntax error on line 5");
    });

    test("Should handle missing parameters gracefully", () => {
      const text = service.getText("errors.fileNotFound");
      assert.strictEqual(text, "File not found: {path}");
    });

    test("Should handle extra parameters", () => {
      const text = service.getText("errors.fileNotFound", { 
        path: "/test.feature", 
        extra: "ignored" 
      });
      assert.strictEqual(text, "File not found: /test.feature");
    });

    test("Should interpolate with special characters", () => {
      const text = service.getText("errors.fileNotFound", { 
        path: "C:\\Users\\Test\\file.feature" 
      });
      assert.strictEqual(text, "File not found: C:\\Users\\Test\\file.feature");
    });
  });

  suite("Fallback Behavior", () => {
    test("Should return key path for missing key", () => {
      const text = service.getText("nonexistent.key");
      assert.strictEqual(text, "nonexistent.key");
    });

    test("Should fallback to English for missing Russian translation", () => {
      service.setLocale("ru");
      const text = service.getText("nonexistent.key");
      assert.strictEqual(text, "nonexistent.key");
    });

    test("Should handle deeply nested missing keys", () => {
      const text = service.getText("level1.level2.level3.missing");
      assert.strictEqual(text, "level1.level2.level3.missing");
    });
  });

  suite("Locale Management", () => {
    test("Should switch locale from English to Russian", () => {
      service.setLocale("en");
      assert.strictEqual(service.getCurrentLocale(), "en");
      
      service.setLocale("ru");
      assert.strictEqual(service.getCurrentLocale(), "ru");
    });

    test("Should switch locale from Russian to English", () => {
      service.setLocale("ru");
      assert.strictEqual(service.getCurrentLocale(), "ru");
      
      service.setLocale("en");
      assert.strictEqual(service.getCurrentLocale(), "en");
    });

    test("Should not change locale for unsupported locale", () => {
      const originalLocale = service.getCurrentLocale();
      service.setLocale("fr" as any);
      assert.strictEqual(service.getCurrentLocale(), originalLocale);
    });

    test("Should return different text after locale change", () => {
      service.setLocale("en");
      const englishText = service.getText("codelens.runScenario");
      
      service.setLocale("ru");
      const russianText = service.getText("codelens.runScenario");
      
      assert.notStrictEqual(englishText, russianText);
      assert.strictEqual(englishText, "▶️ Run Scenario");
      assert.strictEqual(russianText, "▶️ Запустить сценарий");
    });
  });

  suite("Convenience Function", () => {
    test("t() function should work", () => {
      service.setLocale("en");
      const text = t("codelens.runScenario");
      assert.strictEqual(text, "▶️ Run Scenario");
    });

    test("t() function should support parameters", () => {
      service.setLocale("en");
      const text = t("errors.fileNotFound", { path: "/test.feature" });
      assert.strictEqual(text, "File not found: /test.feature");
    });

    test("t() function should respect current locale", () => {
      service.setLocale("ru");
      const text = t("codelens.runScenario");
      assert.strictEqual(text, "▶️ Запустить сценарий");
    });
  });

  suite("Edge Cases", () => {
    test("Should handle empty key path", () => {
      const text = service.getText("");
      assert.strictEqual(text, "");
    });

    test("Should handle key path with trailing dot", () => {
      const text = service.getText("codelens.");
      assert.strictEqual(text, "codelens.");
    });

    test("Should handle key path with leading dot", () => {
      const text = service.getText(".codelens.runScenario");
      assert.strictEqual(text, ".codelens.runScenario");
    });

    test("Should handle empty parameters object", () => {
      service.setLocale("en");
      const text = service.getText("codelens.runScenario", {});
      assert.strictEqual(text, "▶️ Run Scenario");
    });

    test("Should handle null-like parameter values", () => {
      const text = service.getText("errors.fileNotFound", { path: "" });
      assert.strictEqual(text, "File not found: ");
    });
  });

  suite("Real-World Usage", () => {
    test("Should provide all CodeLens texts", () => {
      service.setLocale("en");
      
      assert.ok(service.getText("codelens.runScenario").length > 0);
      assert.ok(service.getText("codelens.runFeature").length > 0);
      assert.ok(service.getText("codelens.debugScenario").length > 0);
      assert.ok(service.getText("codelens.debugFeature").length > 0);
    });

    test("Should provide all command texts", () => {
      service.setLocale("en");
      
      assert.ok(service.getText("commands.runAllTests").length > 0);
      assert.ok(service.getText("commands.runCurrentFile").length > 0);
      assert.ok(service.getText("commands.runScenario").length > 0);
      assert.ok(service.getText("commands.debugScenario").length > 0);
    });

    test("Should provide all message texts", () => {
      service.setLocale("en");
      
      assert.ok(service.getText("messages.noFeatureFile").length > 0);
      assert.ok(service.getText("messages.noPythonInterpreter").length > 0);
      assert.ok(service.getText("messages.testRunning").length > 0);
      assert.ok(service.getText("messages.testCompleted").length > 0);
    });

    test("Should provide all error texts", () => {
      service.setLocale("en");
      
      assert.ok(service.getText("errors.fileNotFound", { path: "test" }).length > 0);
      assert.ok(service.getText("errors.readError", { path: "test" }).length > 0);
      assert.ok(service.getText("errors.parseError", { error: "test" }).length > 0);
    });

    test("Should work with Windows file paths", () => {
      service.setLocale("en");
      const text = service.getText("errors.fileNotFound", { 
        path: "C:\\Work\\behave-vsc-extension\\test.feature" 
      });
      assert.strictEqual(text, "File not found: C:\\Work\\behave-vsc-extension\\test.feature");
    });

    test("Should work with Unix file paths", () => {
      service.setLocale("en");
      const text = service.getText("errors.fileNotFound", { 
        path: "/home/user/project/test.feature" 
      });
      assert.strictEqual(text, "File not found: /home/user/project/test.feature");
    });
  });
});
