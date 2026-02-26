/**
 * Language Registry - Loads and manages Gherkin keywords for 70+ languages
 * 
 * Singleton pattern for efficient memory usage.
 * Data source: behave_i18n.py (generated from gherkin-languages.json)
 */

import { LanguageInfo, LanguageRegistry, GherkinKeywords } from './types';

/**
 * Raw language data from behave_i18n.py
 * This is the complete dataset of 70+ languages with their Gherkin keywords
 */
const LANGUAGES_DATA: Record<string, {
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
}> = {
  'af': { 'and': ['* ', 'En '], 'background': ['Agtergrond'], 'but': ['* ', 'Maar '], 'examples': ['Voorbeelde'], 'feature': ['Funksie', 'Besigheid Behoefte', 'Vermoë'], 'given': ['* ', 'Gegewe '], 'name': 'Afrikaans', 'native': 'Afrikaans', 'rule': ['Reël', 'Reel'], 'scenario': ['Voorbeeld', 'Situasie'], 'scenario_outline': ['Situasie Uiteensetting'], 'then': ['* ', 'Dan '], 'when': ['* ', 'Wanneer '] },
  'am': { 'and': ['* ', 'Եվ '], 'background': ['Կոնտեքստ'], 'but': ['* ', 'Բայց '], 'examples': ['Օրինակներ'], 'feature': ['Ֆունկցիոնալություն', 'Հատկություն'], 'given': ['* ', 'Դիցուք '], 'name': 'Armenian', 'native': 'հայերեն', 'rule': ['Rule'], 'scenario': ['Օրինակ', 'Սցենար'], 'scenario_outline': ['Սցենարի կառուցվացքը'], 'then': ['* ', 'Ապա '], 'when': ['* ', 'Եթե ', 'Երբ '] },
  'amh': { 'and': ['* ', 'እና '], 'background': ['ቅድመ ሁኔታ', 'መነሻ', 'መነሻ ሀሳብ'], 'but': ['* ', 'ግን '], 'examples': ['ምሳሌዎች', 'ሁናቴዎች'], 'feature': ['ስራ', 'የተፈለገው ስራ', 'የሚፈለገው ድርጊት'], 'given': ['* ', 'የተሰጠ '], 'name': 'Amharic', 'native': 'አማርኛ', 'rule': ['ህግ'], 'scenario': ['ምሳሌ', 'ሁናቴ'], 'scenario_outline': ['ሁናቴ ዝርዝር', 'ሁናቴ አብነት'], 'then': ['* ', 'ከዚያ '], 'when': ['* ', 'መቼ '] },
  'an': { 'and': ['* ', 'Y ', 'E '], 'background': ['Antecedents'], 'but': ['* ', 'Pero '], 'examples': ['Eixemplos'], 'feature': ['Caracteristica'], 'given': ['* ', 'Dau ', 'Dada ', 'Daus ', 'Dadas '], 'name': 'Aragonese', 'native': 'Aragonés', 'rule': ['Rule'], 'scenario': ['Eixemplo', 'Caso'], 'scenario_outline': ['Esquema del caso'], 'then': ['* ', 'Alavez ', 'Allora ', 'Antonces '], 'when': ['* ', 'Cuan '] },
  'ar': { 'and': ['* ', 'و '], 'background': ['الخلفية'], 'but': ['* ', 'لكن '], 'examples': ['امثلة'], 'feature': ['خاصية'], 'given': ['* ', 'بفرض '], 'name': 'Arabic', 'native': 'العربية', 'rule': ['Rule'], 'scenario': ['مثال', 'سيناريو'], 'scenario_outline': ['سيناريو مخطط'], 'then': ['* ', 'اذاً ', 'ثم '], 'when': ['* ', 'متى ', 'عندما '] },
  'ast': { 'and': ['* ', 'Y ', 'Ya '], 'background': ['Antecedentes'], 'but': ['* ', 'Peru '], 'examples': ['Exemplos'], 'feature': ['Carauterística'], 'given': ['* ', 'Dáu ', 'Dada ', 'Daos ', 'Daes '], 'name': 'Asturian', 'native': 'asturianu', 'rule': ['Rule'], 'scenario': ['Exemplo', 'Casu'], 'scenario_outline': ['Esbozu del casu'], 'then': ['* ', 'Entós '], 'when': ['* ', 'Cuando '] },
  'az': { 'and': ['* ', 'Və ', 'Həm '], 'background': ['Keçmiş', 'Kontekst'], 'but': ['* ', 'Amma ', 'Ancaq '], 'examples': ['Nümunələr'], 'feature': ['Özəllik'], 'given': ['* ', 'Tutaq ki ', 'Verilir '], 'name': 'Azerbaijani', 'native': 'Azərbaycanca', 'rule': ['Rule'], 'scenario': ['Nümunə', 'Ssenari'], 'scenario_outline': ['Ssenarinin strukturu'], 'then': ['* ', 'O halda '], 'when': ['* ', 'Əgər ', 'Nə vaxt ki '] },
  'be': { 'and': ['* ', 'I ', 'Ды ', 'Таксама '], 'background': ['Кантэкст'], 'but': ['* ', 'Але ', 'Інакш '], 'examples': ['Прыклады'], 'feature': ['Функцыянальнасць', 'Фіча'], 'given': ['* ', 'Няхай ', 'Дадзена '], 'name': 'Belarusian', 'native': 'Беларуская', 'rule': ['Правілы'], 'scenario': ['Сцэнарый', 'Cцэнар'], 'scenario_outline': ['Шаблон сцэнарыя', 'Узор сцэнара'], 'then': ['* ', 'Тады '], 'when': ['* ', 'Калі '] },
  'bg': { 'and': ['* ', 'И '], 'background': ['Предистория'], 'but': ['* ', 'Но '], 'examples': ['Примери'], 'feature': ['Функционалност'], 'given': ['* ', 'Дадено '], 'name': 'Bulgarian', 'native': 'български', 'rule': ['Правило'], 'scenario': ['Пример', 'Сценарий'], 'scenario_outline': ['Рамка на сценарий'], 'then': ['* ', 'То '], 'when': ['* ', 'Когато '] },
  'bm': { 'and': ['* ', 'Dan '], 'background': ['Latar Belakang'], 'but': ['* ', 'Tetapi ', 'Tapi '], 'examples': ['Contoh'], 'feature': ['Fungsi'], 'given': ['* ', 'Diberi ', 'Bagi '], 'name': 'Malay', 'native': 'Bahasa Melayu', 'rule': ['Rule'], 'scenario': ['Senario', 'Situasi', 'Keadaan'], 'scenario_outline': ['Kerangka Senario', 'Kerangka Situasi', 'Kerangka Keadaan', 'Garis Panduan Senario'], 'then': ['* ', 'Maka ', 'Kemudian '], 'when': ['* ', 'Apabila '] },
  'bs': { 'and': ['* ', 'I ', 'A '], 'background': ['Pozadina'], 'but': ['* ', 'Ali '], 'examples': ['Primjeri'], 'feature': ['Karakteristika'], 'given': ['* ', 'Dato '], 'name': 'Bosnian', 'native': 'Bosanski', 'rule': ['Rule'], 'scenario': ['Primjer', 'Scenariju', 'Scenario'], 'scenario_outline': ['Scenariju-obris', 'Scenario-outline'], 'then': ['* ', 'Zatim '], 'when': ['* ', 'Kada '] },
  'ca': { 'and': ['* ', 'I '], 'background': ['Rerefons', 'Antecedents'], 'but': ['* ', 'Però '], 'examples': ['Exemples'], 'feature': ['Característica', 'Funcionalitat'], 'given': ['* ', 'Donat ', 'Donada ', 'Atès ', 'Atesa '], 'name': 'Catalan', 'native': 'català', 'rule': ['Rule'], 'scenario': ['Exemple', 'Escenari'], 'scenario_outline': ["Esquema de l'escenari"], 'then': ['* ', 'Aleshores ', 'Cal '], 'when': ['* ', 'Quan '] },
  'cs': { 'and': ['* ', 'A také ', 'A '], 'background': ['Pozadí', 'Kontext'], 'but': ['* ', 'Ale '], 'examples': ['Příklady'], 'feature': ['Požadavek'], 'given': ['* ', 'Pokud ', 'Za předpokladu '], 'name': 'Czech', 'native': 'Česky', 'rule': ['Pravidlo'], 'scenario': ['Příklad', 'Scénář'], 'scenario_outline': ['Náčrt Scénáře', 'Osnova scénáře'], 'then': ['* ', 'Pak '], 'when': ['* ', 'Když '] },
  'cy-GB': { 'and': ['* ', 'A '], 'background': ['Cefndir'], 'but': ['* ', 'Ond '], 'examples': ['Enghreifftiau'], 'feature': ['Arwedd'], 'given': ['* ', 'Anrhegedig a '], 'name': 'Welsh', 'native': 'Cymraeg', 'rule': ['Rule'], 'scenario': ['Enghraifft', 'Scenario'], 'scenario_outline': ['Scenario Amlinellol'], 'then': ['* ', 'Yna '], 'when': ['* ', 'Pryd '] },
  'da': { 'and': ['* ', 'Og '], 'background': ['Baggrund'], 'but': ['* ', 'Men '], 'examples': ['Eksempler'], 'feature': ['Egenskab'], 'given': ['* ', 'Givet '], 'name': 'Danish', 'native': 'dansk', 'rule': ['Regel'], 'scenario': ['Eksempel', 'Scenarie'], 'scenario_outline': ['Abstrakt Scenario'], 'then': ['* ', 'Så '], 'when': ['* ', 'Når '] },
  'de': { 'and': ['* ', 'Und '], 'background': ['Grundlage', 'Hintergrund', 'Voraussetzungen', 'Vorbedingungen'], 'but': ['* ', 'Aber '], 'examples': ['Beispiele'], 'feature': ['Funktionalität', 'Funktion'], 'given': ['* ', 'Angenommen ', 'Gegeben sei ', 'Gegeben seien '], 'name': 'German', 'native': 'Deutsch', 'rule': ['Rule', 'Regel'], 'scenario': ['Beispiel', 'Szenario'], 'scenario_outline': ['Szenariogrundriss', 'Szenarien'], 'then': ['* ', 'Dann '], 'when': ['* ', 'Wenn '] },
  'el': { 'and': ['* ', 'Και '], 'background': ['Υπόβαθρο'], 'but': ['* ', 'Αλλά '], 'examples': ['Παραδείγματα', 'Σενάρια'], 'feature': ['Δυνατότητα', 'Λειτουργία'], 'given': ['* ', 'Δεδομένου '], 'name': 'Greek', 'native': 'Ελληνικά', 'rule': ['Rule'], 'scenario': ['Παράδειγμα', 'Σενάριο'], 'scenario_outline': ['Περιγραφή Σεναρίου', 'Περίγραμμα Σεναρίου'], 'then': ['* ', 'Τότε '], 'when': ['* ', 'Όταν '] },
  'em': { 'and': ['* ', '😂'], 'background': ['💤'], 'but': ['* ', '😔'], 'examples': ['📓'], 'feature': ['📚'], 'given': ['* ', '😐'], 'name': 'Emoji', 'native': '😀', 'rule': ['Rule'], 'scenario': ['🥒', '📕'], 'scenario_outline': ['📖'], 'then': ['* ', '🙏'], 'when': ['* ', '🎬'] },
  'en': { 'and': ['* ', 'And '], 'background': ['Background'], 'but': ['* ', 'But '], 'examples': ['Examples', 'Scenarios'], 'feature': ['Feature', 'Business Need', 'Ability'], 'given': ['* ', 'Given '], 'name': 'English', 'native': 'English', 'rule': ['Rule'], 'scenario': ['Example', 'Scenario'], 'scenario_outline': ['Scenario Outline', 'Scenario Template'], 'then': ['* ', 'Then '], 'when': ['* ', 'When '] },
  'en-Scouse': { 'and': ['* ', 'An '], 'background': ['Dis is what went down'], 'but': ['* ', 'Buh '], 'examples': ['Examples'], 'feature': ['Feature'], 'given': ['* ', 'Givun ', 'Youse know when youse got '], 'name': 'Scouse', 'native': 'Scouse', 'rule': ['Rule'], 'scenario': ['The thing of it is'], 'scenario_outline': ['Wharrimean is'], 'then': ['* ', 'Dun ', 'Den youse gotta '], 'when': ['* ', 'Wun ', 'Youse know like when '] },
  'en-au': { 'and': ['* ', 'Too right '], 'background': ['First off'], 'but': ['* ', 'Yeah nah '], 'examples': ["You'll wanna"], 'feature': ['Pretty much'], 'given': ['* ', "Y'know "], 'name': 'Australian', 'native': 'Australian', 'rule': ['Rule'], 'scenario': ['Awww, look mate'], 'scenario_outline': ["Reckon it's like"], 'then': ['* ', 'But at the end of the day I reckon '], 'when': ['* ', "It's just unbelievable "] },
  'en-lol': { 'and': ['* ', 'AN '], 'background': ['B4'], 'but': ['* ', 'BUT '], 'examples': ['EXAMPLZ'], 'feature': ['OH HAI'], 'given': ['* ', 'I CAN HAZ '], 'name': 'LOLCAT', 'native': 'LOLCAT', 'rule': ['Rule'], 'scenario': ['MISHUN'], 'scenario_outline': ['MISHUN SRSLY'], 'then': ['* ', 'DEN '], 'when': ['* ', 'WEN '] },
  'en-old': { 'and': ['* ', 'Ond ', '7 '], 'background': ['Aer', 'Ær'], 'but': ['* ', 'Ac '], 'examples': ['Se the', 'Se þe', 'Se ðe'], 'feature': ['Hwaet', 'Hwæt'], 'given': ['* ', 'Thurh ', 'Þurh ', 'Ðurh '], 'name': 'Old English', 'native': 'Englisc', 'rule': ['Rule'], 'scenario': ['Swa'], 'scenario_outline': ['Swa hwaer swa', 'Swa hwær swa'], 'then': ['* ', 'Tha ', 'Þa ', 'Ða ', 'Tha the ', 'Þa þe ', 'Ða ðe '], 'when': ['* ', 'Bæþsealf ', 'Bæþsealfa ', 'Bæþsealfe ', 'Ciricæw ', 'Ciricæwe ', 'Ciricæwa '] },
  'en-pirate': { 'and': ['* ', 'Aye '], 'background': ['Yo-ho-ho'], 'but': ['* ', 'Avast! '], 'examples': ['Dead men tell no tales'], 'feature': ['Ahoy matey!'], 'given': ['* ', 'Gangway! '], 'name': 'Pirate', 'native': 'Pirate', 'rule': ['Rule'], 'scenario': ['Heave to'], 'scenario_outline': ['Shiver me timbers'], 'then': ['* ', 'Let go and haul '], 'when': ['* ', 'Blimey! '] },
  'en-tx': { 'and': ['Come hell or high water '], 'background': ["Lemme tell y'all a story"], 'but': ["Well now hold on, I'll you what "], 'examples': ["Now that's a story longer than a cattle drive in July"], 'feature': ["This ain't my first rodeo", 'All gussied up'], 'given': ["Fixin' to ", 'All git out '], 'name': 'Texas', 'native': 'Texas', 'rule': ['Rule '], 'scenario': ['All hat and no cattle'], 'scenario_outline': ['Serious as a snake bite', 'Busy as a hound in flea season'], 'then': ["There's no tree but bears some fruit "], 'when': ['Quick out of the chute '] },
  'eo': { 'and': ['* ', 'Kaj '], 'background': ['Fono'], 'but': ['* ', 'Sed '], 'examples': ['Ekzemploj'], 'feature': ['Trajto'], 'given': ['* ', 'Donitaĵo ', 'Komence '], 'name': 'Esperanto', 'native': 'Esperanto', 'rule': ['Regulo'], 'scenario': ['Ekzemplo', 'Scenaro', 'Kazo'], 'scenario_outline': ['Konturo de la scenaro', 'Skizo', 'Kazo-skizo'], 'then': ['* ', 'Do '], 'when': ['* ', 'Se '] },
  'es': { 'and': ['* ', 'Y ', 'E '], 'background': ['Antecedentes'], 'but': ['* ', 'Pero '], 'examples': ['Ejemplos'], 'feature': ['Característica', 'Necesidad del negocio', 'Requisito'], 'given': ['* ', 'Dado ', 'Dada ', 'Dados ', 'Dadas '], 'name': 'Spanish', 'native': 'español', 'rule': ['Regla', 'Regla de negocio'], 'scenario': ['Ejemplo', 'Escenario'], 'scenario_outline': ['Esquema del escenario'], 'then': ['* ', 'Entonces '], 'when': ['* ', 'Cuando '] },
  'et': { 'and': ['* ', 'Ja '], 'background': ['Taust'], 'but': ['* ', 'Kuid '], 'examples': ['Juhtumid'], 'feature': ['Omadus'], 'given': ['* ', 'Eeldades '], 'name': 'Estonian', 'native': 'eesti keel', 'rule': ['Reegel'], 'scenario': ['Juhtum', 'Stsenaarium'], 'scenario_outline': ['Raamjuhtum', 'Raamstsenaarium'], 'then': ['* ', 'Siis '], 'when': ['* ', 'Kui '] },
  'fa': { 'and': ['* ', 'و '], 'background': ['زمینه'], 'but': ['* ', 'اما '], 'examples': ['نمونه ها'], 'feature': ['وِیژگی'], 'given': ['* ', 'با فرض '], 'name': 'Persian', 'native': 'فارسی', 'rule': ['Rule'], 'scenario': ['مثال', 'سناریو'], 'scenario_outline': ['الگوی سناریو'], 'then': ['* ', 'آنگاه '], 'when': ['* ', 'هنگامی '] },
  'fi': { 'and': ['* ', 'Ja '], 'background': ['Tausta'], 'but': ['* ', 'Mutta '], 'examples': ['Tapaukset'], 'feature': ['Ominaisuus'], 'given': ['* ', 'Oletetaan '], 'name': 'Finnish', 'native': 'suomi', 'rule': ['Rule'], 'scenario': ['Tapaus'], 'scenario_outline': ['Tapausaihio'], 'then': ['* ', 'Niin '], 'when': ['* ', 'Kun '] },
  'fr': { 'and': ['* ', 'Et que ', "Et qu'", 'Et '], 'background': ['Contexte'], 'but': ['* ', 'Mais que ', "Mais qu'", 'Mais '], 'examples': ['Exemples'], 'feature': ['Fonctionnalité'], 'given': ['* ', 'Soit ', 'Sachant que ', "Sachant qu'", 'Sachant ', 'Etant donné que ', "Etant donné qu'", 'Etant donné ', 'Etant donnée ', 'Etant donnés ', 'Etant données ', 'Étant donné que ', "Étant donné qu'", 'Étant donné ', 'Étant donnée ', 'Étant donnés ', 'Étant données '], 'name': 'French', 'native': 'français', 'rule': ['Règle'], 'scenario': ['Exemple', 'Scénario'], 'scenario_outline': ['Plan du scénario', 'Plan du Scénario'], 'then': ['* ', 'Alors ', 'Donc '], 'when': ['* ', 'Quand ', 'Lorsque ', "Lorsqu'"] },
  'ga': { 'and': ['* ', 'Agus '], 'background': ['Cúlra'], 'but': ['* ', 'Ach '], 'examples': ['Samplaí'], 'feature': ['Gné'], 'given': ['* ', 'Cuir i gcás go ', 'Cuir i gcás nach ', 'Cuir i gcás gur ', 'Cuir i gcás nár '], 'name': 'Irish', 'native': 'Gaeilge', 'rule': ['Riail'], 'scenario': ['Sampla', 'Cás'], 'scenario_outline': ['Cás Achomair'], 'then': ['* ', 'Ansin '], 'when': ['* ', 'Nuair a ', 'Nuair nach ', 'Nuair ba ', 'Nuair nár '] },
  'gj': { 'and': ['* ', 'અને '], 'background': ['બેકગ્રાઉન્ડ'], 'but': ['* ', 'પણ '], 'examples': ['ઉદાહરણો'], 'feature': ['લક્ષણ', 'વ્યાપાર જરૂર', 'ક્ષમતા'], 'given': ['* ', 'આપેલ છે '], 'name': 'Gujarati', 'native': 'ગુજરાતી', 'rule': ['નિયમ'], 'scenario': ['ઉદાહરણ', 'સ્થિતિ'], 'scenario_outline': ['પરિદ્દશ્ય રૂપરેખા', 'પરિદ્દશ્ય ઢાંચો'], 'then': ['* ', 'પછી '], 'when': ['* ', 'ક્યારે '] },
  'gl': { 'and': ['* ', 'E '], 'background': ['Contexto'], 'but': ['* ', 'Mais ', 'Pero '], 'examples': ['Exemplos'], 'feature': ['Característica'], 'given': ['* ', 'Dado ', 'Dada ', 'Dados ', 'Dadas '], 'name': 'Galician', 'native': 'galego', 'rule': ['Rule'], 'scenario': ['Exemplo', 'Escenario'], 'scenario_outline': ['Esbozo do escenario'], 'then': ['* ', 'Entón ', 'Logo '], 'when': ['* ', 'Cando '] },
  'he': { 'and': ['* ', 'וגם '], 'background': ['רקע'], 'but': ['* ', 'אבל '], 'examples': ['דוגמאות'], 'feature': ['תכונה'], 'given': ['* ', 'בהינתן '], 'name': 'Hebrew', 'native': 'עברית', 'rule': ['כלל'], 'scenario': ['דוגמא', 'תרחיש'], 'scenario_outline': ['תבנית תרחיש'], 'then': ['* ', 'אז ', 'אזי '], 'when': ['* ', 'כאשר '] },
  'hi': { 'and': ['* ', 'और ', 'तथा '], 'background': ['पृष्ठभूमि'], 'but': ['* ', 'पर ', 'परन्तु ', 'किन्तु '], 'examples': ['उदाहरण'], 'feature': ['रूप लेख'], 'given': ['* ', 'अगर ', 'यदि ', 'चूंकि '], 'name': 'Hindi', 'native': 'हिंदी', 'rule': ['नियम'], 'scenario': ['परिदृश्य'], 'scenario_outline': ['परिदृश्य रूपरेखा'], 'then': ['* ', 'तब ', 'तदा '], 'when': ['* ', 'जब ', 'कदा '] },
  'hr': { 'and': ['* ', 'I '], 'background': ['Pozadina'], 'but': ['* ', 'Ali '], 'examples': ['Primjeri', 'Scenariji'], 'feature': ['Osobina', 'Mogućnost', 'Mogucnost'], 'given': ['* ', 'Zadan ', 'Zadani ', 'Zadano ', 'Ukoliko '], 'name': 'Croatian', 'native': 'hrvatski', 'rule': ['Rule'], 'scenario': ['Primjer', 'Scenarij'], 'scenario_outline': ['Skica', 'Koncept'], 'then': ['* ', 'Onda '], 'when': ['* ', 'Kada ', 'Kad '] },
  'ht': { 'and': ['* ', 'Ak ', 'Epi ', 'E '], 'background': ['Kontèks', 'Istorik'], 'but': ['* ', 'Men '], 'examples': ['Egzanp'], 'feature': ['Karakteristik', 'Mak', 'Fonksyonalite'], 'given': ['* ', 'Sipoze ', 'Sipoze ke ', 'Sipoze Ke '], 'name': 'Creole', 'native': 'kreyòl', 'rule': ['Rule'], 'scenario': ['Senaryo'], 'scenario_outline': ['Plan senaryo', 'Plan Senaryo', 'Senaryo deskripsyon', 'Senaryo Deskripsyon', 'Dyagram senaryo', 'Dyagram Senaryo'], 'then': ['* ', 'Lè sa a ', 'Le sa a '], 'when': ['* ', 'Lè ', 'Le '] },
  'hu': { 'and': ['* ', 'És '], 'background': ['Háttér'], 'but': ['* ', 'De '], 'examples': ['Példák'], 'feature': ['Jellemző'], 'given': ['* ', 'Amennyiben ', 'Adott '], 'name': 'Hungarian', 'native': 'magyar', 'rule': ['Szabály'], 'scenario': ['Példa', 'Forgatókönyv'], 'scenario_outline': ['Forgatókönyv vázlat'], 'then': ['* ', 'Akkor '], 'when': ['* ', 'Majd ', 'Ha ', 'Amikor '] },
  'id': { 'and': ['* ', 'Dan '], 'background': ['Dasar', 'Latar Belakang'], 'but': ['* ', 'Tapi ', 'Tetapi '], 'examples': ['Contoh', 'Misal'], 'feature': ['Fitur'], 'given': ['* ', 'Dengan ', 'Diketahui ', 'Diasumsikan ', 'Bila ', 'Jika '], 'name': 'Indonesian', 'native': 'Bahasa Indonesia', 'rule': ['Rule', 'Aturan'], 'scenario': ['Skenario'], 'scenario_outline': ['Skenario konsep', 'Garis-Besar Skenario'], 'then': ['* ', 'Maka ', 'Kemudian '], 'when': ['* ', 'Ketika '] },
  'is': { 'and': ['* ', 'Og '], 'background': ['Bakgrunnur'], 'but': ['* ', 'En '], 'examples': ['Dæmi', 'Atburðarásir'], 'feature': ['Eiginleiki'], 'given': ['* ', 'Ef '], 'name': 'Icelandic', 'native': 'Íslenska', 'rule': ['Rule'], 'scenario': ['Atburðarás'], 'scenario_outline': ['Lýsing Atburðarásar', 'Lýsing Dæma'], 'then': ['* ', 'Þá '], 'when': ['* ', 'Þegar '] },
  'it': { 'and': ['* ', 'E ', 'Ed '], 'background': ['Contesto'], 'but': ['* ', 'Ma '], 'examples': ['Esempi'], 'feature': ['Funzionalità', 'Esigenza di Business', 'Abilità'], 'given': ['* ', 'Dato ', 'Data ', 'Dati ', 'Date '], 'name': 'Italian', 'native': 'italiano', 'rule': ['Regola'], 'scenario': ['Esempio', 'Scenario'], 'scenario_outline': ['Schema dello scenario'], 'then': ['* ', 'Allora '], 'when': ['* ', 'Quando '] },
  'ja': { 'and': ['* ', '且つ', 'かつ'], 'background': ['背景'], 'but': ['* ', '然し', 'しかし', '但し', 'ただし'], 'examples': ['例', 'サンプル'], 'feature': ['フィーチャ', '機能'], 'given': ['* ', '前提'], 'name': 'Japanese', 'native': '日本語', 'rule': ['ルール'], 'scenario': ['シナリオ'], 'scenario_outline': ['シナリオアウトライン', 'シナリオテンプレート', 'テンプレ', 'シナリオテンプレ'], 'then': ['* ', 'ならば'], 'when': ['* ', 'もし'] },
  'jv': { 'and': ['* ', 'Lan '], 'background': ['Dasar'], 'but': ['* ', 'Tapi ', 'Nanging ', 'Ananging '], 'examples': ['Conto', 'Contone'], 'feature': ['Fitur'], 'given': ['* ', 'Nalika ', 'Nalikaning '], 'name': 'Javanese', 'native': 'Basa Jawa', 'rule': ['Rule'], 'scenario': ['Skenario'], 'scenario_outline': ['Konsep skenario'], 'then': ['* ', 'Njuk ', 'Banjur '], 'when': ['* ', 'Manawa ', 'Menawa '] },
  'ka': { 'and': ['* ', 'და ', 'ასევე '], 'background': ['კონტექსტი'], 'but': ['* ', 'მაგრამ ', 'თუმცა '], 'examples': ['მაგალითები'], 'feature': ['თვისება', 'მოთხოვნა'], 'given': ['* ', 'მოცემული ', 'მოცემულია ', 'ვთქვათ '], 'name': 'Georgian', 'native': 'ქართული', 'rule': ['წესი'], 'scenario': ['მაგალითად', 'მაგალითი', 'მაგ', 'სცენარი'], 'scenario_outline': ['სცენარის ნიმუში', 'სცენარის შაბლონი', 'ნიმუში', 'შაბლონი'], 'then': ['* ', 'მაშინ '], 'when': ['* ', 'როდესაც ', 'როცა ', 'როგორც კი ', 'თუ '] },
  'kn': { 'and': ['* ', 'ಮತ್ತು '], 'background': ['ಹಿನ್ನೆಲೆ'], 'but': ['* ', 'ಆದರೆ '], 'examples': ['ಉದಾಹರಣೆಗಳು'], 'feature': ['ಹೆಚ್ಚಳ'], 'given': ['* ', 'ನೀಡಿದ '], 'name': 'Kannada', 'native': 'ಕನ್ನಡ', 'rule': ['Rule'], 'scenario': ['ಉದಾಹರಣೆ', 'ಕಥಾಸಾರಾಂಶ'], 'scenario_outline': ['ವಿವರಣೆ'], 'then': ['* ', 'ನಂತರ '], 'when': ['* ', 'ಸ್ಥಿತಿಯನ್ನು '] },
  'ko': { 'and': ['* ', '그리고 '], 'background': ['배경'], 'but': ['* ', '하지만 ', '단 '], 'examples': ['예'], 'feature': ['기능'], 'given': ['* ', '조건 ', '먼저 '], 'name': 'Korean', 'native': '한국어', 'rule': ['Rule'], 'scenario': ['시나리오'], 'scenario_outline': ['시나리오 개요'], 'then': ['* ', '그러면 '], 'when': ['* ', '만일 ', '만약 '] },
  'lt': { 'and': ['* ', 'Ir '], 'background': ['Kontekstas'], 'but': ['* ', 'Bet '], 'examples': ['Pavyzdžiai', 'Scenarijai', 'Variantai'], 'feature': ['Savybė'], 'given': ['* ', 'Duota '], 'name': 'Lithuanian', 'native': 'lietuvių kalba', 'rule': ['Rule'], 'scenario': ['Pavyzdys', 'Scenarijus'], 'scenario_outline': ['Scenarijaus šablonas'], 'then': ['* ', 'Tada '], 'when': ['* ', 'Kai '] },
  'lu': { 'and': ['* ', 'an ', 'a '], 'background': ['Hannergrond'], 'but': ['* ', 'awer ', 'mä '], 'examples': ['Beispiller'], 'feature': ['Funktionalitéit'], 'given': ['* ', 'ugeholl '], 'name': 'Luxemburgish', 'native': 'Lëtzebuergesch', 'rule': ['Rule'], 'scenario': ['Beispill', 'Szenario'], 'scenario_outline': ['Plang vum Szenario'], 'then': ['* ', 'dann '], 'when': ['* ', 'wann '] },
  'lv': { 'and': ['* ', 'Un '], 'background': ['Konteksts', 'Situācija'], 'but': ['* ', 'Bet '], 'examples': ['Piemēri', 'Paraugs'], 'feature': ['Funkcionalitāte', 'Fīča'], 'given': ['* ', 'Kad '], 'name': 'Latvian', 'native': 'latviešu', 'rule': ['Rule'], 'scenario': ['Piemērs', 'Scenārijs'], 'scenario_outline': ['Scenārijs pēc parauga'], 'then': ['* ', 'Tad '], 'when': ['* ', 'Ja '] },
  'mk-Cyrl': { 'and': ['* ', 'И '], 'background': ['Контекст', 'Содржина'], 'but': ['* ', 'Но '], 'examples': ['Примери', 'Сценарија'], 'feature': ['Функционалност', 'Бизнис потреба', 'Можност'], 'given': ['* ', 'Дадено ', 'Дадена '], 'name': 'Macedonian', 'native': 'Македонски', 'rule': ['Rule'], 'scenario': ['Пример', 'Сценарио', 'На пример'], 'scenario_outline': ['Преглед на сценарија', 'Скица', 'Концепт'], 'then': ['* ', 'Тогаш '], 'when': ['* ', 'Кога '] },
  'mk-Latn': { 'and': ['* ', 'I '], 'background': ['Kontekst', 'Sodrzhina'], 'but': ['* ', 'No '], 'examples': ['Primeri', 'Scenaria'], 'feature': ['Funkcionalnost', 'Biznis potreba', 'Mozhnost'], 'given': ['* ', 'Dadeno ', 'Dadena '], 'name': 'Macedonian (Latin)', 'native': 'Makedonski (Latinica)', 'rule': ['Rule'], 'scenario': ['Scenario', 'Na primer'], 'scenario_outline': ['Pregled na scenarija', 'Skica', 'Koncept'], 'then': ['* ', 'Togash '], 'when': ['* ', 'Koga '] },
  'ml': { 'and': ['* ', 'ഒപ്പം'], 'background': ['പശ്ചാത്തലം'], 'but': ['* ', 'പക്ഷേ'], 'examples': ['ഉദാഹരണങ്ങൾ'], 'feature': ['സവിശേഷത'], 'given': ['* ', 'നൽകിയത്'], 'name': 'Malayalam', 'native': 'മലയാളം', 'rule': ['നിയമം'], 'scenario': ['രംഗം'], 'scenario_outline': ['സാഹചര്യത്തിന്റെ രൂപരേഖ'], 'then': ['* ', 'പിന്നെ'], 'when': ['എപ്പോൾ'] },
  'mn': { 'and': ['* ', 'Мөн ', 'Тэгээд '], 'background': ['Агуулга'], 'but': ['* ', 'Гэхдээ ', 'Харин '], 'examples': ['Тухайлбал'], 'feature': ['Функц', 'Функционал'], 'given': ['* ', 'Өгөгдсөн нь ', 'Анх '], 'name': 'Mongolian', 'native': 'монгол', 'rule': ['Rule'], 'scenario': ['Сценар'], 'scenario_outline': ['Сценарын төлөвлөгөө'], 'then': ['* ', 'Тэгэхэд ', 'Үүний дараа '], 'when': ['* ', 'Хэрэв '] },
  'mr': { 'and': ['* ', 'आणि ', 'तसेच '], 'background': ['पार्श्वभूमी'], 'but': ['* ', 'पण ', 'परंतु '], 'examples': ['उदाहरण'], 'feature': ['वैशिष्ट्य', 'सुविधा'], 'given': ['* ', 'जर', 'दिलेल्या प्रमाणे '], 'name': 'Marathi', 'native': 'मराठी', 'rule': ['नियम'], 'scenario': ['परिदृश्य'], 'scenario_outline': ['परिदृश्य रूपरेखा'], 'then': ['* ', 'मग ', 'तेव्हा '], 'when': ['* ', 'जेव्हा '] },
  'ne': { 'and': ['* ', 'र ', 'अनि '], 'background': ['पृष्ठभूमी'], 'but': ['* ', 'तर '], 'examples': ['उदाहरण', 'उदाहरणहरु'], 'feature': ['सुविधा', 'विशेषता'], 'given': ['* ', 'दिइएको ', 'दिएको ', 'यदि '], 'name': 'Nepali', 'native': 'नेपाली', 'rule': ['नियम'], 'scenario': ['परिदृश्य'], 'scenario_outline': ['परिदृश्य रूपरेखा'], 'then': ['* ', 'त्यसपछि ', 'अनी '], 'when': ['* ', 'जब '] },
  'nl': { 'and': ['* ', 'En '], 'background': ['Achtergrond'], 'but': ['* ', 'Maar '], 'examples': ['Voorbeelden'], 'feature': ['Functionaliteit'], 'given': ['* ', 'Gegeven ', 'Stel '], 'name': 'Dutch', 'native': 'Nederlands', 'rule': ['Regel'], 'scenario': ['Voorbeeld', 'Scenario'], 'scenario_outline': ['Abstract Scenario'], 'then': ['* ', 'Dan '], 'when': ['* ', 'Als ', 'Wanneer '] },
  'no': { 'and': ['* ', 'Og '], 'background': ['Bakgrunn'], 'but': ['* ', 'Men '], 'examples': ['Eksempler'], 'feature': ['Egenskap'], 'given': ['* ', 'Gitt '], 'name': 'Norwegian', 'native': 'norsk', 'rule': ['Regel'], 'scenario': ['Eksempel', 'Scenario'], 'scenario_outline': ['Scenariomal', 'Abstrakt Scenario'], 'then': ['* ', 'Så '], 'when': ['* ', 'Når '] },
  'pa': { 'and': ['* ', 'ਅਤੇ '], 'background': ['ਪਿਛੋਕੜ'], 'but': ['* ', 'ਪਰ '], 'examples': ['ਉਦਾਹਰਨਾਂ'], 'feature': ['ਖਾਸੀਅਤ', 'ਮੁਹਾਂਦਰਾ', 'ਨਕਸ਼ ਨੁਹਾਰ'], 'given': ['* ', 'ਜੇਕਰ ', 'ਜਿਵੇਂ ਕਿ '], 'name': 'Panjabi', 'native': 'ਪੰਜਾਬੀ', 'rule': ['Rule'], 'scenario': ['ਉਦਾਹਰਨ', 'ਪਟਕਥਾ'], 'scenario_outline': ['ਪਟਕਥਾ ਢਾਂਚਾ', 'ਪਟਕਥਾ ਰੂਪ ਰੇਖਾ'], 'then': ['* ', 'ਤਦ '], 'when': ['* ', 'ਜਦੋਂ '] },
  'pl': { 'and': ['* ', 'Oraz ', 'I '], 'background': ['Założenia'], 'but': ['* ', 'Ale '], 'examples': ['Przykłady'], 'feature': ['Właściwość', 'Funkcja', 'Aspekt', 'Potrzeba biznesowa'], 'given': ['* ', 'Zakładając ', 'Mając ', 'Zakładając, że '], 'name': 'Polish', 'native': 'polski', 'rule': ['Zasada', 'Reguła'], 'scenario': ['Przykład', 'Scenariusz'], 'scenario_outline': ['Szablon scenariusza'], 'then': ['* ', 'Wtedy '], 'when': ['* ', 'Jeżeli ', 'Jeśli ', 'Gdy ', 'Kiedy '] },
  'pt': { 'and': ['* ', 'E '], 'background': ['Contexto', 'Cenário de Fundo', 'Cenario de Fundo', 'Fundo'], 'but': ['* ', 'Mas '], 'examples': ['Exemplos', 'Cenários', 'Cenarios'], 'feature': ['Funcionalidade', 'Característica', 'Caracteristica'], 'given': ['* ', 'Dado ', 'Dada ', 'Dados ', 'Dadas '], 'name': 'Portuguese', 'native': 'português', 'rule': ['Regra'], 'scenario': ['Exemplo', 'Cenário', 'Cenario'], 'scenario_outline': ['Esquema do Cenário', 'Esquema do Cenario', 'Delineação do Cenário', 'Delineacao do Cenario'], 'then': ['* ', 'Então ', 'Entao '], 'when': ['* ', 'Quando '] },
  'ro': { 'and': ['* ', 'Si ', 'Și ', 'Şi '], 'background': ['Context'], 'but': ['* ', 'Dar '], 'examples': ['Exemple'], 'feature': ['Functionalitate', 'Funcționalitate', 'Funcţionalitate'], 'given': ['* ', 'Date fiind ', 'Dat fiind ', 'Dată fiind', 'Dati fiind ', 'Dați fiind ', 'Daţi fiind '], 'name': 'Romanian', 'native': 'română', 'rule': ['Rule'], 'scenario': ['Exemplu', 'Scenariu'], 'scenario_outline': ['Structura scenariu', 'Structură scenariu'], 'then': ['* ', 'Atunci '], 'when': ['* ', 'Cand ', 'Când '] },
  'ru': { 'and': ['* ', 'И ', 'К тому же ', 'Также '], 'background': ['Предыстория', 'Контекст'], 'but': ['* ', 'Но ', 'А ', 'Иначе '], 'examples': ['Примеры'], 'feature': ['Функция', 'Функциональность', 'Функционал', 'Свойство', 'Фича'], 'given': ['* ', 'Допустим ', 'Дано ', 'Пусть '], 'name': 'Russian', 'native': 'русский', 'rule': ['Правило'], 'scenario': ['Пример', 'Сценарий'], 'scenario_outline': ['Структура сценария', 'Шаблон сценария'], 'then': ['* ', 'То ', 'Затем ', 'Тогда '], 'when': ['* ', 'Когда ', 'Если '] },
  'sk': { 'and': ['* ', 'A ', 'A tiež ', 'A taktiež ', 'A zároveň '], 'background': ['Pozadie'], 'but': ['* ', 'Ale '], 'examples': ['Príklady'], 'feature': ['Požiadavka', 'Funkcia', 'Vlastnosť'], 'given': ['* ', 'Pokiaľ ', 'Za predpokladu '], 'name': 'Slovak', 'native': 'Slovensky', 'rule': ['Rule'], 'scenario': ['Príklad', 'Scenár'], 'scenario_outline': ['Náčrt Scenáru', 'Náčrt Scenára', 'Osnova Scenára'], 'then': ['* ', 'Tak ', 'Potom '], 'when': ['* ', 'Keď ', 'Ak '] },
  'sl': { 'and': ['In ', 'Ter '], 'background': ['Kontekst', 'Osnova', 'Ozadje'], 'but': ['Toda ', 'Ampak ', 'Vendar '], 'examples': ['Primeri', 'Scenariji'], 'feature': ['Funkcionalnost', 'Funkcija', 'Možnosti', 'Moznosti', 'Lastnost', 'Značilnost'], 'given': ['Dano ', 'Podano ', 'Zaradi ', 'Privzeto '], 'name': 'Slovenian', 'native': 'Slovenski', 'rule': ['Rule'], 'scenario': ['Primer', 'Scenarij'], 'scenario_outline': ['Struktura scenarija', 'Skica', 'Koncept', 'Oris scenarija', 'Osnutek'], 'then': ['Nato ', 'Potem ', 'Takrat '], 'when': ['Ko ', 'Ce ', 'Če ', 'Kadar '] },
  'sr-Cyrl': { 'and': ['* ', 'И '], 'background': ['Контекст', 'Основа', 'Позадина'], 'but': ['* ', 'Али '], 'examples': ['Примери', 'Сценарији'], 'feature': ['Функционалност', 'Могућност', 'Особина'], 'given': ['* ', 'За дато ', 'За дате ', 'За дати '], 'name': 'Serbian', 'native': 'Српски', 'rule': ['Правило'], 'scenario': ['Сценарио', 'Пример'], 'scenario_outline': ['Структура сценарија', 'Скица', 'Концепт'], 'then': ['* ', 'Онда '], 'when': ['* ', 'Када ', 'Кад '] },
  'sr-Latn': { 'and': ['* ', 'I '], 'background': ['Kontekst', 'Osnova', 'Pozadina'], 'but': ['* ', 'Ali '], 'examples': ['Primeri', 'Scenariji'], 'feature': ['Funkcionalnost', 'Mogućnost', 'Mogucnost', 'Osobina'], 'given': ['* ', 'Za dato ', 'Za date ', 'Za dati '], 'name': 'Serbian (Latin)', 'native': 'Srpski (Latinica)', 'rule': ['Pravilo'], 'scenario': ['Scenario', 'Primer'], 'scenario_outline': ['Struktura scenarija', 'Skica', 'Koncept'], 'then': ['* ', 'Onda '], 'when': ['* ', 'Kada ', 'Kad '] },
  'sv': { 'and': ['* ', 'Och '], 'background': ['Bakgrund'], 'but': ['* ', 'Men '], 'examples': ['Exempel'], 'feature': ['Egenskap'], 'given': ['* ', 'Givet '], 'name': 'Swedish', 'native': 'Svenska', 'rule': ['Regel'], 'scenario': ['Scenario'], 'scenario_outline': ['Abstrakt Scenario', 'Scenariomall'], 'then': ['* ', 'Så '], 'when': ['* ', 'När '] },
  'ta': { 'and': ['* ', 'மேலும் ', 'மற்றும் '], 'background': ['பின்னணி'], 'but': ['* ', 'ஆனால் '], 'examples': ['எடுத்துக்காட்டுகள்', 'காட்சிகள்', 'நிலைமைகளில்'], 'feature': ['அம்சம்', 'வணிக தேவை', 'திறன்'], 'given': ['* ', 'கொடுக்கப்பட்ட '], 'name': 'Tamil', 'native': 'தமிழ்', 'rule': ['Rule'], 'scenario': ['உதாரணமாக', 'காட்சி'], 'scenario_outline': ['காட்சி சுருக்கம்', 'காட்சி வார்ப்புரு'], 'then': ['* ', 'அப்பொழுது '], 'when': ['* ', 'எப்போது '] },
  'te': { 'and': ['* ', 'మరియు '], 'background': ['నేపథ్యం'], 'but': ['* ', 'కాని '], 'examples': ['ఉదాహరణలు'], 'feature': ['గుణము'], 'given': ['* ', 'చెప్పబడినది '], 'name': 'Telugu', 'native': 'తెలుగు', 'rule': ['Rule'], 'scenario': ['ఉదాహరణ', 'సన్నివేశం'], 'scenario_outline': ['కథనం'], 'then': ['* ', 'అప్పుడు '], 'when': ['* ', 'ఈ పరిస్థితిలో '] },
  'th': { 'and': ['* ', 'และ '], 'background': ['แนวคิด'], 'but': ['* ', 'แต่ '], 'examples': ['ชุดของตัวอย่าง', 'ชุดของเหตุการณ์'], 'feature': ['โครงหลัก', 'ความต้องการทางธุรกิจ', 'ความสามารถ'], 'given': ['* ', 'กำหนดให้ '], 'name': 'Thai', 'native': 'ไทย', 'rule': ['Rule'], 'scenario': ['เหตุการณ์'], 'scenario_outline': ['สรุปเหตุการณ์', 'โครงสร้างของเหตุการณ์'], 'then': ['* ', 'ดังนั้น '], 'when': ['* ', 'เมื่อ '] },
  'tlh': { 'and': ['* ', "'ej ", 'latlh '], 'background': ["mo'"], 'but': ['* ', "'ach ", "'a "], 'examples': ['ghantoH', 'lutmey'], 'feature': ['Qap', "Qu'meH 'ut", 'perbogh', "poQbogh malja'", 'laH'], 'given': ['* ', "ghu' noblu' ", "DaH ghu' bejlu' "], 'name': 'Klingon', 'native': 'tlhIngan', 'rule': ['Rule'], 'scenario': ['lut'], 'scenario_outline': ['lut chovnatlh'], 'then': ['* ', 'vaj '], 'when': ['* ', "qaSDI' "] },
  'tr': { 'and': ['* ', 'Ve '], 'background': ['Geçmiş'], 'but': ['* ', 'Fakat ', 'Ama '], 'examples': ['Örnekler'], 'feature': ['Özellik'], 'given': ['* ', 'Diyelim ki '], 'name': 'Turkish', 'native': 'Türkçe', 'rule': ['Kural'], 'scenario': ['Örnek', 'Senaryo'], 'scenario_outline': ['Senaryo taslağı'], 'then': ['* ', 'O zaman '], 'when': ['* ', 'Eğer ki '] },
  'tt': { 'and': ['* ', 'Һәм ', 'Вә '], 'background': ['Кереш'], 'but': ['* ', 'Ләкин ', 'Әмма '], 'examples': ['Үрнәкләр', 'Мисаллар'], 'feature': ['Мөмкинлек', 'Үзенчәлеклелек'], 'given': ['* ', 'Әйтик '], 'name': 'Tatar', 'native': 'Татарча', 'rule': ['Rule'], 'scenario': ['Сценарий'], 'scenario_outline': ['Сценарийның төзелеше'], 'then': ['* ', 'Нәтиҗәдә '], 'when': ['* ', 'Әгәр '] },
  'uk': { 'and': ['* ', 'І ', 'А також ', 'Та '], 'background': ['Передумова'], 'but': ['* ', 'Але '], 'examples': ['Приклади'], 'feature': ['Функціонал'], 'given': ['* ', 'Припустимо ', 'Припустимо, що ', 'Нехай ', 'Дано '], 'name': 'Ukrainian', 'native': 'Українська', 'rule': ['Rule'], 'scenario': ['Приклад', 'Сценарій'], 'scenario_outline': ['Структура сценарію'], 'then': ['* ', 'То ', 'Тоді '], 'when': ['* ', 'Якщо ', 'Коли '] },
  'ur': { 'and': ['* ', 'اور '], 'background': ['پس منظر'], 'but': ['* ', 'لیکن '], 'examples': ['مثالیں'], 'feature': ['صلاحیت', 'کاروبار کی ضرورت', 'خصوصیت'], 'given': ['* ', 'اگر ', 'بالفرض ', 'فرض کیا '], 'name': 'Urdu', 'native': 'اردو', 'rule': ['Rule'], 'scenario': ['منظرنامہ'], 'scenario_outline': ['منظر نامے کا خاکہ'], 'then': ['* ', 'پھر ', 'تب '], 'when': ['* ', 'جب '] },
  'uz': { 'and': ['* ', 'Ва '], 'background': ['Тарих'], 'but': ['* ', 'Лекин ', 'Бирок ', 'Аммо '], 'examples': ['Мисоллар'], 'feature': ['Функционал'], 'given': ['* ', 'Belgilangan '], 'name': 'Uzbek', 'native': 'Узбекча', 'rule': ['Rule'], 'scenario': ['Сценарий'], 'scenario_outline': ['Сценарий структураси'], 'then': ['* ', 'Унда '], 'when': ['* ', 'Агар '] },
  'vi': { 'and': ['* ', 'Và '], 'background': ['Bối cảnh'], 'but': ['* ', 'Nhưng '], 'examples': ['Dữ liệu'], 'feature': ['Tính năng'], 'given': ['* ', 'Biết ', 'Cho '], 'name': 'Vietnamese', 'native': 'Tiếng Việt', 'rule': ['Quy tắc'], 'scenario': ['Tình huống', 'Kịch bản'], 'scenario_outline': ['Khung tình huống', 'Khung kịch bản'], 'then': ['* ', 'Thì '], 'when': ['* ', 'Khi '] },
  'zh-CN': { 'and': ['* ', '而且', '并且', '同时'], 'background': ['背景'], 'but': ['* ', '但是'], 'examples': ['例子'], 'feature': ['功能'], 'given': ['* ', '假如', '假设', '假定'], 'name': 'Chinese simplified', 'native': '简体中文', 'rule': ['Rule', '规则'], 'scenario': ['场景', '剧本'], 'scenario_outline': ['场景大纲', '剧本大纲'], 'then': ['* ', '那么'], 'when': ['* ', '当'] },
  'zh-TW': { 'and': ['* ', '而且', '並且', '同時'], 'background': ['背景'], 'but': ['* ', '但是'], 'examples': ['例子'], 'feature': ['功能'], 'given': ['* ', '假如', '假設', '假定'], 'name': 'Chinese traditional', 'native': '繁體中文', 'rule': ['Rule'], 'scenario': ['場景', '劇本'], 'scenario_outline': ['場景大綱', '劇本大綱'], 'then': ['* ', '那麼'], 'when': ['* ', '當'] }
};

