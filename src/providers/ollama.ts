import * as vscode from 'vscode';
import { CompletionProvider, CompletionRequest } from './types';

export class OllamaProvider implements CompletionProvider {
  readonly id = 'ollama';

  async complete(request: CompletionRequest): Promise<string> {
    const keepAlive = vscode.workspace
      .getConfiguration('ghostline.ollama')
      .get<string>('keepAlive', '30m');

    const response = await fetch(`${request.endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prefix,
        suffix: request.suffix,
        stream: false,
        keep_alive: keepAlive,
        options: {
          num_predict: request.maxTokens,
          temperature: request.temperature,
        },
      }),
      signal: request.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as { response?: string };

    return data.response ?? '';
  }

  async listModels(endpoint: string): Promise<string[]> {
    const response = await fetch(`${endpoint}/api/tags`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as { models?: { name: string }[] };

    return (data.models ?? []).map(model => model.name);
  }
}
