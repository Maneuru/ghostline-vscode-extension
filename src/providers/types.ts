export interface CompletionRequest {
    prefix: string;
    suffix: string;
    model: string;
    endpoint: string;
    maxTokens: number;
    temperature: number;
    signal: AbortSignal;
}

export interface CompletionProvider {
    readonly id: string;
    complete(request: CompletionRequest): Promise<string>;
    listModels(endpoint: string): Promise<string[]>;
}