/**
 * Singleton instance of the language registry
 */
class LanguageRegistryImpl {
  private static instance: LanguageRegistryImpl;
  private registry: LanguageRegistry;
  private keywordToLanguageMap: Map<string, Set<string>>;

  private constructor() {
    this.registry = {};
    this.keywordToLanguageMap = new Map();
    this.loadLanguages();
    this.buildKeywordIndex();
  }

  public static getInstance(): LanguageRegistryImpl {
    if (!LanguageRegistryImpl.instance) {
      LanguageRegistryImpl.instance = new LanguageRegistryImpl();
    }
    return LanguageRegistryImpl.instance;
  }

  private loadLanguages(): void {
    for (const [code, data] of Object.entries(LANGUAGES_DATA)) {
      const keywords: GherkinKeywords = {
        feature: data.feature ?? [],
        scenario: data.scenario ?? [],
        scenario_outline: data.scenario_outline ?? [],
        background: data.background ?? [],
        examples: data.examples ?? [],
        given: data.given ?? [],
        when: data.when ?? [],
        then: data.then ?? [],
        and: data.and ?? [],
        but: data.but ?? []
      };
      
      if (data.rule !== undefined) {
        keywords.rule = data.rule;
      }
      
      this.registry[code] = {
        code,
        name: data.name,
        native: data.native,
        keywords
      };
    }
  }

