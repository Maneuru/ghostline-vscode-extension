# Ghostline

Suggerimenti inline (testo grigio, si accetta con Tab) per VS Code con il modello che scegli tu. Nessun account e nessuna telemetria: l'unica richiesta di rete va al server che indichi.

Per ora è disponibile il provider **Ollama**. L'architettura è pensata per aggiungerne altri.

## Requisiti

- Un server raggiungibile, per Ollama `ollama serve`
- Un modello con supporto al fill-in-the-middle, per esempio `ollama pull qwen2.5-coder:1.5b`
- VS Code 1.90 o successivo

## Installazione

```
code --install-extension ghostline-0.1.0.vsix
```

Se avevi installato la versione precedente con il nome `ollama-inline`, disinstallala: le sue impostazioni (`ollamaInline.*`) non vengono migrate.

## Uso

I suggerimenti compaiono mentre scrivi, dopo una breve pausa. Per forzarne uno usa `Alt+\` (comando "Trigger Inline Suggestion").

| Comando | Effetto |
| --- | --- |
| Ghostline: Attiva/Disattiva suggerimenti | Alterna l'estensione (anche con clic sulla barra di stato) |
| Ghostline: Scegli modello | Elenca i modelli del server e salva la scelta |
| Ghostline: Mostra log | Apre il canale di output con gli errori |

## Impostazioni

Sotto `ghostline.*`: `enabled`, `provider`, `endpoint`, `model`, `debounceMs`, `maxTokens`, `temperature`, `prefixChars`, `suffixChars`, `timeoutMs`, `multiline`, `disabledLanguages`. Le impostazioni di un singolo provider stanno sotto il suo nome, per esempio `ghostline.ollama.keepAlive`.

Per la latenza conta più la dimensione del modello che la qualità: parti da un modello da 1,5B a 3B e sali solo se la velocità regge.

## Aggiungere un provider

1. Crea `src/providers/<nome>.ts` con una classe che implementa `CompletionProvider` (`complete` e `listModels`).
2. Registrala nell'elenco `providers` in `src/extension.ts`.
3. Aggiungi il suo id all'`enum` di `ghostline.provider` in `package.json`.

Le impostazioni specifiche vanno nel namespace `ghostline.<nome>.*`.

## Sviluppo

```
npm install
npm run compile
npm run package
```

Per il debug apri la cartella in VS Code e premi F5.
