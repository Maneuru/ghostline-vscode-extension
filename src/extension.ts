import * as vscode from 'vscode';
import { OllamaProvider } from './providers/ollama';
import { CompletionProvider } from './providers/types';

interface Config {
    enabled: boolean;
    provider: string;
    endpoint: string;
    model: string;
    debounceMs: number;
    maxTokens: number;
    temperature: number;
    prefixChars: number;
    suffixChars: number;
    timeoutMs: number;
    multiline: boolean;
    disabledLanguages: string[];
}

type Status = 'idle' | 'busy' | 'error';

const SECTION = 'ghostline';

const providers = new Map<string, CompletionProvider>(
    [new OllamaProvider()].map(provider => [provider.id, provider])
);

function readConfig(): Config {
    const c = vscode.workspace.getConfiguration(SECTION);
    return {
        enabled: c.get<boolean>('enabled', true),
        provider: c.get<string>('provider', 'ollama'),
        endpoint: c.get<string>('endpoint', 'http://localhost:11434').replace(/\/+$/, ''),
        model: c.get<string>('model', 'qwen2.5-coder:1.5b'),
        debounceMs: c.get<number>('debounceMs', 300),
        maxTokens: c.get<number>('maxTokens', 64),
        temperature: c.get<number>('temperature', 0),
        prefixChars: c.get<number>('prefixChars', 4000),
        suffixChars: c.get<number>('suffixChars', 1000),
        timeoutMs: c.get<number>('timeoutMs', 8000),
        multiline: c.get<boolean>('multiline', true),
        disabledLanguages: c.get<string[]>('disabledLanguages', ['plaintext', 'markdown'])
    };
}

function resolveProvider(cfg: Config): CompletionProvider {
    const provider = providers.get(cfg.provider);
    if (!provider) {
        throw new Error(`Provider non supportato: ${cfg.provider}`);
    }
    return provider;
}

function wait(ms: number, token: vscode.CancellationToken): Promise<boolean> {
    return new Promise(resolve => {
        if (token.isCancellationRequested) {
            resolve(false);
            return;
        }
        const sub = token.onCancellationRequested(() => {
            clearTimeout(timer);
            sub.dispose();
            resolve(false);
        });
        const timer = setTimeout(() => {
            sub.dispose();
            resolve(true);
        }, ms);
    });
}

function cleanCompletion(text: string, multiline: boolean): string {
    let result = text.replace(/\s+$/, '');
    if (!multiline) {
        const lines = result.split(/\r?\n/);
        const first = lines.find(line => line.trim().length > 0);
        result = first ?? '';
    }
    return result;
}

class StatusController implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private status: Status = 'idle';
    private detail = '';

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.item.command = 'ghostline.toggle';
        this.item.show();
        this.render();
    }

    set(status: Status, detail = ''): void {
        this.status = status;
        this.detail = detail;
        this.render();
    }

    render(): void {
        const cfg = readConfig();
        if (!cfg.enabled) {
            this.item.text = '$(circle-slash) Ghostline';
            this.item.tooltip = 'Suggerimenti disattivati. Clic per attivarli.';
            return;
        }
        switch (this.status) {
            case 'busy':
                this.item.text = '$(loading~spin) Ghostline';
                this.item.tooltip = `Richiesta a ${cfg.model}`;
                break;
            case 'error':
                this.item.text = '$(warning) Ghostline';
                this.item.tooltip = this.detail || 'Errore nell\'ultima richiesta. Vedi il log.';
                break;
            default:
                this.item.text = '$(sparkle) Ghostline';
                this.item.tooltip = `Modello: ${cfg.model}. Clic per disattivare.`;
        }
    }

    dispose(): void {
        this.item.dispose();
    }
}

class GhostlineProvider implements vscode.InlineCompletionItemProvider {
    constructor(
        private readonly status: StatusController,
        private readonly log: vscode.OutputChannel
    ) {}

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        const cfg = readConfig();
        if (!cfg.enabled || cfg.disabledLanguages.includes(document.languageId)) {
            return undefined;
        }
        if (context.selectedCompletionInfo) {
            return undefined;
        }
        if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
            if (!(await wait(cfg.debounceMs, token))) {
                return undefined;
            }
        }

        const offset = document.offsetAt(position);
        const prefixStart = document.positionAt(Math.max(0, offset - cfg.prefixChars));
        const suffixEnd = document.positionAt(offset + cfg.suffixChars);
        const prefix = document.getText(new vscode.Range(prefixStart, position));
        const suffix = document.getText(new vscode.Range(position, suffixEnd));

        const controller = new AbortController();
        const cancelSub = token.onCancellationRequested(() => controller.abort());
        const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

        this.status.set('busy');
        try {
            const raw = await resolveProvider(cfg).complete({
                prefix,
                suffix,
                model: cfg.model,
                endpoint: cfg.endpoint,
                maxTokens: cfg.maxTokens,
                temperature: cfg.temperature,
                signal: controller.signal
            });
            const text = cleanCompletion(raw, cfg.multiline);
            this.status.set('idle');

            if (!text || token.isCancellationRequested) {
                return undefined;
            }
            return [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))];
        } catch (error) {
            if (controller.signal.aborted && token.isCancellationRequested) {
                this.status.set('idle');
                return undefined;
            }
            const message = controller.signal.aborted
                ? `Timeout dopo ${cfg.timeoutMs} ms`
                : error instanceof Error
                    ? error.message
                    : String(error);
            this.log.appendLine(`[${new Date().toISOString()}] ${message}`);
            this.status.set('error', message);
            return undefined;
        } finally {
            clearTimeout(timer);
            cancelSub.dispose();
        }
    }
}

async function pickModel(log: vscode.OutputChannel): Promise<void> {
    const cfg = readConfig();
    try {
        const names = await resolveProvider(cfg).listModels(cfg.endpoint);
        if (names.length === 0) {
            vscode.window.showWarningMessage('Nessun modello disponibile sul server.');
            return;
        }
        const picked = await vscode.window.showQuickPick(names, {
            title: 'Modello per i suggerimenti inline',
            placeHolder: cfg.model
        });
        if (picked) {
            await vscode.workspace
                .getConfiguration(SECTION)
                .update('model', picked, vscode.ConfigurationTarget.Global);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.appendLine(`[${new Date().toISOString()}] Elenco modelli non disponibile: ${message}`);
        vscode.window.showErrorMessage(`Impossibile ottenere i modelli da ${cfg.endpoint}.`);
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const log = vscode.window.createOutputChannel('Ghostline');
    const status = new StatusController();
    const provider = new GhostlineProvider(status, log);

    context.subscriptions.push(
        log,
        status,
        vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider),
        vscode.commands.registerCommand('ghostline.toggle', async () => {
            const config = vscode.workspace.getConfiguration(SECTION);
            await config.update('enabled', !config.get<boolean>('enabled', true), vscode.ConfigurationTarget.Global);
        }),
        vscode.commands.registerCommand('ghostline.pickModel', () => pickModel(log)),
        vscode.commands.registerCommand('ghostline.showLog', () => log.show(true)),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(SECTION)) {
                status.set('idle');
            }
        })
    );
}

export function deactivate(): void {}
