import type { WorkflowFileReference } from '../../shared/types.js';

export type WorkflowFileSourceProvider = {
  provider: string;
  read: (ref: WorkflowFileReference) => Promise<Buffer>;
};

export class WorkflowFileSourceRegistry {
  private readonly providers = new Map<string, WorkflowFileSourceProvider>();

  register(provider: WorkflowFileSourceProvider): void {
    const key = provider.provider.trim();
    if (!key) throw new Error('Workflow file source provider cannot be empty');
    this.providers.set(key, { ...provider, provider: key });
  }

  async read(ref: WorkflowFileReference): Promise<Buffer> {
    const provider = this.providers.get(ref.provider);
    if (!provider) throw new Error(`Workflow file source provider not registered: ${ref.provider}`);
    return provider.read(ref);
  }
}

export function productFileRef(key: string): WorkflowFileReference {
  return { provider: 'product-files', key };
}

/**
 * Build the `fileRefs` runtime-parameter object from resolved per-source file bindings.
 *
 * Source keys come from whatever bindings the caller resolved (which mirror a DB workflow's
 * runtime_params_schema.fileRefs); this does not depend on any hardcoded source list.
 */
export function buildFileRefsFromBindings(
  sources: Record<string, { fileKey?: string } | undefined>,
): { fileRefs: Record<string, WorkflowFileReference> } {
  const fileRefs: Record<string, WorkflowFileReference> = {};
  for (const [sourceKey, binding] of Object.entries(sources)) {
    const fileKey = String(binding?.fileKey ?? '').trim();
    if (fileKey) fileRefs[sourceKey] = productFileRef(fileKey);
  }
  return { fileRefs };
}