  private buildKeywordIndex(): void {
    for (const [langCode, langInfo] of Object.entries(this.registry)) {
      const allKeywords = [
        ...langInfo.keywords.feature,
        ...langInfo.keywords.scenario,
        ...langInfo.keywords.scenario_outline,
        ...langInfo.keywords.background,
        ...langInfo.keywords.examples,
        ...langInfo.keywords.given,
        ...langInfo.keywords.when,
        ...langInfo.keywords.then,
        ...langInfo.keywords.and,
        ...langInfo.keywords.but,
        ...(langInfo.keywords.rule ?? [])
      ];

      for (const keyword of allKeywords) {
        const normalized = keyword.trim().toLowerCase();
        if (normalized && normalized !== '*') {
          const languageSet = this.keywordToLanguageMap.get(normalized);
          if (!languageSet) {
            this.keywordToLanguageMap.set(normalized, new Set([langCode]));
          } else {
            languageSet.add(langCode);
          }
        }
      }
    }
  }

  public getLanguage(languageCode: string): LanguageInfo | undefined {
    return this.registry[languageCode];
  }

  public getAllLanguages(): LanguageRegistry {
    return { ...this.registry };
  }

  public getLanguageCodes(): string[] {
    return Object.keys(this.registry);
  }

  public findLanguagesByKeyword(keyword: string): string[] {
    const normalized = keyword.trim().toLowerCase();
    const languages = this.keywordToLanguageMap.get(normalized);
    return languages ? Array.from(languages) : [];
  }

  public isValidLanguageCode(code: string): boolean {
    return code in this.registry;
  }

  public getKeywordsForLanguage(languageCode: string): GherkinKeywords | undefined {
    const lang = this.registry[languageCode];
    return lang?.keywords;
  }
}

export const getLanguageRegistry = (): LanguageRegistryImpl => {
  return LanguageRegistryImpl.getInstance();
};

export { LanguageRegistryImpl };
