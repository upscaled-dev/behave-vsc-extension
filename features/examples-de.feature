# language: de
# -*- coding: utf-8 -*-
"""
Beispiel einer Feature-Datei in deutscher Sprache zum Nachweis der Mehrsprachigkeit
Behave VSCode Extension
"""

Funktionalität: Benutzerkontoverwaltung
  Um mein Benutzerkonto zu verwalten
  Als Benutzer
  Möchte ich mein Profil aktualisieren und meine Kontodaten ändern können

  Hintergrund:
    Angenommen ich bin bei meinem Benutzerkonto angemeldet
    Und ich befinde mich auf der Seite "Kontoeinstellungen"
    Und alle Felder werden ordnungsgemäß geladen

  Szenario: Profilbild aktualisieren
    Angenommen mein aktuelles Profilbild ist "standard.jpg"
    Wenn ich auf "Profilbild hochladen" klicke
    Und ich wähle die Datei "new_profile.jpg" aus
    Und ich klicke auf "Speichern"
    Dann sollte mein Profilbild zu "new_profile.jpg" aktualisiert werden
    Und eine Erfolgsmeldung sollte angezeigt werden

  Szenario: Persönliche Informationen ändern
    Angenommen mein Vorname ist "Max"
    Und mein Nachname ist "Müller"
    Wenn ich das Feld "Vorname" zu "Maximilian" ändere
    Und ich das Feld "Nachname" zu "Meyer" ändere
    Und ich auf "Speichern" klicke
    Dann sollten meine persönlichen Informationen aktualisiert werden

  Szenario: Passwort ändern
    Angenommen ich befinde mich im Abschnitt "Sicherheit"
    Wenn ich auf "Passwort ändern" klicke
    Und ich gebe mein aktuelles Passwort ein
    Und ich gebe mein neues Passwort ein
    Und ich bestätige das neue Passwort
    Und ich klicke auf "Speichern"
    Dann sollte mein Passwort geändert werden
    Und ich sollte eine Bestätigungsemail erhalten

  Szenariogrundriss: Validierung von Benutzerdaten
    Angenommen ich befinde mich auf der Seite "Profil bearbeiten"
    Wenn ich das Feld "<feld>" mit "<wert>" ausfülle
    Und ich auf "Speichern" klicke
    Dann sollte "<nachricht>" angezeigt werden

    Beispiele:
      | feld         | wert           | nachricht                           |
      | Vorname      | Max            | Profil erfolgreich aktualisiert    |
      | Vorname      |                | Das Feld "Vorname" ist erforderlich |
      | E-Mail       | max@example    | Ungültige E-Mail-Adresse           |
      | E-Mail       | max@example.de | E-Mail aktualisiert                 |
      | Telefon      | +49123456789   | Telefon aktualisiert                |

  Szenario: E-Mail-Adresse ändern
    Angenommen meine aktuelle E-Mail-Adresse ist "max@example.com"
    Wenn ich auf "E-Mail-Adresse ändern" klicke
    Und ich gebe meine neue E-Mail-Adresse ein
    Und ich klicke auf "Bestätigungscode senden"
    Dann sollte eine E-Mail mit einem Bestätigungscode an die neue Adresse gesendet werden
    Und ich sollte aufgefordert werden, den Code einzugeben

  Szenario: Benachrichtigungseinstellungen anpassen
    Angenommen ich befinde mich in den "Benachrichtigungseinstellungen"
    Wenn ich die Option "E-Mail-Benachrichtigungen" deaktiviere
    Und ich die Option "SMS-Benachrichtigungen" aktiviere
    Und ich auf "Speichern" klicke
    Dann sollten meine Benachrichtigungseinstellungen aktualisiert werden
    Und ich sollte keine E-Mail-Benachrichtigungen mehr erhalten

  Szenario: Zwei-Faktor-Authentifizierung aktivieren
    Angenommen ich befinde mich im Abschnitt "Sicherheit"
    Wenn ich auf "Zwei-Faktor-Authentifizierung aktivieren" klicke
    Und ich einen Authentifizierungscode generiere
    Und ich den Code in meine Authentifizierungs-App eingebe
    Und ich auf "Verifizieren" klicke
    Dann sollte die Zwei-Faktor-Authentifizierung aktiviert sein
    Und ich sollte Backup-Codes erhalten
