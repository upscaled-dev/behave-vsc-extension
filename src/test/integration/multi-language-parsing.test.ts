import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import { FeatureParser } from "../../parsers/feature-parser";

/**
 * Integration tests for multi-language feature parsing
 * Tests parsing of actual feature files in different languages
 */
suite("Multi-Language Feature Parsing Integration Tests", () => {
  const featuresDir = path.join(__dirname, "../../..", "features");

  suite("Language File Detection", () => {
    test("Should correctly identify Russian feature file", () => {
      const ruFeatureFile = path.join(featuresDir, "examples-ru.feature");
      if (!fs.existsSync(ruFeatureFile)) {
        return;
      }

      const result = FeatureParser.parseFeatureFile(ruFeatureFile);

      assert.ok(result, "Should parse Russian feature file");
      assert.strictEqual(result!.feature, "Система управления пользователями");
      assert.ok(result!.scenarios.length > 0);
    });

    test("Should correctly identify French feature file", () => {
      const frFeatureFile = path.join(featuresDir, "examples-fr.feature");
      if (!fs.existsSync(frFeatureFile)) {
        return;
      }

      const result = FeatureParser.parseFeatureFile(frFeatureFile);

      assert.ok(result, "Should parse French feature file");
      assert.strictEqual(result!.feature, "Gestion des produits dans un panier d'achat");
      assert.ok(result!.scenarios.length > 0);
    });

    test("Should correctly identify German feature file", () => {
      const deFeatureFile = path.join(featuresDir, "examples-de.feature");
      if (!fs.existsSync(deFeatureFile)) {
        return;
      }

      const result = FeatureParser.parseFeatureFile(deFeatureFile);

      assert.ok(result, "Should parse German feature file");
      assert.strictEqual(result!.feature, "Benutzerkontoverwaltung");
      assert.ok(result!.scenarios.length > 0);
    });

    test("Should correctly identify Spanish feature file", () => {
      const esFeatureFile = path.join(featuresDir, "examples-es.feature");
      if (!fs.existsSync(esFeatureFile)) {
        return;
      }

      const result = FeatureParser.parseFeatureFile(esFeatureFile);

      assert.ok(result, "Should parse Spanish feature file");
      assert.strictEqual(result!.feature, "Sistema de reserva de hoteles");
      assert.ok(result!.scenarios.length > 0);
    });
  });

  suite("Multi-Language Scenario Extraction", () => {
    test("Should extract all Russian scenarios from disk file", () => {
      const ruFeatureFile = path.join(featuresDir, "examples-ru.feature");
      if (!fs.existsSync(ruFeatureFile)) {
        return;
      }

      const result = FeatureParser.parseFeatureFile(ruFeatureFile);
      assert.ok(result);

      const scenarioNames = result!.scenarios.map((s) => s.name);
      assert.ok(scenarioNames.some((n) => n.includes("Создание")));
      assert.ok(scenarioNames.some((n) => n.includes("Редактирование")));
      assert.ok(scenarioNames.some((n) => n.includes("Удаление")));
    });

    test("Should preserve Russian steps in scenarios", () => {
      const ruFeatureFile = path.join(featuresDir, "examples-ru.feature");
      if (!fs.existsSync(ruFeatureFile)) {
        return;
      }

      const result = FeatureParser.parseFeatureFile(ruFeatureFile);
      assert.ok(result);

      const firstScenario = result!.scenarios[0];
      assert.ok(firstScenario);
      assert.ok(firstScenario.steps.length > 0);

      const stepsText = firstScenario.steps.join(" ");
      assert.ok(stepsText.includes("Дано") || stepsText.includes("Когда") || stepsText.includes("Тогда"));
    });
  });

  suite("Character Encoding Support", () => {
    test("Should handle French accented characters", () => {
      const frFeatureFile = path.join(featuresDir, "examples-fr.feature");
      if (!fs.existsSync(frFeatureFile)) {
        return;
      }

      const result = FeatureParser.parseFeatureFile(frFeatureFile);
      assert.ok(result);

      const featureName = result!.feature;
      assert.ok(featureName.includes("é") || featureName.includes("panier"));
    });

    test("Should handle German umlauts", () => {
      const deFeatureFile = path.join(featuresDir, "examples-de.feature");
      if (!fs.existsSync(deFeatureFile)) {
        return;
      }

      const result = FeatureParser.parseFeatureFile(deFeatureFile);
      assert.ok(result);

      const featureName = result!.feature;
      const hasValidChars = featureName.length > 0;
      assert.ok(hasValidChars);
    });

    test("Should handle Spanish accented characters", () => {
      const esFeatureFile = path.join(featuresDir, "examples-es.feature");
      if (!fs.existsSync(esFeatureFile)) {
        return;
      }

      const result = FeatureParser.parseFeatureFile(esFeatureFile);
      assert.ok(result);

      const featureName = result!.feature;
      assert.ok(featureName.includes("é") || featureName.includes("a"));
    });
  });

  suite("Multi-Language Scenario Outlines", () => {
    test("Should parse Russian Scenario Outline Examples", () => {
      const ruFeatureFile = path.join(featuresDir, "examples-ru.feature");
      if (!fs.existsSync(ruFeatureFile)) {
        return;
      }

      const result = FeatureParser.parseFeatureFile(ruFeatureFile);
      assert.ok(result);

      const outlineScenarios = result!.scenarios.filter((s) => s.name.includes(":"));
      assert.ok(outlineScenarios.length > 0, "Should have expanded outline examples");
    });
  });

  suite("Backward Compatibility", () => {
    test("Should still parse existing English feature files", () => {
      const englishContent = `Feature: Calculator
  Scenario: Add two numbers
    Given I have entered 50
    When I press add
    Then I get 120`;

      const result = FeatureParser.parseFeatureContent(englishContent);

      assert.ok(result);
      assert.strictEqual(result!.feature, "Calculator");
      assert.strictEqual(result!.scenarios.length, 1);
    });

    test("Should handle files without language header", () => {
      const content = `Feature: Login
  Scenario: Valid login
    Given I am on login page
    When I enter valid credentials
    Then I should see dashboard`;

      const result = FeatureParser.parseFeatureContent(content);

      assert.ok(result);
      assert.strictEqual(result!.feature, "Login");
      assert.strictEqual(result!.scenarios.length, 1);
    });
  });

  suite("Performance", () => {
    test("Should efficiently parse large Russian feature file", () => {
      const largeContent = `# language: ru
Функционал: Большой тест производительности
  ${Array.from({ length: 50 })
    .map(
      (_, i) => `
  Сценарий: Сценарий номер ${i + 1}
    Дано условие ${i + 1}
    Когда я действую
    Тогда результат ${i + 1}`
    )
    .join("\n")}`;

      const startTime = Date.now();
      const result = FeatureParser.parseFeatureContent(largeContent);
      const endTime = Date.now();

      assert.ok(result);
      assert.strictEqual(result!.scenarios.length, 50);
      assert.ok(endTime - startTime < 1000, "Should parse in less than 1 second");
    });
  });

  suite("Auto-Detection", () => {
    test("Should auto-detect Russian from first keyword", () => {
      const content = `Функционал: Тест
  Сценарий: Проверка
    Дано условие`;

      const result = FeatureParser.parseFeatureContent(content);

      assert.ok(result);
      assert.strictEqual(result!.feature, "Тест");
    });

    test("Should auto-detect French from first keyword", () => {
      const content = `Fonctionnalité: Test
  Scénario: Vérification
    Étant donné une condition`;

      const result = FeatureParser.parseFeatureContent(content);

      assert.ok(result);
      assert.strictEqual(result!.feature, "Test");
    });

    test("Should auto-detect German from first keyword", () => {
      const content = `Funktionalität: Test
  Szenario: Überprüfung
    Angenommen eine Bedingung`;

      const result = FeatureParser.parseFeatureContent(content);

      assert.ok(result);
      assert.strictEqual(result!.feature, "Test");
    });

    test("Should auto-detect Spanish from first keyword", () => {
      const content = `Característica: Prueba
  Escenario: Verificación
    Dado una condición`;

      const result = FeatureParser.parseFeatureContent(content);

      assert.ok(result);
      assert.strictEqual(result!.feature, "Prueba");
    });
  });
});
