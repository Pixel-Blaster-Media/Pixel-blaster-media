import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
export function loadWorkflow(service, providers = {}, sourceOverride) {
  const source = (sourceOverride ?? fs.readFileSync(new URL('../../lib/integrations/autoenhance/workflow.ts', import.meta.url), 'utf8')) + '\nexport { pushFinishedImagesToIGuide, upsertIGuideUpload, claimIGuideUpload };';
  const mod = { exports: {} };
  const mocks = {
    'server-only': {}, '@/lib/supabase/server': { getServiceSupabase: () => service },
    '@/lib/integrations/provider-enablement': { requirePhotoEditingProviderEnabled: async () => {} },
    '@/lib/integrations/iguide/bounded-media': { mediaSignal: () => new AbortController().signal, withMediaDeadline: (_, fn) => fn() },
    '@/lib/integrations/autoenhance/client': { AutoenhanceError: class extends Error {}, ...providers },
    '@/lib/integrations/iguide/portal-client': providers,
  };
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(id => id in mocks ? mocks[id] : require(id), mod, mod.exports);
  return mod.exports;
}
