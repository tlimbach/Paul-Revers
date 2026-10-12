# Paul Revers

Ein kleines JavaScript-Stimmenlabor für Kinder: Stimme aufnehmen, vorwärts oder rückwärts abspielen und mit Tempo und Tonhöhe experimentieren.

## Starten

Voraussetzung: Node.js ab Version 18. Keine zusätzlichen Pakete nötig.

```sh
npm start
```

Im Browser **http://localhost:3000** öffnen. Auf „Aufnahme starten“ drücken und den Mikrofonzugriff erlauben. Nach der Aufnahme startet „Vorwärts“ oder „Rückwärts“ direkt die Wiedergabe. Erneutes Tippen auf die aktive Richtung stoppt sie; die andere Richtung startet von vorn. Nach höchstens 60 Sekunden endet die Aufnahme automatisch. Eine neue erfolgreiche Aufnahme ersetzt die vorherige. Beim Schließen oder Neuladen verschwindet die Aufnahme.

Das Mikrofon funktioniert über localhost oder HTTPS. Für eine spätere Veröffentlichung ist HTTPS erforderlich; direktes Öffnen der HTML-Datei ist nicht vorgesehen. Die App verwendet AudioWorklet und die Web Audio API und richtet sich an aktuelle Browser mit diesen Funktionen.

## Was passiert mit den Daten?

Die Aufnahme bleibt im Arbeitsspeicher des Browsers. Es gibt keine Uploads, Benutzerkonten, Analysewerkzeuge oder extern geladenen Ressourcen. Der lokale Server liefert ausschließlich die App-Dateien aus. Das Mikrofon wird nach der Aufnahme freigegeben.

## Aufbau für das Jahresprojekt

- `index.html`: Struktur, Beschriftungen und Bedienelemente.
- `style.css`: Farben, Maskottchen, Handyansicht und Animation.
- `app.js`: Mikrofon, Aufnahme, Wiedergabe und Wellenanzeige.
- `recorder-worklet.js`: direkte Aufnahme unkomprimierter Audiosamples ohne Codec-Konvertierung.
- `audio.js`: Umkehrung der Samples und Klangverarbeitung.
- `server.js`: kleiner lokaler Entwicklungsserver.
- `tests/audio.test.js`: automatisierte Prüfungen der Klangverarbeitung (`npm test`).

Testvariante: Ein gemeinsamer Regler steuert Tonhöhe und Tempo über die native `playbackRate` der Web Audio API. Höher bedeutet schneller, tiefer bedeutet langsamer (−12 bis +12 Halbtöne entsprechen 0,5–2×). Die Wiedergabe verwendet keine überlagerten Audioausschnitte mehr. Regleränderungen wirken direkt während der Wiedergabe, mit einem weichen Übergang von 30 Millisekunden. Der Abspielzeiger berücksichtigt die wechselnde Geschwindigkeit in beiden Richtungen. Der frühere Granular-Algorithmus in `audio.js` bleibt vorerst zum Vergleich im Quellcode erhalten, wird aber nicht verwendet.

## Mögliche Etappen

1. HTML und CSS verstehen und die Figur gestalten.
2. Mikrofonaufnahme und vorwärts gerichtete Wiedergabe erklären.
3. Arrays kennenlernen und Audiosamples rückwärts anordnen.
4. Tempo, Frequenz und Tonhöhe untersuchen.
5. Bedienung mit Kindern testen und verbessern.
6. Ergebnisse, Datenschutz und technische Grenzen dokumentieren.

## Hall und Verzerrung

Der Regler „Hall“ mischt die Originalstimme mit zwei langsam modulierten Stimmkopien und einem kurzen wandernden Echo. Links bleibt die Stimme unverändert, rechts entsteht ein schwebender Chorus-Klang. Ein Anteil Originalstimme bleibt auch bei voller Stärke erhalten. Es gibt keine Ringmodulation und keine Echo-Rückkopplung. Die Mischung wirkt live mit geglätteten Übergängen und funktioniert vorwärts wie rückwärts sowie mit dem Tempo-Regler. Der Zurücksetzen-Knopf setzt alle drei Regler zurück. Es werden keine zusätzlichen Pakete oder externen Dienste benötigt.

„Verzerrung“ mischt einen gesättigten, auf den Sprachbereich begrenzten Funkgeräte-Klang hinzu. Der Effekt liegt vor dem Hall und lässt sich unabhängig live dosieren. Bei beiden Effektreglern auf „Aus“ läuft die Stimme unverändert durch.

Beide Effektregler reichen bis 200 %. Bis 100 % bleibt die bisherige Mischung erhalten. Darüber wird der Hall bis vollständig nass, mit doppelten Verzögerungszeiten und doppelter Modulationstiefe. Die Verzerrung erhöht oberhalb von 100 % die Vorverstärkung vor der Sättigung bis auf das Vierfache; die Sättigungsgrenze bleibt gleich.

Die Verzerrung gleicht ihren Effektpegel blockweise an den RMS-Pegel der Originalstimme an. Der Ausgleich senkt nur ab, hebt Stille nicht an und wirkt auch bei Live-Änderungen. Gleicher Messpegel bedeutet wegen der zusätzlichen Obertöne nicht exakt gleiche subjektive Lautheit.
