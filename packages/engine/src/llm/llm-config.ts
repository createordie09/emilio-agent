import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LLM_CONFIG, type LlmConfig } from './exec-config';

export function loadLlmConfig(resourcesDir: string | undefined): LlmConfig {
  const p = resourcesDir ? join(resourcesDir, 'llm-config.json') : '';
  const f = p && existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Partial<LlmConfig>) : {};
  return {
    maxOutputTokens: f.maxOutputTokens ?? DEFAULT_LLM_CONFIG.maxOutputTokens,
    reasoning: { ...DEFAULT_LLM_CONFIG.reasoning, ...f.reasoning },
  };
}
