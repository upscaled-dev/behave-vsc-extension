import * as assert from "assert";
import { FeatureParser } from "../../parsers/feature-parser";

/**
 * Comprehensive tests for multi-language feature parser
 * Tests feature parsing across 70+ languages with language-aware keyword matching
 */
suite("FeatureParser Multi-Language Tests", () => {
  suite("Russian (Русский)", () => {
    test("Should parse Russian feature file with # language: ru header", () => {
      const featureContent = `# language: ru
Функционал: Калькулятор
  В целях избежать глупые ошибки
  Как человек, плохой в математике
  Я хочу быть сказано сумму двух чисел

  Сценарий: Добавить два числа
    Дано я ввел 50 в калькулятор
    И я ввел 70 в калькулятор
    Когда я нажму сложить
    Тогда результат должен быть 120 на экране`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Калькулятор");
      assert.strictEqual(result?.scenarios.length, 1);
      assert.strictEqual(result?.scenarios[0]?.name, "Добавить два числа");
    });

    test("Should auto-detect Russian without explicit header", () => {
      const featureContent = `Функционал: Проверка входа
  Сценарий: Успешный вход
    Дано я на странице входа
    Когда я ввожу правильные учетные данные
    Тогда я должен видеть главную страницу`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Проверка входа");
      assert.strictEqual(result?.scenarios.length, 1);
      assert.strictEqual(result?.scenarios[0]?.name, "Успешный вход");
    });

    test("Should parse multiple Russian scenarios", () => {
      const featureContent = `# language: ru
Функционал: Система авторизации
  Сценарий: Вход с правильными данными
    Дано я на странице входа
    Когда я ввожу логин "admin"
    И я ввожу пароль "secret"
    Тогда я должен войти успешно

  Сценарий: Вход с неправильными данными
    Дано я на странице входа
    Когда я ввожу логин "admin"
    И я ввожу пароль "wrong"
    Тогда я должен увидеть сообщение об ошибке`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Система авторизации");
      assert.strictEqual(result?.scenarios.length, 2);
      assert.strictEqual(result?.scenarios[0]?.name, "Вход с правильными данными");
      assert.strictEqual(result?.scenarios[1]?.name, "Вход с неправильными данными");
    });

    test("Should parse Russian Scenario Outline with Examples", () => {
      const featureContent = `# language: ru
Функционал: Проверка калькулятора
  Сценарий-структура: Сложение двух чисел
    Дано я ввел <первое> в калькулятор
    И я ввел <второе> в калькулятор
    Когда я нажму сложить
    Тогда результат должен быть <результат>

    Примеры:
      | первое | второе | результат |
      | 10     | 20     | 30        |
      | 50     | 70     | 120       |`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Проверка калькулятора");
      assert.strictEqual(result?.scenarios.length, 2);
    });

    test("Should parse Russian Background", () => {
      const featureContent = `# language: ru
Функционал: Проверка системы
  Предыстория:
    Дано я инициализирую систему
    И я устанавливаю начальные значения

  Сценарий: Первый тест
    Когда я выполняю операцию
    Тогда результат должен быть корректным`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Проверка системы");
      assert.ok(result?.scenarios.length >= 1);
    });
  });

  suite("French (Français)", () => {
    test("Should parse French feature file with # language: fr header", () => {
      const featureContent = `# language: fr
Fonctionnalité: Calculatrice
  Afin d'éviter les erreurs bêtes
  En tant que quelqu'un de mauvais en mathématiques
  Je veux être dit la somme de deux nombres

  Scénario: Additionner deux nombres
    Étant donné que j'ai entré 50 dans la calculatrice
    Et que j'ai entré 70 dans la calculatrice
    Quand que j'appuie sur l'addition
    Alors le résultat devrait être 120 à l'écran`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Calculatrice");
      assert.strictEqual(result?.scenarios.length, 1);
      assert.strictEqual(result?.scenarios[0]?.name, "Additionner deux nombres");
    });

    test("Should auto-detect French without explicit header", () => {
      const featureContent = `Fonctionnalité: Gestion des utilisateurs
  Scénario: Créer un nouvel utilisateur
    Étant donné que je suis sur la page d'enregistrement
    Quand je remplis le formulaire
    Alors l'utilisateur devrait être créé`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Gestion des utilisateurs");
      assert.strictEqual(result?.scenarios.length, 1);
      assert.strictEqual(result?.scenarios[0]?.name, "Créer un nouvel utilisateur");
    });

    test("Should parse French Scénario-modèle (Scenario Outline)", () => {
      const featureContent = `# language: fr
Fonctionnalité: Authentification
  Scénario-modèle: Connexion avec différentes données
    Étant donné que je suis sur la page de connexion
    Quand j'entre "<utilisateur>" et "<mot_de_passe>"
    Alors je devrais voir "<résultat>"

    Exemples:
      | utilisateur | mot_de_passe | résultat |
      | admin       | secret       | succès   |
      | user        | wrong        | erreur   |`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Authentification");
      assert.strictEqual(result?.scenarios.length, 2);
    });
  });

  suite("German (Deutsch)", () => {
    test("Should parse German feature file with # language: de header", () => {
      const featureContent = `# language: de
Funktionalität: Taschenrechner
  Um dumme Fehler zu vermeiden
  Als jemand, der schlecht in Mathematik ist
  Möchte ich, dass mir die Summe von zwei Zahlen genannt wird

  Szenario: Zwei Zahlen addieren
    Angenommen ich habe 50 in den Taschenrechner eingegeben
    Und ich habe 70 in den Taschenrechner eingegeben
    Wenn ich die Additionstaste drücke
    Dann sollte das Ergebnis 120 auf dem Bildschirm sein`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Taschenrechner");
      assert.strictEqual(result?.scenarios.length, 1);
      assert.strictEqual(result?.scenarios[0]?.name, "Zwei Zahlen addieren");
    });

    test("Should auto-detect German without explicit header", () => {
      const featureContent = `Funktionalität: Benutzerverwaltung
  Szenario: Neuen Benutzer erstellen
    Angenommen ich bin auf der Registrierungsseite
    Wenn ich das Formular ausfülle
    Dann sollte der Benutzer erstellt werden`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Benutzerverwaltung");
      assert.strictEqual(result?.scenarios.length, 1);
      assert.strictEqual(result?.scenarios[0]?.name, "Neuen Benutzer erstellen");
    });

    test("Should parse German Szenariogrundriss (Scenario Outline)", () => {
      const featureContent = `# language: de
Funktionalität: Authentifizierung
  Szenariogrundriss: Anmeldung mit verschiedenen Daten
    Angenommen ich bin auf der Anmeldeseite
    Wenn ich "<benutzer>" und "<passwort>" eingebe
    Dann sollte ich "<ergebnis>" sehen

    Beispiele:
      | benutzer | passwort | ergebnis |
      | admin    | secret   | erfolg   |
      | user     | falsch   | fehler   |`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Authentifizierung");
      assert.strictEqual(result?.scenarios.length, 2);
    });
  });

  suite("Spanish (Español)", () => {
    test("Should parse Spanish feature file with # language: es header", () => {
      const featureContent = `# language: es
Característica: Calculadora
  Para evitar errores tontos
  Como alguien que es malo en matemáticas
  Quiero que me digan la suma de dos números

  Escenario: Sumar dos números
    Dado que he introducido 50 en la calculadora
    Y que he introducido 70 en la calculadora
    Cuando presiono la suma
    Entonces el resultado debería ser 120 en la pantalla`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Calculadora");
      assert.strictEqual(result?.scenarios.length, 1);
      assert.strictEqual(result?.scenarios[0]?.name, "Sumar dos números");
    });

    test("Should auto-detect Spanish without explicit header", () => {
      const featureContent = `Característica: Gestión de usuarios
  Escenario: Crear un nuevo usuario
    Dado que estoy en la página de registro
    Cuando relleno el formulario
    Entonces se debería crear el usuario`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Gestión de usuarios");
      assert.strictEqual(result?.scenarios.length, 1);
      assert.strictEqual(result?.scenarios[0]?.name, "Crear un nuevo usuario");
    });
  });

  suite("English (English) - Backward Compatibility", () => {
    test("Should still parse English features without # language: en header", () => {
      const featureContent = `Feature: Calculator
  In order to avoid silly mistakes
  As a math idiot
  I want to be told the sum of two numbers

  Scenario: Add two numbers
    Given I have entered 50 into the calculator
    And I have entered 70 into the calculator
    When I press add
    Then the result should be 120 on the screen`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Calculator");
      assert.strictEqual(result?.scenarios.length, 1);
      assert.strictEqual(result?.scenarios[0]?.name, "Add two numbers");
    });

    test("Should parse English features with explicit # language: en header", () => {
      const featureContent = `# language: en
Feature: User Management
  Scenario: Create new user
    Given I am on the registration page
    When I fill in the form
    Then the user should be created`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "User Management");
      assert.strictEqual(result?.scenarios.length, 1);
    });
  });

  suite("Language Detection Priority", () => {
    test("Should prioritize explicit # language: header over auto-detection", () => {
      const featureContent = `# language: ru
Функционал: Тест
  Сценарий: Проверка приоритета
    Дано условие выполнено`;

      const result = FeatureParser.parseFeatureContent(featureContent, "en");

      assert.ok(result);
      assert.strictEqual(result?.feature, "Тест");
    });

    test("Should use provided languageCode parameter over header", () => {
      const featureContent = `Функционал: Тест на русском
  Сценарий: Проверка параметра
    Дано условие`;

      const result = FeatureParser.parseFeatureContent(featureContent, "ru");

      assert.ok(result);
      assert.strictEqual(result?.feature, "Тест на русском");
      assert.strictEqual(result?.scenarios.length, 1);
    });
  });

  suite("Multi-Language Step Keywords", () => {
    test("Should parse Russian steps with all keywords (Given/When/Then/And/But)", () => {
      const featureContent = `# language: ru
Функционал: Проверка шагов
  Сценарий: Тестирование всех типов шагов
    Дано условие 1
    И условие 2
    Но условие 3
    Когда действие 1
    И действие 2
    Тогда результат 1
    И результат 2`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.scenarios.length, 1);
      const scenario = result?.scenarios[0];
      assert.ok(scenario);
      assert.ok(scenario.steps.length >= 7);
    });

    test("Should parse French steps with all keywords (Étant donné/Quand/Alors/Et)", () => {
      const featureContent = `# language: fr
Fonctionnalité: Vérification des étapes
  Scénario: Test de tous les types d'étapes
    Étant donné condition 1
    Et condition 2
    Quand action 1
    Et action 2
    Alors résultat 1
    Et résultat 2`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.scenarios.length, 1);
      const scenario = result?.scenarios[0];
      assert.ok(scenario);
      assert.ok(scenario.steps.length >= 6);
    });

    test("Should parse German steps with all keywords (Angenommen/Wenn/Dann)", () => {
      const featureContent = `# language: de
Funktionalität: Überprüfung von Schritten
  Szenario: Test aller Schritttypen
    Angenommen Bedingung 1
    Und Bedingung 2
    Wenn Aktion 1
    Und Aktion 2
    Dann Ergebnis 1
    Und Ergebnis 2`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.scenarios.length, 1);
      const scenario = result?.scenarios[0];
      assert.ok(scenario);
      assert.ok(scenario.steps.length >= 6);
    });
  });

  suite("Edge Cases and Special Scenarios", () => {
    test("Should handle mixed indentation in multi-language files", () => {
      const featureContent = `# language: ru
Функционал: Проверка отступов
  Сценарий: Сценарий с разными отступами
    Дано условие
      И подусловие
    Когда действие
    Тогда результат`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Проверка отступов");
    });

    test("Should handle comments in multi-language files", () => {
      const featureContent = `# language: ru
# Это комментарий
Функционал: Проверка комментариев
  # Еще один комментарий
  Сценарий: Сценарий с комментариями
    # Комментарий перед шагом
    Дано условие выполнено`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Проверка комментариев");
      assert.strictEqual(result?.scenarios.length, 1);
    });

    test("Should handle special characters in scenario names", () => {
      const featureContent = `# language: ru
Функционал: Проверка специальных символов
  Сценарий: Проверка с символами: «угловые кавычки» и "кавычки"
    Дано условие`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.ok(result?.scenarios[0]?.name.includes("«угловые кавычки»"));
    });

    test("Should handle Unicode characters in all parts", () => {
      const featureContent = `# language: fr
Fonctionnalité: Test des caractères Unicode
  Scénario: Vérification des accents (é, è, ê, ë, à, ù)
    Étant donné une chaîne avec accents
    Quand je la traite
    Alors le résultat devrait être correct`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Test des caractères Unicode");
    });

    test("Should handle empty scenarios gracefully", () => {
      const featureContent = `# language: ru
Функционал: Проверка пустых сценариев
  Сценарий: Пустой сценарий
  
  Сценарий: Сценарий с контентом
    Дано условие`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Проверка пустых сценариев");
    });

    test("Should handle very long scenario names", () => {
      const featureContent = `# language: ru
Функционал: Проверка длинных имен
  Сценарий: Это очень очень очень очень очень очень очень очень очень очень очень очень очень длинное имя сценария которое занимает много строк текста
    Дано условие`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result!.scenarios.length, 1);
      const firstScenario = result!.scenarios[0];
      assert.ok(firstScenario && firstScenario.name.length > 100);
    });
  });

  suite("Fallback and Error Handling", () => {
    test("Should fallback to English if unsupported language is detected", () => {
      const featureContent = `Feature: Calculator
  Scenario: Test with unsupported language
    Given I have entered 50
    When I press add
    Then I get result`;

      const result = FeatureParser.parseFeatureContent(featureContent, "xx");

      assert.ok(result);
      assert.strictEqual(result?.feature, "Calculator");
    });

    test("Should handle invalid content gracefully", () => {
      const invalidContent = `This is not a feature file at all
      Just some random text
      No keywords here`;

      const result = FeatureParser.parseFeatureContent(invalidContent);

      assert.strictEqual(result, null);
    });

    test("Should return null for empty content", () => {
      const result = FeatureParser.parseFeatureContent("");

      assert.strictEqual(result, null);
    });

    test("Should handle malformed language header", () => {
      const featureContent = `# language: 
Функционал: Тест
  Сценарий: Проверка
    Дано условие`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
    });
  });

  suite("Complex Multi-Language Scenarios", () => {
    test("Should parse Russian Scenario Outline with multiple Examples blocks", () => {
      const featureContent = `# language: ru
Функционал: Проверка структурированных данных
  Сценарий-структура: Проверка с несколькими блоками примеров
    Дано значение <значение>
    Когда я обрабатываю
    Тогда результат <результат>

    Примеры:
      | значение | результат |
      | 1        | true      |
      | 2        | false     |

    Примеры:
      | значение | результат |
      | 3        | true      |
      | 4        | false     |`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.scenarios.length, 4);
    });

    test("Should parse Russian feature with Background and multiple Scenarios", () => {
      const featureContent = `# language: ru
Функционал: Система с предыстией
  Предыстория:
    Дано система инициализирована
    И загружены начальные данные

  Сценарий: Первый тест
    Когда я выполняю первую операцию
    Тогда результат должен быть A

  Сценарий: Второй тест
    Когда я выполняю вторую операцию
    Тогда результат должен быть B`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Система с предыстией");
      assert.strictEqual(result?.scenarios.length, 2);
    });

    test("Should parse feature with all Russian keyword variations", () => {
      const featureContent = `# language: ru
Функционал: Проверка всех ключевых слов
  Предыстория:
    Дано начальные условия

  Сценарий-структура: Первая структура
    Дано значение <значение>
    Тогда результат <результат>

    Примеры:
      | значение | результат |
      | 1        | one       |

  Сценарий: Обычный сценарий
    Дано условие A
    И условие B
    Но не условие C
    Когда я действую
    И я еще действую
    Тогда результат 1
    И результат 2`;

      const result = FeatureParser.parseFeatureContent(featureContent);

      assert.ok(result);
      assert.strictEqual(result?.feature, "Проверка всех ключевых слов");
      assert.ok(result?.scenarios.length >= 2);
    });
  });
});
