import * as assert from "assert";
import { LanguageDetector, detectLanguage } from "../../i18n/language-detector.js";

suite("LanguageDetector Unit Tests", () => {
  let detector: LanguageDetector;

  setup(() => {
    detector = new LanguageDetector();
  });

  suite("Explicit Language Detection", () => {
    test("Should detect language from explicit header comment", () => {
      const content = `# language: ru
Функция: Калькулятор
  Сценарий: Сложение двух чисел
    Допустим я ввел 50 в калькулятор
    Когда я нажму сложить
    То результат должен быть 120`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "ru");
      assert.strictEqual(result.detectionMethod, "explicit");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should detect language with spaces around colon", () => {
      const content = `#language:fr
Fonctionnalité: Calculatrice
  Scénario: Addition`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "fr");
      assert.strictEqual(result.detectionMethod, "explicit");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should detect language with extra whitespace", () => {
      const content = `  #  language  :  de  
Funktionalität: Rechner`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "de");
      assert.strictEqual(result.detectionMethod, "explicit");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should detect language from header within first 10 lines", () => {
      const content = `# This is a comment
# Another comment
# More comments
# language: es
Característica: Calculadora`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "es");
      assert.strictEqual(result.detectionMethod, "explicit");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should handle case-insensitive language codes", () => {
      const content = `# language: RU
Функция: Тест`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "ru");
      assert.strictEqual(result.detectionMethod, "explicit");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should handle language codes with hyphens", () => {
      const content = `# language: zh-CN
功能: 测试`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "zh-cn");
      assert.strictEqual(result.detectionMethod, "explicit");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should fall back to auto-detect if language code is invalid", () => {
      const content = `# language: invalid-code
Feature: Test`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "en");
      assert.strictEqual(result.detectionMethod, "auto");
    });
  });

  suite("Auto Language Detection", () => {
    test("Should auto-detect English from Feature keyword", () => {
      const content = `Feature: Calculator
  Scenario: Add two numbers`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "en");
      assert.strictEqual(result.detectionMethod, "auto");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should auto-detect Russian from Функция keyword", () => {
      const content = `Функция: Калькулятор
  Сценарий: Сложение`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "ru");
      assert.strictEqual(result.detectionMethod, "auto");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should auto-detect French from Fonctionnalité keyword", () => {
      const content = `Fonctionnalité: Calculatrice
  Scénario: Addition`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "fr");
      assert.strictEqual(result.detectionMethod, "auto");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should auto-detect German from Funktionalität keyword", () => {
      const content = `Funktionalität: Rechner
  Szenario: Addition`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "de");
      assert.strictEqual(result.detectionMethod, "auto");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should auto-detect Spanish from Característica keyword", () => {
      const content = `Característica: Calculadora
  Escenario: Suma`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "es");
      assert.strictEqual(result.detectionMethod, "auto");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should auto-detect Italian from Funzionalità keyword", () => {
      const content = `Funzionalità: Calcolatrice
  Scenario: Addizione`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "it");
      assert.strictEqual(result.detectionMethod, "auto");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should auto-detect Portuguese from Funcionalidade keyword", () => {
      const content = `Funcionalidade: Calculadora
  Cenário: Adição`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "pt");
      assert.strictEqual(result.detectionMethod, "auto");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should auto-detect Chinese from 功能 keyword", () => {
      const content = `功能: 计算器
  场景: 加法`;

      const result = detector.detectLanguage(content);

      assert.ok(result.languageCode === "zh-cn" || result.languageCode === "zh-tw");
      assert.strictEqual(result.detectionMethod, "auto");
    });

    test("Should auto-detect Japanese from フィーチャ keyword", () => {
      const content = `フィーチャ: 計算機
  シナリオ: 足し算`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "ja");
      assert.strictEqual(result.detectionMethod, "auto");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should auto-detect Korean from 기능 keyword", () => {
      const content = `기능: 계산기
  시나리오: 덧셈`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "ko");
      assert.strictEqual(result.detectionMethod, "auto");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should skip empty lines and comments during auto-detection", () => {
      const content = `
# This is a comment

# Another comment

Feature: Calculator`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "en");
      assert.strictEqual(result.detectionMethod, "auto");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should detect from first non-comment line", () => {
      const content = `# Comment line 1
# Comment line 2
Функция: Тест
  Сценарий: Проверка`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "ru");
      assert.strictEqual(result.detectionMethod, "auto");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should handle medium confidence for ambiguous keywords", () => {
      // "Scenario" exists in multiple languages
      const content = `Scenario: Test`;

      const result = detector.detectLanguage(content);

      // Should prefer English or return first match with medium confidence
      assert.ok(result.languageCode);
      assert.strictEqual(result.detectionMethod, "auto");
    });
  });

  suite("Default Fallback", () => {
    test("Should fall back to English for empty content", () => {
      const content = "";

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "en");
      assert.strictEqual(result.detectionMethod, "default");
      assert.strictEqual(result.confidence, "low");
    });

    test("Should fall back to English for whitespace-only content", () => {
      const content = "   \n\n  \t  \n";

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "en");
      assert.strictEqual(result.detectionMethod, "default");
      assert.strictEqual(result.confidence, "low");
    });

    test("Should fall back to English for unrecognized keywords", () => {
      const content = `UnknownKeyword: Test
  SomeOtherKeyword: Something`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "en");
      assert.strictEqual(result.detectionMethod, "default");
      assert.strictEqual(result.confidence, "low");
    });

    test("Should fall back to English for comments only", () => {
      const content = `# Comment 1
# Comment 2
# Comment 3`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "en");
      assert.strictEqual(result.detectionMethod, "default");
      assert.strictEqual(result.confidence, "low");
    });
  });

  suite("Priority Order", () => {
    test("Should prioritize explicit header over auto-detection", () => {
      const content = `# language: ru
Feature: This looks like English
  Scenario: But header says Russian`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "ru");
      assert.strictEqual(result.detectionMethod, "explicit");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should use auto-detection when no explicit header", () => {
      const content = `Функция: Тест
  Сценарий: Проверка`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "ru");
      assert.strictEqual(result.detectionMethod, "auto");
    });

    test("Should fall back to default when both methods fail", () => {
      const content = `NotAKeyword: Test`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "en");
      assert.strictEqual(result.detectionMethod, "default");
    });
  });

  suite("Edge Cases", () => {
    test("Should handle emoji language", () => {
      const content = `📚: Test
  📕: Scenario`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "em");
      assert.strictEqual(result.detectionMethod, "auto");
    });

    test("Should handle mixed case keywords", () => {
      const content = `FEATURE: Test
  SCENARIO: Something`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "en");
      assert.strictEqual(result.detectionMethod, "auto");
    });

    test("Should handle keywords with trailing spaces", () => {
      const content = `Feature:    Test with spaces
  Scenario:   Something`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "en");
      assert.strictEqual(result.detectionMethod, "auto");
    });

    test("Should handle Windows line endings", () => {
      const content = "# language: ru\r\nФункция: Тест\r\n  Сценарий: Проверка";

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "ru");
      assert.strictEqual(result.detectionMethod, "explicit");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should handle Unix line endings", () => {
      const content = "# language: ru\nФункция: Тест\n  Сценарий: Проверка";

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "ru");
      assert.strictEqual(result.detectionMethod, "explicit");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should scan only first 10 lines for performance", () => {
      const lines = Array(15).fill("# Comment line");
      lines[12] = "# language: ru";
      const content = lines.join("\n");

      const result = detector.detectLanguage(content);

      // Should not find language header beyond line 10
      assert.notStrictEqual(result.detectionMethod, "explicit");
    });
  });

  suite("Convenience Functions", () => {
    test("detectLanguage function should work", () => {
      const content = `Feature: Test`;

      const result = detectLanguage(content);

      assert.strictEqual(result.languageCode, "en");
      assert.strictEqual(result.detectionMethod, "auto");
    });

    test("detectLanguage should handle Russian content", () => {
      const content = `Функция: Тест`;

      const result = detectLanguage(content);

      assert.strictEqual(result.languageCode, "ru");
      assert.strictEqual(result.detectionMethod, "auto");
    });
  });

  suite("Real-World Examples", () => {
    test("Should detect English feature file", () => {
      const content = `Feature: User Authentication
  As a user
  I want to log in to the system
  So that I can access my account

  Scenario: Successful login
    Given I am on the login page
    When I enter valid credentials
    Then I should be logged in`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "en");
      assert.strictEqual(result.detectionMethod, "auto");
    });

    test("Should detect Russian feature file with explicit header", () => {
      const content = `# language: ru
Функция: Аутентификация пользователя
  Как пользователь
  Я хочу войти в систему
  Чтобы получить доступ к моему аккаунту

  Сценарий: Успешный вход
    Допустим я нахожусь на странице входа
    Когда я ввожу корректные данные
    То я должен войти в систему`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "ru");
      assert.strictEqual(result.detectionMethod, "explicit");
      assert.strictEqual(result.confidence, "high");
    });

    test("Should detect French feature file", () => {
      const content = `Fonctionnalité: Authentification utilisateur
  En tant qu'utilisateur
  Je veux me connecter au système
  
  Scénario: Connexion réussie
    Soit je suis sur la page de connexion
    Quand je saisis des identifiants valides
    Alors je devrais être connecté`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "fr");
      assert.strictEqual(result.detectionMethod, "auto");
    });

    test("Should detect German feature file", () => {
      const content = `Funktionalität: Benutzerauthentifizierung
  
  Szenario: Erfolgreiche Anmeldung
    Angenommen ich bin auf der Anmeldeseite
    Wenn ich gültige Anmeldedaten eingebe
    Dann sollte ich angemeldet sein`;

      const result = detector.detectLanguage(content);

      assert.strictEqual(result.languageCode, "de");
      assert.strictEqual(result.detectionMethod, "auto");
    });
  });
});
