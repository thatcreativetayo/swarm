import type { LlmCallOptions, LlmProvider, LlmRequest, LlmResponse } from "../providers/types.js";
import type { ModelCaller, ModelCallMeta } from "./accounting.js";

export class AccountedProvider implements LlmProvider {
  readonly name: string;
  readonly defaultModel: string;

  constructor(
    private readonly provider: LlmProvider,
    private readonly modelCaller: ModelCaller,
    private readonly meta: ModelCallMeta,
  ) {
    this.name = provider.name;
    this.defaultModel = provider.defaultModel;
  }

  complete(request: LlmRequest, options?: LlmCallOptions): Promise<LlmResponse> {
    return this.modelCaller.call(this.provider, request, this.meta, options);
  }
}
