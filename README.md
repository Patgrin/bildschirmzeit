# Bildschirmzeit – Family-Safety-Berichte auf dem iPhone

Web-App (PWA) ohne App Store. Liest die wöchentlichen Microsoft-Family-Safety-Mails aus einem
Outlook-Ordner, trägt die Tage automatisch in eine Timeline ein, berücksichtigt die Schulferien in
Oberösterreich und zeigt den Verlauf seit November 2025.

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. App online stellen (GitHub Pages, kostenlos)
1. Auf github.com ein Konto anlegen und ein **neues öffentliches Repository** erstellen, z. B. `bildschirmzeit`.
2. „Add file → Upload files“ → den **Inhalt** dieses Ordners hochladen (index.html, style.css, sw.js,
   manifest.webmanifest, Ordner `js` und `icons`) → „Commit changes“.
3. Settings → Pages → Source: „Deploy from a branch“, Branch `main`, Ordner `/ (root)` → Save.
4. Nach 1–2 Minuten ist die App erreichbar unter `https://<benutzername>.github.io/bildschirmzeit/`.

Im Code stehen keine persönlichen Daten. Client-ID, Zugangsdaten und Bildschirmzeiten liegen nur auf dem iPhone.

### 2. App bei Microsoft registrieren (für den Outlook-Zugriff)
1. https://entra.microsoft.com mit dem Outlook-Konto öffnen
   (falls dort kein Verzeichnis vorhanden ist: unter https://azure.microsoft.com ein kostenloses Konto
   anlegen – es entstehen keine Kosten).
2. **App-Registrierungen → Neue Registrierung**
   - Name: `Bildschirmzeit`
   - Unterstützte Kontotypen: **„Nur persönliche Microsoft-Konten“**
     (oder „Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten“)
   - Umleitungs-URI: Plattform **„Single-Page-Anwendung (SPA)“**, URL = die GitHub-Pages-Adresse
     **mit Schrägstrich am Ende**, z. B. `https://<benutzername>.github.io/bildschirmzeit/`
3. **API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph → Delegierte Berechtigungen**:
   `Mail.Read`, `User.Read`, `offline_access` (nur Lesezugriff).
4. Auf der Übersichtsseite die **Anwendungs-ID (Client-ID)** kopieren.

### 3. Auf dem iPhone installieren
1. Die GitHub-Pages-Adresse in **Safari** öffnen.
2. Teilen-Symbol → **„Zum Home-Bildschirm“**.
3. App vom Home-Bildschirm starten → **Einstellungen**:
   - Client-ID einfügen → „Bei Microsoft anmelden“
   - „Ordner auswählen“ → den Outlook-Ordner mit den Family-Safety-Mails wählen
   - optional den Namen des Sohnes eintragen (falls Berichte für mehrere Kinder im Ordner liegen)

## Wie es arbeitet
- **Automatisches Eintragen:** Bei jedem Öffnen (höchstens alle 20 Min.) sucht die App im Ordner nach
  neuen Berichten und trägt sie ein. Microsoft begrenzt Anmeldungen von Web-Apps auf 24 Stunden; die
  App erneuert sie dann selbst mit einem kurzen Umweg über die Microsoft-Seite, normalerweise ohne Eingabe.
- **Duplikate:** Jede Mail wird nur einmal verarbeitet (Message-ID), inhaltlich gleiche Berichte
  (z. B. weitergeleitete Kopien) werden erkannt und jeder Tag existiert nur einmal. Vorrang hat
  manuell > Tageswert aus Mail > geschätzter Wert.
- **Ferien OÖ:** Sommer-, Herbst-, Weihnachts-, Semester- (3. Februarwoche), Oster- und Pfingstferien
  sowie 8.12., 1.5., 4.5. (Hl. Florian), Christi Himmelfahrt und Fronleichnam werden nach dem
  Schulzeitgesetz für jedes Jahr berechnet. Schulautonome Tage in den Einstellungen ergänzen.
- **Fehlende Tageswerte:** Enthält eine Mail nur Summe/Durchschnitt der Woche, werden die Tage
  geschätzt (≈) und später durch genauere Werte ersetzt. Jeden Tag kannst du antippen und korrigieren.
- **Updates:** Neue Versionen einfach erneut ins Repository hochladen. Die App lädt beim nächsten
  Öffnen automatisch die neue Version (Service Worker „Netzwerk zuerst“). Offline zeigt sie die zuletzt
  geladenen Daten.
- **Sicherung:** Einstellungen → „Sicherung exportieren“ (JSON) – empfehlenswert ab und zu.

## Falls Mails „nicht erkannt“ werden
Einstellungen → „Verarbeitete E-Mails“ → „Rohtext anzeigen“. Den Text in „Erkennung testen“
prüfen; die Erkennung steckt in `js/parser.js`. Danach „Neu aus Outlook einlesen“.
